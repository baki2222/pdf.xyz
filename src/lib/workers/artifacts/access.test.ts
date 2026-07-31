// @vitest-environment node
/**
 * Unit contract for the artifact-retrieval access layer: the reason taxonomy, the
 * lifecycle/manifest decision policy, the generated safe headers, and the content-free
 * HTTP mapping. Pure and node-free — no store, no route, no clock. The route-level
 * proofs (real store, real hostile artifacts) live in the route test; this pins the
 * pure policy exhaustively.
 */
import { describe, expect, it } from "vitest";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import type { ArtifactManifest } from "./types";
import {
  ARTIFACT_ACCESS_REASONS,
  decideArtifactAccess,
  downloadFilenameFor,
  httpErrorForAccessReason,
  isValidArtifactHandle,
  retrievalOutcomeFor,
  type ArtifactAccessDenyReason,
  type RetrievableArtifact,
} from "./access";

/** A valid, content-free provenance manifest (a compressed PDF). */
function manifest(over: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    outputKind: "pdf",
    contentType: "application/pdf",
    byteCount: 4,
    retentionClass: "short",
    toolSlug: "compress-pdf",
    processor: "compress",
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    ...over,
  };
}

/** A live, downloadable descriptor with a valid manifest (the happy path). */
function descriptor(over: Partial<RetrievableArtifact> = {}): RetrievableArtifact {
  return {
    lifecycle: "live",
    jobCompleted: true,
    contentType: "application/pdf",
    byteLength: 4,
    manifest: manifest(),
    ...over,
  };
}

describe("isValidArtifactHandle", () => {
  it("accepts the opaque handle shape only", () => {
    expect(isValidArtifactHandle("art_" + "a".repeat(12))).toBe(true);
    expect(isValidArtifactHandle("art_Ab_9-Zz01234")).toBe(true);
  });
  it("rejects malformed / non-string / boundary handles", () => {
    expect(isValidArtifactHandle("nope")).toBe(false);
    expect(isValidArtifactHandle("art_short")).toBe(false); // < 10 body chars
    expect(isValidArtifactHandle("art_" + "a".repeat(65))).toBe(false); // > 64
    expect(isValidArtifactHandle("art_bad/../etc")).toBe(false);
    expect(isValidArtifactHandle(42 as unknown)).toBe(false);
    expect(isValidArtifactHandle(undefined)).toBe(false);
  });
});

describe("decideArtifactAccess — lifecycle & readiness", () => {
  it("denies not_found for an absent handle", () => {
    const d = decideArtifactAccess(descriptor({ lifecycle: "absent" }));
    expect(d).toMatchObject({ ok: false, reason: "not_found" });
  });
  it("denies deleted for an explicitly-deleted (tombstoned) handle", () => {
    const d = decideArtifactAccess(descriptor({ lifecycle: "deleted" }));
    expect(d).toMatchObject({ ok: false, reason: "deleted" });
  });
  it("denies expired when the retention window has passed", () => {
    const d = decideArtifactAccess(descriptor({ lifecycle: "expired" }));
    expect(d).toMatchObject({ ok: false, reason: "expired" });
  });
  it("denies not_ready when the owning job is not completed", () => {
    const d = decideArtifactAccess(descriptor({ jobCompleted: false }));
    expect(d).toMatchObject({ ok: false, reason: "not_ready" });
  });
});

describe("decideArtifactAccess — storage / job binding (no auth model)", () => {
  it("denies storage_unavailable when the backend cannot serve here", () => {
    const d = decideArtifactAccess(
      descriptor({ storage: { provider: "not-configured", ready: false } }),
    );
    expect(d).toMatchObject({ ok: false, reason: "storage_unavailable" });
  });
  it("serves when the storage capability is present and ready", () => {
    const d = decideArtifactAccess(
      descriptor({ storage: { provider: "local-dev", ready: true } }),
    );
    expect(d.ok).toBe(true);
  });
  it("fails closed to policy_unavailable for a missing policy", () => {
    const d = decideArtifactAccess(
      descriptor(),
      null as unknown as Parameters<typeof decideArtifactAccess>[1],
    );
    expect(d).toMatchObject({ ok: false, reason: "policy_unavailable" });
  });
  it("denies job_mismatch when the asserted ?job binding does not own the artifact", () => {
    const d = decideArtifactAccess(
      descriptor({ jobBinding: { asserted: true, matches: false } }),
    );
    expect(d).toMatchObject({ ok: false, reason: "job_mismatch" });
  });
  it("serves when the asserted job binding matches, or when none is asserted (handle alone suffices)", () => {
    expect(
      decideArtifactAccess(
        descriptor({ jobBinding: { asserted: true, matches: true } }),
      ).ok,
    ).toBe(true);
    expect(
      decideArtifactAccess(
        descriptor({ jobBinding: { asserted: false, matches: false } }),
      ).ok,
    ).toBe(true);
  });
  it("checks storage before lifecycle before job binding", () => {
    // All three fail at once: precedence picks storage_unavailable.
    const d = decideArtifactAccess(
      descriptor({
        storage: { provider: "not-configured", ready: false },
        lifecycle: "absent",
        jobBinding: { asserted: true, matches: false },
      }),
    );
    expect(d).toMatchObject({ ok: false, reason: "storage_unavailable" });
  });
});

describe("decideArtifactAccess — manifest presence policy", () => {
  it("serves a manifest-less output via intrinsic checks by default", () => {
    const d = decideArtifactAccess(descriptor({ manifest: null }));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.kind).toBe("pdf");
  });
  it("fails closed (missing_manifest) under the strict posture", () => {
    const d = decideArtifactAccess(descriptor({ manifest: null }), {
      requireManifest: true,
    });
    expect(d).toMatchObject({ ok: false, reason: "missing_manifest" });
  });
  it("intrinsic path denies an unrecognized content-type", () => {
    const d = decideArtifactAccess(
      descriptor({ manifest: null, contentType: "application/x-weird" }),
    );
    expect(d).toMatchObject({ ok: false, reason: "unsupported_kind" });
  });
  it("intrinsic path denies zero bytes", () => {
    const d = decideArtifactAccess(
      descriptor({ manifest: null, byteLength: 0 }),
    );
    expect(d).toMatchObject({ ok: false, reason: "empty_artifact" });
  });
});

describe("decideArtifactAccess — manifest re-validation (defense in depth)", () => {
  const cases: {
    name: string;
    over: Partial<RetrievableArtifact>;
    reason: ArtifactAccessDenyReason;
  }[] = [
    {
      name: "a foreign policy id",
      over: { manifest: manifest({ policyId: "someone-elses-policy" }) },
      reason: "invalid_manifest",
    },
    {
      name: "a content-type that maps to no recognized kind",
      over: {
        contentType: "application/x-weird",
        manifest: manifest({ contentType: "application/x-weird" }),
      },
      reason: "unsupported_kind",
    },
    {
      name: "a recorded kind that disagrees with its own content-type",
      over: { manifest: manifest({ outputKind: "image" }) },
      reason: "invalid_manifest",
    },
    {
      name: "a stored content-type that desyncs from the manifest",
      over: { contentType: "text/plain", manifest: manifest() },
      reason: "invalid_manifest",
    },
    {
      name: "an unresolved retention class",
      over: { manifest: manifest({ retentionClass: "unknown" }) },
      reason: "invalid_manifest",
    },
    {
      name: "a recorded zero byte count",
      over: { byteLength: 0, manifest: manifest({ byteCount: 0 }) },
      reason: "empty_artifact",
    },
    {
      name: "a byte count that disagrees with the actual bytes",
      over: { byteLength: 8, manifest: manifest({ byteCount: 4 }) },
      reason: "invalid_manifest",
    },
  ];
  for (const c of cases) {
    it(`denies ${c.reason} for ${c.name}`, () => {
      const d = decideArtifactAccess(descriptor(c.over));
      expect(d).toMatchObject({ ok: false, reason: c.reason });
    });
  }
});

describe("decideArtifactAccess — served headers", () => {
  it("streams a compressed PDF with safe, generated headers", () => {
    const d = decideArtifactAccess(descriptor());
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.kind).toBe("pdf");
    expect(d.filename).toBe("compressed.pdf");
    expect(d.headers).toEqual({
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="compressed.pdf"',
      "content-length": "4",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
  });

  it("restores a utf-8 charset for the text sidecar", () => {
    const d = decideArtifactAccess(
      descriptor({
        contentType: "text/plain",
        byteLength: 10,
        manifest: manifest({
          outputKind: "text-sidecar",
          contentType: "text/plain",
          byteCount: 10,
          processor: "ocr",
        }),
      }),
    );
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(d.filename).toBe("extracted-text.txt");
  });

  it("names each kind/processor from a closed vocabulary", () => {
    expect(downloadFilenameFor("pdf", "application/pdf", "compress")).toBe("compressed.pdf");
    expect(downloadFilenameFor("pdf", "application/pdf", "ocr")).toBe("searchable.pdf");
    expect(downloadFilenameFor("pdf", "application/pdf", "other")).toBe("document.pdf");
    expect(downloadFilenameFor("archive", "application/zip", "other")).toBe("documents.zip");
    expect(downloadFilenameFor("image", "image/png", "other")).toBe("image.png");
    expect(downloadFilenameFor("image", "image/jpeg", "other")).toBe("image.jpg");
  });

  it("gives an Office export its real extension, not the .bin fallback", () => {
    // Without the content-type→extension entries, every Office export downloaded
    // as `download.bin` and no application would open it.
    const office = (type: string) =>
      downloadFilenameFor("office-document", type, "other");
    expect(
      office("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("document.docx");
    expect(
      office("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe("document.xlsx");
    expect(
      office(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("document.pptx");
  });
});

describe("httpErrorForAccessReason", () => {
  it("maps every denial reason to a content-free code", () => {
    expect(httpErrorForAccessReason("malformed_handle").code).toBe("invalid_request");
    expect(httpErrorForAccessReason("storage_unavailable").code).toBe("worker_not_configured");
    expect(httpErrorForAccessReason("policy_unavailable").code).toBe("worker_not_configured");
    expect(httpErrorForAccessReason("not_found").code).toBe("not_found");
    expect(httpErrorForAccessReason("deleted").code).toBe("gone");
    expect(httpErrorForAccessReason("expired").code).toBe("gone");
    expect(httpErrorForAccessReason("job_mismatch").code).toBe("forbidden");
    expect(httpErrorForAccessReason("not_ready").code).toBe("conflict");
    expect(httpErrorForAccessReason("missing_manifest").code).toBe("not_found");
    expect(httpErrorForAccessReason("invalid_manifest").code).toBe("unprocessable_entity");
    expect(httpErrorForAccessReason("unsupported_kind").code).toBe("unsupported_media_type");
    expect(httpErrorForAccessReason("empty_artifact").code).toBe("unprocessable_entity");
  });

  it("maps every denial reason to a content-free message, never a store internal", () => {
    for (const reason of ARTIFACT_ACCESS_REASONS) {
      if (reason === "ok") continue;
      const { message } = httpErrorForAccessReason(reason as ArtifactAccessDenyReason);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/art_|\.pdf|s3|bucket|key|token|\//i);
    }
  });
});

describe("retrievalOutcomeFor", () => {
  it("folds ok to served and every denial to denied", () => {
    expect(retrievalOutcomeFor("ok")).toBe("served");
    for (const reason of ARTIFACT_ACCESS_REASONS) {
      if (reason === "ok") continue;
      expect(retrievalOutcomeFor(reason)).toBe("denied");
    }
  });
});

describe("access decisions are content-free", () => {
  const FORBIDDEN = [
    "Confidential.pdf",
    "/etc/passwd",
    "X-Amz-Signature=deadbeef",
    "AWS_SECRET_ACCESS_KEY",
    "https://bucket.s3.amazonaws.com/x",
  ];
  it("never echoes a hostile stored content-type parameter into a served header", () => {
    // A raw stored content-type stuffed with a signature parameter: the served header
    // uses the manifest's canonical bare type, never the raw value.
    const d = decideArtifactAccess(
      descriptor({ contentType: "application/pdf; sig=X-Amz-Signature=deadbeef" }),
    );
    // Raw value desyncs from the manifest's bare type ⇒ denied invalid_manifest, and no
    // part of the decision echoes the hostile parameter.
    const text = JSON.stringify(d);
    for (const secret of FORBIDDEN) expect(text).not.toContain(secret);
  });
  it("a served decision carries only bounded, generated values", () => {
    const d = decideArtifactAccess(descriptor());
    const text = JSON.stringify(d);
    for (const secret of FORBIDDEN) expect(text).not.toContain(secret);
    // No stored/user filename field anywhere — only the generated one.
    if (d.ok) expect(d.filename).toBe("compressed.pdf");
  });
});
