/// <reference lib="webworker" />

import {
  ImageProcessingError,
  processImage,
  type ImageProcessProgress,
} from "@/lib/image-engine";
import type {
  ImageWorkerRequest,
  ImageWorkerResponse,
  SerializedImageProcessingError,
} from "@/lib/worker-protocol";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const controllers = new Map<string, AbortController>();

function post(message: ImageWorkerResponse): void {
  workerScope.postMessage(message);
}

function serializeError(error: unknown): SerializedImageProcessingError {
  if (error instanceof ImageProcessingError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      recoverable: error.recoverable,
    };
  }
  return {
    name: error instanceof Error ? error.name : "ImageProcessingError",
    message: error instanceof Error ? error.message : "The image worker failed.",
    code: "worker-failure",
    recoverable: true,
  };
}

async function runProcess(request: Extract<ImageWorkerRequest, { kind: "process" }>): Promise<void> {
  const controller = new AbortController();
  controllers.set(request.requestId, controller);
  const onProgress = (progress: ImageProcessProgress): void => {
    post({ kind: "progress", requestId: request.requestId, progress });
  };

  try {
    const result = await processImage(
      request.file,
      request.workflow,
      request.index,
      request.capabilities,
      controller.signal,
      onProgress,
    );
    post({ kind: "success", requestId: request.requestId, result });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      post({ kind: "cancelled", requestId: request.requestId });
    } else {
      post({ kind: "error", requestId: request.requestId, error: serializeError(error) });
    }
  } finally {
    controllers.delete(request.requestId);
  }
}

workerScope.addEventListener("message", (event: MessageEvent<ImageWorkerRequest>) => {
  const request = event.data;
  if (request.kind === "process") {
    void runProcess(request);
    return;
  }
  if (request.kind === "cancel") {
    controllers.get(request.requestId)?.abort();
    return;
  }
  if (request.kind === "dispose") {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    workerScope.close();
  }
});

export {};
