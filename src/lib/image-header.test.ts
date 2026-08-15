import { describe, expect, it } from "vitest";

import { parseEncodedImageDimensions } from "./image-header";

const be32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const ascii = (value: string): number[] => [...value].map((character) => character.charCodeAt(0));

function box(type: string, payload: number[]): number[] {
  return [...be32(payload.length + 8), ...ascii(type), ...payload];
}

describe("parseEncodedImageDimensions", () => {
  it("reads PNG IHDR dimensions", () => {
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 13, ...ascii("IHDR"), ...be32(4096), ...be32(2160),
      8, 6, 0, 0, 0,
    ]);
    expect(parseEncodedImageDimensions(png)).toEqual({ width: 4096, height: 2160 });
  });

  it("skips JPEG metadata and reads a SOF segment", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, 0, 6, 1, 2, 3, 4,
      0xff, 0xc0, 0, 17, 8, 0x0b, 0xb8, 0x0f, 0xa0,
      3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
    ]);
    expect(parseEncodedImageDimensions(jpeg)).toEqual({ width: 4000, height: 3000 });
  });

  it("reads extended WebP canvas dimensions", () => {
    const widthMinusOne = 1919;
    const heightMinusOne = 1079;
    const webp = new Uint8Array([
      ...ascii("RIFF"), 30, 0, 0, 0, ...ascii("WEBP"),
      ...ascii("VP8X"), 10, 0, 0, 0,
      0, 0, 0, 0,
      widthMinusOne & 0xff, (widthMinusOne >>> 8) & 0xff, (widthMinusOne >>> 16) & 0xff,
      heightMinusOne & 0xff, (heightMinusOne >>> 8) & 0xff, (heightMinusOne >>> 16) & 0xff,
    ]);
    expect(parseEncodedImageDimensions(webp)).toEqual({ width: 1920, height: 1080 });
  });

  it("reads AVIF ispe dimensions inside meta/iprp/ipco", () => {
    const ftyp = box("ftyp", [...ascii("avif"), 0, 0, 0, 0, ...ascii("avif")]);
    const ispe = box("ispe", [0, 0, 0, 0, ...be32(3840), ...be32(2160)]);
    const ipco = box("ipco", ispe);
    const iprp = box("iprp", ipco);
    const meta = box("meta", [0, 0, 0, 0, ...iprp]);
    expect(parseEncodedImageDimensions(new Uint8Array([...ftyp, ...meta]))).toEqual({
      width: 3840,
      height: 2160,
    });
  });

  it("fails closed on truncated or malformed headers", () => {
    expect(parseEncodedImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeUndefined();
    expect(parseEncodedImageDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});
