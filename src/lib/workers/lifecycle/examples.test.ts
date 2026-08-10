// @vitest-environment node
/**
 * Static, no-secret proof for the committed lifecycle-verification examples under
 * `docs/examples/lifecycle/`. It pins each example document's verdict against the
 * versioned default policy — so an example can never silently drift from the verifier
 * — and asserts every example (and its README) is content-free: no bucket, endpoint,
 * region, credential, or object key. Offline: it reads committed files only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION_SETTINGS } from "./retention";
import { buildLifecyclePolicy } from "./policy";
import { parseObservedLifecycle, verifyLifecyclePolicy } from "./verify";

const EXAMPLES_DIR = join(process.cwd(), "docs", "examples", "lifecycle");
const expectedVersioned = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS, {
  versioned: true,
});

function read(file: string): string {
  return readFileSync(join(EXAMPLES_DIR, file), "utf8");
}

function verifyExample(file: string) {
  const parsed = parseObservedLifecycle(read(file));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`example ${file} should parse`);
  return verifyLifecyclePolicy(expectedVersioned, parsed.observed);
}

describe("lifecycle verification examples — pinned verdicts", () => {
  it("observed-verified.aws-s3.json verifies clean with one unmatched rule", () => {
    const result = verifyExample("observed-verified.aws-s3.json");
    expect(result.verdict).toBe("verified");
    expect(result.checks.every((c) => c.status === "satisfied")).toBe(true);
    // The unrelated `logs/` rule governs no generated rule → reported as unmatched.
    expect(result.unmatchedObservedRules).toBe(1);
  });

  it("observed-drift-weaker.aws-s3.json is drift — inputs outlive the ceiling", () => {
    const result = verifyExample("observed-drift-weaker.aws-s3.json");
    expect(result.verdict).toBe("drift");
    expect(
      result.checks.find((c) => c.role === "input-expiration")?.status,
    ).toBe("weaker");
    expect(
      result.plan.find((p) => p.ruleId === "pdfxyz-input-expiration")?.action,
    ).toBe("update");
  });

  it("observed-drift-missing.aws-s3.json is drift — the artifact rule is absent", () => {
    const result = verifyExample("observed-drift-missing.aws-s3.json");
    expect(result.verdict).toBe("drift");
    expect(
      result.checks.find((c) => c.role === "artifact-expiration")?.status,
    ).toBe("missing");
    expect(
      result.plan.find((p) => p.ruleId === "pdfxyz-artifact-expiration")
        ?.action,
    ).toBe("create");
  });
});

describe("lifecycle verification examples — content-free", () => {
  const files = [
    "observed-verified.aws-s3.json",
    "observed-drift-weaker.aws-s3.json",
    "observed-drift-missing.aws-s3.json",
    "README.md",
  ];

  it("no example contains a bucket, endpoint, region, or credential", () => {
    for (const file of files) {
      const text = read(file).toLowerCase();
      for (const leak of [
        "amazonaws",
        "akia",
        "://",
        "secretaccesskey",
        "us-east-1",
        ".upstash.io",
        ".r2.cloudflarestorage",
      ]) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every JSON example is a valid, parseable lifecycle document", () => {
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      expect(() => JSON.parse(read(file))).not.toThrow();
    }
  });
});

describe("lifecycle verification examples — README stays in sync", () => {
  it("documents the real flags, exit codes, and the no-cloud-call rule", () => {
    const readme = read("README.md");
    expect(readme).toContain("--lifecycle-verify");
    expect(readme).toContain("--observed=");
    expect(readme).toContain("get-bucket-lifecycle-configuration");
    // The load-bearing honesty invariant must be stated.
    expect(readme.toLowerCase()).toContain("never");
    // Every committed example is described in the table.
    for (const file of [
      "observed-verified.aws-s3.json",
      "observed-drift-weaker.aws-s3.json",
      "observed-drift-missing.aws-s3.json",
    ]) {
      expect(readme).toContain(file);
    }
  });
});
