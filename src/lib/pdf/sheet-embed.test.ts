import { PDFDocument } from "pdf-lib";
import * as pdfLib from "pdf-lib";
import { describe, expect, it } from "vitest";
import { BOOKLET_LAYOUT_REFUSAL } from "./booklet";
import { PdfDecodeBudgetError } from "./decode-budget";
import { PdfEngineError } from "./engine";
import { repairFieldTree } from "./form-tree";
import { N_UP_LAYOUT_REFUSAL } from "./n-up";
import { embedSourcePages } from "./sheet-embed";

/**
 * The page embedding Multiple Pages per Sheet and Booklet share. Its refusal
 * is the CALLER's sentence, so each stays in that tool's walked phrase module
 * (copy-surface.ts walks n-up.ts and booklet.ts; sheet-embed.ts holds none).
 */

async function onePage(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]).drawText("X", { x: 10, y: 10 });
  return PDFDocument.load(await doc.save());
}

/** A destination whose embed fails the way pdf-lib's does on a bad stream. */
function failingOut(error: unknown): PDFDocument {
  return {
    embedPages: async () => {
      throw error;
    },
  } as unknown as PDFDocument;
}

describe("embedSourcePages", () => {
  for (const refusal of [N_UP_LAYOUT_REFUSAL, BOOKLET_LAYOUT_REFUSAL]) {
    it(`refuses with the caller's sentence: "${refusal.slice(0, 40)}…"`, async () => {
      const err = await embedSourcePages(
        pdfLib,
        await onePage(),
        failingOut(new Error("Unknown filter")),
        repairFieldTree,
        refusal,
      ).catch((e) => e);
      expect(err).toBeInstanceOf(PdfEngineError);
      expect((err as Error).message).toBe(refusal);
    });
  }

  it("lets the decode budget's own refusal through", async () => {
    const budget = new PdfDecodeBudgetError("Page 1");
    const err = await embedSourcePages(
      pdfLib,
      await onePage(),
      failingOut(budget),
      repairFieldTree,
      N_UP_LAYOUT_REFUSAL,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PdfDecodeBudgetError);
  });

  it("embeds every page with content, by index (positive control)", async () => {
    const out = await PDFDocument.create();
    const r = await embedSourcePages(
      pdfLib,
      await onePage(),
      out,
      repairFieldTree,
      N_UP_LAYOUT_REFUSAL,
    );
    expect([...r.byIndex.keys()]).toEqual([0]);
    expect(r.undrawnFields).toEqual([]);
  });
});
