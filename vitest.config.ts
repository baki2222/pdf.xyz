import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { nativeCanvasTestFiles } from "./src/tests/native-canvas";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

const resolve = {
  alias: {
    // The home desk without its `next/dynamic` boundary, which renders
    // nothing outside Next; see the module for why and what guards it.
    "@/components/intent/hero-desk-island": fileURLToPath(
      new URL("./src/tests/hero-desk-island.tsx", import.meta.url),
    ),
  },
};

/**
 * The test files that load `@napi-rs/canvas` — read from the files
 * themselves (`// @native-canvas`), never typed here. Why they need a pool of
 * their own, and how the marker is held to what each file really loads, is
 * in `src/tests/native-canvas.ts`.
 */
const NATIVE_CANVAS = nativeCanvasTestFiles(ROOT);

/**
 * `--exclude` from the command line, for every project. Vitest 4 applies it
 * to the ROOT project only (`cliExclude` is resolved into the root's config
 * and is not among the CLI options it hands to `test.projects`), so once the
 * suite was split into projects it silently excluded nothing: `pnpm test`,
 * which excludes the seven bundle tests that need a build, listed all seven.
 * `native-canvas-pool.test.ts` holds `pnpm test`'s file list to its script.
 */
export function cliExclude(argv: readonly string[]): string[] {
  return argv.flatMap((arg, i) =>
    arg === "--exclude" && argv[i + 1] !== undefined
      ? [argv[i + 1]!]
      : arg.startsWith("--exclude=")
        ? [arg.slice("--exclude=".length)]
        : [],
  );
}
const CLI_EXCLUDE = cliExclude(process.argv);

/**
 * What every project runs with; each project adds its pool, and the
 * native-canvas project one setup file of its own. Exported for
 * `src/tests/pdfjs-load-order.vitest.config.ts`, which runs a child vitest
 * with the suite's own options.
 */
export const sharedTestOptions: {
  environment: "node";
  globals: boolean;
  setupFiles: string[];
  css: boolean;
} = {
  // Default to the fast Node environment: the overwhelming majority of the suite
  // is worker/library logic that never touches the DOM, and booting jsdom for
  // every one of those ~900 files dominated wall-clock (≈1s/file of pure
  // environment setup — the single largest cost in a full `vitest run`). The
  // handful of React component tests opt back into jsdom with a per-file
  // `// @vitest-environment jsdom` docblock (mirroring the existing `node`
  // docblock convention used across the worker tests).
  environment: "node",
  globals: true,
  // `native-canvas-guard` fails a file that loads the native canvas where it
  // may not: in a worker thread, or (a stale marker) not at all.
  setupFiles: ["./src/tests/setup.ts", "./src/tests/native-canvas-guard.ts"],
  css: false,
};

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve,
  test: {
    // Compile every `scripts/worker-*.ts` entrypoint once (~1.8s) before any test runs, so the
    // ~1.2k CLI smoke spawns exec plain `node` rather than paying tsx's ~0.61s loader bootstrap
    // each time (~730 CPU-seconds of pure overhead — the reason the `pnpm qa` vitest step blew its
    // wall-clock budget). Falls back to tsx if the precompile is unavailable.
    //
    // Root only: the root project's global setup runs once per run whatever
    // projects run, and the projects below do not inherit it (no `extends`),
    // so it is not compiled once per project.
    globalSetup: ["./src/tests/worker-cli-precompile.ts"],
    projects: [
      {
        plugins: [tsconfigPaths(), react()],
        resolve,
        test: {
          ...sharedTestOptions,
          name: "threads",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: [
            ...configDefaults.exclude,
            ...NATIVE_CANVAS,
            ...CLI_EXCLUDE,
          ],
          // This suite is very large (~900 files) and shares a deep, mostly-pure worker
          // import graph. With per-file isolation (the default) every file re-imports and
          // re-transforms that whole graph in a fresh module registry, which made a full
          // run take far longer than the CI unit step could tolerate (it never finished).
          // Run on the threads pool WITHOUT isolation so files sharing a worker reuse the
          // module cache — the tests are pure/content-free and carry no cross-file module
          // state, so this is safe and cuts the full-suite wall-clock by ~3×.
          //
          // THAT LAST CLAIM IS NOW CHECKED RATHER THAN ASSERTED, because it stopped
          // being true and a comment cannot fail. A test file mocked a module and
          // evaluated a route that binds to it; the route stayed in this shared cache
          // bound to the stub, so the next file in the same worker ran against it.
          // Green everywhere except Linux CI — file-to-worker assignment follows the
          // CPU count, so only some machines put the two files in one thread.
          // `src/tests/mock-isolation.test.ts` is the guard. It carries the two probes
          // that established the mechanism, and its own exit condition is this line:
          // restore isolation and it should be deleted, not relaxed.
          pool: "threads",
          isolate: false,
        },
      },
      {
        plugins: [tsconfigPaths(), react()],
        resolve,
        test: {
          ...sharedTestOptions,
          name: "native-canvas",
          include: NATIVE_CANVAS,
          exclude: [...configDefaults.exclude, ...CLI_EXCLUDE],
          // Child processes, not threads: the native module is unloaded with
          // a process, never at a worker thread's teardown — where it crashed
          // the run (exit 139: 3 times in 100 as measured when these tests
          // arrived; 1 in 100 re-measured on Node 22 on 2026-10-11).
          //
          // One process PER FILE, and that is load-bearing. pdf.js's Node
          // build polyfills `DOMMatrix` on globalThis as it loads, and
          // `loadPdfjs` (src/lib/pdf/pdfjs.ts) takes the BROWSER build
          // wherever `DOMMatrix` exists — so in a process shared with an
          // earlier pdf.js user, a later file is handed the browser build and
          // its fake worker cannot start. Every file here uses pdf.js; shared
          // (isolate: false), `ai-read-declaration.chain.test.ts` failed that
          // way in 4 of 25 runs on Node 22. Isolated, each file imports its
          // graph cold: `src/tests/runner-mounted.ts` waits for that.
          pool: "forks",
          isolate: true,
          // ...and pdf.js cold, inside the first test that calls it — up to
          // 1.3 s, against testing-library's 1 s waits, under parallel load
          // (2026-10-11). This project alone loads pdf.js before each file's
          // tests; `src/tests/native-canvas-warm.test.ts` has the defect and
          // checks the state each file begins in.
          setupFiles: [
            ...sharedTestOptions.setupFiles,
            "./src/tests/native-canvas-warm.ts",
          ],
        },
      },
    ],
  },
});
