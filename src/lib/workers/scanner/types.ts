/**
 * The typed contract for a secure-worker **malware scanner** — the gate that
 * inspects a job's already-read input bytes before any processing runs, so an
 * infected upload is blocked instead of processed.
 *
 * This is a provider seam in the same spirit as storage, queue, and the processor:
 * pure data plus a tiny interface, node-free (no daemon, native binary, network, or
 * scanner-process internals), so it is reused by the in-process local-dev worker and
 * any future production worker and is unit-testable in isolation. A real provider
 * (ClamAV/clamd over INSTREAM — see `./clamav`) is wired behind exactly this
 * interface when an operator configures and deploys a scanner service.
 *
 * Honesty rules — load-bearing, and mirrored across the whole worker layer:
 *  - a result is only ever `clean`/`infected` when a scanner ACTUALLY inspected the
 *    bytes; `scanned` is the single bit that says so. The shipped default never
 *    scans, so it returns `skipped` (NOT `clean`) — nothing may claim a file was
 *    scanned when it was not, even if an operator has declared a scanner via env;
 *  - `error` means the scan could not complete (scanner unreachable/timeout); it is
 *    never silently downgraded to `clean`, and the executor treats it as retryable;
 *  - every field is content-free: a `detail` line NEVER carries a filename, object
 *    key, signature name, scanner endpoint, byte content, or secret value.
 */

import type { ProcessorInputFile } from "../processor/types";

/**
 * The outcome of inspecting a job's inputs:
 *  - `clean`    — a scanner inspected the bytes and found no threat (proceed);
 *  - `infected` — a scanner found a threat (block before processing, no artifact);
 *  - `error`    — the scan could not be completed and MAY succeed later (retryable;
 *                 never treated as clean); e.g. the scanner was unreachable/timed out;
 *  - `invalid`  — the input can never be scanned by this scanner and retrying will
 *                 not help (terminal; e.g. it exceeds the scanner's hard size limit),
 *                 so it is blocked rather than processed unscanned;
 *  - `skipped`  — no scanner ran, so the inputs were NOT scanned (the honest default,
 *                 also how an OPTIONAL scanner degrades when it cannot reach a verdict).
 */
export type MalwareScanVerdict =
  | "clean"
  | "infected"
  | "error"
  | "invalid"
  | "skipped";

/** A content-free scan result. `scanned` is the honesty bit; `detail` names nothing. */
export interface MalwareScanResult {
  readonly verdict: MalwareScanVerdict;
  /**
   * True ONLY when a scanner actually inspected the bytes and reached a verdict
   * (`clean` or `infected`). false for `skipped` (nothing ran), `error` (the scan
   * did not complete), and `invalid` (the input could not be scanned). Nothing
   * downstream may report a file as scanned unless this is true.
   */
  readonly scanned: boolean;
  /** One-line, content-free explanation. Never a filename, signature, key, or path. */
  readonly detail: string;
}

/** What the scanner is handed: the tool (for future per-tool policy) and the bytes. */
export interface MalwareScanInput {
  /** The tool the job runs. Reserved for future per-tool scan policy; unused today. */
  readonly tool: string;
  /** The already-read input files (bytes + naming) to inspect. */
  readonly inputs: readonly ProcessorInputFile[];
}

/** The honest, presence-only capability of a scanner provider in this environment. */
export interface MalwareScanCapability {
  /**
   * True ONLY when this provider actually inspects bytes. The shipped no-op
   * provider is always `false`, so a deployment can never mistake it for scanning.
   */
  readonly active: boolean;
  /** Stable provider id: `disabled` \| `not-configured` \| `unavailable` \| `clamav` \| `fake`. */
  readonly provider: string;
  /** One-line, content-free explanation. Never a variable, endpoint, path, or value. */
  readonly detail: string;
}

/**
 * A secure-worker malware scanner. `scan` inspects a job's inputs and returns a
 * content-free verdict; `capability` reports the provider's honest, presence-only
 * readiness. A real provider is injected (mirroring the OCR/compression native
 * seams); with none, the executor gate runs the shipped no-op, which never claims a
 * file was scanned.
 */
export interface MalwareScanner {
  scan(input: MalwareScanInput): Promise<MalwareScanResult>;
  capability(): MalwareScanCapability;
}

const CLEAN_DETAIL =
  "A malware scan inspected the input and found no threat.";
const INFECTED_DETAIL =
  "A malware scan flagged the input; it was blocked before processing.";
const ERROR_DETAIL =
  "The malware scan could not be completed; the input was not scanned and was not treated as clean.";
const INVALID_DETAIL =
  "The input could not be scanned and retrying will not help; it was blocked instead of processed unscanned.";
const SKIPPED_DETAIL =
  "No malware scanner ran; the input was not scanned (and is never reported as scanned).";

/** A `clean` result — a scanner ran and found nothing. Only a real scanner returns this. */
export function scanClean(detail: string = CLEAN_DETAIL): MalwareScanResult {
  return { verdict: "clean", scanned: true, detail };
}

/** An `infected` result — a scanner found a threat. `detail` must stay content-free. */
export function scanInfected(detail: string = INFECTED_DETAIL): MalwareScanResult {
  return { verdict: "infected", scanned: true, detail };
}

/** An `error` result — the scan could not complete. Retryable; never downgraded to clean. */
export function scanError(detail: string = ERROR_DETAIL): MalwareScanResult {
  return { verdict: "error", scanned: false, detail };
}

/**
 * An `invalid` result — the input cannot be scanned and retrying will not help (it
 * exceeds the scanner's hard limits). Terminal; blocked rather than processed
 * unscanned. `detail` must stay content-free.
 */
export function scanInvalid(detail: string = INVALID_DETAIL): MalwareScanResult {
  return { verdict: "invalid", scanned: false, detail };
}

/** A `skipped` result — no scanner ran, so the input was NOT scanned. The honest default. */
export function scanSkipped(detail: string = SKIPPED_DETAIL): MalwareScanResult {
  return { verdict: "skipped", scanned: false, detail };
}
