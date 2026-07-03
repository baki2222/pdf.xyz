// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderReleaseIndex, renderReleaseIndexJson } from "./render";
import { buildIndex } from "./build";
import { ingestArtifact } from "./ingest";
import { makeArtifact, sha256 } from "./fixtures";

const NOW = "2026-07-03T00:00:00.000Z";
const idxOf = (
  opts: Parameters<typeof makeArtifact>[0][],
  bounds: { maxArtifacts: number | null; maxAgeDays: number | null } = { maxArtifacts: null, maxAgeDays: null },
) => buildIndex(NOW, opts.map((o) => ingestArtifact(makeArtifact(o), sha256)), bounds);

describe("renderReleaseIndex — json", () => {
  it("round-trips as valid JSON with the full shape", () => {
    const idx = idxOf([{ generatedAt: "2026-07-02T00:00:00.000Z", verdict: "pass" }]);
    const json = renderReleaseIndexJson(idx);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("pdfxyz.release-index/1");
    expect(parsed.rollup.verdict).toBe("ok");
    expect(parsed.artifacts).toHaveLength(1);
    expect(json.endsWith("\n")).toBe(true);
  });

  it("honors the pretty flag", () => {
    const idx = idxOf([{ verdict: "pass" }]);
    expect(renderReleaseIndexJson(idx, true)).toContain("\n  ");
    expect(renderReleaseIndexJson(idx, false)).not.toContain("\n  ");
  });
});

describe("renderReleaseIndex — text", () => {
  const text = (opts: Parameters<typeof makeArtifact>[0][], bounds?: { maxArtifacts: number | null; maxAgeDays: number | null }) =>
    renderReleaseIndex(idxOf(opts, bounds), "text");

  it("shows the rollup, retention posture, counts, and a per-artifact line", () => {
    const out = text(
      [
        { generatedAt: "2026-07-02T18:00:00.000Z", verdict: "pass", gateVerdict: "pass" },
        { generatedAt: "2026-01-01T00:00:00.000Z", verdict: "fail", gateVerdict: "fail" },
      ],
      { maxArtifacts: 1, maxAgeDays: null },
    );
    expect(out).toContain("ROLLUP: WARN");
    expect(out).toContain("RETENTION");
    expect(out).toContain("over-count=true");
    expect(out).toContain("by artifact verdict: pass=1, warn=0, fail=1, unknown=0");
    expect(out).toContain("by digest status:   verified=2");
    expect(out).toMatch(/\[0\] PASS/);
    expect(out).toMatch(/\[1\] FAIL/);
    expect(out).toContain("over-retention"); // the pruned entry flag
    expect(out).toContain("CAVEATS");
    expect(out).toContain("GUIDANCE");
  });

  it("labels an unreadable input as SKIPPED (not the empty note — it is a listed entry)", () => {
    const withSkip = renderReleaseIndex(buildIndex(NOW, [ingestArtifact(undefined, sha256)], { maxArtifacts: null, maxAgeDays: null }), "text");
    expect(withSkip).toContain("SKIPPED");
    expect(withSkip).toContain("ROLLUP: UNKNOWN");
    expect(withSkip).not.toContain("(none —");
  });

  it("shows the empty-archive note when there are zero inputs", () => {
    const empty = renderReleaseIndex(buildIndex(NOW, [], { maxArtifacts: null, maxAgeDays: null }), "text");
    expect(empty).toContain("(none — no usable release-artifact was indexed)");
    expect(empty).toContain("ROLLUP: UNKNOWN");
  });

  it("pins the artifact schema in the text render", () => {
    expect(text([{ verdict: "pass" }])).toContain("pinned artifact schema: pdfxyz.release-artifact/1");
  });
});
