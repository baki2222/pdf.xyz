import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { countFormFields, flattenedOutputName, flattenPdf } from "./flatten";

async function blankPdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return doc.save();
}

/** A PDF carrying a filled text field and a checked checkbox. */
async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField("profile.name");
  name.setText("Ada Lovelace");
  name.addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
  const agree = form.createCheckBox("profile.agree");
  agree.check();
  agree.addToPage(page, { x: 50, y: 660, width: 18, height: 18 });
  return doc.save();
}

describe("flattenPdf", () => {
  it("flattens all form fields and removes them from the document", async () => {
    const input = await formPdf();
    expect(await countFormFields(input)).toBe(2);

    const result = await flattenPdf(input);
    expect(result.hadForm).toBe(true);
    expect(result.flattenedFields).toBe(2);

    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("re-saves a PDF with no form fields honestly", async () => {
    const input = await blankPdf(2);
    const result = await flattenPdf(input);
    expect(result.hadForm).toBe(false);
    expect(result.flattenedFields).toBe(0);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("counts zero fields for a plain PDF", async () => {
    expect(await countFormFields(await blankPdf(1))).toBe(0);
  });

  it("names the download from the source", () => {
    expect(flattenedOutputName("form.pdf")).toBe("form-flattened.pdf");
  });
});
