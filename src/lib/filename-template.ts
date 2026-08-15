import type {
  FilenameTemplateContext,
  FilenameTemplateOptions,
  ImageFormat,
} from "./types";

export const FILENAME_TEMPLATE_TOKENS = [
  "name",
  "number",
  "width",
  "height",
  "format",
] as const;

type FilenameToken = (typeof FILENAME_TEMPLATE_TOKENS)[number];

const TOKEN_SET = new Set<string>(FILENAME_TEMPLATE_TOKENS);
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|avif)$/i;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

export class FilenameTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilenameTemplateError";
  }
}

export function imageFormatExtension(format: ImageFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export function filenameStem(filename: string): string {
  const leaf = filename.replace(/\\/g, "/").split("/").at(-1) ?? filename;
  const withoutImageExtension = leaf.replace(IMAGE_EXTENSION, "");
  return withoutImageExtension || "image";
}

function splitExtension(filename: string): { stem: string; extension: string } {
  const match = /^(.*?)(\.[^.]+)$/.exec(filename);
  if (!match || !match[1]) {
    return { stem: filename, extension: "" };
  }
  return { stem: match[1], extension: match[2] };
}

function enforceMaxLength(filename: string, maxLength: number): string {
  if (!Number.isInteger(maxLength) || maxLength < 8) {
    throw new FilenameTemplateError("Maximum filename length must be an integer of at least 8.");
  }
  if (filename.length <= maxLength) return filename;

  const { stem, extension } = splitExtension(filename);
  const room = Math.max(1, maxLength - extension.length);
  return `${stem.slice(0, room).replace(/[. ]+$/g, "") || "image"}${extension}`;
}

/** Sanitizes one filename (not a path) for browser downloads and common OSes. */
export function sanitizeFilename(filename: string, maxLength = 180): string {
  let sanitized = filename
    .normalize("NFKC")
    .replace(INVALID_FILENAME_CHARACTERS, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[. ]+|[. ]+$/g, "")
    .trim();

  if (!sanitized || sanitized === "." || sanitized === "..") {
    sanitized = "image";
  }
  if (WINDOWS_RESERVED_NAME.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  return enforceMaxLength(sanitized, maxLength);
}

export function getUnknownFilenameTokens(template: string): string[] {
  const matches = template.matchAll(/\{([^{}]+)\}/g);
  return [...new Set([...matches].map((match) => match[1]).filter((token) => !TOKEN_SET.has(token)))];
}

export function assertValidFilenameTemplate(template: string): void {
  if (!template.trim()) {
    throw new FilenameTemplateError("Filename template cannot be empty.");
  }
  const unknown = getUnknownFilenameTokens(template);
  if (unknown.length > 0) {
    throw new FilenameTemplateError(`Unknown filename token: ${unknown.join(", ")}.`);
  }

  const withoutTokens = template.replace(/\{(?:name|number|width|height|format)\}/g, "");
  if (/[{}]/.test(withoutTokens)) {
    throw new FilenameTemplateError("Filename template contains an unmatched brace.");
  }
}

function assertContext(context: FilenameTemplateContext): void {
  for (const [key, value] of [
    ["number", context.number],
    ["width", context.width],
    ["height", context.height],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || (key !== "number" && value < 1)) {
      throw new FilenameTemplateError(`${key} must be a valid integer.`);
    }
  }
}

function forceImageExtension(filename: string, format: ImageFormat): string {
  const extension = imageFormatExtension(format);
  const withoutOutputExtension = filename.replace(IMAGE_EXTENSION, "");
  return `${withoutOutputExtension || "image"}.${extension}`;
}

export function renderFilenameTemplate(
  template: string,
  context: FilenameTemplateContext,
  options: FilenameTemplateOptions = {},
): string {
  assertValidFilenameTemplate(template);
  assertContext(context);

  const padding = options.numberPadding ?? 1;
  if (!Number.isInteger(padding) || padding < 1 || padding > 12) {
    throw new FilenameTemplateError("Number padding must be an integer from 1 to 12.");
  }

  const tokenValues: Record<FilenameToken, string> = {
    name: sanitizeFilename(filenameStem(context.name)),
    number: String(context.number).padStart(padding, "0"),
    width: String(context.width),
    height: String(context.height),
    format: imageFormatExtension(context.format),
  };

  const rendered = template.replace(
    /\{(name|number|width|height|format)\}/g,
    (_match, token: FilenameToken) => tokenValues[token],
  );
  const withExtension = forceImageExtension(rendered, context.format);
  return sanitizeFilename(withExtension, options.maxLength ?? 180);
}

function collisionKey(filename: string): string {
  return filename.normalize("NFKC").toLocaleLowerCase("en-US");
}

/** Returns a collision-free name without mutating the supplied collection. */
export function ensureUniqueFilename(filename: string, usedNames: Iterable<string>): string {
  const safeFilename = sanitizeFilename(filename);
  const used = new Set([...usedNames].map(collisionKey));
  if (!used.has(collisionKey(safeFilename))) return safeFilename;

  const { stem, extension } = splitExtension(safeFilename);
  let suffix = 2;
  let candidate: string;
  do {
    const suffixText = `-${suffix}`;
    const stemRoom = Math.max(1, 180 - extension.length - suffixText.length);
    candidate = sanitizeFilename(
      `${stem.slice(0, stemRoom).replace(/[. ]+$/g, "") || "image"}${suffixText}${extension}`,
    );
    suffix += 1;
  } while (used.has(collisionKey(candidate)));
  return candidate;
}

export function renderUniqueFilenames(
  template: string,
  contexts: readonly FilenameTemplateContext[],
  options: FilenameTemplateOptions = {},
): string[] {
  const used = new Set<string>();
  return contexts.map((context) => {
    const rendered = renderFilenameTemplate(template, context, options);
    const unique = ensureUniqueFilename(rendered, used);
    used.add(unique);
    return unique;
  });
}
