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
import { buildScanCapability, type ScanCapability } from "./scan/capability";
import { getProviderReadiness, type WorkerProviders } from "./providers";
import {
  resolveDaemonReadiness,
  type DaemonReadiness,
} from "./daemon/readiness";
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
   * Whether uploads are actually scanned for malware right now. Like OCR, the
   * scanner lives only on the out-of-band worker, so this is answerable only from a
   * live heartbeat — and it reads false unless one positively says otherwise. The
   * UI's pipeline copy is derived from this; it used to be a static string that
   * claimed scanning unconditionally.
   */
  scan: ScanCapability;
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
  /**
   * The out-of-band pipeline's single observed verdict — see
   * {@link PipelineSummary}. The /status headline derives from this and only
   * this, so it can never contradict the facet rows again.
   */
  pipeline: PipelineSummary;
}

const NO_COMPRESS: CompressCapability = {
  lossless: false,
  deep: false,
  engines: [],
};

/**
 * The out-of-band pipeline, summarized from OBSERVED state only — the
 * worker's liveness heartbeat and whether the queue + storage could drain
 * one — never from a configuration flag. Config flags are what produced the
 * /status contradiction this field exists to end: `mode`/`enabled` describe
 * the WEB PROCESS's in-process facet, are named as if global, and were
 * rendered as a headline over rows carrying observed heartbeat state. The
 * status page derives its single verdict from THIS field, so the headline
 * and the rows can never be computed independently again.
 *
 * Local-dev's in-process worker is deliberately outside this summary: it is
 * not the out-of-band pipeline, and its card keeps the explicit dev badge.
 */
export interface PipelineSummary {
  /**
   * `live` — a worker heartbeat is observed right now; `configured` — the
   * queue and storage could drain a worker but none is observed; `off` —
   * neither.
   */
  verdict: "live" | "configured" | "off";
  /** A worker liveness heartbeat is currently observed. */
  observed: boolean;
  /** Queue + storage are both configured, so a deployed worker could drain them. */
  drainable: boolean;
  /** One-line, client-safe summary that names its own vantage. */
  detail: string;
}

/** Derive the pipeline summary from the two observed facts, nothing else. */
export function buildPipelineSummary(
  observed: boolean,
  drainable: boolean,
): PipelineSummary {
  if (observed) {
    return {
      verdict: "live",
      observed,
      drainable,
      detail:
        "A secure worker is live — its liveness heartbeat is observed, along with the capabilities it reports.",
    };
  }
  if (drainable) {
    return {
      verdict: "configured",
      observed,
      drainable,
      detail:
        "The job queue and object storage are configured, so a deployed worker could drain them — but no worker heartbeat is observed right now.",
    };
  }
  return {
    verdict: "off",
    observed,
    drainable,
    detail:
      "This deployment's pipeline cannot drain a worker — the job queue and object storage are not both configured — and no worker is observed.",
  };
}

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
  /**
   * Whether the observed worker's heartbeat reports an ACTIVE malware scanner.
   * Omitted by any caller that cannot observe one, which resolves to "not scanned" —
   * a security control must never be reported as present on the strength of silence.
   */
  workerScan?: boolean,
  /**
   * The recognition language packs the observed worker reports actually having.
   * Absent when no worker is observed, or when an older worker publishes a heartbeat
   * without the field — in which case OCR falls back to the advertised catalogue and
   * says so, rather than silently narrowing the menu to nothing.
   */
  workerOcrLanguages?: readonly string[],
): WorkerStatus {
  const ocr = buildOcrCapability(
    mode,
    ocrEngines,
    workerOcrLanguages,
    workerOcr,
  );
  const scan = buildScanCapability(workerScan);
  // Protect/unlock run on qpdf. The route can pass a dedicated qpdf-security probe;
  // absent that, fall back to the qpdf presence the compression probe already found,
  // so local-dev status reflects it without any extra wiring.
  const security = buildSecurityCapability(mode, securityQpdf ?? tools?.qpdf);
  const providers = getProviderReadiness(mode, env, workerObserved);
  const daemon = resolveDaemonReadiness(env);
  // Mode-independent, like `daemon`: the AI tools always run on the out-of-band
  // worker, so what matters is whether this deployment declares a provider at all.
  const ai = resolveAiReadiness(env);
  const pipeline = buildPipelineSummary(
    workerObserved === true,
    daemon.drainable,
  );

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
      scan,
      security,
      providers,
      daemon,
      ai,
      pipeline,
    };
  }

  if (mode === "remote-configured") {
    return {
      mode,
      enabled: false,
      localDevOnly: false,
      // Read alone, out of the context of its field, so it names its vantage.
      detail:
        "A worker backend is configured, but this web process ships no in-process pipeline; processing runs on the out-of-band secure worker when one is observed.",
      compress: { ...NO_COMPRESS },
      ocr,
      scan,
      security,
      providers,
      daemon,
      ai,
      pipeline,
    };
  }

  return {
    mode: "disabled",
    enabled: false,
    localDevOnly: false,
    // This string once read "No secure worker is configured in this
    // environment" and was rendered as the /status headline while OCR jobs ran
    // on the out-of-band worker — a `detail` is read alone, so it has to name
    // its own vantage (this web process), never the deployment's.
    detail:
      "This web process runs no in-process worker. File processing, including deep image compression, runs on the out-of-band secure worker when one is observed.",
    compress: { ...NO_COMPRESS },
    ocr,
    scan,
    security,
    providers,
    daemon,
    ai,
    pipeline,
  };
}
