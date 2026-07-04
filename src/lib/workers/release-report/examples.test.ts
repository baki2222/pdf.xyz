// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-report example fixtures under
 * `docs/examples/release-report/`. It pins each file to its schema, asserts it is content-free, and DRIVES the
 * real report modules over the fixtures to prove the documented recommendations. Offline: it reads committed
 * files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportResult } from "./build";
import { ingestSourcesFrom, NOW } from "./fixtures";
import type { ReleaseReportRecommendation } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-report");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const BUNDLES = ["bundle-pass.json", "bundle-warn.json", "bundle-fail.json"];
const AUDITS = ["audit-pass.json", "audit-warn.json", "audit-fail.json"];
const FILES = [...BUNDLES, ...AUDITS, "not-a-report.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret"
// or "path", which the documents' own honesty caveats legitimately mention. Mirrors the release-audit set.
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

/** Drive the real report over a subset of committed fixtures and return the recommendation. */
function recommend(objs: { bundle?: string; audit?: string }): ReleaseReportRecommendation {
  const ingested = ingestSourcesFrom({
    bundle: objs.bundle ? readJson(objs.bundle) : undefined,
    audit: objs.audit ? readJson(objs.audit) : undefined,
  });
  return buildReportResult(NOW, ingested, false).recommendation.recommendation;
}

describe("release-report examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every fixture parses and carries its expected schema", () => {
    for (const f of BUNDLES) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-ci-bundle/1");
    for (const f of AUDITS) expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-audit/1");
    expect((readJson("not-a-report.json") as { schema: string }).schema).not.toMatch(/release-(ci-bundle|audit)/);
  });
});

describe("release-report examples — drive the documented recommendations", () => {
  it("a passing bundle + a passing audit is promote-ready", () => {
    expect(recommend({ bundle: "bundle-pass.json", audit: "audit-pass.json" })).toBe("promote-ready");
    expect(recommend({ bundle: "bundle-pass.json" })).toBe("promote-ready");
  });

  it("a warn bundle / audit drift is a hold-warning", () => {
    expect(recommend({ bundle: "bundle-warn.json" })).toBe("hold-warning");
    expect(recommend({ bundle: "bundle-pass.json", audit: "audit-warn.json" })).toBe("hold-warning");
  });

  it("a failed bundle / blocking audit regression is a hold-fail", () => {
    expect(recommend({ bundle: "bundle-fail.json" })).toBe("hold-fail");
    expect(recommend({ bundle: "bundle-pass.json", audit: "audit-fail.json" })).toBe("hold-fail");
  });

  it("an audit-only run, or an unreadable document, is needs-evidence (never a promote)", () => {
    expect(recommend({ audit: "audit-pass.json" })).toBe("needs-evidence");
    expect(recommend({ bundle: "not-a-report.json" })).toBe("needs-evidence");
  });
});
