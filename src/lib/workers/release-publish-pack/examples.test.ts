// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-publish-pack example fixtures under
 * `docs/examples/release-publish-pack/`. It pins each document to its schema, asserts it is content-free, and
 * DRIVES the real publish-pack modules over the fixtures to prove the documented verdicts. Offline: it reads
 * committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPublishPackResult } from "./build";
import { ingestPublishPackFrom, defaultPolicy, type PublishPackObjects } from "./fixtures";
import type { ReleasePublishPackPolicy, ReleasePublishPackVerdict } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-publish-pack");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const GOVERNANCE = [
  "governance-healthy.json",
  "governance-watch.json",
  "governance-incomplete.json",
  "governance-blocked.json",
  "governance-tampered.json",
];
const ARCHIVE = ["archive-archivable.json", "archive-watch.json", "archive-blocked.json"];
const DRILLS = ["restore-drill-verified.json", "restore-drill-failed.json"];
const REPORTS = ["report-promote-ready.json", "report-hold-fail.json"];
const TRENDS = ["trend-stable.json"];
const FILES = [...GOVERNANCE, ...ARCHIVE, ...DRILLS, ...REPORTS, ...TRENDS, "not-a-document.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or
// "path", which the documents' own honesty caveats legitimately mention. Mirrors the release-governance set.
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

/** Drive the real publish pack over a set of committed fixtures and return the verdict. */
function pack(
  objs: { governance?: string; archive?: string; restoreDrill?: string; report?: string; trend?: string },
  policy: Partial<ReleasePublishPackPolicy> = {},
): ReleasePublishPackVerdict {
  const built: PublishPackObjects = {
    ...(objs.governance !== undefined ? { governance: readJson(objs.governance) } : {}),
    ...(objs.archive !== undefined ? { archive: readJson(objs.archive) } : {}),
    ...(objs.restoreDrill !== undefined ? { restoreDrill: readJson(objs.restoreDrill) } : {}),
    ...(objs.report !== undefined ? { report: readJson(objs.report) } : {}),
    ...(objs.trend !== undefined ? { trend: readJson(objs.trend) } : {}),
  };
  return buildPublishPackResult("2026-07-04T00:00:00.000Z", ingestPublishPackFrom(built), defaultPolicy(policy))
    .pack.verdict;
}

describe("release-publish-pack examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("each fixture carries its expected upstream schema", () => {
    for (const f of GOVERNANCE) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-governance/1");
    for (const f of ARCHIVE) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-archive/1");
    for (const f of DRILLS) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-restore-drill/1");
    for (const f of REPORTS) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-report/1");
    for (const f of TRENDS) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-trend/1");
    expect((readJson("not-a-document.json") as { schema: string }).schema).not.toMatch(/release-/);
  });
});

describe("release-publish-pack examples — drive the documented verdicts", () => {
  it("a healthy governance (with clean sources) is publishable", () => {
    expect(pack({ governance: "governance-healthy.json" })).toBe("publishable");
    expect(
      pack({
        governance: "governance-healthy.json",
        archive: "archive-archivable.json",
        restoreDrill: "restore-drill-verified.json",
        report: "report-promote-ready.json",
        trend: "trend-stable.json",
      }),
    ).toBe("publishable");
  });

  it("a watch governance is a review (internal-review)", () => {
    expect(pack({ governance: "governance-watch.json" })).toBe("review");
  });

  it("an incomplete governance is incomplete (insufficient)", () => {
    expect(pack({ governance: "governance-incomplete.json" })).toBe("incomplete");
  });

  it("a missing governance (archive/trend only) is incomplete, never a vacuous share-safe pack", () => {
    expect(pack({ archive: "archive-archivable.json" })).toBe("incomplete");
    expect(pack({ trend: "trend-stable.json" })).toBe("incomplete");
  });

  it("a blocked governance is blocked", () => {
    expect(pack({ governance: "governance-blocked.json" })).toBe("blocked");
  });

  it("a tampered governance is blocked (fail-closed)", () => {
    expect(pack({ governance: "governance-tampered.json" })).toBe("blocked");
  });

  it("a failed restore drill blocks even a healthy governance", () => {
    expect(pack({ governance: "governance-healthy.json", restoreDrill: "restore-drill-failed.json" })).toBe("blocked");
  });

  it("a hold-fail latest report blocks even a healthy governance", () => {
    expect(pack({ governance: "governance-healthy.json", report: "report-hold-fail.json" })).toBe("blocked");
  });

  it("an archive-watch pack flags a healthy governance to review", () => {
    expect(pack({ governance: "governance-healthy.json", archive: "archive-watch.json" })).toBe("review");
  });

  it("--strict escalates a watch governance to blocked", () => {
    expect(pack({ governance: "governance-watch.json" }, { strict: true })).toBe("blocked");
  });

  it("--require-restore-drill makes a missing drill incomplete", () => {
    expect(pack({ governance: "governance-healthy.json" })).toBe("publishable");
    expect(pack({ governance: "governance-healthy.json" }, { requireRestoreDrill: true })).toBe("incomplete");
  });
});
