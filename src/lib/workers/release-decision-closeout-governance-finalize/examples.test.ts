// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-governance-finalize example fixtures under
 * `docs/examples/release-decision-closeout-governance-finalize/`. It pins each record to its schema, asserts it is
 * content-free, and DRIVES the real bundle modules over the primary receipt (with representative related records +
 * policy) to prove the documented finalization verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGovernanceFinalizeResult } from "./build";
import {
  absentRecord,
  ingestGovernanceFinalizeReceipt,
  ingestRelated,
  type IngestedGovernanceFinalizeRelatedRecord,
  type IngestedGovernanceFinalizeSources,
} from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS,
  type ReleaseDecisionCloseoutGovernanceFinalizePolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-governance-finalize");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const RECEIPTS = [
  "receipt-completed.json",
  "receipt-incomplete.json",
  "receipt-followup-open.json",
  "receipt-blocked.json",
  "receipt-tampered.json",
];
const RELATED = [
  "plan-coherent.json",
  "plan-contradictory.json",
  "trend-coherent.json",
  "trend-contradictory.json",
  "index-coherent.json",
  "index-blocked.json",
  "governance-coherent.json",
  "governance-open.json",
];
const FILES = [...RECEIPTS, ...RELATED, "not-a-receipt.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the records' own honesty caveats legitimately mention. Mirrors the release-decision-closeout-governance set.
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

/** The related-record slot → committed fixture file used in the driven-verdict cases. */
type RelatedFiles = Partial<Record<ReleaseDecisionCloseoutGovernanceFinalizeRecordKind, string>>;

function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizePolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizePolicy {
  return { require: { plan: false, trend: false, index: false, governance: false }, strictOpen: false, ...over };
}

/** Build the ingested sources from a committed receipt + related fixtures, then drive the real fold. */
function finalize(
  receiptFile: string,
  related: RelatedFiles = {},
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizePolicy> = {},
): { verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict; exitCode: number } {
  const relatedIngested: IngestedGovernanceFinalizeRelatedRecord[] =
    RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_RECORD_KINDS.map((kind) => {
      const file = related[kind];
      return file === undefined ? absentRecord(kind) : ingestRelated(kind, readJson(file));
    });
  const sources: IngestedGovernanceFinalizeSources = {
    receipt: { supplied: true, ingested: ingestGovernanceFinalizeReceipt(readJson(receiptFile)) },
    related: relatedIngested,
  };
  const result = buildGovernanceFinalizeResult("2026-07-05T00:00:00.000Z", sources, defaultPolicy(policy));
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("release-decision-closeout-governance-finalize examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every receipt fixture carries the governance-action-receipt schema; the decoy does not", () => {
    for (const f of RECEIPTS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-governance-action-receipt/1",
      );
    }
    expect((readJson("not-a-receipt.json") as { schema: string }).schema).not.toMatch(
      /release-decision-closeout-governance-action-receipt/,
    );
  });

  it("each related fixture carries its expected upstream schema", () => {
    const schemaOf = (f: string): string => (readJson(f) as { schema: string }).schema;
    expect(schemaOf("plan-coherent.json")).toBe("pdfxyz.release-decision-closeout-governance-action-plan/1");
    expect(schemaOf("trend-coherent.json")).toBe("pdfxyz.release-decision-closeout-governance-index-trend/1");
    expect(schemaOf("index-coherent.json")).toBe("pdfxyz.release-decision-closeout-governance-index/1");
    expect(schemaOf("governance-coherent.json")).toBe("pdfxyz.release-decision-closeout-governance/1");
  });
});

describe("release-decision-closeout-governance-finalize examples — drive the documented verdicts", () => {
  it("the primary receipt alone folds its own verdict into the finalization verdict", () => {
    expect(finalize("receipt-completed.json")).toEqual({ verdict: "finalized", exitCode: 0 });
    expect(finalize("receipt-incomplete.json")).toEqual({ verdict: "finalize-incomplete", exitCode: 2 });
    expect(finalize("receipt-followup-open.json")).toEqual({ verdict: "finalize-open", exitCode: 3 });
    expect(finalize("receipt-blocked.json")).toEqual({ verdict: "finalize-blocked", exitCode: 4 });
  });

  it("a tampered receipt is blocked (exit 4); a non-receipt decoy is incomplete (exit 2)", () => {
    expect(finalize("receipt-tampered.json")).toEqual({ verdict: "finalize-blocked", exitCode: 4 });
    expect(finalize("not-a-receipt.json")).toEqual({ verdict: "finalize-incomplete", exitCode: 2 });
  });

  it("a completed receipt + a fully coherent chain stays FINALIZED (exit 0)", () => {
    expect(
      finalize("receipt-completed.json", {
        plan: "plan-coherent.json",
        trend: "trend-coherent.json",
        index: "index-coherent.json",
        governance: "governance-coherent.json",
      }),
    ).toEqual({ verdict: "finalized", exitCode: 0 });
  });

  it("a contradictory plan / trend is BLOCKED (exit 4)", () => {
    expect(finalize("receipt-completed.json", { plan: "plan-contradictory.json" })).toEqual({
      verdict: "finalize-blocked",
      exitCode: 4,
    });
    expect(finalize("receipt-completed.json", { trend: "trend-contradictory.json" })).toEqual({
      verdict: "finalize-blocked",
      exitCode: 4,
    });
  });

  it("a blocked source chain is BLOCKED (exit 4); an advisory source chain is OPEN (exit 3)", () => {
    expect(finalize("receipt-completed.json", { index: "index-blocked.json" })).toEqual({
      verdict: "finalize-blocked",
      exitCode: 4,
    });
    expect(finalize("receipt-completed.json", { governance: "governance-open.json" })).toEqual({
      verdict: "finalize-open",
      exitCode: 3,
    });
  });

  it("--require-<kind> without that record is INCOMPLETE (exit 2)", () => {
    expect(
      finalize(
        "receipt-completed.json",
        {},
        { require: { plan: true, trend: false, index: false, governance: false } },
      ),
    ).toEqual({ verdict: "finalize-incomplete", exitCode: 2 });
  });

  it("--strict-open escalates an open finalization to blocked (exit 4); a finalized chain is untouched", () => {
    expect(finalize("receipt-followup-open.json", {}, { strictOpen: true })).toEqual({
      verdict: "finalize-blocked",
      exitCode: 4,
    });
    expect(finalize("receipt-completed.json", {}, { strictOpen: true })).toEqual({
      verdict: "finalized",
      exitCode: 0,
    });
  });
});
