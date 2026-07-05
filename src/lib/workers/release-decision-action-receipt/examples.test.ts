// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-action-receipt example fixtures under
 * `docs/examples/release-decision-action-receipt/`. It pins each plan to its schema, asserts it is content-free, and
 * DRIVES the real receipt modules over each plan (with representative acknowledgements) to prove the documented receipt
 * verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildActionReceiptResult } from "./build";
import { ingestPlan } from "./ingest";
import {
  RELEASE_DECISION_ACTION_RECEIPT_ACK_IDS,
  type ReleaseDecisionActionReceiptAck,
  type ReleaseDecisionActionReceiptPolicy,
  type ReleaseDecisionActionReceiptVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-action-receipt");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const PLANS = [
  "plan-clear.json",
  "plan-monitor-watch.json",
  "plan-monitor-degrading.json",
  "plan-investigate.json",
  "plan-block.json",
  "plan-reject-input.json",
  "plan-tampered.json",
];
const FILES = [...PLANS, "not-a-plan.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the plans' own honesty caveats legitimately mention. Mirrors the release-decision-action-plan set.
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
function acksOf(ids: (keyof ReleaseDecisionActionReceiptAck)[]): ReleaseDecisionActionReceiptAck {
  const base: Record<keyof ReleaseDecisionActionReceiptAck, boolean> = {
    plan: false,
    followups: false,
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
  ack: (keyof ReleaseDecisionActionReceiptAck)[] = [],
  strictOpen = false,
): { verdict: ReleaseDecisionActionReceiptVerdict; exitCode: number } {
  const policy: ReleaseDecisionActionReceiptPolicy = { strictOpen, ack: acksOf(ack) };
  const result = buildActionReceiptResult("2026-07-05T00:00:00.000Z", ingestPlan(readJson(file)), policy);
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("release-decision-action-receipt examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every plan fixture carries the release-decision-action-plan schema; the decoy does not", () => {
    for (const f of PLANS) {
      expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-decision-action-plan/1");
    }
    expect((readJson("not-a-plan.json") as { schema: string }).schema).not.toMatch(
      /release-decision-action-plan/,
    );
  });

  it("the ack id vocabulary matches the flags the fixtures document", () => {
    expect([...RELEASE_DECISION_ACTION_RECEIPT_ACK_IDS]).toEqual([
      "plan",
      "followups",
      "monitor",
      "investigation",
      "block",
    ]);
  });
});

describe("release-decision-action-receipt examples — drive the documented verdicts", () => {
  it("a clear plan: unacked is incomplete (exit 2), reviewed is completed (exit 0)", () => {
    expect(receiptFor("plan-clear.json")).toEqual({ verdict: "incomplete", exitCode: 2 });
    expect(receiptFor("plan-clear.json", ["plan"])).toEqual({ verdict: "completed", exitCode: 0 });
  });

  it("a monitor plan: reviewed-but-unacked is followup-open (exit 3), fully acked is completed (exit 0)", () => {
    for (const f of ["plan-monitor-watch.json", "plan-monitor-degrading.json"]) {
      expect(receiptFor(f, ["plan"])).toEqual({ verdict: "followup-open", exitCode: 3 });
      expect(receiptFor(f, ["plan", "monitor", "followups"])).toEqual({ verdict: "completed", exitCode: 0 });
    }
  });

  it("an investigate plan: reviewed-but-unacked is followup-open (exit 3), fully acked is completed (exit 0)", () => {
    expect(receiptFor("plan-investigate.json", ["plan"])).toEqual({ verdict: "followup-open", exitCode: 3 });
    expect(receiptFor("plan-investigate.json", ["plan", "investigation", "followups"])).toEqual({
      verdict: "completed",
      exitCode: 0,
    });
  });

  it("a block plan: unacknowledged is blocked (exit 4), held-blocked-and-complete is completed (exit 0)", () => {
    for (const f of ["plan-block.json", "plan-reject-input.json"]) {
      expect(receiptFor(f)).toEqual({ verdict: "blocked", exitCode: 4 });
      expect(receiptFor(f, ["block"])).toEqual({ verdict: "incomplete", exitCode: 2 });
      expect(receiptFor(f, ["plan", "block", "followups"])).toEqual({ verdict: "completed", exitCode: 0 });
    }
  });

  it("a tampered plan is blocked (exit 4), even fully acknowledged; a non-plan decoy is incomplete (exit 2)", () => {
    expect(receiptFor("plan-tampered.json", ["plan", "block", "followups"])).toEqual({
      verdict: "blocked",
      exitCode: 4,
    });
    expect(receiptFor("not-a-plan.json", ["plan"])).toEqual({ verdict: "incomplete", exitCode: 2 });
  });

  it("a contradictory acknowledgement (ack-block on a clear plan) is blocked (exit 4)", () => {
    expect(receiptFor("plan-clear.json", ["plan", "block"])).toEqual({ verdict: "blocked", exitCode: 4 });
  });

  it("--strict-open escalates an open follow-up to blocked (exit 4); a clean close-out is untouched", () => {
    expect(receiptFor("plan-monitor-watch.json", ["plan"], true)).toEqual({ verdict: "blocked", exitCode: 4 });
    expect(receiptFor("plan-clear.json", ["plan"], true)).toEqual({ verdict: "completed", exitCode: 0 });
  });
});
