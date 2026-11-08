// @native-canvas
// STAMP-06 adversarial verification: non-PDF numbers in the page dict make
// pdf-lib drop the page object; do the stamping tools succeed on zero pages?
import { describe, expect, it } from "vitest";
import { watermarkPdf } from "@/lib/pdf/watermark";
import { addPageNumbers } from "@/lib/pdf/page-numbers";
import { loadPdfjs } from "@/lib/pdf/pdfjs";
import { buildPdf, onePageObjects } from "./stamping.fixtures";

const CASES: Array<[string, string, string | undefined]> = [
  ["control", "", undefined],
  ["mediabox-1e309", "", "[0 0 1e309 792]"],
  ["mediabox-dot", "", "[0 0 . 792]"],
  ["mediabox-double-minus", "", "[0 0 --5 792]"],
  ["rotate-1e309", "/Rotate 1e309", undefined],
];

async function pdfjsPages(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
    .promise;
  const out: Array<{ w: number; h: number; text: string }> = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    out.push({
      w: Math.round(vp.width * 100) / 100,
      h: Math.round(vp.height * 100) / 100,
      text: tc.items.map((it) => ("str" in it ? it.str : "")).join(" "),
    });
  }
  await (
    doc as unknown as { loadingTask?: { destroy(): Promise<void> } }
  ).loadingTask?.destroy?.();
  return out;
}

describe("STAMP-06 verify", () => {
  for (const [id, extra, box] of CASES) {
    it(
      id,
      async () => {
        const input = buildPdf({ objects: onePageObjects(extra, box) });
        const inPages = await pdfjsPages(input);
        const row: Record<string, unknown> = { id, inPages };
        try {
          const r = await watermarkPdf(input, "HOSTILE");
          row.wm = { pages: r.pages, totalPages: r.totalPages };
          row.wmOut = await pdfjsPages(r.bytes);
        } catch (e) {
          row.wm = `threw: ${(e as Error).message}`;
        }
        try {
          const b = await addPageNumbers(input);
          row.pnOut = await pdfjsPages(b);
        } catch (e) {
          row.pn = `threw: ${(e as Error).message}`;
        }
        console.log("STAMP06", JSON.stringify(row));
        expect(inPages.length).toBe(1);
      },
      30_000,
    );
  }
});
