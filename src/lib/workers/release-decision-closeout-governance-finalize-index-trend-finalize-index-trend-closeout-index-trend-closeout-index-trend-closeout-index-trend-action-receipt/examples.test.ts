// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt
 * example fixtures under `docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/`. It
 * pins each plan to its schema, asserts it is content-free, and DRIVES the real receipt modules over each plan (with
 * representative acknowledgements) to prove the documented receipt verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptResult } from "./build";
import { ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAck,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict,
} from "./types";

const DIR = join(
  process.cwd(),
  "docs",
  "examples",
  "release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt",
);
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const PLANS = [
  "plan-clear.json",
  "plan-monitor.json",
  "plan-investigate.json",
  "plan-block.json",
  "plan-invalid.json",
  "plan-tampered.json",
];
const FILES = [...PLANS, "not-a-plan.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the plans' own honesty caveats legitimately mention. Mirrors the finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan set.
const FORBIDDEN = [
  "amazonaws",
  "akia",
  "://",
  "us-east-1",
  "upstash",
  "cloudflarestorage",
  "/tmp/",
  "customer",
  ".pdf",
  "bearer ",
  "secretaccesskey",
];

/** Build a bounded ack set with the named ids set true. */
function acksOf(
  ids: (keyof ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAck)[],
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAck {
  const base: Record<keyof ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAck, boolean> = {
    plan: false,
    clear: false,
    monitor: false,
    investigation: false,
    block: false,
  };
  for (const id of ids) base[id] = true;
  return base;
}

/** Drive the real receipt over a committed plan fixture and return its verdict + exit code. */
function receiptFor(
  file: string,
  ack: (keyof ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAck)[] = [],
  strictOpen = false,
): { verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptVerdict; exitCode: number } {
  const policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy = {
    strictOpen,
    ack: acksOf(ack),
  };
  const result = buildFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptResult(
    "2026-07-06T00:00:00.000Z",
    ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(readJson(file)),
    policy,
  );
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every plan fixture carries the finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend action-plan schema; the decoy does not", () => {
    for (const f of PLANS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1",
      );
    }
    expect((readJson("not-a-plan.json") as { schema: string }).schema).not.toMatch(
      /release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/,
    );
  });

  it("the ack id vocabulary matches the flags the fixtures document", () => {
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS]).toEqual([
      "plan",
      "clear",
      "monitor",
      "investigation",
      "block",
    ]);
  });
});

describe("finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt examples — drive the documented verdicts", () => {
  it("a clear plan: unacked is incomplete (exit 2), reviewed-but-unaccepted is incomplete (exit 2), accepted is completed (exit 0)", () => {
    expect(receiptFor("plan-clear.json")).toEqual({ verdict: "incomplete", exitCode: 2 });
    expect(receiptFor("plan-clear.json", ["plan"])).toEqual({ verdict: "incomplete", exitCode: 2 });
    expect(receiptFor("plan-clear.json", ["plan", "clear"])).toEqual({ verdict: "completed", exitCode: 0 });
  });

  it("a monitor plan: reviewed-but-unacked is followup-open (exit 3), fully acked is completed (exit 0)", () => {
    expect(receiptFor("plan-monitor.json", ["plan"])).toEqual({ verdict: "followup-open", exitCode: 3 });
    expect(receiptFor("plan-monitor.json", ["plan", "monitor"])).toEqual({
      verdict: "completed",
      exitCode: 0,
    });
  });

  it("an investigate plan: reviewed-but-unacked is followup-open (exit 3), fully acked is completed (exit 0)", () => {
    expect(receiptFor("plan-investigate.json", ["plan"])).toEqual({ verdict: "followup-open", exitCode: 3 });
    expect(receiptFor("plan-investigate.json", ["plan", "investigation"])).toEqual({
      verdict: "completed",
      exitCode: 0,
    });
  });

  it("a block plan: unacknowledged is blocked (exit 4), held is incomplete (exit 2), fully acked is completed (exit 0, release held)", () => {
    expect(receiptFor("plan-block.json")).toEqual({ verdict: "blocked", exitCode: 4 });
    expect(receiptFor("plan-block.json", ["block"])).toEqual({ verdict: "incomplete", exitCode: 2 });
    expect(receiptFor("plan-block.json", ["plan", "block"])).toEqual({ verdict: "completed", exitCode: 0 });
  });

  it("a plan whose own verdict is invalid is a BLOCK-class hold: unacknowledged is blocked (exit 4), fully acked is completed (exit 0)", () => {
    expect(receiptFor("plan-invalid.json")).toEqual({ verdict: "blocked", exitCode: 4 });
    expect(receiptFor("plan-invalid.json", ["plan", "block"])).toEqual({
      verdict: "completed",
      exitCode: 0,
    });
  });

  it("a tampered plan is invalid (exit 4), even fully acknowledged; a non-plan decoy is invalid (exit 4)", () => {
    expect(receiptFor("plan-tampered.json", ["plan", "monitor"])).toEqual({
      verdict: "invalid",
      exitCode: 4,
    });
    expect(receiptFor("not-a-plan.json", ["plan"])).toEqual({ verdict: "invalid", exitCode: 4 });
  });

  it("a contradictory acknowledgement (ack-block on a clear plan) is blocked (exit 4)", () => {
    expect(receiptFor("plan-clear.json", ["plan", "clear", "block"])).toEqual({ verdict: "blocked", exitCode: 4 });
  });

  it("--strict-open escalates an open monitor follow-up to blocked (exit 4); a clean close-out is untouched", () => {
    expect(receiptFor("plan-monitor.json", ["plan"], true)).toEqual({ verdict: "blocked", exitCode: 4 });
    expect(receiptFor("plan-clear.json", ["plan", "clear"], true)).toEqual({ verdict: "completed", exitCode: 0 });
  });
});
