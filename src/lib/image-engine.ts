import {
  detectImageFormat,
  formatForMime,
  mimeForFormat,
  normalizeImageMime,
} from "./capabilities";
import { renderFilenameTemplate } from "./filename-template";
import {
  calculateCropOutputDimensions,
  calculateFitGeometry,
  calculateResizeDimensions,
} from "./image-geometry";
import {
  MAX_IMAGE_HEADER_BYTES,
  parseEncodedImageDimensions,
} from "./image-header";
import {
  extractSafeMetadata,
  restoreSafeMetadata,
  type SafeImageMetadata,
} from "./metadata";
import type {
  Dimensions,
  ImageCapabilities,
  ImageFormat,
  ImageMimeType,
  ProcessedAsset,
  Workflow,
} from "./types";

export type ImageProcessingErrorCode =
  | "aborted"
  | "unsupported-environment"
  | "unsupported-format"
  | "corrupt-image"
  | "image-too-large"
  | "memory-pressure"
  | "invalid-workflow"
  | "conversion-failed"
  | "worker-failure";

export class ImageProcessingError extends Error {
  readonly code: ImageProcessingErrorCode;
  readonly recoverable: boolean;

  constructor(code: ImageProcessingErrorCode, message: string, recoverable = false) {
    super(message);
    this.name = code === "aborted" ? "AbortError" : "ImageProcessingError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export type ImageProcessStage =
  | "validating"
  | "decoding"
  | "transforming"
  | "encoding"
  | "metadata"
  | "complete";

export interface ImageProcessProgress {
  stage: ImageProcessStage;
  /** Whole number from 0 to 100. */
  progress: number;
}

export type ImageProcessProgressCallback = (progress: ImageProcessProgress) => void;

const MAX_INPUT_BYTES = 300 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 80_000_000;
const MAX_OUTPUT_PIXELS = 80_000_000;
const MAX_CANVAS_SIDE = 32_767;
const DEFAULT_QUALITY = 0.84;
const DEFAULT_JPEG_BACKGROUND = "#ffffff";

type ProcessingCanvas = HTMLCanvasElement | OffscreenCanvas;
type ProcessingSurface = ImageBitmap | ProcessingCanvas;

function isOffscreenCanvas(surface: ProcessingSurface): surface is OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined" && surface instanceof OffscreenCanvas;
}

function isHtmlCanvas(surface: ProcessingSurface): surface is HTMLCanvasElement {
  return typeof HTMLCanvasElement !== "undefined" && surface instanceof HTMLCanvasElement;
}

function isProcessingCanvas(surface: ProcessingSurface): surface is ProcessingCanvas {
  return isOffscreenCanvas(surface) || isHtmlCanvas(surface);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ImageProcessingError("aborted", "Image processing was cancelled.", true);
  }
}

function report(
  callback: ImageProcessProgressCallback | undefined,
  stage: ImageProcessStage,
  progress: number,
): void {
  callback?.({ stage, progress: Math.max(0, Math.min(100, Math.round(progress))) });
}

async function yieldToInterface(signal?: AbortSignal): Promise<void> {
  if (typeof document === "undefined") {
    throwIfAborted(signal);
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(signal);
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function assertSafeDimensions(dimensions: Dimensions, label: string): void {
  const { width, height } = dimensions;
  if (!validDimension(width) || !validDimension(height)) {
    throw new ImageProcessingError(
      "invalid-workflow",
      `${label} dimensions must be positive whole numbers.`,
    );
  }
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE) {
    throw new ImageProcessingError(
      "image-too-large",
      `${label} exceeds the browser canvas side limit (${MAX_CANVAS_SIDE}px).`,
    );
  }
  if (width * height > MAX_OUTPUT_PIXELS) {
    throw new ImageProcessingError(
      "image-too-large",
      `${label} would require more than ${MAX_OUTPUT_PIXELS.toLocaleString()} pixels.`,
    );
  }
}

function assertSafeSourceDimensions(dimensions: Dimensions): void {
  if (!validDimension(dimensions.width) || !validDimension(dimensions.height)) {
    throw new ImageProcessingError("corrupt-image", "The encoded image dimensions are invalid.");
  }
  if (
    dimensions.width > MAX_CANVAS_SIDE ||
    dimensions.height > MAX_CANVAS_SIDE ||
    dimensions.width * dimensions.height > MAX_SOURCE_PIXELS
  ) {
    throw new ImageProcessingError(
      "image-too-large",
      "The image dimensions are too large for reliable in-browser processing.",
    );
  }
}

function isMemoryPressureError(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.name === "QuotaExceededError" ||
    /(?:out of memory|not enough memory|memory allocation|allocation failed)/i.test(error.message)
  );
}

function isLikelyUndecodableFormat(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "EncodingError" ||
    error.name === "InvalidStateError" ||
    /(?:decode|decoder|encoded image|unsupported image|invalid image)/i.test(error.message)
  );
}

function createCanvas(dimensions: Dimensions): ProcessingCanvas {
  assertSafeDimensions(dimensions, "Output");
  // Prefer the DOM canvas on the main thread because its codec support may be
  // wider. Workers use OffscreenCanvas and never touch the document.
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(dimensions.width, dimensions.height);
  }
  throw new ImageProcessingError(
    "unsupported-environment",
    "This browser does not provide a canvas image processor.",
    true,
  );
}

function getContext(canvas: ProcessingCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d", {
    alpha: true,
    willReadFrequently: false,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) {
    throw new ImageProcessingError(
      "memory-pressure",
      "The browser could not allocate an image canvas. Try fewer or smaller images.",
      true,
    );
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

function releaseSurface(surface: ProcessingSurface | undefined): void {
  if (!surface) return;
  if (typeof ImageBitmap !== "undefined" && surface instanceof ImageBitmap) {
    surface.close();
    return;
  }
  // Shrinking releases the backing store; no Object URLs are created anywhere
  // in this engine.
  try {
    if (isOffscreenCanvas(surface)) {
      surface.width = 1;
      surface.height = 1;
      return;
    }
    if (isHtmlCanvas(surface)) {
      surface.width = 1;
      surface.height = 1;
    }
  } catch {
    // Some implementations may already have detached the surface.
  }
}

function drawToCanvas(
  source: ProcessingSurface,
  sourceDimensions: Dimensions,
  targetDimensions: Dimensions,
  sourceRect = { x: 0, y: 0, ...sourceDimensions },
  destinationRect = { x: 0, y: 0, ...targetDimensions },
  background?: string,
): ProcessingCanvas {
  const canvas = createCanvas(targetDimensions);
  const context = getContext(canvas);
  if (background) {
    context.save();
    context.fillStyle = background;
    context.fillRect(0, 0, targetDimensions.width, targetDimensions.height);
    context.restore();
  }
  try {
    context.drawImage(
      source as CanvasImageSource,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      destinationRect.x,
      destinationRect.y,
      destinationRect.width,
      destinationRect.height,
    );
  } catch (error) {
    releaseSurface(canvas);
    if (error instanceof RangeError) {
      throw new ImageProcessingError(
        "memory-pressure",
        "There was not enough memory to render this image.",
        true,
      );
    }
    throw new ImageProcessingError(
      "conversion-failed",
      error instanceof Error ? error.message : "The image could not be rendered.",
    );
  }
  return canvas;
}

function dimensionsOf(surface: ProcessingSurface): Dimensions {
  return { width: surface.width, height: surface.height };
}

async function encodeCanvas(
  canvas: ProcessingCanvas,
  format: ImageFormat,
  quality: number,
): Promise<Blob> {
  const mime = mimeForFormat(format);
  let blob: Blob | null;
  try {
    if (isOffscreenCanvas(canvas)) {
      blob = await canvas.convertToBlob({ type: mime, quality });
    } else {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    }
  } catch (error) {
    throw new ImageProcessingError(
      "conversion-failed",
      error instanceof Error ? error.message : `Could not encode ${format.toUpperCase()}.`,
      true,
    );
  }

  if (!blob || blob.size === 0) {
    throw new ImageProcessingError(
      "conversion-failed",
      `The ${format.toUpperCase()} encoder returned no data.`,
      true,
    );
  }
  if (normalizeImageMime(blob.type) !== mime) {
    // Canvas silently falls back to PNG for unsupported MIME types.
    throw new ImageProcessingError(
      "unsupported-format",
      `${format.toUpperCase()} encoding is not supported by this browser.`,
      true,
    );
  }
  return blob;
}

interface ResolvedWorkflow {
  format: ImageFormat;
  quality: number;
  background: string;
  keepMetadata: boolean;
  rename?: { template: string; startNumber: number; padding: number };
}

function resolveWorkflow(workflow: Workflow, sourceFormat: ImageFormat): ResolvedWorkflow {
  let format = sourceFormat;
  let quality = DEFAULT_QUALITY;
  let background = DEFAULT_JPEG_BACKGROUND;
  let keepMetadata = false;
  let rename: ResolvedWorkflow["rename"];

  for (const step of workflow.steps) {
    if (!step.enabled) continue;
    switch (step.type) {
      case "format":
        format = step.config.format;
        background = step.config.background || DEFAULT_JPEG_BACKGROUND;
        break;
      case "compress":
        if (!Number.isFinite(step.config.quality) || step.config.quality < 1 || step.config.quality > 100) {
          throw new ImageProcessingError(
            "invalid-workflow",
            "Compression quality must be between 1 and 100.",
          );
        }
        quality = step.config.quality / 100;
        break;
      case "metadata":
        keepMetadata = step.config.mode === "keep";
        break;
      case "rename":
        rename = step.config;
        break;
      default:
        break;
    }
  }
  return { format, quality, background, keepMetadata, rename };
}

function outputName(
  file: File,
  index: number,
  dimensions: Dimensions,
  resolved: ResolvedWorkflow,
): string {
  const rename = resolved.rename;
  return renderFilenameTemplate(
    rename?.template ?? "{name}.{format}",
    {
      name: file.name,
      number: (rename?.startNumber ?? 1) + index,
      width: dimensions.width,
      height: dimensions.height,
      format: resolved.format,
    },
    { numberPadding: rename?.padding ?? 1 },
  );
}

function sourceAssetId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function decodeFile(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    throw new ImageProcessingError(
      "unsupported-environment",
      "This browser does not support local image decoding.",
      true,
    );
  }
  try {
    return await createImageBitmap(file, {
      imageOrientation: "from-image",
      premultiplyAlpha: "default",
      colorSpaceConversion: "default",
    });
  } catch (error) {
    if (isMemoryPressureError(error)) {
      throw new ImageProcessingError(
        "memory-pressure",
        "The browser could not allocate enough memory to decode this image.",
        true,
      );
    }
    if (isLikelyUndecodableFormat(error)) {
      throw new ImageProcessingError(
        "corrupt-image",
        "The image is damaged or cannot be decoded by this browser.",
      );
    }
    // Browser codecs often reject allocation without a stable DOMException
    // name. Since the signature and dimensions already passed preflight, an
    // ambiguous decoder failure is safer and more actionable as recoverable
    // memory pressure than as a claim that the source file is corrupt.
    throw new ImageProcessingError(
      "memory-pressure",
      "The browser could not decode this image. Try closing other tabs or processing fewer images.",
      true,
    );
  }
}

/**
 * Processes one image entirely in the browser. `index` is zero-based and is
 * combined with a rename step's startNumber.
 */
export async function processImage(
  file: File,
  workflow: Workflow,
  index: number,
  capabilities?: ImageCapabilities,
  signal?: AbortSignal,
  onProgress?: ImageProcessProgressCallback,
): Promise<ProcessedAsset> {
  let surface: ProcessingSurface | undefined;
  let safeMetadata: SafeImageMetadata | undefined;

  try {
    throwIfAborted(signal);
    report(onProgress, "validating", 2);
    if (!(file instanceof Blob) || file.size === 0) {
      throw new ImageProcessingError("corrupt-image", "The selected file is empty.");
    }
    if (file.size > MAX_INPUT_BYTES) {
      throw new ImageProcessingError(
        "image-too-large",
        "This file is too large to process safely in the browser (300 MB maximum).",
      );
    }
    if (!Number.isInteger(index) || index < 0) {
      throw new ImageProcessingError("invalid-workflow", "Batch index must be zero or greater.");
    }

    const header = new Uint8Array(
      await file.slice(0, MAX_IMAGE_HEADER_BYTES).arrayBuffer(),
    );
    const sourceFormat = detectImageFormat(header);
    const declaredFormat = formatForMime(file.type);
    if (!sourceFormat) {
      throw new ImageProcessingError(
        "unsupported-format",
        "Only JPEG, PNG, WebP and AVIF images are supported.",
      );
    }
    if (declaredFormat && declaredFormat !== sourceFormat) {
      throw new ImageProcessingError(
        "corrupt-image",
        "The file contents do not match its declared image format.",
      );
    }

    // Reject dimensions available in the encoded header before a codec can
    // allocate hundreds of megabytes of decoded RGBA pixels.
    const encodedDimensions = parseEncodedImageDimensions(header, sourceFormat);
    if (encodedDimensions) assertSafeSourceDimensions(encodedDimensions);

    const sourceMime = mimeForFormat(sourceFormat);
    const resolved = resolveWorkflow(workflow, sourceFormat);
    if (capabilities && !capabilities[resolved.format].encode) {
      throw new ImageProcessingError(
        "unsupported-format",
        `${resolved.format.toUpperCase()} encoding is unavailable in this browser.`,
        true,
      );
    }

    if (resolved.keepMetadata) {
      safeMetadata = await extractSafeMetadata(file, sourceMime);
    }
    throwIfAborted(signal);
    report(onProgress, "decoding", 12);
    await yieldToInterface(signal);
    surface = await decodeFile(file);
    const decodedDimensions = dimensionsOf(surface);
    assertSafeSourceDimensions(decodedDimensions);

    const geometrySteps = workflow.steps.filter(
      (step) => step.enabled && (step.type === "resize" || step.type === "crop"),
    );
    let geometryIndex = 0;
    for (const step of workflow.steps) {
      if (!step.enabled || (step.type !== "resize" && step.type !== "crop")) continue;
      throwIfAborted(signal);
      const currentDimensions = dimensionsOf(surface);
      let next: ProcessingCanvas | undefined;

      if (step.type === "resize") {
        const target = calculateResizeDimensions(currentDimensions, step.config);
        assertSafeDimensions(target, "Resize");
        if (target.width !== currentDimensions.width || target.height !== currentDimensions.height) {
          next = drawToCanvas(surface, currentDimensions, target);
        }
      } else if (step.config.aspect !== "original") {
        const target = calculateCropOutputDimensions(currentDimensions, step.config);
        assertSafeDimensions(target, "Crop");
        const geometry = calculateFitGeometry(currentDimensions, target, step.config.fitMode);
        next = drawToCanvas(
          surface,
          currentDimensions,
          target,
          geometry.source,
          geometry.destination,
        );
      }

      if (next) {
        releaseSurface(surface);
        surface = next;
      }
      geometryIndex += 1;
      const geometryProgress = geometrySteps.length
        ? 20 + (geometryIndex / geometrySteps.length) * 48
        : 68;
      report(onProgress, "transforming", geometryProgress);
      await yieldToInterface(signal);
    }

    throwIfAborted(signal);
    const finalDimensions = dimensionsOf(surface);
    // A decoded bitmap must be painted before encoding. JPEG also gets an
    // explicit background so transparent pixels never turn black implicitly.
    if (!isProcessingCanvas(surface) || resolved.format === "jpeg") {
      const flattened = drawToCanvas(
        surface,
        finalDimensions,
        finalDimensions,
        undefined,
        undefined,
        resolved.format === "jpeg" ? resolved.background : undefined,
      );
      releaseSurface(surface);
      surface = flattened;
    }

    report(onProgress, "encoding", 76);
    const encoded = await encodeCanvas(
      surface as ProcessingCanvas,
      resolved.format,
      resolved.quality,
    );
    throwIfAborted(signal);
    report(onProgress, "metadata", 92);
    const metadataResult = resolved.keepMetadata
      ? await restoreSafeMetadata(encoded, safeMetadata)
      : { blob: encoded, preserved: false };
    throwIfAborted(signal);

    const mime = mimeForFormat(resolved.format);
    const result: ProcessedAsset = {
      assetId: sourceAssetId(file),
      blob: metadataResult.blob,
      name: outputName(file, index, finalDimensions, resolved),
      mime,
      width: finalDimensions.width,
      height: finalDimensions.height,
      size: metadataResult.blob.size,
      originalSize: file.size,
      metadataPreserved: metadataResult.preserved,
    };
    report(onProgress, "complete", 100);
    return result;
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new ImageProcessingError("aborted", "Image processing was cancelled.", true);
    }
    if (isMemoryPressureError(error)) {
      throw new ImageProcessingError(
        "memory-pressure",
        "The browser ran out of memory while processing this image.",
        true,
      );
    }
    throw new ImageProcessingError(
      "conversion-failed",
      error instanceof Error ? error.message : "Image conversion failed.",
      true,
    );
  } finally {
    releaseSurface(surface);
  }
}

export function imageMimeFromFile(file: File): ImageMimeType | undefined {
  return normalizeImageMime(file.type);
}
