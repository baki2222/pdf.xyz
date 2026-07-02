/**
 * The honest, presence-only readiness of the three secure-worker providers —
 * object storage, job queue, and the processor/worker service — for the current
 * {@link WorkerMode}.
 *
 * This is the client-safe seam that lets the `/status` page and the tool pages
 * explain the production pipeline honestly: which pieces are live, which are
 * configured-but-not-implemented, and which are simply not wired. It is pure and
 * node-free (it constructs only the not-configured providers, reuses the
 * local-dev capability *constants*, and derives S3 readiness from a node-free
 * config check), so it never pulls the in-process store or the signer into a
 * client bundle and never reads a secret.
 *
 * Object storage is the one provider derived from *its own* configuration rather
 * than the worker mode: a deployment that has wired S3/R2 storage reports it
 * ready — separately from the queue/processor, which stay mode-derived — while
 * still exposing nothing about which variables are set (the S3 capability names
 * no bucket, endpoint, region, key, or value). The queue/processor remain
 * mode-derived so a partially configured broker cannot be fingerprinted.
 * (Per-variable diagnostics live server-side in `@/lib/jobs`
 * `getProviderEnvStatus` and `parseS3Config`.)
 */

import type { WorkerMode } from "./mode";
import { createNotConfiguredStorage } from "./storage/not-configured";
import { resolveStorageCapability } from "./storage/s3-config";
import {
  LOCAL_DEV_STORAGE_CAPABILITY,
  type StorageCapability,
} from "./storage/types";
import { createNotConfiguredQueue } from "./queue/not-configured";
import { LOCAL_DEV_QUEUE_CAPABILITY, type QueueCapability } from "./queue/types";

/**
 * The execution loop that claims queued jobs and dispatches a processor.
 * Presence-only: it says *how* jobs are executed in this environment, never
 * naming a broker, worker URL, or any variable.
 */
export interface ExecutorReadiness {
  /**
   * - `in-process`: the local-dev worker runs jobs synchronously in this process
   *   (and the async claim/execute loop foundation is available for a broker).
   * - `not-implemented`: a worker service is configured but this build ships no
   *   execution loop, so no job is dispatched.
   * - `none`: no execution loop is configured.
   */
  mode: "in-process" | "not-implemented" | "none";
  /** True only when a processor can be dispatched for a job now. */
  ready: boolean;
  /** One-line, client-safe explanation. Never names a variable or a value. */
  detail: string;
}

/** The processor/worker service: the compute that runs a job's transformation. */
export interface ProcessorStatus {
  /** True only when a job can actually be processed now. */
  ready: boolean;
  /** Worker service present in env but no pipeline shipped (remote-configured). */
  configured: boolean;
  /** One-line, client-safe explanation. Never names a variable or a value. */
  detail: string;
  /** Presence-only readiness of the worker-execution loop (Phase 13). */
  executor: ExecutorReadiness;
}

/** Presence-only readiness of every provider behind the worker adapter. */
export interface WorkerProviders {
  storage: StorageCapability;
  queue: QueueCapability;
  processor: ProcessorStatus;
}

const PROCESSOR_DETAIL: Record<WorkerMode, string> = {
  "local-dev":
    "Local-dev processor runs supported jobs (lossless compression) in-process on this machine. Deep image compression additionally needs a native engine installed.",
  "remote-configured":
    "A worker service is configured, but this build ships no processor pipeline, so no job is executed yet.",
  disabled:
    "No processor is configured. Secure-worker tools (OCR, conversions, repair, deep compression) cannot run in this environment.",
};

const EXECUTOR_READINESS: Record<WorkerMode, ExecutorReadiness> = {
  "local-dev": {
    mode: "in-process",
    ready: true,
    detail:
      "Jobs run in-process on this machine; the async claim/execute loop foundation is available to drive a production broker.",
  },
  "remote-configured": {
    mode: "not-implemented",
    ready: false,
    detail:
      "A worker service is configured, but this build ships no execution loop, so no job is claimed or dispatched yet.",
  },
  disabled: {
    mode: "none",
    ready: false,
    detail:
      "No execution loop is configured; no job is claimed or dispatched in this environment.",
  },
};

/**
 * Derive the client-facing readiness of all three providers from the resolved
 * mode and the environment. Storage readiness comes from its own config (S3/R2)
 * so it can be ready independently; queue/processor stay mode-derived. Pure and
 * deterministic; `env` is injectable for tests. The status route passes the
 * result straight into {@link buildWorkerStatus}.
 */
export function getProviderReadiness(
  mode: WorkerMode,
  env: Record<string, string | undefined> = process.env,
): WorkerProviders {
  // In local-dev mode the in-process store is what actually serves uploads, so
  // storage reports the local-dev capability regardless of any S3 variables (the
  // explicit local-dev opt-in always wins, exactly as it does for the adapter).
  if (mode === "local-dev") {
    return {
      storage: LOCAL_DEV_STORAGE_CAPABILITY,
      queue: LOCAL_DEV_QUEUE_CAPABILITY,
      processor: {
        ready: true,
        configured: false,
        detail: PROCESSOR_DETAIL["local-dev"],
        executor: EXECUTOR_READINESS["local-dev"],
      },
    };
  }

  const id = mode === "remote-configured" ? "remote-unimplemented" : "disabled";
  // S3 storage (if fully configured) is the real provider serving uploads on the
  // production path; otherwise fall back to the honest not-configured capability.
  const storage =
    resolveStorageCapability(env) ?? createNotConfiguredStorage(id).capability();
  return {
    storage,
    queue: createNotConfiguredQueue(id).capability(),
    processor: {
      ready: false,
      configured: mode === "remote-configured",
      detail: PROCESSOR_DETAIL[mode],
      executor: EXECUTOR_READINESS[mode],
    },
  };
}
