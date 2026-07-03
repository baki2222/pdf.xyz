/**
 * The typed contract for the secure-worker **file soundness gate** — a bounded,
 * content-free preflight the executor runs on a job's already-read input bytes
 * immediately after they are fetched from storage and BEFORE the malware scanner
 * or any processor consumes them.
 *
 * This is a provider seam in the same spirit as the scanner, storage, queue, and
 * processor: pure data plus a tiny interface, node-free (no daemon, native binary,
 * network, filesystem, or PDF parser), so it is reused by the worker executor and
 * the local-dev adapter and is unit-tested in isolation. It deliberately does *only*
 * cheap, deterministic structural checks over bounded byte windows plus the bounded
 * metadata already stored for the job — is the input present and non-empty? within
 * the size ceiling? does its declared byte count match what was fetched? is its
 * declared content-type a family this tool accepts, and coherent with its filename
 * extension? does it carry a `%PDF-` envelope when the tool expects a PDF? — and
 * never decodes, decompresses, parses objects, counts pages, or reads text.
 *
 * It sits BEFORE the scanner on purpose: a structurally-unsound or contract-
 * mismatched input is rejected by this cheap deterministic check before the worker
 * spends a malware-scan round-trip or a processor on it, and such an input never
 * reaches ClamAV, OCR, or compression. See docs/WORKER_ARCHITECTURE.md.
 *
 * Honesty rules — load-bearing, and mirrored across the whole worker layer:
 *  - a soundness pass is ONLY a bounded preflight, NOT malware scanning, NOT PDF
 *    sanitization, NOT proof that a document is valid or safe. It never claims any
 *    of those; deep validation stays inside the processor under its own limits;
 *  - `checked` is the honesty bit: it is true only when the gate actually inspected
 *    bytes (`sound`/`unsound`). A disabled gate returns `skipped` (`checked:false`)
 *    and nothing downstream may report an input as "checked" when it was not;
 *  - every field is content-free: `reason` is a bounded enum and `detail` NEVER
 *    carries a filename, object key, signed URL, temp path, byte content, declared
 *    size, tool option, OCR text, scanner signature, or any secret value.
 */

import type { ProcessorInputFile } from "../processor/types";

/** The bounded set of verdicts a soundness check can reach. Source of truth. */
export const SOUNDNESS_VERDICTS = ["sound", "unsound", "skipped"] as const;

/**
 * The outcome of inspecting a job's inputs:
 *  - `sound`   — the gate ran its bounded checks and every input passed (proceed);
 *  - `unsound` — the gate ran and an input failed a check (block before scanning and
 *                processing, terminal, no artifact); the specific `reason` says which;
 *  - `skipped` — the gate did not evaluate the bytes (it is disabled), so the inputs
 *                were NOT checked (and are never reported as checked).
 */
export type SoundnessVerdict = (typeof SOUNDNESS_VERDICTS)[number];

/**
 * The bounded, content-free reason taxonomy. `ok` accompanies a `sound` verdict and
 * `not_checked` a `skipped` one, so the label space stays closed for telemetry; the
 * remaining members are the concrete reject reasons. Source of truth for the metric
 * schema (see `../observability/metrics`) and the quarantine receipt. Every value is
 * a stable internal code — never a filename, key, size, path, or document content.
 */
export const SOUNDNESS_REASONS = [
  "ok", // sound: passed every bounded check
  "not_checked", // skipped: the gate is disabled
  "missing_input", // unsound: the job carried no input bytes to check
  "too_many_inputs", // unsound: more inputs than the bounded per-job ceiling
  "empty", // unsound: an input had zero bytes
  "file_too_large", // unsound: an input exceeded the configured max-bytes ceiling
  "size_mismatch", // unsound: fetched byte count != the declared/expected count
  "unsupported_family", // unsound: declared content-type is a family the tool does not accept
  "metadata_mismatch", // unsound: declared content-type family disagrees with the filename extension
  "malformed_pdf", // unsound: a PDF-expected input lacked its `%PDF-` header / `%%EOF` marker
  "policy_unavailable", // unsound: the gate could not resolve a usable policy (fails closed)
] as const;
export type SoundnessReason = (typeof SOUNDNESS_REASONS)[number];

/** The reasons that accompany an `unsound` verdict (everything but `ok`/`not_checked`). */
export type SoundnessRejectReason = Exclude<
  SoundnessReason,
  "ok" | "not_checked"
>;

/**
 * A content-free soundness result. `checked` is the honesty bit; `reason` is a
 * bounded enum; `detail` names nothing about the file or its contents.
 */
export interface SoundnessResult {
  readonly verdict: SoundnessVerdict;
  /**
   * True ONLY when the gate actually inspected the bytes and reached a verdict
   * (`sound` or `unsound`). false for `skipped` (the gate is disabled). Nothing
   * downstream may report an input as checked unless this is true.
   */
  readonly checked: boolean;
  /** The bounded reason code. `ok` for `sound`, `not_checked` for `skipped`. */
  readonly reason: SoundnessReason;
  /** One-line, content-free explanation. Never a filename, key, size, or content. */
  readonly detail: string;
}

/** What the gate is handed: the tool (for family policy) and the already-read bytes. */
export interface SoundnessInput {
  /** The tool the job runs; used to resolve the accepted input families. */
  readonly tool: string;
  /**
   * The already-read input files (bytes + naming + optional declared byte count) to
   * inspect. Never re-read here; each input's `declaredBytes`, when the storage layer
   * recovered one, drives the `size_mismatch` consistency check.
   */
  readonly inputs: readonly ProcessorInputFile[];
}

/** The honest, presence-only capability of the soundness gate in this environment. */
export interface SoundnessCapability {
  /** True ONLY when the gate is enabled and actually inspects bytes. */
  readonly active: boolean;
  /** Stable mode: `enabled` (checks run) or `disabled` (checks skipped). */
  readonly mode: "enabled" | "disabled";
  /** Stable policy identifier for receipts/telemetry (never an env value). */
  readonly policyId: string;
  /** Stable policy schema version for receipts/telemetry (not the knob values). */
  readonly policyVersion: number;
  /** One-line, content-free explanation. Never a variable, value, or path. */
  readonly detail: string;
}

/**
 * A secure-worker file soundness gate. `check` inspects a job's inputs and returns
 * a content-free verdict synchronously (it is a pure, bounded, in-memory byte
 * inspection — no I/O, so it is honestly not async); `capability` reports the
 * gate's presence-only readiness. Injected into the executor exactly like the
 * scanner seam; absent ⇒ no soundness step runs and behavior is unchanged.
 */
export interface SoundnessGate {
  check(input: SoundnessInput): SoundnessResult;
  capability(): SoundnessCapability;
}

const OK_DETAIL =
  "The input passed the bounded worker file-soundness preflight (a structural + metadata-consistency check, not malware scanning or validation).";
const SKIPPED_DETAIL =
  "The worker file-soundness gate is disabled; inputs were not checked (and are never reported as checked).";

/** Content-free explanations per reject reason. Never names a file, size, or content. */
const REJECT_DETAIL: Record<SoundnessRejectReason, string> = {
  missing_input: "The job carried no input bytes to check; it was not processed.",
  too_many_inputs:
    "The job referenced more inputs than the worker soundness ceiling; it was not processed.",
  empty: "An input was empty; it was not processed.",
  file_too_large:
    "An input exceeded the worker soundness size ceiling; it was not processed.",
  size_mismatch:
    "An input's fetched byte count did not match its declared size; it was not processed.",
  unsupported_family:
    "An input's declared content-type is not one this tool accepts; it was not processed.",
  metadata_mismatch:
    "An input's declared content-type does not match its filename type; it was not processed.",
  malformed_pdf:
    "An input expected to be a PDF did not carry a PDF envelope; it was not processed.",
  policy_unavailable:
    "The worker soundness policy could not be resolved, so the gate failed closed; the input was not processed.",
};

/** A `sound` result — the gate ran and every input passed. */
export function soundnessPass(detail: string = OK_DETAIL): SoundnessResult {
  return { verdict: "sound", checked: true, reason: "ok", detail };
}

/** An `unsound` result — the gate ran and an input failed `reason`. Content-free. */
export function soundnessReject(
  reason: SoundnessRejectReason,
  detail: string = REJECT_DETAIL[reason],
): SoundnessResult {
  return { verdict: "unsound", checked: true, reason, detail };
}

/** A `skipped` result — the gate is disabled, so nothing was checked. The honest off state. */
export function soundnessSkipped(
  detail: string = SKIPPED_DETAIL,
): SoundnessResult {
  return { verdict: "skipped", checked: false, reason: "not_checked", detail };
}
