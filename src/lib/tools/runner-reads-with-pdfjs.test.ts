// @vitest-environment node
import { describe, expect, it } from "vitest";
import { supportedToolSlugs } from "@/lib/pdf/registry";
import { runnerReadsWithPdfjs } from "./tool-facts";

/**
 * Which tool pages warm pdf.js and its worker when a file arrives. The set is
 * derived from `RUNNER_MID_RUN_FETCHES`, which `offline-answer.test.ts` holds
 * to each runner's call graph in both directions; this holds the derivation
 * to what the warm-up is for.
 */
describe("runnerReadsWithPdfjs", () => {
  const warmed = supportedToolSlugs.filter(runnerReadsWithPdfjs);

  it("health: the set is neither empty nor everything", () => {
    expect(supportedToolSlugs.length).toBeGreaterThanOrEqual(20);
    expect(warmed.length).toBeGreaterThanOrEqual(5);
    expect(warmed.length).toBeLessThan(supportedToolSlugs.length);
  });

  it("positive controls: the two tools measured on production 2026-10-29", () => {
    expect(runnerReadsWithPdfjs("compare-pdf")).toBe(true);
    expect(runnerReadsWithPdfjs("pdf-to-jpg")).toBe(true);
  });

  it("negative controls: runners that never evaluate a page with pdf.js", () => {
    // Compress and JPG to PDF reach pdf.js only through the encryption probe
    // (metadata, a locked file) or not at all — no warm-up for them.
    expect(runnerReadsWithPdfjs("compress-pdf")).toBe(false);
    expect(runnerReadsWithPdfjs("jpg-to-pdf")).toBe(false);
    // A tool with no in-browser runner is not answered: false.
    expect(runnerReadsWithPdfjs("word-to-pdf")).toBe(false);
  });
});
