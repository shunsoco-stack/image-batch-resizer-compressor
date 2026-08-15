import { detectImageFormat } from "./capabilities";
import type { Dimensions, ImageFormat } from "./types";

/** Header bytes inspected before asking a browser codec to allocate pixels. */
export const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;

const asciiAt = (bytes: Uint8Array, offset: number, value: string): boolean => {
  if (offset < 0 || offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
};

const uint16Be = (bytes: Uint8Array, offset: number): number | undefined =>
  offset + 2 <= bytes.length ? (bytes[offset] << 8) | bytes[offset + 1] : undefined;

const uint16Le = (bytes: Uint8Array, offset: number): number | undefined =>
  offset + 2 <= bytes.length ? bytes[offset] | (bytes[offset + 1] << 8) : undefined;

const uint24Le = (bytes: Uint8Array, offset: number): number | undefined =>
  offset + 3 <= bytes.length
    ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
    : undefined;

const uint32Be = (bytes: Uint8Array, offset: number): number | undefined => {
  if (offset + 4 > bytes.length) return undefined;
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
};

const uint32Le = (bytes: Uint8Array, offset: number): number | undefined => {
  if (offset + 4 > bytes.length) return undefined;
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
};

function dimensions(width: number | undefined, height: number | undefined): Dimensions | undefined {
  if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    return undefined;
  }
  return { width, height };
}

function pngDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (!asciiAt(bytes, 1, "PNG") || !asciiAt(bytes, 12, "IHDR")) return undefined;
  return dimensions(uint32Be(bytes, 16), uint32Be(bytes, 20));
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function jpegDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let cursor = 2;
  while (cursor + 1 < bytes.length) {
    if (bytes[cursor] !== 0xff) return undefined;
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    if (cursor >= bytes.length) return undefined;
    const marker = bytes[cursor++];
    if (marker === 0xda || marker === 0xd9) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;

    const segmentLength = uint16Be(bytes, cursor);
    if (segmentLength === undefined || segmentLength < 2) return undefined;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7 || cursor + segmentLength > bytes.length) return undefined;
      return dimensions(uint16Be(bytes, cursor + 5), uint16Be(bytes, cursor + 3));
    }
    cursor += segmentLength;
  }
  return undefined;
}

function webpDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (!asciiAt(bytes, 0, "RIFF") || !asciiAt(bytes, 8, "WEBP")) return undefined;
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(cursor, cursor + 4));
    const chunkLength = uint32Le(bytes, cursor + 4);
    if (chunkLength === undefined) return undefined;
    const payload = cursor + 8;

    if (type === "VP8X" && chunkLength >= 10 && payload + 10 <= bytes.length) {
      const widthMinusOne = uint24Le(bytes, payload + 4);
      const heightMinusOne = uint24Le(bytes, payload + 7);
      return dimensions(
        widthMinusOne === undefined ? undefined : widthMinusOne + 1,
        heightMinusOne === undefined ? undefined : heightMinusOne + 1,
      );
    }
    if (
      type === "VP8 " &&
      chunkLength >= 10 &&
      payload + 10 <= bytes.length &&
      bytes[payload + 3] === 0x9d &&
      bytes[payload + 4] === 0x01 &&
      bytes[payload + 5] === 0x2a
    ) {
      const rawWidth = uint16Le(bytes, payload + 6);
      const rawHeight = uint16Le(bytes, payload + 8);
      return dimensions(
        rawWidth === undefined ? undefined : rawWidth & 0x3fff,
        rawHeight === undefined ? undefined : rawHeight & 0x3fff,
      );
    }
    if (type === "VP8L" && chunkLength >= 5 && payload + 5 <= bytes.length) {
      if (bytes[payload] !== 0x2f) return undefined;
      const b0 = bytes[payload + 1];
      const b1 = bytes[payload + 2];
      const b2 = bytes[payload + 3];
      const b3 = bytes[payload + 4];
      return dimensions(
        1 + b0 + ((b1 & 0x3f) << 8),
        1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
      );
    }

    const paddedLength = chunkLength + (chunkLength & 1);
    const next = payload + paddedLength;
    if (next <= cursor || next > bytes.length) return undefined;
    cursor = next;
  }
  return undefined;
}

const AVIF_CONTAINER_BOXES = new Set(["meta", "iprp", "ipco"]);

interface IsoBox {
  type: string;
  payloadStart: number;
  end: number;
}

function isoBoxAt(bytes: Uint8Array, offset: number, parentEnd: number): IsoBox | undefined {
  if (offset + 8 > parentEnd || offset + 8 > bytes.length) return undefined;
  const size32 = uint32Be(bytes, offset);
  if (size32 === undefined) return undefined;
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    if (offset + 16 > bytes.length) return undefined;
    const high = uint32Be(bytes, offset + 8);
    const low = uint32Be(bytes, offset + 12);
    if (high === undefined || low === undefined || high > 0x1fffff) return undefined;
    size = high * 0x1_0000_0000 + low;
    headerSize = 16;
  } else if (size32 === 0) {
    size = parentEnd - offset;
  }
  if (size < headerSize || !Number.isSafeInteger(size)) return undefined;
  const declaredEnd = offset + size;
  if (declaredEnd <= offset || declaredEnd > parentEnd) return undefined;
  return {
    type,
    payloadStart: offset + headerSize,
    end: declaredEnd,
  };
}

function avifDimensions(bytes: Uint8Array): Dimensions | undefined {
  const candidates: Dimensions[] = [];

  const visitBoxes = (start: number, end: number, depth: number): void => {
    if (depth > 4) return;
    let cursor = start;
    while (cursor + 8 <= end && cursor + 8 <= bytes.length) {
      const box = isoBoxAt(bytes, cursor, end);
      if (!box) return;
      if (box.type === "ispe" && box.payloadStart + 12 <= box.end) {
        // ispe is a FullBox: version/flags followed by width and height.
        const candidate = dimensions(
          uint32Be(bytes, box.payloadStart + 4),
          uint32Be(bytes, box.payloadStart + 8),
        );
        if (candidate) candidates.push(candidate);
      } else if (AVIF_CONTAINER_BOXES.has(box.type)) {
        const childStart = box.payloadStart + (box.type === "meta" ? 4 : 0);
        if (childStart <= box.end) visitBoxes(childStart, box.end, depth + 1);
      }
      cursor = box.end;
    }
  };

  visitBoxes(0, bytes.length, 0);
  if (candidates.length === 0) return undefined;
  // Multiple items can carry ispe properties. The largest one is the safest
  // pre-decode allocation guard even if primary-item associations are complex.
  return candidates.reduce((largest, candidate) =>
    candidate.width * candidate.height > largest.width * largest.height ? candidate : largest,
  );
}

/**
 * Reads encoded dimensions without invoking a browser image decoder. Undefined
 * means the bounded header did not contain enough safely parseable information;
 * callers must still validate dimensions returned by the real decoder.
 */
export function parseEncodedImageDimensions(
  input: ArrayBuffer | Uint8Array,
  format?: ImageFormat,
): Dimensions | undefined {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const resolvedFormat = format ?? detectImageFormat(bytes);
  switch (resolvedFormat) {
    case "jpeg":
      return jpegDimensions(bytes);
    case "png":
      return pngDimensions(bytes);
    case "webp":
      return webpDimensions(bytes);
    case "avif":
      return avifDimensions(bytes);
    default:
      return undefined;
  }
}

export async function inspectEncodedImageDimensions(source: Blob): Promise<Dimensions | undefined> {
  const header = source.slice(0, MAX_IMAGE_HEADER_BYTES);
  return parseEncodedImageDimensions(await header.arrayBuffer());
}

export async function inspectEncodedImageDimensionsForFormat(
  source: Blob,
  format: ImageFormat,
): Promise<Dimensions | undefined> {
  const header = source.slice(0, MAX_IMAGE_HEADER_BYTES);
  return parseEncodedImageDimensions(await header.arrayBuffer(), format);
}
