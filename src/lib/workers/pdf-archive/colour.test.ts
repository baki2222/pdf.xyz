import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFA_COLOUR_NOTE, PDFA_COLOUR_STRATEGY } from "./colour";
import { ghostscriptPdfAArgs } from "./native";
import content from "@/lib/tools/content/pdf-to-pdfa";
import { guides } from "@/lib/guides/catalog";

/**
 * Audit pdf-to-pdfa#5: the argv converts every colour to RGB, and neither
 * the panel nor the page said so. The sentence and the flag are one
 * constant; this pins that the flag Ghostscript is given IS that constant,
 * and that the reader is shown the sentence where they decide.
 */
describe("PDF to PDF/A says its colours become RGB", () => {
  it("the strategy in the sentence is the one in the argv", () => {
    for (const part of ["1", "2", "3"] as const) {
      const strategies = ghostscriptPdfAArgs("i", "o", "d", "c", part).filter(
        (a) => a.startsWith("-sColorConversionStrategy="),
      );
      expect(strategies).toEqual([
        `-sColorConversionStrategy=${PDFA_COLOUR_STRATEGY}`,
      ]);
    }
    expect(PDFA_COLOUR_NOTE).toMatch(/CMYK/);
    expect(PDFA_COLOUR_NOTE).toContain(PDFA_COLOUR_STRATEGY);
  });

  it("the page's intro and the guide serve the sentence", () => {
    expect(content.intro.join("\n")).toContain(PDFA_COLOUR_NOTE);
    const guide = guides.find((g) => g.slug === "how-to-convert-pdf-to-pdfa");
    expect(JSON.stringify(guide)).toContain(PDFA_COLOUR_NOTE);
  });

  it("the panel renders it before Run", () => {
    const panel = readFileSync(
      "src/components/tools/pdf-archive-worker-panel.tsx",
      "utf8",
    );
    expect(panel).toMatch(/\{PDFA_COLOUR_NOTE\}/);
    expect(panel.indexOf("{PDFA_COLOUR_NOTE}")).toBeLessThan(
      panel.indexOf("<WorkerGate"),
    );
  });
});
