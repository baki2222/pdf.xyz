import { describe, expect, it } from "vitest";
import { ingestBuiltIndex, ingestIndex } from "./ingest";
import { makeIndex, NOW } from "./fixtures";
import { buildIndex } from "../release-index/build";
import { ingestArtifact } from "../release-index/ingest";
import { makeArtifact, sha256 } from "./fixtures";

/** A plain-object deep clone via JSON (fixtures are plain data), as a mutable record. */
function clone(v: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
}

describe("ingestIndex — recognition", () => {
  it("a non-object / wrong-schema input is unrecognized (⇒ unknown)", () => {
    for (const bad of [null, 42, "x", [], {}, { schema: "pdfxyz.release-index/2" }]) {
      const r = ingestIndex(bad);
      expect(r.recognized).toBe(false);
      expect(r.usable).toBe(false);
      expect(r.facts).toBeNull();
    }
  });

  it("a valid, consistent release-index is recognized + usable with reduced facts", () => {
    const idx = makeIndex([
      { generatedAt: "2026-07-01T00:00:00.000Z", verdict: "pass" },
      { generatedAt: "2026-06-01T00:00:00.000Z", verdict: "warn" },
    ]);
    const r = ingestIndex(clone(idx));
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(true);
    expect(r.reportedVerdict).toBe("ok");
    expect(r.effectiveVerdict).toBe("ok");
    expect(r.facts).not.toBeNull();
    expect(r.facts!.indexedArtifacts).toBe(2);
    expect(r.facts!.verdictCounts).toEqual({ pass: 1, warn: 1, fail: 0, unknown: 0 });
    expect(r.facts!.latestVerdict).toBe("pass");
  });
});

describe("ingestIndex — fail-closed consistency", () => {
  it("rejects a manifest whose digest counts do not sum to totalInputs", () => {
    const idx = clone(makeIndex([{ generatedAt: NOW, verdict: "pass" }])) as Record<string, unknown>;
    (idx.digestCounts as Record<string, number>).verified = 5; // was 1
    const r = ingestIndex(idx);
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
  });

  it("rejects a manifest whose indexedArtifacts disagrees with the recognized digest count", () => {
    const idx = clone(makeIndex([{ generatedAt: NOW, verdict: "pass" }])) as Record<string, unknown>;
    (idx.retention as Record<string, number>).indexedArtifacts = 9;
    expect(ingestIndex(idx).usable).toBe(false);
  });

  it("rejects a manifest whose self-reported rollup contradicts its own counts (a smuggle)", () => {
    // Build a REAL invalid index (a tampered artifact ⇒ mismatch ⇒ invalid), then relabel it `ok`.
    const invalid = buildIndex(
      NOW,
      [ingestArtifact({ ...makeArtifact({ verdict: "pass" }), integrity: { algorithm: "sha256", encoding: "hex", canonicalization: "pdfxyz-sorted-keys/1", digest: sha256("wrong") } }, sha256)],
      { maxArtifacts: null, maxAgeDays: null },
    );
    expect(invalid.rollup.verdict).toBe("invalid");
    const smuggled = clone(invalid) as Record<string, unknown>;
    (smuggled.rollup as Record<string, unknown>).verdict = "ok";
    const r = ingestIndex(smuggled);
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.reportedVerdict).toBe("ok"); // its (lying) self-report is surfaced, not trusted
    expect(r.effectiveVerdict).toBeNull();
  });

  it("a consistent invalid index (honestly reports a tampered artifact) IS usable, effective=invalid", () => {
    const invalid = buildIndex(
      NOW,
      [ingestArtifact({ ...makeArtifact({ verdict: "pass" }), integrity: { algorithm: "sha256", encoding: "hex", canonicalization: "pdfxyz-sorted-keys/1", digest: sha256("wrong") } }, sha256)],
      { maxArtifacts: null, maxAgeDays: null },
    );
    const r = ingestIndex(clone(invalid));
    expect(r.usable).toBe(true);
    expect(r.effectiveVerdict).toBe("invalid");
    expect(r.facts!.integrityFailures).toBe(1);
  });

  it("rejects a manifest whose verdict counts exceed the indexed artifacts", () => {
    const idx = clone(makeIndex([{ generatedAt: NOW, verdict: "pass" }])) as Record<string, unknown>;
    (idx.verdictCounts as Record<string, number>).warn = 9;
    expect(ingestIndex(idx).usable).toBe(false);
  });

  it("rejects a manifest with a malformed (non-integer / negative) count", () => {
    for (const bad of [-1, 1.5, "3", null]) {
      const idx = clone(makeIndex([{ generatedAt: NOW, verdict: "pass" }])) as Record<string, unknown>;
      (idx.digestCounts as Record<string, unknown>).verified = bad;
      expect(ingestIndex(idx).usable, String(bad)).toBe(false);
    }
  });

  it("rejects a manifest with a bad age bucket enum", () => {
    const idx = clone(makeIndex([{ generatedAt: NOW, verdict: "pass" }])) as Record<string, unknown>;
    (idx.retention as Record<string, unknown>).newestAgeBucket = "eventually";
    expect(ingestIndex(idx).usable).toBe(false);
  });
});

describe("ingestIndex — empty archive", () => {
  it("an empty (0-artifact) index is usable with archiveVerdict unknown", () => {
    const empty = makeIndex([]);
    expect(empty.rollup.verdict).toBe("unknown");
    const r = ingestIndex(clone(empty));
    expect(r.usable).toBe(true);
    expect(r.facts!.indexedArtifacts).toBe(0);
    expect(r.facts!.archiveVerdict).toBe("unknown");
    expect(r.facts!.latestVerdict).toBeNull();
  });
});

describe("ingestBuiltIndex — trusted in-process build", () => {
  it("projects a built index onto the same facts, always usable", () => {
    const idx = makeIndex([{ generatedAt: NOW, verdict: "fail" }]);
    const r = ingestBuiltIndex(idx);
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(true);
    expect(r.facts!.verdictCounts.fail).toBe(1);
    expect(r.facts!.latestVerdict).toBe("fail");
  });
});
