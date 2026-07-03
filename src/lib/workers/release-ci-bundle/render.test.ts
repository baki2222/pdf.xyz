import { describe, expect, it } from "vitest";
import { renderReleaseCiBundle } from "./render";
import { buildBundleResult } from "./build";
import { ingestStagesFrom, makeChain } from "./fixtures";

const result = buildBundleResult("2026-07-03T00:00:00.000Z", ingestStagesFrom(makeChain()));

describe("release-ci-bundle render", () => {
  it("json is stable, parseable, and round-trips the schema", () => {
    const json = renderReleaseCiBundle(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("pdfxyz.release-ci-bundle/1");
    expect(parsed.rollup.verdict).toBe("pass");
    expect(parsed.stages).toHaveLength(4);
    expect(parsed.consistency).toHaveLength(6);
  });

  it("compact json has no newlines inside the body", () => {
    const compact = renderReleaseCiBundle(result, "json", false);
    expect(compact.trimEnd().includes("\n")).toBe(false);
  });

  it("text carries every section", () => {
    const text = renderReleaseCiBundle(result, "text");
    for (const section of ["ROLLUP:", "STAGES", "CONSISTENCY", "ARCHIVE", "NEXT ACTION", "GUIDANCE", "CAVEATS"]) {
      expect(text, section).toContain(section);
    }
    expect(text).toContain("PASS (exit 0)");
    // per-stage + per-check lines present
    expect(text).toContain("gate");
    expect(text).toContain("index-policy-agreement");
  });

  it("text renders the per-stage facts for each stage kind", () => {
    const text = renderReleaseCiBundle(result, "text");
    expect(text).toMatch(/checks: included=/); // gate facts
    expect(text).toMatch(/digest: verified/); // artifact facts
    expect(text).toMatch(/archive: ok, indexed=/); // index facts
    expect(text).toMatch(/effective=ok, index-usable=true/); // policy facts
  });
});
