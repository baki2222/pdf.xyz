/**
 * The storage-provider selector for the eager (production) request path.
 *
 * It returns the *real* S3-compatible provider when — and only when — the
 * environment explicitly selects S3 (`PDFXYZ_STORAGE_PROVIDER=s3`) and every
 * required variable is present and well-formed. Otherwise it returns the honest
 * not-configured provider, so a missing or half-configured backend can only ever
 * yield a typed failure — never a fabricated signed URL. The fallback id mirrors
 * the resolved worker mode (`remote-unimplemented` when the legacy backend
 * variables are present, else `disabled`), keeping the pre-existing 501/503
 * behavior exactly when S3 is not in play.
 *
 * This module pulls the signer (`node:crypto`) but NOT the in-process dev store,
 * so it stays safe for the eager adapter bundle. The presence-only status layer
 * uses `resolveStorageCapability` from `./s3-config` instead (node-free).
 */

import { isWorkerBackendConfigured } from "@/lib/jobs";
import { createNotConfiguredStorage } from "./not-configured";
import { parseS3Config } from "./s3-config";
import { createS3Storage, type S3StorageDeps } from "./s3";
import type { StorageProvider } from "./types";

type EnvSource = Record<string, string | undefined>;

/**
 * Resolve the active storage provider from the environment. `deps` (clock +
 * delete transport) are forwarded to the S3 provider so callers/tests can inject
 * them; they are ignored for the not-configured fallback.
 */
export function createStorageProvider(
  env: EnvSource = process.env,
  deps: S3StorageDeps = {},
): StorageProvider {
  const parsed = parseS3Config(env);
  if (parsed.ok) return createS3Storage(parsed.config, deps);

  // Not S3 (unset, or selected-but-invalid): fall back to the honest
  // not-configured provider, preserving the mode-based reason/status.
  const fallbackId = isWorkerBackendConfigured(env)
    ? "remote-unimplemented"
    : "disabled";
  return createNotConfiguredStorage(fallbackId);
}
