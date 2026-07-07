// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-…-closeout-index-trend-closeout-index-trend-action-plan example
 * fixtures under
 * `docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/`.
 * It pins each trend to its schema, asserts it is content-free, and DRIVES the real plan modules over each trend to prove
 * the documented plan verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCloseoutIndexTrendActionPlanResult } from "./build";
import { defaultPolicy } from "./fixtures";
import { ingestCloseoutIndexTrend } from "./ingest";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
} from "./types";

const DIR = join(
  process.cwd(),
  "docs",
  "examples",
  "release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan",
);
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const TRENDS = [
  "trend-stable.json",
  "trend-improving.json",
  "trend-watch.json",
  "trend-degrading.json",
  "trend-insufficient.json",
  "trend-blocked.json",
  "trend-invalid.json",
];
const FILES = [...TRENDS, "not-a-trend.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the trends' own honesty caveats legitimately mention.
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

/** Drive the real plan over a committed trend fixture and return its verdict + exit code. */
function planFor(
  file: string,
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy> = {},
): { verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict; exitCode: number } {
  const result = buildCloseoutIndexTrendActionPlanResult(
    "2026-07-05T00:00:00.000Z",
    ingestCloseoutIndexTrend(readJson(file)),
    defaultPolicy(policy),
  );
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("closeout-index-trend-closeout-index-trend-action-plan examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every trend fixture carries the closeout-index-trend-closeout-index-trend schema; the decoy does not", () => {
    for (const f of TRENDS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1",
      );
    }
    expect((readJson("not-a-trend.json") as { schema: string }).schema).not.toMatch(/closeout-index-trend/);
  });
});

describe("closeout-index-trend-closeout-index-trend-action-plan examples — drive the documented verdicts", () => {
  it("a coherent stable trend is a clear plan (exit 0)", () => {
    expect(planFor("trend-stable.json")).toEqual({ verdict: "clear", exitCode: 0 });
  });

  it("an improving trend is a benign monitor plan (exit 3), never a clear or a block by default", () => {
    expect(planFor("trend-improving.json")).toEqual({ verdict: "monitor", exitCode: 3 });
  });

  it("an insufficient trend is an investigate plan (exit 2)", () => {
    expect(planFor("trend-insufficient.json")).toEqual({ verdict: "investigate", exitCode: 2 });
  });

  it("a watch / degrading trend is a follow-up monitor plan (exit 3)", () => {
    expect(planFor("trend-watch.json")).toEqual({ verdict: "monitor", exitCode: 3 });
    expect(planFor("trend-degrading.json")).toEqual({ verdict: "monitor", exitCode: 3 });
  });

  it("a blocked trend is a block-release plan (exit 4)", () => {
    expect(planFor("trend-blocked.json")).toEqual({ verdict: "block-release", exitCode: 4 });
  });

  it("a trend whose OWN verdict is invalid is an invalid plan (exit 4), and so is a non-trend decoy", () => {
    expect(planFor("trend-invalid.json")).toEqual({ verdict: "invalid", exitCode: 4 });
    expect(planFor("not-a-trend.json")).toEqual({ verdict: "invalid", exitCode: 4 });
  });

  it("--strict escalates every non-clear (monitor / investigate) trend to block-release; stable / invalid are untouched", () => {
    expect(planFor("trend-improving.json", { strict: true })).toEqual({ verdict: "block-release", exitCode: 4 });
    expect(planFor("trend-watch.json", { strict: true })).toEqual({ verdict: "block-release", exitCode: 4 });
    expect(planFor("trend-insufficient.json", { strict: true })).toEqual({ verdict: "block-release", exitCode: 4 });
    // A coherent stable trend stays clear; --strict never fabricates a block.
    expect(planFor("trend-stable.json", { strict: true })).toEqual({ verdict: "clear", exitCode: 0 });
    // An invalid-history trend / non-trend decoy stays INVALID — --strict never weakens the invalid precedence.
    expect(planFor("trend-invalid.json", { strict: true })).toEqual({ verdict: "invalid", exitCode: 4 });
    expect(planFor("not-a-trend.json", { strict: true })).toEqual({ verdict: "invalid", exitCode: 4 });
  });
});
