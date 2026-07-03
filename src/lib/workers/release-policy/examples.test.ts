// @vitest-environment node
/**
 * Drives the committed release-policy example fixtures through the REAL in-process runner and proves:
 * each committed `pdfxyz.release-index/1` fixture parses + is content-free; each resolves to its
 * documented policy verdict under a representative policy; the tampered + inconsistent fixtures FAIL
 * closed (a valid-but-invalid archive and a self-contradicting one); every rendered result is free of
 * any locator token; the README lists every fixture (no silent gap); and the CI workflow example wires
 * the release-artifact → release-index → release-policy chain.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { runReleasePolicy, type ReleasePolicyProvider } from "./run";
import type { ReleasePolicyArgs } from "./args";

const DIR = join(process.cwd(), "docs", "examples", "release-policy");
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Locator VALUES that must never appear in a fixture or a rendered result. */
const FORBIDDEN = ["amazonaws", "akia", "://", "us-east-1", "upstash", "cloudflarestorage", "/tmp/", "customer", ".pdf", "bearer "];

function provider(): ReleasePolicyProvider {
  return {
    now: () => "2026-07-03T00:00:00.000Z",
    hash: sha256,
    readIndex: async (path: string) => readFileSync(join(DIR, path), "utf8"),
    readArtifact: async (path: string) => readFileSync(join(DIR, path), "utf8"),
    readStdin: async () => "",
  };
}

function baseArgs(over: Partial<ReleasePolicyArgs["policy"]> = {}, rest: Partial<ReleasePolicyArgs> = {}): ReleasePolicyArgs {
  return {
    format: "json",
    pretty: true,
    artifactPaths: [],
    policy: {
      requireClean: false,
      requireLatestOk: false,
      maxInvalid: null,
      maxFail: null,
      minArtifacts: null,
      maxArtifacts: null,
      maxAgeBucket: null,
      maxWarn: null,
      maxSkipped: null,
      forbidOverRetention: false,
      ...over,
    },
    ...rest,
  };
}

describe("release-policy example fixtures — documented verdicts", () => {
  it("index-clean passes a full acceptance policy (exit 0)", async () => {
    const run = await runReleasePolicy(
      baseArgs({ requireClean: true, minArtifacts: 3, maxFail: 0, requireLatestOk: true }, { indexPath: "index-clean.json" }),
      provider(),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.rollup.verdict).toBe("pass");
    expect(run.result.effectiveVerdict).toBe("ok");
  });

  it("index-mixed fails --max-fail=0 (exit 4) and warns --max-warn=0 (exit 3)", async () => {
    const fail = await runReleasePolicy(baseArgs({ maxFail: 0 }, { indexPath: "index-mixed.json" }), provider());
    expect(fail.exitCode).toBe(4);
    expect(fail.result.violations.map((v) => v.id)).toContain("too-many-fail");
    const warn = await runReleasePolicy(baseArgs({ maxWarn: 0 }, { indexPath: "index-mixed.json" }), provider());
    expect(warn.exitCode).toBe(3);
    expect(warn.result.violations.map((v) => v.id)).toContain("too-many-warn");
  });

  it("index-drift fails --require-clean (exit 4) and warns --forbid-over-retention (exit 3)", async () => {
    const clean = await runReleasePolicy(baseArgs({ requireClean: true }, { indexPath: "index-drift.json" }), provider());
    expect(clean.exitCode).toBe(4);
    expect(clean.result.effectiveVerdict).toBe("warn");
    const ret = await runReleasePolicy(baseArgs({ forbidOverRetention: true }, { indexPath: "index-drift.json" }), provider());
    expect(ret.exitCode).toBe(3);
    expect(ret.result.violations.map((v) => v.id)).toContain("over-retention");
  });

  it("index-empty is unknown (exit 2) — an empty archive never passes", async () => {
    const run = await runReleasePolicy(baseArgs({}, { indexPath: "index-empty.json" }), provider());
    expect(run.exitCode).toBe(2);
    expect(run.result.rollup.drivers).toContain("empty-archive");
  });

  it("index-tampered fails closed even with no assertions (exit 4, index-tampered)", async () => {
    const run = await runReleasePolicy(baseArgs({}, { indexPath: "index-tampered.json" }), provider());
    expect(run.exitCode).toBe(4);
    expect(run.result.indexUsable).toBe(true);
    expect(run.result.effectiveVerdict).toBe("invalid");
    expect(run.result.violations.map((v) => v.id)).toContain("index-tampered");
  });

  it("index-inconsistent is rejected as a tampered manifest (exit 4, invalid-index)", async () => {
    const run = await runReleasePolicy(baseArgs({}, { indexPath: "index-inconsistent.json" }), provider());
    expect(run.exitCode).toBe(4);
    expect(run.result.indexRecognized).toBe(true);
    expect(run.result.indexUsable).toBe(false);
    expect(run.result.reportedVerdict).toBe("ok"); // it LIES that it is clean...
    expect(run.result.rollup.drivers).toContain("invalid-index"); // ...but the recompute catches it
  });
});

describe("release-policy example fixtures — content-free", () => {
  it("renders every fixture content-free in JSON and text", async () => {
    const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    for (const path of fixtures) {
      for (const format of ["json", "text"] as const) {
        const run = await runReleasePolicy(baseArgs({ requireClean: true, minArtifacts: 1, forbidOverRetention: true }, { indexPath: path, format }), provider());
        for (const bad of FORBIDDEN) {
          expect(run.output.toLowerCase(), `${path} (${format}): ${bad}`).not.toContain(bad.toLowerCase());
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
});

describe("release-policy example docs", () => {
  it("README lists every committed index fixture (no silent gap)", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    const fixtures = readdirSync(DIR).filter((f) => f.startsWith("index-") && f.endsWith(".json"));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) expect(readme, f).toContain(f);
  });

  it("the CI workflow fixture wires artifact → index → policy and asserts fail-closed exits", () => {
    const yml = readFileSync(
      join(process.cwd(), "docs", "examples", "deployment", "github-actions", "release-policy-fixture.yml"),
      "utf8",
    );
    for (const step of ["worker:release-artifact", "worker:release-index", "worker:release-policy"]) {
      expect(yml, step).toContain(step);
    }
    expect(yml).toContain('test "$code" -eq 4'); // a blocking violation fails closed
    expect(yml).toContain('test "$code" -eq 1'); // a misused CLI fails closed
    for (const bad of FORBIDDEN) expect(yml.toLowerCase(), `fixture: ${bad}`).not.toContain(bad.toLowerCase());
  });
});
