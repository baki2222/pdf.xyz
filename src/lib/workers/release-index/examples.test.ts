// @vitest-environment node
/**
 * Drives the committed release-index example fixtures through the REAL in-process runner and proves:
 * each committed artifact parses + is content-free, indexing the four valid artifacts rebuilds the
 * committed `index.sample.json` byte-for-byte at the documented clock, the tampered artifact is caught
 * (`invalid`), retention bounds drive the documented `warn`, every rendered manifest is free of any
 * locator token, and the README lists every artifact fixture (no silent gap).
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runReleaseIndex, type ReleaseIndexProvider } from "./run";
import type { ReleaseIndexArgs } from "./args";

const DIR = join(process.cwd(), "docs", "examples", "release-index");
const NOW = "2026-07-03T00:00:00.000Z";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** The four VALID artifact fixtures, in the order the committed sample manifest was built. */
const VALID = ["artifact-pass-recent.json", "artifact-warn-dirty.json", "artifact-fail.json", "artifact-pass-old.json"];
const TAMPERED = "artifact-tampered.json";

/** Locator VALUES that must never appear in a fixture or a rendered manifest. (Authored prose may say
 *  "bucket"/"secret"/"byte" in caveats, so the list targets provider hosts + key schemes only.) */
const FORBIDDEN = ["amazonaws", "akia", "://", "us-east-1", "upstash", "cloudflarestorage", "/tmp/", "customer", ".pdf", "bearer "];

function provider(): ReleaseIndexProvider {
  return {
    now: () => NOW,
    hash: sha256,
    readArtifact: async (path: string) => readFileSync(join(DIR, path), "utf8"),
    readStdin: async () => "",
  };
}

function args(artifactPaths: string[], extra: Partial<ReleaseIndexArgs> = {}): ReleaseIndexArgs {
  return { format: "json", pretty: true, artifactPaths, ...extra };
}

describe("release-index example fixtures", () => {
  it("rebuilds the committed index.sample.json byte-for-byte", async () => {
    const run = await runReleaseIndex(args(VALID, { maxArtifacts: 10, maxAgeDays: 180 }), provider());
    const committed = readFileSync(join(DIR, "index.sample.json"), "utf8");
    expect(run.output).toBe(committed);
    expect(run.exitCode).toBe(0);
    expect(run.index.rollup.verdict).toBe("ok");
  });

  it("indexes the four valid artifacts with counts that report content transparently", async () => {
    const run = await runReleaseIndex(args(VALID, { maxArtifacts: 10, maxAgeDays: 180 }), provider());
    // rollup is `ok` (archive intact + within retention) even though a fail build is in history
    expect(run.index.verdictCounts).toEqual({ pass: 2, warn: 1, fail: 1, unknown: 0 });
    expect(run.index.digestCounts).toEqual({ verified: 4, mismatch: 0, malformed: 0, unreadable: 0 });
  });

  it("catches the tampered artifact (invalid, exit 4)", async () => {
    const run = await runReleaseIndex(args([...VALID, TAMPERED]), provider());
    expect(run.exitCode).toBe(4);
    expect(run.index.rollup.verdict).toBe("invalid");
    expect(run.index.digestCounts.mismatch).toBe(1);
  });

  it("retention bounds drive the documented warn (over-count + over-age)", async () => {
    const run = await runReleaseIndex(args(VALID, { maxArtifacts: 3, maxAgeDays: 90 }), provider());
    expect(run.exitCode).toBe(3);
    expect(run.index.rollup.verdict).toBe("warn");
    expect(run.index.rollup.drivers).toEqual(["retention-count", "retention-age"]);
  });

  it("renders every scenario content-free in JSON and text", async () => {
    const scenarios: string[][] = [VALID, [...VALID, TAMPERED], [TAMPERED]];
    for (const paths of scenarios) {
      for (const format of ["json", "text"] as const) {
        const run = await runReleaseIndex(args(paths, { format, maxArtifacts: 2, maxAgeDays: 30 }), provider());
        for (const bad of FORBIDDEN) {
          expect(run.output.toLowerCase(), `${paths.join("+")} (${format}): ${bad}`).not.toContain(bad.toLowerCase());
        }
      }
    }
  });

  it("every committed .json fixture is valid JSON and free of locator tokens", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(DIR, f), "utf8");
      expect(() => JSON.parse(text), f).not.toThrow();
      for (const bad of FORBIDDEN) expect(text.toLowerCase(), f).not.toContain(bad.toLowerCase());
    }
  });

  it("README lists every committed artifact fixture (no silent gap)", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    const artifacts = readdirSync(DIR).filter((f) => f.startsWith("artifact-") && f.endsWith(".json"));
    expect(artifacts.length).toBeGreaterThan(0);
    for (const f of artifacts) expect(readme, f).toContain(f);
  });
});
