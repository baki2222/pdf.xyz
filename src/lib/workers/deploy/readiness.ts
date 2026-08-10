/**
 * The composed, operator-facing **deployment readiness** of the worker — the single
 * presence-only readout the daemon's `--dry-run-status`/`--check` prints so an
 * operator can tell, at a glance, which pieces of a safe production deployment are
 * green and which are intentionally or accidentally not.
 *
 * It folds six independent facets into one honest picture:
 *  - storage        — is object storage configured enough to run?
 *  - queue          — is a claimable job queue configured enough to run?
 *  - engine         — can this worker do lossless (always) and/or deep compression?
 *  - lifecycle      — is a retention/lifecycle backstop declared/validated/unknown?
 *  - malware-scan   — is an optional ClamAV scanner configured/ready/unavailable/off?
 *                     (never claims a scan happened unless one is configured & ready);
 *  - ocr            — an optional native OCR backend (Phase 23): `ready` only when a
 *                     real engine + runner are wired on this worker, else honestly
 *                     `not-configured`/`not-implemented` (never over-claims).
 *
 * Every facet is presence-only and content-free: a boolean-ish state plus a
 * one-line explanation that names no variable, secret, path, object key, endpoint,
 * or signed URL. The compression-engine health is *injected* (the Node runtime
 * probes the host and passes it in) so this module stays node-free and reusable from
 * any surface; when no engine health is supplied the engine facet is honestly
 * `unknown` rather than guessed.
 */

import type { DaemonReadiness } from "../daemon/readiness";
import { buildOcrCapability } from "../ocr";
import {
  resolveLifecycleReadiness,
  type LifecycleReadiness,
} from "../lifecycle";
import {
  resolveMalwareScanReadiness,
  type MalwareScanReadiness,
} from "./scanner";

type EnvSource = Record<string, string | undefined>;

/** The health of a single deployment facet. */
export type FacetState =
  | "ready" // configured and usable now
  | "degraded" // usable but with a caveat an operator should notice
  | "not-configured" // simply not wired (an honest, expected default)
  | "not-implemented" // intentionally not shipped in this build
  | "unknown"; // cannot be determined from here

/** A deployment facet identifier. */
export type FacetId =
  "storage" | "queue" | "engine" | "lifecycle" | "malware-scan" | "ocr";

/** One presence-only facet of the deployment readiness. */
export interface OperationalFacet {
  readonly id: FacetId;
  /** Short human label for the facet. */
  readonly label: string;
  readonly state: FacetState;
  /** One-line, content-free explanation. Never names a variable or value. */
  readonly detail: string;
}

/** The overall deployment posture, derived from the facets. */
export type DeploymentPosture =
  | "ready" // drainable and the recommended backstops are in place
  | "degraded" // drainable, but a caveat should be addressed before production
  | "blocked"; // not drainable — a worker cannot run here at all

/** The full, content-free deployment readiness. */
export interface WorkerDeploymentReadiness {
  /** True only when queue AND storage are both configured (a worker CAN run). */
  readonly drainable: boolean;
  readonly posture: DeploymentPosture;
  readonly facets: OperationalFacet[];
  readonly lifecycle: LifecycleReadiness;
  readonly malwareScan: MalwareScanReadiness;
  /** One-line, content-free summary of the posture. */
  readonly detail: string;
}

/**
 * The injected, presence-only compression-engine health (structurally the runtime's
 * `CompressionEngineHealth`). Kept as a local structural type so this module never
 * imports the Node-only runtime.
 */
export interface EngineHealthInput {
  readonly lossless: boolean;
  readonly deep: boolean;
  readonly engines: readonly string[];
}

/**
 * The injected, presence-only OCR health (structurally the wired OCR processor's
 * capability). Kept as a local structural type so this module never imports the
 * Node-only OCR runner. Omit ⇒ the OCR facet is honestly `not-implemented` (the
 * default in every environment that has not opted into an OCR backend).
 */
export interface OcrHealthInput {
  /** True only when a real OCR runner is wired AND an engine is present on the worker. */
  readonly ready: boolean;
  /** One-line, content-free explanation. Never names a variable, path, or value. */
  readonly detail: string;
}

/** Inputs for composing the readiness — all optional and injectable for tests. */
export interface DeploymentReadinessDeps {
  /** Probed compression-engine health (from the Node runtime). Omit ⇒ engine facet `unknown`. */
  readonly engine?: EngineHealthInput;
  /**
   * Wired OCR health (from the Node runtime's registered OCR processor). Omit ⇒ the
   * OCR facet is `not-implemented`, preserving the honest default; supplied and
   * `ready` ⇒ `ready`; supplied and not ready ⇒ `not-configured` (a backend exists in
   * this build but isn't enabled/installed here).
   */
  readonly ocr?: OcrHealthInput;
}

function engineFacet(engine: EngineHealthInput | undefined): OperationalFacet {
  if (!engine) {
    return {
      id: "engine",
      label: "Compression engine",
      state: "unknown",
      detail:
        "Compression-engine availability was not probed in this context; the daemon probes the host and reports lossless (always) and deep (native) capability.",
    };
  }
  if (engine.deep) {
    return {
      id: "engine",
      label: "Compression engine",
      state: "ready",
      detail:
        "Lossless structural repack and deep image compression are both available on this worker (a native engine is installed).",
    };
  }
  return {
    id: "engine",
    label: "Compression engine",
    state: "degraded",
    detail:
      "Lossless structural repack is available, but no native engine is installed, so deep image compression is not — deep jobs fail honestly as not_implemented.",
  };
}

function lifecycleFacet(lifecycle: LifecycleReadiness): OperationalFacet {
  const state: FacetState =
    lifecycle.state === "validated"
      ? "ready"
      : lifecycle.state === "unknown"
        ? "unknown"
        : "degraded"; // declared-but-unverified or invalid
  return {
    id: "lifecycle",
    label: "Lifecycle backstop",
    state,
    detail: lifecycle.detail,
  };
}

function malwareFacet(scan: MalwareScanReadiness): OperationalFacet {
  // `ready` → a scanner is configured and inputs are scanned; `unavailable` (selected
  // but its endpoint config is missing/malformed) is a caveat worth surfacing as
  // `degraded`; `disabled`/`not-configured` are honest "no scanning here" defaults.
  const state: FacetState =
    scan.state === "ready"
      ? "ready"
      : scan.state === "unavailable"
        ? "degraded"
        : "not-configured";
  return {
    id: "malware-scan",
    label: "Malware scanning",
    state,
    detail: scan.detail,
  };
}

/**
 * Derive the OCR facet from the injected OCR health. With none supplied, OCR is
 * honestly `not-implemented` (the default this build ships in — no OCR backend
 * opted into); supplied and `ready` ⇒ `ready` (a real engine + runner are wired on
 * this worker); supplied and not ready ⇒ `not-configured` (the OCR backend exists in
 * the build but is disabled or has no engine installed here). Never over-claims.
 */
function ocrFacet(
  mode: DaemonReadiness["mode"],
  ocr: OcrHealthInput | undefined,
): OperationalFacet {
  if (!ocr) {
    return {
      id: "ocr",
      label: "OCR",
      state: "not-implemented",
      detail: buildOcrCapability(mode).detail,
    };
  }
  return {
    id: "ocr",
    label: "OCR",
    state: ocr.ready ? "ready" : "not-configured",
    detail: ocr.detail,
  };
}

/**
 * Compose the full {@link WorkerDeploymentReadiness} from a resolved
 * {@link DaemonReadiness} (storage/queue/drainable) plus the environment (lifecycle,
 * malware) and injected engine + OCR health. Pure and deterministic; `env` is
 * injectable. Content-free throughout.
 */
export function resolveDeploymentReadiness(
  daemon: DaemonReadiness,
  env: EnvSource = process.env,
  deps: DeploymentReadinessDeps = {},
): WorkerDeploymentReadiness {
  const lifecycle = resolveLifecycleReadiness(env);
  const malwareScan = resolveMalwareScanReadiness(env);
  // OCR is now an OPTIONAL backend (Phase 23): the runtime injects the wired OCR
  // processor's health so this facet reflects reality. With none injected it stays
  // honestly not-implemented, reusing the OCR capability layer's mode-specific detail.
  const ocr = ocrFacet(daemon.mode, deps.ocr);

  const facets: OperationalFacet[] = [
    {
      id: "storage",
      label: "Object storage",
      state: daemon.storageConfigured ? "ready" : "not-configured",
      detail: daemon.storageConfigured
        ? "Object storage is configured, so a worker can read inputs and write artifacts."
        : "Object storage is not configured, so a worker has nowhere to read inputs from or write artifacts to.",
    },
    {
      id: "queue",
      label: "Job queue",
      state: daemon.queueConfigured ? "ready" : "not-configured",
      detail: daemon.queueConfigured
        ? "A claimable job queue is configured, so a worker can claim and complete jobs; its state transitions are atomic and race-safe (server-side compare-and-set)."
        : "A claimable job queue is not configured, so a worker has nothing to drain.",
    },
    engineFacet(deps.engine),
    lifecycleFacet(lifecycle),
    malwareFacet(malwareScan),
    ocr,
  ];

  const posture: DeploymentPosture = !daemon.drainable
    ? "blocked"
    : lifecycle.state === "validated"
      ? "ready"
      : "degraded";

  const scanNote = malwareScan.active
    ? " A malware scanner is configured, so inputs are scanned before processing."
    : " Malware scanning is optional and not active here.";
  const ocrNote =
    ocr.state === "ready"
      ? " OCR is available on this worker."
      : " OCR is optional and not enabled here.";
  const detail =
    posture === "blocked"
      ? "Blocked: the queue and/or object storage are not configured, so no worker can run in this environment."
      : posture === "ready"
        ? `Ready: the queue and storage are configured and a lifecycle backstop is declared and validated.${scanNote}${ocrNote}`
        : // Degraded still surfaces the optional scan/OCR facets so an operator sees
          // what IS on (e.g. OCR ready) even while a backstop is unverified.
          `Degraded: a worker can run, but a recommended backstop is missing or unverified (typically the lifecycle/retention policy). Review the facets before production.${scanNote}${ocrNote}`;

  return {
    drainable: daemon.drainable,
    posture,
    facets,
    lifecycle,
    malwareScan,
    detail,
  };
}
