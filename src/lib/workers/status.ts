/**
 * The client-facing, presence-only view of the worker layer.
 *
 * The web app's UI can't read environment variables, so this is the honest seam
 * that tells the browser what the active worker can *actually* do right now —
 * without ever exposing a secret. It reports the resolved {@link WorkerMode} and,
 * for compression, whether the worker can run each profile in this environment.
 * `buildWorkerStatus` is pure and dependency-injected (it takes the probed native
 * tool availability), so every branch is unit-testable; the route
 * (`/api/worker/status`) is the only thing that performs the live PATH probe.
 */

import type { WorkerMode } from "./mode";
import {
  DEEP_COMPRESSION_TOOLS,
  type CompressionTool,
  type ToolAvailability,
} from "./compression/engine";
import {
  buildOcrCapability,
  type OcrCapability,
  type OcrEngineAvailability,
} from "./ocr";
import {
  buildSecurityCapability,
  type SecurityCapability,
} from "./pdf-security/capability";
import { getProviderReadiness, type WorkerProviders } from "./providers";
import { resolveDaemonReadiness, type DaemonReadiness } from "./daemon/readiness";
import { resolveAiReadiness, type AiReadiness } from "./ai/readiness";

/** What the worker can do for the Compress tool in this environment, right now. */
export interface CompressCapability {
  /** Worker can run a genuine lossless structural repack now. */
  lossless: boolean;
  /** Worker can run deep image compression now (a native engine is installed). */
  deep: boolean;
  /**
   * Native engines detected on the host, in preference order. Names only — this
   * reports the *presence* of a binary on PATH, never a path, version, or value.
   */
  engines: CompressionTool[];
}

/** The honest, client-safe status of the worker layer. */
export interface WorkerStatus {
  mode: WorkerMode;
  /** True only when the worker can process at least one profile right now. */
  enabled: boolean;
  /** True when the active worker is the developer-only in-process one. */
  localDevOnly: boolean;
  /** One-line, client-safe explanation of the current capability. */
  detail: string;
  compress: CompressCapability;
  /** What the worker can do for the OCR tool right now (its own honest detail). */
  ocr: OcrCapability;
  /**
   * What the worker can do for the Protect / Unlock (qpdf) tools right now. Like
   * OCR, this is presence-only and honest: `available` only where the web process
   * can confirm the engine (local-dev with qpdf on PATH); elsewhere the UI decides
   * whether to offer the flow from provider/daemon readiness.
   */
  security: SecurityCapability;
  /**
   * Presence-only readiness of the three providers behind the adapter — object
   * storage, job queue, and the processor. Lets the UI distinguish which piece
   * of the production pipeline is waiting, without ever leaking a variable value.
   */
  providers: WorkerProviders;
  /**
   * Presence-only readiness of the out-of-band worker daemon (Phase 16). Kept
   * distinct from `providers`: the queue/storage can be ready while whether a
   * separate worker process is actually deployed to drain them is unknowable from
   * here — the daemon never runs inside this app.
   */
  daemon: DaemonReadiness;
  /**
   * Presence-only readiness of the AI provider the AI tools (summarize, translate,
   * chat, ai-extract) need. Kept distinct from `providers`/`daemon`: a deployment
   * can have a perfectly drainable pipeline and still have no model wired, in which
   * case those tools must be honestly off *before* a user uploads a document
   * rather than failing after the upload. Derived from the non-secret family
   * switch only — the API key lives on the worker and is never read here.
   */
  ai: AiReadiness;
}

const NO_COMPRESS: CompressCapability = {
  lossless: false,
  deep: false,
  engines: [],
};

/**
 * Derive the client-facing status from the resolved mode and (for local-dev)
 * the probed native tool availability. Never reads the environment or a secret;
 * callers pass in exactly what was detected. `ocrEngines` is threaded through to
 * {@link buildOcrCapability}; the status route passes none, so OCR reports as
 * unavailable in every environment this build runs in (see `./ocr.ts`).
 */
export function buildWorkerStatus(
  mode: WorkerMode,
  tools?: ToolAvailability,
  ocrEngines?: OcrEngineAvailability,
  env: Record<string, string | undefined> = process.env,
  securityQpdf?: boolean,
  /**
   * Whether a worker daemon is *observed* alive against the queue. The route
   * reads a liveness heartbeat and passes the result; a caller that cannot
   * observe leaves it out and gets the cautious "no worker deployed" answer.
   */
  workerObserved?: boolean,
  /**
   * Whether the observed worker's heartbeat reports OCR enabled. The engine is
   * deliberately absent from the web tier, so a local probe can only answer "no";
   * without this the OCR page went dark while real jobs succeeded.
   */
  workerOcr?: boolean,
): WorkerStatus {
  const ocr = buildOcrCapability(mode, ocrEngines, undefined, workerOcr);
  // Protect/unlock run on qpdf. The route can pass a dedicated qpdf-security probe;
  // absent that, fall back to the qpdf presence the compression probe already found,
  // so local-dev status reflects it without any extra wiring.
  const security = buildSecurityCapability(mode, securityQpdf ?? tools?.qpdf);
  const providers = getProviderReadiness(mode, env, workerObserved);
  const daemon = resolveDaemonReadiness(env);
  // Mode-independent, like `daemon`: the AI tools always run on the out-of-band
  // worker, so what matters is whether this deployment declares a provider at all.
  const ai = resolveAiReadiness(env);

  if (mode === "local-dev") {
    const engines = DEEP_COMPRESSION_TOOLS.filter((tool) => tools?.[tool]);
    const deep = engines.length > 0;
    return {
      mode,
      enabled: true,
      localDevOnly: true,
      detail: deep
        ? `Local-dev worker enabled. Deep image compression runs on ${engines[0]}, on this machine — files are not sent to any third party.`
        : "Local-dev worker enabled, but no native engine (Ghostscript, qpdf, or mutool) is installed, so deep image compression can't run here. Install one to enable it.",
      compress: { lossless: true, deep, engines },
      ocr,
      security,
      providers,
      daemon,
      ai,
    };
  }

  if (mode === "remote-configured") {
    return {
      mode,
      enabled: false,
      localDevOnly: false,
      detail:
        "A worker backend is configured, but this build ships no processing pipeline yet.",
      compress: { ...NO_COMPRESS },
      ocr,
      security,
      providers,
      daemon,
      ai,
    };
  }

  return {
    mode: "disabled",
    enabled: false,
    localDevOnly: false,
    detail:
      "No secure worker is configured in this environment. Deep image compression runs on an encrypted, auto-deleting worker when enabled.",
    compress: { ...NO_COMPRESS },
    ocr,
    security,
    providers,
    daemon,
    ai,
  };
}
