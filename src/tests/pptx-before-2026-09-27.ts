/**
 * The .pptx the PDF to PowerPoint engine wrote until 2026-09-27 — VENDORED, as
 * an artifact of record, from `src/lib/workers/pdf-office-export/engine.ts` at
 * `4024227` (only the export name changed).
 *
 * It is the NEGATIVE CONTROL for every instrument that asks "can PowerPoint
 * open this?": PowerPoint 16.0 for Windows refused every file it produced with
 * "The file or directory is corrupted and unreadable" (0x80070570). An
 * instrument that passes this package cannot see the defect it exists for,
 * and its green on the fixed engine means nothing.
 *
 * Do not "fix" this file. It is wrong on purpose, in exactly the way that
 * shipped.
 */
import JSZip from "jszip";
import type { ExtractedPdfText } from "@/lib/pdf/text";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function pptxBefore20260927(
  pages: ExtractedPdfText["pages"],
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${pages.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pages.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  for (const page of pages)
    zip.file(
      `ppt/slides/slide${page.pageNumber}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr/><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${lines(
        page.text,
      )
        .map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`)
        .join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
