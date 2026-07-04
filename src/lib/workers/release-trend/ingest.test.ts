/**
 * Unit proofs for the release-trend trust boundary (Phase 53): it recognizes only a real `pdfxyz.release-report/1`,
 * re-derives each report's recommendation from its OWN recorded sources + strict, and marks a report `usable`
 * only if the record re-derives — so a hand-flipped recommendation / malformed record is caught as a tamper and
 * never yields trusted facts. It never throws and never echoes the input.
 */

import { describe, expect, it } from "vitest";
import { ingestReport, UNRECOGNIZED_REPORT } from "./ingest";
import {
  holdFailReport,
  holdWarningReport,
  needsEvidenceReport,
  notAReport,
  promoteReadyReport,
  reportFor,
  tamperReport,
} from "./fixtures";
import { RELEASE_REPORT_RECOMMENDATIONS } from "../release-report/types";

describe("ingestReport — unrecognized inputs", () => {
  it("a non-object / wrong-schema input is UNRECOGNIZED (⇒ unreadable)", () => {
    expect(ingestReport(undefined)).toEqual(UNRECOGNIZED_REPORT);
    expect(ingestReport(null)).toEqual(UNRECOGNIZED_REPORT);
    expect(ingestReport(42)).toEqual(UNRECOGNIZED_REPORT);
    expect(ingestReport([])).toEqual(UNRECOGNIZED_REPORT);
    expect(ingestReport(notAReport())).toEqual(UNRECOGNIZED_REPORT);
    expect(ingestReport({ schema: "pdfxyz.release-report/1" })).not.toEqual(UNRECOGNIZED_REPORT); // recognized (but tampered)
  });
});

describe("ingestReport — a self-consistent report is usable", () => {
  it("re-derives each recommendation and marks the report usable with bounded facts", () => {
    for (const rec of RELEASE_REPORT_RECOMMENDATIONS) {
      const ingested = ingestReport(reportFor(rec));
      expect(ingested.recognized, rec).toBe(true);
      expect(ingested.usable, rec).toBe(true);
      expect(ingested.recommendation, rec).toBe(rec);
      expect(ingested.facts, rec).not.toBeNull();
      expect(ingested.facts!.recommendation, rec).toBe(rec);
      expect(ingested.facts!.ready, rec).toBe(rec === "promote-ready");
    }
  });

  it("derives coverage (hasBundle / hasAudit) from the reconstructed sources, not the report's claim", () => {
    const pr = ingestReport(promoteReadyReport()); // bundle + audit
    expect(pr.facts).toMatchObject({ hasBundle: true, hasAudit: true });
    const hw = ingestReport(holdWarningReport()); // bundle only
    expect(hw.facts).toMatchObject({ hasBundle: true, hasAudit: false });
    const ne = ingestReport(needsEvidenceReport()); // audit only
    expect(ne.facts).toMatchObject({ hasBundle: false, hasAudit: true });
  });
});

describe("ingestReport — a tampered report is caught", () => {
  it("a flipped recorded recommendation does not re-derive (⇒ recognized, not usable), claim surfaced", () => {
    const tampered = tamperReport(promoteReadyReport(), "hold-fail");
    const ingested = ingestReport(tampered);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.recommendation).toBe("hold-fail"); // the untrusted CLAIM is surfaced
    expect(ingested.facts).toBeNull();
  });

  it("a lied count / hidden rationale is caught even when the recommendation string is untouched", () => {
    const report = JSON.parse(JSON.stringify(holdFailReport())) as {
      recommendation: { blocking: number; rationale: string[] };
    };
    report.recommendation.blocking = 0; // the real fold has ≥1 blocking for a hold-fail
    const ingested = ingestReport(report);
    expect(ingested.usable).toBe(false);
    expect(ingested.recommendation).toBe("hold-fail");
  });

  it("a malformed recommendation block / missing sources is recognized-but-not-usable", () => {
    expect(ingestReport({ schema: "pdfxyz.release-report/1" })).toMatchObject({
      recognized: true,
      usable: false,
      recommendation: null,
    });
    const noSources = JSON.parse(JSON.stringify(promoteReadyReport())) as { sources?: unknown };
    delete noSources.sources;
    expect(ingestReport(noSources)).toMatchObject({ recognized: true, usable: false });
  });

  it("an off-enum source verdict / state is treated as corrupt (tampered)", () => {
    const report = JSON.parse(JSON.stringify(promoteReadyReport())) as {
      sources: { id: string; verdict: unknown; state: string }[];
    };
    const bundle = report.sources.find((s) => s.id === "bundle")!;
    bundle.verdict = "not-a-verdict";
    expect(ingestReport(report).usable).toBe(false);
  });
});

describe("ingestReport — never throws or echoes", () => {
  it("survives deeply hostile / circular-free garbage without throwing", () => {
    const hostile = {
      schema: "pdfxyz.release-report/1",
      recommendation: { recommendation: "promote-ready", exitCode: "sk-secret", rationale: 7 },
      sources: "s3://evil/bucket",
      evilTop: "akiaiosfodnn7example",
    };
    expect(() => ingestReport(hostile)).not.toThrow();
    const ingested = ingestReport(hostile);
    expect(ingested.usable).toBe(false);
    // Nothing from the input escapes into the bounded outcome.
    expect(JSON.stringify(ingested)).not.toContain("evil");
    expect(JSON.stringify(ingested)).not.toContain("akia");
  });
});
