import { describe, expect, it } from "vitest";

import {
  assertValidFilenameTemplate,
  ensureUniqueFilename,
  filenameStem,
  renderFilenameTemplate,
  renderUniqueFilenames,
  sanitizeFilename,
} from "./filename-template";

const context = {
  name: "my product.JPG",
  number: 7,
  width: 1600,
  height: 1200,
  format: "webp" as const,
};

describe("filename templates", () => {
  it("renders all supported tokens and normalizes the output extension", () => {
    expect(
      renderFilenameTemplate("{name}_{number}_{width}x{height}.{format}", context, {
        numberPadding: 3,
      }),
    ).toBe("my product_007_1600x1200.webp");
  });

  it("adds an extension and maps JPEG to jpg", () => {
    expect(
      renderFilenameTemplate("product_{number}", { ...context, format: "jpeg" }),
    ).toBe("product_7.jpg");
  });

  it("replaces a conflicting literal image extension with the actual format", () => {
    expect(renderFilenameTemplate("product.png", context)).toBe("product.webp");
  });

  it("retains dots from the original stem", () => {
    expect(renderFilenameTemplate("{name}", { ...context, name: "catalog.v2.png" })).toBe(
      "catalog.v2.webp",
    );
  });

  it("rejects unknown tokens and malformed braces", () => {
    expect(() => assertValidFilenameTemplate("{counter}")) .toThrow(/Unknown/);
    expect(() => assertValidFilenameTemplate("{name")) .toThrow(/brace/);
  });
});

describe("filename safety and collisions", () => {
  it("removes paths, forbidden characters, trailing dots and reserved names", () => {
    expect(filenameStem("folder\\photo.jpeg")).toBe("photo");
    expect(sanitizeFilename("bad/<name>?.webp... ")).toBe("bad-name-.webp");
    expect(sanitizeFilename("CON.jpg")).toBe("_CON.jpg");
  });

  it("keeps extensions when truncating", () => {
    expect(sanitizeFilename(`${"a".repeat(100)}.webp`, 20)).toBe("aaaaaaaaaaaaaaa.webp");
  });

  it("avoids case-insensitive filename collisions", () => {
    expect(ensureUniqueFilename("PHOTO.webp", ["photo.webp", "photo-2.webp"])).toBe(
      "PHOTO-3.webp",
    );
  });

  it("allocates unique names for a whole batch", () => {
    const filenames = renderUniqueFilenames(
      "product",
      [context, { ...context, number: 8 }, { ...context, number: 9 }],
    );
    expect(filenames).toEqual(["product.webp", "product-2.webp", "product-3.webp"]);
  });
});
