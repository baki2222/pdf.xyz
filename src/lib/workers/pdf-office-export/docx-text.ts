/**
 * Read a DOCX back into the paragraphs a reader sees — for PROOFS, not for
 * production.
 *
 * The pdf-to-word deployment proof used to check only that the artifact began
 * with `PK`, which a DOCX with an empty body passes, and which the
 * column-scrambled DOCX this tool shipped for months passed too. Tests and the
 * proof harness read the file through this instead, so both assert on the text
 * inside `word/document.xml`, as Word would show it: one string per `<w:p>`,
 * `<w:tab/>` as a tab, a page break as its own marker.
 */
import JSZip from "jszip";

/** What a `<w:br w:type="page"/>` paragraph reads as. */
export const DOCX_PAGE_BREAK = "\f";

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) =>
    String(XML_ENTITIES[name]),
  );
}

/** The paragraphs of `word/document.xml`, in order. Throws if it is absent. */
export async function readDocxParagraphs(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const part = zip.file("word/document.xml");
  if (!part) throw new Error("the DOCX has no word/document.xml");
  const xml = await part.async("string");
  const paragraphs: string[] = [];
  for (const p of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    let text = "";
    for (const piece of p[1]!.matchAll(
      /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br w:type="page"\/>/g,
    )) {
      if (piece[0].startsWith("<w:tab")) text += "\t";
      else if (piece[0].startsWith("<w:br")) text += DOCX_PAGE_BREAK;
      else text += decode(piece[1] ?? "");
    }
    paragraphs.push(text);
  }
  return paragraphs;
}
