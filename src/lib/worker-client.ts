import {
  getRecommendedWorkerCount,
  supportsWorkerImageProcessing,
} from "./capabilities";
import {
  ImageProcessingError,
  processImage,
  type ImageProcessProgressCallback,
  type ImageProcessingErrorCode,
} from "./image-engine";
import type { ImageWorkerRequest } from "./worker-protocol";
import { isImageWorkerResponse } from "./worker-protocol";
import type { ImageCapabilities, ProcessedAsset, Workflow } from "./types";

export interface ImageWorkerProcessOptions {
  capabilities?: ImageCapabilities;
  signal?: AbortSignal;
  onProgress?: ImageProcessProgressCallback;
}

export interface ImageWorkerClientOptions {
  concurrency?: number;
  /** Dependency injection hook used by tests and constrained webviews. */
  workerFactory?: () => Worker;
  /** Disable only when the caller wants worker failures surfaced directly. */
  fallbackToMainThread?: boolean;
}

interface QueueItem {
  requestId: string;
  file: File;
  workflow: Workflow;
  index: number;
  options: ImageWorkerProcessOptions;
  resolve: (result: ProcessedAsset) => void;
  reject: (error: unknown) => void;
  abortListener?: () => void;
  fallbackController?: AbortController;
  settled: boolean;
  attemptedWorker: boolean;
  attemptedFallback: boolean;
}

interface WorkerSlot {
  worker: Worker;
  item?: QueueItem;
  retired: boolean;
}

function abortError(): ImageProcessingError {
  return new ImageProcessingError("aborted", "Image processing was cancelled.", true);
}

function workerError(message: string): ImageProcessingError {
  return new ImageProcessingError("worker-failure", message, true);
}

function requiresMainThreadFallback(code: ImageProcessingErrorCode): boolean {
  return code === "worker-failure" || code === "unsupported-environment";
}

function safeConcurrency(value: number | undefined): number {
  if (value === undefined) return getRecommendedWorkerCount();
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(4, Math.floor(value)));
}

/**
 * Small worker pool for high-volume queues. Each worker receives at most one
 * image at a time, constraining peak decoded-pixel memory.
 */
export class ImageWorkerClient {
  private readonly concurrency: number;
  private readonly fallbackToMainThread: boolean;
  private readonly factory: () => Worker;
  private readonly queue: QueueItem[] = [];
  private readonly slots: WorkerSlot[] = [];
  private readonly fallbackItems = new Set<QueueItem>();
  private requestCounter = 0;
  private activeFallbacks = 0;
  private disposed = false;
  private workerDisabled = false;

  constructor(options: ImageWorkerClientOptions = {}) {
    this.concurrency = safeConcurrency(options.concurrency);
    this.fallbackToMainThread = options.fallbackToMainThread !== false;
    this.factory =
      options.workerFactory ??
      (() => new Worker(new URL("../workers/image.worker.ts", import.meta.url), { type: "module" }));
    this.workerDisabled = options.workerFactory === undefined && !supportsWorkerImageProcessing();
  }

  process(
    file: File,
    workflow: Workflow,
    index: number,
    options: ImageWorkerProcessOptions = {},
  ): Promise<ProcessedAsset> {
    if (this.disposed) {
      return Promise.reject(workerError("The image processor has already been terminated."));
    }
    if (options.signal?.aborted) return Promise.reject(abortError());

    return new Promise<ProcessedAsset>((resolve, reject) => {
      const item: QueueItem = {
        requestId: `image-${Date.now().toString(36)}-${++this.requestCounter}`,
        file,
        workflow,
        index,
        options,
        resolve,
        reject,
        settled: false,
        attemptedWorker: false,
        attemptedFallback: false,
      };
      if (options.signal) {
        item.abortListener = () => this.abortItem(item);
        options.signal.addEventListener("abort", item.abortListener, { once: true });
      }
      this.queue.push(item);
      this.pump();
    });
  }

  cancelAll(reason = "Batch processing was cancelled."): void {
    const error = new ImageProcessingError("aborted", reason, true);
    const queued = this.queue.splice(0);
    for (const item of queued) this.finish(item, undefined, error);

    // Abort messages are cooperative and cannot interrupt an encoder that is
    // already inside convertToBlob(). Terminate every pool worker instead, then
    // lazily create clean instances for a later run. This prevents cancel ->
    // immediate restart from running old and new jobs concurrently.
    const slots = this.slots.splice(0);
    for (const slot of slots) {
      const activeItem = slot.item;
      slot.item = undefined;
      slot.retired = true;
      slot.worker.terminate();
      if (activeItem) this.finish(activeItem, undefined, error);
    }
    for (const item of this.fallbackItems) {
      item.fallbackController?.abort();
      this.finish(item, undefined, error);
    }
  }

  terminate(): void {
    if (this.disposed) return;
    this.cancelAll("The image processor was terminated.");
    this.disposed = true;
    for (const slot of this.slots) {
      try {
        slot.worker.postMessage({ kind: "dispose" } satisfies ImageWorkerRequest);
      } finally {
        slot.worker.terminate();
      }
    }
    this.slots.length = 0;
  }

  private abortItem(item: QueueItem): void {
    if (item.settled) return;
    const queueIndex = this.queue.indexOf(item);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
      this.finish(item, undefined, abortError());
      return;
    }
    const slot = this.slots.find((candidate) => candidate.item === item);
    if (slot) {
      slot.item = undefined;
      slot.retired = true;
      slot.worker.terminate();
      const slotIndex = this.slots.indexOf(slot);
      if (slotIndex >= 0) this.slots.splice(slotIndex, 1);
      this.finish(item, undefined, abortError());
      this.pump();
      return;
    }
    if (this.fallbackItems.has(item)) {
      item.fallbackController?.abort();
      this.finish(item, undefined, abortError());
    }
  }

  private finish(item: QueueItem, result?: ProcessedAsset, error?: unknown): void {
    if (item.settled) return;
    item.settled = true;
    if (item.abortListener && item.options.signal) {
      item.options.signal.removeEventListener("abort", item.abortListener);
    }
    if (error !== undefined) item.reject(error);
    else if (result) item.resolve(result);
  }

  private getOrCreateIdleSlot(): WorkerSlot | undefined {
    const idle = this.slots.find((slot) => !slot.item);
    if (idle) return idle;
    if (this.slots.length >= this.concurrency || this.workerDisabled) return undefined;

    try {
      const slot: WorkerSlot = { worker: this.factory(), retired: false };
      slot.worker.addEventListener("message", (event: MessageEvent<unknown>) => {
        this.handleWorkerMessage(slot, event.data);
      });
      slot.worker.addEventListener("error", (event: ErrorEvent) => {
        event.preventDefault?.();
        this.handleWorkerFailure(slot, event.message || "The image worker crashed.");
      });
      slot.worker.addEventListener("messageerror", () => {
        this.handleWorkerFailure(slot, "The worker returned an unreadable response.");
      });
      this.slots.push(slot);
      return slot;
    } catch {
      this.workerDisabled = true;
      return undefined;
    }
  }

  private pump(): void {
    if (this.disposed) return;

    if (this.workerDisabled) {
      while (this.queue.length > 0 && this.activeFallbacks < this.concurrency) {
        const item = this.queue.shift()!;
        this.runFallback(item);
      }
      return;
    }

    while (this.queue.length > 0) {
      const slot = this.getOrCreateIdleSlot();
      if (!slot) break;
      const item = this.queue.shift()!;
      if (item.options.signal?.aborted) {
        this.finish(item, undefined, abortError());
        continue;
      }
      item.attemptedWorker = true;
      slot.item = item;
      const request: ImageWorkerRequest = {
        kind: "process",
        requestId: item.requestId,
        file: item.file,
        workflow: item.workflow,
        index: item.index,
        capabilities: item.options.capabilities,
      };
      try {
        slot.worker.postMessage(request);
      } catch (error) {
        slot.item = undefined;
        this.handleWorkerFailure(
          slot,
          error instanceof Error ? error.message : "The worker request failed.",
          item,
        );
      }
    }
  }

  private handleWorkerMessage(slot: WorkerSlot, value: unknown): void {
    if (slot.retired) return;
    if (!isImageWorkerResponse(value) || slot.item?.requestId !== value.requestId) return;
    const item = slot.item;
    if (value.kind === "progress") {
      item.options.onProgress?.(value.progress);
      return;
    }

    if (
      value.kind === "error" &&
      this.fallbackToMainThread &&
      requiresMainThreadFallback(value.error.code)
    ) {
      // A structured runtime/environment failure is just as worker-specific as
      // an ErrorEvent. Retire the entire pool before retrying so late messages
      // cannot settle this item and subsequent work does not repeat the fault.
      this.handleWorkerFailure(slot, value.error.message, item);
      return;
    }

    slot.item = undefined;
    if (value.kind === "success") {
      this.finish(item, value.result);
    } else if (value.kind === "cancelled") {
      this.finish(item, undefined, abortError());
    } else {
      this.finish(
        item,
        undefined,
        new ImageProcessingError(
          value.error.code,
          value.error.message,
          value.error.recoverable,
        ),
      );
    }
    this.pump();
  }

  private handleWorkerFailure(slot: WorkerSlot, message: string, failedItem = slot.item): void {
    if (slot.retired) return;
    slot.retired = true;
    slot.item = undefined;
    slot.worker.terminate();
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);

    // Once a runtime worker fails, keep the pool on the reliable main-thread
    // path rather than repeatedly crashing newly constructed workers.
    this.workerDisabled = true;
    if (failedItem && !failedItem.settled) {
      if (this.fallbackToMainThread) this.runFallback(failedItem);
      else this.finish(failedItem, undefined, workerError(message));
    }
    for (const other of this.slots) {
      other.retired = true;
      other.worker.terminate();
      if (other.item && !other.item.settled) this.queue.unshift(other.item);
    }
    this.slots.length = 0;
    this.pump();
  }

  private runFallback(item: QueueItem): void {
    if (item.settled) return;
    if (item.options.signal?.aborted) {
      this.finish(item, undefined, abortError());
      return;
    }
    if (!this.fallbackToMainThread && item.attemptedWorker) {
      this.finish(item, undefined, workerError("Worker image processing failed."));
      return;
    }
    if (item.attemptedFallback) {
      this.finish(item, undefined, workerError("Main-thread image processing already failed."));
      return;
    }
    item.attemptedFallback = true;
    this.activeFallbacks += 1;
    const fallbackController = new AbortController();
    item.fallbackController = fallbackController;
    this.fallbackItems.add(item);
    const externalSignal = item.options.signal;
    const forwardAbort = (): void => fallbackController.abort();
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    void processImage(
      item.file,
      item.workflow,
      item.index,
      item.options.capabilities,
      fallbackController.signal,
      item.options.onProgress,
    )
      .then((result) => this.finish(item, result))
      .catch((error: unknown) => this.finish(item, undefined, error))
      .finally(() => {
        externalSignal?.removeEventListener("abort", forwardAbort);
        this.fallbackItems.delete(item);
        item.fallbackController = undefined;
        this.activeFallbacks -= 1;
        this.pump();
      });
  }
}

export function createImageWorkerClient(
  options?: ImageWorkerClientOptions,
): ImageWorkerClient {
  return new ImageWorkerClient(options);
}
