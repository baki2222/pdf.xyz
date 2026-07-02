/**
 * Optical character recognition engine (server / secure-worker side).
 *
 * OCR is the canonical example of work the browser cannot do honestly: turning a
 * scanned page into real, selectable text needs a trained recognition engine and
 * (for searchable PDFs) a rasteriser. There is no in-browser shortcut we would be
 * willing to ship, so this engine is built the same honest way the compression
 * engine is:
 *
 *   - The planner and option parser are PURE and dependency-injected, so every
 *     branch — including "no engine installed → honest failure" — is unit-testable
 *     without a native binary in CI.
 *   - Nothing here fabricates a text layer. If no usable OCR engine is present the
 *     engine returns a typed `unsupported` result; it NEVER invents recognized
 *     text or a dummy searchable PDF.
 *
 * Two real native engines are recognised, in preference order:
 *   - `ocrmypdf` — the full pipeline: rasterise → Tesseract → graft an invisible
 *     text layer back onto the PDF (and optionally emit a text sidecar). Handles
 *     multi-page PDFs and image inputs, plus deskew / rotate / clean / page-range.
 *   - `tesseract` — the recognition engine on its own. Used only for single-image
 *     inputs (it cannot page through a PDF); supports auto-orientation but not the
 *     PDF-level preprocessing ocrmypdf provides.
 *
 * `pdftotext` is intentionally NOT treated as an OCR engine: it only extracts a
 * pre-existing text layer and would return nothing for a scanned page, so using
 * it here would be dishonest. See docs/WORKER_ARCHITECTURE.md.
 */

import { apiError, type ParseResult } from "@/lib/jobs";

/** What the job should produce. */
export type OcrOutputMode = "searchable-pdf" | "text-sidecar";

/** The kind of source the OCR engine is handed (derived from its MIME type). */
export type OcrInputKind = "pdf" | "image";

/** How to treat pages that already contain a text layer. */
export type OcrExistingTextStrategy = "skip" | "force" | "redo";

/** Native OCR engines this worker can use, in the order it prefers them. */
export const OCR_ENGINES = ["ocrmypdf", "tesseract"] as const;
export type OcrEngine = (typeof OCR_ENGINES)[number];

/** Which OCR engines are present on the host (presence only, never values). */
export type OcrEngineAvailability = Record<OcrEngine, boolean>;

/** The engine that actually did (or would do) the work. */
export type OcrEngineId = OcrEngine;

export const DEFAULT_OCR_LANGUAGES: readonly string[] = ["eng"];
const MAX_LANGUAGES = 8;
/** Tesseract language/traineddata token: `eng`, `deu`, `chi_sim`, `aze_cyrl`, … */
const LANGUAGE_TOKEN = /^[a-z]{3}(_[a-z]{2,7})?$/;

const MAX_OCR_PAGE = 10_000;
const MAX_PAGE_TOKENS = 100;
const PAGE_RANGE_SHAPE = /^\d+(-\d+)?(,\d+(-\d+)?)*$/;

const OUTPUT_MODES: readonly OcrOutputMode[] = [
  "searchable-pdf",
  "text-sidecar",
];
const EXISTING_TEXT_STRATEGIES: readonly OcrExistingTextStrategy[] = [
  "skip",
  "force",
  "redo",
];

/** Validated, tool-specific OCR options parsed from a job request. */
export interface OcrOptions {
  /** Recognition languages (Tesseract codes), non-empty; defaults to `["eng"]`. */
  languages: string[];
  /** Searchable PDF (default) or a plain-text sidecar. */
  outputMode: OcrOutputMode;
  /** Straighten skewed scans before recognition (ocrmypdf only). */
  deskew: boolean;
  /** Auto-detect and correct page orientation. */
  rotate: boolean;
  /** Clean scan artefacts before recognition (ocrmypdf only). */
  clean: boolean;
  /** What to do with pages that already have a text layer. */
  onExistingText: OcrExistingTextStrategy;
  /** Optional 1-based page range, e.g. `"1-3,5"` (ocrmypdf / PDF inputs only). */
  pages?: string;
}

function invalidOption(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

/**
 * Parse a caller-supplied languages value into a validated, de-duplicated list of
 * Tesseract language tokens. Shape-only: it rejects anything that isn't a real
 * language token (which also blocks argument injection), but it does NOT verify a
 * language pack is installed — that can only be known by executing the engine, so
 * an absent pack surfaces later as an honest `failed` job, never a silent wrong
 * result.
 */
function parseLanguages(value: unknown): ParseResult<string[]> {
  if (value === undefined) return { ok: true, value: [...DEFAULT_OCR_LANGUAGES] };

  const raw = Array.isArray(value) ? value : [value];
  if (raw.length === 0) {
    return invalidOption(
      "`options.languages` must list at least one language.",
      "options.languages",
    );
  }
  if (raw.length > MAX_LANGUAGES) {
    return invalidOption(
      `\`options.languages\` accepts at most ${MAX_LANGUAGES} languages.`,
      "options.languages",
    );
  }

  const seen = new Set<string>();
  const languages: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !LANGUAGE_TOKEN.test(entry)) {
      return invalidOption(
        "Each language must be a Tesseract code like `eng`, `deu`, or `chi_sim`.",
        "options.languages",
      );
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      languages.push(entry);
    }
  }
  return { ok: true, value: languages };
}

/**
 * Parse and normalise an optional 1-based page range (`"1-3,5"`). Strict grammar,
 * bounded page numbers, and a token cap keep it a safe, tiny value to hand a
 * native engine as a single argv element. Ranges must be ascending. Returns the
 * canonical form (leading zeros stripped) or a field error.
 */
export function parsePageRange(value: unknown): ParseResult<string> {
  if (typeof value !== "string") {
    return invalidOption("`options.pages` must be a string.", "options.pages");
  }
  const trimmed = value.trim();
  if (!PAGE_RANGE_SHAPE.test(trimmed)) {
    return invalidOption(
      'Use a page range like "1-3,5" (1-based, comma-separated).',
      "options.pages",
    );
  }
  const tokens = trimmed.split(",");
  if (tokens.length > MAX_PAGE_TOKENS) {
    return invalidOption(
      `\`options.pages\` accepts at most ${MAX_PAGE_TOKENS} ranges.`,
      "options.pages",
    );
  }
  const canonical: string[] = [];
  for (const token of tokens) {
    const [startRaw, endRaw] = token.split("-");
    const start = Number(startRaw);
    if (!Number.isInteger(start) || start < 1 || start > MAX_OCR_PAGE) {
      return invalidOption(
        `Page numbers must be between 1 and ${MAX_OCR_PAGE}.`,
        "options.pages",
      );
    }
    if (endRaw === undefined) {
      canonical.push(`${start}`);
      continue;
    }
    const end = Number(endRaw);
    if (!Number.isInteger(end) || end < 1 || end > MAX_OCR_PAGE) {
      return invalidOption(
        `Page numbers must be between 1 and ${MAX_OCR_PAGE}.`,
        "options.pages",
      );
    }
    if (end < start) {
      return invalidOption(
        `Page range "${token}" must be ascending.`,
        "options.pages",
      );
    }
    canonical.push(`${start}-${end}`);
  }
  return { ok: true, value: canonical.join(",") };
}

function parseBoolean(
  value: unknown,
  field: string,
): ParseResult<boolean> {
  if (value === undefined) return { ok: true, value: false };
  if (typeof value !== "boolean") {
    return invalidOption(`\`${field}\` must be a boolean.`, field);
  }
  return { ok: true, value };
}

/**
 * Parse the free-form `options` bag from an OCR job into typed, validated options.
 * Strict: unknown output modes, malformed languages, bad page ranges, and
 * non-boolean flags are rejected with a field error. Unknown extra keys are
 * ignored (forward-compatible), exactly like the compression parser.
 */
export function parseOcrOptions(
  options: Record<string, unknown>,
): ParseResult<OcrOptions> {
  const languages = parseLanguages(options.languages);
  if (!languages.ok) return languages;

  const rawMode = options.outputMode ?? "searchable-pdf";
  if (!OUTPUT_MODES.includes(rawMode as OcrOutputMode)) {
    return invalidOption(
      '`options.outputMode` must be "searchable-pdf" or "text-sidecar".',
      "options.outputMode",
    );
  }
  const outputMode = rawMode as OcrOutputMode;

  const deskew = parseBoolean(options.deskew, "options.deskew");
  if (!deskew.ok) return deskew;
  const rotate = parseBoolean(options.rotate, "options.rotate");
  if (!rotate.ok) return rotate;
  const clean = parseBoolean(options.clean, "options.clean");
  if (!clean.ok) return clean;

  const rawStrategy = options.onExistingText ?? "skip";
  if (!EXISTING_TEXT_STRATEGIES.includes(rawStrategy as OcrExistingTextStrategy)) {
    return invalidOption(
      '`options.onExistingText` must be "skip", "force", or "redo".',
      "options.onExistingText",
    );
  }
  const onExistingText = rawStrategy as OcrExistingTextStrategy;

  let pages: string | undefined;
  if (options.pages !== undefined) {
    const parsed = parsePageRange(options.pages);
    if (!parsed.ok) return parsed;
    pages = parsed.value;
  }

  return {
    ok: true,
    value: {
      languages: languages.value,
      outputMode,
      deskew: deskew.value,
      rotate: rotate.value,
      clean: clean.value,
      onExistingText,
      ...(pages !== undefined ? { pages } : {}),
    },
  };
}

/** Command names probed for each OCR engine. */
export const OCR_ENGINE_BINARIES: Record<OcrEngine, string> = {
  ocrmypdf: "ocrmypdf",
  tesseract: "tesseract",
};

/** Probe which OCR engines are installed, using an injected resolver. */
export function probeOcrEngines(
  resolve: (binary: string) => boolean,
): OcrEngineAvailability {
  return {
    ocrmypdf: resolve(OCR_ENGINE_BINARIES.ocrmypdf),
    tesseract: resolve(OCR_ENGINE_BINARIES.tesseract),
  };
}

/**
 * PDF-level preprocessing (deskew / clean / page-range) and multi-page PDF inputs
 * can only be handled by ocrmypdf; Tesseract on its own cannot page through a PDF
 * or straighten a scan. This is the single rule that keeps engine selection honest.
 */
export function requiresOcrmypdf(
  options: OcrOptions,
  inputKind: OcrInputKind,
): boolean {
  return (
    inputKind === "pdf" ||
    options.deskew ||
    options.clean ||
    options.pages !== undefined
  );
}

/** The decision of how (or whether) an OCR request can run. */
export type OcrPlan =
  | { supported: true; engine: OcrEngineId }
  | { supported: false; requires: readonly OcrEngine[]; reason: string };

/**
 * Decide how a request can run given the host's available engines and the input
 * kind. PDF inputs and PDF-level preprocessing require ocrmypdf; a plain image
 * with no preprocessing can also run on Tesseract alone. When nothing usable is
 * installed the plan reports honestly which engines would satisfy it — it never
 * pretends a request can run.
 */
export function planOcr(
  options: OcrOptions,
  engines: OcrEngineAvailability,
  inputKind: OcrInputKind,
): OcrPlan {
  if (requiresOcrmypdf(options, inputKind)) {
    if (engines.ocrmypdf) return { supported: true, engine: "ocrmypdf" };
    return {
      supported: false,
      requires: ["ocrmypdf"],
      reason:
        "OCR of PDF documents (and deskew/clean/page-range options) requires the OCRmyPDF engine, which is not installed in this environment.",
    };
  }
  const available = OCR_ENGINES.find((engine) => engines[engine]);
  if (available) return { supported: true, engine: available };
  return {
    supported: false,
    requires: OCR_ENGINES,
    reason:
      "OCR requires a native engine (OCRmyPDF or Tesseract), which is not installed in this environment.",
  };
}

/** Map a MIME type to the OCR input kind, or `null` if it can't be OCR'd. */
export function ocrInputKindForContentType(
  contentType: string,
): OcrInputKind | null {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "application/pdf") return "pdf";
  if (base === "image/png" || base === "image/jpeg" || base === "image/jpg") {
    return "image";
  }
  return null;
}

/** The downloadable artefact type produced for each output mode. */
export function ocrArtifactType(mode: OcrOutputMode): {
  contentType: string;
  ext: string;
} {
  return mode === "text-sidecar"
    ? { contentType: "text/plain; charset=utf-8", ext: "txt" }
    : { contentType: "application/pdf", ext: "pdf" };
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.byteLength < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Cheap, honest magic-byte sniff: do these bytes actually look like the declared
 * input kind? Guards against a mislabelled upload reaching a native engine as
 * something it isn't. PDFs may carry a few leading bytes before the header, so we
 * scan a small prefix.
 */
export function looksLikeInputKind(
  bytes: Uint8Array,
  kind: OcrInputKind,
): boolean {
  if (kind === "pdf") {
    const limit = Math.min(bytes.byteLength, 1024);
    for (let i = 0; i <= limit - PDF_MAGIC.length; i++) {
      if (startsWith(bytes, PDF_MAGIC, i)) return true;
    }
    return false;
  }
  return startsWith(bytes, PNG_MAGIC) || startsWith(bytes, JPEG_MAGIC);
}

/**
 * Runs a native OCR engine over the input bytes and returns the produced artefact
 * bytes (a searchable PDF or a UTF-8 text sidecar, per `options.outputMode`).
 * Injected so the run path is testable without a binary and so the app server
 * never hard-links a child_process implementation.
 */
export type NativeOcr = (
  input: Uint8Array,
  ctx: { engine: OcrEngine; options: OcrOptions; inputKind: OcrInputKind },
) => Promise<Uint8Array>;

/** Everything {@link runOcr} needs, all injectable for tests. */
export interface OcrDeps {
  /** Which OCR engines are available on this host. */
  engines: OcrEngineAvailability;
  /** Native OCR executor (required only when an engine is available). */
  native?: NativeOcr;
  /** Input sniffer (defaults to the magic-byte check above). */
  sniff?: (bytes: Uint8Array, kind: OcrInputKind) => boolean;
}

/** Derived, serialisable metadata for a successful OCR run. */
export interface OcrResultMeta {
  engine: OcrEngineId;
  outputMode: OcrOutputMode;
  languages: string[];
  inputKind: OcrInputKind;
  originalBytes: number;
  outputBytes: number;
}

/**
 * The outcome of an OCR attempt. Every non-success case is explicit and honest —
 * there is no branch that returns fabricated text or a dummy searchable PDF.
 */
export type OcrRun =
  | {
      ok: true;
      output: Uint8Array;
      contentType: string;
      outputExt: string;
      meta: OcrResultMeta;
    }
  | { ok: false; kind: "unsupported"; requires: readonly OcrEngine[]; message: string }
  | { ok: false; kind: "invalid_input"; message: string }
  | { ok: false; kind: "failed"; message: string };

/**
 * Plan and run an OCR request. Returns an honest result:
 *  - `unsupported` when no installed engine can satisfy the request (nothing is
 *    executed, no text is invented),
 *  - `invalid_input` when the bytes don't match the declared input kind,
 *  - `failed` when a wired engine errors or produces nothing, and
 *  - a success carrying the real output bytes and metadata otherwise.
 */
export async function runOcr(
  input: Uint8Array,
  options: OcrOptions,
  ctx: { inputKind: OcrInputKind },
  deps: OcrDeps,
): Promise<OcrRun> {
  const plan = planOcr(options, deps.engines, ctx.inputKind);
  if (!plan.supported) {
    return {
      ok: false,
      kind: "unsupported",
      requires: plan.requires,
      message: plan.reason,
    };
  }

  const sniff = deps.sniff ?? looksLikeInputKind;
  if (!sniff(input, ctx.inputKind)) {
    return {
      ok: false,
      kind: "invalid_input",
      message:
        ctx.inputKind === "pdf"
          ? "The input could not be read as a PDF."
          : "The input could not be read as a PNG or JPEG image.",
    };
  }

  if (!deps.native) {
    return {
      ok: false,
      kind: "failed",
      message: "No native OCR executor is configured.",
    };
  }

  let output: Uint8Array;
  try {
    output = await deps.native(input, {
      engine: plan.engine,
      options,
      inputKind: ctx.inputKind,
    });
  } catch {
    // Never leak the raw engine error text to the client.
    return {
      ok: false,
      kind: "failed",
      message: "The OCR engine failed to process this file.",
    };
  }

  if (output.byteLength === 0) {
    return {
      ok: false,
      kind: "failed",
      message: "The OCR engine produced no output.",
    };
  }

  const { contentType, ext } = ocrArtifactType(options.outputMode);
  return {
    ok: true,
    output,
    contentType,
    outputExt: ext,
    meta: {
      engine: plan.engine,
      outputMode: options.outputMode,
      languages: options.languages,
      inputKind: ctx.inputKind,
      originalBytes: input.byteLength,
      outputBytes: output.byteLength,
    },
  };
}
