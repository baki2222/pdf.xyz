/**
 * Step 1 of the restricted-PDF fixtures (see `README.md` beside this file):
 * the UNENCRYPTED form every encrypted fixture is made from. pdf-lib writes
 * it; the encryption is added by qpdf and pypdf in step 2, never by our own
 * code — the fixtures must be independent of the handler they test.
 * `scripts/worker-restricted-edit-proof.ts` encrypts the same form with the
 * worker image's qpdf.
 *
 *   pnpm exec tsx src/tests/fixtures/restricted-pdf/make-base.ts <out.pdf>
 */
import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";

/** The form: two text fields, a checkbox, a dropdown, and one line of text. */
export async function makeRestrictedBase(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("pdf.xyz restricted form fixture");
  doc.setProducer("pdf-lib (pdf.xyz fixture step 1)");
  // Through the one chooser (Western text: the standard sans face).
  const font = await embedDrawingFont(doc, ["RESTRICTED-FORM-FIXTURE"]);
  const page = doc.addPage([612, 792]);
  page.drawText("RESTRICTED-FORM-FIXTURE", { x: 72, y: 720, size: 18, font });
  const labels: [string, number][] = [
    ["Full name", 660],
    ["Email", 620],
    ["I agree", 580],
    ["Country", 540],
  ];
  for (const [label, y] of labels)
    page.drawText(label, { x: 72, y: y + 6, size: 11, font });
  const form = doc.getForm();
  const name = form.createTextField("full_name");
  name.addToPage(page, { x: 180, y: 660, width: 300, height: 22, font });
  const email = form.createTextField("email");
  email.addToPage(page, { x: 180, y: 620, width: 300, height: 22, font });
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 180, y: 580, width: 18, height: 18 });
  const country = form.createDropdown("country");
  country.addOptions(["Bangladesh", "Germany", "Japan"]);
  country.addToPage(page, { x: 180, y: 540, width: 200, height: 22, font });
  return doc.save({ useObjectStreams: true });
}

const out = process.argv[1]?.endsWith("make-base.ts") ? process.argv[2] : null;
if (out) void makeRestrictedBase().then((bytes) => writeFileSync(out, bytes));
