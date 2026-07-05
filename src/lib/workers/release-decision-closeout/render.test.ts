import { describe, expect, it } from "vitest";
import {
  coherentPlan,
  completedReceipt,
  decisionFor,
  makeCloseout,
  windowFor,
} from "./fixtures";
import { renderReleaseDecisionCloseout } from "./render";

describe("renderReleaseDecisionCloseout", () => {
  it("json is parseable, pinned to the schema, and round-trips the verdict + rollup", () => {
    const result = makeCloseout(completedReceipt(), { plan: coherentPlan() });
    const json = renderReleaseDecisionCloseout(result, "json");
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("pdfxyz.release-decision-closeout/1");
    expect(parsed.verdict).toBe("closed");
    expect(parsed.closeout.exitCode).toBe(0);
    expect(parsed.receipt.category).toBe("worker-release-decision-closeout");
  });

  it("compact json omits indentation", () => {
    const result = makeCloseout(completedReceipt());
    expect(renderReleaseDecisionCloseout(result, "json", false)).not.toContain("\n  ");
  });

  it("text carries the closeout verdict, plan class, reasons, and the related checklist", () => {
    const result = makeCloseout(completedReceipt(), { plan: coherentPlan(), index: windowFor("watch") });
    const text = renderReleaseDecisionCloseout(result, "text");
    expect(text).toMatch(/CLOSEOUT: CLOSEOUT-OPEN \(exit 3\)/);
    expect(text).toContain("plan class: clear");
    expect(text).toContain("RELATED RECORDS");
    expect(text).toMatch(/plan \(optional\): usable, signal=coherent/);
    expect(text).toMatch(/index \(optional\): usable, signal=advisory, watch/);
    expect(text).toContain("PRIMARY RECEIPT");
    expect(text).toContain("CAVEATS");
  });

  it("text shows a blocked closeout for a contradictory / blocking related record", () => {
    const result = makeCloseout(completedReceipt(), { decision: decisionFor("reject") });
    const text = renderReleaseDecisionCloseout(result, "text");
    expect(text).toMatch(/CLOSEOUT: CLOSEOUT-BLOCKED \(exit 4\)/);
    expect(text).toMatch(/decision \(optional\): usable, signal=blocking, reject/);
  });

  it("text notes strict-open escalation and missing required records", () => {
    const result = makeCloseout(
      completedReceipt(),
      {},
      { strictOpen: true, require: { plan: true, trend: false, decision: false, index: false } },
    );
    const text = renderReleaseDecisionCloseout(result, "text");
    expect(text).toContain("missing required records: plan");
  });
});
