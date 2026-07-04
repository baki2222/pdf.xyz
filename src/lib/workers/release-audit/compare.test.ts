import { describe, expect, it } from "vitest";
import { bundleTrust, compareBundles, mergeTrust, type AuditTrust } from "./compare";
import { reduceBundle } from "./reduce";
import { UNREADABLE, policy, summary, tampered, usable } from "./fixtures";
import type { AuditComparison } from "./compare";
import type { ReleaseAuditRegressionId } from "./types";

/** No tampered / unreadable bundle in the supplied set. */
const NO_TRUST: AuditTrust = { tampered: false, unreadable: false };

/** The evaluated finding for `id`. */
function byId(c: AuditComparison, id: ReleaseAuditRegressionId) {
  const f = c.findings.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no finding ${id}`);
  return f;
}

describe("release-audit compare — no regression + improvement", () => {
  it("two identical usable postures → every check ok, no deltas", () => {
    const c = compareBundles(summary("baseline"), summary("current"), policy(), NO_TRUST);
    for (const f of c.findings) expect(f.status, f.id).toBe("ok");
    expect(c.facts.postureRankDelta).toBe(0);
    expect(c.facts.improved).toBe(false);
    expect(c.facts.newWarnings).toBe(0);
  });

  it("an IMPROVED posture (warn baseline → pass current) is never a regression", () => {
    const baseline = summary("baseline", {
      verdict: "warn",
      stages: { policy: { present: true, severity: "warn" } },
      warnStages: 1,
      warningSignals: 2,
    });
    const c = compareBundles(baseline, summary("current"), policy(), NO_TRUST);
    for (const f of c.findings) expect(f.status, f.id).toBe("ok");
    expect(c.facts.improved).toBe(true);
    expect(c.facts.postureRankDelta).toBeLessThan(0);
  });
});

describe("release-audit compare — verdict + archive-decision regressions", () => {
  it("pass → fail is a BLOCKING verdict + archive-decision regression", () => {
    const current = summary("current", {
      verdict: "fail",
      stages: { policy: { present: true, severity: "fail" } },
    });
    const c = compareBundles(summary("baseline"), current, policy(), NO_TRUST);
    expect(byId(c, "verdict-worsened").status).toBe("regressed");
    expect(byId(c, "verdict-worsened").severity).toBe("block");
    expect(byId(c, "archive-decision-worsened").severity).toBe("block");
    expect(c.facts.postureRankDelta).toBe(3);
  });

  it("pass → warn is an ADVISORY verdict + archive-decision regression", () => {
    const current = summary("current", {
      verdict: "warn",
      stages: { policy: { present: true, severity: "warn" } },
      warnStages: 1,
      warningSignals: 1,
    });
    const c = compareBundles(summary("baseline"), current, policy(), NO_TRUST);
    expect(byId(c, "verdict-worsened").severity).toBe("warn");
    expect(byId(c, "archive-decision-worsened").severity).toBe("warn");
    expect(byId(c, "warnings-increased").status).toBe("regressed");
  });

  it("--fail-on-unknown escalates a drop-to-unknown to BLOCKING", () => {
    const current = summary("current", {
      verdict: "unknown",
      stages: { policy: { present: true, severity: "unknown" } },
    });
    const advisory = compareBundles(summary("baseline"), current, policy(), NO_TRUST);
    expect(byId(advisory, "verdict-worsened").severity).toBe("warn");

    const blocking = compareBundles(summary("baseline"), current, policy({ failOnUnknown: true }), NO_TRUST);
    expect(byId(blocking, "verdict-worsened").severity).toBe("block");
    expect(byId(blocking, "archive-decision-worsened").severity).toBe("block");
  });
});

describe("release-audit compare — consistency + coverage regressions", () => {
  it("a held link that now MISMATCHES is a blocking consistency break", () => {
    const current = summary("current", { links: { "artifact-digest": "mismatch" } });
    const c = compareBundles(summary("baseline"), current, policy(), NO_TRUST);
    expect(byId(c, "consistency-broke").status).toBe("regressed");
    expect(byId(c, "consistency-broke").severity).toBe("block");
    expect(c.facts.brokenLinks).toBe(1);
  });

  it("a rise in inconsistencies is a blocking consistency break", () => {
    const current = summary("current", { inconsistencies: 2 });
    const c = compareBundles(summary("baseline"), current, policy(), NO_TRUST);
    expect(byId(c, "consistency-broke").status).toBe("regressed");
    expect(c.facts.inconsistenciesDelta).toBe(2);
  });

  it("a held link that is now SKIPPED is an advisory weakening", () => {
    const current = summary("current", { links: { "index-policy-agreement": "skipped" } });
    const c = compareBundles(summary("baseline"), current, policy(), NO_TRUST);
    expect(byId(c, "consistency-weakened").status).toBe("regressed");
    expect(byId(c, "consistency-weakened").severity).toBe("warn");
    expect(c.facts.weakenedLinks).toBe(1);
  });

  it("a stage present in the baseline but absent now is advisory coverage-dropped", () => {
    const current = summary("current", {
      stages: {
        gate: { present: false, severity: "unknown" },
        artifact: { present: false, severity: "unknown" },
      },
      stagesPresent: 2,
    });
    const c = compareBundles(summary("baseline"), current, policy(), NO_TRUST);
    expect(byId(c, "coverage-dropped").status).toBe("regressed");
    expect(c.facts.droppedStages).toBe(2);
    expect(c.facts.stagesPresentDelta).toBe(-2);
  });
});

describe("release-audit compare — warnings threshold", () => {
  it("new advisory pressure beyond --max-new-warnings fires; within it does not", () => {
    const current = summary("current", { warningSignals: 3 });
    const strict = compareBundles(summary("baseline"), current, policy(), NO_TRUST);
    expect(byId(strict, "warnings-increased").status).toBe("regressed");
    expect(strict.facts.newWarnings).toBe(3);

    const tolerant = compareBundles(summary("baseline"), current, policy({ maxNewWarnings: 5 }), NO_TRUST);
    expect(byId(tolerant, "warnings-increased").status).toBe("ok");
  });
});

describe("release-audit compare — trust gates (tampered / unreadable / absent)", () => {
  it("a tampered bundle fires bundle-tampered (block) and SKIPS every comparison", () => {
    const current = reduceBundle("current", true, tampered("pass"));
    const trust: AuditTrust = { tampered: true, unreadable: false };
    const c = compareBundles(summary("baseline"), current, policy(), trust);
    expect(byId(c, "bundle-tampered").status).toBe("regressed");
    expect(byId(c, "bundle-tampered").severity).toBe("block");
    for (const id of ["verdict-worsened", "consistency-broke", "coverage-dropped"] as const) {
      expect(byId(c, id).status, id).toBe("skipped");
    }
    expect(c.facts.postureRankDelta).toBeNull();
  });

  it("an unreadable bundle fires bundle-unreadable (unknown) and SKIPS every comparison", () => {
    const current = reduceBundle("current", true, UNREADABLE);
    const trust: AuditTrust = { tampered: false, unreadable: true };
    const c = compareBundles(summary("baseline"), current, policy(), trust);
    expect(byId(c, "bundle-unreadable").status).toBe("regressed");
    expect(byId(c, "bundle-unreadable").severity).toBe("unknown");
    expect(byId(c, "verdict-worsened").status).toBe("skipped");
  });
});

describe("release-audit compare — trust folding", () => {
  it("bundleTrust classifies present/recognized/usable slots", () => {
    expect(bundleTrust(summary("current"))).toEqual({ tampered: false, unreadable: false });
    expect(bundleTrust(reduceBundle("current", true, tampered()))).toEqual({ tampered: true, unreadable: false });
    expect(bundleTrust(reduceBundle("current", true, UNREADABLE))).toEqual({ tampered: false, unreadable: true });
    // A not-supplied slot is neither tampered nor unreadable (it is just absent).
    expect(bundleTrust(reduceBundle("baseline", false, usable()))).toEqual({ tampered: false, unreadable: false });
  });

  it("mergeTrust ORs across the supplied set", () => {
    expect(mergeTrust([{ tampered: false, unreadable: true }, { tampered: true, unreadable: false }])).toEqual({
      tampered: true,
      unreadable: true,
    });
    expect(mergeTrust([NO_TRUST, NO_TRUST])).toEqual(NO_TRUST);
  });
});
