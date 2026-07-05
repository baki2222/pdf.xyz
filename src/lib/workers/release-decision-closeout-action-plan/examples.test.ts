// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-action-plan example fixtures under
 * `docs/examples/release-decision-closeout-action-plan/`. It pins each trend to its schema, asserts it is content-free,
 * and DRIVES the real plan modules over each trend to prove the documented plan verdicts. Offline: it reads committed
 * files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCloseoutActionPlanResult } from "./build";
import { defaultPolicy } from "./fixtures";
import { ingestCloseoutTrend } from "./ingest";
import type {
  ReleaseDecisionCloseoutActionPlanPolicy,
  ReleaseDecisionCloseoutActionPlanVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-action-plan");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const TRENDS = ["trend-stable.json", "trend-incomplete.json", "trend-watch.json", "trend-blocked.json"];
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
  policy: Partial<ReleaseDecisionCloseoutActionPlanPolicy> = {},
): { verdict: ReleaseDecisionCloseoutActionPlanVerdict; exitCode: number } {
  const result = buildCloseoutActionPlanResult(
    "2026-07-05T00:00:00.000Z",
    ingestCloseoutTrend(readJson(file)),
    defaultPolicy(policy),
  );
  return { verdict: result.verdict, exitCode: result.exitCode };
}

describe("release-decision-closeout-action-plan examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every trend fixture carries the closeout-index-trend schema; the decoy does not", () => {
    for (const f of TRENDS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-index-trend/1",
      );
    }
    expect((readJson("not-a-trend.json") as { schema: string }).schema).not.toMatch(/release-decision/);
  });
});

describe("release-decision-closeout-action-plan examples — drive the documented verdicts", () => {
  it("a coherent stable trend is a clear plan (exit 0)", () => {
    expect(planFor("trend-stable.json")).toEqual({ verdict: "clear", exitCode: 0 });
  });

  it("an incomplete trend is an investigate plan (exit 2)", () => {
    expect(planFor("trend-incomplete.json")).toEqual({ verdict: "investigate", exitCode: 2 });
  });

  it("a watch / degrading trend is a follow-up monitor plan (exit 3)", () => {
    expect(planFor("trend-watch.json")).toEqual({ verdict: "monitor", exitCode: 3 });
  });

  it("a blocked trend is a block-release plan (exit 4)", () => {
    expect(planFor("trend-blocked.json")).toEqual({ verdict: "block-release", exitCode: 4 });
  });

  it("a non-trend decoy is a block-release plan (exit 4), never a vacuous clear plan", () => {
    expect(planFor("not-a-trend.json")).toEqual({ verdict: "block-release", exitCode: 4 });
  });

  it("--strict-watch escalates a watch trend to block-release; a stable one is untouched", () => {
    expect(planFor("trend-watch.json", { strictWatch: true })).toEqual({
      verdict: "block-release",
      exitCode: 4,
    });
    expect(planFor("trend-stable.json", { strictWatch: true })).toEqual({ verdict: "clear", exitCode: 0 });
    // A --strict-watch run never escalates an investigate plan (only a monitor one).
    expect(planFor("trend-incomplete.json", { strictWatch: true })).toEqual({
      verdict: "investigate",
      exitCode: 2,
    });
  });
});
