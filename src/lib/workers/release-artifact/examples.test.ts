// @vitest-environment node
/**
 * Drives the committed release-artifact example fixtures through the REAL in-process runner and
 * proves: each composed case resolves the documented artifact verdict + exit, the fixtures and the
 * rendered artifact are free of any locator token, the generate→verify roundtrip succeeds with a real
 * sha256, the digest is deterministic, and the README lists every fixture (no silent gap).
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runReleaseArtifact, type ReleaseArtifactProvider } from "./run";
import type { ReleaseArtifactArgs } from "./args";
import type { ReleaseArtifactVerdict } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-artifact");
const NOW = "2026-07-03T00:00:00.000Z";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Locator VALUES that must never appear in a fixture or a rendered artifact. (Authored prose may say
 *  "bucket"/"secret"/"byte" in caveats, so the list targets provider hosts + key schemes only.) */
const FORBIDDEN = ["amazonaws", "akia", "://", "us-east-1", "upstash", "cloudflarestorage", "/tmp/", "customer", ".pdf", "bearer "];

interface Case {
  readonly gate: string;
  readonly ops?: string;
  readonly dirty?: boolean;
  readonly verdict: ReleaseArtifactVerdict;
  readonly exit: number;
}

const CASES: readonly Case[] = [
  { gate: "release-gate-pass.json", verdict: "pass", exit: 0 },
  { gate: "release-gate-pass.json", dirty: true, verdict: "warn", exit: 3 },
  { gate: "release-gate-pass.json", ops: "ops-bundle-ok.json", verdict: "pass", exit: 0 },
  { gate: "release-gate-pass.json", ops: "ops-bundle-critical.json", verdict: "pass", exit: 0 },
  { gate: "release-gate-warn.json", verdict: "warn", exit: 3 },
  { gate: "release-gate-fail.json", verdict: "fail", exit: 4 },
  { gate: "release-gate-unknown.json", verdict: "unknown", exit: 2 },
];

function fixtureProvider(gateFile: string, opsFile: string | undefined, dirty: boolean): ReleaseArtifactProvider {
  return {
    now: () => NOW,
    hash: sha256,
    gitFacts: async () => ({ commit: "27a5555fd3e3", ref: "main", dirty }),
    readGate: async () => readFileSync(join(DIR, gateFile), "utf8"),
    runGate: async () => readFileSync(join(DIR, gateFile), "utf8"),
    readOpsBundle: async () => readFileSync(join(DIR, opsFile ?? ""), "utf8"),
    readArtifact: async () => "{}",
  };
}

function argsFor(c: Case, format: "json" | "text"): ReleaseArtifactArgs {
  return {
    mode: "generate",
    format,
    pretty: true,
    noVcs: false,
    releaseGatePath: c.gate,
    ...(c.ops ? { opsBundlePath: c.ops } : {}),
  };
}

describe("release-artifact example fixtures", () => {
  for (const c of CASES) {
    const label = `${c.gate}${c.ops ? ` + ${c.ops}` : ""}${c.dirty ? " (dirty)" : ""}`;
    it(`${label} → ${c.verdict} (exit ${c.exit})`, async () => {
      const run = await runReleaseArtifact(argsFor(c, "json"), fixtureProvider(c.gate, c.ops, c.dirty ?? false));
      expect(run.exitCode, label).toBe(c.exit);
      expect(run.artifact!.body.rollup.verdict, label).toBe(c.verdict);
      expect(run.artifact!.integrity.digest).toMatch(/^[0-9a-f]{64}$/);
    });
  }

  it("renders every case content-free in JSON and text", async () => {
    for (const c of CASES) {
      for (const format of ["json", "text"] as const) {
        const run = await runReleaseArtifact(argsFor(c, format), fixtureProvider(c.gate, c.ops, c.dirty ?? false));
        for (const bad of FORBIDDEN) expect(run.output.toLowerCase(), `${c.gate} (${format}): ${bad}`).not.toContain(bad.toLowerCase());
      }
    }
  });

  it("generate→verify roundtrip: a written artifact re-verifies as intact", async () => {
    const gen = await runReleaseArtifact(argsFor(CASES[0]!, "json"), fixtureProvider(CASES[0]!.gate, undefined, false));
    const text = JSON.stringify(gen.artifact);
    const verifyProvider: ReleaseArtifactProvider = { ...fixtureProvider(CASES[0]!.gate, undefined, false), readArtifact: async () => text };
    const verify = await runReleaseArtifact({ mode: "verify", format: "json", pretty: true, noVcs: false, verifyPath: "a.json" }, verifyProvider);
    expect(verify.exitCode).toBe(0);
    expect(verify.verify!.reason).toBe("verified");
  });

  it("the digest is deterministic for identical inputs", async () => {
    const a = await runReleaseArtifact(argsFor(CASES[0]!, "json"), fixtureProvider(CASES[0]!.gate, undefined, false));
    const b = await runReleaseArtifact(argsFor(CASES[0]!, "json"), fixtureProvider(CASES[0]!.gate, undefined, false));
    expect(a.artifact!.integrity.digest).toBe(b.artifact!.integrity.digest);
  });

  it("every committed fixture is valid JSON and free of locator tokens", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(DIR, f), "utf8");
      expect(() => JSON.parse(text), f).not.toThrow();
      for (const bad of FORBIDDEN) expect(text.toLowerCase(), f).not.toContain(bad.toLowerCase());
    }
  });

  it("covers every committed fixture (no silent gap)", () => {
    const referenced = new Set<string>();
    for (const c of CASES) {
      referenced.add(c.gate);
      if (c.ops) referenced.add(c.ops);
    }
    const onDisk = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
    expect([...referenced].sort()).toEqual(onDisk);
  });

  it("README lists every fixture", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
      expect(readme, f).toContain(f);
    }
  });
});
