// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-governance-action-receipt example fixtures under
 * `docs/examples/release-decision-closeout-governance-action-receipt/`. It pins each plan to its schema, asserts it is
 * content-free, and DRIVES the real receipt modules over each plan (with representative acknowledgements) to prove the
 * documented receipt verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGovernanceActionReceiptResult } from "./build";
import { ingestGovernancePlan } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_ACK_IDS,
  type ReleaseDecisionCloseoutGovernanceActionReceiptAck,
  type ReleaseDecisionCloseoutGovernanceActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-governance-action-receipt");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const PLANS = [
  "plan-clear.json",
  "plan-investigate.json",
  "plan-monitor.json",
  "plan-block.json",
  "plan-reject-input.json",
  "plan-tampered.json",
];
const FILES = [...PLANS, "not-a-plan.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the plans' own honesty caveats legitimately mention. Mirrors the release-decision-closeout-governance-action-plan set.
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
  ids: (keyof ReleaseDecisionCloseoutGovernanceActionReceiptAck)[],
): ReleaseDecisionCloseoutGovernanceActionReceiptAck {
  const base: Record<keyof ReleaseDecisionCloseoutGovernanceActionReceiptAck, boolean> = {
    plan: false,
    executed: false,
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
  ack: (keyof ReleaseDecisionCloseoutGovernanceActionReceiptAck)[] = [],
  strictOpen = false,
): { verdict: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict; exitCode: number } {
  const policy: ReleaseDecisionCloseoutGovernanceActionReceiptPolicy = { strictOpen, ack: acksOf(ack) };
  const result = buildGovernanceActionReceiptResult(
    "2026-07-05T00:00:00.000Z",
    ingestGovernancePlan(readJson(file)),
    policy,
  );
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("release-decision-closeout-governance-action-receipt examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every plan fixture carries the release-decision-closeout-governance-action-plan schema; the decoy does not", () => {
    for (const f of PLANS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-governance-action-plan/1",
      );
    }
    expect((readJson("not-a-plan.json") as { schema: string }).schema).not.toMatch(
      /release-decision-closeout-governance-action-plan/,
    );
  });

  it("the ack id vocabulary matches the flags the fixtures document", () => {
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_ACK_IDS]).toEqual([
      "plan",
      "executed",
      "monitor",
      "investigation",
      "block",
    ]);
  });
});

describe("release-decision-closeout-governance-action-receipt examples — drive the documented verdicts", () => {
  it("a clear plan: unacked is incomplete (exit 2), reviewed is completed (exit 0)", () => {
    expect(receiptFor("plan-clear.json")).toEqual({ verdict: "incomplete", exitCode: 2 });
    expect(receiptFor("plan-clear.json", ["plan"])).toEqual({ verdict: "completed", exitCode: 0 });
  });

  it("an investigate plan: reviewed-but-unacked is incomplete (exit 2), fully acked is completed (exit 0)", () => {
    expect(receiptFor("plan-investigate.json", ["plan"])).toEqual({ verdict: "incomplete", exitCode: 2 });
    expect(receiptFor("plan-investigate.json", ["plan", "investigation", "executed"])).toEqual({
      verdict: "completed",
      exitCode: 0,
    });
  });

  it("a monitor plan: reviewed-but-unacked is followup-open (exit 3), fully acked is completed (exit 0)", () => {
    expect(receiptFor("plan-monitor.json", ["plan"])).toEqual({ verdict: "followup-open", exitCode: 3 });
    expect(receiptFor("plan-monitor.json", ["plan", "monitor", "executed"])).toEqual({
      verdict: "completed",
      exitCode: 0,
    });
  });

  it("a block plan: unacknowledged is blocked (exit 4), held-blocked-and-complete is completed (exit 0)", () => {
    for (const f of ["plan-block.json", "plan-reject-input.json"]) {
      expect(receiptFor(f)).toEqual({ verdict: "blocked", exitCode: 4 });
      expect(receiptFor(f, ["block"])).toEqual({ verdict: "incomplete", exitCode: 2 });
      expect(receiptFor(f, ["plan", "block", "executed"])).toEqual({ verdict: "completed", exitCode: 0 });
    }
  });

  it("a tampered plan is blocked (exit 4), even fully acknowledged; a non-plan decoy is blocked (exit 4)", () => {
    expect(receiptFor("plan-tampered.json", ["plan", "block", "executed"])).toEqual({
      verdict: "blocked",
      exitCode: 4,
    });
    expect(receiptFor("not-a-plan.json", ["plan"])).toEqual({ verdict: "blocked", exitCode: 4 });
  });

  it("a contradictory acknowledgement (ack-block on a clear plan) is blocked (exit 4)", () => {
    expect(receiptFor("plan-clear.json", ["plan", "block"])).toEqual({ verdict: "blocked", exitCode: 4 });
  });

  it("--strict-open escalates an open monitor follow-up to blocked (exit 4); a clean close-out is untouched", () => {
    expect(receiptFor("plan-monitor.json", ["plan"], true)).toEqual({ verdict: "blocked", exitCode: 4 });
    expect(receiptFor("plan-clear.json", ["plan"], true)).toEqual({ verdict: "completed", exitCode: 0 });
  });
});
