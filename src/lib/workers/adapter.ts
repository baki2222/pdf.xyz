/**
 * Selects the {@link WorkerAdapter} for the current environment. This is the seam
 * the route handlers call: they hand validated contract objects to whatever
 * adapter this returns and serialize the outcome. No branch here can fake success.
 *
 * The non-local-dev path is a single **composed** adapter built from the resolved
 * object-storage provider plus the not-configured queue. When storage is a wired
 * S3/R2 provider, `createUploadSession` mints *real* signed upload targets; jobs
 * stay honestly not-configured because this build ships no queue/processor. When
 * storage is not-configured, every operation returns the same honest typed
 * failure as before (`worker_not_configured` / `not_implemented`) — the errors
 * originate from the provider contracts themselves, so they stay load-bearing.
 *
 * Layering note: this module is eager (pulled by the route bundle), so it imports
 * only node-free provider leaves. The local-dev adapter — and with it the
 * in-process store and native compression — is imported lazily, only when that
 * mode is active. The S3 factory/signing code is also imported lazily on the
 * non-local-dev request path, so this barrel remains safe for mode constants and
 * type exports.
 */

import { DEFAULT_RETENTION, type UploadSlot } from "@/lib/jobs";
import type { WorkerMode } from "./mode";
import { resolveWorkerMode } from "./mode";
import { newSessionId } from "./ids";
import { createNotConfiguredStorage } from "./storage/not-configured";
import { mapStorageFailure } from "./storage/errors";
import type { StorageProvider } from "./storage/types";
import { createNotConfiguredQueue } from "./queue/not-configured";
import { mapQueueFailure } from "./queue/errors";
import { adapterError, adapterOk, type AdapterOutcome, type WorkerAdapter } from "./types";

const MINUTE_MS = 60_000;

/** The not-configured provider id that matches a backend-less mode. */
function providerIdFor(mode: WorkerMode): "disabled" | "remote-unimplemented" {
  return mode === "remote-configured" ? "remote-unimplemented" : "disabled";
}

/**
 * A production-path adapter composed from a storage provider and the (this phase,
 * always not-configured) queue provider. Upload sessions flow through storage;
 * every job operation flows through the queue, which honestly denies until a real
 * broker is wired. A not-configured storage provider makes `createUploadSession`
 * deny too (its `probe` fails), reproducing the prior backend-less behavior
 * exactly.
 */
function composedAdapter(
  mode: WorkerMode,
  storage: StorageProvider,
): WorkerAdapter {
  const queue = createNotConfiguredQueue(providerIdFor(mode));

  // A not-configured provider's probe is a failure by construction; it is the
  // honest, typed source of every denied operation.
  const denyQueue = (): AdapterOutcome<never> => {
    const probe = queue.probe();
    if (probe.ok) throw new Error("unreachable: not-configured queue is ready");
    return adapterError(mapQueueFailure(probe.error));
  };

  return {
    mode,

    async createUploadSession(request) {
      // A not-configured storage provider fails here (503/501); a wired S3/R2
      // provider is ready and mints real, single-use signed targets below.
      const probe = storage.probe();
      if (!probe.ok) return adapterError(mapStorageFailure(probe.error));

      const sessionId = newSessionId();
      const slots: UploadSlot[] = [];
      let expiresAt: string | undefined;
      for (const file of request.files) {
        const reserved = await storage.reserveUpload({
          sessionId,
          filename: file.filename,
          contentType: file.contentType,
          declaredBytes: file.bytes,
        });
        if (!reserved.ok) return adapterError(mapStorageFailure(reserved.error));
        slots.push({
          fileId: reserved.value.fileId,
          filename: reserved.value.filename,
          url: reserved.value.target.url,
          method: reserved.value.target.method,
          headers: reserved.value.target.headers,
        });
        // The session expiry is the earliest slot's signed-URL expiry.
        if (expiresAt === undefined || reserved.value.expiresAt < expiresAt) {
          expiresAt = reserved.value.expiresAt;
        }
      }
      return adapterOk(
        {
          sessionId,
          tool: request.tool,
          slots,
          expiresAt:
            expiresAt ??
            new Date(
              Date.now() + DEFAULT_RETENTION.inputTtlMinutes * MINUTE_MS,
            ).toISOString(),
          retention: DEFAULT_RETENTION,
        },
        201,
      );
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
  return composedAdapter("disabled", createNotConfiguredStorage("disabled"));
}

/** Backend endpoints present but no pipeline shipped. Answers `not_implemented`. */
export function createRemoteNotImplementedAdapter(): WorkerAdapter {
  return composedAdapter(
    "remote-configured",
    createNotConfiguredStorage("remote-unimplemented"),
  );
}

/**
 * Resolve the active adapter from the environment. The local-dev adapter (and
 * with it every Node built-in it depends on) is imported lazily, so the default
 * and remote paths never pull the native compression code into their bundle.
 * On the non-local-dev path the storage provider is resolved from the
 * environment (a real S3/R2 provider when configured, else the honest
 * not-configured provider).
 */
export async function getWorkerAdapter(
  env: Record<string, string | undefined> = process.env,
): Promise<WorkerAdapter> {
  const mode = resolveWorkerMode(env);
  if (mode === "local-dev") {
    const { createLocalDevAdapter } = await import("./local-dev");
    return createLocalDevAdapter();
  }
  const { createStorageProvider } = await import("./storage/factory");
  return composedAdapter(mode, createStorageProvider(env));
}
