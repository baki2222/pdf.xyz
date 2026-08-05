/**
 * The developer-only, in-process object-storage provider.
 *
 * It implements the {@link StorageProvider} contract against {@link DevWorkerStore}
 * so the local-dev worker exercises the *real* storage seam: reservations,
 * signed-target metadata, and delete-now all flow through this provider exactly
 * as a production S3/GCS/R2 client would. The difference is honest and contained:
 * the "signed" targets point at the developer transport routes
 * (`/api/uploads/local/:id`, `/api/artifacts/local/:id`) instead of a bucket, and
 * bytes live in the Node process rather than encrypted storage. It never
 * fabricates a target it cannot honor.
 */

import { DEFAULT_RETENTION } from "@/lib/jobs";
import { DevWorkerStore, devWorkerStore } from "../store";
import type { StorageObjectKind, StorageProvider } from "./types";
import { LOCAL_DEV_STORAGE_CAPABILITY, storageOk } from "./types";

const MINUTE_MS = 60_000;

/** Injectable seams so the provider is fully unit-testable with a fake clock. */
export interface LocalDevStorageDeps {
  store?: DevWorkerStore;
  now?: () => number;
}

/**
 * Build the in-process storage provider. Shares the same {@link DevWorkerStore}
 * instance as the local-dev queue so reserved slots, jobs, and artifacts all see
 * one coherent store.
 */
export function createLocalDevStorage(
  deps: LocalDevStorageDeps = {},
): StorageProvider {
  const store = deps.store ?? devWorkerStore;
  const now = deps.now ?? (() => Date.now());
  const isoAfter = (minutes: number): string =>
    new Date(now() + minutes * MINUTE_MS).toISOString();

  return {
    id: "local-dev",

    probe() {
      return storageOk(undefined);
    },

    async reserveUpload(request) {
      const slot = store.reserveSlot({
        sessionId: request.sessionId,
        filename: request.filename,
        contentType: request.contentType,
        declaredBytes: request.declaredBytes,
      });
      return storageOk({
        fileId: slot.fileId,
        filename: slot.filename,
        contentType: slot.contentType,
        target: {
          // The developer transport standing in for a pre-signed bucket URL.
          url: `/api/uploads/local/${slot.fileId}`,
          method: "PUT",
          headers: { "content-type": slot.contentType },
          // The store rejects any write whose length differs from the declared
          // size (`DevWorkerStore.putBytes` → `size_mismatch`), so this target's
          // real ceiling has always been the declared size — it just used to
          // report the catalogue-wide one. Matches the S3 provider, where the
          // same ceiling is signed into the URL.
          maxBytes: slot.declaredBytes,
        },
        expiresAt: isoAfter(DEFAULT_RETENTION.inputTtlMinutes),
      });
    },

    async reserveDownload(request) {
      const expiresAt = isoAfter(DEFAULT_RETENTION.outputTtlMinutes);
      return storageOk({
        artifactId: request.artifactId,
        target: {
          // Stands in for a signed, expiring object-storage GET URL.
          url: `/api/artifacts/local/${request.artifactId}`,
          method: "GET",
          headers: {},
          expiresAt,
        },
        expiresAt,
      });
    },

    async deleteNow(kind: StorageObjectKind, id: string) {
      // `deleted` reports whether the object was present; the delete itself is
      // idempotent, so an already-gone object is still honored (it is simply not
      // retrievable, which is the guarantee the caller relies on).
      let deleted: boolean;
      if (kind === "input") {
        deleted = store.getSlot(id) !== undefined;
        store.deleteSlot(id);
      } else {
        deleted = store.deleteArtifact(id);
      }
      return storageOk({
        kind,
        id,
        deleted,
        deletedAt: new Date(now()).toISOString(),
      });
    },

    capability() {
      return LOCAL_DEV_STORAGE_CAPABILITY;
    },
  };
}
