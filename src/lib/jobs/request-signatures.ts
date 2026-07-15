/**
 * Request Signatures job contract — the typed, framework-agnostic options and
 * validator for the `request-signatures` secure-worker tool, plus the
 * deterministic output naming.
 *
 * This is the sign-workflow analogue of `@/lib/jobs/pdf-security.ts`: pure data
 * plus a pure parser — no Next.js, no storage, no pdf-lib. It defines exactly what
 * a signature request may ask for (who signs, where they sign, in what order) so
 * the UI, the worker processor, and the docs share one honest source of truth. It
 * depends only on `./responses` and `./filenames`, so a client component can import
 * the validator without pulling a Node built-in or the tools catalog into the bundle.
 *
 * HONEST SCOPE (load-bearing): this tool *prepares and packages* a signature
 * request — it adds real fillable fields to the PDF and records who must sign where
 * — it does NOT collect, certify, or legally bind signatures. Actually delivering a
 * request to external signers and collecting audited e-signatures requires a
 * configured e-signature provider; without one the worker fails honestly rather
 * than pretending a document was signed. See the engine for the delivery gate.
 */

import { apiError, type ParseResult } from "./responses";
import { MAX_DISPLAY_FILENAME_LENGTH, sanitizeDisplayFilename } from "./filenames";

/** The neutral stem used when nothing safe survives filename sanitization. */
const FALLBACK_STEM = "document";

/** Upper bound on signers in a single request (keeps the options bag bounded). */
export const MAX_REQUEST_SIGNERS = 10;
/** Upper bound on placed fields in a single request. */
export const MAX_REQUEST_FIELDS = 50;
/** Character bounds for the free-text fields. */
export const MAX_SIGNER_NAME_CHARS = 120;
export const MAX_SIGNER_EMAIL_CHARS = 254;
export const MAX_REQUEST_TITLE_CHARS = 200;
export const MAX_REQUEST_MESSAGE_CHARS = 1000;
export const MAX_FIELD_LABEL_CHARS = 80;

/** Floating-point slack when checking a fractional box fits inside the page. */
const COORD_EPS = 1e-3;

/**
 * The field kinds a signer can be asked to complete. All four are placed as real
 * fillable AcroForm fields on the prepared PDF; the type is recorded in the
 * manifest so a downstream viewer (or the pdf.xyz Sign PDF tool) knows what each
 * field is for. `signature`/`initials` are text placeholders a signer fills — we
 * never claim to embed a cryptographic digital-signature widget.
 */
export const REQUEST_SIGNATURE_FIELD_TYPES = [
  "signature",
  "initials",
  "date",
  "text",
] as const;
export type RequestSignatureFieldType = (typeof REQUEST_SIGNATURE_FIELD_TYPES)[number];

/**
 * Signing order. `sequential` routes the request to signers one after another (the
 * "collect audited e-signatures in order" flow); `parallel` sends to everyone at
 * once. Recorded in the manifest; enforced by whatever delivery layer consumes it.
 */
export const REQUEST_SIGNATURE_ROUTING = ["sequential", "parallel"] as const;
export type RequestSignatureRouting = (typeof REQUEST_SIGNATURE_ROUTING)[number];

const FIELD_TYPE_SET: ReadonlySet<string> = new Set(REQUEST_SIGNATURE_FIELD_TYPES);
const ROUTING_SET: ReadonlySet<string> = new Set(REQUEST_SIGNATURE_ROUTING);

// A conservative, non-catastrophic email shape: one `@`, a dot in the domain, no
// whitespace. This is an intake sanity check, not RFC 5322 — the honest goal is
// to reject obviously-malformed addresses, not to certify deliverability.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// C0 control characters (U+0000–U+001F) and DEL — never legitimate in these fields.
const CONTROL_CHAR = /[\u0000-\u001F\u007F]/;

/** One signer in the request: who they are and where to reach them. */
export interface RequestSigner {
  name: string;
  email: string;
}

/**
 * One field a signer must complete, positioned with fractional coordinates
 * (0..1) from the page's bottom-left corner so the placement is independent of the
 * page's absolute point size. The engine resolves these to points per page.
 */
export interface RequestSignatureField {
  /** Index into the request's `signers` array. */
  signer: number;
  /** 1-based page number the field sits on. */
  page: number;
  type: RequestSignatureFieldType;
  /** Lower-left X as a fraction of page width (0..1). */
  x: number;
  /** Lower-left Y as a fraction of page height (0..1). */
  y: number;
  /** Width as a fraction of page width (0..1]. */
  width: number;
  /** Height as a fraction of page height (0..1]. */
  height: number;
  /** Optional human label shown next to the field. */
  label?: string;
  /** Whether the field must be completed (defaults to true). */
  required: boolean;
}

/** Validated options for a `request-signatures` job. */
export interface SignatureRequestOptions {
  signers: RequestSigner[];
  fields: RequestSignatureField[];
  routing: RequestSignatureRouting;
  /** Optional request title (e.g. the agreement's name). */
  title?: string;
  /** Optional message shown to signers. */
  message?: string;
  /**
   * Whether to hand the request to an external e-signature provider for delivery
   * and collection. When true and no provider is configured, the worker fails
   * honestly — it never pretends to send or collect a signature.
   */
  deliver: boolean;
}

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate a bounded, control-character-free, non-empty display string. */
function parseText(
  value: unknown,
  field: string,
  label: string,
  max: number,
): ParseResult<string> {
  if (typeof value !== "string") {
    return invalid(`\`${field}\` must be a string.`, field);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return invalid(`${label} cannot be empty.`, field);
  if (CONTROL_CHAR.test(trimmed)) {
    return invalid(`${label} cannot contain control characters.`, field);
  }
  if (trimmed.length > max) {
    return invalid(`${label} is too long (max ${max} characters).`, field);
  }
  return { ok: true, value: trimmed };
}

function parseSigner(value: unknown, index: number): ParseResult<RequestSigner> {
  if (!isObject(value)) {
    return invalid(`\`signers[${index}]\` must be an object.`, `signers[${index}]`);
  }
  const name = parseText(
    value.name,
    `signers[${index}].name`,
    "Signer name",
    MAX_SIGNER_NAME_CHARS,
  );
  if (!name.ok) return name;

  const emailField = `signers[${index}].email`;
  if (typeof value.email !== "string") {
    return invalid(`\`${emailField}\` must be a string.`, emailField);
  }
  const email = value.email.trim();
  if (email.length === 0 || email.length > MAX_SIGNER_EMAIL_CHARS || !EMAIL_SHAPE.test(email)) {
    return invalid(`\`${emailField}\` must be a valid email address.`, emailField);
  }
  return { ok: true, value: { name: name.value, email } };
}

function parseFraction(value: unknown, field: string): ParseResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(`\`${field}\` must be a finite number.`, field);
  }
  return { ok: true, value };
}

function parseField(
  value: unknown,
  index: number,
  signerCount: number,
): ParseResult<RequestSignatureField> {
  const at = `fields[${index}]`;
  if (!isObject(value)) return invalid(`\`${at}\` must be an object.`, at);

  const { signer, page, type } = value;
  if (!Number.isInteger(signer) || (signer as number) < 0 || (signer as number) >= signerCount) {
    return invalid(`\`${at}.signer\` must reference an existing signer.`, `${at}.signer`);
  }
  if (!Number.isInteger(page) || (page as number) < 1) {
    return invalid(`\`${at}.page\` must be a positive page number.`, `${at}.page`);
  }
  if (typeof type !== "string" || !FIELD_TYPE_SET.has(type)) {
    return invalid(`\`${at}.type\` must be one of ${REQUEST_SIGNATURE_FIELD_TYPES.join(", ")}.`, `${at}.type`);
  }

  const x = parseFraction(value.x, `${at}.x`);
  if (!x.ok) return x;
  const y = parseFraction(value.y, `${at}.y`);
  if (!y.ok) return y;
  const width = parseFraction(value.width, `${at}.width`);
  if (!width.ok) return width;
  const height = parseFraction(value.height, `${at}.height`);
  if (!height.ok) return height;

  // Every box must be positive and sit fully within the page's unit square.
  if (width.value <= 0 || height.value <= 0) {
    return invalid(`\`${at}\` must have a positive size.`, at);
  }
  if (
    x.value < -COORD_EPS ||
    y.value < -COORD_EPS ||
    x.value + width.value > 1 + COORD_EPS ||
    y.value + height.value > 1 + COORD_EPS
  ) {
    return invalid(`\`${at}\` extends outside the page.`, at);
  }

  const field: RequestSignatureField = {
    signer: signer as number,
    page: page as number,
    type: type as RequestSignatureFieldType,
    x: x.value,
    y: y.value,
    width: width.value,
    height: height.value,
    required: value.required === undefined ? true : value.required === true,
  };
  if (value.label !== undefined) {
    const label = parseText(value.label, `${at}.label`, "Field label", MAX_FIELD_LABEL_CHARS);
    if (!label.ok) return label;
    field.label = label.value;
  }
  return { ok: true, value: field };
}

/**
 * Parse the free-form `options` bag of a `request-signatures` job into typed,
 * validated options. Strict: at least one signer and one field, well-formed
 * emails, every field pointing at an existing signer, in-bounds fractional
 * coordinates, and a known routing mode. Mirrors `parseProtectPdfOptions`, and is
 * what the worker calls before it ever touches a file.
 */
export function parseSignatureRequestOptions(
  options: Record<string, unknown>,
): ParseResult<SignatureRequestOptions> {
  if (!isObject(options)) {
    return invalid("`options` must be an object.", "options");
  }

  const rawSigners = options.signers;
  if (!Array.isArray(rawSigners) || rawSigners.length === 0) {
    return invalid("At least one signer is required.", "signers");
  }
  if (rawSigners.length > MAX_REQUEST_SIGNERS) {
    return invalid(`A request can have at most ${MAX_REQUEST_SIGNERS} signers.`, "signers");
  }
  const signers: RequestSigner[] = [];
  for (let i = 0; i < rawSigners.length; i += 1) {
    const parsed = parseSigner(rawSigners[i], i);
    if (!parsed.ok) return parsed;
    signers.push(parsed.value);
  }

  const rawFields = options.fields;
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    return invalid("At least one signature field is required.", "fields");
  }
  if (rawFields.length > MAX_REQUEST_FIELDS) {
    return invalid(`A request can have at most ${MAX_REQUEST_FIELDS} fields.`, "fields");
  }
  const fields: RequestSignatureField[] = [];
  for (let i = 0; i < rawFields.length; i += 1) {
    const parsed = parseField(rawFields[i], i, signers.length);
    if (!parsed.ok) return parsed;
    fields.push(parsed.value);
  }

  // Every signer must have at least one field to complete — an unaddressed signer
  // would silently never be asked to sign, which would be dishonest.
  const addressed = new Set(fields.map((f) => f.signer));
  for (let i = 0; i < signers.length; i += 1) {
    if (!addressed.has(i)) {
      return invalid(`Signer ${i + 1} has no fields to complete.`, `signers[${i}]`);
    }
  }

  let routing: RequestSignatureRouting = "sequential";
  if (options.routing !== undefined) {
    if (typeof options.routing !== "string" || !ROUTING_SET.has(options.routing)) {
      return invalid(`\`routing\` must be one of ${REQUEST_SIGNATURE_ROUTING.join(", ")}.`, "routing");
    }
    routing = options.routing as RequestSignatureRouting;
  }

  const result: SignatureRequestOptions = {
    signers,
    fields,
    routing,
    deliver: options.deliver === true,
  };

  if (options.title !== undefined) {
    const title = parseText(options.title, "title", "Title", MAX_REQUEST_TITLE_CHARS);
    if (!title.ok) return title;
    result.title = title.value;
  }
  if (options.message !== undefined) {
    const message = parseText(options.message, "message", "Message", MAX_REQUEST_MESSAGE_CHARS);
    if (!message.ok) return message;
    result.message = message.value;
  }

  return { ok: true, value: result };
}

/** A sensible download name for the request package, derived from the source PDF. */
export function signatureRequestOutputName(originalName: unknown): string {
  const tail = "-signature-request.zip";
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const stem =
    sanitizeDisplayFilename(originalName).replace(/\.[^.]+$/, "").trim() || FALLBACK_STEM;
  return `${stem.length > budget ? stem.slice(0, budget).trim() : stem}${tail}`;
}
