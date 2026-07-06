// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-governance-finalize-index-trend-action-plan example
 * fixtures under `docs/examples/release-decision-closeout-governance-finalize-index-trend-action-plan/`. It pins each
 * trend to its schema, asserts it is content-free, and DRIVES the real plan modules over each trend to prove the
 * documented plan verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFinalizeIndexTrendActionPlanResult } from "./build";
import { defaultPolicy } from "./fixtures";
import { ingestFinalizeIndexTrend } from "./ingest";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-governance-finalize-index-trend-action-plan");
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
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanPolicy> = {},
): { verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict; exitCode: number } {
  const result = buildFinalizeIndexTrendActionPlanResult(
    "2026-07-05T00:00:00.000Z",
    ingestFinalizeIndexTrend(readJson(file)),
    defaultPolicy(policy),
  );
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("finalize-index-trend-action-plan examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every trend fixture carries the finalize-index-trend schema; the decoy does not", () => {
    for (const f of TRENDS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend/1",
      );
    }
    expect((readJson("not-a-trend.json") as { schema: string }).schema).not.toMatch(/finalize-index-trend/);
  });
});

describe("finalize-index-trend-action-plan examples — drive the documented verdicts", () => {
  it("a coherent stable / improving trend is a clear plan (exit 0)", () => {
    expect(planFor("trend-stable.json")).toEqual({ verdict: "clear", exitCode: 0 });
    expect(planFor("trend-improving.json")).toEqual({ verdict: "clear", exitCode: 0 });
  });

  it("an insufficient trend is an investigate plan (exit 2)", () => {
    expect(planFor("trend-insufficient.json")).toEqual({ verdict: "investigate", exitCode: 2 });
  });

  it("a watch / degrading trend is a follow-up monitor plan (exit 3)", () => {
    expect(planFor("trend-watch.json")).toEqual({ verdict: "monitor", exitCode: 3 });
    expect(planFor("trend-degrading.json")).toEqual({ verdict: "monitor", exitCode: 3 });
  });

  it("a blocked / invalid-history trend is a block-release plan (exit 4)", () => {
    expect(planFor("trend-blocked.json")).toEqual({ verdict: "block-release", exitCode: 4 });
    expect(planFor("trend-invalid.json")).toEqual({ verdict: "block-release", exitCode: 4 });
  });

  it("a non-trend decoy is an invalid plan (exit 4), never a vacuous clear plan", () => {
    expect(planFor("not-a-trend.json")).toEqual({ verdict: "invalid", exitCode: 4 });
  });

  it("--strict-watch escalates a monitor trend to block-release; a stable one is untouched; investigate is untouched", () => {
    expect(planFor("trend-watch.json", { strictWatch: true })).toEqual({ verdict: "block-release", exitCode: 4 });
    expect(planFor("trend-stable.json", { strictWatch: true })).toEqual({ verdict: "clear", exitCode: 0 });
    expect(planFor("trend-insufficient.json", { strictWatch: true })).toEqual({ verdict: "investigate", exitCode: 2 });
  });

  it("--require-clean escalates every non-clear trend to block-release; a stable / improving one is untouched", () => {
    expect(planFor("trend-watch.json", { requireClean: true })).toEqual({ verdict: "block-release", exitCode: 4 });
    expect(planFor("trend-insufficient.json", { requireClean: true })).toEqual({
      verdict: "block-release",
      exitCode: 4,
    });
    expect(planFor("trend-stable.json", { requireClean: true })).toEqual({ verdict: "clear", exitCode: 0 });
    expect(planFor("trend-improving.json", { requireClean: true })).toEqual({ verdict: "clear", exitCode: 0 });
    // A non-trend decoy stays INVALID — --require-clean never weakens the invalid precedence.
    expect(planFor("not-a-trend.json", { requireClean: true })).toEqual({ verdict: "invalid", exitCode: 4 });
  });
});
