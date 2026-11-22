import type { PendingEntry } from "./time-bound-core";

/**
 * Measure-mode bounds that have no speed-independent witness yet.
 *
 * Measure mode records a timing and never fails on it. That is the right
 * start for a bound nobody has measured on CI (design 1.6) — and, unchecked,
 * a switch that turns a regression detector off (critic P6, CLAUDE.md rule
 * 2). So a measure-mode call must either name a `witness` — an assertion in
 * the SAME test on a count, a byte length or a shape, which catches the
 * defect whatever the runner's speed (#382's JPEG-encode count is the model)
 * — or be listed here with the reason it has none yet.
 *
 * The guard (`wall-clock-bounds.test.ts`) holds this list both ways: every
 * entry names a measure-mode call that exists and has no witness, and the
 * list never exceeds {@link PENDING_CAP}. The vitest reporter prints every
 * entry on every CI run.
 */
export const PENDING_CAP = 25;

export const WALL_CLOCK_PENDING: readonly PendingEntry[] = [
  {
    id: "S4 entry boxes",
    file: "src/lib/pdf/form-detect-boxes-cost.test.ts",
    reason:
      "The entry-box rule's cost must stay linear in the page's boxes, and only this ratio sees a quadratic step: the test's health checks cover what the rule returns, not what it costs. Back to assert once 5 CI runs calibrate the id (bound 45 against 16.7 to 21.6 measured; mutants 74 to 232).",
  },
  {
    id: "S4 stacks",
    file: "src/lib/pdf/form-detect-boxes-cost.test.ts",
    reason:
      "The stacked-line rule's cost must stay linear in the page's stacks, and only this ratio sees a quadratic step: the test's health checks cover what the rule returns, not what it costs. Back to assert once 5 CI runs calibrate the id (bound 45 against 17.1 to 20.5 measured; mutants 74 to 94).",
  },
  {
    id: "ai-markdown-shape-vs-prose",
    file: "src/components/tools/ai-markdown.test.tsx",
    reason:
      "A parse whose cost blows up on a 200 KB shape (closer search unbounded) returns the same blocks, so no count in the test moves: `reached` stayed true under CLOSER_TRIES 4096 (witness audit 2026-11-22). Only time sees it; meanwhile the sibling test's 5 s backstop fails on it. Back to assert once 5 CI runs calibrate the id.",
  },
  {
    id: "ai-markdown-shape-ceiling",
    file: "src/components/tools/ai-markdown.test.tsx",
    reason:
      "The same parse blowup as an absolute per-call ceiling: the output is unchanged, so only time sees it (CLOSER_TRIES 4096 left `reached` true); meanwhile the sibling test's 5 s backstop fails on it. Back to assert once 5 CI runs calibrate the id.",
  },
  {
    id: "md-nested-vs-brackets",
    file: "src/lib/pdf/markdown-to-pdf.test.ts",
    reason:
      "Nested labels read once per level (MAX_LABEL_DEPTH 128) print the same text, so `levels` stays k and only time sees the cost; meanwhile the row's 15 s timeout fails on it (34 s a row in the witness audit, 2026-11-22). Back to assert once 5 CI runs calibrate the id.",
  },
  {
    id: "md-nested-ceiling",
    file: "src/lib/pdf/markdown-to-pdf.test.ts",
    reason:
      "The same depth blowup as an absolute 6 s ceiling: the printed text is unchanged, so only time sees it; meanwhile the row's 15 s timeout fails on it. Back to assert once 5 CI runs calibrate the id.",
  },
  {
    id: "md-table-render",
    file: "src/lib/pdf/markdown-to-pdf.test.ts",
    reason:
      "A table render that takes past 30 s in the child draws the same cells, so `cells` cannot see it (a 35 s busy-wait in drawTable passed, witness audit 2026-11-22); only time sees it, and meanwhile only the child's 100 s kill fails. Back to assert once 5 CI runs calibrate the id.",
  },
  {
    id: "ppi-walk-bound-vs-yardstick",
    file: "src/lib/pdf/pdf-page-images.test.ts",
    reason:
      "The map's walk slowed 8-12x does the same decodes, so `decodes` (the summary cache) cannot see it: a 6 s busy-wait in PageImages.map left it at its count (witness audit 2026-11-22). Only time sees it; meanwhile the row timeouts (5 s, 15 s) fail on it. Back to assert once 5 CI runs calibrate the id.",
  },
  {
    id: "ppi-walk-bound-ceiling",
    file: "src/lib/pdf/pdf-page-images.test.ts",
    reason:
      "The same walk slowdown as an absolute 6 s ceiling: the decodes are unchanged, so only time sees it; meanwhile the row timeouts fail on it. Back to assert once 5 CI runs calibrate the id.",
  },
  {
    id: "docx-run-style-read-back",
    file: "src/lib/workers/pdf-office-export/docx-run-style.cap.test.ts",
    reason:
      "A slow or quadratic read-back (inspectDocxStructure plus docxPageTexts) returns the same texts, and `structureParses` counts the engine's parses, not the read-back's work (731 ms against 259 with the count still 1, witness audit 2026-11-22). Only time sees it. Back to assert once 5 CI runs calibrate the id.",
  },
  {
    id: "table-grid-whole-vs-chunked",
    file: "src/lib/workers/pdf-text/table-grid.test.ts",
    reason:
      "A column lookup by identity scan in tableGrid is quadratic and reads no cell, so neither `columns` nor the counted reads move (witness audit 2026-11-22, `all.indexOf(c)`). Only time sees it. Back to assert once 5 CI runs calibrate the id.",
  },
  {
    id: "chain-columns-one-vs-chunked",
    file: "src/lib/workers/pdf-text/table-grid.test.ts",
    reason:
      "A copying push in chainColumns builds the same groups, so `spans` stays 2 while the call goes quadratic (witness audit 2026-11-22: 10.6 s against about 1 s). Only time sees it. Back to assert once 5 CI runs calibrate the id.",
  },
];
