import type { ZipEntry, ZipOptions, ZipProgress } from "./types";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;
const DEFAULT_YIELD_EVERY_BYTES = 8 * 1024 * 1024;
const YIELD_EVERY_ENTRIES = 16;

let crcTable: Uint32Array | undefined;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function updateCrc32(state: number, data: Uint8Array): number {
  const table = getCrcTable();
  let crc = state;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0;
}

export function crc32(data: Uint8Array): number {
  return (updateCrc32(0xffffffff, data) ^ 0xffffffff) >>> 0;
}

function setUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function setUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function toDosDateTime(input: Date): { date: number; time: number } {
  const date = Number.isNaN(input.getTime()) ? new Date(0) : input;
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function isBlobData(data: ZipEntry["data"]): data is Blob {
  return (
    typeof data === "object" &&
    data !== null &&
    "size" in data &&
    typeof data.size === "number" &&
    "slice" in data &&
    typeof data.slice === "function" &&
    "arrayBuffer" in data &&
    typeof data.arrayBuffer === "function"
  );
}

function dataByteLength(data: ZipEntry["data"]): number {
  return isBlobData(data) ? data.size : data.byteLength;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(
    typeof signal.reason === "string" ? signal.reason : "ZIP creation was aborted.",
  );
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function emitProgress(options: ZipOptions, progress: ZipProgress): void {
  throwIfAborted(options.signal);
  options.onProgress?.(progress);
  // A consumer may synchronously cancel from inside its progress callback.
  throwIfAborted(options.signal);
}

function positiveIntegerOption(
  value: number | undefined,
  fallback: number,
  label: string,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new Error(`${label} must be a positive integer no greater than ${maximum}.`);
  }
  return resolved;
}

async function yieldToBrowser(): Promise<void> {
  const browserGlobal = globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  };
  if (typeof browserGlobal.scheduler?.yield === "function") {
    await browserGlobal.scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

interface YieldState {
  bytes: number;
  entries: number;
}

async function yieldIfNeeded(
  state: YieldState,
  yieldEveryBytes: number,
  signal?: AbortSignal,
): Promise<void> {
  if (state.bytes < yieldEveryBytes && state.entries < YIELD_EVERY_ENTRIES) return;
  state.bytes = 0;
  state.entries = 0;
  await yieldToBrowser();
  throwIfAborted(signal);
}

async function readChunk(
  data: ZipEntry["data"],
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (isBlobData(data)) {
    return new Uint8Array(await data.slice(offset, offset + length).arrayBuffer());
  }
  // ArrayBuffer.isView works across realms, unlike instanceof Uint8Array.
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset + offset, length);
  }
  return new Uint8Array(data, offset, length);
}

async function checksumData(
  data: ZipEntry["data"],
  chunkSize: number,
  signal: AbortSignal | undefined,
  onChunk: (byteLength: number) => Promise<void>,
): Promise<number> {
  const size = dataByteLength(data);
  let state = 0xffffffff;
  for (let offset = 0; offset < size; offset += chunkSize) {
    throwIfAborted(signal);
    const length = Math.min(chunkSize, size - offset);
    const chunk = await readChunk(data, offset, length);
    throwIfAborted(signal);
    state = updateCrc32(state, chunk);
    await onChunk(chunk.byteLength);
  }
  return (state ^ 0xffffffff) >>> 0;
}

export function normalizeZipEntryName(name: string): string {
  if (!name.trim()) throw new Error("ZIP entry name cannot be empty.");
  const slashName = name.replace(/\\/g, "/");
  if (slashName.startsWith("/") || /^[a-z]:\//i.test(slashName)) {
    throw new Error(`ZIP entry must be relative: ${name}`);
  }

  const segments: string[] = [];
  for (const segment of slashName.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      throw new Error(`ZIP entry cannot traverse parent directories: ${name}`);
    }
    const safe = segment.replace(/[\u0000-\u001f\u007f:]/g, "-").trim();
    if (safe) segments.push(safe);
  }
  if (segments.length === 0) throw new Error("ZIP entry name cannot be empty.");
  return segments.join("/");
}

interface PreparedEntry {
  name: string;
  nameBytes: Uint8Array;
  data: ZipEntry["data"];
  size: number;
  crc: number;
  date: number;
  time: number;
  offset: number;
}

function localFileHeader(entry: PreparedEntry): Uint8Array {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  setUint32(view, 0, LOCAL_FILE_HEADER_SIGNATURE);
  setUint16(view, 4, 20);
  setUint16(view, 6, UTF8_FLAG);
  setUint16(view, 8, 0);
  setUint16(view, 10, entry.time);
  setUint16(view, 12, entry.date);
  setUint32(view, 14, entry.crc);
  setUint32(view, 18, entry.size);
  setUint32(view, 22, entry.size);
  setUint16(view, 26, entry.nameBytes.byteLength);
  setUint16(view, 28, 0);
  return header;
}

function centralDirectoryHeader(entry: PreparedEntry): Uint8Array {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  setUint32(view, 0, CENTRAL_DIRECTORY_SIGNATURE);
  setUint16(view, 4, 20);
  setUint16(view, 6, 20);
  setUint16(view, 8, UTF8_FLAG);
  setUint16(view, 10, 0);
  setUint16(view, 12, entry.time);
  setUint16(view, 14, entry.date);
  setUint32(view, 16, entry.crc);
  setUint32(view, 20, entry.size);
  setUint32(view, 24, entry.size);
  setUint16(view, 28, entry.nameBytes.byteLength);
  setUint16(view, 30, 0);
  setUint16(view, 32, 0);
  setUint16(view, 34, 0);
  setUint16(view, 36, 0);
  setUint32(view, 38, 0);
  setUint32(view, 42, entry.offset);
  return header;
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Uint8Array {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  setUint32(view, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  setUint16(view, 4, 0);
  setUint16(view, 6, 0);
  setUint16(view, 8, entryCount);
  setUint16(view, 10, entryCount);
  setUint32(view, 12, centralSize);
  setUint32(view, 16, centralOffset);
  setUint16(view, 20, 0);
  return header;
}

function byteViewBlobPart(bytes: Uint8Array): BlobPart {
  // Blob accepts BufferSource at runtime. lib.dom narrows BlobPart to views over
  // ArrayBuffer even though Uint8Array's default generic also permits SAB.
  return bytes as unknown as BlobPart;
}

/**
 * Creates a standards-compliant, UTF-8 ZIP using the stored method. Images are
 * already compressed, so DEFLATE would add CPU cost for little benefit.
 *
 * CRC is calculated one bounded chunk at a time and periodically yields to the
 * event loop. The final Blob is assembled from the original Blob/File objects
 * plus small ZIP headers instead of first copying every input into one giant
 * Uint8Array. Callers should not mutate ArrayBuffer/Uint8Array inputs until the
 * returned promise settles; Blob and File inputs are immutable and preferred.
 */
export async function createStoredZip(
  entries: readonly ZipEntry[],
  options: ZipOptions = {},
): Promise<Blob> {
  throwIfAborted(options.signal);
  if (entries.length > MAX_UINT16) {
    throw new Error("ZIP64 is not supported; the archive can contain at most 65,535 entries.");
  }

  const chunkSize = positiveIntegerOption(
    options.chunkSize,
    DEFAULT_CHUNK_SIZE,
    "ZIP chunk size",
    MAX_CHUNK_SIZE,
  );
  const yieldEveryBytes = positiveIntegerOption(
    options.yieldEveryBytes,
    DEFAULT_YIELD_EVERY_BYTES,
    "ZIP yield interval",
    MAX_UINT32,
  );
  const encoder = new TextEncoder();
  const prepared: PreparedEntry[] = [];
  const seenNames = new Set<string>();
  let localSize = 0;
  let totalBytes = 0;

  // Validate and size every entry before reading data so progress has a stable total.
  for (const entry of entries) {
    const name = normalizeZipEntryName(entry.name);
    const collisionKey = name.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seenNames.has(collisionKey)) throw new Error(`Duplicate ZIP entry name: ${name}`);
    seenNames.add(collisionKey);

    const nameBytes = encoder.encode(name);
    if (nameBytes.byteLength > MAX_UINT16) {
      throw new Error(`ZIP entry name is too long: ${name}`);
    }
    const size = dataByteLength(entry.data);
    if (size > MAX_UINT32) {
      throw new Error(`ZIP64 is required for files larger than 4 GiB: ${name}`);
    }
    const dos = toDosDateTime(entry.lastModified ?? new Date());
    prepared.push({
      name,
      nameBytes,
      data: entry.data,
      size,
      crc: 0,
      date: dos.date,
      time: dos.time,
      offset: localSize,
    });
    localSize += 30 + nameBytes.byteLength + size;
    totalBytes += size;
    if (localSize > MAX_UINT32) {
      throw new Error("ZIP64 is required for archives larger than 4 GiB.");
    }
  }

  const centralSize = prepared.reduce(
    (total, entry) => total + 46 + entry.nameBytes.byteLength,
    0,
  );
  if (localSize + centralSize + 22 > MAX_UINT32) {
    throw new Error("ZIP64 is required for archives larger than 4 GiB.");
  }

  let completedEntries = 0;
  let processedBytes = 0;
  const yieldState: YieldState = { bytes: 0, entries: 0 };
  emitProgress(options, {
    phase: "checksum",
    completedEntries,
    totalEntries: prepared.length,
    processedBytes,
    totalBytes,
  });

  for (const entry of prepared) {
    entry.crc = await checksumData(entry.data, chunkSize, options.signal, async (byteLength) => {
      processedBytes += byteLength;
      yieldState.bytes += byteLength;
      emitProgress(options, {
        phase: "checksum",
        completedEntries,
        totalEntries: prepared.length,
        processedBytes,
        totalBytes,
        currentEntry: entry.name,
      });
      await yieldIfNeeded(yieldState, yieldEveryBytes, options.signal);
    });
    completedEntries += 1;
    yieldState.entries += 1;
    emitProgress(options, {
      phase: "checksum",
      completedEntries,
      totalEntries: prepared.length,
      processedBytes,
      totalBytes,
      currentEntry: entry.name,
    });
    await yieldIfNeeded(yieldState, yieldEveryBytes, options.signal);
  }

  emitProgress(options, {
    phase: "finalizing",
    completedEntries,
    totalEntries: prepared.length,
    processedBytes,
    totalBytes,
  });

  const parts: BlobPart[] = [];
  for (const entry of prepared) {
    throwIfAborted(options.signal);
    parts.push(
      byteViewBlobPart(localFileHeader(entry)),
      byteViewBlobPart(entry.nameBytes),
      entry.data as BlobPart,
    );
    yieldState.entries += 1;
    await yieldIfNeeded(yieldState, yieldEveryBytes, options.signal);
  }
  for (const entry of prepared) {
    throwIfAborted(options.signal);
    parts.push(
      byteViewBlobPart(centralDirectoryHeader(entry)),
      byteViewBlobPart(entry.nameBytes),
    );
    yieldState.entries += 1;
    await yieldIfNeeded(yieldState, yieldEveryBytes, options.signal);
  }
  parts.push(
    byteViewBlobPart(endOfCentralDirectory(prepared.length, centralSize, localSize)),
  );
  throwIfAborted(options.signal);

  const archive = new Blob(parts, { type: options.mimeType ?? "application/zip" });
  emitProgress(options, {
    phase: "complete",
    completedEntries,
    totalEntries: prepared.length,
    processedBytes,
    totalBytes,
  });
  return archive;
}
