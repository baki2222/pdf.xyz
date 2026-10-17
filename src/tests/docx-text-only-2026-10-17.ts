/**
 * The .docx PDF to Word wrote from the wave-1 L03 merge (2026-09-28) until
 * 2026-10-17 — VENDORED, as an artifact of record, from `docx()` /
 * `docxBody()` / `wordParagraph()` in
 * `src/lib/workers/pdf-office-export/engine.ts` at `b94c1882` (only the
 * exports changed).
 *
 * Each page's reading-order paragraphs as plain `<w:p>` runs, a page break
 * between pages that have text, an empty `<w:sectPr/>`, and nothing else: no
 * `word/media`, no `<w:drawing>`. On 2026-10-17 the owner's 33-page tutorial
 * came back from production in exactly this shape — 12 KB, 138 paragraphs,
 * 32 page breaks, 0 pictures — beside a competitor's export that kept every
 * screenshot.
 *
 * It is the NEGATIVE CONTROL for the Word picture instrument
 * (`src/lib/workers/pdf-office-export/docx-fidelity.ts`): the instrument
 * must FAIL this file on any source with a picture, or it cannot see the
 * defect it exists for.
 *
 * Do not "fix" this file. It is wrong on purpose, in exactly the way that
 * shipped.
 */
import JSZip from "jszip";
import { xmlEscape } from "@/lib/workers/ooxml/sheet-cells";
import type { PdfFlowTextPage } from "@/lib/workers/pdf-text/flow";

const WORD_MAIN_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WORD_PAGE_BREAK = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

function wordParagraph(cells: readonly string[]): string {
  const runs = cells
    .map((cell) => `<w:t xml:space="preserve">${xmlEscape(cell)}</w:t>`)
    .join("<w:tab/>");
  return `<w:p><w:r>${runs}</w:r></w:p>`;
}

function docxBody(pages: readonly PdfFlowTextPage[]): string {
  return pages
    .filter((page) => page.paragraphs.length > 0)
    .map((page) => page.paragraphs.map(wordParagraph).join(""))
    .join(WORD_PAGE_BREAK);
}

/** The text-only DOCX, from the same reading-order pages the engine reads. */
export async function docxTextOnly20261017(
  pages: readonly PdfFlowTextPage[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD_MAIN_NS}"><w:body>${docxBody(pages)}<w:sectPr/></w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
