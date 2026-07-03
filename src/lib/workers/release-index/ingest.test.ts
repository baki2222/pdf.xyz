// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyLabel, ingestArtifact, UNREADABLE_ARTIFACT } from "./ingest";
import { makeArtifact, sha256 } from "./fixtures";

describe("classifyLabel", () => {
  it("classifies without echoing the raw label", () => {
    expect(classifyLabel("v1.2.3")).toBe("semver");
    expect(classifyLabel("v2.0")).toBe("semver");
    expect(classifyLabel("nightly")).toBe("named");
    expect(classifyLabel("2026.07")).toBe("named"); // no leading v → not semver
    expect(classifyLabel(null)).toBe("absent");
    expect(classifyLabel(undefined)).toBe("absent");
    expect(classifyLabel("")).toBe("absent");
    expect(classifyLabel(42)).toBe("absent");
  });
});

describe("ingestArtifact — valid artifact", () => {
  it("re-verifies a correct digest and reduces to bounded facts", () => {
    const art = makeArtifact({
      verdict: "warn",
      gateVerdict: "warn",
      gateSource: "generated",
      cleanliness: "dirty",
      refClass: "topic",
      commit: "deadbeef1234",
      label: "v3.1.0",
      opsBundleSource: "supplied",
      opsBundleSeverity: "critical",
    });
    const r = ingestArtifact(art, sha256);
    expect(r.digestStatus).toBe("verified");
    expect(r.digestPrefix).toMatch(/^[0-9a-f]{12}$/);
    expect(r.verdict).toBe("warn");
    expect(r.gateVerdict).toBe("warn");
    expect(r.gateSource).toBe("generated");
    expect(r.cleanliness).toBe("dirty");
    expect(r.refClass).toBe("topic");
    expect(r.commitPresent).toBe(true);
    expect(r.labelClass).toBe("semver");
    expect(r.labelPresent).toBe(true);
    expect(r.opsBundlePresent).toBe(true);
    expect(r.opsBundleSource).toBe("supplied");
    expect(r.atMs).toBe(Date.parse("2026-06-01T00:00:00.000Z"));
  });

  it("records commitPresent=false and labelClass=absent honestly", () => {
    const r = ingestArtifact(makeArtifact({ commit: null, label: null }), sha256);
    expect(r.digestStatus).toBe("verified");
    expect(r.commitPresent).toBe(false);
    expect(r.labelClass).toBe("absent");
    expect(r.labelPresent).toBe(false);
    expect(r.opsBundlePresent).toBe(false);
  });

  it("drops an out-of-enum field to null while still verifying the digest", () => {
    // The body LEGITIMATELY carries a non-enum verdict, and the digest is computed over that body,
    // so it verifies — but the out-of-enum verdict is reduced to null, never echoed.
    const r = ingestArtifact(makeArtifact({ verdict: "not-a-verdict", refClass: "bogus" }), sha256);
    expect(r.digestStatus).toBe("verified");
    expect(r.verdict).toBeNull();
    expect(r.refClass).toBeNull();
  });
});

describe("ingestArtifact — integrity failures", () => {
  it("flags a tampered body as `mismatch`", () => {
    const art = makeArtifact({ label: "v1.0.0" });
    // Alter a body field AFTER the digest was computed → recomputed digest no longer matches.
    (art.body as { metadata: { label: string } }).metadata.label = "v9.9.9";
    const r = ingestArtifact(art, sha256);
    expect(r.digestStatus).toBe("mismatch");
    // still content-free: a computed prefix, and the label is classified not echoed
    expect(r.digestPrefix).toMatch(/^[0-9a-f]{12}$/);
    expect(r.labelClass).toBe("semver");
  });

  it("flags a malformed archived digest as `malformed`", () => {
    const art = makeArtifact();
    (art.integrity as { digest: string }).digest = "not-a-valid-sha256";
    const r = ingestArtifact(art, sha256);
    expect(r.digestStatus).toBe("malformed");
    expect(r.digestPrefix).toMatch(/^[0-9a-f]{12}$/); // the computed prefix is always well-formed
  });

  it("flags a missing integrity block as `malformed` (no claimed digest)", () => {
    const art = makeArtifact();
    delete (art as { integrity?: unknown }).integrity;
    expect(ingestArtifact(art, sha256).digestStatus).toBe("malformed");
  });
});

describe("ingestArtifact — unreadable inputs", () => {
  it("reduces a non-object / wrong-schema / bodyless input to the unreadable sentinel", () => {
    for (const bad of [undefined, null, 42, "x", [], {}, { schema: "other" }, { schema: "pdfxyz.release-artifact/1" }]) {
      const r = ingestArtifact(bad as unknown, sha256);
      expect(r).toEqual(UNREADABLE_ARTIFACT);
      expect(r.digestStatus).toBe("unreadable");
      expect(r.digestPrefix).toBeNull();
      expect(r.verdict).toBeNull();
    }
  });

  it("never throws on a hostile shape", () => {
    expect(() => ingestArtifact({ schema: "pdfxyz.release-artifact/1", body: 42 }, sha256)).not.toThrow();
    expect(() => ingestArtifact({ schema: "pdfxyz.release-artifact/1", body: { metadata: 1, gate: [] } }, sha256)).not.toThrow();
  });
});
