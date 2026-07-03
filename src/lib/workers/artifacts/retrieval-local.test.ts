// @vitest-environment node
/**
 * The local-dev artifact-retrieval backend: its mode-derived storage capability and its
 * projection of the in-process store's lifecycle verdict into a bounded
 * {@link ArtifactRetrievalResult}. An injected store + clock keep it deterministic and
 * node-free of the real environment; a fake mode exercises the three-way capability.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import { DevWorkerStore, newArtifactId, newJobId } from "../store";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import type { ArtifactManifest } from "./types";
import { createLocalDevArtifactBackend } from "./retrieval-local";

const enc = (s: string) => new TextEncoder().encode(s);
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

function store(): DevWorkerStore {
  return new DevWorkerStore(() => NOW);
}

function pdfManifest(byteCount: number): ArtifactManifest {
  return {
    outputKind: "pdf",
    contentType: "application/pdf",
    byteCount,
    retentionClass: "short",
    toolSlug: "compress-pdf",
    processor: "compress",
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
  };
}

/** Seed a live artifact for a job whose record is set to `status`. */
function seed(
  s: DevWorkerStore,
  bytes: Uint8Array,
  opts: { manifest?: ArtifactManifest | null; jobStatus?: Job["status"] } = {},
): { artifactId: string; jobId: string } {
  const jobId = newJobId();
  const artifactId = newArtifactId();
  s.putArtifact({
    artifactId,
    jobId,
    filename: "report.pdf",
    contentType: "application/pdf",
    bytes,
    ...(opts.manifest === null ? {} : { manifest: opts.manifest ?? pdfManifest(bytes.byteLength) }),
  });
  if (opts.jobStatus) {
    s.putJob({
      jobId,
      tool: "compress-pdf",
      capability: "secure-worker",
      status: opts.jobStatus,
      progress: opts.jobStatus === "completed" ? 100 : 50,
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 60_000).toISOString(),
      retention: DEFAULT_RETENTION,
    });
  }
  return { artifactId, jobId };
}

describe("createLocalDevArtifactBackend — capability by mode", () => {
  it("is ready as the local-dev provider ONLY for the explicit developer worker", () => {
    expect(createLocalDevArtifactBackend({ mode: "local-dev" }).capability()).toEqual({
      provider: "local-dev",
      ready: true,
    });
  });

  it("reports the remote/none provider (never ready) for a non-dev mode, no fingerprinting", () => {
    expect(createLocalDevArtifactBackend({ mode: "remote-configured" }).capability()).toEqual({
      provider: "remote-configured",
      ready: false,
    });
    expect(createLocalDevArtifactBackend({ mode: "disabled" }).capability()).toEqual({
      provider: "not-configured",
      ready: false,
    });
  });
});

describe("createLocalDevArtifactBackend — fetch projects the store lifecycle", () => {
  it("maps a live entry to a bounded result carrying bytes, manifest, and the owning job id", async () => {
    const s = store();
    const bytes = enc("%PDF-1.7 body");
    const { artifactId, jobId } = seed(s, bytes, { jobStatus: "completed" });
    const backend = createLocalDevArtifactBackend({ store: s, mode: "local-dev" });

    const result = await backend.fetch(artifactId);
    expect(result.kind).toBe("live");
    if (result.kind === "live") {
      const a = result.artifact;
      expect(a.contentType).toBe("application/pdf");
      expect(a.byteLength).toBe(bytes.byteLength);
      expect(a.bytes).toBe(bytes);
      expect(a.manifest).toEqual(pdfManifest(bytes.byteLength));
      expect(a.jobCompleted).toBe(true);
      // The opaque owning-job id rides along so the `?job=` integrity cross-check can run.
      expect(a.jobId).toBe(jobId);
    }
  });

  it("carries a null manifest for a manifest-less entry (gate-disabled honesty)", async () => {
    const s = store();
    const bytes = enc("%PDF legacy");
    const { artifactId } = seed(s, bytes, { manifest: null, jobStatus: "completed" });
    const result = await createLocalDevArtifactBackend({ store: s, mode: "local-dev" }).fetch(
      artifactId,
    );
    if (result.kind === "live") expect(result.artifact.manifest).toBeNull();
    else throw new Error("expected live");
  });

  it("reports jobCompleted=false when the owning job record is not completed", async () => {
    const s = store();
    const { artifactId } = seed(s, enc("%PDF pending"), { jobStatus: "processing" });
    const result = await createLocalDevArtifactBackend({ store: s, mode: "local-dev" }).fetch(
      artifactId,
    );
    if (result.kind === "live") expect(result.artifact.jobCompleted).toBe(false);
    else throw new Error("expected live");
  });

  it("treats a live artifact whose job record is gone as still completed (defense-in-depth)", async () => {
    const s = store();
    const { artifactId } = seed(s, enc("%PDF no-job")); // no job record put
    const result = await createLocalDevArtifactBackend({ store: s, mode: "local-dev" }).fetch(
      artifactId,
    );
    if (result.kind === "live") expect(result.artifact.jobCompleted).toBe(true);
    else throw new Error("expected live");
  });

  it("passes an unknown handle through as absent (404 semantics upstream)", async () => {
    const backend = createLocalDevArtifactBackend({ store: store(), mode: "local-dev" });
    expect((await backend.fetch(newArtifactId())).kind).toBe("absent");
  });

  it("reports a tombstoned handle as deleted, distinct from an unknown absent", async () => {
    const s = store();
    const { artifactId } = seed(s, enc("%PDF bye"), { jobStatus: "completed" });
    expect(s.deleteArtifact(artifactId)).toBe(true);
    expect((await createLocalDevArtifactBackend({ store: s, mode: "local-dev" }).fetch(artifactId)).kind).toBe(
      "deleted",
    );
  });

  it("reports an entry whose retention window has passed as expired", async () => {
    const s = store();
    const { artifactId } = seed(s, enc("%PDF gone"), { jobStatus: "completed" });
    // Force the retention window closed relative to the fixed clock.
    const stored = s.retrieveArtifact(artifactId);
    if (stored.lifecycle === "live") stored.artifact.expiresAt = NOW - 1;
    expect((await createLocalDevArtifactBackend({ store: s, mode: "local-dev" }).fetch(artifactId)).kind).toBe(
      "expired",
    );
  });
});
