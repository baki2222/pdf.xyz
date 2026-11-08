// @native-canvas
/**
 * STAMP-09 adversarial verify: unbalanced q/Q in the base page content
 * leaks the page's CTM into the stamp appended by pdf-lib.
 *
 * Independent of the matrix: builds its own fixture with pdf-lib's raw
 * content stream, stamps with addPageNumbers, then reads the stamp's
 * position and size back with pdfjs (the consumer's view).
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { addPageNumbers } from "@/lib/pdf/page-numbers";

const TEXT = "BT /F1 24 Tf 72 700 Td (x) Tj ET";

async function fixture(content: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont("Helvetica");
  page.node.setFontDictionary(PDFName.of("F1"), font.ref);
  const stream = doc.context.flateStream(content);
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  return doc.save();
}

async function stampItem(bytes: Uint8Array) {
  const { readAsViewer } = await import("../pdfjs-viewer");
  const pages = await readAsViewer(bytes);
  return pages[0]!.runs
    .filter((r) => /Page\s*1/.test(r.str))
    .map((r) => ({
      str: r.str,
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round((r.endX - r.x) * 10) / 10,
    }));
}

const CASES: Array<[string, string]> = [
  ["control", `${TEXT}`],
  ["balanced q cm Q", `q 0.1 0 0 0.1 0 0 cm ${TEXT} Q`],
  ["one surplus Q then scale", `Q\n0.1 0 0 0.1 0 0 cm\n${TEXT}`],
  ["finding: Q x100000 then scale", `${"Q\n".repeat(100_000)}0.1 0 0 0.1 0 0 cm\n${TEXT}`],
  ["one unclosed q scale", `${TEXT}\nq 0.1 0 0 0.1 0 0 cm\n`],
  ["unclosed q scale + 2 more q", `${TEXT}
q 0.1 0 0 0.1 0 0 cm
q
q
`],
  ["unclosed cm, no q (common sloppy generator)", `0.1 0 0 0.1 0 0 cm\n${TEXT}`],
];

describe("STAMP-09 verify", () => {
  for (const [name, content] of CASES) {
    it(
      name,
      async () => {
        const out = await addPageNumbers(await fixture(content));
        const items = await stampItem(out);
        console.log(`[STAMP-09] ${name}: ${JSON.stringify(items)}`);
        expect(items.length).toBeGreaterThan(0);
      },
      60_000,
    );
  }
});
