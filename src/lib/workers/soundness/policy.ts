/**
 * The **configuration + tool-family policy** for the worker file-soundness gate:
 * given an environment it resolves a bounded {@link SoundnessPolicy}, and given a
 * tool slug it derives the input families that tool accepts from the EXISTING
 * job/tool contracts (so the two never drift).
 *
 * The gate ships ENABLED by default with a conservative policy — reject empty
 * bytes, and reject a PDF-expected input that lacks a `%PDF-` header — because the
 * check needs no backend and makes no security claim (unlike the malware scanner,
 * which is opt-in precisely because it *does*). The stricter, higher-false-positive
 * checks (`%%EOF` trailer, a hard max-bytes ceiling) are OPT-IN, off by default.
 * An operator can disable the whole gate with {@link SOUNDNESS_ENV.enabled}.
 *
 * Strict, fail-safe parsing mirrors `../scanner/config`, `../../uploads/intake/policy`,
 * and `../queue/redis-config`: each knob resolves independently, a malformed value
 * falls back to its safe default (never throws, never disturbs another knob), and
 * only variable NAMES ever appear in diagnostics — never a value. This module is
 * pure and node-free: it reads config and the static tool catalog, opens no socket
 * and touches no filesystem.
 */

import { MIME_BY_FORMAT } from "@/lib/jobs";
import { getToolBySlug } from "@/lib/tools";
import {
  DEFAULT_INTAKE_POLICY,
  familyForMime,
  type UploadFamily,
} from "@/lib/uploads/intake";

type EnvSource = Record<string, string | undefined>;

/**
 * Stable identity of the worker file-soundness policy, stamped on quarantine
 * receipts and diagnostics. The id is a fixed slug; the version is the policy
 * *schema* version (the set of checks/fields), bumped when the shape changes — NOT
 * the operator's tuned knob values, which are never surfaced.
 */
export const SOUNDNESS_POLICY_ID = "pdfxyz-worker-soundness";
export const SOUNDNESS_POLICY_VERSION = 1;

/** The variable names the gate reads (values are read to configure, never surfaced). */
export const SOUNDNESS_ENV = {
  /** Master switch. Recognized OFF tokens disable the gate; default ON. */
  enabled: "PDFXYZ_WORKER_SOUNDNESS",
  /** Hard per-input byte ceiling. `0`/unset ⇒ no ceiling (opt-in). */
  maxBytes: "PDFXYZ_WORKER_SOUNDNESS_MAX_BYTES",
  /** Hard per-job input-count ceiling (bounded file-count sanity). */
  maxInputs: "PDFXYZ_WORKER_SOUNDNESS_MAX_INPUTS",
  /** Require a `%PDF-` header for PDF-expected inputs. Default ON. */
  requireHeader: "PDFXYZ_WORKER_SOUNDNESS_REQUIRE_PDF_HEADER",
  /** Require a `%%EOF` marker for PDF-expected inputs. Default OFF (opt-in). */
  requireEof: "PDFXYZ_WORKER_SOUNDNESS_REQUIRE_PDF_EOF",
  /** Reject a declared content-type the tool does not accept, or that disagrees with
   *  the filename extension. Default ON. */
  checkContentType: "PDFXYZ_WORKER_SOUNDNESS_CHECK_CONTENT_TYPE",
  /** Verify the fetched byte count matches the declared size, when one was stored. Default ON. */
  checkSize: "PDFXYZ_WORKER_SOUNDNESS_CHECK_SIZE",
  /** Leading window (bytes) scanned for the `%PDF-` header. */
  headerScanBytes: "PDFXYZ_WORKER_SOUNDNESS_HEADER_SCAN_BYTES",
  /** Trailing window (bytes) scanned for the `%%EOF` marker. */
  trailerScanBytes: "PDFXYZ_WORKER_SOUNDNESS_TRAILER_SCAN_BYTES",
} as const;

/** Per-knob sanity bounds; an out-of-range value falls back to the default. */
export const SOUNDNESS_BOUNDS = {
  /** 0 (disabled) up to 2 GiB — a generous backstop well above the intake ceiling. */
  maxBytes: { min: 0, max: 2_147_483_648 },
  /** At least one input; up to a generous cap so a mis-queued job with an absurd
   *  input count is caught without disturbing legitimate multi-input jobs. */
  maxInputs: { min: 1, max: 10_000 },
  /** At least the 5-byte signature; up to 1 MiB so a huge window can never balloon cost. */
  headerScanBytes: { min: 8, max: 1_048_576 },
  trailerScanBytes: { min: 8, max: 1_048_576 },
} as const;

/** A fully-resolved, bounded soundness policy the gate consumes. */
export interface SoundnessPolicy {
  /** Master switch. When false the gate returns `skipped` and checks nothing. */
  readonly enabled: boolean;
  /** Hard per-input byte ceiling; `0` disables the check. */
  readonly maxBytes: number;
  /** Hard per-job input-count ceiling (bounded file-count sanity). */
  readonly maxInputs: number;
  /** Require a `%PDF-` header for inputs expected to be PDFs. */
  readonly requireHeader: boolean;
  /** Require a `%%EOF` marker for inputs expected to be PDFs. */
  readonly requireEof: boolean;
  /** Reject an input whose declared content-type the tool does not accept, or that
   *  disagrees with its filename extension. */
  readonly checkContentType: boolean;
  /** Verify the fetched byte count matches the declared size, when one was recovered. */
  readonly checkSize: boolean;
  /** Leading window scanned for the header. */
  readonly headerScanBytes: number;
  /** Trailing window scanned for the trailer. */
  readonly trailerScanBytes: number;
}

/**
 * The shipped default: enabled, header-required, content-type + size checks on,
 * EOF/max-bytes opt-in, and a per-job input-count ceiling aligned to the intake
 * layer's file cap so the worker never rejects an input count the public boundary
 * already allowed. Frozen.
 */
export const DEFAULT_SOUNDNESS_POLICY: SoundnessPolicy = Object.freeze({
  enabled: true,
  maxBytes: 0,
  maxInputs: DEFAULT_INTAKE_POLICY.maxFiles,
  requireHeader: true,
  requireEof: false,
  checkContentType: true,
  checkSize: true,
  headerScanBytes: 1024,
  trailerScanBytes: 1024,
});

/** Tokens that explicitly turn a boolean flag ON (case-insensitive). */
const TRUE_TOKENS = new Set(["1", "true", "yes", "on", "enabled"]);
/** Tokens that explicitly turn a boolean flag OFF (case-insensitive). */
const FALSE_TOKENS = new Set(["0", "false", "no", "off", "disabled", "none"]);

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve a boolean flag with an explicit default: an unrecognized or absent value
 * keeps `fallback`, so a typo never silently flips a default-on check off (or a
 * default-off one on). Only clear ON/OFF tokens move the flag.
 */
function readBool(env: EnvSource, name: string, fallback: boolean): boolean {
  const raw = read(env, name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (TRUE_TOKENS.has(raw)) return true;
  if (FALSE_TOKENS.has(raw)) return false;
  return fallback;
}

/** Parse a bounded integer knob; an out-of-range/malformed value falls back safely. */
function boundedInt(
  env: EnvSource,
  name: string,
  bounds: { readonly min: number; readonly max: number },
  fallback: number,
): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  // Reject anything that is not a plain base-10 integer (no `1e9`, `0x10`, `1.5`, `1kb`).
  if (!/^-?\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
    return fallback;
  }
  return value;
}

/**
 * Resolve the soundness policy from an environment. Deterministic; `env` injectable.
 * Every knob is parsed independently against {@link SOUNDNESS_BOUNDS} and defaults to
 * {@link DEFAULT_SOUNDNESS_POLICY}; a bad value is ignored (never throws, never leaks).
 */
export function resolveSoundnessPolicy(
  env: EnvSource = process.env,
): SoundnessPolicy {
  return {
    enabled: readBool(env, SOUNDNESS_ENV.enabled, DEFAULT_SOUNDNESS_POLICY.enabled),
    maxBytes: boundedInt(
      env,
      SOUNDNESS_ENV.maxBytes,
      SOUNDNESS_BOUNDS.maxBytes,
      DEFAULT_SOUNDNESS_POLICY.maxBytes,
    ),
    maxInputs: boundedInt(
      env,
      SOUNDNESS_ENV.maxInputs,
      SOUNDNESS_BOUNDS.maxInputs,
      DEFAULT_SOUNDNESS_POLICY.maxInputs,
    ),
    requireHeader: readBool(
      env,
      SOUNDNESS_ENV.requireHeader,
      DEFAULT_SOUNDNESS_POLICY.requireHeader,
    ),
    requireEof: readBool(
      env,
      SOUNDNESS_ENV.requireEof,
      DEFAULT_SOUNDNESS_POLICY.requireEof,
    ),
    checkContentType: readBool(
      env,
      SOUNDNESS_ENV.checkContentType,
      DEFAULT_SOUNDNESS_POLICY.checkContentType,
    ),
    checkSize: readBool(
      env,
      SOUNDNESS_ENV.checkSize,
      DEFAULT_SOUNDNESS_POLICY.checkSize,
    ),
    headerScanBytes: boundedInt(
      env,
      SOUNDNESS_ENV.headerScanBytes,
      SOUNDNESS_BOUNDS.headerScanBytes,
      DEFAULT_SOUNDNESS_POLICY.headerScanBytes,
    ),
    trailerScanBytes: boundedInt(
      env,
      SOUNDNESS_ENV.trailerScanBytes,
      SOUNDNESS_BOUNDS.trailerScanBytes,
      DEFAULT_SOUNDNESS_POLICY.trailerScanBytes,
    ),
  };
}

/**
 * The coarse input families a tool accepts, derived from the SAME tool/job contracts
 * the intake and validation layers use: the catalog tool's `accept` formats →
 * {@link MIME_BY_FORMAT} → the intake {@link familyForMime} table. An unknown tool
 * (not in the catalog) yields an empty set, so the gate applies only universal
 * checks and never guesses an expected format. Pure; no I/O.
 */
export function acceptedFamiliesForTool(
  tool: string,
): ReadonlySet<UploadFamily> {
  const families = new Set<UploadFamily>();
  const spec = getToolBySlug(tool);
  if (!spec) return families;
  for (const format of spec.accept) {
    for (const mime of MIME_BY_FORMAT[format.toUpperCase()] ?? []) {
      const family = familyForMime(mime);
      if (family) families.add(family);
    }
  }
  return families;
}

/**
 * Decide whether a single input should be treated as a PDF (and thus subjected to
 * the `%PDF-`/`%%EOF` envelope checks), given the tool's accepted families and the
 * input's own declared family. Conservative — it only asserts "PDF" when it can
 * honestly tell, so a valid image sent to a multi-format tool (e.g. OCR, which
 * accepts PDF/JPG/PNG) is never mistaken for a broken PDF:
 *  - the tool must accept PDF at all;
 *  - a declared `pdf` family ⇒ yes;
 *  - an unrecognized/absent declared family ⇒ yes ONLY when PDF is the tool's sole
 *    accepted family (nothing else it could be), so a mislabeled input to a
 *    PDF-only tool is still caught;
 *  - a declared non-PDF known family (e.g. `image`) ⇒ no — it is that other thing.
 */
export function inputExpectedAsPdf(
  accepted: ReadonlySet<UploadFamily>,
  declaredFamily: UploadFamily | null,
): boolean {
  if (!accepted.has("pdf")) return false;
  if (declaredFamily === "pdf") return true;
  if (declaredFamily === null) return accepted.size === 1;
  return false;
}
