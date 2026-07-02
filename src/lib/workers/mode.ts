/**
 * Worker execution mode — how (and whether) the app talks to a processing
 * backend in the current environment.
 *
 * This is the single, presence-only switch that keeps the "no fake processing"
 * promise. Nothing here reads, logs, serializes, or returns a secret value; it
 * inspects the *mode flag* and the *presence* of the backend endpoint
 * identifiers only (their contents are never touched — see
 * `getWorkerBackendStatus` in `@/lib/jobs`). Until a mode is explicitly enabled,
 * the API answers honestly that it is not configured.
 */

import { isWorkerBackendConfigured } from "@/lib/jobs";

/**
 * The active execution model, in increasing order of capability:
 *
 * - `disabled`: no backend and no dev worker. Every job endpoint answers
 *   `worker_not_configured` (503). This is the default in every environment,
 *   including the production build the e2e suite exercises.
 * - `remote-configured`: the production backend endpoints are present, but this
 *   build ships no pipeline for them, so the endpoints answer `not_implemented`
 *   (501). A real remote worker will replace this branch.
 * - `local-dev`: an explicit, developer-only in-process worker enabled with
 *   `PDFXYZ_WORKER_MODE=local-dev`. It performs real work when it honestly can
 *   (lossless structural repack) and fails honestly when it cannot (deep image
 *   compression with no native binary installed). Never used in production.
 */
export type WorkerMode = "disabled" | "remote-configured" | "local-dev";

/** The env var that explicitly opts a *developer* machine into local processing. */
export const WORKER_MODE_ENV = "PDFXYZ_WORKER_MODE";

/** The only recognized activation value of {@link WORKER_MODE_ENV}. */
export const LOCAL_DEV_MODE_VALUE = "local-dev";

type EnvSource = Record<string, string | undefined>;

/**
 * Resolve the active worker mode from the environment. Reads the mode flag and
 * backend presence only — never a secret value. An explicit local-dev opt-in
 * always wins, so a developer can exercise the local worker even on a machine
 * that also has the production endpoint variables set. `env` is injectable so
 * this is deterministically testable without mutating the real process env.
 */
export function resolveWorkerMode(env: EnvSource = process.env): WorkerMode {
  const flag = env[WORKER_MODE_ENV]?.trim().toLowerCase();
  if (flag === LOCAL_DEV_MODE_VALUE) return "local-dev";
  if (isWorkerBackendConfigured(env)) return "remote-configured";
  return "disabled";
}

/** True only when the developer-only local worker is explicitly enabled. */
export function isLocalDevWorker(env: EnvSource = process.env): boolean {
  return resolveWorkerMode(env) === "local-dev";
}
