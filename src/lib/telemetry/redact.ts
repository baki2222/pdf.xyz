/**
 * Privacy-safe redaction for client telemetry payloads.
 *
 * pdf.xyz processes documents entirely in the browser and never uploads file
 * bytes. Error telemetry must uphold the same promise: an error report may carry
 * a message, a stack, and coarse context, but it must NEVER carry a file's
 * contents, a file's *name*, a handoff token, or a full URL whose query string
 * embeds one. These helpers are the defense-in-depth scrubber applied to every
 * value before it can leave the browser — even if a caller assembles a payload
 * carelessly, the sensitive substrings are stripped here.
 *
 * The functions are pure (no DOM, no clock, no network) so every redaction rule
 * is deterministically unit-testable. See `./reporter` for the transport that
 * only ever emits values that have passed through {@link redactValue}.
 */

/** The marker left in place of anything we strip, so redaction is visible. */
export const REDACTED = "[redacted]";

/** Guard rails so a pathological payload can never blow up a report. */
const MAX_STRING_LENGTH = 2048;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 64;
const MAX_OBJECT_KEYS = 64;

/**
 * Handoff tokens (the `?handoff=` URL param and IndexedDB key) always start with
 * the `h_` prefix minted by `newHandoffId`. We match aggressively — any `h_`
 * followed by token-ish characters — because over-redaction in telemetry is
 * always safe, whereas leaking a live single-use token is not.
 */
const HANDOFF_TOKEN = /h_[A-Za-z0-9]{2,}/g;

/**
 * `data:` and `blob:` URLs can embed raw document bytes (a rendered thumbnail, a
 * generated download). Strip the whole reference — the scheme is enough to know
 * what it was.
 */
const INLINE_DATA_URL = /\b(?:data|blob):[^\s"'()<>]+/gi;

/**
 * Any `http(s)` URL, captured as (origin+path)(query/hash). We keep group 1 and
 * drop the query/hash, so a token hidden in `?handoff=` or a filename in a path
 * segment's query can never survive. Path segments themselves are left intact
 * (they're route slugs like `/tools/merge-pdf`, not user data).
 */
const HTTP_URL = /(https?:\/\/[^\s"'?#]+)(?:[?#][^\s"'()<>]*)?/gi;

/**
 * The document/image/archive extensions we treat as filename-bearing. Anything
 * ending in one of these is very likely a user's file and gets its stem stripped.
 */
const DOCUMENT_EXTENSIONS = [
  "pdf",
  "docx?",
  "xlsx?",
  "pptx?",
  "od[tsp]",
  "rtf",
  "txt",
  "csv",
  "tsv",
  "html?",
  "epub",
  "pages",
  "numbers",
  "key",
  "jpe?g",
  "png",
  "gif",
  "webp",
  "avif",
  "heic",
  "tiff?",
  "bmp",
  "svg",
  "zip",
  "rar",
  "7z",
].join("|");

/**
 * A quoted filename — `"Bank Statement.pdf"` or `'invoice.docx'`. Libraries
 * often embed the offending file name in quotes inside an error message, and a
 * quoted name can contain spaces, so we match the whole quoted run (which the
 * unquoted rule below can't). Replaced with `"[redacted].<ext>"`.
 */
const QUOTED_FILENAME = new RegExp(
  String.raw`(['"])[^'"]*\.(${DOCUMENT_EXTENSIONS})\1`,
  "gi",
);

/**
 * An unquoted filename-shaped token: a run of non-separator characters ending in
 * a known extension. Replaced with `[redacted].<ext>` so the type is preserved
 * for debugging while the (potentially sensitive) stem is discarded.
 */
const FILENAME = new RegExp(
  String.raw`[^\s/\\:"'?<>|]*\.(${DOCUMENT_EXTENSIONS})\b`,
  "gi",
);

/**
 * Scrub sensitive substrings from a free-text string (an error message, a stack
 * frame, a label). Order matters: tokens and inline-data URLs are removed first,
 * then query strings are stripped from any remaining http URLs, then filenames
 * (quoted, then unquoted). The result is idempotent — running it twice yields
 * the same string.
 */
export function redactText(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;
  const clipped =
    input.length > MAX_STRING_LENGTH
      ? input.slice(0, MAX_STRING_LENGTH)
      : input;
  return clipped
    .replace(HANDOFF_TOKEN, "h_" + REDACTED)
    .replace(
      INLINE_DATA_URL,
      (m) => `${m.slice(0, m.indexOf(":"))}:${REDACTED}`,
    )
    .replace(HTTP_URL, "$1")
    .replace(
      QUOTED_FILENAME,
      (_m, quote: string, ext: string) =>
        `${quote}${REDACTED}.${ext.toLowerCase()}${quote}`,
    )
    .replace(FILENAME, (_m, ext: string) => `${REDACTED}.${ext.toLowerCase()}`);
}

/**
 * Reduce a URL to its origin + pathname, dropping the query string and hash
 * entirely. This is the strict form used for the *current page URL*, where the
 * query may hold a live `?handoff=` token. Falls back to {@link redactText} for
 * non-URL or relative inputs so nothing sensitive slips through the crack.
 */
export function redactUrl(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;
  try {
    const url = new URL(input);
    // Keep scheme + host + path; deliberately omit `.search` and `.hash`.
    return `${url.origin}${url.pathname}`;
  } catch {
    // Relative URL, opaque string, or non-browser runtime: scrub as free text,
    // which still strips tokens, filenames, and any embedded absolute URL query.
    return redactText(input).replace(/[?#].*$/s, "");
  }
}

/**
 * Keys whose *value* is dropped outright, regardless of shape. These name things
 * that are inherently document-derived (a filename may have no extension for the
 * regex to catch) or that could hold raw bytes/content.
 */
const DROP_KEYS = new Set(
  [
    "name",
    "filename",
    "filenames",
    "file",
    "files",
    "blob",
    "bytes",
    "buffer",
    "content",
    "contents",
    "body",
    "raw",
    "payload",
    "text",
    "token",
    "handoff",
    "handoffid",
    "secret",
    "authorization",
    "cookie",
  ].map((k) => k.toLowerCase()),
);

/** Keys whose value is a URL and should be reduced to origin + path. */
const URL_KEYS = new Set(
  ["url", "href", "src", "uri", "referrer", "referer", "location"].map((k) =>
    k.toLowerCase(),
  ),
);

/**
 * Deep-scrub an arbitrary value for safe inclusion in a telemetry payload.
 *
 * - strings → {@link redactText}
 * - finite numbers / booleans → passed through; non-finite numbers → null
 * - arrays → each item scrubbed, capped at {@link MAX_ARRAY_ITEMS}
 * - objects → keys in {@link DROP_KEYS} become `[redacted]`, keys in
 *   {@link URL_KEYS} are reduced to origin+path, everything else recurses
 * - functions / symbols / bigints → dropped (returned as undefined)
 *
 * Depth and breadth are bounded so a hostile or cyclic structure degrades to a
 * marker rather than hanging or exploding the report.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === "string") return redactText(value as string);
  if (type === "number") return Number.isFinite(value as number) ? value : null;
  if (type === "boolean") return value;
  if (type === "bigint" || type === "function" || type === "symbol") {
    return undefined;
  }

  if (depth >= MAX_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS)
      items.push(`${REDACTED} (+${value.length - MAX_ARRAY_ITEMS} more)`);
    return items;
  }

  // Plain object: walk own enumerable string keys only.
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).slice(
    0,
    MAX_OBJECT_KEYS,
  );
  for (const key of keys) {
    const lower = key.toLowerCase();
    const child = (value as Record<string, unknown>)[key];
    if (DROP_KEYS.has(lower)) {
      out[key] = REDACTED;
    } else if (URL_KEYS.has(lower) && typeof child === "string") {
      out[key] = redactUrl(child);
    } else {
      const scrubbed = redactValue(child, depth + 1);
      if (scrubbed !== undefined) out[key] = scrubbed;
    }
  }
  return out;
}
