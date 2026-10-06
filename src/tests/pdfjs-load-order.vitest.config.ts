import { relative } from "node:path";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import base from "../../vitest.config";

/**
 * The config `pdfjs-load-order.test.ts` runs a child vitest with: the suite's
 * own config, with the files run in ONE worker in a stated order.
 *
 * The order arrives as JSON in `PDFJS_LOAD_ORDER` (repo-relative paths), so
 * the test that derives the set is the only place it is written down. Files
 * not in the list sort last; the test checks that every listed file ran, in
 * order, from the JSON report's start times — a sequencer that silently
 * ignored this list would otherwise make the check pass vacuously.
 *
 * `pdfjs-load-order.probe.ts` is added to the setup files to record, per file,
 * whether `DOMMatrix` existed when the file started and when it ended.
 */
const ORDER = JSON.parse(process.env.PDFJS_LOAD_ORDER ?? "[]") as string[];

const repoPath = (spec: TestSpecification) =>
  relative(process.cwd(), spec.moduleId).replaceAll("\\", "/");

class ListedOrder extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    const rank = (spec: TestSpecification) => {
      const at = ORDER.indexOf(repoPath(spec));
      return at === -1 ? ORDER.length : at;
    };
    return [...files].sort((a, b) => rank(a) - rank(b));
  }
}

const baseSetup = base.test?.setupFiles ?? [];

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    // The worker-CLI precompile is for the CLI smoke tests; none run here.
    globalSetup: [],
    setupFiles: [
      ...(Array.isArray(baseSetup) ? baseSetup : [baseSetup]),
      "./src/tests/pdfjs-load-order.probe.ts",
    ],
    sequence: { sequencer: ListedOrder, shuffle: false },
  },
});
