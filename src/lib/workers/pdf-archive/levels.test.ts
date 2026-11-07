import { describe, expect, it } from "vitest";
import {
  DEFAULT_PDFA_LEVEL,
  PDFA_LEVELS,
  PDFA_LEVEL_OPTION,
  parsePdfALevel,
  pdfaLevelForStandard,
} from "./levels";
import { pdfaJobOptions } from "../pdf-archive-client";
import { ghostscriptPdfAArgs } from "./native";
import { PDF_A_STANDARD } from "@/lib/jobs/pdfa-results";

const bytes = new Uint8Array();

describe("PDF/A levels (audit pdf-to-pdfa#1)", () => {
  it("offers 1b, 2b and 3b, conformance B, with PDF/A-2b first as the default", () => {
    expect(PDFA_LEVELS.map((l) => l.standard)).toEqual([
      "PDF/A-2b",
      "PDF/A-1b",
      "PDF/A-3b",
    ]);
    // The page's default constant and the picker's default are one level.
    expect(DEFAULT_PDFA_LEVEL.standard).toBe(PDF_A_STANDARD);
    for (const level of PDFA_LEVELS) {
      // Each name is derived from its own part and conformance.
      expect(level.standard).toBe(
        `PDF/A-${level.part}${level.conformance.toLowerCase()}`,
      );
      expect(level.id).toBe(`${level.part}b`);
      expect(pdfaLevelForStandard(level.standard)).toBe(level);
      // The part Ghostscript is asked for is the level's own.
      expect(
        ghostscriptPdfAArgs("i", "o", "d", "c", level.part).filter((a) =>
          a.startsWith("-dPDFA="),
        ),
      ).toEqual([`-dPDFA=${level.part}`]);
    }
  });

  it("what the panel sends is what the worker reads back, for every level", () => {
    for (const level of PDFA_LEVELS) {
      const bag = pdfaJobOptions({ filename: "a.pdf", bytes, level: level.id });
      expect(parsePdfALevel(bag)).toEqual({ ok: true, value: level });
    }
  });

  it("CONTROL: the default sends the empty bag the tool always sent", () => {
    expect(pdfaJobOptions({ filename: "a.pdf", bytes })).toEqual({});
    expect(pdfaJobOptions({ filename: "a.pdf", bytes, level: "2b" })).toEqual(
      {},
    );
    expect(pdfaJobOptions({ filename: "a.pdf", bytes, level: "1b" })).toEqual({
      [PDFA_LEVEL_OPTION]: "1b",
    });
  });

  it("refuses a level it does not offer, never mapping it to a nearby one", () => {
    for (const raw of ["2a", "2u", "1a", "4b", 2, null])
      expect(parsePdfALevel({ [PDFA_LEVEL_OPTION]: raw }).ok).toBe(false);
  });
});
