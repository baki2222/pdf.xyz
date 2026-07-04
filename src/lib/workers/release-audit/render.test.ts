import { describe, expect, it } from "vitest";
import { buildAuditResult } from "./build";
import { renderReleaseAudit } from "./render";
import { NOW, policy, usable } from "./fixtures";
import { RELEASE_AUDIT_SCHEMA, type ReleaseAuditResult } from "./types";

/** A pair result with a `warn` current (a drift, so drivers + regressions are non-trivial). */
function warnResult(): ReleaseAuditResult {
  return buildAuditResult({
    generatedAt: NOW,
    mode: "pair",
    policy: policy(),
    baseline: { supplied: true, ingested: usable() },
    current: {
      supplied: true,
      ingested: usable({
        verdict: "warn",
        stages: { policy: { present: true, severity: "warn" } },
        warnStages: 1,
        warningSignals: 2,
      }),
    },
  });
}

describe("release-audit render — json", () => {
  it("is valid JSON pinning the schema, verdict, and receipt", () => {
    const json = JSON.parse(renderReleaseAudit(warnResult(), "json"));
    expect(json.schema).toBe(RELEASE_AUDIT_SCHEMA);
    expect(json.rollup.verdict).toBe("warn");
    expect(json.receipt.category).toBe("worker-release-audit");
    expect(Array.isArray(json.regressions)).toBe(true);
  });

  it("respects the pretty flag", () => {
    const result = warnResult();
    expect(renderReleaseAudit(result, "json", true)).toContain("\n  ");
    expect(renderReleaseAudit(result, "json", false)).not.toContain("\n  ");
  });
});

describe("release-audit render — text", () => {
  it("prints the rollup, drivers, diff, next action, and caveats", () => {
    const text = renderReleaseAudit(warnResult(), "text");
    expect(text).toContain("release evidence audit / diff");
    expect(text).toContain("ROLLUP: WARN (exit 3)");
    expect(text).toContain("drivers:");
    expect(text).toContain("DIFF (baseline → current");
    expect(text).toContain("NEXT ACTION");
    expect(text).toContain("CAVEATS");
  });
});

describe("release-audit render — determinism", () => {
  it("same result → byte-identical output in both formats", () => {
    const a = warnResult();
    const b = warnResult();
    expect(renderReleaseAudit(a, "json")).toBe(renderReleaseAudit(b, "json"));
    expect(renderReleaseAudit(a, "text")).toBe(renderReleaseAudit(b, "text"));
  });
});
