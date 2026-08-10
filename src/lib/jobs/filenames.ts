/**
 * Privacy-safe **display filename** normalization and deterministic worker output
 * naming.
 *
 * This is the single source of truth for turning an untrusted, client-supplied
 * filename into a safe, human-friendly *display* name — the name shown in the UI
 * and used to derive a worker artifact's download filename. It is deliberately
 * pure and dependency-free (no Node, no DOM, no framework), so every layer that
 * touches a name — the upload reservation, the job spec, the worker's object
 * metadata read, and the processor's output namer — can apply the SAME rules and
 * never drift.
 *
 * Hard safety rules (see docs/SECURITY.md → "Filename metadata"):
 *  - A display name is *only ever* used for display and output naming. It NEVER
 *    becomes a storage/object key, a broker/Redis key, a filesystem path, a shell
 *    argument, or a log line. Object keys derive from opaque ids alone.
 *  - The sanitizer strips path components and separators, removes control and
 *    other unsafe characters, normalizes Unicode, bounds the length, rejects
 *    reserved/blank device names, and normalizes the extension — so a malicious
 *    or malformed name can only ever collapse to a safe token, never escape.
 *  - It is total: any input (including a non-string) yields a safe, non-empty
 *    result, so callers never have to special-case failure.
 */

/**
 * Upper bound on a sanitized display name's length. Deliberately far below the
 * contract's {@link JOB_LIMITS.maxFilenameLength} (255) so a long-but-valid name
 * is trimmed to something readable and header/metadata-safe, not merely accepted.
 */
export const MAX_DISPLAY_FILENAME_LENGTH = 128;

/** Bound on a normalized extension (without the dot), e.g. `pdf`, `jpeg`. */
const MAX_EXTENSION_LENGTH = 16;

/** The neutral stem used when nothing safe survives sanitization. */
const FALLBACK_STEM = "document";

/**
 * Windows/shell-hostile punctuation never allowed in a display name (path
 * separators, wildcards, redirection, quoting, and the drive-letter colon).
 * Control characters are handled separately by code point, so this set — and the
 * whole module — stays free of literal control bytes in source.
 */
const ILLEGAL_PUNCTUATION = new Set<string>([
  "<",
  ">",
  ":",
  '"',
  "/",
  "\\",
  "|",
  "?",
  "*",
]);

/** A control character: C0 (U+0000–U+001F), DEL, or C1 (U+007F–U+009F). */
function isControlChar(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * A Unicode bidirectional / zero-width / format code point. These render as
 * nothing yet can spoof how a name is displayed — e.g. a right-to-left override
 * (U+202E) makes `annexe‮fdp.exe` present as `annexe exe.pdf` — or smuggle an
 * invisible payload past a human reviewer. They are not "control" characters in
 * the C0/C1 sense and survive NFC, so they are stripped explicitly. Removing
 * them (rather than substituting) means a name made only of them collapses to
 * the neutral fallback instead of a run of placeholders.
 */
function isFormatChar(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) || // ZWSP, ZWNJ, ZWJ, LRM, RLM
    (code >= 0x202a && code <= 0x202e) || // LRE, RLE, PDF, LRO, RLO (bidi overrides)
    (code >= 0x2060 && code <= 0x2064) || // WORD JOINER + invisible math operators
    (code >= 0x2066 && code <= 0x2069) || // LRI, RLI, FSI, PDI (bidi isolates)
    code === 0xfeff // ZERO WIDTH NO-BREAK SPACE / BOM
  );
}

/**
 * Remove control characters, bidirectional/zero-width format characters, and the
 * illegal punctuation set from a string.
 */
function stripUnsafeChars(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch.length === 1) {
      const code = ch.charCodeAt(0);
      if (isControlChar(code) || isFormatChar(code)) continue;
    }
    if (ILLEGAL_PUNCTUATION.has(ch)) continue;
    out += ch;
  }
  return out;
}

/**
 * Windows reserved device names (case-insensitive, extension ignored). A file
 * literally named `CON.pdf` or `NUL` is unsafe on some hosts, so its stem is
 * replaced with the neutral fallback.
 */
const RESERVED_STEMS = new Set<string>([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** Options for {@link sanitizeDisplayFilename}. */
export interface SanitizeDisplayFilenameOptions {
  /** Neutral stem substituted when nothing safe survives. Defaults to `document`. */
  fallbackStem?: string;
  /** Maximum length of the returned name. Defaults to {@link MAX_DISPLAY_FILENAME_LENGTH}. */
  maxLength?: number;
}

/** Keep only the safe part of an extension: lowercase alphanumerics, bounded. */
function normalizeExtension(ext: string): string {
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned.slice(0, MAX_EXTENSION_LENGTH);
}

/**
 * Split a name into `{ stem, ext }` on the LAST dot. A leading dot (dotfile) is
 * not treated as an extension separator, so `.env` → stem `.env`, ext ``.
 */
function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

/**
 * Normalize an untrusted filename into a safe, human-friendly display name.
 *
 * The transform, in order: coerce to string → take the final path segment (drop
 * every directory component and both separator styles) → Unicode-normalize (NFC)
 * → strip control, bidirectional/zero-width, and illegal characters → collapse
 * whitespace and trim → drop leading dots (so `..`/dotfiles can't survive as
 * traversal or hidden names) → normalize the extension → replace a reserved/blank
 * stem with the fallback → bound the total length while preserving the extension.
 *
 * Total by construction: any input yields a non-empty, path-free, control-free
 * name no longer than `maxLength`.
 */
export function sanitizeDisplayFilename(
  raw: unknown,
  options: SanitizeDisplayFilenameOptions = {},
): string {
  const fallbackStem = options.fallbackStem ?? FALLBACK_STEM;
  const maxLength = options.maxLength ?? MAX_DISPLAY_FILENAME_LENGTH;

  const input = typeof raw === "string" ? raw : "";

  // Take the last path segment: everything after the final `/` or `\`. This
  // discards `../../`, `C:\dir\`, and `/etc/` prefixes in one step.
  const lastSegment = input.split(/[/\\]/).pop() ?? "";

  // Normalize Unicode, remove control + illegal chars, collapse whitespace.
  const cleaned = stripUnsafeChars(lastSegment.normalize("NFC"))
    .replace(/\s+/g, " ")
    .trim()
    // Drop any leading dots so a `.`/`..`/`.hidden` residue can't survive as a
    // traversal token or a blank stem. Internal and trailing dots are kept.
    .replace(/^\.+/, "")
    .trim();

  const { stem: rawStem, ext: rawExt } = splitExtension(cleaned);
  const ext = normalizeExtension(rawExt);

  // A reserved device name or an empty stem collapses to the neutral fallback.
  let stem = rawStem.trim();
  if (stem.length === 0 || RESERVED_STEMS.has(stem.toLowerCase())) {
    stem = fallbackStem;
  }

  const suffix = ext ? `.${ext}` : "";
  // Preserve the extension when trimming: reserve room for it, trim the stem.
  const stemBudget = Math.max(1, maxLength - suffix.length);
  if (stem.length > stemBudget) stem = stem.slice(0, stemBudget).trim();
  if (stem.length === 0)
    stem = fallbackStem.slice(0, stemBudget) || FALLBACK_STEM;

  return `${stem}${suffix}`;
}

/** Strip the last extension from an already-sanitized name: `a.b.pdf` → `a.b`. */
function displayBaseName(name: string): string {
  return splitExtension(name).stem || FALLBACK_STEM;
}

/**
 * Deterministic output name for a `compress-pdf` artifact: the sanitized original
 * basename plus the `-compressed` marker and a normalized `.pdf` extension, e.g.
 * `report.pdf` → `report-compressed.pdf`, `../secret.PDF` → `secret-compressed.pdf`.
 *
 * The compression *mode* (`lossless` vs `deep`) is intentionally NOT encoded in
 * the filename: the mode lives in the job options and the content-free result
 * metadata, and a stable, mode-independent name keeps the download UX predictable
 * (re-compressing a file never changes its name). Given the same original name it
 * always returns the same output name — so the local-dev, in-browser-fallback, and
 * secure-worker paths produce identical download filenames.
 */
export function compressedOutputName(originalName: unknown): string {
  const safe = sanitizeDisplayFilename(originalName);
  const base = displayBaseName(safe);
  // Re-bound: the `-compressed.pdf` suffix must not push us over the limit.
  const suffix = "-compressed.pdf";
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - suffix.length);
  const trimmed = base.length > budget ? base.slice(0, budget).trim() : base;
  return `${trimmed || FALLBACK_STEM}${suffix}`;
}
