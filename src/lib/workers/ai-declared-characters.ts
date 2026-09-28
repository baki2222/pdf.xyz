/**
 * The character count a per-call AI panel (summarize, chat, extract) declares
 * with its job, counted in the browser before anything is uploaded.
 *
 * The same extractor and the same field translate declares
 * (`extractPdfText(...).characterCount`), so the one headroom the route applies
 * — `TRANSLATE_EXTRACTOR_HEADROOM`, the gap between pdfjs here and
 * `pdftotext -layout` on the worker — covers all four tools alike.
 *
 * `null` means "could not count", and it is a supported answer rather than an
 * error: an encrypted or damaged file pdfjs cannot open, or a scan with no
 * selectable text (the contract refuses a declaration of 0). The job is then
 * sent undeclared and costs what every per-call run cost before counting
 * existed. Counting is how a small document gets cheaper; it must never be
 * what stops a document the worker could read.
 */
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";

export async function countDeclaredCharacters(
  bytes: Uint8Array,
  extract: (bytes: Uint8Array) => Promise<ExtractedPdfText> = extractPdfText,
): Promise<number | null> {
  try {
    const { characterCount } = await extract(bytes);
    return Number.isInteger(characterCount) && characterCount > 0
      ? characterCount
      : null;
  } catch {
    return null;
  }
}
