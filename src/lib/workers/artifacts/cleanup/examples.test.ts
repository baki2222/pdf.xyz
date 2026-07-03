// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArtifactInventory } from "./inventory";
import { evaluateArtifactInventory, exitCodeForCleanupVerdict } from "./evaluate";
import type { CleanupVerdict } from "./taxonomy";

const DIR = join(process.cwd(), "docs", "examples", "artifacts", "cleanup");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");

/** A fixed clock; fixtures use extreme expiresAtMs so the verdict is clock-robust anyway. */
const NOW = 1_700_000_000_000;

const CASES: Array<{ file: string; verdict: CleanupVerdict; exitCode: number }> = [
  { file: "inventory-clean.json", verdict: "ok", exitCode: 0 },
  { file: "inventory-unknown.json", verdict: "unknown", exitCode: 2 },
  { file: "inventory-drift.json", verdict: "drift", exitCode: 3 },
  { file: "inventory-breach.json", verdict: "breach", exitCode: 4 },
];

/** Substrings that must never appear in a content-free example. */
const FORBIDDEN = [
  "amazonaws",
  "akia",
  "://",
  "secretaccesskey",
  "us-east-1",
  ".upstash.io",
  ".r2.cloudflarestorage",
  "password",
  "bearer ",
  "/tmp/",
  ".pdf",
  ".png",
];

describe("cleanup example inventories", () => {
  for (const { file, verdict, exitCode } of CASES) {
    it(`${file} is valid JSON`, () => {
      expect(() => JSON.parse(read(file))).not.toThrow();
    });

    it(`${file} pins verdict=${verdict} (exit ${exitCode}) through the real evaluator`, () => {
      const parsed = parseArtifactInventory(read(file));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const report = evaluateArtifactInventory(parsed.inventory, NOW);
      expect(report.verdict).toBe(verdict);
      expect(exitCodeForCleanupVerdict(report.verdict)).toBe(exitCode);
    });

    it(`${file} is content-free`, () => {
      const lower = read(file).toLowerCase();
      for (const needle of FORBIDDEN) expect(lower).not.toContain(needle);
    });
  }

  it("every committed fixture is covered (no silent gap)", () => {
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const covered = CASES.map((c) => c.file).sort();
    expect(onDisk).toEqual(covered);
  });

  it("the README lists every fixture and the exit-code ladder", () => {
    const readme = read("README.md");
    for (const { file } of CASES) expect(readme).toContain(file);
    expect(readme).toContain("worker:artifact-cleanup");
    for (const code of ["0", "1", "2", "3", "4"]) expect(readme).toContain(`| ${code} |`);
  });
});
