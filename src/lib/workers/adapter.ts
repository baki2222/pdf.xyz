/**
 * Selects the {@link WorkerAdapter} for the current environment and provides the
 * two backend-less adapters. This is the seam the route handlers call: they hand
 * validated contract objects to whatever adapter this returns and serialize the
 * outcome. No branch here can fake success.
 */

import {
  notImplemented,
  workerNotConfigured,
  type ApiError,
  type ApiResult,
} from "@/lib/jobs";
import { resolveWorkerMode, type WorkerMode } from "./mode";
import { adapterError, type WorkerAdapter } from "./types";

/**
 * An adapter with no processing backend: every operation returns the same
 * honest error. Used for `disabled` (worker_not_configured / 503) and
 * `remote-configured` (not_implemented / 501).
 */
function backendlessAdapter(
  mode: WorkerMode,
  makeError: () => ApiResult<ApiError>,
): WorkerAdapter {
  const fail = () => adapterError(makeError());
  return {
    mode,
    async createUploadSession() {
      return fail();
    },
    async createJob() {
      return fail();
    },
    async getJob() {
      return fail();
    },
  };
}

/** The default adapter: no backend, no dev worker. Answers `worker_not_configured`. */
export function createDisabledAdapter(): WorkerAdapter {
  return backendlessAdapter("disabled", workerNotConfigured);
}

/** Backend endpoints present but no pipeline shipped. Answers `not_implemented`. */
export function createRemoteNotImplementedAdapter(): WorkerAdapter {
  return backendlessAdapter("remote-configured", notImplemented);
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
