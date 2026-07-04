/**
 * Unit proofs for the release-trend renderers (Phase 53): stable JSON (round-trips) and a governance-friendly
 * text summary that surfaces the verdict, history, sequence, reasons, follow-ups, and caveats.
 */

import { describe, expect, it } from "vitest";
import { renderReleaseTrend, renderReleaseTrendJson } from "./render";
import { makeTrend, reportFor, tamperedReport } from "./fixtures";

const pr = () => reportFor("promote-ready");
const hw = () => reportFor("hold-warning");
const hf = () => reportFor("hold-fail");

describe("renderReleaseTrendJson", () => {
  it("emits a parseable result with a trailing newline", () => {
    const out = renderReleaseTrendJson(makeTrend([pr(), pr()]));
    expect(out.endsWith("\n")).toBe(true);
    expect(JSON.parse(out).schema).toBe("pdfxyz.release-trend/1");
  });

  it("honors the pretty flag", () => {
    const result = makeTrend([pr()]);
    expect(renderReleaseTrendJson(result, true)).toContain("\n  ");
    expect(renderReleaseTrendJson(result, false)).not.toContain("\n  ");
  });
});

describe("renderReleaseTrend — text", () => {
  it("headlines the verdict + exit code and lists the sequence oldest → newest", () => {
    // Tolerant thresholds so the recovered promote-ready TIP drives a stable trend despite historical noise.
    const text = renderReleaseTrend(makeTrend([hf(), hw(), pr()], { maxHoldFail: 5, maxHoldWarning: 5 }), "text");
    expect(text).toMatch(/TREND: STABLE \(exit 0\)/);
    expect(text).toMatch(/#1 \[BLOCKING\] state=usable, recommendation=hold-fail/);
    expect(text).toMatch(/#3 \[READY\] state=usable, recommendation=promote-ready/);
  });

  it("shows reasons + follow-ups when the trend is not clean", () => {
    const text = renderReleaseTrend(makeTrend([pr(), tamperedReport()]), "text");
    expect(text).toMatch(/TREND: FAILING \(exit 4\)/);
    expect(text).toContain("report-tampered");
    expect(text).toContain("recover-tampered-report");
    expect(text).toContain("CAVEATS");
    expect(text).toContain("SEQUENCE (oldest → newest)");
  });

  it("shows the recommendation histogram + policy line", () => {
    const text = renderReleaseTrend(makeTrend([pr(), hw()], { maxHoldWarning: 5 }), "text");
    expect(text).toMatch(/by recommendation: promote-ready=1, hold-warning=1/);
    expect(text).toMatch(/max-reports=20/);
  });

  it("notes a truncated window", () => {
    const objs = Array.from({ length: 4 }, () => pr());
    const text = renderReleaseTrend(makeTrend(objs, { maxReports: 2 }), "text");
    expect(text).toMatch(/older dropped by --max-reports=2/);
  });

  it("handles an empty history without throwing", () => {
    const text = renderReleaseTrend(makeTrend([]), "text");
    expect(text).toContain("(no reports considered)");
    expect(text).toMatch(/TREND: UNKNOWN/);
  });
});
