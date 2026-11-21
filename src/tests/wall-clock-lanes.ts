/**
 * Which fix lane of the CI flake programme owns a file
 * (`.claude/ci-flake-audit-design-2026-11-19.md`, section 4: "no file in two
 * lanes"). The debt generator tags each entry with it, so a lane's PR can
 * find and delete exactly its own entries.
 *
 * The named files are the design's lists, matched by path suffix; a file the
 * design does not name falls to the lane of its kind (e2e → 5, hostile → 2,
 * DOM → 3 or 4 by pool, otherwise node-side → 1b for a comparison, 1a for a
 * sleep). `wall-clock-bounds.test.ts` holds every tag to this function.
 */

export type Lane = "1a" | "1b" | "2" | "3" | "4" | "5";
export const LANES: readonly Lane[] = ["1a", "1b", "2", "3", "4", "5"];

const NAMED: [Lane, readonly string[]][] = [
  [
    "1a",
    [
      "app/guides/guide-layout.test.tsx",
      "app/guides/guide-page.test.tsx",
      "lib/pdf/page-retrieval.eval.test.ts",
      "lib/ratelimit/rate-limiting-doc.test.ts",
      "translate/radical-equivalents.test.ts",
      "translate/chunking.markers.test.ts",
      "translate/reading-order.chain.test.ts",
      "lib/pdf/text-page-setup.test.ts",
      "lib/tools/tool-page-substance.test.ts",
      "lib/workers/options-proof.test.ts",
      "lib/workers/engines-honour-abort.test.ts",
      "html-render/native.chromium.test.ts",
      "src/tests/pdfjs-load-order.test.ts",
      "compare/compare-result.test.tsx",
      "deploy/healthcheck-budget.test.ts",
      "src/tests/poll-leak-guard.ts",
    ],
  ],
  [
    "1b",
    [
      "lib/pdf/form-detect.test.ts",
      "lib/pdf/form-detect-precision.test.ts",
      "components/tools/ai-markdown.test.tsx",
      "lib/pdf/markdown-to-pdf.test.ts",
      "lib/pdf/pdf-page-images.test.ts",
      "lib/tools/tools.test.ts",
      "pdf-text/table-grid.test.ts",
      "runner/bookmarks-editor.test.tsx",
      "docx-run-style.cap.test.ts",
      "docx-table.cap.test.ts",
      "src/tests/docx-run-style-measure.ts",
      "src/tests/docx-table-measure.ts",
      "translate/engine.reading-order.test.ts",
    ],
  ],
  [
    "3",
    [
      "src/tests/drop-sheets-live.ts",
      "lib/probes/ai-proof-declaration.test.tsx",
      "lib/telemetry/tool-outcome.test.tsx",
    ],
  ],
  [
    "4",
    [
      "runner/use-batch-runner.test.tsx",
      "lib/tools/booklet-n-up-copy.test.tsx",
      "upload/drop-sheet.test.tsx",
      "layout/site-landmarks.test.tsx",
    ],
  ],
];

/** The lane that owns `file`; `nativeCanvas` says which pool a DOM file runs in. */
export function laneOf(
  file: string,
  family: "comparison" | "sleep",
  nativeCanvas: (file: string) => boolean,
): Lane {
  for (const [lane, files] of NAMED)
    if (files.some((f) => file.endsWith(f))) return lane;
  if (file.startsWith("e2e/")) return "5";
  if (file.startsWith("src/tests/hostile/")) return "2";
  if (file.endsWith(".tsx") || /\.dom\.test\./.test(file))
    return nativeCanvas(file) ? "3" : "4";
  return family === "comparison" ? "1b" : "1a";
}
