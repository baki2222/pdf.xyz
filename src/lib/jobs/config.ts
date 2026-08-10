/**
 * Detects whether a real secure-worker backend is wired up — WITHOUT reading or
 * exposing any secret values.
 *
 * Security posture: we only test for the *presence* of the infrastructure
 * variables a deployment would set. Their contents are never read into a
 * variable, logged, serialized, or returned to a client. The variables checked
 * here are non-secret endpoint identifiers (a base URL, a bucket name, a queue
 * name); the actual credentials that authenticate to them are separate and are
 * never referenced by the web app. This keeps the "no fake processing" promise:
 * until every piece is present, the API answers honestly that it is not
 * configured.
 *
 * A production worker is composed of three independent providers, each gated by
 * its own variable so a deployment can be reasoned about (and later enabled) one
 * piece at a time:
 *  - the object-storage provider  (`PDFXYZ_STORAGE_BUCKET`) — ephemeral, encrypted
 *    input/output objects and the signed upload/download targets;
 *  - the job-queue provider       (`PDFXYZ_JOB_QUEUE`)      — enqueue/status/cancel;
 *  - the processor/worker service (`PDFXYZ_WORKER_URL`)     — the compute that runs
 *    the actual transformation.
 * The aggregate `REQUIRED_WORKER_ENV` is exactly the union of the three groups,
 * so nothing can drift between the per-provider and the whole-backend checks.
 */

type EnvSource = Record<string, string | undefined>;

/** A provider of the secure-worker backend, gated by its own env group. */
export type WorkerProviderKind = "storage" | "queue" | "processor";

/** Object-storage provider variable(s): ephemeral encrypted input/output store. */
export const STORAGE_ENV = ["PDFXYZ_STORAGE_BUCKET"] as const;

/** Job-queue provider variable(s): dispatch, status, and cancel for jobs. */
export const QUEUE_ENV = ["PDFXYZ_JOB_QUEUE"] as const;

/** Processor/worker-service variable(s): the compute that transforms inputs. */
export const PROCESSOR_ENV = ["PDFXYZ_WORKER_URL"] as const;

/**
 * Environment variables a fully-wired worker deployment must set (names only).
 * The union of every provider group. Order is stable — processor, storage,
 * queue — so the `missing[]` diagnostics list is deterministic.
 */
export const REQUIRED_WORKER_ENV = [
  ...PROCESSOR_ENV,
  ...STORAGE_ENV,
  ...QUEUE_ENV,
] as const;

/** The env-var group for each provider, keyed for per-provider readiness checks. */
export const PROVIDER_ENV: Record<WorkerProviderKind, readonly string[]> = {
  storage: STORAGE_ENV,
  queue: QUEUE_ENV,
  processor: PROCESSOR_ENV,
};

export interface WorkerBackendStatus {
  /** True only when every variable in the group is present and non-empty. */
  configured: boolean;
  /**
   * Names (never values) of the group's variables that are missing. Kept for
   * server-side diagnostics and tests; NOT surfaced to clients, to avoid
   * fingerprinting the deployment.
   */
  missing: string[];
}

/** Presence-only status for an arbitrary group of variable names. */
function presenceStatus(
  names: readonly string[],
  env: EnvSource,
): WorkerBackendStatus {
  const missing = names.filter((name) => {
    const value = env[name];
    return typeof value !== "string" || value.trim().length === 0;
  });
  return { configured: missing.length === 0, missing: [...missing] };
}

/**
 * Inspect an environment for a fully-configured worker backend (all providers).
 * Reads presence only. `env` is injectable so this is deterministically testable
 * without mutating the real process environment.
 */
export function getWorkerBackendStatus(
  env: EnvSource = process.env,
): WorkerBackendStatus {
  return presenceStatus(REQUIRED_WORKER_ENV, env);
}

/** Presence-only status of a single provider group (storage/queue/processor). */
export function getProviderEnvStatus(
  kind: WorkerProviderKind,
  env: EnvSource = process.env,
): WorkerBackendStatus {
  return presenceStatus(PROVIDER_ENV[kind], env);
}

/** Convenience: object-storage provider presence. */
export function getStorageEnvStatus(env: EnvSource = process.env) {
  return getProviderEnvStatus("storage", env);
}

/** Convenience: job-queue provider presence. */
export function getQueueEnvStatus(env: EnvSource = process.env) {
  return getProviderEnvStatus("queue", env);
}

/** Convenience: processor/worker-service presence. */
export function getProcessorEnvStatus(env: EnvSource = process.env) {
  return getProviderEnvStatus("processor", env);
}

/** Convenience boolean for the common whole-backend check. */
export function isWorkerBackendConfigured(
  env: EnvSource = process.env,
): boolean {
  return getWorkerBackendStatus(env).configured;
}
