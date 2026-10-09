/**
 * The PDF the production proof of AI Data Extraction uploads
 * (`scripts/worker-prove-tools.ts`), drawn from the very rows its request and
 * verifier are derived from (`@/lib/probes/extraction-proof`), so the fixture,
 * the question and the expected answer cannot drift apart.
 *
 * Its faces come from the one font chooser like every other text this repo
 * draws (`deploy/text-drawing-call-sites.test.ts`); for these ASCII cells that
 * is Helvetica and Helvetica Bold, the faces the harness drew them in before.
 */
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import {
  PROOF_TABLE_ROWS,
  PROOF_TABLE_TITLE,
} from "@/lib/probes/extraction-proof";

/** The title, then the proof's table, a cell per fixed column. */
export async function proofTablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [header = [], ...rows] = PROOF_TABLE_ROWS;
  const font = await embedDrawingFont(doc, rows.flat());
  const bold = await embedDrawingFont(
    doc,
    [PROOF_TABLE_TITLE, ...header],
    "sans-bold",
  );
  const page = doc.addPage([595, 842]);
  page.drawText(PROOF_TABLE_TITLE, { x: 60, y: 780, size: 16, font: bold });
  const cols = [60, 200, 330, 450];
  PROOF_TABLE_ROWS.forEach((row, r) => {
    row.forEach((cell, c) => {
      page.drawText(cell, {
        x: cols[c]!,
        y: 740 - r * 24,
        size: 11,
        font: r === 0 ? bold : font,
      });
    });
  });
  return doc.save();
}
