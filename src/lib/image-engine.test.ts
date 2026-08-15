import { afterEach, describe, expect, it, vi } from "vitest";

import { processImage } from "./image-engine";
import type { Workflow } from "./types";

const workflow: Workflow = {
  version: 1,
  id: "engine-test",
  name: "Engine test",
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
  steps: [],
};

const be32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

class FakeImageBitmap {
  width: number;
  height: number;
  close = vi.fn();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

function installCanvasPipeline(options?: { encodedType?: string; encodedSize?: number }) {
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    fillStyle: "",
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  const encodedType = options?.encodedType;
  const encodedSize = options?.encodedSize ?? 64;
  const encodes: Array<{ type: string | undefined; quality: number | undefined }> = [];

  vi.stubGlobal("ImageBitmap", FakeImageBitmap);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue(new FakeImageBitmap(32, 16)),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback, type, quality) => {
      encodes.push({ type, quality: typeof quality === "number" ? quality : undefined });
      callback(
        new Blob([new Uint8Array(encodedSize).buffer], {
          type: encodedType ?? type,
        }),
      );
    },
  );

  return { context, encodes };
}

function pngFile(width: number, height: number): File {
  return new File(
    [
      Uint8Array.from([
        137, 80, 78, 71, 13, 10, 26, 10,
        0, 0, 0, 13, 73, 72, 68, 82,
        ...be32(width), ...be32(height), 8, 6, 0, 0, 0,
      ]).buffer,
    ],
    "input.png",
    { type: "image/png" },
  );
}

describe("processImage safety preflight", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects oversized encoded dimensions before invoking the decoder", async () => {
    const decoder = vi.fn();
    vi.stubGlobal("createImageBitmap", decoder);

    await expect(processImage(pngFile(20_000, 20_000), workflow, 0)).rejects.toMatchObject({
      code: "image-too-large",
    });
    expect(decoder).not.toHaveBeenCalled();
  });

  it("classifies decoder allocation failures as memory pressure", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new RangeError("Out of memory while allocating pixels")),
    );

    await expect(processImage(pngFile(32, 32), workflow, 0)).rejects.toMatchObject({
      code: "memory-pressure",
      recoverable: true,
    });
  });
});

describe("processImage conversion and compression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes the selected format and compression quality to the encoder", async () => {
    const { encodes } = installCanvasPipeline();
    const conversionWorkflow: Workflow = {
      ...workflow,
      steps: [
        {
          id: "resize",
          type: "resize",
          enabled: true,
          config: {
            mode: "long-side",
            longSide: 16,
            maintainAspectRatio: true,
            allowUpscale: false,
          },
        },
        {
          id: "format",
          type: "format",
          enabled: true,
          config: { format: "webp", background: "#ffffff" },
        },
        {
          id: "compress",
          type: "compress",
          enabled: true,
          config: { quality: 50 },
        },
        {
          id: "rename",
          type: "rename",
          enabled: true,
          config: {
            template: "asset_{width}x{height}.{format}",
            startNumber: 1,
            padding: 2,
          },
        },
      ],
    };

    const output = await processImage(pngFile(32, 16), conversionWorkflow, 0);

    expect(encodes).toEqual([{ type: "image/webp", quality: 0.5 }]);
    expect(output).toMatchObject({
      mime: "image/webp",
      width: 16,
      height: 8,
      size: 64,
      name: "asset_16x8.webp",
    });
  });

  it("composites the configured background before encoding transparent pixels as JPEG", async () => {
    const { context, encodes } = installCanvasPipeline({ encodedSize: 48 });
    const jpegWorkflow: Workflow = {
      ...workflow,
      steps: [
        {
          id: "format",
          type: "format",
          enabled: true,
          config: { format: "jpeg", background: "#123456" },
        },
        {
          id: "compress",
          type: "compress",
          enabled: true,
          config: { quality: 80 },
        },
      ],
    };

    const output = await processImage(pngFile(32, 16), jpegWorkflow, 0);

    expect(context.fillStyle).toBe("#123456");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 32, 16);
    expect(context.drawImage).toHaveBeenCalled();
    expect(encodes).toEqual([{ type: "image/jpeg", quality: 0.8 }]);
    expect(output).toMatchObject({ mime: "image/jpeg", size: 48 });
  });

  it("rejects a browser encoder that silently falls back to PNG", async () => {
    installCanvasPipeline({ encodedType: "image/png" });
    const unsupportedWorkflow: Workflow = {
      ...workflow,
      steps: [
        {
          id: "format",
          type: "format",
          enabled: true,
          config: { format: "webp", background: "#ffffff" },
        },
      ],
    };

    await expect(processImage(pngFile(32, 16), unsupportedWorkflow, 0)).rejects.toMatchObject({
      code: "unsupported-format",
      recoverable: true,
    });
  });
});
