/**
 * The **local-dev artifact-retrieval backend**: an {@link ArtifactRetrievalBackend} over
 * the developer-only in-process {@link DevWorkerStore}.
 *
 * This is the Phase 39 refactor of the Phase 38 local download route's inline store
 * lookup into the shared backend seam, so the local path and the storage-backed path both
 * flow through {@link decideRetrieval} → `decideArtifactAccess` and are byte-identical in
 * their access checks, headers, and denial taxonomy. Behavior is UNCHANGED from Phase 38:
 * the capability is `local-dev`/ready only when the developer worker is explicitly on, and
 * a live entry carries its stored manifest plus the owning job's completion and opaque id
 * (so the caller's `?job=` integrity cross-check still works).
 *
 * Node-only (it touches the in-process store, which mints ids via `node:crypto`), so it is
 * imported by the local route handler, never a client bundle. It carries no signer — the
 * storage-backed reader lives in `./retrieval-storage`.
 */

import { resolveWorkerMode, type WorkerMode } from "../mode";
import { DevWorkerStore, devWorkerStore } from "../store";
import type {
  RetrievalStorageCapability,
  RetrievalStorageProvider,
} from "./access";
import type {
  ArtifactRetrievalBackend,
  ArtifactRetrievalResult,
} from "./retrieval";

/** Injectable seams so the backend is fully unit-testable with a fake store/mode. */
export interface LocalDevRetrievalDeps {
  store?: DevWorkerStore;
  /** The resolved worker mode; defaults to reading it from the environment. */
  mode?: WorkerMode;
}

/**
 * Map the resolved {@link WorkerMode} to the key-free storage capability this in-process
 * route can serve a download from — the same three-way distinction Phase 38 reported,
 * carried WITHOUT any bucket/region/key/URL. Ready ONLY for the explicit developer worker.
 */
function localCapabilityFor(mode: WorkerMode): RetrievalStorageCapability {
  const provider: RetrievalStorageProvider =
    mode === "local-dev"
      ? "local-dev"
      : mode === "remote-configured"
        ? "remote-configured"
        : "not-configured";
  return { provider, ready: mode === "local-dev" };
}

/**
 * Build the local-dev retrieval backend. `capability()` is derived from the worker mode
 * (ready only in `local-dev`); `fetch` projects the store's lifecycle verdict into a
 * bounded {@link ArtifactRetrievalResult}, carrying — for a live entry — the stored bytes,
 * the content-free manifest, the owning job's completion state, and its opaque id.
 */
export function createLocalDevArtifactBackend(
  deps: LocalDevRetrievalDeps = {},
): ArtifactRetrievalBackend {
  const store = deps.store ?? devWorkerStore;
  const mode = deps.mode ?? resolveWorkerMode();
  const capability = localCapabilityFor(mode);

  return {
    capability() {
      return capability;
    },
    async fetch(artifactId: string): Promise<ArtifactRetrievalResult> {
      const retrieval = store.retrieveArtifact(artifactId);
      if (retrieval.lifecycle !== "live") {
        // "absent" | "deleted" | "expired" map straight through to the access lifecycle.
        return { kind: retrieval.lifecycle };
      }
      const artifact = retrieval.artifact;
      // An artifact is only ever stored for a completed job, so a dropped/expired job
      // record does not make a live artifact un-downloadable (defense-in-depth).
      const job = store.getJob(artifact.jobId);
      return {
        kind: "live",
        artifact: {
          contentType: artifact.contentType,
          byteLength: artifact.bytes.byteLength,
          bytes: artifact.bytes,
          manifest: artifact.manifest ?? null,
          jobCompleted: job === undefined || job.status === "completed",
          jobId: artifact.jobId,
        },
      };
    },
  };
}
