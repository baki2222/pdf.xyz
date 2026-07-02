/**
 * A metrics-instrumenting decorator for {@link ExecutorStorage}.
 *
 * Rather than thread storage-op counters through the executor's orchestration
 * logic, this wraps the storage seam the executor already calls and emits a
 * content-free `worker_storage_ops_total{op,result}` sample per read/write/delete —
 * so storage health is observed at the exact boundary that touches the bucket,
 * with zero change to executor internals. The wrapper is transparent: it returns
 * the underlying result unchanged and RE-THROWS any error after recording it, so
 * the executor's own not_found/retry handling is preserved exactly.
 *
 * Content-free by construction: it records only the bounded op kind and a coarse
 * result category (`success` / `missing` / `failure`) — never a fileId, object key,
 * artifact id, byte count, or the underlying error. Pure and node-free (it delegates
 * all I/O to the wrapped storage), so it is unit-testable with an in-memory fake.
 */

import type { ExecutorStorage, WriteArtifactInput } from "../executor/types";
import type { JobArtifact } from "@/lib/jobs";
import type { ProcessorInputFile } from "../processor/types";
import { storageMetric } from "./metrics";
import type { WorkerMetricSink } from "./collector";

/**
 * Wrap `storage` so every operation emits a content-free storage metric to `sink`.
 * A `readInput` that resolves `null` records `missing` (an expired/absent object);
 * a resolved value records `success`; a thrown op records `failure` and rethrows.
 */
export function instrumentExecutorStorage(
  storage: ExecutorStorage,
  sink: WorkerMetricSink,
): ExecutorStorage {
  return {
    async readInput(fileId: string): Promise<ProcessorInputFile | null> {
      try {
        const file = await storage.readInput(fileId);
        sink(storageMetric("read", file === null ? "missing" : "success"));
        return file;
      } catch (error) {
        sink(storageMetric("read", "failure"));
        throw error;
      }
    },
    async writeArtifact(input: WriteArtifactInput): Promise<JobArtifact> {
      try {
        const artifact = await storage.writeArtifact(input);
        sink(storageMetric("write", "success"));
        return artifact;
      } catch (error) {
        sink(storageMetric("write", "failure"));
        throw error;
      }
    },
    async deleteInput(fileId: string): Promise<void> {
      try {
        await storage.deleteInput(fileId);
        sink(storageMetric("delete", "success"));
      } catch (error) {
        sink(storageMetric("delete", "failure"));
        throw error;
      }
    },
    async deleteArtifact(artifactId: string): Promise<void> {
      try {
        await storage.deleteArtifact(artifactId);
        sink(storageMetric("delete", "success"));
      } catch (error) {
        sink(storageMetric("delete", "failure"));
        throw error;
      }
    },
  };
}
