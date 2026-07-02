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
 */

/** Environment variables a fully-wired worker deployment must set (names only). */
export const REQUIRED_WORKER_ENV = [
  "PDFXYZ_WORKER_URL", // base URL of the job/worker service
  "PDFXYZ_STORAGE_BUCKET", // object storage bucket for ephemeral files
  "PDFXYZ_JOB_QUEUE", // queue name/URL for dispatching jobs
] as const;

export interface WorkerBackendStatus {
  /** True only when every required variable is present and non-empty. */
  configured: boolean;
  /**
   * Names (never values) of the required variables that are missing. Kept for
   * server-side diagnostics and tests; NOT surfaced to clients, to avoid
   * fingerprinting the deployment.
   */
  missing: string[];
}

type EnvSource = Record<string, string | undefined>;

/**
 * Inspect an environment for a configured worker backend. Reads presence only.
 * `env` is injectable so this is deterministically testable without mutating the
 * real process environment.
 */
export function getWorkerBackendStatus(
  env: EnvSource = process.env,
): WorkerBackendStatus {
  const missing = REQUIRED_WORKER_ENV.filter((name) => {
    const value = env[name];
    return typeof value !== "string" || value.trim().length === 0;
  });
  return { configured: missing.length === 0, missing: [...missing] };
}

/** Convenience boolean for the common check. */
export function isWorkerBackendConfigured(env: EnvSource = process.env): boolean {
  return getWorkerBackendStatus(env).configured;
}
