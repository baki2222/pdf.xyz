// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-governance example fixtures under
 * `docs/examples/release-decision-closeout-governance/`. It pins each record to its schema, asserts it is content-free,
 * and DRIVES the real bundle modules over the primary receipt (with representative related records + policy) to prove the
 * documented governance verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGovernanceResult } from "./build";
import {
  absentRecord,
  ingestCloseoutGovernanceReceipt,
  ingestRelated,
  type IngestedGovernanceRelatedRecord,
  type IngestedGovernanceSources,
} from "./ingest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_RECORD_KINDS,
  type ReleaseDecisionCloseoutGovernancePolicy,
  type ReleaseDecisionCloseoutGovernanceRecordKind,
  type ReleaseDecisionCloseoutGovernanceVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-governance");
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
  "closeout-coherent.json",
  "closeout-open.json",
];
const FILES = [...RECEIPTS, ...RELATED, "not-a-receipt.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the records' own honesty caveats legitimately mention. Mirrors the release-decision-closeout-action-receipt set.
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
type RelatedFiles = Partial<Record<ReleaseDecisionCloseoutGovernanceRecordKind, string>>;

function defaultPolicy(over: Partial<ReleaseDecisionCloseoutGovernancePolicy> = {}): ReleaseDecisionCloseoutGovernancePolicy {
  return { require: { plan: false, trend: false, index: false, closeout: false }, strictOpen: false, ...over };
}

/** Build the ingested sources from a committed receipt + related fixtures, then drive the real fold. */
function govern(
  receiptFile: string,
  related: RelatedFiles = {},
  policy: Partial<ReleaseDecisionCloseoutGovernancePolicy> = {},
): { verdict: ReleaseDecisionCloseoutGovernanceVerdict; exitCode: number } {
  const relatedIngested: IngestedGovernanceRelatedRecord[] = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_RECORD_KINDS.map(
    (kind) => {
      const file = related[kind];
      return file === undefined ? absentRecord(kind) : ingestRelated(kind, readJson(file));
    },
  );
  const sources: IngestedGovernanceSources = {
    receipt: { supplied: true, ingested: ingestCloseoutGovernanceReceipt(readJson(receiptFile)) },
    related: relatedIngested,
  };
  const result = buildGovernanceResult("2026-07-05T00:00:00.000Z", sources, defaultPolicy(policy));
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("release-decision-closeout-governance examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every receipt fixture carries the closeout-action-receipt schema; the decoy does not", () => {
    for (const f of RECEIPTS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-action-receipt/1",
      );
    }
    expect((readJson("not-a-receipt.json") as { schema: string }).schema).not.toMatch(
      /release-decision-closeout-action-receipt/,
    );
  });

  it("each related fixture carries its expected upstream schema", () => {
    const schemaOf = (f: string): string => (readJson(f) as { schema: string }).schema;
    expect(schemaOf("plan-coherent.json")).toBe("pdfxyz.release-decision-closeout-action-plan/1");
    expect(schemaOf("trend-coherent.json")).toBe("pdfxyz.release-decision-closeout-index-trend/1");
    expect(schemaOf("index-coherent.json")).toBe("pdfxyz.release-decision-closeout-index/1");
    expect(schemaOf("closeout-coherent.json")).toBe("pdfxyz.release-decision-closeout/1");
  });
});

describe("release-decision-closeout-governance examples — drive the documented verdicts", () => {
  it("the primary receipt alone folds its own verdict into the governance verdict", () => {
    expect(govern("receipt-completed.json")).toEqual({ verdict: "closed", exitCode: 0 });
    expect(govern("receipt-incomplete.json")).toEqual({ verdict: "governance-incomplete", exitCode: 2 });
    expect(govern("receipt-followup-open.json")).toEqual({ verdict: "governance-open", exitCode: 3 });
    expect(govern("receipt-blocked.json")).toEqual({ verdict: "governance-blocked", exitCode: 4 });
  });

  it("a tampered receipt is blocked (exit 4); a non-receipt decoy is incomplete (exit 2)", () => {
    expect(govern("receipt-tampered.json")).toEqual({ verdict: "governance-blocked", exitCode: 4 });
    expect(govern("not-a-receipt.json")).toEqual({ verdict: "governance-incomplete", exitCode: 2 });
  });

  it("a completed receipt + a fully coherent chain stays CLOSED (exit 0)", () => {
    expect(
      govern("receipt-completed.json", {
        plan: "plan-coherent.json",
        trend: "trend-coherent.json",
        index: "index-coherent.json",
        closeout: "closeout-coherent.json",
      }),
    ).toEqual({ verdict: "closed", exitCode: 0 });
  });

  it("a contradictory plan / trend is BLOCKED (exit 4)", () => {
    expect(govern("receipt-completed.json", { plan: "plan-contradictory.json" })).toEqual({
      verdict: "governance-blocked",
      exitCode: 4,
    });
    expect(govern("receipt-completed.json", { trend: "trend-contradictory.json" })).toEqual({
      verdict: "governance-blocked",
      exitCode: 4,
    });
  });

  it("a blocked source chain is BLOCKED (exit 4); an advisory source chain is OPEN (exit 3)", () => {
    expect(govern("receipt-completed.json", { index: "index-blocked.json" })).toEqual({
      verdict: "governance-blocked",
      exitCode: 4,
    });
    expect(govern("receipt-completed.json", { closeout: "closeout-open.json" })).toEqual({
      verdict: "governance-open",
      exitCode: 3,
    });
  });

  it("--require-<kind> without that record is INCOMPLETE (exit 2)", () => {
    expect(govern("receipt-completed.json", {}, { require: { plan: true, trend: false, index: false, closeout: false } })).toEqual(
      { verdict: "governance-incomplete", exitCode: 2 },
    );
  });

  it("--strict-open escalates an open governance to blocked (exit 4); a closed chain is untouched", () => {
    expect(govern("receipt-followup-open.json", {}, { strictOpen: true })).toEqual({
      verdict: "governance-blocked",
      exitCode: 4,
    });
    expect(govern("receipt-completed.json", {}, { strictOpen: true })).toEqual({
      verdict: "closed",
      exitCode: 0,
    });
  });
});
