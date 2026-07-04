// @vitest-environment node
/**
 * Trust-boundary proofs for the release-report ingest (Phase 52). The load-bearing guarantees: each document
 * is RE-VALIDATED against itself (its recorded rollup must re-derive from its own facts), so a hand-flipped
 * verdict / lied count is caught as `tampered`; a wrong-schema input is `unreadable`; and the reduced facts
 * are bounded, never a raw value from the input.
 */

import { describe, expect, it } from "vitest";
import { ingestAudit, ingestBundleSource, UNRECOGNIZED_AUDIT } from "./ingest";
import { failAudit, notADocument, passAudit, passBundle, tamperAudit, tamperBundle, warnAudit } from "./fixtures";

describe("release-report ingest — bundle source (reuses the Phase 51 boundary)", () => {
  it("a self-consistent bundle is recognized + usable with reduced facts", () => {
    const ing = ingestBundleSource(passBundle());
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(true);
    expect(ing.facts?.verdict).toBe("pass");
  });

  it("a tampered bundle (flipped verdict) is recognized but NOT usable", () => {
    const ing = ingestBundleSource(tamperBundle(passBundle()));
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
  });

  it("a non-bundle is not recognized", () => {
    expect(ingestBundleSource(notADocument()).recognized).toBe(false);
    expect(ingestBundleSource(undefined).recognized).toBe(false);
    expect(ingestBundleSource("nonsense").recognized).toBe(false);
  });
});

describe("release-report ingest — audit source (re-derives the Phase 51 rollup)", () => {
  it("a self-consistent audit is recognized + usable with reduced facts", () => {
    const ing = ingestAudit(passAudit());
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(true);
    expect(ing.verdict).toBe("pass");
    expect(ing.facts?.verdict).toBe("pass");
    expect(ing.facts?.mode).toBe("pair");
    expect(ing.facts?.comparable).toBe(true);
  });

  it("reduces a warn audit's regression drivers + counts (bounded)", () => {
    const ing = ingestAudit(warnAudit());
    expect(ing.usable).toBe(true);
    expect(ing.facts?.verdict).toBe("warn");
    expect(ing.facts?.warningRegressions).toBeGreaterThan(0);
    expect(ing.facts?.blockingRegressions).toBe(0);
    // drivers are bounded regression ids, never prose.
    for (const d of ing.facts?.drivers ?? []) expect(typeof d).toBe("string");
  });

  it("reduces a fail audit as a blocking regression", () => {
    const ing = ingestAudit(failAudit());
    expect(ing.usable).toBe(true);
    expect(ing.facts?.verdict).toBe("fail");
    expect(ing.facts?.blockingRegressions).toBeGreaterThan(0);
  });

  it("a tampered audit (flipped rollup verdict) is recognized but NOT usable; surfaces its claimed verdict", () => {
    const tampered = tamperAudit(passAudit()); // pass → warn recorded, but re-derives to pass
    const ing = ingestAudit(tampered);
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
    expect(ing.verdict).toBe("warn"); // the untrusted claimed verdict is surfaced
    expect(ing.facts).toBeNull(); // no trusted facts from a tampered audit
  });

  it("a lied blocking-count is caught as inconsistent (recompute disagrees)", () => {
    const audit = JSON.parse(JSON.stringify(passAudit())) as { rollup: { blockingRegressions: number } };
    audit.rollup.blockingRegressions = 5; // a lie — the findings hold none
    const ing = ingestAudit(audit);
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
  });

  it("a structurally-broken audit (missing regressions array) is recognized but not usable", () => {
    const audit = JSON.parse(JSON.stringify(passAudit())) as Record<string, unknown>;
    delete audit.regressions;
    const ing = ingestAudit(audit);
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
  });

  it("a regressions array with an off-order id is not usable", () => {
    const audit = JSON.parse(JSON.stringify(passAudit())) as { regressions: { id: string }[] };
    audit.regressions[0]!.id = "not-a-real-regression";
    expect(ingestAudit(audit).usable).toBe(false);
  });

  it("a non-audit is not recognized (the honest UNRECOGNIZED_AUDIT)", () => {
    expect(ingestAudit(notADocument())).toEqual(UNRECOGNIZED_AUDIT);
    expect(ingestAudit(undefined)).toEqual(UNRECOGNIZED_AUDIT);
    expect(ingestAudit(passBundle())).toEqual(UNRECOGNIZED_AUDIT); // a bundle is not an audit
    expect(ingestAudit([1, 2, 3])).toEqual(UNRECOGNIZED_AUDIT);
  });

  it("never throws on a hostile / malformed root", () => {
    for (const root of [null, 42, "", { schema: "pdfxyz.release-audit/1" }, { schema: "pdfxyz.release-audit/1", rollup: 7 }]) {
      expect(() => ingestAudit(root)).not.toThrow();
    }
  });
});
