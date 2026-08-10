// @vitest-environment node
/**
 * Drives the committed incident-handoff example fixtures through the REAL in-process runner and
 * proves: each composed case resolves the documented rollup severity + exit, the fixtures and the
 * rendered bundle are free of any locator token, and the README lists every fixture (no silent gap).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runOpsBundle, type OpsBundleProvider } from "./run";
import type { OpsBundleArgs } from "./args";
import type { OpsBundleSeverity } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "ops-bundle");
const NOW = "2026-07-03T00:00:00.000Z";

/** Locator VALUES that must never appear in a fixture or a rendered bundle. (Authored prose may say
 *  "secret"/"bucket"/"byte" in caveats, so the list targets provider hosts + key schemes only.) */
const FORBIDDEN = [
  "amazonaws",
  "akia",
  "AKIA",
  "://",
  "us-east-1",
  "upstash",
  "cloudflarestorage",
  "/tmp/",
  "customer",
  ".pdf",
  "bearer ",
];

interface Case {
  readonly ops: string;
  readonly pipeline?: string;
  readonly severity: OpsBundleSeverity;
  readonly exit: number;
}

const CASES: readonly Case[] = [
  { ops: "ops-check-healthy.json", severity: "ok", exit: 0 },
  {
    ops: "ops-check-healthy.json",
    pipeline: "pipeline-clean.json",
    severity: "ok",
    exit: 0,
  },
  {
    ops: "ops-check-healthy.json",
    pipeline: "pipeline-unknown.json",
    severity: "unknown",
    exit: 2,
  },
  {
    ops: "ops-check-healthy.json",
    pipeline: "pipeline-breach.json",
    severity: "critical",
    exit: 4,
  },
  { ops: "ops-check-degraded.json", severity: "warn", exit: 3 },
  { ops: "ops-check-critical.json", severity: "critical", exit: 4 },
  { ops: "ops-check-unknown.json", severity: "unknown", exit: 2 },
];

function fixtureProvider(
  opsFile: string,
  pipelineFile?: string,
): OpsBundleProvider {
  return {
    readOpsCheck: async () => readFileSync(join(DIR, opsFile), "utf8"),
    readPipeline: async () =>
      readFileSync(join(DIR, pipelineFile ?? ""), "utf8"),
    now: () => NOW,
  };
}

describe("ops-bundle example fixtures", () => {
  for (const c of CASES) {
    const label = c.pipeline ? `${c.ops} + ${c.pipeline}` : c.ops;
    it(`${label} → ${c.severity} (exit ${c.exit})`, async () => {
      const args: OpsBundleArgs = {
        opsCheckSource: "file",
        opsCheckPath: c.ops,
        ...(c.pipeline ? { pipelinePath: c.pipeline } : {}),
        format: "json",
        pretty: true,
      };
      const run = await runOpsBundle(args, fixtureProvider(c.ops, c.pipeline));
      expect(run.exitCode, label).toBe(c.exit);
      const outcome = JSON.parse(run.output);
      expect(outcome.rollup.severity, label).toBe(c.severity);
      expect(outcome.rollup.ok).toBe(c.severity === "ok");
    });
  }

  it("renders every case content-free in JSON and text", async () => {
    for (const c of CASES) {
      for (const format of ["json", "text"] as const) {
        const args: OpsBundleArgs = {
          opsCheckSource: "file",
          opsCheckPath: c.ops,
          ...(c.pipeline ? { pipelinePath: c.pipeline } : {}),
          format,
          pretty: true,
        };
        const run = await runOpsBundle(
          args,
          fixtureProvider(c.ops, c.pipeline),
        );
        for (const bad of FORBIDDEN)
          expect(
            run.output.toLowerCase(),
            `${c.ops} (${format})`,
          ).not.toContain(bad.toLowerCase());
      }
    }
  });

  it("every committed fixture is valid JSON and free of locator tokens", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(DIR, f), "utf8");
      expect(() => JSON.parse(text), f).not.toThrow();
      for (const bad of FORBIDDEN)
        expect(text.toLowerCase(), f).not.toContain(bad.toLowerCase());
    }
  });

  it("covers every committed fixture (no silent gap)", () => {
    const referenced = new Set<string>();
    for (const c of CASES) {
      referenced.add(c.ops);
      if (c.pipeline) referenced.add(c.pipeline);
    }
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect([...referenced].sort()).toEqual(onDisk);
  });

  it("README lists every fixture", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
      expect(readme, f).toContain(f);
    }
  });
});
