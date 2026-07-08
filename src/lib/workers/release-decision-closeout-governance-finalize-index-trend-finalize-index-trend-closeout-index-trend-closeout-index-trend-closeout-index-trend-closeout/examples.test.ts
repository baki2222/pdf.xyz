// @vitest-environment node
/**
 * Static, no-secret proof for the committed example fixtures under
 * `docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/`. It pins each
 * record to its schema, asserts it is content-free, and DRIVES the real closeout modules over the primary receipts +
 * related records to prove the documented closeout verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCloseoutResult } from "./build";
import { absentRecord, ingestReceipt, ingestRelated } from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "./types";

const DIR = join(
  process.cwd(),
  "docs",
  "examples",
  "release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout",
);
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const RECEIPTS = [
  "receipt-completed.json",
  "receipt-followup-open.json",
  "receipt-incomplete.json",
  "receipt-blocked.json",
  "receipt-invalid.json",
  "receipt-tampered.json",
];
const RELATED = [
  "plan-coherent.json",
  "plan-contradictory.json",
  "plan-tampered.json",
  "trend-coherent.json",
  "trend-contradictory.json",
];
const FILES = [...RECEIPTS, ...RELATED, "not-a-receipt.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the records' own honesty caveats legitimately mention.
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
function policy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPolicy {
  return { strictOpen: false, require: { plan: false, trend: false }, ...over };
}

/** Drive the real closeout over committed fixtures and return its verdict + exit code. */
function closeoutFor(
  receiptFile: string,
  related: Partial<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind, string>> = {},
  pol = policy(),
): { verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict; exitCode: number } {
  const records = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_RECORD_KINDS.map(
    (kind) => {
      const file = related[kind];
      return file === undefined ? absentRecord(kind) : ingestRelated(kind, readJson(file));
    },
  );
  const result = buildCloseoutResult(
    "2026-07-05T00:00:00.000Z",
    ingestReceipt(readJson(receiptFile)),
    records,
    pol,
  );
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("release-decision-closeout-…-closeout-index-trend-closeout examples — content-free + parseable", () => {
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
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1",
      );
    }
    expect((readJson("not-a-receipt.json") as { schema: string }).schema).not.toMatch(/action-receipt/);
  });

  it("each related fixture carries the schema its kind expects", () => {
    const expectSchema: Record<string, string> = {
      "plan-coherent.json": "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1",
      "plan-contradictory.json": "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1",
      "plan-tampered.json": "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1",
      "trend-coherent.json": "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1",
      "trend-contradictory.json": "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1",
    };
    for (const [f, schema] of Object.entries(expectSchema)) {
      expect((readJson(f) as { schema: string }).schema).toBe(schema);
    }
  });
});

describe("release-decision-closeout-…-closeout-index-trend-closeout examples — drive the documented verdicts", () => {
  it("a completed receipt alone is closed (exit 0)", () => {
    expect(closeoutFor("receipt-completed.json")).toEqual({ verdict: "closed", exitCode: 0 });
  });

  it("the primary receipt's own state / verdict drives the baseline", () => {
    expect(closeoutFor("receipt-followup-open.json")).toEqual({ verdict: "open", exitCode: 3 });
    expect(closeoutFor("receipt-incomplete.json")).toEqual({ verdict: "incomplete", exitCode: 2 });
    expect(closeoutFor("receipt-blocked.json")).toEqual({ verdict: "blocked", exitCode: 4 });
    expect(closeoutFor("receipt-invalid.json")).toEqual({ verdict: "invalid", exitCode: 4 });
    expect(closeoutFor("receipt-tampered.json")).toEqual({ verdict: "invalid", exitCode: 4 });
    expect(closeoutFor("not-a-receipt.json")).toEqual({ verdict: "invalid", exitCode: 4 });
  });

  it("a coherent plan / trend keeps a completed receipt closed; a contradictory one is invalid (incoherent chain)", () => {
    expect(closeoutFor("receipt-completed.json", { plan: "plan-coherent.json" })).toEqual({
      verdict: "closed",
      exitCode: 0,
    });
    expect(closeoutFor("receipt-completed.json", { plan: "plan-contradictory.json" })).toEqual({
      verdict: "invalid",
      exitCode: 4,
    });
    expect(closeoutFor("receipt-completed.json", { trend: "trend-coherent.json" })).toEqual({
      verdict: "closed",
      exitCode: 0,
    });
    expect(closeoutFor("receipt-completed.json", { trend: "trend-contradictory.json" })).toEqual({
      verdict: "invalid",
      exitCode: 4,
    });
  });

  it("a tampered or unreadable related record fails closed as invalid (exit 4); it is never a closed closeout", () => {
    expect(closeoutFor("receipt-completed.json", { plan: "plan-tampered.json" })).toEqual({
      verdict: "invalid",
      exitCode: 4,
    });
    expect(closeoutFor("receipt-completed.json", { trend: "not-a-receipt.json" })).toEqual({
      verdict: "invalid",
      exitCode: 4,
    });
  });

  it("--strict-open escalates an open closeout to blocked; a required-but-absent record is incomplete", () => {
    expect(
      closeoutFor("receipt-followup-open.json", {}, policy({ strictOpen: true })),
    ).toEqual({ verdict: "blocked", exitCode: 4 });
    expect(
      closeoutFor("receipt-completed.json", {}, policy({ require: { plan: true, trend: false } })),
    ).toEqual({ verdict: "incomplete", exitCode: 2 });
  });
});
