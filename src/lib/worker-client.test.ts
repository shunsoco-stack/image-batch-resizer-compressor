import { afterEach, describe, expect, it, vi } from "vitest";

const engineMocks = vi.hoisted(() => ({
  processImage: vi.fn(),
}));

vi.mock("./image-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./image-engine")>();
  return { ...actual, processImage: engineMocks.processImage };
});

import { ImageWorkerClient } from "./worker-client";
import type { ImageWorkerRequest, ImageWorkerResponse } from "./worker-protocol";
import type { ProcessedAsset, Workflow } from "./types";

const now = "2026-08-13T00:00:00.000Z";
const workflow: Workflow = {
  version: 1,
  id: "test",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  steps: [],
};

function file(name = "photo.jpg"): File {
  return new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer], name, {
    type: "image/jpeg",
    lastModified: 1,
  });
}

function result(input: File): ProcessedAsset {
  const blob = new Blob([Uint8Array.from([1]).buffer], { type: "image/jpeg" });
  return {
    assetId: `${input.name}:${input.size}:${input.lastModified}`,
    blob,
    name: input.name,
    mime: "image/jpeg",
    width: 1,
    height: 1,
    size: blob.size,
    originalSize: input.size,
    metadataPreserved: false,
  };
}

class FakeWorker extends EventTarget {
  readonly requests: ImageWorkerRequest[] = [];
  terminated = false;
  onPost?: (request: ImageWorkerRequest) => void;

  postMessage(request: ImageWorkerRequest): void {
    this.requests.push(request);
    this.onPost?.(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: ImageWorkerResponse): void {
    this.dispatchEvent(new MessageEvent("message", { data: response }));
  }

  crash(message: string): void {
    this.dispatchEvent(new ErrorEvent("error", { message }));
  }
}

describe("ImageWorkerClient", () => {
  const clients: ImageWorkerClient[] = [];

  afterEach(() => {
    for (const client of clients) client.terminate();
    clients.length = 0;
    engineMocks.processImage.mockReset();
    vi.unstubAllGlobals();
  });

  it("forwards worker progress and resolves the processed asset", async () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const input = file();
    const client = new ImageWorkerClient({
      concurrency: 1,
      workerFactory: () => worker as unknown as Worker,
    });
    clients.push(client);
    worker.onPost = (request) => {
      if (request.kind !== "process") return;
      worker.respond({
        kind: "progress",
        requestId: request.requestId,
        progress: { stage: "encoding", progress: 80 },
      });
      worker.respond({ kind: "success", requestId: request.requestId, result: result(input) });
    };

    await expect(client.process(input, workflow, 0, { onProgress: progress })).resolves.toMatchObject({
      name: "photo.jpg",
      width: 1,
    });
    expect(progress).toHaveBeenCalledWith({ stage: "encoding", progress: 80 });
  });

  it("cancels queued work without sending it to the worker", async () => {
    const worker = new FakeWorker();
    const client = new ImageWorkerClient({
      concurrency: 1,
      workerFactory: () => worker as unknown as Worker,
    });
    clients.push(client);
    const first = client.process(file("first.jpg"), workflow, 0);
    const controller = new AbortController();
    const second = client.process(file("second.jpg"), workflow, 1, { signal: controller.signal });
    controller.abort();

    await expect(second).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(worker.requests.filter((request) => request.kind === "process")).toHaveLength(1);

    const request = worker.requests[0];
    if (request.kind === "process") {
      worker.respond({ kind: "success", requestId: request.requestId, result: result(request.file) });
    }
    await expect(first).resolves.toBeDefined();
  });

  it("terminates workers and rejects outstanding operations", async () => {
    const worker = new FakeWorker();
    const client = new ImageWorkerClient({ workerFactory: () => worker as unknown as Worker });
    clients.push(client);
    const pending = client.process(file(), workflow, 0);
    client.terminate();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
    await expect(client.process(file(), workflow, 0)).rejects.toMatchObject({
      code: "worker-failure",
    });
  });

  it("clears queued jobs and creates a fresh worker for an immediate restart", async () => {
    const workers: FakeWorker[] = [];
    const client = new ImageWorkerClient({
      concurrency: 1,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    clients.push(client);

    const active = client.process(file("active.jpg"), workflow, 0);
    const queued = client.process(file("queued.jpg"), workflow, 1);
    expect(workers).toHaveLength(1);
    expect(workers[0].requests.filter((request) => request.kind === "process")).toHaveLength(1);

    client.cancelAll();
    await expect(active).rejects.toMatchObject({ name: "AbortError" });
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0].terminated).toBe(true);

    const restartedFile = file("restart.jpg");
    const restarted = client.process(restartedFile, workflow, 2);
    expect(workers).toHaveLength(2);
    expect(workers[1]).not.toBe(workers[0]);
    const restartRequest = workers[1].requests.find((request) => request.kind === "process");
    expect(restartRequest?.kind).toBe("process");
    if (restartRequest?.kind === "process") {
      workers[1].respond({
        kind: "success",
        requestId: restartRequest.requestId,
        result: result(restartedFile),
      });
    }
    await expect(restarted).resolves.toMatchObject({ name: "restart.jpg" });
    expect(workers[0].requests.filter((request) => request.kind === "process")).toHaveLength(1);
  });

  it("ignores late events emitted by a terminated worker after cancellation", async () => {
    const workers: FakeWorker[] = [];
    const client = new ImageWorkerClient({
      concurrency: 1,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    clients.push(client);

    const cancelled = client.process(file("old.jpg"), workflow, 0);
    const oldRequest = workers[0].requests[0];
    client.cancelAll();
    await expect(cancelled).rejects.toMatchObject({ code: "aborted" });

    const newFile = file("new.jpg");
    const restarted = client.process(newFile, workflow, 1);
    if (oldRequest.kind === "process") {
      workers[0].respond({
        kind: "success",
        requestId: oldRequest.requestId,
        result: result(file("old.jpg")),
      });
      workers[0].crash("late crash");
    }
    expect(workers[1].terminated).toBe(false);

    const newRequest = workers[1].requests[0];
    if (newRequest.kind === "process") {
      workers[1].respond({
        kind: "success",
        requestId: newRequest.requestId,
        result: result(newFile),
      });
    }
    await expect(restarted).resolves.toMatchObject({ name: "new.jpg" });
  });

  it.each(["worker-failure", "unsupported-environment"] as const)(
    "falls back once for a structured %s response and ignores late worker events",
    async (code) => {
      const worker = new FakeWorker();
      const input = file("fallback.jpg");
      const fallbackResult = { ...result(input), name: "main-thread.jpg" };
      let resolveFallback: ((value: ProcessedAsset) => void) | undefined;
      engineMocks.processImage.mockImplementation(() => new Promise<ProcessedAsset>((resolve) => {
        resolveFallback = resolve;
      }));
      const client = new ImageWorkerClient({
        concurrency: 1,
        workerFactory: () => worker as unknown as Worker,
      });
      clients.push(client);

      const pending = client.process(input, workflow, 0);
      const request = worker.requests[0];
      if (request.kind !== "process") throw new Error("Expected a process request.");
      worker.respond({
        kind: "error",
        requestId: request.requestId,
        error: {
          name: "ImageProcessingError",
          message: "Worker runtime is unavailable.",
          code,
          recoverable: true,
        },
      });

      expect(worker.terminated).toBe(true);
      expect(engineMocks.processImage).toHaveBeenCalledOnce();
      worker.respond({
        kind: "success",
        requestId: request.requestId,
        result: { ...result(input), name: "late-worker.jpg" },
      });
      resolveFallback?.(fallbackResult);

      await expect(pending).resolves.toMatchObject({ name: "main-thread.jpg" });
      expect(engineMocks.processImage).toHaveBeenCalledOnce();
    },
  );

  it("aborts a main-thread fallback without allowing a late worker completion", async () => {
    const worker = new FakeWorker();
    const input = file("abort-fallback.jpg");
    const controller = new AbortController();
    let fallbackSignal: AbortSignal | undefined;
    engineMocks.processImage.mockImplementation(
      (...args: unknown[]) => new Promise<ProcessedAsset>((_resolve, reject) => {
        fallbackSignal = args[4] as AbortSignal;
        const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
        if (fallbackSignal.aborted) rejectAbort();
        else fallbackSignal.addEventListener("abort", rejectAbort, { once: true });
      }),
    );
    const client = new ImageWorkerClient({
      concurrency: 1,
      workerFactory: () => worker as unknown as Worker,
    });
    clients.push(client);

    const pending = client.process(input, workflow, 0, { signal: controller.signal });
    const request = worker.requests[0];
    if (request.kind !== "process") throw new Error("Expected a process request.");
    worker.respond({
      kind: "error",
      requestId: request.requestId,
      error: {
        name: "ImageProcessingError",
        message: "Worker APIs are unavailable.",
        code: "unsupported-environment",
        recoverable: true,
      },
    });

    controller.abort();
    worker.respond({
      kind: "success",
      requestId: request.requestId,
      result: result(input),
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(fallbackSignal?.aborted).toBe(true);
    expect(engineMocks.processImage).toHaveBeenCalledOnce();
  });
});
