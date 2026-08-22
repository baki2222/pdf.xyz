/**
 * Presence-only readiness of the out-of-band worker daemon, derived entirely from
 * whether the two providers it needs — the job queue and object storage — are
 * configured in this environment.
 *
 * This is the honest seam that keeps `/api/worker/status` truthful about a subtle
 * distinction: a deployment can have a *drainable* queue + storage (so a worker
 * daemon COULD run) while the web app itself still processes nothing.
 *
 * Configuration is answered from the environment; LIVENESS is
 * not derivable from it, so it is PASSED IN — the caller already holds the
 * worker's own heartbeat verdict.
 *
 * That parameter exists because the sentence here used to end "whether a worker
 * daemon is actually running is out-of-band and not observable here", which was
 * true when written and false by the time heartbeats shipped: the very same
 * `/api/worker/status` payload derives `ocr.available` and `scan.active` from an
 * observed heartbeat, two fields above. The caller had `workerObserved` on the
 * line before this one and did not pass it.
 *
 * Node-free (it reuses the same presence-only config checks the status layer
 * already uses), so it is safe to import from the `/api/worker/status` route and
 * the `/status` page bundle. It never reads, returns, or names a secret value.
 */

import { resolveWorkerMode, type WorkerMode } from "../mode";
import { resolveStorageCapability } from "../storage/s3-config";
import { resolveQueueCapability } from "../queue/redis-config";

type EnvSource = Record<string, string | undefined>;

/** The honest, client-safe readiness of the (separate) worker daemon. */
export interface DaemonReadiness {
  /** The resolved web-app worker mode, for context. */
  mode: WorkerMode;
  /** True when a configured, drainable job-queue broker is present. */
  queueConfigured: boolean;
  /** True when a configured object-storage provider the worker can read/write is present. */
  storageConfigured: boolean;
  /**
   * True only when BOTH the queue and storage are configured, so a separately
   * deployed worker daemon genuinely CAN claim, run, and complete jobs here.
   */
  drainable: boolean;
  /**
   * Whether THIS process runs the draining daemon. Always `false`: the daemon is
   * a separate, out-of-band process and the web app never becomes it. Honest by
   * construction. Whether one is deployed AND alive is a separate question,
   * answered by the heartbeat the caller passes in, not by this flag.
   */
  runsInThisProcess: false;
  /** One-line, client-safe explanation. Never names a variable, URL, or value. */
  detail: string;
}

function describe(
  mode: WorkerMode,
  drainable: boolean,
  queueConfigured: boolean,
  storageConfigured: boolean,
  observed: boolean,
): string {
  if (mode === "local-dev") {
    return "In local-dev mode the in-process worker runs supported jobs on this machine; a separate worker daemon is not used. Production runs an out-of-band daemon that drains a configured queue and storage.";
  }
  if (drainable && observed) {
    return "The job queue and object storage are configured, and a worker daemon's liveness heartbeat is being observed right now, so jobs are being claimed and completed out-of-band. This app still processes nothing itself.";
  }
  if (drainable) {
    return "The job queue and object storage are configured, so a separately deployed worker daemon can claim, run, and complete jobs by draining the queue. This app never processes jobs itself, and no worker daemon's liveness heartbeat is being observed right now.";
  }
  if (queueConfigured) {
    return "The job queue is configured, but object storage is not, so a worker daemon has nowhere to read inputs from or write artifacts to yet; jobs stay queued.";
  }
  if (storageConfigured) {
    return "Object storage is configured, but the job queue is not, so a worker daemon has nothing to drain yet.";
  }
  return "Neither the job queue nor object storage is configured, so no worker daemon can run in this environment; nothing is processed.";
}

/**
 * Resolve the out-of-band worker daemon's readiness from the environment.
 * Presence-only and deterministic; `env` is injectable for tests. The `drainable`
 * signal is mode-independent (a deployed daemon uses the real providers whatever
 * the web app's mode is), while `detail` is mode-aware so the local-dev nuance is
 * explained honestly.
 */
export function resolveDaemonReadiness(
  env: EnvSource = process.env,
  observed?: boolean,
): DaemonReadiness {
  const mode = resolveWorkerMode(env);
  const storageConfigured = resolveStorageCapability(env) !== null;
  const queueConfigured = resolveQueueCapability(env) !== null;
  const drainable = storageConfigured && queueConfigured;
  return {
    mode,
    queueConfigured,
    storageConfigured,
    drainable,
    runsInThisProcess: false,
    detail: describe(
      mode,
      drainable,
      queueConfigured,
      storageConfigured,
      observed === true,
    ),
  };
}
