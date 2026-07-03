import { describe, expect, it } from "vitest";
import { ageWithin, configuredAssertions, evaluatePolicy } from "./evaluate";
import { emptyPolicy } from "./fixtures";
import type { ReleasePolicyFacts, ReleasePolicyInputs } from "./types";

/** A clean, healthy set of facts to override per-test. */
function facts(over: Partial<ReleasePolicyFacts> = {}): ReleasePolicyFacts {
  return {
    archiveVerdict: "ok",
    indexedArtifacts: 3,
    skippedInputs: 0,
    totalInputs: 3,
    integrityFailures: 0,
    verdictCounts: { pass: 3, warn: 0, fail: 0, unknown: 0 },
    overRetentionCount: 0,
    overCount: false,
    overAge: false,
    stale: false,
    newestAgeBucket: "1-7d",
    oldestAgeBucket: "7-30d",
    latestVerdict: "pass",
    ...over,
  };
}

function policy(over: Partial<ReleasePolicyInputs> = {}): ReleasePolicyInputs {
  return { ...emptyPolicy(), ...over };
}

describe("ageWithin", () => {
  it("passes when the observed age is at or below the bound", () => {
    expect(ageWithin("<1h", "7-30d")).toBe(true);
    expect(ageWithin("7-30d", "7-30d")).toBe(true);
  });
  it("fails when the observed age is older than the bound", () => {
    expect(ageWithin("30-90d", "7-30d")).toBe(false);
    expect(ageWithin("90d+", "1-7d")).toBe(false);
  });
  it("fails closed on future/unknown (cannot confirm freshness)", () => {
    expect(ageWithin("future", "90d+")).toBe(false);
    expect(ageWithin("unknown", "90d+")).toBe(false);
  });
});

describe("configuredAssertions", () => {
  it("lists only the flags that were set, in canonical order", () => {
    expect(configuredAssertions(policy({ requireClean: true, maxFail: 0, minArtifacts: 2 }))).toEqual([
      "require-clean",
      "max-fail",
      "min-artifacts",
    ]);
    expect(configuredAssertions(emptyPolicy())).toEqual([]);
  });
});

describe("evaluatePolicy — no violations", () => {
  it("a clean archive under a satisfied policy has no violations", () => {
    const v = evaluatePolicy(facts(), policy({ requireClean: true, requireLatestOk: true, minArtifacts: 2, maxFail: 0 }));
    expect(v).toEqual([]);
  });

  it("an unset assertion never fires", () => {
    expect(evaluatePolicy(facts({ verdictCounts: { pass: 0, warn: 0, fail: 5, unknown: 0 } }), emptyPolicy())).toEqual([]);
  });
});

describe("evaluatePolicy — always-on integrity", () => {
  it("a valid index reporting a tampered artifact always fails, even with no flags", () => {
    const v = evaluatePolicy(facts({ archiveVerdict: "invalid", integrityFailures: 1 }), emptyPolicy());
    expect(v.map((x) => x.id)).toEqual(["index-tampered"]);
    expect(v[0]!.severity).toBe("block");
  });
});

describe("evaluatePolicy — blocking assertions", () => {
  it("require-clean fires when the archive verdict is not ok", () => {
    const v = evaluatePolicy(facts({ archiveVerdict: "warn" }), policy({ requireClean: true }));
    expect(v.map((x) => x.id)).toContain("index-not-clean");
    expect(v.find((x) => x.id === "index-not-clean")!.observed).toBe("warn");
  });

  it("require-latest-ok fires when the latest verdict is not pass (incl. none)", () => {
    expect(evaluatePolicy(facts({ latestVerdict: "warn" }), policy({ requireLatestOk: true })).map((x) => x.id)).toContain("latest-not-ok");
    const none = evaluatePolicy(facts({ latestVerdict: null }), policy({ requireLatestOk: true }));
    expect(none.find((x) => x.id === "latest-not-ok")!.observed).toBe("none");
  });

  it("max-invalid / max-fail fire strictly above the bound", () => {
    expect(evaluatePolicy(facts({ integrityFailures: 1, archiveVerdict: "ok" }), policy({ maxInvalid: 0 })).map((x) => x.id)).toContain("too-many-invalid");
    expect(evaluatePolicy(facts({ verdictCounts: { pass: 1, warn: 0, fail: 2, unknown: 0 } }), policy({ maxFail: 1 })).map((x) => x.id)).toContain("too-many-fail");
    // at the bound: no violation
    expect(evaluatePolicy(facts({ verdictCounts: { pass: 1, warn: 0, fail: 1, unknown: 0 } }), policy({ maxFail: 1 }))).toEqual([]);
  });

  it("min-artifacts / max-artifacts fire on either side of the band", () => {
    expect(evaluatePolicy(facts({ indexedArtifacts: 1 }), policy({ minArtifacts: 3 })).map((x) => x.id)).toContain("too-few-artifacts");
    expect(evaluatePolicy(facts({ indexedArtifacts: 9 }), policy({ maxArtifacts: 3 })).map((x) => x.id)).toContain("too-many-artifacts");
  });

  it("max-age-bucket fires when the newest artifact is older than the bound", () => {
    const v = evaluatePolicy(facts({ newestAgeBucket: "90d+" }), policy({ maxAgeBucket: "7-30d" }));
    expect(v.find((x) => x.id === "archive-stale")!.observed).toBe("90d+");
    // fresh enough: no violation
    expect(evaluatePolicy(facts({ newestAgeBucket: "<1h" }), policy({ maxAgeBucket: "7-30d" }))).toEqual([]);
  });
});

describe("evaluatePolicy — warning assertions", () => {
  it("max-warn / max-skipped / forbid-over-retention are warn severity", () => {
    const v = evaluatePolicy(
      facts({ verdictCounts: { pass: 0, warn: 2, fail: 0, unknown: 0 }, skippedInputs: 1, overRetentionCount: 1 }),
      policy({ maxWarn: 0, maxSkipped: 0, forbidOverRetention: true }),
    );
    const byId = new Map(v.map((x) => [x.id, x]));
    for (const id of ["too-many-warn", "too-many-skipped", "over-retention"] as const) {
      expect(byId.get(id)!.severity).toBe("warn");
    }
  });
});

describe("evaluatePolicy — determinism", () => {
  it("emits violations in canonical order regardless of which flags failed", () => {
    const v = evaluatePolicy(
      facts({ archiveVerdict: "warn", verdictCounts: { pass: 0, warn: 3, fail: 2, unknown: 0 }, indexedArtifacts: 5, overRetentionCount: 1 }),
      policy({ maxWarn: 0, requireClean: true, maxFail: 0, forbidOverRetention: true }),
    );
    expect(v.map((x) => x.id)).toEqual(["index-not-clean", "too-many-fail", "too-many-warn", "over-retention"]);
    // every violation carries an authored remediation
    for (const x of v) expect(x.detail.length).toBeGreaterThan(0);
  });
});
