/**
 * The PDFs the production proofs of the AI tools upload
 * (`@/tests/ai-proof-specs`, run by `scripts/worker-prove-tools.ts`), drawn
 * from the text in `@/lib/probes/ai-proof-content` so the document and what a
 * proof expects back cannot drift apart. AI Data Extraction's table is in
 * `./extraction-proof-fixtures`.
 *
 * Faces come from the one font chooser like every other text this repo draws
 * (`deploy/text-drawing-call-sites.test.ts`); for this ASCII text that is
 * Helvetica and Helvetica Bold, the faces the harness drew them in before.
 */
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import {
  CHAT_PROOF_PAGES,
  PROOF_MEMO_PAGES,
  PROOF_MEMO_SENTENCES,
  PROOF_MEMO_TITLE,
} from "@/lib/probes/ai-proof-content";

/**
 * The memo Summarize and Translate are proven on: its title and sentences on
 * page 1, then blank pages up to {@link PROOF_MEMO_PAGES} — a page with no
 * text, which the browser leaves out of the text pages it declares.
 */
export async function memoProofPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, PROOF_MEMO_SENTENCES);
  const bold = await embedDrawingFont(doc, [PROOF_MEMO_TITLE], "sans-bold");
  const page = doc.addPage([595, 842]);
  page.drawText(PROOF_MEMO_TITLE, { x: 60, y: 770, size: 18, font: bold });
  PROOF_MEMO_SENTENCES.forEach((sentence, i) => {
    page.drawText(sentence, { x: 60, y: 735 - i * 20, size: 10.5, font });
  });
  for (let p = 1; p < PROOF_MEMO_PAGES; p += 1) doc.addPage([595, 842]);
  return doc.save();
}

/**
 * A deliberately LONG text PDF, used only by the chat conversation proof.
 *
 * Size is the point. Providers cache a long prompt prefix automatically and only
 * above a minimum length (OpenAI's is documented at 1024 tokens), so a follow-up
 * question about a three-line fixture can never report a cache read no matter how
 * well caching works. Measured against production on 2026-08-04, the short
 * `textPdf` produced `input=216, cachedInput=0` — a zero that says nothing, and
 * which reads as "the caching bet is not paying" to anyone who does not know the
 * prompt was too small to be cacheable in the first place.
 *
 * This fixture carries a few thousand tokens of real prose so the document prefix
 * clears any plausible threshold, and `cachedInput` on the follow-up becomes an
 * actual measurement of the bet rather than a foregone zero.
 */
export async function chatProofPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // The notes, with the two facts the chat proof asks about and the other
  // teams' facts planted on page 2, are one definition in
  // `@/lib/probes/ai-proof-content`.
  const font = await embedDrawingFont(
    doc,
    CHAT_PROOF_PAGES.flatMap((p) => p.lines),
  );
  const bold = await embedDrawingFont(
    doc,
    CHAT_PROOF_PAGES.map((p) => p.heading),
    "sans-bold",
  );
  for (const { heading, lines } of CHAT_PROOF_PAGES) {
    const page = doc.addPage([595, 842]);
    page.drawText(heading, { x: 60, y: 790, size: 14, font: bold });
    lines.forEach((text, line) => {
      page.drawText(text, { x: 60, y: 760 - line * 21, size: 9, font });
    });
  }
  return doc.save();
}
