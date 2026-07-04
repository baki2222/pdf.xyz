// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-trend example fixtures under `docs/examples/release-trend/`.
 * It pins each report to its schema, asserts it is content-free, and DRIVES the real trend modules over the
 * fixtures to prove the documented trend verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTrendResult } from "./build";
import { ingestReportsFrom, defaultPolicy } from "./fixtures";
import type { ReleaseTrendPolicy, ReleaseTrendVerdict } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-trend");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const REPORTS = [
  "report-promote-ready.json",
  "report-hold-warning.json",
  "report-needs-evidence.json",
  "report-hold-fail.json",
  "report-tampered.json",
];
const FILES = [...REPORTS, "not-a-report.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or
// "path", which the reports' own honesty caveats legitimately mention. Mirrors the release-report set.
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

/** Drive the real trend over a list of committed report fixtures and return the verdict. */
function trend(files: string[], policy: Partial<ReleaseTrendPolicy> = {}): ReleaseTrendVerdict {
  const ingested = ingestReportsFrom(files.map(readJson));
  return buildTrendResult("2026-07-04T00:00:00.000Z", ingested, defaultPolicy(policy)).trend.verdict;
}

describe("release-trend examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every report fixture parses and carries the release-report schema", () => {
    for (const f of REPORTS) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-report/1");
    expect((readJson("not-a-report.json") as { schema: string }).schema).not.toMatch(/release-report/);
  });
});

describe("release-trend examples — drive the documented verdicts", () => {
  const PR = "report-promote-ready.json";
  const HW = "report-hold-warning.json";
  const NE = "report-needs-evidence.json";
  const HF = "report-hold-fail.json";
  const TAMPERED = "report-tampered.json";
  const NOT = "not-a-report.json";

  it("a stable window of promote-ready reports is stable", () => {
    expect(trend([PR, PR, PR])).toBe("stable");
  });

  it("a hold-warning tip (with tolerated history) is a warning", () => {
    expect(trend([PR, HW], { maxHoldWarning: 5 })).toBe("warning");
  });

  it("a needs-evidence tip is unknown (insufficient)", () => {
    expect(trend([PR, NE])).toBe("unknown");
  });

  it("a hold-fail tip is failing", () => {
    expect(trend([PR, HF], { maxHoldFail: 5 })).toBe("failing");
  });

  it("a tampered report anywhere is failing (fail-closed)", () => {
    expect(trend([PR, TAMPERED, PR])).toBe("failing");
  });

  it("an unreadable report is unknown (insufficient, never a vacuous stable)", () => {
    expect(trend([PR, NOT, PR])).toBe("unknown");
  });

  it("--require-latest-ready escalates a non-ready tip to failing", () => {
    expect(trend([PR, HW], { maxHoldWarning: 5, requireLatestReady: true })).toBe("failing");
  });
});
