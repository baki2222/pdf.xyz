// @native-canvas
/**
 * STAMP-10 verify: a page whose MediaBox is [0 0 0 0]. pdfjs shows it as a
 * 612x792 page (it falls back to Letter for an empty box); the stamping
 * engines read the 0x0 box literally. Fixture built here independently with
 * pdf-lib (not the matrix's raw builder), plus the matrix's own input.
 */
import { PDFDocument, PDFName, PDFArray, PDFNumber, decodePDFRawStream, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import { inputById, runEngine } from "./stamping.cells";

async function zeroBoxPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("Body text", { x: 72, y: 700, size: 24 });
  page.node.set(
    PDFName.of("MediaBox"),
    doc.context.obj([0, 0, 0, 0].map((n) => PDFNumber.of(n))) as PDFArray,
  );
  return doc.save({ useObjectStreams: false });
}

async function viewport(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const text = await page.getTextContent();
  const items = text.items
    .map((it) => ("str" in it ? `${JSON.stringify(it.str)}@${it.transform.slice(4).map((n: number) => n.toFixed(1)).join(",")}` : ""))
    .join(" ");
  await task.destroy();
  return `${vp.width}x${vp.height} view=${JSON.stringify(page.view)} text: ${items}`;
}

async function lastContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const contents = doc.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const last = doc.context.lookup(refs[refs.length - 1]!) as PDFRawStream;
  const s = new TextDecoder("latin1").decode(decodePDFRawStream(last).decode());
  return s.replace(/\s+/g, " ").slice(0, 400);
}

const ENGINES = ["watermark-text", "watermark-image", "page-numbers", "bates", "header-footer", "sign-typed"] as const;

describe("STAMP-10 verify", () => {
  for (const source of ["independent", "matrix"] as const) {
    it(
      source,
      async () => {
        const bytes = source === "independent" ? await zeroBoxPdf() : (await inputById("H10-mediabox-zero")).bytes;
        console.log(`[${source}] input pdfjs: ${await viewport(bytes)}`);
        for (const engine of ENGINES) {
          try {
            const out = await runEngine(engine, bytes);
            console.log(`  ${engine}: OUTPUT pdfjs: ${await viewport(out)}`);
            console.log(`    stamp ops: ${await lastContent(out)}`);
          } catch (e) {
            const kind = e instanceof PdfEngineError ? "refused" : `internal ${(e as Error).constructor.name}`;
            console.log(`  ${engine}: ${kind}: ${(e as Error).message}`);
          }
        }
        expect(true).toBe(true);
      },
      60_000,
    );
  }
});
