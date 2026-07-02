/**
 * Operator-facing **malware-scan readiness** for the deployment-hardening layer.
 *
 * Phase 22 ships a real, optional scanner backend — ClamAV/clamd over INSTREAM — so
 * this is no longer an "always inactive" honesty stub. It is a thin re-export of the
 * scanner seam's presence-only readiness (`../scanner/config`), kept here so the
 * deployment readiness and guardrails have one import site under `deploy/` and so the
 * DAG stays acyclic (deploy depends on the scanner seam, never the reverse).
 *
 * The readiness distinguishes four honest states — `disabled`, `not-configured`,
 * `ready` (a scanner is configured with a usable endpoint; inputs ARE scanned), and
 * `unavailable` (selected but its endpoint config is missing/malformed) — plus
 * whether scanning is required. `active` is true ONLY in `ready`, so a deployment can
 * never mistake a not-configured or misconfigured scanner for a working one. Every
 * field is content-free: it names no endpoint, host, port, socket path, variable, or
 * value.
 */

export {
  MALWARE_SCANNER_ENV,
  MALWARE_SCAN_REQUIRED_ENV,
  resolveScannerReadiness as resolveMalwareScanReadiness,
  type MalwareScanState,
  type MalwareScanReadiness,
} from "../scanner/config";
