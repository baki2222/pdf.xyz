// @vitest-environment node
/**
 * The TypeScript compiler reaches the tests through Node, never through
 * Vite's transform.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * Until 2026-11-21 a file that imported "typescript" (the guards that walk an
 * AST with it) could have the ~9 MB compiler inlined: Vite transformed it, looked
 * for its source map, missed, and printed "Failed to load source map for
 * …typescript.js" (4-5 times in every CI unit log of 11-21, 44891504062 to
 * 44931945692). In run 44299285879 that miss fell inside the window of a
 * tool-page-substance test that took 2,739 ms instead of under 300 ms.
 *
 * ── THE FIX, AND WHY THIS IS THE GUARD ──────────────────────────────────────
 *
 * `sharedTestOptions.server.deps.external` in vitest.config.ts. The option is
 * the MECHANISM; the exit condition is the PROPERTY, zero of those lines
 * (CLAUDE.md rule 2), and no timeout can see it come back (a 2.7 s stall is
 * far under any test's timeout). So this runs a child vitest, with the
 * suite's own shared options, over a probe file that imports the compiler
 * from jsdom, where the miss was reproduced, and reads its output. The
 * positive control runs the same probe with the option emptied: it must
 * print the miss, or this check is blind.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { createVitest } from "vitest/node";

const ROOT = process.cwd();
const CONFIG = "src/tests/typescript-external.vitest.config.ts";
const MISS = /Failed to load source map[^\n]*typescript/g;

/**
 * Each child's kill. No CI reading yet (this file is new); locally the two
 * children took 4.2 s and 6.3 s, which is no bound source. 60 s each, both
 * under the test's 150 s, so the kill's message is the one that fires; the
 * first CI run's timeout-headroom block reports the real figure.
 */
const CHILD_KILL_MS = 60_000;

function runProbe(mode: "subject" | "inline") {
  const vitestCli = path.join(
    path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
    "vitest.mjs",
  );
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("VITEST")) delete env[key];
  const run = spawnSync(
    process.execPath,
    [vitestCli, "run", "--config", CONFIG],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: CHILD_KILL_MS,
      env: { ...env, TS_EXTERNAL_CONTROL: mode },
    },
  );
  const output = childText(run.stdout, run.stderr);
  // Health first: the probe ran and passed, or a count of 0 means nothing.
  expect(
    run.error,
    `${mode} child: ${String(run.error)}\n${output.slice(-3000)}`,
  ).toBeUndefined();
  expect(run.status, `${mode} child:\n${output.slice(-3000)}`).toBe(0);
  expect(output, `${mode} child ran the probe`).toMatch(PASSED);
  return output.match(MISS) ?? [];
}

const PASSED = /Tests\s+1 passed/;

/** The child's output as the predicates read it: colour codes removed. */
function childText(stdout: string | null, stderr: string | null): string {
  return stripVTControlCharacters(`${stdout ?? ""}\n${stderr ?? ""}`);
}

describe("the TypeScript compiler is handed to Node, never inlined", () => {
  it("reads a child's output the same with or without colour", () => {
    // On CI (the `CI` variable) the child colours its summary, and the first
    // CI run (44959221148) failed the health check on a passing child:
    // "subject child ran the probe: expected '\n\u001b[1m\u001b[30m\u001b[46m
    // RUN ..." to match /Tests\s+1 passed/. This machine's child never
    // colours, so this is the only place the CI shape runs here. Built from
    // char codes so no escape byte passes through the tool layer.
    const esc = String.fromCharCode(27);
    const sgr = (code: string, text: string) =>
      `${esc}[${code}m${text}${esc}[0m`;
    const summary = `${sgr("2", "      Tests ")} ${sgr("1;32", "1 passed")}${sgr("90", " (1)")}`;
    const miss = `${sgr("33", "Failed to load source map for")} /x/node_modules/typescript/lib/typescript.js`;
    const text = childText(`${summary}\n${miss}\n`, "");
    expect(text).toMatch(PASSED);
    expect(text.match(MISS) ?? []).toHaveLength(1);
  });

  it("both suite projects carry the shared options' external list", async () => {
    // The child below runs `sharedTestOptions`; this holds that both real
    // projects run it too, so the child answers for the suite.
    const vitest = await createVitest("test", {
      config: path.join(ROOT, "vitest.config.ts"),
      watch: false,
    });
    try {
      expect(vitest.projects.map((p) => p.name).sort()).toEqual([
        "native-canvas",
        "threads",
      ]);
      for (const project of vitest.projects)
        expect(
          project.config.server.deps?.external ?? [],
          project.name,
        ).toContain("typescript");
    } finally {
      await vitest.close();
    }
  }, 30_000);

  it("a file that imports it prints no source-map miss; inlined, the same file prints one", () => {
    expect(runProbe("subject")).toEqual([]);
    // Positive control: the same probe with the option emptied.
    expect(runProbe("inline").length).toBeGreaterThan(0);
  }, 150_000);
});
