/**
 * Vitest `globalSetup`: compile every `scripts/worker-*.ts` entrypoint ONCE per suite run so the
 * ~1.2k CLI smoke spawns can exec plain `node` instead of paying a fresh `tsx` bootstrap each time.
 *
 * Why this exists: the smoke tier's value is running the real binary as a real subprocess (real
 * spawn, real exit code, real filesystem + stdin). It does NOT need to re-transpile the worker on
 * every invocation. Measured in this sandbox, `tsx` costs ~0.61s of loader/esbuild bootstrap before
 * a single line of worker code runs — a trivial `.ts` file takes 0.61s while bare `node` takes
 * 0.04s. Across ~1195 smoke spawns that is ~730 CPU-seconds of pure overhead carrying zero
 * coverage, and it is what pushed `pnpm qa`'s vitest step past its wall-clock budget. Compiling all
 * 68 entrypoints in one esbuild pass takes ~1.8s total and cuts each spawn from ~0.83s to ~0.06s
 * (~14x), with byte-identical output and identical exit codes (verified across the release-index
 * fixture matrix, its failure exits, and the stdin path).
 *
 * Fidelity notes — what the smoke tier still proves after this change:
 *  - It runs the SAME `scripts/worker-*.ts` entrypoint, as a real subprocess, with real argv/stdin,
 *    real `node:crypto` hashing, real filesystem access, and the real process exit code.
 *  - `packages: "external"` leaves every third-party dependency unbundled, so the child resolves the
 *    REAL `node_modules` at runtime exactly as `tsx` does. (This is also why the output must live
 *    inside the project: an out-of-tree cache dir cannot resolve externals like `pdf-lib` via node's
 *    upward `node_modules` lookup.)
 *  - Only first-party TypeScript is inlined — the same code `tsx` would transpile anyway.
 *  - `run-worker-cli.ts` still resolves the script through `package.json`, so a missing/renamed
 *    `worker:*` script remains a loud failure and the script-wiring assertion is preserved.
 *
 * Honest degradation: if esbuild is unavailable or a build fails, this logs a warning and leaves the
 * cache empty. `run-worker-cli.ts` then falls back to spawning `tsx` exactly as before — slower, but
 * correct. It never silently skips or fakes a spawn.
 */
import { createRequire } from "node:module";
import { readdirSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Where compiled worker entrypoints land. Must be INSIDE the project so the compiled output can
 * resolve externalized dependencies through node's normal upward `node_modules` walk. Lives under
 * `node_modules/` so it is already gitignored and never shipped.
 */
export const WORKER_CLI_CACHE_DIR = join(
  process.cwd(),
  "node_modules",
  ".cache",
  "pdfxyz-worker-cli",
);

/** Resolve esbuild via tsx's own require context — it is tsx's dependency, not a direct one here. */
function loadEsbuild(): { buildSync: (opts: unknown) => unknown } | undefined {
  try {
    const here = createRequire(import.meta.url);
    const req = createRequire(here.resolve("tsx/package.json"));
    return req("esbuild") as { buildSync: (opts: unknown) => unknown };
  } catch {
    return undefined;
  }
}

export default function setup(): void {
  const esbuild = loadEsbuild();
  if (!esbuild) {
    process.stderr.write(
      "worker-cli-precompile: esbuild unavailable; CLI smoke tests will fall back to tsx (slower, still correct).\n",
    );
    return;
  }

  const entryPoints = readdirSync(join(process.cwd(), "scripts"))
    .filter((f) => f.startsWith("worker-") && f.endsWith(".ts"))
    .map((f) => join("scripts", f));
  if (entryPoints.length === 0) return;

  // Rebuild from scratch every run: the cache is only ever consumed by the tests that this same run
  // is about to execute, so there is no staleness window and no cross-run invalidation to get wrong.
  rmSync(WORKER_CLI_CACHE_DIR, { recursive: true, force: true });
  mkdirSync(WORKER_CLI_CACHE_DIR, { recursive: true });

  try {
    esbuild.buildSync({
      entryPoints,
      bundle: true,
      platform: "node",
      format: "esm",
      outdir: WORKER_CLI_CACHE_DIR,
      // Keep third-party deps unbundled so the child resolves the real node_modules at runtime.
      packages: "external",
      tsconfig: "tsconfig.json",
      outExtension: { ".js": ".mjs" },
      logLevel: "error",
      sourcemap: "inline",
    });
  } catch (err) {
    // Leave the cache empty and fall back to tsx rather than failing the whole suite on a build
    // problem that does not itself indicate a product defect.
    process.stderr.write(
      `worker-cli-precompile: build failed (${String(err)}); falling back to tsx.\n`,
    );
    rmSync(WORKER_CLI_CACHE_DIR, { recursive: true, force: true });
  }
}
