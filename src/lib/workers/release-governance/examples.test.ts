// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-governance example fixtures under
 * `docs/examples/release-governance/`. It pins each document to its schema, asserts it is content-free, and
 * DRIVES the real governance modules over the fixtures to prove the documented verdicts. Offline: it reads
 * committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGovernanceResult } from "./build";
import { defaultPolicy, ingestGovernanceFrom, type GovernanceObjects } from "./fixtures";
import type { ReleaseGovernancePolicy, ReleaseGovernanceVerdict } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-governance");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const TRENDS = ["trend-stable.json", "trend-warning.json", "trend-unknown.json", "trend-failing.json", "trend-tampered.json"];
const REPORTS = ["report-promote-ready.json", "report-hold-fail.json"];
const AUDITS = ["audit-pass.json", "audit-fail.json"];
const FILES = [...TRENDS, ...REPORTS, ...AUDITS, "not-a-document.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or
// "path", which the documents' own honesty caveats legitimately mention. Mirrors the release-trend set.
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

/** Drive the real governance bundle over a set of committed fixtures and return the verdict. */
function governance(objs: {
  trend?: string;
  report?: string;
  audit?: string;
}, policy: Partial<ReleaseGovernancePolicy> = {}): ReleaseGovernanceVerdict {
  const built: GovernanceObjects = {
    ...(objs.trend !== undefined ? { trend: readJson(objs.trend) } : {}),
    ...(objs.report !== undefined ? { report: readJson(objs.report) } : {}),
    ...(objs.audit !== undefined ? { audit: readJson(objs.audit) } : {}),
  };
  return buildGovernanceResult("2026-07-04T00:00:00.000Z", ingestGovernanceFrom(built), defaultPolicy(policy))
    .governance.verdict;
}

describe("release-governance examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("each fixture carries its expected upstream schema", () => {
    for (const f of TRENDS) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-trend/1");
    for (const f of REPORTS) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-report/1");
    for (const f of AUDITS) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-audit/1");
    expect((readJson("not-a-document.json") as { schema: string }).schema).not.toMatch(/release-/);
  });
});

describe("release-governance examples — drive the documented verdicts", () => {
  it("a stable trend (with clean latest) is healthy", () => {
    expect(governance({ trend: "trend-stable.json" })).toBe("healthy");
    expect(
      governance({ trend: "trend-stable.json", report: "report-promote-ready.json", audit: "audit-pass.json" }),
    ).toBe("healthy");
  });

  it("a warning trend is a watch", () => {
    expect(governance({ trend: "trend-warning.json" })).toBe("watch");
  });

  it("an unknown trend is incomplete (insufficient)", () => {
    expect(governance({ trend: "trend-unknown.json" })).toBe("incomplete");
  });

  it("a missing trend (report only) is incomplete, never a vacuous healthy", () => {
    expect(governance({ report: "report-promote-ready.json" })).toBe("incomplete");
  });

  it("a failing trend is blocked", () => {
    expect(governance({ trend: "trend-failing.json" })).toBe("blocked");
  });

  it("a tampered trend is blocked (fail-closed)", () => {
    expect(governance({ trend: "trend-tampered.json" })).toBe("blocked");
  });

  it("a hold-fail latest report blocks even a stable trend", () => {
    expect(governance({ trend: "trend-stable.json", report: "report-hold-fail.json" })).toBe("blocked");
  });

  it("a blocking latest audit regression blocks even a stable trend", () => {
    expect(governance({ trend: "trend-stable.json", audit: "audit-fail.json" })).toBe("blocked");
  });

  it("--strict-watch escalates a warning trend to blocked", () => {
    expect(governance({ trend: "trend-warning.json" }, { strictWatch: true })).toBe("blocked");
  });
});
