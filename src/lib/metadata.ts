import type { ImageMimeType } from "./types";

/**
 * Canvas encoding is a metadata trust boundary. Browsers can colour-convert
 * pixels while decoding or drawing, so attaching the source ICC/gAMA/cHRM data
 * to the newly encoded samples could describe them incorrectly. Source
 * metadata is therefore never carried across the boundary, even when the
 * workflow requested metadata preservation.
 */
export interface SafeImageMetadata {
  mime: ImageMimeType;
  /** Human-readable description suitable for a privacy hint in the UI. */
  policy: "strip-all-source-metadata";
}

export interface MetadataRestoreResult {
  blob: Blob;
  preserved: boolean;
}

const JPEG_SOI = [0xff, 0xd8] as const;
const MAX_CHUNKS = 256;

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

function hasPrefix(bytes: Uint8Array, prefix: ArrayLike<number>): boolean {
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

interface JpegSegment {
  marker: number;
  start: number;
  end: number;
  payloadStart: number;
}

/** Parses header segments only and never scans compressed pixel data. */
function jpegHeaderSegments(bytes: Uint8Array): JpegSegment[] {
  if (!hasPrefix(bytes, JPEG_SOI)) return [];

  const segments: JpegSegment[] = [];
  let cursor = 2;
  while (cursor + 1 < bytes.length && segments.length < MAX_CHUNKS) {
    if (bytes[cursor] !== 0xff) break;
    const start = cursor;
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    if (cursor >= bytes.length) break;
    const marker = bytes[cursor];
    cursor += 1;

    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, start, end: cursor, payloadStart: cursor });
      continue;
    }
    if (cursor + 1 >= bytes.length) break;
    const declaredLength = (bytes[cursor] << 8) | bytes[cursor + 1];
    if (declaredLength < 2) break;
    const end = cursor + declaredLength;
    if (end > bytes.length) break;
    segments.push({ marker, start, end, payloadStart: cursor + 2 });
    cursor = end;
  }
  return segments;
}

export function hasExifMetadata(bytes: Uint8Array): boolean {
  return jpegHeaderSegments(bytes).some(
    (segment) =>
      segment.marker === 0xe1 &&
      segment.end - segment.payloadStart >= 6 &&
      ascii(bytes, segment.payloadStart, 6) === "Exif\0\0",
  );
}

/** Removes privacy-bearing JPEG APP1/APP13 segments without decoding pixels. */
export function stripJpegPrivateMetadata(bytes: Uint8Array): Uint8Array {
  if (!hasPrefix(bytes, JPEG_SOI)) return bytes.slice();
  const privateSegments = jpegHeaderSegments(bytes).filter(
    (segment) => segment.marker === 0xe1 || segment.marker === 0xed,
  );
  if (privateSegments.length === 0) return bytes.slice();

  const parts: Uint8Array[] = [];
  let cursor = 0;
  for (const segment of privateSegments) {
    parts.push(bytes.subarray(cursor, segment.start));
    cursor = segment.end;
  }
  parts.push(bytes.subarray(cursor));
  return concatBytes(parts);
}

export function extractSafeMetadata(
  source: Blob,
  mime: ImageMimeType,
): Promise<SafeImageMetadata> {
  // Keep this asynchronous API for callers, but deliberately do not slice or
  // read the source Blob. Besides avoiding an OOM-prone copy for large files,
  // there is no source metadata that is safe to reattach after Canvas encoding.
  void source;
  return Promise.resolve({ mime, policy: "strip-all-source-metadata" });
}

export function restoreSafeMetadata(
  encoded: Blob,
  metadata: SafeImageMetadata | undefined,
): Promise<MetadataRestoreResult> {
  // Returning the exact encoded Blob avoids a full read + concatenation + copy
  // at the end of every job. `preserved` is truthful for every format/request.
  void metadata;
  return Promise.resolve({ blob: encoded, preserved: false });
}
