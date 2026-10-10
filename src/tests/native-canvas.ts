/**
 * Which test files load `@napi-rs/canvas`, the native module pdf.js paints
 * through under Node — and why they may not run in a worker THREAD.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * The suite runs on vitest's threads pool. A test file that loads the native
 * canvas there can crash the WHOLE run as the worker threads shut down: exit
 * 139, no failing test, nothing to rerun but everything. Measured on
 * 2026-10-11 after the PDF to PowerPoint scanner's tests arrived: 3 runs in
 * 100 on Node 24, about 3% on Node 22, and none in 100 on the forks pool,
 * where the module is unloaded with a process rather than a thread. CI runs
 * the whole suite in one `vitest run`, so that was a 3% chance of a red build
 * per push, owned by nobody.
 *
 * pdf.js loads the module at the top of its legacy build
 * (`pdfjs-dist/legacy/build/pdf.mjs`, `node_utils.js`), to polyfill
 * DOMMatrix and Path2D — so EVERY test that loads pdf.js's Node build loads
 * the native canvas, whether or not it draws.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A test file that loads it says so on a line of its own:
 *
 *     // @native-canvas
 *
 * `vitest.config.ts` reads that line ({@link nativeCanvasTestFiles}) and runs
 * those files in their own project on the forks pool; every other file stays
 * on threads. The marker is checked from both sides, and neither check
 * trusts it:
 *
 *  - `./native-canvas-guard.ts` (a setup file) fails any test file that
 *    LOADS the module while running in a worker thread — observed, at the
 *    point of consumption, not inferred from imports;
 *  - `native-canvas-pool.test.ts` fails a MARKED file whose imports cannot
 *    reach the module at all (a stale marker moves a file off threads for
 *    nothing), and asks vitest itself how it assigns every test file. Not
 *    "a marked file that did not load it this run": a file can reach it and
 *    load it on some runs only (`./native-canvas-guard.ts` has the case).
 *
 * Why a marker and not the import graph: on 2026-10-11 a full run, one fresh
 * process per file, observed 81 test files loading the module; an import
 * graph that follows `import()` names 193, because pdf.js is reached through
 * modules that load it only on some paths. The graph answers an easier
 * question (CLAUDE.md rule 4) — which is why it is used only as a NECESSARY
 * condition for a marker, and the observation is what the guard repeats.
 *
 * Dependency-free on purpose: `vitest.config.ts` imports it.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** The marker, a whole line of its own. */
export const NATIVE_CANVAS_MARKER = /^\/\/ @native-canvas\s*$/m;

/** The test files vitest collects (`include` in `vitest.config.ts`). */
export const TEST_FILE = /\.(?:test|spec)\.tsx?$/;

/**
 * Every test file under `root/src` carrying the marker, as root-relative
 * POSIX paths, sorted: the native-canvas project's `include`.
 */
export function nativeCanvasTestFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        TEST_FILE.test(entry.name) &&
        NATIVE_CANVAS_MARKER.test(readFileSync(full, "utf8"))
      )
        out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(path.join(root, "src"));
  return out.sort();
}

/**
 * The loaded modules, of `ids` (`require.cache`'s keys), that are the
 * native canvas: its package or its platform binding package
 * (`@napi-rs/canvas-win32-x64-msvc`, …), under either path separator.
 */
export function nativeCanvasModules(ids: Iterable<string>): string[] {
  return [...ids].filter((id) =>
    /[\\/]@napi-rs[\\/]canvas(?:-[^\\/]+)?[\\/]/.test(id),
  );
}
