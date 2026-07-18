#!/usr/bin/env tsx
/**
 * pdf.xyz local QA gate — `pnpm qa` runs the full pre-push suite (typecheck, lint,
 * test, build) as sequential subprocesses, short-circuiting on the first failure and
 * exiting with that step's code (identical semantics to the old `&&` chain).
 *
 * Why this is a script and not the old `pnpm typecheck && pnpm lint && pnpm test &&
 * pnpm build` string: pnpm runs that chain through `/bin/sh`, so a bare `pnpm` 127s
 * ("pnpm: not found") in any environment where pnpm isn't on PATH — e.g. this cron
 * sandbox, which ships only `corepack pnpm`. So `corepack pnpm qa` failed on the very
 * first `pnpm typecheck` even though every gate underneath it was green. Each step is
 * spawned through the shared {@link resolvePnpmInvocation} helper (the same
 * `npm_execpath` -> PATH -> corepack ladder the worker CLIs and the Playwright
 * webServer command already use), so `pnpm qa` and `corepack pnpm qa` both work with
 * zero PATH assumption.
 *
 * Offline and content-free by construction: it only spawns already-defined package
 * scripts and folds their process exit codes. It reads no secrets and touches no
 * `.env`.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolvePnpmInvocation } from "@/lib/workers/exec-pnpm";

/**
 * The ordered pre-push gate: fail fast with the cheapest checks first and the
 * expensive production build last. Each entry is the name of an existing package
 * script, run as `pnpm run <step>`.
 */
export const QA_STEPS = ["typecheck", "lint", "test", "build"] as const;

/** Run one package script as a subprocess, streaming its output, and reduce it to an exit code. */
export function runStep(step: string): number {
  const { command, prefixArgs } = resolvePnpmInvocation();
  const result = spawnSync(command, [...prefixArgs, "-s", "run", step], {
    // Stream the child's output straight through — `qa` is an interactive dev/CI gate,
    // not a captured probe, so there is nothing to sanitize.
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  });
  if (result.error) {
    process.stderr.write(`qa: could not launch \`${step}\`: ${result.error.message}\n`);
    return 1;
  }
  if (result.signal) {
    process.stderr.write(`qa: \`${step}\` terminated by signal ${result.signal}\n`);
    return 1;
  }
  return typeof result.status === "number" ? result.status : 1;
}

/** Run every step in order, stopping at the first failure. Returns the exit code to propagate. */
export function runQa(): number {
  for (const step of QA_STEPS) {
    const code = runStep(step);
    if (code !== 0) {
      process.stderr.write(`qa: \`${step}\` failed (exit ${code}); stopping.\n`);
      return code;
    }
  }
  return 0;
}

// Only run when invoked directly (`tsx scripts/qa.ts`), never when imported by the
// guard test — mirrors the standard ESM main-module check.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exit(runQa());
}
