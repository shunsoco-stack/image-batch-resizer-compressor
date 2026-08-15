import { describe, expect, it, vi } from "vitest";

import {
  extractSafeMetadata,
  hasExifMetadata,
  restoreSafeMetadata,
  stripJpegPrivateMetadata,
} from "./metadata";

function jpegSegment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

const asciiBytes = (value: string): number[] => [...value].map((value) => value.charCodeAt(0));

function fakeJpeg(): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...jpegSegment(0xe1, [...asciiBytes("Exif\0\0"), 1, 2, 3]),
    ...jpegSegment(0xe2, [...asciiBytes("ICC_PROFILE\0"), 1, 1, 4, 5]),
    ...jpegSegment(0xed, [...asciiBytes("Photoshop 3.0"), 9, 9]),
    ...jpegSegment(0xdb, [1, 2, 3]),
    0xff,
    0xda,
    0,
    2,
    7,
    8,
    0xff,
    0xd9,
  ]);
}

describe("privacy-safe image metadata", () => {
  it("detects and strips EXIF/IPTC while retaining image data", () => {
    const source = fakeJpeg();
    expect(hasExifMetadata(source)).toBe(true);
    const stripped = stripJpegPrivateMetadata(source);
    expect(hasExifMetadata(stripped)).toBe(false);
    expect(new TextDecoder().decode(stripped)).not.toContain("Photoshop");
    expect(new TextDecoder().decode(stripped)).toContain("ICC_PROFILE");
    expect([...stripped.slice(-4)]).toEqual([7, 8, 0xff, 0xd9]);
  });

  it("treats keep as privacy-first without reading or retaining source metadata", async () => {
    const source = new Blob([Uint8Array.from(fakeJpeg()).buffer], { type: "image/jpeg" });
    const sourceSlice = vi.spyOn(source, "slice");
    const sourceRead = vi.spyOn(source, "arrayBuffer");

    const metadata = await extractSafeMetadata(source, "image/jpeg");
    expect(metadata).toEqual({
      mime: "image/jpeg",
      policy: "strip-all-source-metadata",
    });
    expect(sourceSlice).not.toHaveBeenCalled();
    expect(sourceRead).not.toHaveBeenCalled();

    const encoded = new Blob(
      [Uint8Array.from([0xff, 0xd8, ...jpegSegment(0xdb, [1]), 0xff, 0xda, 0, 2, 4, 0xff, 0xd9]).buffer],
      { type: "image/jpeg" },
    );
    const encodedRead = vi.spyOn(encoded, "arrayBuffer");
    const restored = await restoreSafeMetadata(encoded, metadata);
    expect(restored).toEqual({ blob: encoded, preserved: false });
    expect(restored.blob).toBe(encoded);
    expect(encodedRead).not.toHaveBeenCalled();
  });

  it("does not read or copy the encoded blob even when no metadata was requested", async () => {
    const output = new Blob([Uint8Array.from([1, 2]).buffer], { type: "image/webp" });
    const outputRead = vi.spyOn(output, "arrayBuffer");

    const restored = await restoreSafeMetadata(output, undefined);
    expect(restored).toEqual({ blob: output, preserved: false });
    expect(restored.blob).toBe(output);
    expect(outputRead).not.toHaveBeenCalled();
  });
});
