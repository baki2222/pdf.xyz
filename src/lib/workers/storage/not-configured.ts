/**
 * The honest default object-storage providers: one for when no storage is wired
 * (`disabled`) and one for when the bucket variable is present but this build
 * ships no storage client (`remote-unimplemented`).
 *
 * Neither can mint a usable target or delete a real object — every operation
 * returns the same typed failure, so nothing above them can mistake a stub for
 * working storage. This is the module that keeps the "no fake signed URLs"
 * promise on the production path.
 */

import type {
  StorageProvider,
  StorageProviderId,
  StorageResult,
} from "./types";
import { storageFail } from "./types";

const NOT_CONFIGURED_DETAIL =
  "No object-storage provider is configured in this environment. Uploads, signed downloads, and delete-now are unavailable; nothing is stored.";

const NOT_IMPLEMENTED_DETAIL =
  "An object-storage bucket is configured, but this build ships no storage client. Wire a provider to the storage contract to enable signed uploads, downloads, and deletion.";

const MESSAGE_NOT_CONFIGURED =
  "The secure worker's object storage is not configured in this environment. No file is stored, no upload or download URL is minted, and nothing is deleted. See docs/WORKER_ARCHITECTURE.md.";

const MESSAGE_NOT_IMPLEMENTED =
  "An object-storage bucket is configured, but this build ships no storage client, so no upload or download target can be minted. See docs/WORKER_ARCHITECTURE.md.";

/**
 * A storage provider with no backend. `disabled` fails every op with
 * `not_configured`; `remote-unimplemented` fails with `not_implemented`. Both
 * report `ready: false` and no capabilities.
 */
export function createNotConfiguredStorage(
  id: Extract<StorageProviderId, "disabled" | "remote-unimplemented">,
): StorageProvider {
  const configured = id === "remote-unimplemented";
  const reason = configured ? "not_implemented" : "not_configured";
  const message = configured ? MESSAGE_NOT_IMPLEMENTED : MESSAGE_NOT_CONFIGURED;
  const detail = configured ? NOT_IMPLEMENTED_DETAIL : NOT_CONFIGURED_DETAIL;

  const fail = <T>(): StorageResult<T> => storageFail<T>(reason, message);

  return {
    id,
    probe() {
      return fail<void>();
    },
    async reserveUpload() {
      return fail();
    },
    async reserveDownload() {
      return fail();
    },
    async deleteNow() {
      return fail();
    },
    capability() {
      return {
        provider: id,
        ready: false,
        configured,
        signedUploads: false,
        signedDownloads: false,
        deleteNow: false,
        detail,
      };
    },
  };
}
