// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import type { ArtifactManifest } from "./types";
import type { RetrievalStorageCapability } from "./access";
import {
  decideRetrieval,
  type ArtifactRetrievalResult,
  type RetrievedArtifact,
} from "./retrieval";

const enc = (s: string) => new TextEncoder().encode(s);

const READY: RetrievalStorageCapability = { provider: "remote-configured", ready: true };
const NOT_READY: RetrievalStorageCapability = { provider: "not-configured", ready: false };

function pdfManifest(byteCount: number, over: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    outputKind: "pdf",
    contentType: "application/pdf",
    byteCount,
    retentionClass: "short",
    toolSlug: "compress-pdf",
    processor: "compress",
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    ...over,
  };
}

function live(over: Partial<RetrievedArtifact> = {}): ArtifactRetrievalResult {
  const bytes = over.bytes ?? enc("%PDF-1.7 body");
  return {
    kind: "live",
    artifact: {
      contentType: "application/pdf",
      byteLength: bytes.byteLength,
      bytes,
      manifest: pdfManifest(bytes.byteLength),
      jobCompleted: true,
      ...over,
    },
  };
}

describe("decideRetrieval — taxonomy", () => {
  it("serves a live, manifest-valid artifact with generated headers + bytes", () => {
    const bytes = enc("%PDF served");
    const { decision, bytes: out } = decideRetrieval(live({ bytes }), READY);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.kind).toBe("pdf");
      expect(decision.headers["content-disposition"]).toBe(
        'attachment; filename="compressed.pdf"',
      );
    }
    expect(out).toBe(bytes);
  });

  it("serves a manifest-less live artifact via intrinsic checks (no bytes withheld)", () => {
    const bytes = enc("%PDF legacy");
    const { decision, bytes: out } = decideRetrieval(
      live({ bytes, manifest: null }),
      READY,
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.headers["content-disposition"]).toBe(
      'attachment; filename="document.pdf"',
    );
    expect(out).toBe(bytes);
  });

  it("maps a transient read failure to storage_error (retryable), never a false not_found", () => {
    const { decision, bytes } = decideRetrieval({ kind: "unavailable" }, READY);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("storage_error");
    expect(bytes).toBeUndefined();
  });

  it("maps a missing object to not_found", () => {
    const { decision } = decideRetrieval({ kind: "absent" }, READY);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("not_found");
  });

  it("maps deleted/expired to their distinct 410 reasons", () => {
    const del = decideRetrieval({ kind: "deleted" }, READY).decision;
    const exp = decideRetrieval({ kind: "expired" }, READY).decision;
    expect(del.ok).toBe(false);
    expect(exp.ok).toBe(false);
    if (!del.ok) expect(del.reason).toBe("deleted");
    if (!exp.ok) expect(exp.reason).toBe("expired");
  });

  it("denies storage_unavailable when the backend is not ready — even for a live result", () => {
    // A not-ready backend never fetches on the real path; if it somehow returned a live
    // result, the readiness gate still fires first (no lifecycle distinction leaks).
    const { decision } = decideRetrieval(live(), NOT_READY);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("storage_unavailable");
  });

  it("denies invalid_manifest when the recorded byte-count desyncs from the bytes", () => {
    const bytes = enc("%PDF desync");
    const result = live({ bytes, manifest: pdfManifest(bytes.byteLength + 99) });
    const { decision } = decideRetrieval(result, READY);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("invalid_manifest");
  });

  it("denies not_ready when the owning job is not completed", () => {
    const { decision } = decideRetrieval(live({ jobCompleted: false }), READY);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("not_ready");
  });

  it("honors a ?job= binding only when the backend carries an owning job id", () => {
    const bytes = enc("%PDF job");
    // With a job id: a wrong assertion is refused as job_mismatch (integrity cross-check).
    const withJob = decideRetrieval(
      live({ bytes, jobId: "job_realOwner123456" }),
      READY,
      "job_someoneElse999",
    ).decision;
    expect(withJob.ok).toBe(false);
    if (!withJob.ok) expect(withJob.reason).toBe("job_mismatch");

    // Correct assertion: served.
    const matched = decideRetrieval(
      live({ bytes, jobId: "job_realOwner123456" }),
      READY,
      "job_realOwner123456",
    ).decision;
    expect(matched.ok).toBe(true);

    // Storage-backed (no owning-job record): the assertion is honestly skipped, not denied.
    const noRecord = decideRetrieval(live({ bytes }), READY, "job_anything000000").decision;
    expect(noRecord.ok).toBe(true);
  });
});
