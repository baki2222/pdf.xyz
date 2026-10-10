/**
 * A setup file, in both projects: a test file that loads the native canvas
 * in a worker THREAD fails — judged by what it LOADED, at the point of
 * consumption, not by what it imports. The defect and the rule are in
 * `./native-canvas`. The threads project excludes every marked file, so a
 * failure here is a file that loads the module without `// @native-canvas`,
 * or a config that lost the project that keeps them off threads.
 *
 * Nothing is judged where nothing can be told: when the module was already
 * loaded as the file began, in a thread shared with earlier files.
 *
 * ── WHAT THIS DOES NOT JUDGE, AND WHY ───────────────────────────────────────
 *
 * Its first version also failed a MARKED file that ran every test without
 * loading the module, as a stale marker. That rested on one run proving a
 * file never loads it, and it does not: `rotate-runner.test.tsx` loads pdf.js
 * from a thumbnail render that races the test's end, and on Node 22 the
 * check failed that correctly marked file in 5 of 25 runs (2026-10-11). A
 * stale marker is now caught where it can be told for certain, from the
 * file's imports: `native-canvas-pool.test.ts`.
 */
import { createRequire } from "node:module";
import { isMainThread } from "node:worker_threads";
import { afterAll } from "vitest";
import { nativeCanvasModules } from "./native-canvas";

const cache = createRequire(import.meta.url).cache;
const loaded = () => nativeCanvasModules(Object.keys(cache));
/** Loaded before this file began: then nothing can be told about it. */
const before = loaded().length > 0;

afterAll(() => {
  if (before || isMainThread) return;
  const now = loaded();
  if (now.length > 0)
    throw new Error(
      `This test file loaded @napi-rs/canvas (${now[0]}) in a worker THREAD. ` +
        "A native module there can crash the whole run as the threads shut down " +
        "(exit 139: 3 runs in 100 measured on the threads pool, 2026-10-11). Add " +
        'the line "// @native-canvas" to the file: vitest.config.ts then runs it ' +
        "in the native-canvas project, on the forks pool. See " +
        "src/tests/native-canvas.ts.",
    );
});
