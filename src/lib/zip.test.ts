import { describe, expect, it } from "vitest";

import type { ZipProgress } from "./types";
import { createStoredZip, crc32, normalizeZipEntryName } from "./zip";

const decoder = new TextDecoder();

function readLocalEntries(bytes: Uint8Array): Array<{ name: string; data: Uint8Array; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: Array<{ name: string; data: Uint8Array; crc: number }> = [];
  let cursor = 0;
  while (view.getUint32(cursor, true) === 0x04034b50) {
    expect(view.getUint16(cursor + 6, true) & 0x0800).toBe(0x0800);
    expect(view.getUint16(cursor + 8, true)).toBe(0);
    const crc = view.getUint32(cursor + 14, true);
    const size = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const extraLength = view.getUint16(cursor + 28, true);
    const nameStart = cursor + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      name: decoder.decode(bytes.slice(nameStart, nameStart + nameLength)),
      data: bytes.slice(dataStart, dataStart + size),
      crc,
    });
    cursor = dataStart + size;
  }
  expect(view.getUint32(cursor, true)).toBe(0x02014b50);
  return entries;
}

describe("crc32", () => {
  it("matches the canonical check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("createStoredZip", () => {
  it("writes UTF-8 stored entries with valid sizes and CRC values", async () => {
    const unicodeName = "products/\u5546\u54c1-01.webp";
    const zip = await createStoredZip([
      {
        name: unicodeName,
        data: new TextEncoder().encode("first image"),
        lastModified: new Date("2026-08-13T12:00:00"),
      },
      { name: "second.png", data: new Blob(["second image"]) },
    ]);
    expect(zip.type).toBe("application/zip");

    const entries = readLocalEntries(new Uint8Array(await zip.arrayBuffer()));
    expect(entries.map((entry) => entry.name)).toEqual([
      unicodeName,
      "second.png",
    ]);
    expect(decoder.decode(entries[0]!.data)).toBe("first image");
    expect(entries[0]!.crc).toBe(crc32(entries[0]!.data));
    expect(decoder.decode(entries[1]!.data)).toBe("second image");
    expect(entries[1]!.crc).toBe(crc32(entries[1]!.data));
  });

  it("creates a valid empty archive", async () => {
    const bytes = new Uint8Array(await (await createStoredZip([])).arrayBuffer());
    expect(bytes.byteLength).toBe(22);
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x06054b50);
  });

  it("reports monotonic chunk and completion progress", async () => {
    const reports: ZipProgress[] = [];
    const first = new TextEncoder().encode("0123456789");
    const second = new Blob(["abcde"]);

    await createStoredZip(
      [
        { name: "first.webp", data: first },
        { name: "second.png", data: second },
      ],
      {
        chunkSize: 3,
        yieldEveryBytes: 3,
        onProgress: (progress) => reports.push(progress),
      },
    );

    expect(reports[0]).toMatchObject({
      phase: "checksum",
      completedEntries: 0,
      processedBytes: 0,
      totalBytes: 15,
      totalEntries: 2,
    });
    expect(reports.some((report) => report.phase === "finalizing")).toBe(true);
    expect(reports.at(-1)).toMatchObject({
      phase: "complete",
      completedEntries: 2,
      processedBytes: 15,
      totalBytes: 15,
      totalEntries: 2,
    });

    const byteCounts = reports.map((report) => report.processedBytes);
    expect(byteCounts).toEqual([...byteCounts].sort((left, right) => left - right));
    expect(reports.filter((report) => report.phase === "checksum").length).toBeGreaterThan(4);
  });

  it("cancels during chunked CRC calculation", async () => {
    const controller = new AbortController();
    const reports: ZipProgress[] = [];
    const archive = createStoredZip(
      [{ name: "large.webp", data: new Uint8Array(64) }],
      {
        signal: controller.signal,
        chunkSize: 8,
        yieldEveryBytes: 8,
        onProgress: (progress) => {
          reports.push(progress);
          if (progress.processedBytes >= 8) controller.abort();
        },
      },
    );

    await expect(archive).rejects.toMatchObject({ name: "AbortError" });
    expect(reports.at(-1)?.processedBytes).toBe(8);
    expect(reports.some((report) => report.phase === "complete")).toBe(false);
  });

  it("rejects traversal and duplicate entry names", async () => {
    expect(() => normalizeZipEntryName("../secret.jpg")).toThrow(/traverse/);
    await expect(
      createStoredZip([
        { name: "Photo.webp", data: new Uint8Array() },
        { name: "photo.webp", data: new Uint8Array() },
      ]),
    ).rejects.toThrow(/Duplicate/);
  });
});
