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
import { apiError, type ParseResult } from "@/lib/jobs";

/**
 * How hard to compress:
 * - `lossless`: structural repack only, no quality change (JS, always works).
 * - `deep`: image downsampling / re-encoding (requires a native engine).
 */
export type CompressionProfile = "lossless" | "deep";

/** Native engines the deep path can use, in the order it prefers them. */
export const DEEP_COMPRESSION_TOOLS = ["ghostscript", "qpdf", "mutool"] as const;
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
        [{ field: "options.profile", message: 'Expected "lossless" or "deep".' }],
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

  return { ok: true, value: { profile: rawProfile, targetDpi } };
}

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

/** Everything {@link runCompression} needs, all injectable for tests. */
export interface CompressionDeps {
  /** Which native engines are available on this host. */
  tools: ToolAvailability;
  /** Lossless repacker (defaults to the pdf-lib implementation above). */
  repack?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** Native deep compressor (required only when a deep engine is available). */
  native?: NativeCompressor;
}

/** Derived, serializable metrics for a successful compression run. */
export interface CompressionResultMeta {
  engine: CompressionEngineId;
  profile: CompressionProfile;
  originalBytes: number;
  outputBytes: number;
  /** Bytes saved; never negative (a repack that grows a file reports 0). */
  savedBytes: number;
  /** Fraction saved, 0–1. */
  savedRatio: number;
}

/**
 * The outcome of a compression attempt. Every non-success case is explicit and
 * honest — there is no branch that returns fabricated output.
 */
export type CompressionRun =
  | { ok: true; output: Uint8Array; meta: CompressionResultMeta }
  | { ok: false; kind: "unsupported"; requires: readonly CompressionTool[]; message: string }
  | { ok: false; kind: "invalid_pdf"; message: string }
  | { ok: false; kind: "failed"; message: string };

/**
 * Plan and run a compression request. Returns an honest result:
 *  - `unsupported` when the requested profile needs a native engine that is not
 *    installed (nothing is executed, no output is invented),
 *  - `invalid_pdf` when the input cannot be read as a PDF,
 *  - `failed` when a wired engine errors, and
 *  - a success carrying the real output bytes and size metrics otherwise.
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

  let output: Uint8Array;
  try {
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
    if (plan.engine === "lossless-js") {
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

  const originalBytes = input.byteLength;
  const outputBytes = output.byteLength;
  const savedBytes = Math.max(0, originalBytes - outputBytes);
  const savedRatio = originalBytes > 0 ? savedBytes / originalBytes : 0;
  return {
    ok: true,
    output,
    meta: {
      engine: plan.engine,
      profile: options.profile,
      originalBytes,
      outputBytes,
      savedBytes,
      savedRatio,
    },
  };
}
