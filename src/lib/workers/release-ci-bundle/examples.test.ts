// @vitest-environment node
/**
 * Drives the committed release-ci-bundle example fixtures through the REAL in-process runner and proves:
 * the coherent chain resolves to `pass` with every consistency link `ok`; the deliberately-incoherent
 * policy fixture FAILS closed (`index-policy-agreement` mismatch); a decision-less chain is `unknown`;
 * every rendered bundle is free of any locator token; the README lists every fixture (no silent gap);
 * and the CI workflow example wires the gate → artifact → index → policy → ci-bundle chain.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { runReleaseCiBundle, type ReleaseCiBundleProvider } from "./run";
import { makeArgs, type StageObjects } from "./fixtures";

const DIR = join(process.cwd(), "docs", "examples", "release-ci-bundle");
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Locator VALUES that must never appear in a fixture or a rendered bundle. */
const FORBIDDEN = ["amazonaws", "akia", "://", "us-east-1", "upstash", "cloudflarestorage", "/tmp/", "customer", ".pdf", "bearer "];

/** A provider that serves each stage-key "path" from the committed fixture files. */
function provider(files: Record<string, string>): ReleaseCiBundleProvider {
  return {
    now: () => "2026-07-03T00:00:00.000Z",
    hash: sha256,
    readFile: async (path: string) => {
      const file = files[path];
      if (file === undefined) throw new Error("enoent");
      return readFileSync(join(DIR, file), "utf8");
    },
  };
}

/** Build args + a matching provider for a set of stage-key → fixture-filename mappings. */
function bundleOf(files: Partial<Record<"gate" | "artifact" | "index" | "policy", string>>) {
  const objs: StageObjects = {};
  for (const key of Object.keys(files) as (keyof typeof files)[]) objs[key] = files[key];
  return runReleaseCiBundle(makeArgs(objs), provider(files as Record<string, string>));
}

describe("release-ci-bundle example fixtures — documented verdicts", () => {
  it("the coherent full chain passes (exit 0) with every link ok", async () => {
    const run = await bundleOf({
      gate: "gate-pass.json",
      artifact: "artifact-pass.json",
      index: "index-pass.json",
      policy: "policy-pass.json",
    });
    expect(run.exitCode).toBe(0);
    expect(run.result.rollup.verdict).toBe("pass");
    expect(run.result.consistency.every((c) => c.status === "ok")).toBe(true);
    expect(run.result.rollup.chainComplete).toBe(true);
  });

  it("index + a policy over a DIFFERENT index fails closed (exit 4, index-policy-agreement)", async () => {
    const run = await bundleOf({ index: "index-pass.json", policy: "policy-mismatch.json" });
    expect(run.exitCode).toBe(4);
    expect(run.result.rollup.verdict).toBe("fail");
    expect(run.result.consistency.find((c) => c.id === "index-policy-agreement")?.status).toBe("mismatch");
  });

  it("a decision-less chain (gate only) is unknown (exit 2)", async () => {
    const run = await bundleOf({ gate: "gate-pass.json" });
    expect(run.exitCode).toBe(2);
    expect(run.result.rollup.drivers).toContain("incomplete-chain");
  });
});

describe("release-ci-bundle example fixtures — content-free", () => {
  it("renders the coherent chain + the mismatch content-free in json and text", async () => {
    const cases: Array<Partial<Record<"gate" | "artifact" | "index" | "policy", string>>> = [
      { gate: "gate-pass.json", artifact: "artifact-pass.json", index: "index-pass.json", policy: "policy-pass.json" },
      { index: "index-pass.json", policy: "policy-mismatch.json" },
    ];
    for (const files of cases) {
      for (const format of ["json", "text"] as const) {
        const objs: StageObjects = { ...files };
        const run = await runReleaseCiBundle(makeArgs(objs, { format }), provider(files as Record<string, string>));
        for (const bad of FORBIDDEN) {
          expect(run.output.toLowerCase(), `${JSON.stringify(files)} (${format}): ${bad}`).not.toContain(bad.toLowerCase());
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

describe("release-ci-bundle example docs", () => {
  it("README lists every committed stage fixture (no silent gap)", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) expect(readme, f).toContain(f);
  });

  it("the CI workflow fixture wires gate → artifact → index → policy → ci-bundle and asserts fail-closed exits", () => {
    const yml = readFileSync(
      join(process.cwd(), "docs", "examples", "deployment", "github-actions", "release-ci-bundle-fixture.yml"),
      "utf8",
    );
    for (const step of [
      "worker:release-gate",
      "worker:release-artifact",
      "worker:release-index",
      "worker:release-policy",
      "worker:release-ci-bundle",
    ]) {
      expect(yml, step).toContain(step);
    }
    expect(yml).toContain('test "$code" -eq 4'); // a cross-stage inconsistency fails closed
    expect(yml).toContain('test "$code" -eq 1'); // a misused CLI fails closed
    for (const bad of FORBIDDEN) expect(yml.toLowerCase(), `fixture: ${bad}`).not.toContain(bad.toLowerCase());
  });
});
