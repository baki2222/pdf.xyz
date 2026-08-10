/**
 * The client-facing, presence-only view of malware scanning.
 *
 * This exists because the product was telling users something it does not do. The
 * "What happens" pipeline shown on every worker-backed tool page asserted, flatly,
 * "Every file is scanned before any processor touches it. Unsafe files are rejected."
 * The scanner is optional, off by default, and not configured on production — and
 * the worker layer knows it, publishing `active: false` with the explicit promise
 * that unscanned uploads "are never reported as scanned". The web tier had no way to
 * read that, so a static string overrode a live capability and made a security claim
 * the system was designed never to make.
 *
 * Scanning is therefore reported the same way OCR is: the engine lives on the
 * out-of-band worker, the web process cannot probe it, and the only honest signal is
 * the worker's own heartbeat. Absent that signal this reports NOT scanning — an
 * unverified security control must read as absent, never as present.
 */

/** What the worker does about malware for an upload right now. */
export interface ScanCapability {
  /**
   * True only when a worker is observed alive AND its heartbeat reports an active
   * scanner. Anything less — no heartbeat, a stale one, a worker with the scanner
   * unconfigured — is false.
   */
  active: boolean;
  /** One-line, client-safe explanation. Never names a provider, host, or version. */
  detail: string;
}

const SCANNING =
  "Every file is scanned for malware before any processor touches it, and unsafe files are rejected.";

const NOT_SCANNING =
  "Files are not scanned for malware here. A bounded structural preflight checks that each input is the file type it claims to be and rejects malformed ones, but that is not a malware scan — so nothing is ever reported as scanned when it was not.";

/**
 * Derive the honest scanning capability.
 *
 * @param observedOnWorker whether a live worker heartbeat reports an active scanner.
 * Omitted by any caller that cannot observe one, which resolves to not scanning.
 */
export function buildScanCapability(
  observedOnWorker?: boolean,
): ScanCapability {
  return observedOnWorker === true
    ? { active: true, detail: SCANNING }
    : { active: false, detail: NOT_SCANNING };
}
