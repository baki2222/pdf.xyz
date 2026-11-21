/**
 * The audit seed: every class-(a) site of the CI flake audit of 2026-11-19
 * (`.claude/ci-flake-audit-items-2026-11-19.json`, read at E:/wtaudit
 * @19974eeb), as the file and the collapsed text of its comparison. The
 * line is kept for the record only; matching is by text.
 *
 * `wall-clock-bounds.test.ts` holds every entry to the corpus: each must be
 * DETECTED (some member spans that text), ROUTED (the text is gone and the
 * file calls a time-bound helper), or held as a seed-only debt entry. A
 * text that has left its file with no routed call beside it is a stale
 * seed, and fails until the entry is removed with its reason — an example
 * nothing catches is a hole (CLAUDE.md rule 1).
 */
export interface SeedEntry {
  file: string;
  code: string;
  auditLine: number;
}

export const WALL_CLOCK_SEED: readonly SeedEntry[] = [
  {
    file: "src/components/tools/ai-markdown.test.tsx",
    code: "expect(took, name).toBeLessThan(1_500)",
    auditLine: 583,
  },
  {
    file: "src/components/tools/runner/batch/settings-batch-behaviour.dom.test.tsx",
    code: "expect(performance.now() - typedAt).toBeLessThan(500)",
    auditLine: 259,
  },
  {
    file: "src/components/tools/runner/batch/worker-batch.test.ts",
    code: "expect(result.current.resumeAt).toBeGreaterThanOrEqual(before + 1000)",
    auditLine: 375,
  },
  {
    file: "src/components/tools/runner/batch/worker-batch.test.ts",
    code: "expect(result.current.resumeAt).toBeLessThan(before + 1000 + 2000)",
    auditLine: 376,
  },
  {
    file: "src/components/tools/runner/batch/worker-batch.test.ts",
    code: "expect(at).toBeGreaterThanOrEqual(now + 30_000)",
    auditLine: 516,
  },
  {
    file: "src/components/tools/runner/batch/worker-batch.test.ts",
    code: "expect(at).toBeLessThan(now + 31_000)",
    auditLine: 517,
  },
  {
    file: "src/deploy/healthcheck-budget.test.ts",
    code: "expect(run.ms).toBeGreaterThanOrEqual(150)",
    auditLine: 169,
  },
  // HISTORY: the eleven audit sites of form-detect.test.ts (audit lines
  // 979 to 5576: `expect(ms).toBeLessThan(800)` and its kin) were replaced
  // by #386 (merged 2026-11-21) with same-run ratios through the file's own
  // `expectRatioUnder`, whose one assertion the detector cannot see: the
  // ratio arrives through a parameter. Still timing checks a slow runner
  // can fail, so they are held by their assertion's text instead
  // (auditLine 0: the shape landed after the audit). The same for #387's
  // ratio helper in form-detect-precision.test.ts.
  {
    file: "src/lib/pdf/form-detect.test.ts",
    code: "expect(ratio, said).toBeLessThan(bound)",
    auditLine: 0,
  },
  {
    file: "src/lib/pdf/form-detect-precision.test.ts",
    code: "expect(num / den, said).toBeLessThan(bound)",
    auditLine: 0,
  },
  {
    file: "src/lib/pdf/markdown-to-pdf.test.ts",
    code: "expect(elapsed).toBeLessThan(5_000)",
    auditLine: 430,
  },
  {
    file: "src/lib/pdf/markdown-to-pdf.test.ts",
    code: "expect(result.ms).toBeLessThan(30_000)",
    auditLine: 603,
  },
  {
    file: "src/lib/pdf/markdown-to-pdf.test.ts",
    code: "expect(run.flatMs).toBeGreaterThan(0)",
    auditLine: 736,
  },
  {
    file: "src/lib/pdf/markdown-to-pdf.test.ts",
    code: "expect(result.ms).toBeLessThan(run.flatMs * 6 + 2_000)",
    auditLine: 740,
  },
  {
    file: "src/lib/pdf/markdown-to-pdf.test.ts",
    code: "expect(baseline.ms).toBeGreaterThan(0)",
    auditLine: 1524,
  },
  {
    file: "src/lib/pdf/markdown-to-pdf.test.ts",
    code: "expect(run.ms).toBeLessThan(baseline.ms * 10 + 250)",
    auditLine: 1533,
  },
  {
    file: "src/lib/pdf/pdf-page-images.test.ts",
    code: "expect(ms).toBeLessThan(5_000)",
    auditLine: 881,
  },
  {
    file: "src/lib/pdf/pdf-page-images.test.ts",
    code: "expect(ms).toBeLessThan(3_000)",
    auditLine: 1338,
  },
  {
    file: "src/lib/pdf/pdf-page-images.test.ts",
    code: "expect(ms).toBeLessThan(2_000)",
    auditLine: 1502,
  },
  {
    file: "src/lib/pdf/pdf-page-images.test.ts",
    code: "expect(Date.now() - t0).toBeLessThan(3_000)",
    auditLine: 1542,
  },
  {
    file: "src/lib/pdf/pdf-page-images.test.ts",
    code: "expect(ms).toBeLessThan(4_000)",
    auditLine: 1790,
  },
  {
    file: "src/lib/pdf/remove-annotations.test.ts",
    code: "expect(Date.now() - started).toBeLessThan(10_000)",
    auditLine: 649,
  },
  {
    file: "src/lib/pdf/tiff.test.ts",
    code: "expect(Date.now() - started).toBeLessThan(2000)",
    auditLine: 585,
  },
  {
    file: "src/lib/tools/tools.test.ts",
    code: "expect(perQuery).toBeLessThan(2)",
    auditLine: 376,
  },
  {
    file: "src/lib/workers/engines-honour-abort.test.ts",
    code: "expect(elapsed).toBeLessThan(ABORT_BOUND_MS)",
    auditLine: 554,
  },
  {
    file: "src/lib/workers/executor/executor.abort-chain.test.ts",
    code: "expect(Date.now() - stolenAt).toBeLessThan(5_000)",
    auditLine: 158,
  },
  {
    file: "src/lib/workers/office-conversion/errors.test.ts",
    code: "expect(Date.now() - started).toBeLessThan(2_000)",
    auditLine: 144,
  },
  {
    file: "src/lib/workers/pdf-office-export/docx-run-style.cap.test.ts",
    code: "expect(got.ms, JSON.stringify(got)).toBeLessThan(10_000)",
    auditLine: 56,
  },
  {
    file: "src/lib/workers/pdf-office-export/docx-run-style.cap.test.ts",
    code: "expect(got.ms, JSON.stringify(got)).toBeLessThan(60_000)",
    auditLine: 81,
  },
  {
    file: "src/lib/workers/pdf-office-export/docx-run-style.cap.test.ts",
    code: "expect(got.readBackMs, JSON.stringify(got)).toBeLessThan(3_000)",
    auditLine: 82,
  },
  {
    file: "src/lib/workers/pdf-office-export/docx-table.cap.test.ts",
    code: "expect(got.ms, JSON.stringify(got)).toBeLessThan(5_000)",
    auditLine: 52,
  },
  {
    file: "src/lib/workers/pdf-office-export/docx-table.cap.test.ts",
    code: "expect(got.ms, JSON.stringify(got)).toBeLessThan(10_000)",
    auditLine: 62,
  },
  {
    file: "src/lib/workers/pdf-office-export/docx-table.cap.test.ts",
    code: "expect(got.ms, JSON.stringify(got)).toBeLessThan(30_000)",
    auditLine: 86,
  },
  {
    file: "src/lib/workers/pdf-office-export/faithful.test.ts",
    code: "expect(elapsed, `took ${elapsed} ms`).toBeLessThan(8_000)",
    auditLine: 1014,
  },
  {
    file: "src/lib/workers/pdf-text/flow-wraps.test.ts",
    code: "expect(ms).toBeLessThan(2500)",
    auditLine: 1087,
  },
  {
    file: "src/lib/workers/pdf-text/table-grid.test.ts",
    code: "expect(ms).toBeLessThan(50 * Math.max(control, 1))",
    auditLine: 136,
  },
  {
    file: "src/lib/workers/request-signatures/labels-capability.test.ts",
    code: "expect(Date.now() - started).toBeLessThan(5_000)",
    auditLine: 236,
  },
  {
    file: "src/lib/workers/request-signatures/labels-capability.test.ts",
    code: "expect(got.ms, out).toBeGreaterThanOrEqual(250)",
    auditLine: 264,
  },
  {
    file: "src/lib/workers/translate/capability.test.ts",
    code: "expect(Date.now() - before).toBeLessThan(5_000)",
    auditLine: 143,
  },
  {
    file: "src/lib/workers/translate/pdf-capability.chromium.test.ts",
    code: "expect(run.ms).toBeLessThan(TRANSLATE_PDF_RENDER_TIMEOUT_MS)",
    auditLine: 103,
  },
  {
    file: "src/lib/workers/translate/pdf-render.test.ts",
    code: "expect(Date.now() - started).toBeLessThan(5_000)",
    auditLine: 106,
  },
  {
    file: "src/lib/workers/translate/reading-order.measured.test.ts",
    code: "expect(d.bboxMs, d.name).toBeLessThan(TRANSLATE_FLOW_TIMEOUT_MS)",
    auditLine: 61,
  },
  {
    file: "src/tests/hostile/bounded.test.ts",
    code: "expect(r.ms).toBeGreaterThanOrEqual(4_000)",
    auditLine: 18,
  },
  {
    file: "src/tests/hostile/content-isolation.test.ts",
    code: "expect(Date.now() - t0).toBeLessThan(5_000)",
    auditLine: 775,
  },
  {
    file: "src/tests/hostile/content-isolation.test.ts",
    code: "expect(Date.now() - t0).toBeLessThan(10_000)",
    auditLine: 795,
  },
  {
    file: "src/tests/hostile/content-isolation.test.ts",
    code: "expect(got.ms).toBeLessThan(10_000)",
    auditLine: 830,
  },
  {
    file: "src/tests/hostile/content-isolation.test.ts",
    code: "expect(got.ms).toBeLessThan(15_000)",
    auditLine: 859,
  },
  {
    file: "src/tests/hostile/content-isolation.test.ts",
    code: "expect(got.ms).toBeLessThan(5_000)",
    auditLine: 931,
  },
  {
    file: "src/tests/hostile/conversion-in-l09.test.ts",
    code: "expect(r.ms).toBeLessThan(30_000)",
    auditLine: 597,
  },
  {
    file: "src/tests/hostile/decode-budget.test.ts",
    code: "expect(c.ms, said).toBeGreaterThan(0)",
    auditLine: 396,
  },
  {
    file: "src/tests/hostile/decode-budget.test.ts",
    code: "expect(r.ms!, said).toBeLessThan(RATIO_TO_CONTROL * c.ms!)",
    auditLine: 397,
  },
  {
    file: "src/tests/hostile/decode-budget.test.ts",
    code: "expect(r.ms!, said).toBeLessThan(ENTRY_CEILING_MS)",
    auditLine: 398,
  },
  {
    file: "src/tests/hostile/decode-budget.test.ts",
    code: "expect(Date.now() - started).toBeLessThan(30_000)",
    auditLine: 456,
  },
  {
    file: "src/tests/hostile/page-images.test.ts",
    code: "expect(Math.max(...(v.pageMs as number[]))).toBeLessThan(10_000)",
    auditLine: 51,
  },
  {
    file: "src/tests/hostile/pdfjs-board-pages.test.ts",
    code: "expect(ratio, `${big.ms} ms vs ${small.ms} ms`).toBeLessThan(30)",
    auditLine: 175,
  },
  {
    file: "src/tests/hostile/pdfjs-board-pages.test.ts",
    code: "expect(v.ms as number).toBeLessThan(20_000)",
    auditLine: 265,
  },
  {
    file: "src/tests/hostile/pdfjs-board-pages.test.ts",
    code: "expect(v.ms as number).toBeLessThan(60_000)",
    auditLine: 291,
  },
  {
    file: "src/tests/hostile/pdfjs-guard-bounds.test.ts",
    code: "expect(yardstick.msPerMiB, said).toBeGreaterThan(0)",
    auditLine: 94,
  },
  {
    file: "src/tests/hostile/pdfjs-guard-bounds.test.ts",
    code: "expect(judged.reads, detail).toBeLessThan(BUDGET_READS_ALLOWED)",
    auditLine: 156,
  },
  {
    file: "src/tests/hostile/pdfjs-guard-bounds.test.ts",
    code: "expect(judged.ms, detail).toBeLessThan(REFUSAL_CEILING_MS)",
    auditLine: 157,
  },
  {
    file: "src/tests/hostile/pdfjs-guard-bounds.test.ts",
    code: "expect(v.preflightMs as number).toBeLessThan(3_000)",
    auditLine: 318,
  },
  {
    file: "src/tests/hostile/pdfjs-guard-bounds.test.ts",
    code: "expect(v.preflightMs as number).toBeLessThan(8_000)",
    auditLine: 336,
  },
  {
    file: "src/tests/hostile/pdfjs-guard-bounds.test.ts",
    code: "expect(v.renderMs as number).toBeLessThan(10_000)",
    auditLine: 403,
  },
  {
    file: "src/tests/hostile/pdfjs-guard-bounds.test.ts",
    code: "expect(v.renderMs as number).toBeLessThan(500)",
    auditLine: 498,
  },
  {
    file: "src/tests/hostile/res2-field-trees.test.ts",
    code: "expect(ms).toBeLessThan(20_000)",
    auditLine: 54,
  },
  {
    file: "src/tests/hostile/security-bounds.test.ts",
    code: "expect(v.ms as number).toBeLessThan(1_000)",
    auditLine: 72,
  },
  {
    file: "src/tests/hostile/security-bounds.test.ts",
    code: "expect(atLimit.ms as number).toBeLessThan( Math.max(3_000, 4 * (six.ms as number)), )",
    auditLine: 147,
  },
  {
    file: "src/tests/hostile/security-bounds.test.ts",
    code: "expect(v.ms as number, fixture).toBeLessThan(1_000)",
    auditLine: 241,
  },
  {
    file: "src/tests/hostile/security-bounds.test.ts",
    code: "expect(atFloor.ms as number).toBeLessThan( Math.max(5_000, 4 * (six.ms as number)), )",
    auditLine: 252,
  },
  {
    file: "src/tests/hostile/security-bounds.test.ts",
    code: "expect(v.ms as number).toBeLessThan(5_000)",
    auditLine: 301,
  },
  {
    file: "src/tests/hostile/security-legit-headroom.test.ts",
    code: "expect(Date.now() - t0, name).toBeLessThan(ACCESS_DEADLINE_MS / 100)",
    auditLine: 129,
  },
  {
    file: "src/tests/hostile/security-verdicts.test.ts",
    code: "expect(Date.now() - t0).toBeLessThan(5_000)",
    auditLine: 375,
  },
  {
    file: "src/tests/hostile/xref-duplicates.test.ts",
    code: "expect(ms).toBeLessThan(1000)",
    auditLine: 607,
  },
  {
    file: "src/tests/hostile/xref-duplicates.test.ts",
    code: "expect(ms).toBeLessThan(3000)",
    auditLine: 619,
  },
  {
    file: "src/tests/long-child.ts",
    code: "while (Date.now() - started < timeoutMs) …",
    auditLine: 54,
  },
];
