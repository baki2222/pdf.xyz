// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildIndex, type RetentionBounds } from "./build";
import { ingestArtifact, type IngestedArtifact } from "./ingest";
import { makeArtifact, sha256 } from "./fixtures";

const NOW = "2026-07-03T00:00:00.000Z";
const NO_BOUNDS: RetentionBounds = { maxArtifacts: null, maxAgeDays: null };

/** Ingest a fresh artifact at `generatedAt` with the given verdict. */
function art(generatedAt: string, verdict = "pass"): IngestedArtifact {
  return ingestArtifact(makeArtifact({ generatedAt, verdict }), sha256);
}

const A = () => art("2026-07-02T18:00:00.000Z", "pass"); // 6h ago
const B = () => art("2026-06-15T00:00:00.000Z", "warn"); // 18d ago
const C = () => art("2026-01-01T00:00:00.000Z", "fail"); // ~183d ago
const unreadable = () => ingestArtifact(undefined, sha256);

describe("buildIndex — ordering + entries", () => {
  it("sorts recognized artifacts newest-first and assigns positions", () => {
    const idx = buildIndex(NOW, [B(), C(), A()], NO_BOUNDS);
    expect(idx.artifacts.map((e) => e.position)).toEqual([0, 1, 2]);
    expect(idx.artifacts.map((e) => e.verdict)).toEqual(["pass", "warn", "fail"]);
    expect(idx.artifacts.map((e) => e.ageBucket)).toEqual(["1-24h", "7-30d", "90d+"]);
  });

  it("puts unreadable inputs last, regardless of input order", () => {
    const idx = buildIndex(NOW, [unreadable(), A(), unreadable(), B()], NO_BOUNDS);
    expect(idx.artifacts.map((e) => e.digestStatus)).toEqual(["verified", "verified", "unreadable", "unreadable"]);
    expect(idx.retention.indexedArtifacts).toBe(2);
    expect(idx.retention.skippedInputs).toBe(2);
    expect(idx.retention.totalInputs).toBe(4);
  });

  it("sorts recognized-but-undateable artifacts after dated ones, before unreadable", () => {
    const undated = art("not-a-date", "pass");
    const idx = buildIndex(NOW, [undated, unreadable(), A()], NO_BOUNDS);
    expect(idx.artifacts.map((e) => e.digestStatus)).toEqual(["verified", "verified", "unreadable"]);
    expect(idx.artifacts[0]!.ageBucket).toBe("1-24h"); // A (dated) first
    expect(idx.artifacts[1]!.ageBucket).toBe("unknown"); // undated recognized second
    // oldest recognized is undateable → oldest age bucket is unknown
    expect(idx.retention.oldestAgeBucket).toBe("unknown");
    expect(idx.retention.newestAgeBucket).toBe("1-24h");
  });
});

describe("buildIndex — counts", () => {
  it("tallies per-verdict and per-digest-status counts", () => {
    const idx = buildIndex(NOW, [A(), B(), C(), unreadable()], NO_BOUNDS);
    expect(idx.verdictCounts).toEqual({ pass: 1, warn: 1, fail: 1, unknown: 0 });
    expect(idx.digestCounts).toEqual({ verified: 3, mismatch: 0, malformed: 0, unreadable: 1 });
  });

  it("a recognized artifact with an unreadable verdict is absent from the verdict counts", () => {
    const noVerdict = ingestArtifact(makeArtifact({ verdict: "bogus" }), sha256);
    const idx = buildIndex(NOW, [noVerdict], NO_BOUNDS);
    expect(idx.verdictCounts).toEqual({ pass: 0, warn: 0, fail: 0, unknown: 0 });
    expect(idx.digestCounts.verified).toBe(1);
    expect(idx.retention.indexedArtifacts).toBe(1);
  });
});

describe("buildIndex — retention posture", () => {
  it("flags over-count and marks the oldest as prune candidates", () => {
    const idx = buildIndex(NOW, [A(), B(), C()], { maxArtifacts: 2, maxAgeDays: null });
    expect(idx.retention.overCount).toBe(true);
    expect(idx.retention.overRetentionCount).toBe(1); // only C (position 2)
    expect(idx.artifacts[0]!.overRetention).toBe(false);
    expect(idx.artifacts[1]!.overRetention).toBe(false);
    expect(idx.artifacts[2]!.overRetention).toBe(true);
    expect(idx.rollup.verdict).toBe("warn");
    expect(idx.rollup.drivers).toContain("retention-count");
  });

  it("flags over-age artifacts and stays not-stale when the newest is fresh", () => {
    const idx = buildIndex(NOW, [A(), B(), C()], { maxArtifacts: null, maxAgeDays: 30 });
    expect(idx.retention.overAge).toBe(true); // C (183d) is over 30
    expect(idx.retention.stale).toBe(false); // newest A (6h) is not
    expect(idx.artifacts[2]!.overRetention).toBe(true);
    expect(idx.rollup.drivers).toContain("retention-age");
  });

  it("flags the whole archive STALE when even the newest is over the age cap", () => {
    const oldA = art("2026-05-01T00:00:00.000Z", "pass"); // ~63d ago
    const idx = buildIndex(NOW, [oldA], { maxArtifacts: null, maxAgeDays: 30 });
    expect(idx.retention.stale).toBe(true);
    expect(idx.rollup.drivers).toContain("stale");
    expect(idx.rollup.verdict).toBe("warn");
  });

  it("reports the newest/oldest age span", () => {
    const idx = buildIndex(NOW, [A(), C()], NO_BOUNDS);
    expect(idx.retention.newestAgeBucket).toBe("1-24h");
    expect(idx.retention.oldestAgeBucket).toBe("90d+");
  });
});

describe("buildIndex — rollup + shape", () => {
  it("is `ok` for a clean, within-retention archive", () => {
    const idx = buildIndex(NOW, [A(), B()], { maxArtifacts: 10, maxAgeDays: 365 });
    expect(idx.rollup.verdict).toBe("ok");
    expect(idx.rollup.exitCode).toBe(0);
    expect(idx.receipt.verdict).toBe("ok");
    expect(idx.receipt.verifiedArtifacts).toBe(2);
    expect(idx.receipt.integrityFailures).toBe(0);
    expect(idx.receipt.retentionDrift).toBe(false);
  });

  it("is `unknown` (empty) for an empty archive", () => {
    const idx = buildIndex(NOW, [], NO_BOUNDS);
    expect(idx.rollup.verdict).toBe("unknown");
    expect(idx.artifacts).toEqual([]);
    expect(idx.retention.newestAgeBucket).toBe("unknown");
    expect(idx.retention.oldestAgeBucket).toBe("unknown");
  });

  it("is `invalid` when an indexed artifact fails digest verification", () => {
    const tampered = makeArtifact({ label: "v1.0.0" });
    (tampered.body as { metadata: { label: string } }).metadata.label = "v2.0.0";
    const idx = buildIndex(NOW, [ingestArtifact(tampered, sha256), A()], NO_BOUNDS);
    expect(idx.rollup.verdict).toBe("invalid");
    expect(idx.receipt.integrityFailures).toBe(1);
  });

  it("carries the stable schema, metadata, guidance, and caveats", () => {
    const idx = buildIndex(NOW, [A()], NO_BOUNDS);
    expect(idx.schema).toBe("pdfxyz.release-index/1");
    expect(idx.metadata.artifactSchema).toBe("pdfxyz.release-artifact/1");
    expect(idx.metadata.policyId).toBe("pdfxyz-worker-release-evidence-index");
    expect(idx.guidance.length).toBeGreaterThan(0);
    expect(idx.caveats.length).toBeGreaterThan(0);
  });

  it("is deterministic for identical inputs + clock", () => {
    const a = buildIndex(NOW, [A(), B(), C()], { maxArtifacts: 2, maxAgeDays: 30 });
    const b = buildIndex(NOW, [C(), A(), B()], { maxArtifacts: 2, maxAgeDays: 30 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
