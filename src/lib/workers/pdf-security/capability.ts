/**
 * PDF security capability mapping for the worker layer.
 *
 * This is the protect/unlock analogue of `../ocr.ts`'s `buildOcrCapability`: a
 * pure, dependency-injected function that turns the resolved {@link WorkerMode}
 * (plus whether qpdf was detected) into an honest, client-safe statement of what
 * the Protect PDF / Unlock PDF tools can do right now. It never reads a secret and
 * never claims a capability that isn't there.
 *
 * Honesty posture: protect/unlock genuinely require the native qpdf binary on a
 * secure worker — there is NO in-browser AES path (pdf-lib cannot encrypt). So the
 * client-facing capability is `available` only in `local-dev` when qpdf is present
 * on this host; in `remote-configured` the web process cannot observe the remote
 * worker's binaries, so it reports unavailable-from-here and the UI decides whether
 * to offer the flow from the provider/daemon readiness (mirroring deep compression).
 */

import type { WorkerMode } from "../mode";

/** The operations this capability covers. */
export const PDF_SECURITY_OPERATIONS = ["protect", "unlock"] as const;
export type PdfSecurityOperation = (typeof PDF_SECURITY_OPERATIONS)[number];

/** What the worker can do for the Protect/Unlock tools in this environment, right now. */
export interface SecurityCapability {
  /** True only when this host can actually run qpdf protect/unlock now. */
  available: boolean;
  /** The operations offered. */
  operations: readonly PdfSecurityOperation[];
  /** One-line, client-safe explanation of the current capability. */
  detail: string;
}

function unavailableDetail(mode: WorkerMode): string {
  switch (mode) {
    case "local-dev":
      return "The local-dev worker doesn't have qpdf installed, so PDF password protection can't run here.";
    case "remote-configured":
      return "Protect and Unlock run on the out-of-band secure worker (qpdf). This web process can't confirm the worker's engine from here; a job will run there or fail honestly.";
    case "disabled":
    default:
      return "PDF password protection needs a secure worker with qpdf, which isn't enabled in this environment — nothing is uploaded.";
  }
}

/**
 * Derive the client-facing security capability from the resolved mode and whether
 * qpdf was detected on this host. Never reads the environment or a secret; the
 * caller passes in exactly what was probed. With qpdf absent (or a non-local-dev
 * mode, where the web process cannot observe the remote worker) it reports
 * unavailable, honestly.
 */
export function buildSecurityCapability(
  mode: WorkerMode,
  qpdfAvailable?: boolean,
): SecurityCapability {
  const available = mode === "local-dev" && qpdfAvailable === true;
  if (available) {
    return {
      available: true,
      operations: [...PDF_SECURITY_OPERATIONS],
      detail:
        "Protect and Unlock run on qpdf, on an encrypted, auto-deleting secure worker — inputs are wiped right after processing.",
    };
  }
  return {
    available: false,
    operations: [...PDF_SECURITY_OPERATIONS],
    detail: unavailableDetail(mode),
  };
}
