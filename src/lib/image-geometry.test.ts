import { describe, expect, it } from "vitest";

import {
  assertSupportedFitMode,
  calculateCropRect,
  calculateFitGeometry,
  calculateResizeDimensions,
  ImageGeometryError,
} from "./image-geometry";

const landscape = { width: 4000, height: 3000 };

describe("calculateResizeDimensions", () => {
  it.each([
    ["width", { mode: "width", width: 1600 }, { width: 1600, height: 1200 }],
    ["height", { mode: "height", height: 900 }, { width: 1200, height: 900 }],
    ["percentage", { mode: "percentage", percentage: 25 }, { width: 1000, height: 750 }],
    ["long side", { mode: "long-side", longSide: 2000 }, { width: 2000, height: 1500 }],
    ["short side", { mode: "short-side", shortSide: 1200 }, { width: 1600, height: 1200 }],
  ] as const)("resizes by %s", (_label, config, expected) => {
    expect(
      calculateResizeDimensions(landscape, {
        ...config,
        maintainAspectRatio: true,
      }),
    ).toEqual(expected);
  });

  it("fits both dimensions while maintaining aspect ratio", () => {
    expect(
      calculateResizeDimensions(landscape, {
        mode: "dimensions",
        width: 1000,
        height: 1000,
        maintainAspectRatio: true,
      }),
    ).toEqual({ width: 1000, height: 750 });
  });

  it("does not upscale when disabled", () => {
    expect(
      calculateResizeDimensions({ width: 640, height: 480 }, {
        mode: "width",
        width: 1600,
        maintainAspectRatio: true,
        allowUpscale: false,
      }),
    ).toEqual({ width: 640, height: 480 });
  });

  it("rejects stretch and invalid values", () => {
    expect(() =>
      calculateResizeDimensions(landscape, {
        mode: "dimensions",
        width: 1000,
        height: 1000,
        maintainAspectRatio: false,
      }),
    ).toThrow(/Stretch/);
    expect(() =>
      calculateResizeDimensions(landscape, {
        mode: "percentage",
        percentage: 0,
        maintainAspectRatio: true,
      }),
    ).toThrow(ImageGeometryError);
  });
});

describe("crop and fit geometry", () => {
  it("returns the complete rectangle for Original", () => {
    expect(
      calculateCropRect(landscape, { aspect: "original", fitMode: "cover" }),
    ).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
  });

  it.each([
    ["1:1", 3000, 3000, 500, 0],
    ["4:3", 4000, 3000, 0, 0],
    ["16:9", 4000, 2250, 0, 375],
  ] as const)("calculates a centered %s crop", (aspect, width, height, x, y) => {
    expect(calculateCropRect(landscape, { aspect, fitMode: "cover" })).toEqual({
      x,
      y,
      width,
      height,
    });
  });

  it("supports a custom ratio", () => {
    const crop = calculateCropRect(landscape, {
      aspect: "custom",
      customWidth: 2,
      customHeight: 3,
      fitMode: "cover",
    });
    expect(crop).toEqual({ x: 1000, y: 0, width: 2000, height: 3000 });
  });

  it("uses source cropping for cover", () => {
    expect(calculateFitGeometry(landscape, { width: 1000, height: 1000 }, "cover")).toEqual({
      source: { x: 500, y: 0, width: 3000, height: 3000 },
      destination: { x: 0, y: 0, width: 1000, height: 1000 },
    });
  });

  it("centers letterboxing for contain", () => {
    expect(calculateFitGeometry(landscape, { width: 1000, height: 1000 }, "contain")).toEqual({
      source: { x: 0, y: 0, width: 4000, height: 3000 },
      destination: { x: 0, y: 125, width: 1000, height: 750 },
    });
  });

  it("rejects stretch at runtime", () => {
    expect(() => assertSupportedFitMode("stretch")).toThrow(/disabled/);
  });
});
