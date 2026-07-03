/**
 * The content-free **pipeline receipt** and its optional observer seam (Phase 44).
 *
 * A pipeline receipt is built from the rolled-up run and rides alongside the composite output;
 * it answers "what did one pipeline run resolve to, and per arm" for an audit trail. This module
 * adds the SAME operator-wired, default-off observer the rest of the worker layer uses, so a
 * deployment that wants to forward pipeline receipts to a SIEM can, without any console noise or
 * I/O in a stock run.
 *
 * The receipt is content-free by construction (see `./types`): bounded severities, small exit
 * codes, and a stable policy id — never an object key, bucket, URL, endpoint, region, id,
 * filename, size, instant, byte, or any echo of the raw export. So it is safe to log or forward
 * verbatim. See docs/OBSERVABILITY.md and docs/SECURITY.md.
 */

import {
  PIPELINE_POLICY_ID,
  PIPELINE_POLICY_VERSION,
  type PipelineArmResult,
  type PipelineExitCode,
  type PipelineReceipt,
  type PipelineSeverity,
} from "./types";

/** A sink an operator wires to observe pipeline receipts (an audit line, a SIEM, …). */
export type PipelineObserver = (receipt: PipelineReceipt) => void;

// Module-global, swappable observer — the same reset-for-tests posture the projection, cleanup,
// expiry, and retrieval receipt sinks use. Default null: the CLI still emits the receipt in its
// output, but nothing is pushed to a sink until an operator opts in.
let observer: PipelineObserver | null = null;

/** Register (or clear, with `null`) the process-wide pipeline-receipt observer. */
export function setPipelineObserver(next: PipelineObserver | null): void {
  observer = next;
}

/** Restore the default (no) observer. Named for test isolation. */
export function resetPipelineObserverForTests(): void {
  observer = null;
}

/**
 * Build the content-free receipt for a rolled-up pipeline run. Pure — it only copies bounded
 * fields; it reads no clock (the caller passes the ISO stamp derived from the injected clock).
 */
export function buildPipelineReceipt(
  severity: PipelineSeverity,
  exitCode: PipelineExitCode,
  arms: readonly PipelineArmResult[],
  at: string,
): PipelineReceipt {
  return {
    category: "cleanup-pipeline",
    policyId: PIPELINE_POLICY_ID,
    policyVersion: PIPELINE_POLICY_VERSION,
    at,
    severity,
    exitCode,
    arms,
  };
}

/**
 * Emit a pipeline receipt to the registered observer, if any. A throwing observer is swallowed:
 * observability must never turn a valid pipeline run into a crash. Returns the receipt so a
 * caller can also attach it to its own output.
 */
export function emitPipelineReceipt(receipt: PipelineReceipt): PipelineReceipt {
  try {
    observer?.(receipt);
  } catch {
    // An operator's sink must never break a pipeline run.
  }
  return receipt;
}
