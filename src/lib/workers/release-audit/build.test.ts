import { describe, expect, it } from "vitest";
import { buildAuditResult, type BuildAuditInput } from "./build";
import { NOW, UNREADABLE, policy, tampered, usable } from "./fixtures";
import {
  RELEASE_AUDIT_CAVEATS,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_CI_BUNDLE_SCHEMA,
  type IngestedBundle,
} from "./types";

/** Assemble a pair-mode composer input from two ingested bundles (both supplied). */
function pair(baseline: IngestedBundle, current: IngestedBundle): BuildAuditInput {
  return {
    generatedAt: NOW,
    mode: "pair",
    policy: policy(),
    baseline: { supplied: true, ingested: baseline },
    current: { supplied: true, ingested: current },
  };
}

describe("release-audit build — pair result", () => {
  it("two usable pass bundles → a stable pass result with the pinned schemas", () => {
    const result = buildAuditResult(pair(usable(), usable()));
    expect(result.schema).toBe(RELEASE_AUDIT_SCHEMA);
    expect(result.metadata.bundleSchema).toBe(RELEASE_CI_BUNDLE_SCHEMA);
    expect(result.rollup.verdict).toBe("pass");
    expect(result.rollup.comparable).toBe(true);
    expect(result.history).toBeNull();
    expect(result.caveats).toEqual(RELEASE_AUDIT_CAVEATS);
    expect(result.receipt.verdict).toBe("pass");
  });

  it("a tampered current fails closed even though the diff cannot run", () => {
    const result = buildAuditResult(pair(usable(), tampered("pass")));
    expect(result.rollup.verdict).toBe("fail");
    expect(result.rollup.comparable).toBe(false);
    expect(result.rollup.drivers).toContain("bundle-tampered");
  });

  it("an unreadable current → unknown (insufficient), never a vacuous pass", () => {
    const result = buildAuditResult(pair(usable(), UNREADABLE));
    expect(result.rollup.verdict).toBe("unknown");
    expect(result.rollup.drivers).toContain("bundle-unreadable");
  });

  it("is deterministic — same input + stamp yields the same result", () => {
    const a = buildAuditResult(pair(usable(), usable({ verdict: "warn" })));
    const b = buildAuditResult(pair(usable(), usable({ verdict: "warn" })));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("release-audit build — history result", () => {
  it("diffs the last two members and summarizes the whole distribution", () => {
    const history = [usable({ verdict: "pass" }), usable({ verdict: "warn" }), usable({ verdict: "pass" })];
    const result = buildAuditResult({
      generatedAt: NOW,
      mode: "history",
      policy: policy(),
      baseline: { supplied: true, ingested: history[1]! },
      current: { supplied: true, ingested: history[2]! },
      history,
    });
    expect(result.mode).toBe("history");
    expect(result.history?.count).toBe(3);
    expect(result.history?.usable).toBe(3);
    expect(result.history?.verdictCounts.pass).toBe(2);
    // last (pass) vs its baseline (warn) is an improvement → no regression.
    expect(result.rollup.verdict).toBe("pass");
  });

  it("a tampered member ANYWHERE in the history fails the audit closed", () => {
    const history = [tampered("pass"), usable({ verdict: "pass" }), usable({ verdict: "pass" })];
    const result = buildAuditResult({
      generatedAt: NOW,
      mode: "history",
      policy: policy(),
      baseline: { supplied: true, ingested: history[1]! },
      current: { supplied: true, ingested: history[2]! },
      history,
    });
    expect(result.rollup.verdict).toBe("fail");
    expect(result.rollup.drivers).toContain("bundle-tampered");
  });
});
