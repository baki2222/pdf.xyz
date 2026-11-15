// @vitest-environment node
/**
 * The two flat readers (`./docx-read`, `./docx-text`) and an empty paragraph
 * written self-closing. Until #28 slice 2 (2026-11-15) `<w:p/>` was swallowed
 * by the opening-tag pattern up to the NEXT paragraph's `</w:p>`, so an empty
 * paragraph and the one after it read as one; docx-text had no self-closing
 * case at all. Our writer never writes `<w:p/>` (`docx-package.test.ts` pins
 * that), but a reader that can merge two paragraphs is not one a proof can
 * lean on.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readDocxBody } from "./docx-read";
import { readDocxParagraphs } from "./docx-text";

async function docxOf(body: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

const BODY = `<w:p/><w:p><w:r><w:t>x</w:t></w:r></w:p>`;

describe("an empty paragraph written self-closing", () => {
  it("docx-read reads <w:p/> then a paragraph as two paragraphs", async () => {
    const body = await readDocxBody(await docxOf(BODY));
    expect(body.paragraphs.map((p) => p.text)).toEqual(["", "x"]);
  });

  it("docx-text reads <w:p/> then a paragraph as two paragraphs", async () => {
    expect(await readDocxParagraphs(await docxOf(BODY))).toEqual(["", "x"]);
  });

  it("neither reads <w:pPr> or a paragraph with attributes as self-closing", async () => {
    const xml = `<w:p w:rsidR="00A1"><w:pPr/><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p>`;
    expect(await readDocxParagraphs(await docxOf(xml))).toEqual(["a", "b"]);
    const body = await readDocxBody(await docxOf(xml));
    expect(body.paragraphs.map((p) => p.text)).toEqual(["a", "b"]);
  });
});
