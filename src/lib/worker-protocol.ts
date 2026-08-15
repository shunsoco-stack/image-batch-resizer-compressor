import type { ImageProcessProgress, ImageProcessingErrorCode } from "./image-engine";
import type { ImageCapabilities, ProcessedAsset, Workflow } from "./types";

export interface WorkerProcessRequest {
  kind: "process";
  requestId: string;
  file: File;
  workflow: Workflow;
  index: number;
  capabilities?: ImageCapabilities;
}
export interface WorkerCancelRequest {
  kind: "cancel";
  requestId: string;
}

export interface WorkerDisposeRequest {
  kind: "dispose";
}

export type ImageWorkerRequest =
  | WorkerProcessRequest
  | WorkerCancelRequest
  | WorkerDisposeRequest;

export interface WorkerProgressResponse {
  kind: "progress";
  requestId: string;
  progress: ImageProcessProgress;
}

export interface WorkerSuccessResponse {
  kind: "success";
  requestId: string;
  result: ProcessedAsset;
}

export interface SerializedImageProcessingError {
  name: string;
  message: string;
  code: ImageProcessingErrorCode;
  recoverable: boolean;
}

export interface WorkerErrorResponse {
  kind: "error";
  requestId: string;
  error: SerializedImageProcessingError;
}

export interface WorkerCancelledResponse {
  kind: "cancelled";
  requestId: string;
}

export type ImageWorkerResponse =
  | WorkerProgressResponse
  | WorkerSuccessResponse
  | WorkerErrorResponse
  | WorkerCancelledResponse;

export function isImageWorkerResponse(value: unknown): value is ImageWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ImageWorkerResponse>;
  return (
    typeof candidate.requestId === "string" &&
    (candidate.kind === "progress" ||
      candidate.kind === "success" ||
      candidate.kind === "error" ||
      candidate.kind === "cancelled")
  );
}
