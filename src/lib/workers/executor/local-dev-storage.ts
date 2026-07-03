/**
 * The developer-only {@link ExecutorStorage} backed by {@link DevWorkerStore}: the
 * worker-side byte I/O the executor uses in `local-dev` mode.
 *
 * It reads input bytes straight from the in-process store and writes artifacts
 * back to it, minting the same developer-transport download URL
 * (`/api/artifacts/local/:id`) the local-dev storage provider uses. In production
 * this is replaced by a client that streams to/from the encrypted bucket — the
 * executor is unchanged, because it only ever sees the {@link ExecutorStorage}
 * seam. This module touches the Node-only store, so it is imported directly by
 * Node-runtime code, never from the eager worker barrel.
 */

import { DEFAULT_RETENTION } from "@/lib/jobs";
import { DevWorkerStore, devWorkerStore, newArtifactId } from "../store";
import type { ExecutorStorage } from "./types";

const MINUTE_MS = 60_000;

/** Injectable seams so the storage is fully unit-testable with a fake clock. */
export interface LocalDevExecutorStorageDeps {
  store?: DevWorkerStore;
  now?: () => number;
}

export function createLocalDevExecutorStorage(
  deps: LocalDevExecutorStorageDeps = {},
): ExecutorStorage {
  const store = deps.store ?? devWorkerStore;
  const now = deps.now ?? (() => Date.now());

  return {
    async readInput(fileId) {
      const slot = store.getSlot(fileId);
      if (!slot || !slot.bytes) return null;
      return {
        fileId,
        filename: slot.filename,
        contentType: slot.contentType,
        bytes: slot.bytes,
        // Carry the reservation's declared byte count so the file-soundness gate can
        // prove the fetched bytes still match it. In local-dev the store enforces the
        // match on write, so this is a defense-in-depth re-verification at read.
        declaredBytes: slot.declaredBytes,
      };
    },

    async writeArtifact(input) {
      const artifactId = newArtifactId();
      store.putArtifact({
        artifactId,
        jobId: input.jobId,
        filename: input.filename,
        contentType: input.contentType,
        bytes: input.bytes,
        // Record the content-free provenance manifest (when the gate produced one) so
        // the retrieval boundary can re-validate it. A production bucket ignores it.
        ...(input.manifest ? { manifest: input.manifest } : {}),
      });
      const expiresAt = new Date(
        now() + DEFAULT_RETENTION.outputTtlMinutes * MINUTE_MS,
      ).toISOString();
      return {
        artifactId,
        filename: input.filename,
        contentType: input.contentType,
        bytes: input.bytes.byteLength,
        // Stands in for a signed, expiring object-storage GET URL.
        url: `/api/artifacts/local/${artifactId}`,
        expiresAt,
      };
    },

    async deleteInput(fileId) {
      store.deleteSlot(fileId);
    },

    async deleteArtifact(artifactId) {
      store.deleteArtifact(artifactId);
    },
  };
}
