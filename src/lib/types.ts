export const WORKFLOW_SCHEMA_VERSION = 1 as const;

export const IMAGE_FORMATS = ["jpeg", "png", "webp", "avif"] as const;

export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export type ImageMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/avif";

export type ImageAssetStatus =
  | "ready"
  | "queued"
  | "processing"
  | "completed"
  | "error"
  | "cancelled";

export interface ImageAsset {
  id: string;
  file: File;
  name: string;
  mime: ImageMimeType;
  width: number;
  height: number;
  size: number;
  sourceUrl: string;
  status: ImageAssetStatus;
  error?: string;
}

export interface ProcessedAsset {
  assetId: string;
  blob: Blob;
  name: string;
  mime: ImageMimeType;
  width: number;
  height: number;
  size: number;
  originalSize: number;
  metadataPreserved: boolean;
}

export interface FormatCapability {
  decode: boolean;
  encode: boolean;
}

export type ImageCapabilities = Record<ImageFormat, FormatCapability>;

export interface Dimensions {
  width: number;
  height: number;
}

export interface Rectangle extends Dimensions {
  x: number;
  y: number;
}

export type ResizeMode =
  | "width"
  | "height"
  | "dimensions"
  | "percentage"
  | "long-side"
  | "short-side";

export interface ResizeConfig {
  mode: ResizeMode;
  width?: number;
  height?: number;
  percentage?: number;
  longSide?: number;
  shortSide?: number;
  maintainAspectRatio: boolean;
  allowUpscale?: boolean;
}

export type CropAspect = "original" | "1:1" | "4:3" | "16:9" | "custom";

/** Stretch is deliberately not a valid fit mode. */
export type FitMode = "cover" | "contain";

export interface CropConfig {
  aspect: CropAspect;
  customWidth?: number;
  customHeight?: number;
  fitMode: FitMode;
}

export interface FitGeometry {
  source: Rectangle;
  destination: Rectangle;
}

export type ResizeStepConfig = ResizeConfig;

export type CropStepConfig = CropConfig;

export interface FormatStepConfig {
  format: ImageFormat;
  /** CSS color used when an alpha image is flattened to a non-alpha format. */
  background: string;
}

export interface CompressStepConfig {
  /** Encoder quality expressed as a whole-number percent. */
  quality: number;
}

export type MetadataMode = "keep" | "remove";

export interface MetadataStepConfig {
  mode: MetadataMode;
}

export interface RenameStepConfig {
  template: string;
  startNumber: number;
  padding: number;
}

export interface ZipStepConfig {
  archiveName: string;
}

interface WorkflowStepBase<TType extends string, TConfig> {
  id: string;
  type: TType;
  enabled: boolean;
  config: TConfig;
}

export type ResizeWorkflowStep = WorkflowStepBase<"resize", ResizeStepConfig>;
export type CropWorkflowStep = WorkflowStepBase<"crop", CropStepConfig>;
export type FormatWorkflowStep = WorkflowStepBase<"format", FormatStepConfig>;
export type CompressWorkflowStep = WorkflowStepBase<"compress", CompressStepConfig>;
export type MetadataWorkflowStep = WorkflowStepBase<"metadata", MetadataStepConfig>;
export type RenameWorkflowStep = WorkflowStepBase<"rename", RenameStepConfig>;
export type ZipWorkflowStep = WorkflowStepBase<"zip", ZipStepConfig>;

export type WorkflowStep =
  | ResizeWorkflowStep
  | CropWorkflowStep
  | FormatWorkflowStep
  | CompressWorkflowStep
  | MetadataWorkflowStep
  | RenameWorkflowStep
  | ZipWorkflowStep;

export interface Workflow {
  version: typeof WORKFLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
}

export interface WorkflowTemplate {
  version: typeof WORKFLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  description: string;
  category: string;
  builtIn: boolean;
  workflow: Workflow;
  createdAt: string;
  updatedAt: string;
}

export interface FilenameTemplateContext {
  /** Original filename with or without its extension. */
  name: string;
  number: number;
  width: number;
  height: number;
  format: ImageFormat;
}

export interface FilenameTemplateOptions {
  numberPadding?: number;
  maxLength?: number;
}

export interface ZipEntry {
  name: string;
  data: Blob | ArrayBuffer | Uint8Array;
  lastModified?: Date;
}

export type ZipProgressPhase = "checksum" | "finalizing" | "complete";

export interface ZipProgress {
  phase: ZipProgressPhase;
  completedEntries: number;
  totalEntries: number;
  processedBytes: number;
  totalBytes: number;
  currentEntry?: string;
}

export interface ZipOptions {
  /** MIME type of the returned Blob. Defaults to application/zip. */
  mimeType?: string;
  /** Cancels checksum calculation and archive assembly. */
  signal?: AbortSignal;
  /** Receives monotonic byte and entry progress, including a final complete event. */
  onProgress?: (progress: ZipProgress) => void;
  /** Maximum bytes read into memory while checksumming a Blob. Defaults to 1 MiB. */
  chunkSize?: number;
  /** Bytes processed before yielding to the browser event loop. Defaults to 8 MiB. */
  yieldEveryBytes?: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
