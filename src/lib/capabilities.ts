import type {
  ImageCapabilities,
  ImageFormat,
  ImageMimeType,
} from "./types";
import { IMAGE_FORMATS } from "./types";

export const MIME_BY_FORMAT: Readonly<Record<ImageFormat, ImageMimeType>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

const FORMAT_BY_MIME: Readonly<Record<string, ImageFormat | undefined>> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/pjpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function mimeForFormat(format: ImageFormat): ImageMimeType {
  return MIME_BY_FORMAT[format];
}

export function formatForMime(mime: string): ImageFormat | undefined {
  return FORMAT_BY_MIME[mime.trim().toLowerCase()];
}

export function normalizeImageMime(mime: string): ImageMimeType | undefined {
  const format = formatForMime(mime);
  return format ? MIME_BY_FORMAT[format] : undefined;
}

export function isSupportedImageMime(mime: string): mime is ImageMimeType {
  return normalizeImageMime(mime) !== undefined;
}

const hasAscii = (bytes: Uint8Array, offset: number, value: string): boolean =>
  [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

/** Detects supported formats by magic bytes instead of trusting a file extension. */
export function detectImageFormat(input: ArrayBuffer | Uint8Array): ImageFormat | undefined {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    hasAscii(bytes, 1, "PNG") &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    hasAscii(bytes, 0, "RIFF") &&
    hasAscii(bytes, 8, "WEBP")
  ) {
    return "webp";
  }

  // AVIF is an ISO BMFF file. Accept avif/avis as either the major or a
  // compatible brand, but do not mistake generic HEIF files for AVIF.
  if (bytes.length >= 16 && hasAscii(bytes, 4, "ftyp")) {
    const brandEnd = Math.min(bytes.length, 64);
    for (let offset = 8; offset + 4 <= brandEnd; offset += 4) {
      if (hasAscii(bytes, offset, "avif") || hasAscii(bytes, offset, "avis")) {
        return "avif";
      }
    }
  }
  return undefined;
}

interface EncodableCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  convertToBlob?: (options?: ImageEncodeOptions) => Promise<Blob>;
  toBlob?: (
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) => void;
}

function createProbeCanvas(): EncodableCanvas | undefined {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(2, 2);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    return canvas;
  }
  return undefined;
}

async function encodeProbe(format: ImageFormat): Promise<Blob | undefined> {
  const canvas = createProbeCanvas();
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return undefined;
  context.fillStyle = "#ff3b30";
  context.fillRect(0, 0, 1, 2);
  context.fillStyle = "#007aff";
  context.fillRect(1, 0, 1, 2);

  const requestedMime = mimeForFormat(format);
  try {
    let blob: Blob | null;
    if (canvas.convertToBlob) {
      blob = await canvas.convertToBlob({ type: requestedMime, quality: 0.8 });
    } else if (canvas.toBlob) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob?.(resolve, requestedMime, 0.8),
      );
    } else {
      return undefined;
    }
    return blob && normalizeImageMime(blob.type) === requestedMime ? blob : undefined;
  } catch {
    return undefined;
  }
}

async function canDecodeBlob(blob: Blob): Promise<boolean> {
  if (typeof createImageBitmap !== "function") return false;
  try {
    const bitmap = await createImageBitmap(blob);
    const valid = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    return valid;
  } catch {
    return false;
  }
}

interface ImageDecoderConstructorLike {
  isTypeSupported?: (type: string) => Promise<boolean>;
}

async function webCodecsDecodeSupport(mime: ImageMimeType): Promise<boolean | undefined> {
  const decoder = (globalThis as typeof globalThis & { ImageDecoder?: ImageDecoderConstructorLike })
    .ImageDecoder;
  if (!decoder?.isTypeSupported) return undefined;
  try {
    return await decoder.isTypeSupported(mime);
  } catch {
    return undefined;
  }
}

async function probeOneFormat(format: ImageFormat): Promise<{ decode: boolean; encode: boolean }> {
  const encoded = await encodeProbe(format);
  const encode = encoded !== undefined;
  const decodedProbe = encoded ? await canDecodeBlob(encoded) : false;
  const webCodecs = await webCodecsDecodeSupport(mimeForFormat(format));

  // JPEG and PNG are baseline canvas formats. For the optional formats, only
  // advertise decoding after an actual round trip or a WebCodecs query.
  const baselineDecode =
    typeof createImageBitmap === "function" && (format === "jpeg" || format === "png");
  return {
    decode: decodedProbe || webCodecs === true || baselineDecode,
    encode,
  };
}

let cachedCapabilities: Promise<ImageCapabilities> | undefined;

export interface CapabilityProbeOptions {
  forceRefresh?: boolean;
}

/** Performs real canvas encoder probes; unsupported encoders often return PNG. */
export function probeImageCapabilities(
  options: CapabilityProbeOptions = {},
): Promise<ImageCapabilities> {
  if (!options.forceRefresh && cachedCapabilities) return cachedCapabilities;

  cachedCapabilities = Promise.all(
    IMAGE_FORMATS.map(async (format) => [format, await probeOneFormat(format)] as const),
  ).then((entries) => Object.fromEntries(entries) as ImageCapabilities);
  return cachedCapabilities;
}

/** Exact per-file decoder check used when a conservative capability probe is false. */
export async function canDecodeImage(source: Blob): Promise<boolean> {
  return canDecodeBlob(source);
}

export function supportsWorkerImageProcessing(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function"
  );
}

/** A conservative pool size that leaves cores and memory for the interface. */
export function getRecommendedWorkerCount(): number {
  if (typeof navigator === "undefined") return 1;
  const logicalCores = Math.max(1, navigator.hardwareConcurrency || 2);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cpuBound = Math.max(1, Math.floor(logicalCores / 2));
  const memoryBound =
    memory !== undefined && memory <= 2 ? 1 : memory !== undefined && memory <= 4 ? 2 : 4;
  return Math.min(4, memoryBound, cpuBound);
}

/** Test helper; applications should use forceRefresh instead. */
export function clearCapabilityProbeCache(): void {
  cachedCapabilities = undefined;
}
