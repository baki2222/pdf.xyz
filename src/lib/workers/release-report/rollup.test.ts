// @vitest-environment node
/**
 * Unit proofs for the release-report rollup (Phase 52): the fired-rationale derivation + the fail-closed fold
 * into the final recommendation. The load-bearing guarantees:
 *  - a `promote-ready` REQUIRES a usable bundle whose own verdict is `pass` (an audit-only run is never a promote);
 *  - fail-closed precedence: blocking > insufficient (needs-evidence) > advisory > ready;
 *  - `--strict` escalates an advisory-ONLY posture to `hold-fail`, and nothing else.
 */

import { describe, expect, it } from "vitest";
import { reduceAuditSource, reduceBundleSource } from "./reduce";
import { computeReportRecommendation, deriveRationale, type ReportSources } from "./rollup";
import { RELEASE_REPORT_RATIONALE_DETAIL, RELEASE_REPORT_RATIONALE_IDS } from "./types";
import {
  failAudit,
  failBundle,
  ingestSourcesFrom,
  notADocument,
  passAudit,
  passBundle,
  tamperAudit,
  tamperBundle,
  unknownAudit,
  unknownBundle,
  warnAudit,
  warnBundle,
  type ReportObjects,
} from "./fixtures";

/** Reduce a subset of document objects to the two report sources the rollup folds. */
function sources(objs: ReportObjects): ReportSources {
  const ingested = ingestSourcesFrom(objs);
  return { bundle: reduceBundleSource(ingested.bundle), audit: reduceAuditSource(ingested.audit) };
}

/** The final recommendation + fired rationale ids for a subset of documents. */
function recommend(objs: ReportObjects, strict = false) {
  const { rollup } = computeReportRecommendation(sources(objs), strict);
  return { recommendation: rollup.recommendation, exit: rollup.exitCode, rationale: rollup.rationale, rollup };
}

describe("release-report rollup — promote-ready requires a usable passing bundle", () => {
  it("a usable pass bundle (alone or with a pass audit) is promote-ready (exit 0)", () => {
    expect(recommend({ bundle: passBundle() })).toMatchObject({ recommendation: "promote-ready", exit: 0 });
    expect(recommend({ bundle: passBundle(), audit: passAudit() })).toMatchObject({
      recommendation: "promote-ready",
      exit: 0,
      rationale: [],
    });
  });

  it("an audit-only run is NEVER a promote — even a passing audit is needs-evidence (coherence-missing)", () => {
    const r = recommend({ audit: passAudit() });
    expect(r).toMatchObject({ recommendation: "needs-evidence", exit: 2 });
    expect(r.rationale).toContain("coherence-missing");
  });

  it("no bundle supplied at all fires coherence-missing (the audit cannot certify the release's own coherence)", () => {
    expect(deriveRationale(sources({ audit: passAudit() }))).toContain("coherence-missing");
    expect(deriveRationale(sources({ bundle: passBundle() }))).not.toContain("coherence-missing");
  });
});

describe("release-report rollup — fail-closed precedence (blocking > insufficient > advisory > ready)", () => {
  it("a blocking audit regression holds the release even when the bundle passes (hold-fail, exit 4)", () => {
    const r = recommend({ bundle: passBundle(), audit: failAudit() });
    expect(r).toMatchObject({ recommendation: "hold-fail", exit: 4 });
    expect(r.rationale).toContain("audit-regressed");
  });

  it("a failed bundle is hold-fail (exit 4)", () => {
    expect(recommend({ bundle: failBundle() })).toMatchObject({ recommendation: "hold-fail", exit: 4, rationale: ["bundle-failed"] });
  });

  it("an uncertified (unknown) bundle is needs-evidence, not a promote or a warn (exit 2)", () => {
    expect(recommend({ bundle: unknownBundle() })).toMatchObject({ recommendation: "needs-evidence", exit: 2, rationale: ["bundle-uncertified"] });
  });

  it("an unreadable supplied document is needs-evidence (never silently dropped)", () => {
    expect(recommend({ bundle: notADocument() }).recommendation).toBe("needs-evidence");
    // a passing bundle + an UNREADABLE audit still holds for evidence (the requested regression check failed to read)
    const r = recommend({ bundle: passBundle(), audit: notADocument() });
    expect(r).toMatchObject({ recommendation: "needs-evidence", exit: 2 });
    expect(r.rationale).toContain("evidence-unreadable");
  });

  it("a warn bundle / audit drift is an advisory hold-warning (exit 3)", () => {
    expect(recommend({ bundle: warnBundle() })).toMatchObject({ recommendation: "hold-warning", exit: 3, rationale: ["bundle-advisory"] });
    expect(recommend({ bundle: passBundle(), audit: warnAudit() })).toMatchObject({ recommendation: "hold-warning", exit: 3 });
  });

  it("insufficiency (an unknown audit) outranks an advisory bundle warn (needs-evidence wins over hold-warning)", () => {
    // bundle warn (advisory) + audit unknown (insufficient) → needs-evidence, mirroring the Phase 50 ladder.
    const r = recommend({ bundle: warnBundle(), audit: unknownAudit() });
    expect(r.recommendation).toBe("needs-evidence");
    expect(r.rationale).toEqual(expect.arrayContaining(["bundle-advisory", "audit-inconclusive"]));
  });

  it("blocking outranks insufficiency (a fail audit + an unknown bundle is hold-fail)", () => {
    const r = recommend({ bundle: unknownBundle(), audit: failAudit() });
    expect(r.recommendation).toBe("hold-fail");
    expect(r.rationale).toEqual(expect.arrayContaining(["audit-regressed", "bundle-uncertified"]));
  });
});

describe("release-report rollup — tamper is blocking", () => {
  it("a tampered bundle or audit is hold-fail (evidence-tampered, exit 4)", () => {
    expect(recommend({ bundle: tamperBundle(passBundle()) })).toMatchObject({ recommendation: "hold-fail", exit: 4 });
    const a = recommend({ audit: tamperAudit(passAudit()) });
    expect(a.recommendation).toBe("hold-fail");
    expect(a.rationale).toContain("evidence-tampered");
    // a tampered audit alongside a passing bundle still fails closed (a tamper dominates a pass).
    expect(recommend({ bundle: passBundle(), audit: tamperAudit(passAudit()) }).recommendation).toBe("hold-fail");
  });
});

describe("release-report rollup — --strict escalates advisory-only to hold-fail", () => {
  it("a warn bundle under --strict becomes hold-fail (exit 4) with strictEscalated", () => {
    const r = recommend({ bundle: warnBundle() }, true);
    expect(r).toMatchObject({ recommendation: "hold-fail", exit: 4 });
    expect(r.rollup.strict).toBe(true);
    expect(r.rollup.strictEscalated).toBe(true);
    // the rationale is still the advisory one — strict changes only the fold, not the reasons.
    expect(r.rationale).toEqual(["bundle-advisory"]);
  });

  it("--strict does NOT escalate a needs-evidence or a clean promote-ready", () => {
    // needs-evidence (an unknown bundle) stays needs-evidence — strict only bites an advisory-only posture.
    const ne = recommend({ bundle: unknownBundle() }, true);
    expect(ne.recommendation).toBe("needs-evidence");
    expect(ne.rollup.strictEscalated).toBe(false);
    // a clean pass stays promote-ready.
    const ok = recommend({ bundle: passBundle() }, true);
    expect(ok.recommendation).toBe("promote-ready");
    expect(ok.rollup.strictEscalated).toBe(false);
  });

  it("--strict + advisory + insufficiency stays needs-evidence (insufficiency outranks the escalated advisory)", () => {
    const r = recommend({ bundle: warnBundle(), audit: unknownAudit() }, true);
    expect(r.recommendation).toBe("needs-evidence");
    expect(r.rollup.strictEscalated).toBe(false);
  });
});

describe("release-report rollup — rationale is a canonical-ordered superset", () => {
  it("fired rationale are emitted in canonical order", () => {
    const fired = deriveRationale(sources({ bundle: warnBundle(), audit: failAudit() }));
    const canonicalIndex = (id: string) => RELEASE_REPORT_RATIONALE_IDS.indexOf(id as never);
    const sorted = [...fired].sort((a, b) => canonicalIndex(a) - canonicalIndex(b));
    expect(fired).toEqual(sorted);
  });

  it("every rationale id has an authored detail + severity", () => {
    for (const id of RELEASE_REPORT_RATIONALE_IDS) {
      const entry = RELEASE_REPORT_RATIONALE_DETAIL[id];
      expect(entry.detail.length).toBeGreaterThan(0);
      expect(["blocking", "insufficient", "advisory"]).toContain(entry.severity);
    }
  });

  it("counts match the fired rationale severities", () => {
    const { rollup } = computeReportRecommendation(sources({ bundle: warnBundle(), audit: failAudit() }), false);
    expect(rollup.blocking).toBe(1); // audit-regressed
    expect(rollup.advisories).toBe(1); // bundle-advisory
    expect(rollup.insufficiencies).toBe(0);
  });
});
