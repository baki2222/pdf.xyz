import { describe, expect, it } from "vitest";
import { renderReleasePolicy } from "./render";
import { buildPolicyResult } from "./build";
import { ingestBuiltIndex, UNRECOGNIZED_INDEX } from "./ingest";
import { emptyPolicy, makeIndex, NOW } from "./fixtures";
import type { ReleasePolicyInputs } from "./types";

function policy(over: Partial<ReleasePolicyInputs> = {}): ReleasePolicyInputs {
  return { ...emptyPolicy(), ...over };
}

const cleanResult = () =>
  buildPolicyResult(
    NOW,
    "index",
    ingestBuiltIndex(makeIndex([{ generatedAt: NOW, verdict: "pass" }])),
    policy({ requireClean: true, minArtifacts: 1 }),
  );

describe("renderReleasePolicy — json", () => {
  it("is pretty by default and round-trips to the result", () => {
    const result = cleanResult();
    const out = renderReleasePolicy(result, "json");
    expect(out.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.schema).toBe("pdfxyz.release-policy/1");
    expect(parsed.rollup.verdict).toBe("pass");
    expect(parsed.assertions).toEqual(["require-clean", "min-artifacts"]);
  });

  it("honors pretty=false (single line)", () => {
    const out = renderReleasePolicy(cleanResult(), "json", false);
    expect(out.trim().split("\n")).toHaveLength(1);
  });
});

describe("renderReleasePolicy — text", () => {
  it("renders the rollup, evidence, policy, and caveats", () => {
    const out = renderReleasePolicy(cleanResult(), "text");
    expect(out).toMatch(/ROLLUP: PASS \(exit 0\)/);
    expect(out).toContain("EVIDENCE (source: index)");
    expect(out).toContain("POLICY (assertions evaluated)");
    expect(out).toContain("require-clean");
    expect(out).toContain("CAVEATS");
    expect(out).toMatch(/VIOLATIONS \(0\)/);
  });

  it("lists violations with severity + remediation", () => {
    const result = buildPolicyResult(
      NOW,
      "index",
      ingestBuiltIndex(makeIndex([{ generatedAt: NOW, verdict: "fail" }])),
      policy({ maxFail: 0 }),
    );
    const out = renderReleasePolicy(result, "text");
    expect(out).toMatch(/ROLLUP: FAIL \(exit 4\)/);
    expect(out).toMatch(/\[BLOCK\] too-many-fail/);
    expect(out).toMatch(/observed 1, limit 0/);
  });

  it("explains an unusable index instead of printing facts", () => {
    const result = buildPolicyResult(NOW, "index", UNRECOGNIZED_INDEX, emptyPolicy());
    const out = renderReleasePolicy(result, "text");
    expect(out).toMatch(/ROLLUP: UNKNOWN \(exit 2\)/);
    expect(out).toContain("no usable release-index facts");
  });

  it("notes when no assertions were configured", () => {
    const result = buildPolicyResult(NOW, "index", ingestBuiltIndex(makeIndex([{ generatedAt: NOW, verdict: "pass" }])), emptyPolicy());
    expect(renderReleasePolicy(result, "text")).toContain("none configured");
  });
});
