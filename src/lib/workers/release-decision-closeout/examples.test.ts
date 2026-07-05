// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout example fixtures under
 * `docs/examples/release-decision-closeout/`. It pins each record to its schema, asserts it is content-free, and DRIVES
 * the real closeout modules over the primary receipts + related records to prove the documented closeout verdicts.
 * Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCloseoutResult } from "./build";
import { absentRecord, ingestReceipt, ingestRelated } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_RECORD_KINDS,
  type ReleaseDecisionCloseoutPolicy,
  type ReleaseDecisionCloseoutRecordKind,
  type ReleaseDecisionCloseoutVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const RECEIPTS = [
  "receipt-completed.json",
  "receipt-followup-open.json",
  "receipt-incomplete.json",
  "receipt-blocked.json",
  "receipt-tampered.json",
];
const RELATED = [
  "plan-coherent.json",
  "plan-contradictory.json",
  "plan-tampered.json",
  "trend-coherent.json",
  "trend-contradictory.json",
  "decision-proceed.json",
  "decision-reject.json",
  "index-coherent.json",
  "index-advisory.json",
];
const FILES = [...RECEIPTS, ...RELATED, "not-a-receipt.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the records' own honesty caveats legitimately mention. Mirrors the release-decision-action-receipt set.
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

/** The default (nothing required, no strict-open) closeout policy, with overrides. */
function policy(over: Partial<ReleaseDecisionCloseoutPolicy> = {}): ReleaseDecisionCloseoutPolicy {
  return { strictOpen: false, require: { plan: false, trend: false, decision: false, index: false }, ...over };
}

/** Drive the real closeout over committed fixtures and return its verdict + exit code. */
function closeoutFor(
  receiptFile: string,
  related: Partial<Record<ReleaseDecisionCloseoutRecordKind, string>> = {},
  pol = policy(),
): { verdict: ReleaseDecisionCloseoutVerdict; exitCode: number } {
  const records = RELEASE_DECISION_CLOSEOUT_RECORD_KINDS.map((kind) => {
    const file = related[kind];
    return file === undefined ? absentRecord(kind) : ingestRelated(kind, readJson(file));
  });
  const result = buildCloseoutResult(
    "2026-07-05T00:00:00.000Z",
    ingestReceipt(readJson(receiptFile)),
    records,
    pol,
  );
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("release-decision-closeout examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("each receipt fixture carries the action-receipt schema; the decoy does not", () => {
    for (const f of RECEIPTS) {
      expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-decision-action-receipt/1");
    }
    expect((readJson("not-a-receipt.json") as { schema: string }).schema).not.toMatch(/action-receipt/);
  });

  it("each related fixture carries the schema its kind expects", () => {
    const expectSchema: Record<string, string> = {
      "plan-coherent.json": "pdfxyz.release-decision-action-plan/1",
      "plan-contradictory.json": "pdfxyz.release-decision-action-plan/1",
      "plan-tampered.json": "pdfxyz.release-decision-action-plan/1",
      "trend-coherent.json": "pdfxyz.release-decision-trend/1",
      "trend-contradictory.json": "pdfxyz.release-decision-trend/1",
      "decision-proceed.json": "pdfxyz.release-decision/1",
      "decision-reject.json": "pdfxyz.release-decision/1",
      "index-coherent.json": "pdfxyz.release-decision-index/1",
      "index-advisory.json": "pdfxyz.release-decision-index/1",
    };
    for (const [f, schema] of Object.entries(expectSchema)) {
      expect((readJson(f) as { schema: string }).schema).toBe(schema);
    }
  });
});

describe("release-decision-closeout examples — drive the documented verdicts", () => {
  it("a completed receipt alone is closed (exit 0)", () => {
    expect(closeoutFor("receipt-completed.json")).toEqual({ verdict: "closed", exitCode: 0 });
  });

  it("the primary receipt's own state / verdict drives the baseline", () => {
    expect(closeoutFor("receipt-followup-open.json")).toEqual({ verdict: "closeout-open", exitCode: 3 });
    expect(closeoutFor("receipt-incomplete.json")).toEqual({ verdict: "closeout-incomplete", exitCode: 2 });
    expect(closeoutFor("receipt-blocked.json")).toEqual({ verdict: "closeout-blocked", exitCode: 4 });
    expect(closeoutFor("receipt-tampered.json")).toEqual({ verdict: "closeout-blocked", exitCode: 4 });
    expect(closeoutFor("not-a-receipt.json")).toEqual({ verdict: "closeout-incomplete", exitCode: 2 });
  });

  it("a coherent plan / trend keeps a completed receipt closed; a contradictory one blocks it", () => {
    expect(closeoutFor("receipt-completed.json", { plan: "plan-coherent.json" })).toEqual({
      verdict: "closed",
      exitCode: 0,
    });
    expect(closeoutFor("receipt-completed.json", { plan: "plan-contradictory.json" })).toEqual({
      verdict: "closeout-blocked",
      exitCode: 4,
    });
    expect(closeoutFor("receipt-completed.json", { trend: "trend-coherent.json" })).toEqual({
      verdict: "closed",
      exitCode: 0,
    });
    expect(closeoutFor("receipt-completed.json", { trend: "trend-contradictory.json" })).toEqual({
      verdict: "closeout-blocked",
      exitCode: 4,
    });
  });

  it("a tampered related record fails closed (exit 4); an unreadable optional record is incomplete (exit 2)", () => {
    expect(closeoutFor("receipt-completed.json", { plan: "plan-tampered.json" })).toEqual({
      verdict: "closeout-blocked",
      exitCode: 4,
    });
    expect(closeoutFor("receipt-completed.json", { index: "not-a-receipt.json" })).toEqual({
      verdict: "closeout-incomplete",
      exitCode: 2,
    });
  });

  it("decision / index source-chain postures fold: proceed/stable→closed, advisory→open, blocking→blocked", () => {
    expect(closeoutFor("receipt-completed.json", { decision: "decision-proceed.json" })).toEqual({
      verdict: "closed",
      exitCode: 0,
    });
    expect(closeoutFor("receipt-completed.json", { decision: "decision-reject.json" })).toEqual({
      verdict: "closeout-blocked",
      exitCode: 4,
    });
    expect(closeoutFor("receipt-completed.json", { index: "index-coherent.json" })).toEqual({
      verdict: "closed",
      exitCode: 0,
    });
    expect(closeoutFor("receipt-completed.json", { index: "index-advisory.json" })).toEqual({
      verdict: "closeout-open",
      exitCode: 3,
    });
  });

  it("--strict-open escalates an advisory / open closeout to blocked; a required-but-absent record is incomplete", () => {
    expect(
      closeoutFor("receipt-completed.json", { index: "index-advisory.json" }, policy({ strictOpen: true })),
    ).toEqual({ verdict: "closeout-blocked", exitCode: 4 });
    expect(
      closeoutFor("receipt-completed.json", {}, policy({ require: { plan: true, trend: false, decision: false, index: false } })),
    ).toEqual({ verdict: "closeout-incomplete", exitCode: 2 });
  });
});
