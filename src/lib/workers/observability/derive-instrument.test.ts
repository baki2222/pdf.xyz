// @vitest-environment node
/**
 * Proofs for the point-in-time derivations (readiness/engine/lifecycle/runtime) and
 * the storage-instrumenting decorator: each maps an already-content-free input to
 * bounded samples, and the storage wrapper is transparent (returns the underlying
 * result, rethrows errors) while emitting one content-free op/result sample per call.
 */
import { describe, expect, it } from "vitest";
import type { JobArtifact } from "@/lib/jobs";
import type { OperationalFacet } from "../deploy/readiness";
import type { ExecutorStorage } from "../executor/types";
import type { ProcessorInputFile } from "../processor/types";
import {
  deriveEngineCapabilityMetrics,
  deriveLifecycleMetrics,
  deriveReadinessMetrics,
  deriveRuntimeMetrics,
} from "./derive";
import { instrumentExecutorStorage } from "./instrument";
import type { WorkerMetricSample } from "./metrics";

const facet = (id: OperationalFacet["id"], state: OperationalFacet["state"]): OperationalFacet => ({
  id,
  label: id,
  state,
  detail: "content-free detail",
});

describe("derivations", () => {
  it("deriveReadinessMetrics emits one gauge per facet", () => {
    const samples = deriveReadinessMetrics([facet("storage", "ready"), facet("queue", "not-configured")]);
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ metric: "worker_readiness", labels: { facet: "storage", state: "ready" } });
    expect(samples[1]!.labels).toEqual({ facet: "queue", state: "not-configured" });
  });

  it("deriveEngineCapabilityMetrics always marks lossless available", () => {
    const samples = deriveEngineCapabilityMetrics({ compressionDeep: false, ocrReady: true, scannerActive: false });
    const by = (cap: string) => samples.find((s) => s.labels.capability === cap)?.labels.available;
    expect(by("compression_lossless")).toBe("true");
    expect(by("compression_deep")).toBe("false");
    expect(by("ocr")).toBe("true");
    expect(by("scanner")).toBe("false");
  });

  it("deriveLifecycleMetrics emits the verdict counter + drift gauge", () => {
    const samples = deriveLifecycleMetrics({ verdict: "drift", driftedRules: 3 });
    expect(samples.find((s) => s.metric === "worker_lifecycle_verification_total")?.labels).toEqual({ verdict: "drift" });
    expect(samples.find((s) => s.metric === "worker_lifecycle_drift_rules")?.value).toBe(3);
  });

  it("deriveRuntimeMetrics folds facets + engine capabilities from a runtime shape", () => {
    const samples = deriveRuntimeMetrics({
      deployment: { facets: [facet("storage", "ready"), facet("ocr", "not-implemented")] },
      compression: { deep: true },
      ocr: { ready: false },
      scanner: { active: true },
    });
    const names = samples.map((s) => s.metric);
    expect(names.filter((n) => n === "worker_readiness")).toHaveLength(2);
    expect(names.filter((n) => n === "worker_engine_capability")).toHaveLength(4);
    expect(samples.find((s) => s.labels.capability === "scanner")?.labels.available).toBe("true");
  });
});

// ── A minimal in-memory ExecutorStorage whose ops can be told to succeed / miss / throw ──
function fakeStorage(overrides: Partial<ExecutorStorage> = {}): ExecutorStorage {
  const file: ProcessorInputFile = {
    fileId: "f1",
    filename: "doc",
    contentType: "application/pdf",
    bytes: new Uint8Array([1, 2, 3]),
  };
  const artifact = { artifactId: "a1" } as unknown as JobArtifact;
  return {
    readInput: async () => file,
    writeArtifact: async () => artifact,
    deleteInput: async () => {},
    deleteArtifact: async () => {},
    ...overrides,
  };
}

describe("instrumentExecutorStorage", () => {
  function sink() {
    const samples: WorkerMetricSample[] = [];
    return { samples, fn: (s: WorkerMetricSample) => samples.push(s) };
  }

  it("records read success and returns the file", async () => {
    const s = sink();
    const storage = instrumentExecutorStorage(fakeStorage(), s.fn);
    const file = await storage.readInput("f1");
    expect(file).not.toBeNull();
    expect(s.samples[0]).toMatchObject({ metric: "worker_storage_ops_total", labels: { op: "read", result: "success" } });
  });

  it("records read missing when the object is absent", async () => {
    const s = sink();
    const storage = instrumentExecutorStorage(fakeStorage({ readInput: async () => null }), s.fn);
    expect(await storage.readInput("f1")).toBeNull();
    expect(s.samples[0]!.labels).toEqual({ op: "read", result: "missing" });
  });

  it("records failure and rethrows on a read error", async () => {
    const s = sink();
    const storage = instrumentExecutorStorage(
      fakeStorage({ readInput: async () => { throw new Error("boom /tmp/secret.pdf"); } }),
      s.fn,
    );
    await expect(storage.readInput("f1")).rejects.toThrow();
    expect(s.samples[0]!.labels).toEqual({ op: "read", result: "failure" });
    // The underlying error is never turned into a label.
    expect(JSON.stringify(s.samples)).not.toContain(".pdf");
  });

  it("records write success/failure and delete success", async () => {
    const s = sink();
    const ok = instrumentExecutorStorage(fakeStorage(), s.fn);
    await ok.writeArtifact({ jobId: "j", filename: "out", contentType: "application/pdf", bytes: new Uint8Array() });
    await ok.deleteInput("f1");
    await ok.deleteArtifact("a1");
    expect(s.samples.map((x) => `${x.labels.op}/${x.labels.result}`)).toEqual([
      "write/success",
      "delete/success",
      "delete/success",
    ]);

    const s2 = sink();
    const bad = instrumentExecutorStorage(
      fakeStorage({ writeArtifact: async () => { throw new Error("nope"); } }),
      s2.fn,
    );
    await expect(bad.writeArtifact({ jobId: "j", filename: "o", contentType: "application/pdf", bytes: new Uint8Array() })).rejects.toThrow();
    expect(s2.samples[0]!.labels).toEqual({ op: "write", result: "failure" });
  });
});
