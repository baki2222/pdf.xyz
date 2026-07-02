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
 *  - malware-scan   — explicitly NOT implemented in this build (never claims a scan);
 *  - ocr            — explicitly NOT implemented in this build.
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
import { resolveLifecycleReadiness, type LifecycleReadiness } from "../lifecycle";
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
  | "storage"
  | "queue"
  | "engine"
  | "lifecycle"
  | "malware-scan"
  | "ocr";

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

/** Inputs for composing the readiness — all optional and injectable for tests. */
export interface DeploymentReadinessDeps {
  /** Probed compression-engine health (from the Node runtime). Omit ⇒ engine facet `unknown`. */
  readonly engine?: EngineHealthInput;
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
  return {
    id: "malware-scan",
    label: "Malware scanning",
    state: scan.state === "not-configured" ? "not-configured" : "not-implemented",
    detail: scan.detail,
  };
}

/**
 * Compose the full {@link WorkerDeploymentReadiness} from a resolved
 * {@link DaemonReadiness} (storage/queue/drainable) plus the environment (lifecycle,
 * malware) and an injected engine health. Pure and deterministic; `env` is
 * injectable. Content-free throughout.
 */
export function resolveDeploymentReadiness(
  daemon: DaemonReadiness,
  env: EnvSource = process.env,
  deps: DeploymentReadinessDeps = {},
): WorkerDeploymentReadiness {
  const lifecycle = resolveLifecycleReadiness(env);
  const malwareScan = resolveMalwareScanReadiness(env);
  // OCR is never probed — this build ships no OCR pipeline in any mode — so it is
  // honestly not-implemented everywhere, with its own detail reused from the OCR
  // capability layer.
  const ocr = buildOcrCapability(daemon.mode);

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
    {
      id: "ocr",
      label: "OCR",
      state: "not-implemented",
      detail: ocr.detail,
    },
  ];

  const posture: DeploymentPosture = !daemon.drainable
    ? "blocked"
    : lifecycle.state === "validated"
      ? "ready"
      : "degraded";

  const detail =
    posture === "blocked"
      ? "Blocked: the queue and/or object storage are not configured, so no worker can run in this environment."
      : posture === "ready"
        ? "Ready: the queue and storage are configured and a lifecycle backstop is declared and validated. Malware scanning and OCR remain intentionally not implemented."
        : "Degraded: a worker can run, but a recommended backstop is missing or unverified (typically the lifecycle/retention policy). Review the facets before production.";

  return { drainable: daemon.drainable, posture, facets, lifecycle, malwareScan, detail };
}
