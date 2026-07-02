/**
 * The honest, presence-only readiness of the three secure-worker providers —
 * object storage, job queue, and the processor/worker service — for the current
 * {@link WorkerMode}.
 *
 * This is the client-safe seam that lets the `/status` page and the tool pages
 * explain the production pipeline honestly: which pieces are live, which are
 * configured-but-not-implemented, and which are simply not wired. It is pure and
 * node-free (it constructs only the not-configured providers and reuses the
 * local-dev capability *constants*), so it never pulls the in-process store into
 * a client bundle and never reads a secret. Readiness is derived from the mode
 * alone — not from which individual variables are present — so a partially
 * configured deployment cannot be fingerprinted from the client. (Per-variable
 * diagnostics live server-side in `@/lib/jobs` `getProviderEnvStatus`.)
 */

import type { WorkerMode } from "./mode";
import { createNotConfiguredStorage } from "./storage/not-configured";
import {
  LOCAL_DEV_STORAGE_CAPABILITY,
  type StorageCapability,
} from "./storage/types";
import { createNotConfiguredQueue } from "./queue/not-configured";
import { LOCAL_DEV_QUEUE_CAPABILITY, type QueueCapability } from "./queue/types";

/** The processor/worker service: the compute that runs a job's transformation. */
export interface ProcessorStatus {
  /** True only when a job can actually be processed now. */
  ready: boolean;
  /** Worker service present in env but no pipeline shipped (remote-configured). */
  configured: boolean;
  /** One-line, client-safe explanation. Never names a variable or a value. */
  detail: string;
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

/**
 * Derive the client-facing readiness of all three providers from the resolved
 * mode. Pure and deterministic; the status route passes the result straight into
 * {@link buildWorkerStatus}.
 */
export function getProviderReadiness(mode: WorkerMode): WorkerProviders {
  if (mode === "local-dev") {
    return {
      storage: LOCAL_DEV_STORAGE_CAPABILITY,
      queue: LOCAL_DEV_QUEUE_CAPABILITY,
      processor: {
        ready: true,
        configured: false,
        detail: PROCESSOR_DETAIL["local-dev"],
      },
    };
  }

  const id = mode === "remote-configured" ? "remote-unimplemented" : "disabled";
  return {
    storage: createNotConfiguredStorage(id).capability(),
    queue: createNotConfiguredQueue(id).capability(),
    processor: {
      ready: false,
      configured: mode === "remote-configured",
      detail: PROCESSOR_DETAIL[mode],
    },
  };
}
