/**
 * A setup file, in both projects: a test file that loads the native canvas
 * where it may not FAILS — judged by what it loaded, not by what it imports.
 * The defect and the rule are in `./native-canvas`.
 *
 *  - In a worker thread, loading it at all fails the file. The threads
 *    project excludes every marked file, so this is a file that loads the
 *    module without `// @native-canvas` — or a config that lost the project
 *    that keeps them off threads.
 *  - In a fresh process (the native-canvas project runs each file in its own
 *    fork), a MARKED file that ran and passed every one of its tests without
 *    loading it fails too: a stale marker moves a file off threads for
 *    nothing, and a set that only grows is the defect this guards against in
 *    the other direction.
 *
 * Nothing is judged where nothing can be told: when the module was already
 * loaded as the file began (a process or thread shared with earlier files),
 * or when a test was skipped, filtered out or failed.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isMainThread } from "node:worker_threads";
import { afterAll } from "vitest";
import { NATIVE_CANVAS_MARKER, nativeCanvasModules } from "./native-canvas";

const cache = createRequire(import.meta.url).cache;
const loaded = () => nativeCanvasModules(Object.keys(cache));
/** Loaded before this file began: then nothing can be told about it. */
const before = loaded().length > 0;

interface Task {
  type: string;
  mode: string;
  tasks?: Task[];
  result?: { state?: string };
  file?: { filepath: string };
  filepath?: string;
}

const tests = (task: Task): Task[] =>
  task.type === "test" ? [task] : (task.tasks ?? []).flatMap(tests);

// vitest hands a hook the suite SECOND, after a fixtures object it requires
// to be destructured.
afterAll(({}, suite) => {
  if (before) return;
  const now = loaded();
  if (!isMainThread) {
    if (now.length > 0)
      throw new Error(
        `This test file loaded @napi-rs/canvas (${now[0]}) in a worker THREAD. ` +
          "A native module there can crash the whole run as the threads shut down " +
          "(exit 139: 3 runs in 100, measured 2026-10-11). Add the line " +
          '"// @native-canvas" to the file: vitest.config.ts then runs it in the ' +
          "native-canvas project, on the forks pool. See src/tests/native-canvas.ts.",
      );
    return;
  }
  if (now.length > 0) return;
  const file = suite as unknown as Task;
  const all = tests(file);
  if (
    all.length === 0 ||
    !all.every((t) => t.mode === "run" && t.result?.state === "pass")
  )
    return;
  const path = file.file?.filepath ?? file.filepath;
  if (!path || !NATIVE_CANVAS_MARKER.test(readFileSync(path, "utf8"))) return;
  throw new Error(
    'This test file is marked "// @native-canvas" but ran every one of its ' +
      "tests without loading @napi-rs/canvas. Remove the marker: it moves the " +
      "file off the threads pool for nothing. See src/tests/native-canvas.ts.",
  );
});
