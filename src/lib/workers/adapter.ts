/**
 * Selects the {@link WorkerAdapter} for the current environment and provides the
 * two backend-less adapters. This is the seam the route handlers call: they hand
 * validated contract objects to whatever adapter this returns and serialize the
 * outcome. No branch here can fake success.
 *
 * The backend-less adapters are composed from the *not-configured* storage and
 * queue providers and delegate to them, so the honest `worker_not_configured` /
 * `not_implemented` responses originate from the provider contracts themselves —
 * the same contracts a real backend implements — rather than from a hand-rolled
 * error. This keeps the providers load-bearing on the production path.
 *
 * Layering note: this module is eager (pulled by the route bundle), so it imports
 * only the node-free provider leaves (`./storage/not-configured`, `./errors`,
 * …). The local-dev adapter — and with it the in-process store and native
 * compression code — is imported lazily, only when that mode is active.
 */

import type { WorkerMode } from "./mode";
import { resolveWorkerMode } from "./mode";
import { createNotConfiguredStorage } from "./storage/not-configured";
import { mapStorageFailure } from "./storage/errors";
import { createNotConfiguredQueue } from "./queue/not-configured";
import { mapQueueFailure } from "./queue/errors";
import { adapterError, type AdapterOutcome, type WorkerAdapter } from "./types";

/** The not-configured provider id that matches a backend-less mode. */
function providerIdFor(mode: WorkerMode): "disabled" | "remote-unimplemented" {
  return mode === "remote-configured" ? "remote-unimplemented" : "disabled";
}

/**
 * An adapter with no processing backend. Every operation delegates to the
 * not-configured storage/queue providers, which return the honest typed failure
 * (`not_configured` for `disabled`, `not_implemented` for `remote-configured`).
 */
function backendlessAdapter(mode: WorkerMode): WorkerAdapter {
  const id = providerIdFor(mode);
  const storage = createNotConfiguredStorage(id);
  const queue = createNotConfiguredQueue(id);

  // A not-configured provider's probe is a failure by construction; it is the
  // honest, typed source of every error this adapter returns.
  const denyStorage = (): AdapterOutcome<never> => {
    const probe = storage.probe();
    if (probe.ok) throw new Error("unreachable: not-configured storage is ready");
    return adapterError(mapStorageFailure(probe.error));
  };
  const denyQueue = (): AdapterOutcome<never> => {
    const probe = queue.probe();
    if (probe.ok) throw new Error("unreachable: not-configured queue is ready");
    return adapterError(mapQueueFailure(probe.error));
  };

  return {
    mode,
    async createUploadSession() {
      return denyStorage();
    },
    async createJob() {
      return denyQueue();
    },
    async getJob() {
      return denyQueue();
    },
    async cancelJob() {
      return denyQueue();
    },
  };
}

/** The default adapter: no backend, no dev worker. Answers `worker_not_configured`. */
export function createDisabledAdapter(): WorkerAdapter {
  return backendlessAdapter("disabled");
}

/** Backend endpoints present but no pipeline shipped. Answers `not_implemented`. */
export function createRemoteNotImplementedAdapter(): WorkerAdapter {
  return backendlessAdapter("remote-configured");
}

/**
 * Resolve the active adapter from the environment. The local-dev adapter (and
 * with it every Node built-in it depends on) is imported lazily, so the default
 * and remote paths never pull the native compression code into their bundle.
 */
export async function getWorkerAdapter(
  env: Record<string, string | undefined> = process.env,
): Promise<WorkerAdapter> {
  switch (resolveWorkerMode(env)) {
    case "local-dev": {
      const { createLocalDevAdapter } = await import("./local-dev");
      return createLocalDevAdapter();
    }
    case "remote-configured":
      return createRemoteNotImplementedAdapter();
    case "disabled":
    default:
      return createDisabledAdapter();
  }
}
