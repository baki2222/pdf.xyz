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
import content from "@/lib/tools/content/pdf-to-pdfa";

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

  it('the FAQ\'s "PDF/A1" oddity is true at every level the picker offers', () => {
    // Before the picker, the answer said the notices name PDF/A1 "even though
    // it runs with its PDF/A-2 setting". At PDF/A-1b the setting IS part 1,
    // so that sentence was false for a level the page offers. The oddity is
    // now stated only of a level that is not part 1.
    const sentences = content.faqs
      .flatMap((f) => f.a.split(/(?<=\.)\s+/))
      .filter((s) => s.includes('"PDF/A1"'));
    expect(sentences).toHaveLength(1);
    const [sentence] = sentences as [string];
    expect(sentence).not.toMatch(/setting/i);
    const named = PDFA_LEVELS.filter((l) => sentence.includes(l.standard));
    // Health check: it names the level it is true of.
    expect(named.length).toBeGreaterThan(0);
    for (const level of named) expect(level.part).not.toBe("1");
  });
});
