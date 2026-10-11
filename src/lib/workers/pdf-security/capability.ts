/**
 * PDF qpdf capability mapping for the worker layer.
 *
 * This is the qpdf analogue of `../ocr.ts`'s `buildOcrCapability`: a pure,
 * dependency-injected function that turns the resolved {@link WorkerMode} (plus
 * whether qpdf was detected) into an honest, client-safe statement of what the
 * qpdf-backed tools can do right now. It never reads a secret and never claims a
 * capability that isn't there.
 *
 * Honesty posture: protect/unlock, repair, and web optimization genuinely require
 * the native qpdf binary on a secure worker — there is NO in-browser equivalent.
 * So the client-facing capability is `available` only in `local-dev` when qpdf is
 * present on this host; in `remote-configured` the web process cannot observe the
 * remote worker's binaries, so it reports unavailable-from-here and the UI decides
 * whether to offer the flow from the provider/daemon readiness (mirroring deep
 * compression).
 */

import type { WorkerMode } from "../mode";

/** The operations this capability covers. */
export const QPDF_OPERATIONS = [
  "protect",
  "unlock",
  "repair",
  "optimize-web",
] as const;
export type QpdfOperation = (typeof QPDF_OPERATIONS)[number];

/** What the worker can do for qpdf-backed PDF tools in this environment, right now. */
export interface SecurityCapability {
  /** True only when this host can actually run qpdf-backed tools now. */
  available: boolean;
  /** The qpdf-backed operations offered. */
  operations: readonly QpdfOperation[];
  /** One-line, client-safe explanation of the current capability. */
  detail: string;
}

function unavailableDetail(mode: WorkerMode): string {
  switch (mode) {
    case "local-dev":
      return "The local-dev worker doesn't have qpdf installed, so qpdf-backed PDF tools (Protect, Unlock, Repair, Optimize for Web) can't run here.";
    case "remote-configured":
      return "Protect, Unlock, Repair, and Optimize for Web run on the out-of-band secure worker (qpdf). This web process can't confirm the worker's engine from here; a job will run there or fail honestly.";
    case "disabled":
    default:
      // Read alone, so it names its vantage: this field reports what THIS web
      // process can observe, and it cannot observe a remote worker's engines.
      // Its old wording ("isn't enabled in this environment") read as a
      // deployment-wide verdict and misled an operator while the out-of-band
      // worker was running these very tools.
      return "qpdf-backed PDF tools (Protect, Unlock, Repair, Optimize for Web) need the out-of-band secure worker; this web process cannot observe that worker's engines from here. When a worker is deployed, jobs run there or fail honestly — nothing is uploaded until you start one.";
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
      operations: [...QPDF_OPERATIONS],
      detail:
        "Protect, Unlock, Repair, and Optimize for Web run on qpdf, on an auto-deleting secure worker — inputs are wiped right after processing.",
    };
  }
  return {
    available: false,
    operations: [...QPDF_OPERATIONS],
    detail: unavailableDetail(mode),
  };
}
