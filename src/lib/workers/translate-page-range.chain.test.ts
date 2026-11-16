// @vitest-environment node
// @native-canvas
/**
 * The COMPOSED chain for Translate's chosen pages (competitor audit #29,
 * slice 6): panel → client → route → worker → record → panel, each hop the
 * shipped function, over ONE real PDF (`@/tests/translate-page-range-chain`
 * lists the hops).
 *
 * DECLARATION PAIRING. The charge is `ceil(declared × 4)` and the cap the
 * worker runs under is `{ characters: that, pages: declared text pages }`.
 * "The charge equals the chosen pages" holds exactly when the browser
 * declares the SELECTION and the worker walks the same pages under that cap.
 * This file checks both halves meet: the body's `pages` survive the wire,
 * the charge is the selection's (strictly below the whole document's), the
 * cap's pages are the worker's selected text pages, nothing is withheld, and
 * the MARKER TERM is inside the charge: markers are not declared by the
 * browser, they are paid from the cap's slack, so the stored
 * `readingOrder.sentCharacters` (separators included) must not exceed the
 * cap, with `pageMap.markerCharacters > 0` first (the chosen pages form one
 * multi-page chunk, so the marker term exists).
 *
 * LIMIT: pdfjs on both sides proves the pairing, not production (see the
 * harness header): the worker extracts with poppler, whose character counts
 * can differ from pdfjs's by an unbounded factor while the pages agree.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { selectExtraction } from "@/lib/pdf/page-selection";
import { runChain } from "@/tests/translate-page-range-chain";

/** Page 1 blank, page 3 text that is not chosen. */
const LINES = [
  "",
  "CHAINBETA is the second page and it is chosen.",
  "CHAINGAMMA is page three, with text, and it is not chosen at all.",
  "CHAINDELTA is page four, chosen too.",
  "CHAINEPSILON closes it on page five.",
];

async function pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of LINES) {
    const page = doc.addPage([400, 200]);
    if (line) page.drawText(line, { x: 20, y: 100, size: 10, font });
  }
  return doc.save();
}

const CHOSEN: [number, number][] = [
  [2, 2],
  [4, 4],
];

describe("Translate chosen pages: the composed chain", () => {
  it('"2,4": the declaration, the charge, the cap and the worker agree', async () => {
    const bytes = await pdf();
    const chosen = await runChain(bytes, "2,4");
    const whole = await runChain(bytes, "");

    // The body's pages survive the wire.
    expect(chosen.pages).toEqual(CHOSEN);
    expect((chosen.body.options as Record<string, unknown>).pages).toEqual(
      CHOSEN,
    );
    expect(Object.keys(whole.body.options as object)).not.toContain("pages");

    // Charge = ceil(declared × 4), declared = the selection's count, which
    // is strictly less than the whole document's charge.
    const selection = selectExtraction(chosen.extracted, CHOSEN);
    expect(chosen.declaredCharacters).toBe(selection.characterCount);
    expect(chosen.charge).toBe(Math.ceil(selection.characterCount * 4));
    expect(chosen.charge).toBeLessThan(whole.charge);

    // cap.pages = the worker's selected text-page count.
    expect(chosen.cap.pages).toBe(2);
    expect(chosen.declaredTextPages).toBe(2);

    // The worker delivered, withheld nothing, and sent only chosen pages.
    expect(chosen.stage).toBe("delivered");
    expect(chosen.stored?.delivery).toBeUndefined();
    const sent = chosen.segments.join("\n");
    expect(sent).toContain("CHAINBETA");
    expect(sent).toContain("CHAINDELTA");
    expect(sent).not.toContain("CHAINGAMMA");
    expect(sent).not.toContain("CHAINEPSILON");

    // The marker term is inside the charge (health first: it exists).
    expect(chosen.stored?.pageMap?.markerCharacters).toBeGreaterThan(0);
    expect(chosen.stored?.readingOrder?.sentCharacters).toBeLessThanOrEqual(
      chosen.cap.characters,
    );

    // The record and the panel's rollback check.
    expect(chosen.stored?.truncation?.pagesSent).toEqual(CHOSEN);
    expect(chosen.confirmed).toBe(true);
    expect(chosen.manifestPagesSent).toEqual(CHOSEN);
  }, 30_000);

  it("CONTROL: the whole-document run sends every text page and has no echo", async () => {
    const whole = await runChain(await pdf(), "");
    expect(whole.stage).toBe("delivered");
    const sent = whole.segments.join("\n");
    for (const token of [
      "CHAINBETA",
      "CHAINGAMMA",
      "CHAINDELTA",
      "CHAINEPSILON",
    ])
      expect(sent).toContain(token);
    expect(whole.stored?.truncation?.pagesSent).toBeUndefined();
    expect(whole.manifestPagesSent).toBeUndefined();
    expect(whole.confirmed).toBeNull();
  }, 30_000);
});
