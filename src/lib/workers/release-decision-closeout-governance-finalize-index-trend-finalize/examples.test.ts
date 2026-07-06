// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-governance-finalize-index-trend-finalize example
 * fixtures under `docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize/`. It pins each
 * document to its schema, asserts it is content-free, and DRIVES the real finalize modules over each receipt (with
 * representative source-chain records + policy) to prove the documented finalization verdicts. Offline: it reads committed
 * files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFinalizeIndexTrendFinalizeResult } from "./build";
import {
  absentRecord,
  ingestFinalizeIndexTrendFinalizeReceipt,
  ingestRelated,
  type IngestedFinalizeIndexTrendFinalizeRelated,
} from "./ingest";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-governance-finalize-index-trend-finalize");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const RECEIPTS = [
  "receipt-completed.json",
  "receipt-incomplete.json",
  "receipt-blocked.json",
  "receipt-invalid.json",
  "receipt-advisory.json",
];
const SOURCE_FILES: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind, string[]> = {
  plan: ["plan-coherent.json", "plan-contradictory.json"],
  trend: ["trend-coherent.json", "trend-advisory.json"],
  index: ["index-coherent.json", "index-blocked.json"],
  finalization: ["finalization-coherent.json"],
};
const ALL_FILES = [
  ...RECEIPTS,
  "receipt-tampered.json",
  "not-a-receipt.json",
  ...Object.values(SOURCE_FILES).flat(),
];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the documents' own honesty caveats legitimately mention. Mirrors the upstream phase example sets.
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

const NO_REQUIRE = { plan: false, trend: false, index: false, finalization: false } as const;

/** The supplied source-chain records for a finalize run, by kind. */
type Inputs = Partial<Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind, string>>;

/** Drive the real finalize over committed fixtures and return its verdict + exit code. */
function finalizeOf(
  receiptFile: string,
  inputs: Inputs = {},
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy = { require: { ...NO_REQUIRE }, strictOpen: false },
): { verdict: string; exitCode: number } {
  const related: IngestedFinalizeIndexTrendFinalizeRelated[] = [];
  for (const kind of ["plan", "trend", "index", "finalization"] as const) {
    const file = inputs[kind];
    related.push(file === undefined ? absentRecord(kind) : ingestRelated(kind, readJson(file)));
  }
  const result = buildFinalizeIndexTrendFinalizeResult(
    "2026-07-06T00:00:00.000Z",
    { receipt: { supplied: true, ingested: ingestFinalizeIndexTrendFinalizeReceipt(readJson(receiptFile)) }, related },
    policy,
  );
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("finalize-index-trend-finalize examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of ALL_FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every receipt fixture carries the finalize-index-trend action-receipt schema; the decoy does not", () => {
    for (const f of RECEIPTS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1",
      );
    }
    expect((readJson("not-a-receipt.json") as { schema: string }).schema).not.toMatch(
      /finalize-index-trend-action-receipt/,
    );
  });

  it("the source-chain fixtures carry their expected upstream schemas", () => {
    const wantSchema: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind, string> = {
      plan: "pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1",
      trend: "pdfxyz.release-decision-closeout-governance-finalize-index-trend/1",
      index: "pdfxyz.release-decision-closeout-governance-finalize-index/1",
      finalization: "pdfxyz.release-decision-closeout-governance-finalize/1",
    };
    for (const kind of ["plan", "trend", "index", "finalization"] as const) {
      for (const f of SOURCE_FILES[kind]) {
        expect((readJson(f) as { schema: string }).schema, f).toBe(wantSchema[kind]);
      }
    }
  });
});

describe("finalize-index-trend-finalize examples — drive the documented verdicts", () => {
  it("a completed receipt alone → finalized (exit 0); with every coherent source too", () => {
    expect(finalizeOf("receipt-completed.json")).toEqual({ verdict: "finalized", exitCode: 0 });
    expect(
      finalizeOf("receipt-completed.json", {
        plan: "plan-coherent.json",
        trend: "trend-coherent.json",
        index: "index-coherent.json",
        finalization: "finalization-coherent.json",
      }),
    ).toEqual({ verdict: "finalized", exitCode: 0 });
  });

  it("an incomplete receipt → finalize-incomplete (exit 2)", () => {
    expect(finalizeOf("receipt-incomplete.json")).toEqual({ verdict: "finalize-incomplete", exitCode: 2 });
  });

  it("a blocked / invalid-verdict receipt → finalize-blocked (exit 4)", () => {
    expect(finalizeOf("receipt-blocked.json")).toEqual({ verdict: "finalize-blocked", exitCode: 4 });
    expect(finalizeOf("receipt-invalid.json")).toEqual({ verdict: "finalize-blocked", exitCode: 4 });
  });

  it("a tampered receipt or a non-receipt decoy → finalize-invalid (exit 4)", () => {
    expect(finalizeOf("receipt-tampered.json")).toEqual({ verdict: "finalize-invalid", exitCode: 4 });
    expect(finalizeOf("not-a-receipt.json")).toEqual({ verdict: "finalize-invalid", exitCode: 4 });
  });

  it("an advisory chain (a coherent degrading trend) → finalize-open (exit 3)", () => {
    expect(finalizeOf("receipt-advisory.json", { trend: "trend-advisory.json" })).toEqual({
      verdict: "finalize-open",
      exitCode: 3,
    });
  });

  it("a contradictory plan / index → finalize-blocked (exit 4)", () => {
    expect(finalizeOf("receipt-completed.json", { plan: "plan-contradictory.json" })).toEqual({
      verdict: "finalize-blocked",
      exitCode: 4,
    });
    expect(finalizeOf("receipt-completed.json", { trend: "trend-coherent.json", index: "index-blocked.json" })).toEqual({
      verdict: "finalize-blocked",
      exitCode: 4,
    });
  });

  it("a required-but-missing record → finalize-incomplete (exit 2)", () => {
    expect(
      finalizeOf("receipt-completed.json", {}, { require: { ...NO_REQUIRE, index: true }, strictOpen: false }),
    ).toEqual({ verdict: "finalize-incomplete", exitCode: 2 });
  });

  it("--strict-open escalates the advisory chain to finalize-blocked (exit 4); a clean finalize is untouched", () => {
    expect(finalizeOf("receipt-advisory.json", { trend: "trend-advisory.json" }, { require: { ...NO_REQUIRE }, strictOpen: true })).toEqual({
      verdict: "finalize-blocked",
      exitCode: 4,
    });
    expect(finalizeOf("receipt-completed.json", {}, { require: { ...NO_REQUIRE }, strictOpen: true })).toEqual({
      verdict: "finalized",
      exitCode: 0,
    });
  });
});
