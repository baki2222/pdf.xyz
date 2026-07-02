/**
 * The honest **no-op malware scanner**: it never scans, and never reports a file as
 * scanned.
 *
 * It is wired whenever a real scanner is NOT running here — nothing declared
 * (`not-configured`), explicitly turned off (`disabled`), or selected-but-misconfigured
 * (`unavailable`). In every case its `scan` returns `skipped` (deliberately NOT
 * `clean`, which would claim a scan happened) and its `capability` is `active: false`
 * with the resolved state as its provider id, so `--dry-run-status` can tell the
 * three no-scan situations apart while all three stay honestly inactive.
 *
 * Wiring it (rather than omitting the gate) means a deployed worker still has an
 * observable scanner capability and the executor's gate path is exercised in
 * production shape; the verdict is simply always `skipped`, so behavior is identical
 * to having no scanner at all. Node-free; names no variable or value. The REAL
 * scanner (ClamAV) is `./clamav`, wired by the Node runtime when configured.
 */

import { resolveScannerReadiness } from "./config";
import {
  scanSkipped,
  type MalwareScanCapability,
  type MalwareScanner,
} from "./types";

type EnvSource = Record<string, string | undefined>;

/**
 * Build the honest no-op scanner. Its `scan` always returns `skipped` (never
 * `clean`); its `capability` reflects the resolved no-scan state (`not-configured` /
 * `disabled` / `unavailable`) but is always `active: false`. `env` is injectable.
 */
export function notConfiguredScanner(env: EnvSource = process.env): MalwareScanner {
  const readiness = resolveScannerReadiness(env);
  const capability: MalwareScanCapability = {
    active: false,
    provider: readiness.state,
    detail: readiness.detail,
  };
  return {
    // No runner here, so nothing is ever inspected. Returning `skipped` (not
    // `clean`) keeps the honesty invariant: the input is not scanned and is never
    // reported as scanned.
    async scan() {
      return scanSkipped();
    },
    capability() {
      return capability;
    },
  };
}
