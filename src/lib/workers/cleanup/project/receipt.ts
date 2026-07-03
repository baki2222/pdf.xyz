/**
 * The optional observer seam for the content-free **projection receipt** (Phase 43).
 *
 * A projection receipt is built inside the transform (`./project`) and rides alongside the
 * projected records in the CLI's output; it answers "what did one projection run read, drop,
 * and warn about, and how confident is it" for an audit trail. This module adds the SAME
 * operator-wired, default-off observer the rest of the worker layer uses, so a deployment that
 * wants to forward projection receipts to a SIEM can, without any console noise or I/O in a
 * stock run.
 *
 * The receipt is content-free by construction (see `./types`): bounded enums, small integer
 * counts, and a stable policy id — never an object key, bucket, URL, endpoint, region, id,
 * filename, size, instant, byte, or any echo of a dropped field's value. So it is safe to log
 * or forward verbatim. See docs/OBSERVABILITY.md and docs/SECURITY.md.
 */

import type { ProjectionReceipt } from "./types";

/** A sink an operator wires to observe projection receipts (an audit line, a SIEM, …). */
export type ProjectionObserver = (receipt: ProjectionReceipt) => void;

// Module-global, swappable observer — the same reset-for-tests posture the cleanup, expiry,
// and retrieval receipt sinks use. Default null: the CLI still emits the receipt in its output,
// but nothing is pushed to a sink until an operator opts in, so a stock run has no side effect.
let observer: ProjectionObserver | null = null;

/** Register (or clear, with `null`) the process-wide projection-receipt observer. */
export function setProjectionObserver(next: ProjectionObserver | null): void {
  observer = next;
}

/** Restore the default (no) observer. Named for test isolation. */
export function resetProjectionObserverForTests(): void {
  observer = null;
}

/**
 * Emit a projection receipt to the registered observer, if any. A throwing observer is
 * swallowed: observability must never turn a valid projection into a crash. Returns the
 * receipt so a caller can also attach it to its own output.
 */
export function emitProjectionReceipt(receipt: ProjectionReceipt): ProjectionReceipt {
  try {
    observer?.(receipt);
  } catch {
    // An operator's sink must never break a projection run.
  }
  return receipt;
}
