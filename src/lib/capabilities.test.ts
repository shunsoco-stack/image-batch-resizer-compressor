import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearCapabilityProbeCache,
  canDecodeImage,
  detectImageFormat,
  formatForMime,
  getRecommendedWorkerCount,
  mimeForFormat,
  normalizeImageMime,
} from "./capabilities";

describe("image format detection", () => {
  it.each([
    ["jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
    ["png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    ["webp", new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])],
    [
      "avif",
      new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0]),
    ],
  ] as const)("recognizes %s magic bytes", (format, bytes) => {
    expect(detectImageFormat(bytes)).toBe(format);
  });

  it("does not trust arbitrary bytes", () => {
    expect(detectImageFormat(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it("normalizes MIME aliases without changing output MIME", () => {
    expect(formatForMime("IMAGE/JPG")).toBe("jpeg");
    expect(normalizeImageMime("image/pjpeg")).toBe("image/jpeg");
    expect(mimeForFormat("avif")).toBe("image/avif");
  });
});

describe("worker recommendation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCapabilityProbeCache();
  });

  it("keeps one core available and caps parallel work", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 16, deviceMemory: 16 });
    expect(getRecommendedWorkerCount()).toBe(4);
  });

  it("limits low-memory devices", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 2 });
    expect(getRecommendedWorkerCount()).toBe(1);
  });
});

describe("per-file decoder fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a decodable file independently of encoder support", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 32, height: 24, close }),
    );
    const file = new Blob([Uint8Array.from([1, 2, 3]).buffer], { type: "image/avif" });

    await expect(canDecodeImage(file)).resolves.toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});
