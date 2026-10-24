/**
 * High-quality PDF compression engine (server / secure-worker side).
 *
 * This is deliberately SEPARATE from the in-browser Compress analyzer in
 * `@/lib/pdf/analyze`. That tool runs on the user's device and only ever does a
 * lossless structural repack — it never pretends to downsample images. This
 * engine is what a secure worker runs, and it is honest about the exact same
 * boundary:
 *
 *   - `lossless` — structural repack via pdf-lib. Pure JavaScript, always
 *     available, real, and safe (no rendered content changes).
 *   - `deep` — image downsampling / re-encoding. This genuinely requires a
 *     native binary (Ghostscript, qpdf, or mutool). If none is installed the
 *     engine returns an honest `unsupported` result; it NEVER fabricates a
 *     smaller file.
 *
 * The planner and orchestration are pure and dependency-injected, so both the
 * "no binary → honest failure" path and the "binary present → real invocation"
 * path are fully unit-testable without shipping a native binary in CI.
 */

import { PDFDocument } from "pdf-lib";
import { countPdfPagesDetailed } from "@/lib/pdf/page-count";
import { apiError, type ParseResult } from "@/lib/jobs";
import { hasColourImage } from "./image-colour";

/**
 * How hard to compress:
 * - `lossless`: structural repack only, no quality change (JS, always works).
 * - `deep`: image downsampling / re-encoding (requires a native engine).
 */
export type CompressionProfile = "lossless" | "deep";

/** Native engines the deep path can use, in the order it prefers them. */
export const DEEP_COMPRESSION_TOOLS = [
  "ghostscript",
  "qpdf",
  "mutool",
] as const;
export type CompressionTool = (typeof DEEP_COMPRESSION_TOOLS)[number];

/** Which native engines are present on the host (presence only, never values). */
export type ToolAvailability = Record<CompressionTool, boolean>;

/** The engine that actually did (or would do) the work. */
export type CompressionEngineId = "lossless-js" | CompressionTool;

export const DEFAULT_TARGET_DPI = 150;
const MIN_DPI = 72;
const MAX_DPI = 600;

/** Validated, tool-specific compression options parsed from a job request. */
export interface CompressionOptions {
  profile: CompressionProfile;
  /** Target DPI for image downsampling (deep only); clamped to 72–600. */
  targetDpi: number;
  /**
   * Convert colour to gray (deep only, Ghostscript only). Optional in the type
   * so a hand-built options object keeps meaning "colour unchanged"; the
   * parser always sets it.
   */
  grayscale?: boolean;
}

/**
 * Parse the free-form `options` bag from a compression job into typed options.
 * The worker exists for *deep* compression, so that is the default; `lossless`
 * is available explicitly for parity with the in-browser tool. Strict: unknown
 * profiles and out-of-range DPI values are rejected with a field error.
 */
export function parseCompressionOptions(
  options: Record<string, unknown>,
): ParseResult<CompressionOptions> {
  const rawProfile = options.profile ?? "deep";
  if (rawProfile !== "lossless" && rawProfile !== "deep") {
    return {
      ok: false,
      error: apiError(
        "invalid_request",
        '`options.profile` must be "lossless" or "deep".',
        [
          {
            field: "options.profile",
            message: 'Expected "lossless" or "deep".',
          },
        ],
      ),
    };
  }

  let targetDpi = DEFAULT_TARGET_DPI;
  if (options.targetDpi !== undefined) {
    const dpi = options.targetDpi;
    if (
      typeof dpi !== "number" ||
      !Number.isInteger(dpi) ||
      dpi < MIN_DPI ||
      dpi > MAX_DPI
    ) {
      return {
        ok: false,
        error: apiError(
          "invalid_request",
          `\`options.targetDpi\` must be an integer between ${MIN_DPI} and ${MAX_DPI}.`,
          [{ field: "options.targetDpi", message: "Out of range." }],
        ),
      };
    }
    targetDpi = dpi;
  }

  let grayscale = false;
  if (options.grayscale !== undefined) {
    if (typeof options.grayscale !== "boolean") {
      return {
        ok: false,
        error: apiError(
          "invalid_request",
          "`options.grayscale` must be a boolean.",
          [{ field: "options.grayscale", message: "Expected a boolean." }],
        ),
      };
    }
    grayscale = options.grayscale;
  }
  // The lossless repack re-serialises a parsed document and never touches a
  // pixel, so it cannot honour this. Refused rather than silently ignored: a
  // file that came back in colour would be a success nobody asked for.
  if (grayscale && rawProfile === "lossless") {
    return {
      ok: false,
      error: apiError(
        "invalid_request",
        '`options.grayscale` needs the "deep" profile.',
        [
          {
            field: "options.grayscale",
            message: 'Grayscale needs the "deep" profile.',
          },
        ],
      ),
    };
  }

  return { ok: true, value: { profile: rawProfile, targetDpi, grayscale } };
}

/**
 * The deep engines that can convert colour to gray. Only Ghostscript re-renders
 * content through a colour model; qpdf and mutool rewrite structure and streams
 * and have no colour conversion at all.
 */
export const GRAYSCALE_TOOLS: readonly CompressionTool[] = ["ghostscript"];

/** Resolves whether a binary exists on the host. Presence only; never executes. */
export type BinaryResolver = (binary: string) => boolean;

/** Command names probed for each deep-compression engine. */
export const TOOL_BINARIES: Record<CompressionTool, string> = {
  ghostscript: "gs",
  qpdf: "qpdf",
  mutool: "mutool",
};

/** Probe which deep-compression engines are installed, using an injected resolver. */
export function probeCompressionTools(
  resolve: BinaryResolver,
): ToolAvailability {
  return {
    ghostscript: resolve(TOOL_BINARIES.ghostscript),
    qpdf: resolve(TOOL_BINARIES.qpdf),
    mutool: resolve(TOOL_BINARIES.mutool),
  };
}

/** The decision of how (or whether) a compression request can run. */
export type CompressionPlan =
  | { supported: true; engine: CompressionEngineId }
  | { supported: false; requires: readonly CompressionTool[]; reason: string };

/**
 * Decide how a request can run given the host's available engines. `lossless`
 * always resolves to the JS repacker; `deep` picks the first available native
 * engine, or reports honestly that none is installed.
 */
export function planCompression(
  options: CompressionOptions,
  tools: ToolAvailability,
): CompressionPlan {
  if (options.profile === "lossless") {
    return { supported: true, engine: "lossless-js" };
  }
  if (options.grayscale) {
    const gray = GRAYSCALE_TOOLS.find((tool) => tools[tool]);
    if (gray) return { supported: true, engine: gray };
    return {
      supported: false,
      requires: GRAYSCALE_TOOLS,
      reason:
        "Grayscale conversion requires Ghostscript, which is not installed in this environment.",
    };
  }
  const available = DEEP_COMPRESSION_TOOLS.find((tool) => tools[tool]);
  if (available) return { supported: true, engine: available };
  return {
    supported: false,
    requires: DEEP_COMPRESSION_TOOLS,
    reason:
      "Deep image compression requires a native engine (Ghostscript, qpdf, or mutool), which is not installed in this environment.",
  };
}

/** The producer/creator stamped onto worker-repacked PDFs (distinct from the browser tool). */
export const WORKER_PRODUCER = "pdf.xyz secure worker";

// %PDF- header and %%EOF trailer markers, as raw bytes.
const PDF_HEADER = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d);
const PDF_EOF = Uint8Array.of(0x25, 0x25, 0x45, 0x4f, 0x46);

/** True when `needle` occurs in `haystack[start, end)`. */
function containsSequence(
  haystack: Uint8Array,
  needle: Uint8Array,
  start: number,
  end: number,
): boolean {
  const last = end - needle.length;
  for (let i = Math.max(0, start); i <= last; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Cheap, robust structural PDF check: the `%PDF-` header appears near the start
 * and the `%%EOF` trailer near the end, with a plausible minimum length. This is
 * the default gate that keeps the deep path honest — it reliably rejects an empty
 * file, a truncated file, or an error message written to the output path, without
 * the false-negative risk of a full parse on unusual-but-valid PDFs. It reads only
 * bounded windows, so validating a large artifact stays cheap.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 32) return false;
  // The spec allows a few junk bytes before the header; native engines emit it at
  // offset 0, so a 1 KiB window is generous.
  const headEnd = Math.min(bytes.byteLength, 1024);
  if (!containsSequence(bytes, PDF_HEADER, 0, headEnd)) return false;
  // Trailing whitespace/newlines after %%EOF are common; scan the last 2 KiB.
  const tailStart = Math.max(0, bytes.byteLength - 2048);
  return containsSequence(bytes, PDF_EOF, tailStart, bytes.byteLength);
}

/**
 * The floor for a tool whose job is to REPAIR a damaged PDF: a header, and a
 * plausible minimum length. Deliberately weaker than {@link looksLikePdf}.
 *
 * `looksLikePdf` requires `%%EOF` near the end, which is exactly the byte a
 * truncated file has lost — the commonest damage, and the file a user brings to
 * a repair tool. Using it as repair-pdf's INPUT check meant the tool rejected
 * its entire reason to exist as `invalid_pdf` and never spawned qpdf.
 *
 * The floor moved rather than disappearing. Without a `%PDF-` header there is no
 * document to recover and qpdf would only burn a subprocess to say so, so that
 * much is still required — the same window `looksLikePdf` uses, so the two
 * predicates disagree about exactly one thing and it is the one they should.
 * This is an INPUT floor only: repair output is still held to `looksLikePdf`.
 */
export function looksRepairable(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 32) return false;
  const headEnd = Math.min(bytes.byteLength, 1024);
  return containsSequence(bytes, PDF_HEADER, 0, headEnd);
}

/**
 * Real, lossless structural repack via pdf-lib. Re-serializes with object
 * streams and refreshes the producer; it never changes rendered content. Throws
 * if the bytes are not a readable PDF.
 */
export async function losslessRepack(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  doc.setProducer(WORKER_PRODUCER);
  doc.setCreator(WORKER_PRODUCER);
  return doc.save({ useObjectStreams: true });
}

/**
 * Runs a native deep-compression engine over the input bytes and returns the
 * compressed bytes. Injected so the deep path is testable without a binary and
 * so the app server never hard-links a child_process implementation.
 */
export type NativeCompressor = (
  input: Uint8Array,
  ctx: { engine: CompressionTool; options: CompressionOptions },
) => Promise<Uint8Array>;

/** Strict resource limits enforced by the deep/native path (lossless is unaffected). */
export interface CompressionLimits {
  /**
   * Max input size accepted by the DEEP path, in bytes. When set and the input
   * exceeds it, the deep path fails honestly as `too_large` before anything is
   * spawned. Lossless (in-process pdf-lib) is intentionally not limited here.
   */
  maxInputBytes?: number;
  /**
   * Largest artifact the page check will parse. Above it the count is reported
   * as unknown rather than attempted — pdf-lib loads a whole document into
   * memory, so this is a real budget line and not a formality.
   */
  maxPageCountParseBytes?: number;
}

/**
 * Default ceiling for the page check. Chosen to sit at the deep path's own input
 * limit rather than below it: a ceiling under the accepted file size would make
 * every large job `unverified`, which is the quiet way a gate stops meaning
 * anything.
 */
const MAX_PAGE_PARSE_BYTES = 200 * 1024 * 1024;

/** Everything {@link runCompression} needs, all injectable for tests. */
export interface CompressionDeps {
  /** Which native engines are available on this host. */
  tools: ToolAvailability;
  /** Lossless repacker (defaults to the pdf-lib implementation above). */
  repack?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** Native deep compressor (required only when a deep engine is available). */
  native?: NativeCompressor;
  /**
   * Validate that produced/candidate bytes are a usable PDF before they are ever
   * accepted as an artifact (deep path only). Defaults to {@link looksLikePdf}, a
   * cheap structural header/trailer check; a deployment may inject a stricter one.
   */
  validate?: (bytes: Uint8Array) => boolean | Promise<boolean>;
  /** Strict resource limits for the native/deep path. */
  limits?: CompressionLimits;
}

/** Derived, serializable metrics for a successful compression run. */
export interface CompressionResultMeta {
  engine: CompressionEngineId;
  profile: CompressionProfile;
  /**
   * Whether the artifact was converted to gray. When true, the output is the
   * engine's gray file even if it is not smaller: handing back the colour
   * original under a grayscale request would be the wrong document.
   */
  grayscale: boolean;
  originalBytes: number;
  outputBytes: number;
  /** Bytes saved; never negative (a repack that grows a file reports 0). */
  savedBytes: number;
  /**
   * Fraction saved, 0–1.
   *
   * READ THIS WITH `pageCheck`. Until 2026-08-11 this number was the product's
   * headline success metric and it was computed from bytes alone, so a native
   * engine that silently dropped 197 of 200 pages reported a 98% saving — the
   * more of the document it destroyed, the better the run looked. It is only a
   * compression figure when `pageCheck === "verified"`; otherwise it is a size
   * difference between two files whose relationship was not established.
   */
  savedRatio: number;
  /**
   * Whether the output was proven to still contain the input's pages.
   *
   * - `verified`    — both counts known, and the output has at least as many.
   * - `not-applicable` — the lossless in-browser repack, which cannot lose pages
   *   because it re-serializes a parsed document rather than re-rendering it.
   * - `unverified`  — the INPUT could not be counted (unparseable, or above the
   *   parse ceiling). The artifact still ships; the CLAIM does not. Failing here
   *   would break the largest files a user has, which is the pressure that ends
   *   with the gate being deleted.
   *
   * There is no `unverified` for an unreadable OUTPUT: we produced that file, so
   * our own parser failing on it is evidence against the artifact, not missing
   * information. That case fails. The one exception is the no-worse swap, where
   * the "output" is the person's original returned unchanged: we did not
   * produce it, and it is `unverified` exactly as its input count is.
   */
  pageCheck: "verified" | "unverified" | "not-applicable";
  /** Input page count when known; `null` when it could not be established. */
  pagesIn: number | null;
  /** Output page count when known; `null` on the paths that do not measure it. */
  pagesOut: number | null;
}

/**
 * The outcome of a compression attempt. Every non-success case is explicit and
 * honest — there is no branch that returns fabricated output.
 */
export type CompressionRun =
  | { ok: true; output: Uint8Array; meta: CompressionResultMeta }
  | {
      ok: false;
      kind: "unsupported";
      requires: readonly CompressionTool[];
      message: string;
    }
  | { ok: false; kind: "invalid_pdf"; message: string }
  | { ok: false; kind: "too_large"; limitBytes: number; message: string }
  /**
   * The deep engine returned a readable PDF with FEWER pages than it was given.
   * Its own kind rather than `failed`, because the numbers are the useful part
   * of the message and because this is not transient — retrying the same bytes
   * through the same engine loses the same pages.
   */
  | {
      ok: false;
      kind: "page_loss";
      pagesIn: number;
      pagesOut: number;
      message: string;
    }
  /**
   * A grayscale run whose output still carries a colour image. Not `failed`:
   * the same engine given the same flag keeps the same colour, so it is final.
   */
  | { ok: false; kind: "colour_kept"; message: string }
  | { ok: false; kind: "failed"; message: string };

/**
 * Plan and run a compression request. Returns an honest result:
 *  - `unsupported` when the requested profile needs a native engine that is not
 *    installed (nothing is executed, no output is invented),
 *  - `too_large` when the deep-path input exceeds the configured size limit
 *    (rejected before anything is spawned),
 *  - `invalid_pdf` when the input cannot be read as a PDF,
 *  - `failed` when a wired engine errors or produces an unreadable PDF, and
 *  - a success carrying the real output bytes and size metrics otherwise.
 *
 * Deep-path honesty guarantees (the "valid and no-worse" policy):
 *  - the engine's output is accepted only after it passes PDF validation
 *    (`deps.validate`, default {@link looksLikePdf}) — an unreadable result is a
 *    `failed` run, never a fabricated success;
 *  - the artifact is never larger than the input — if deep compression cannot
 *    reduce the file (already-optimized / text-only PDFs), the original bytes are
 *    returned unchanged with honest zero-savings metrics rather than a bigger file.
 */
export async function runCompression(
  input: Uint8Array,
  options: CompressionOptions,
  deps: CompressionDeps,
): Promise<CompressionRun> {
  const plan = planCompression(options, deps.tools);
  if (!plan.supported) {
    return {
      ok: false,
      kind: "unsupported",
      requires: plan.requires,
      message: plan.reason,
    };
  }

  const isNative = plan.engine !== "lossless-js";

  // Strict input limit: reject an oversized deep-path job before writing a temp
  // file or spawning a subprocess. Deterministic, so it is a terminal failure.
  if (isNative && deps.limits?.maxInputBytes !== undefined) {
    if (input.byteLength > deps.limits.maxInputBytes) {
      return {
        ok: false,
        kind: "too_large",
        limitBytes: deps.limits.maxInputBytes,
        message:
          "The input PDF exceeds the worker's size limit for deep compression.",
      };
    }
  }

  let output: Uint8Array;
  try {
    // Compare `plan.engine` directly (not the `isNative` alias) so TypeScript
    // narrows it to a `CompressionTool` for the native call below.
    if (plan.engine === "lossless-js") {
      output = await (deps.repack ?? losslessRepack)(input);
    } else {
      if (!deps.native) {
        return {
          ok: false,
          kind: "failed",
          message: "No native compressor executor is configured.",
        };
      }
      output = await deps.native(input, { engine: plan.engine, options });
    }
  } catch {
    // A lossless throw almost always means the bytes weren't a readable PDF; a
    // native throw is an engine/runtime failure. Never leak the raw error text.
    if (!isNative) {
      return {
        ok: false,
        kind: "invalid_pdf",
        message: "The input could not be read as a PDF.",
      };
    }
    return {
      ok: false,
      kind: "failed",
      message: "The compression engine failed to process this file.",
    };
  }

  // Deep path: never accept the engine's output without validating it is a real,
  // readable PDF, and never hand back a file larger than the input.
  let pageCheck: CompressionResultMeta["pageCheck"] = "not-applicable";
  let pagesIn: number | null = null;
  let pagesOut: number | null = null;
  // True when the no-worse policy below handed back the person's own bytes.
  let returnedOriginal = false;
  if (isNative) {
    const validate = deps.validate ?? looksLikePdf;
    if (!(await validate(output))) {
      return {
        ok: false,
        kind: "failed",
        message: "The compression engine produced an unreadable PDF.",
      };
    }
    if (options.grayscale) {
      // The one property this request adds, read from the file itself. An
      // engine that ignored the flag returns a smaller COLOUR file, which
      // every other gate here would accept. An output pdf-lib cannot parse is
      // left to the page check below, which fails it.
      let colour = false;
      try {
        colour = await hasColourImage(output);
      } catch {
        colour = false;
      }
      if (colour) {
        return {
          ok: false,
          kind: "colour_kept",
          message:
            "The compression engine did not convert this file to grayscale, so it was rejected. Your original file is unchanged.",
        };
      }
    }
    // A grayscale run never swaps the original back: the original is in
    // colour, and the person asked for gray. A larger gray file ships, with
    // zero savings reported.
    if (output.byteLength >= input.byteLength && !options.grayscale) {
      // Deep compression did not reduce the file. Return the original rather than
      // a larger artifact — but only if the original is itself a readable PDF, so
      // we never dress up non-PDF bytes as a successful result.
      if (!(await validate(input))) {
        return {
          ok: false,
          kind: "failed",
          message: "The compression engine produced an unreadable PDF.",
        };
      }
      output = input;
      returnedOriginal = true;
    }

    // The page check runs on the FINAL artifact, after the swap above — the
    // question is about the file the user receives, not the one the engine
    // happened to emit.
    const ceiling = deps.limits?.maxPageCountParseBytes ?? MAX_PAGE_PARSE_BYTES;
    const countIn = await countPdfPagesDetailed(input, ceiling);
    const countOut = await countPdfPagesDetailed(output, ceiling);
    pagesIn = countIn.ok ? countIn.count : null;
    pagesOut = countOut.ok ? countOut.count : null;

    if (!countOut.ok && !returnedOriginal) {
      // We produced this file and `looksLikePdf` blessed it, and our own parser
      // cannot find its page tree. That is not missing information.
      //
      // Only when WE produced it. After the swap above the artifact is the
      // person's own upload, byte for byte, and a failed count of it is the
      // same unknown as a failed count of the input — not evidence against
      // anything. Until 2026-09-27 this branch fired there too: a
      // permissions-only PDF with object streams (pdf-lib cannot decrypt the
      // stream that holds its page tree) that Ghostscript could not shrink was
      // reported as "an unreadable PDF" — about the file the person uploaded.
      return {
        ok: false,
        kind: "failed",
        message: "The compression engine produced an unreadable PDF.",
      };
    }
    if (countIn.ok && countOut.ok) {
      if (countOut.count < countIn.count) {
        return {
          ok: false,
          kind: "page_loss",
          pagesIn: countIn.count,
          pagesOut: countOut.count,
          message:
            "Compression finished but the result was missing pages, so it was rejected. Your original file is unchanged.",
        };
      }
      pageCheck = "verified";
    } else {
      // The input could not be counted (and, when the original came back, nor
      // could the output, which is the same bytes). The file may ship; the
      // CLAIM may not.
      pageCheck = "unverified";
    }
  }

  const originalBytes = input.byteLength;
  const outputBytes = output.byteLength;
  const savedBytes = Math.max(0, originalBytes - outputBytes);
  const savedRatio = originalBytes > 0 ? savedBytes / originalBytes : 0;
  return {
    ok: true,
    output,
    meta: {
      pageCheck,
      pagesIn,
      pagesOut,
      engine: plan.engine,
      profile: options.profile,
      grayscale: options.grayscale === true,
      originalBytes,
      outputBytes,
      savedBytes,
      savedRatio,
    },
  };
}
