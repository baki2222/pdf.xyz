/**
 * Coarse **upload family** classification for the intake guardrails.
 *
 * This is a deliberately *tool-agnostic* allowlist: it answers only "is this a
 * kind of file pdf.xyz ever accepts, and does the declared MIME agree with the
 * filename's extension?" — the cheap, platform-wide gate that runs before the
 * precise, per-tool MIME check in `@/lib/jobs` (`parseCreateUploadSessionRequest`).
 * Keeping it coarse is the point: intake rejects an `.exe`/`application/x-...`
 * outright, while a *recognized-but-wrong-for-this-tool* type (a PNG sent to a
 * PDF-only tool) still passes intake and is caught, with a precise message, by the
 * tool validator. The two layers never disagree in a way that lets a bad type
 * through — a drift-guard test pins that every MIME the validator accepts maps to a
 * family here.
 *
 * Pure and dependency-free (no Node, no framework); safe to import anywhere.
 */

/** The coarse families the platform accepts as uploads. */
export type UploadFamily =
  "pdf" | "image" | "word" | "spreadsheet" | "presentation" | "web" | "text";

/** A family's recognized MIME types and filename extensions (both lower-case). */
interface FamilySpec {
  readonly mimes: readonly string[];
  readonly extensions: readonly string[];
}

/**
 * The family table. MIME lists are a superset-union of every type in
 * `MIME_BY_FORMAT` (see the drift-guard in `families.test.ts`); extensions are the
 * intake layer's own signal for MIME/extension coherence. `image/jpg` is a
 * non-standard alias some clients send for JPEG and is accepted alongside it, to
 * match the tool validator.
 */
export const UPLOAD_FAMILIES: Record<UploadFamily, FamilySpec> = {
  pdf: {
    mimes: ["application/pdf"],
    extensions: ["pdf"],
  },
  image: {
    mimes: ["image/jpeg", "image/jpg", "image/png"],
    extensions: ["jpg", "jpeg", "png"],
  },
  word: {
    mimes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    extensions: ["doc", "docx"],
  },
  spreadsheet: {
    mimes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ],
    extensions: ["xls", "xlsx", "csv"],
  },
  presentation: {
    mimes: [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    extensions: ["ppt", "pptx"],
  },
  web: {
    mimes: ["text/html"],
    extensions: ["html", "htm"],
  },
  text: {
    mimes: ["text/plain", "text/markdown"],
    extensions: ["txt", "md", "markdown"],
  },
};

/**
 * Shape of a plausible MIME type. Defined once, here: the job validator
 * (`@/lib/jobs/validation.ts`) imports {@link normalizeContentType} rather than
 * keeping a copy, so the intake and the validator read a content type the same way.
 * This module stays import-free so that direction costs the browser bundle nothing.
 */
const MIME_SHAPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** The longest content type {@link normalizeContentType} accepts, in characters. */
export const MAX_CONTENT_TYPE_LENGTH = 255;

// Reverse indexes, built once, for O(1) lookups.
const FAMILY_BY_MIME = new Map<string, UploadFamily>();
const FAMILY_BY_EXTENSION = new Map<string, UploadFamily>();
for (const [family, spec] of Object.entries(UPLOAD_FAMILIES) as [
  UploadFamily,
  FamilySpec,
][]) {
  for (const mime of spec.mimes) FAMILY_BY_MIME.set(mime, family);
  for (const ext of spec.extensions) FAMILY_BY_EXTENSION.set(ext, family);
}

/**
 * Normalize a client-declared Content-Type to its bare, lower-cased `type/subtype`
 * (parameters like `; charset=utf-8` are stripped), or `null` when the value is
 * missing or not a plausibly-shaped MIME type. Bounding the shape here means a
 * hostile string (a path, a URL, a filename) can never reach an error message as
 * an "unrecognized type" — it fails this gate and is treated as absent.
 */
export function normalizeContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const base = value.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base.length === 0 || base.length > MAX_CONTENT_TYPE_LENGTH) return null;
  return MIME_SHAPE.test(base) ? base : null;
}

/** The family a recognized MIME type belongs to, or `null` if unrecognized. */
export function familyForMime(
  normalizedMime: string | null,
): UploadFamily | null {
  if (normalizedMime === null) return null;
  return FAMILY_BY_MIME.get(normalizedMime) ?? null;
}

/** Lower-cased final extension (no dot) of a name, or `null` when it has none. */
export function extensionOf(filename: unknown): string | null {
  if (typeof filename !== "string") return null;
  const segment = filename.split(/[/\\]/).pop() ?? "";
  const dot = segment.lastIndexOf(".");
  if (dot <= 0 || dot === segment.length - 1) return null;
  const ext = segment.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(ext) ? ext : null;
}

/** The family a recognized extension belongs to, or `null` if unrecognized. */
export function familyForExtension(filename: unknown): UploadFamily | null {
  const ext = extensionOf(filename);
  if (ext === null) return null;
  return FAMILY_BY_EXTENSION.get(ext) ?? null;
}

/** The verdict of classifying a declared (filename, contentType) pair. */
export type ClassifyResult =
  | { ok: true; family: UploadFamily }
  /** The declared MIME is not part of any accepted upload family. */
  | { ok: false; reason: "unrecognized" }
  /** The MIME and the filename extension resolve to *different* families. */
  | { ok: false; reason: "mismatch" };

/**
 * Classify a declared file by its Content-Type, using the filename extension only
 * as a coherence check.
 *
 * Rules, chosen to reject the clearly-wrong without false-positiving on the merely
 * unusual:
 *  - MIME unrecognized ⇒ `unrecognized` (e.g. `application/x-msdownload`).
 *  - MIME recognized, extension recognized, families differ ⇒ `mismatch`
 *    (e.g. `report.exe` declared as `application/pdf`, or `bill.pdf` declared as
 *    `image/png`). Catches the common "wrong extension for a real type" trick.
 *  - MIME recognized, extension unknown or absent ⇒ accept the MIME's family. A
 *    missing/odd extension is not, by itself, grounds to reject a plausibly-typed
 *    upload; the tool validator still has the final, exact say.
 */
export function classifyDeclaredType(
  filename: unknown,
  contentType: unknown,
): ClassifyResult {
  const mimeFamily = familyForMime(normalizeContentType(contentType));
  if (mimeFamily === null) return { ok: false, reason: "unrecognized" };

  const extFamily = familyForExtension(filename);
  if (extFamily !== null && extFamily !== mimeFamily) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, family: mimeFamily };
}
