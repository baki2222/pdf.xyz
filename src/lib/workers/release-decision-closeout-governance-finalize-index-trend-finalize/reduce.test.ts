import { describe, expect, it } from "vitest";
import {
  advisoryPlan,
  advisoryReceipt,
  advisoryTrend,
  blockedFinalization,
  blockedReceipt,
  coherentFinalization,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  defaultPolicy,
  incompleteReceipt,
  invalidReceipt,
  makeFinalize,
  notAReceipt,
  openFinalization,
  openIndex,
  tamperPlanVerdict,
  tamperReceiptVerdict,
} from "./fixtures";
import { clearPlan } from "../release-decision-closeout-governance-finalize-index-trend-action-receipt/fixtures";
import { finalizeFor } from "../release-decision-closeout-governance-finalize-index/fixtures";

describe("finalize-index-trend-finalize reduce — the receipt's own verdict drives the baseline", () => {
  it("a usable completed receipt alone is finalized (exit 0)", () => {
    const r = makeFinalize(completedReceipt());
    expect(r.verdict).toBe("finalized");
    expect(r.exitCode).toBe(0);
    expect(r.finalize.reasons).toEqual(["receipt-completed"]);
  });

  it("an incomplete receipt is finalize-incomplete (exit 2)", () => {
    const r = makeFinalize(incompleteReceipt());
    expect(r.verdict).toBe("finalize-incomplete");
    expect(r.exitCode).toBe(2);
    expect(r.finalize.reasons).toContain("receipt-incomplete");
  });

  it("a blocked receipt is finalize-blocked (exit 4)", () => {
    const r = makeFinalize(blockedReceipt());
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.exitCode).toBe(4);
    expect(r.finalize.reasons).toContain("receipt-blocked");
  });

  it("an invalid-VERDICT receipt (a usable receipt reporting invalid) is finalize-blocked, not invalid", () => {
    const r = makeFinalize(invalidReceipt());
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.exitCode).toBe(4);
    expect(r.finalize.reasons).toContain("receipt-invalid");
    expect(r.source.state).toBe("usable"); // the DOCUMENT is trustworthy; its own verdict is invalid
  });

  it("an unreadable / tampered receipt DOCUMENT is finalize-invalid (exit 4)", () => {
    const unreadable = makeFinalize(notAReceipt());
    expect(unreadable.verdict).toBe("finalize-invalid");
    expect(unreadable.finalize.reasons).toContain("receipt-unreadable");

    const tampered = makeFinalize(tamperReceiptVerdict(completedReceipt(), "blocked"));
    expect(tampered.verdict).toBe("finalize-invalid");
    expect(tampered.finalize.reasons).toContain("receipt-tampered");
    expect(tampered.source.state).toBe("tampered");
  });
});

describe("finalize-index-trend-finalize reduce — source-chain cross-checks", () => {
  it("every coherent source-chain record supports the finalization (finalized, 4 coherent)", () => {
    const r = makeFinalize(completedReceipt(), {
      plan: coherentPlan(),
      trend: coherentTrend(),
      index: coherentIndex(),
      finalization: coherentFinalization(),
    });
    expect(r.verdict).toBe("finalized");
    expect(r.coverage.usableRecords).toBe(4);
    expect(r.coverage.coherentRecords).toBe(4);
    expect(r.coverage.contradictoryRecords).toBe(0);
    expect(r.finalize.reasons).toEqual([
      "receipt-completed",
      "plan-coherent",
      "trend-coherent",
      "index-coherent",
      "finalization-coherent",
    ]);
  });

  it("a plan that disagrees with what the receipt recorded is a contradiction (finalize-blocked)", () => {
    // A monitor plan is self-consistent but its verdict (`monitor`) differs from the receipt's recorded `clear`.
    const r = makeFinalize(completedReceipt(), { plan: advisoryPlan() });
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.finalize.reasons).toContain("plan-contradiction");
    expect(r.coverage.contradictoryRecords).toBe(1);
  });

  it("a trend that disagrees with what the plan/receipt recorded is a contradiction", () => {
    // The receipt's source-trend is `stable`; supply an advisory (degrading) trend → cross-check mismatch.
    const r = makeFinalize(completedReceipt(), { trend: advisoryTrend() });
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.finalize.reasons).toContain("trend-contradiction");
  });

  it("an index whose verdict != the trend's newest-window posture is a contradiction", () => {
    // Trend `stable` → newest window `indexed`; supply an index-open window → mismatch.
    const r = makeFinalize(completedReceipt(), { trend: coherentTrend(), index: openIndex() });
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.finalize.reasons).toContain("index-contradiction");
  });

  it("a finalization whose verdict != the index's latest finalization is a contradiction", () => {
    // index `indexed` latest finalization `finalized`; supply a finalize-blocked bundle → mismatch.
    const r = makeFinalize(completedReceipt(), { index: coherentIndex(), finalization: blockedFinalization() });
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.finalize.reasons).toContain("finalization-contradiction");
  });

  it("a tampered supplied source is finalize-invalid (an untrustworthy input)", () => {
    const r = makeFinalize(completedReceipt(), { plan: tamperPlanVerdict(clearPlan(), "monitor") });
    expect(r.verdict).toBe("finalize-invalid");
    expect(r.finalize.reasons).toContain("related-tampered");
    expect(r.coverage.tamperedRecords).toBe(1);
  });
});

describe("finalize-index-trend-finalize reduce — source postures (via the finalization slot, which has no fallback anchor)", () => {
  it("an advisory chain (a coherent degrading trend) is finalize-open (exit 3)", () => {
    const r = makeFinalize(advisoryReceipt(), { trend: advisoryTrend() });
    expect(r.verdict).toBe("finalize-open");
    expect(r.exitCode).toBe(3);
    expect(r.finalize.reasons).toContain("source-chain-advisory");
  });

  it("an ADVISORY finalization posture (no index anchor) is finalize-open", () => {
    const r = makeFinalize(completedReceipt(), { finalization: openFinalization() });
    expect(r.verdict).toBe("finalize-open");
    expect(r.finalize.reasons).toContain("source-chain-advisory");
  });

  it("an INSUFFICIENT finalization posture (no index anchor) is finalize-incomplete", () => {
    const r = makeFinalize(completedReceipt(), { finalization: finalizeFor("finalize-incomplete") });
    expect(r.verdict).toBe("finalize-incomplete");
    expect(r.finalize.reasons).toContain("source-chain-insufficient");
  });

  it("a BLOCKING finalization posture (no index anchor) is finalize-blocked", () => {
    const r = makeFinalize(completedReceipt(), { finalization: blockedFinalization() });
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.finalize.reasons).toContain("source-chain-blocked");
  });
});

describe("finalize-index-trend-finalize reduce — require-* + precedence", () => {
  it("a required-but-missing record is finalize-incomplete", () => {
    const r = makeFinalize(
      completedReceipt(),
      {},
      defaultPolicy({ require: { plan: false, trend: false, index: true, finalization: false } }),
    );
    expect(r.verdict).toBe("finalize-incomplete");
    expect(r.finalize.reasons).toContain("required-record-missing");
    expect(r.finalize.requiredMissing).toEqual(["index"]);
    expect(r.coverage.missingRecords).toBe(1);
  });

  it("incomplete OUTRANKS open — a required-missing record plus an advisory finalization is finalize-incomplete", () => {
    const r = makeFinalize(
      completedReceipt(),
      { finalization: openFinalization() },
      defaultPolicy({ require: { plan: true, trend: false, index: false, finalization: false } }),
    );
    expect(r.verdict).toBe("finalize-incomplete");
    expect(r.finalize.reasons).toEqual(expect.arrayContaining(["required-record-missing", "source-chain-advisory"]));
  });

  it("a supplied-but-unreadable OPTIONAL record is a coverage gap (finalize-incomplete)", () => {
    const r = makeFinalize(completedReceipt(), { plan: { schema: "pdfxyz.something-else/1" } });
    expect(r.verdict).toBe("finalize-incomplete");
    expect(r.finalize.reasons).toContain("related-unreadable");
    expect(r.coverage.unreadableRecords).toBe(1);
  });
});

describe("finalize-index-trend-finalize reduce — strict-open escalation", () => {
  const strict = defaultPolicy({ strictOpen: true });

  it("escalates an advisory (open) finalization to finalize-blocked", () => {
    const r = makeFinalize(completedReceipt(), { finalization: openFinalization() }, strict);
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.finalize.strictOpenEscalated).toBe(true);
    expect(r.finalize.strictOpenEscalatedFrom).toBe("finalize-open");
    expect(r.finalize.reasons).toContain("strict-open-escalation");
  });

  it("escalates a finalize-incomplete caused by an INCOMPLETE receipt to finalize-blocked", () => {
    const r = makeFinalize(incompleteReceipt(), {}, strict);
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.finalize.strictOpenEscalated).toBe(true);
    expect(r.finalize.strictOpenEscalatedFrom).toBe("finalize-incomplete");
  });

  it("does NOT escalate a finalize-incomplete caused only by a required-missing record", () => {
    const r = makeFinalize(
      completedReceipt(),
      {},
      defaultPolicy({ strictOpen: true, require: { plan: false, trend: false, index: true, finalization: false } }),
    );
    expect(r.verdict).toBe("finalize-incomplete");
    expect(r.finalize.strictOpenEscalated).toBe(false);
  });

  it("leaves finalized / blocked / invalid untouched", () => {
    expect(makeFinalize(completedReceipt(), {}, strict).verdict).toBe("finalized");
    expect(makeFinalize(blockedReceipt(), {}, strict).verdict).toBe("finalize-blocked");
    expect(makeFinalize(notAReceipt(), {}, strict).verdict).toBe("finalize-invalid");
  });
});
