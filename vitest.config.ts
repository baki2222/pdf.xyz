import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    // Default to the fast Node environment: the overwhelming majority of the suite
    // is worker/library logic that never touches the DOM, and booting jsdom for
    // every one of those ~900 files dominated wall-clock (≈1s/file of pure
    // environment setup — the single largest cost in a full `vitest run`). The
    // handful of React component tests opt back into jsdom with a per-file
    // `// @vitest-environment jsdom` docblock (mirroring the existing `node`
    // docblock convention used across the worker tests).
    environment: "node",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    // This suite is very large (~900 files) and shares a deep, mostly-pure worker
    // import graph. With per-file isolation (the default) every file re-imports and
    // re-transforms that whole graph in a fresh module registry, which made a full
    // run take far longer than the CI unit step could tolerate (it never finished).
    // Run on the threads pool WITHOUT isolation so files sharing a worker reuse the
    // module cache — the tests are pure/content-free and carry no cross-file module
    // state, so this is safe and cuts the full-suite wall-clock by ~3×.
    pool: "threads",
    isolate: false,
  },
});
