/**
 * Strict, dependency-free validation for the job API. Every function takes
 * untrusted `unknown` input and returns a {@link ParseResult}: either a typed,
 * safe value or a ready-to-send error result. No file bytes ever pass through
 * here — only the JSON metadata that describes a job.
 *
 * Hard rules:
 *  - Never trust client-declared types or sizes; validate against JOB_LIMITS.
 *  - Never accept arbitrary URLs or filesystem paths. URL inputs must be public
 *    http(s) URLs (edge-level SSRF guard); filenames may not contain path
 *    separators or traversal.
 */

import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { workerFileCeilingBytes } from "@/lib/workers/engine-file-ceilings";
import {
  getToolInputKind,
  capabilityForMode,
  usesWorkerBackend,
} from "./capabilities";
import { apiError, type ParseResult } from "./responses";
import { sanitizeDisplayFilename } from "./filenames";
import {
  JOB_LIMITS,
  type CreateJobRequest,
  type CreateUploadSessionRequest,
  type UploadFileDescriptor,
} from "./types";

// ─────────────────────────────── ID formats ──────────────────────────────────

/** Opaque handles minted by the backend. Conservative, URL-safe character set. */
const FILE_ID = /^f_[A-Za-z0-9_-]{10,64}$/;
const JOB_ID = /^job_[A-Za-z0-9_-]{10,64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
const MIME_SHAPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

export function isValidJobId(id: string): boolean {
  return JOB_ID.test(id);
}

export function isValidFileId(id: string): boolean {
  return FILE_ID.test(id);
}

// ─────────────────────────────── MIME allowlist ──────────────────────────────

/**
 * Accepted MIME types per catalog input format token. Inputs only.
 *
 * Exported so the coarse upload-intake family allowlist (`@/lib/uploads/intake`)
 * can prove — via a drift-guard test — that every MIME this exact-match validator
 * accepts is also recognized by the earlier, tool-agnostic intake gate. The two
 * layers stay deliberately distinct (intake is coarse + configurable; this is the
 * precise per-tool contract), but intake can never be *laxer* on known types.
 */
// The table itself lives in a dependency-free leaf so the browser job clients
// can DECLARE exactly what this validator accepts without importing it (and the
// tool catalogue with it). Re-exported under the same name for existing callers.
export { MIME_BY_FORMAT } from "./mime-by-format";
import { MIME_BY_FORMAT } from "./mime-by-format";

function allowedMimeTypesForTool(tool: Tool): Set<string> {
  const set = new Set<string>();
  for (const format of tool.accept) {
    const mimes = MIME_BY_FORMAT[format.toUpperCase()];
    if (mimes) for (const mime of mimes) set.add(mime);
  }
  return set;
}

// ─────────────────────────────── Primitives ──────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isValidFilename(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > JOB_LIMITS.maxFilenameLength) {
    return false;
  }
  if (trimmed === "." || trimmed === "..") return false;
  if (trimmed.includes("..")) return false; // no traversal
  if (/[\\/]/.test(trimmed)) return false; // no path separators
  if (hasControlChars(trimmed)) return false;
  return true;
}

function normalizeContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Strip any parameters, e.g. "text/plain; charset=utf-8".
  const base = value.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!MIME_SHAPE.test(base)) return null;
  return base;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * SSRF guard for URL-input tools. Blocks non-http(s), localhost, private and
 * link-local ranges, and internal TLDs at the edge. The worker's egress policy
 * is the real enforcement layer; this is defense in depth and keeps the contract
 * from ever accepting an arbitrary URL.
 */
export function isSafePublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false; // no embedded credentials

  const host = url.hostname.toLowerCase();
  if (host.length === 0) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "::1" || host === "[::1]") return false;
  if (host === "0.0.0.0") return false;
  if (/^127\./.test(host)) return false; // loopback
  if (/^10\./.test(host)) return false; // private
  if (/^192\.168\./.test(host)) return false; // private
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false; // private
  if (/^169\.254\./.test(host)) return false; // link-local / cloud metadata
  return true;
}

// ─────────────────────────────── Error helpers ───────────────────────────────

function fail(error: ReturnType<typeof apiError>): {
  ok: false;
  error: ReturnType<typeof apiError>;
} {
  return { ok: false, error };
}

function invalid(message: string, field?: string): ParseResult<never> {
  return fail(
    apiError(
      "invalid_request",
      message,
      field ? [{ field, message }] : undefined,
    ),
  );
}

function unprocessable(message: string, field?: string): ParseResult<never> {
  return fail(
    apiError(
      "unprocessable_entity",
      message,
      field ? [{ field, message }] : undefined,
    ),
  );
}

function tooLarge(message: string, field: string): ParseResult<never> {
  return fail(apiError("payload_too_large", message, [{ field, message }]));
}

/** Resolve a `tool` field to a worker-capable catalog Tool, or an error. */
function resolveWorkerTool(value: unknown): ParseResult<Tool> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalid("`tool` is required and must be a string.", "tool");
  }
  const tool = getToolBySlug(value);
  if (!tool) {
    return fail(
      apiError("unsupported_tool", `Unknown tool: "${value}".`, [
        { field: "tool", message: "Not a known tool slug." },
      ]),
    );
  }
  const capability = capabilityForMode(tool.processing);
  if (!usesWorkerBackend(capability)) {
    return unprocessable(
      `"${tool.slug}" runs in your browser and has no server job.`,
      "tool",
    );
  }
  return { ok: true, value: tool };
}

// ─────────────────────────── Upload session request ──────────────────────────

function parseFileDescriptor(
  value: unknown,
  index: number,
  allowedMimes: Set<string>,
  maxFileBytes: number,
): ParseResult<UploadFileDescriptor> {
  const field = `files[${index}]`;
  if (!isRecord(value)) {
    return invalid(`${field} must be an object.`, field);
  }
  if (!isValidFilename(value.filename)) {
    return invalid(
      `${field}.filename is missing, too long, or contains illegal characters.`,
      `${field}.filename`,
    );
  }
  const contentType = normalizeContentType(value.contentType);
  if (!contentType) {
    return invalid(
      `${field}.contentType must be a valid MIME type.`,
      `${field}.contentType`,
    );
  }
  if (!allowedMimes.has(contentType)) {
    return unprocessable(
      `${field}.contentType "${contentType}" is not accepted by this tool.`,
      `${field}.contentType`,
    );
  }
  const { bytes } = value;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    return invalid(
      `${field}.bytes must be a positive integer.`,
      `${field}.bytes`,
    );
  }
  if (bytes > maxFileBytes) {
    return tooLarge(
      `${field}.bytes exceeds the ${maxFileBytes}-byte per-file limit.`,
      `${field}.bytes`,
    );
  }
  return {
    ok: true,
    value: { filename: value.filename.trim(), contentType, bytes },
  };
}

export function parseCreateUploadSessionRequest(
  input: unknown,
): ParseResult<CreateUploadSessionRequest> {
  if (!isRecord(input)) {
    return invalid("Request body must be a JSON object.");
  }

  const toolResult = resolveWorkerTool(input.tool);
  if (!toolResult.ok) return toolResult;
  const tool = toolResult.value;

  if (getToolInputKind(tool.slug) === "url") {
    return unprocessable(
      `"${tool.slug}" takes a URL, not uploaded files. Create a job with a \`url\` option instead.`,
      "files",
    );
  }

  const { files } = input;
  if (!Array.isArray(files)) {
    return invalid("`files` must be an array.", "files");
  }
  if (files.length === 0) {
    return unprocessable("At least one file is required.", "files");
  }
  if (files.length > JOB_LIMITS.maxInputFiles) {
    return unprocessable(
      `Too many files: max ${JOB_LIMITS.maxInputFiles} per session.`,
      "files",
    );
  }

  const allowedMimes = allowedMimeTypesForTool(tool);
  // The tighter of the global cap and the ENGINE's: refusing here, before a
  // slot is minted, is what keeps a file LibreOffice will refuse from being
  // uploaded in full and malware-scanned first.
  const maxFileBytes = workerFileCeilingBytes(tool.slug);
  const descriptors: UploadFileDescriptor[] = [];
  let totalBytes = 0;
  for (let i = 0; i < files.length; i++) {
    const parsed = parseFileDescriptor(files[i], i, allowedMimes, maxFileBytes);
    if (!parsed.ok) return parsed;
    totalBytes += parsed.value.bytes;
    descriptors.push(parsed.value);
  }
  if (totalBytes > JOB_LIMITS.maxTotalBytes) {
    return tooLarge(
      `Combined size exceeds the ${JOB_LIMITS.maxTotalBytes}-byte session limit.`,
      "files",
    );
  }

  return { ok: true, value: { tool: tool.slug, files: descriptors } };
}

// ─────────────────────────────── Job request ─────────────────────────────────

function parseOptions(value: unknown): ParseResult<Record<string, unknown>> {
  if (value === undefined) return { ok: true, value: {} };
  if (!isRecord(value)) {
    return invalid("`options` must be an object.", "options");
  }
  if (byteLength(JSON.stringify(value)) > JOB_LIMITS.maxOptionsBytes) {
    return tooLarge(
      `\`options\` exceeds the ${JOB_LIMITS.maxOptionsBytes}-byte limit.`,
      "options",
    );
  }
  return { ok: true, value };
}

function parseIdempotencyKey(value: unknown): ParseResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
    return invalid(
      "`idempotencyKey` must match [A-Za-z0-9_.:-] and be 1–200 chars.",
      "idempotencyKey",
    );
  }
  return { ok: true, value };
}

/**
 * Parse the optional, display-only `inputNames`: sanitized names positionally
 * aligned with `inputs`. Absent → `undefined` (fully backward-compatible). When
 * present it must be an array of strings within the per-file caps; each element
 * is normalized to a safe display name via {@link sanitizeDisplayFilename} and can
 * never influence an object key, broker key, or path. Only the first `inputCount`
 * names are kept (extras are ignored — they have no input to name).
 */
function parseInputNames(
  value: unknown,
  inputCount: number,
): ParseResult<string[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) {
    return invalid("`inputNames` must be an array of strings.", "inputNames");
  }
  if (value.length > JOB_LIMITS.maxInputFiles) {
    return unprocessable(
      `Too many inputNames: max ${JOB_LIMITS.maxInputFiles}.`,
      "inputNames",
    );
  }
  const names: string[] = [];
  for (let i = 0; i < Math.min(value.length, inputCount); i++) {
    const raw = value[i];
    if (typeof raw !== "string") {
      return invalid(`inputNames[${i}] must be a string.`, `inputNames[${i}]`);
    }
    if (raw.length > JOB_LIMITS.maxFilenameLength) {
      return tooLarge(
        `inputNames[${i}] exceeds the ${JOB_LIMITS.maxFilenameLength}-char limit.`,
        `inputNames[${i}]`,
      );
    }
    names.push(sanitizeDisplayFilename(raw));
  }
  return { ok: true, value: names.length > 0 ? names : undefined };
}

export function parseCreateJobRequest(
  input: unknown,
): ParseResult<CreateJobRequest> {
  if (!isRecord(input)) {
    return invalid("Request body must be a JSON object.");
  }

  const toolResult = resolveWorkerTool(input.tool);
  if (!toolResult.ok) return toolResult;
  const tool = toolResult.value;

  const optionsResult = parseOptions(input.options);
  if (!optionsResult.ok) return optionsResult;
  const options = optionsResult.value;

  const keyResult = parseIdempotencyKey(input.idempotencyKey);
  if (!keyResult.ok) return keyResult;

  const inputKind = getToolInputKind(tool.slug);

  if (inputKind === "url") {
    // URL-input tools (e.g. webpage-to-pdf) take no uploads; the source is a
    // validated public URL in options.
    const url = options.url;
    if (typeof url !== "string" || url.trim().length === 0) {
      return invalid("`options.url` is required for this tool.", "options.url");
    }
    if (!isSafePublicHttpUrl(url)) {
      return unprocessable(
        "`options.url` must be a public http(s) URL (no localhost, private, or link-local hosts).",
        "options.url",
      );
    }
    if (input.inputs !== undefined) {
      const { inputs } = input;
      if (!Array.isArray(inputs) || inputs.length > 0) {
        return unprocessable(
          "This tool takes a URL, not file inputs; `inputs` must be empty.",
          "inputs",
        );
      }
    }
    return {
      ok: true,
      value: {
        tool: tool.slug,
        inputs: [],
        options,
        ...(keyResult.value ? { idempotencyKey: keyResult.value } : {}),
      },
    };
  }

  // File-input tools: `inputs` are fileIds from an upload session.
  const { inputs } = input;
  if (!Array.isArray(inputs)) {
    return invalid("`inputs` must be an array of file ids.", "inputs");
  }
  if (inputs.length === 0) {
    return unprocessable("At least one input file id is required.", "inputs");
  }
  if (inputs.length > JOB_LIMITS.maxInputFiles) {
    return unprocessable(
      `Too many inputs: max ${JOB_LIMITS.maxInputFiles}.`,
      "inputs",
    );
  }
  for (let i = 0; i < inputs.length; i++) {
    const id = inputs[i];
    if (typeof id !== "string" || !isValidFileId(id)) {
      return invalid(`inputs[${i}] is not a valid file id.`, `inputs[${i}]`);
    }
  }

  const namesResult = parseInputNames(input.inputNames, inputs.length);
  if (!namesResult.ok) return namesResult;

  /**
   * The client's character count, if it sent one.
   *
   * REFUSED rather than coerced when malformed. It is attacker-controlled and
   * it feeds arithmetic that decides how much of someone's daily allowance a
   * job costs — so a `-1`, a `1.5` or a `"many"` must never reach that
   * multiplication. Absent is fine and means "reserve the maximum"; present and
   * nonsense is a bad request, because the caller asked for something specific
   * and got the specifics wrong.
   */
  const declared = input.declaredCharacters;
  if (declared !== undefined) {
    if (
      typeof declared !== "number" ||
      !Number.isInteger(declared) ||
      declared <= 0
    ) {
      return invalid(
        "declaredCharacters must be a positive whole number of characters.",
        "declaredCharacters",
      );
    }
  }

  /**
   * The client's count of pages that carry text, if it sent one.
   *
   * Refused rather than coerced, for the same reason as the character count and
   * one more: this one bounds DELIVERY directly rather than through a
   * multiplication, so a `0` would silently mean "translate nothing" and a
   * `1.5` would mean whatever the comparison happened to do with it.
   */
  const declaredPages = input.declaredTextPages;
  if (declaredPages !== undefined) {
    if (
      typeof declaredPages !== "number" ||
      !Number.isInteger(declaredPages) ||
      declaredPages <= 0
    ) {
      return invalid(
        "declaredTextPages must be a positive whole number of pages.",
        "declaredTextPages",
      );
    }
  }

  return {
    ok: true,
    value: {
      tool: tool.slug,
      inputs: inputs as string[],
      ...(namesResult.value ? { inputNames: namesResult.value } : {}),
      ...(input.options !== undefined ? { options } : {}),
      ...(declared !== undefined ? { declaredCharacters: declared } : {}),
      ...(declaredPages !== undefined
        ? { declaredTextPages: declaredPages }
        : {}),
      ...(keyResult.value ? { idempotencyKey: keyResult.value } : {}),
    },
  };
}
