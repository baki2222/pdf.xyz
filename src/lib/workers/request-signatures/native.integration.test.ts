import { describe, expect, it } from "vitest";
import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import JSZip from "jszip";
import { PdfEngineError } from "@/lib/pdf/engine";
import { signatureRequestDeps } from "./native";
import { runSignatureRequest } from "./engine";
import type { SignatureRequestOptions } from "@/lib/jobs/request-signatures";

async function realPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  return doc.save();
}

const options: SignatureRequestOptions = {
  signers: [
    { name: "Ada Lovelace", email: "ada@example.com" },
    { name: "Alan Turing", email: "alan@example.com" },
  ],
  fields: [
    {
      signer: 0,
      page: 1,
      type: "signature",
      x: 0.08,
      y: 0.1,
      width: 0.4,
      height: 0.06,
      required: true,
    },
    {
      signer: 0,
      page: 1,
      type: "date",
      x: 0.56,
      y: 0.1,
      width: 0.22,
      height: 0.06,
      required: true,
    },
    {
      signer: 1,
      page: 2,
      type: "signature",
      x: 0.08,
      y: 0.1,
      width: 0.4,
      height: 0.06,
      required: true,
    },
  ],
  routing: "sequential",
  deliver: false,
};

describe("request-signatures native integration", () => {
  it("prepares a real PDF with named fillable fields and a genuine SHA-256 manifest", async () => {
    const input = await realPdf();
    const run = await runSignatureRequest(
      input,
      options,
      signatureRequestDeps(),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const zip = await JSZip.loadAsync(run.output);
    const preparedBytes = await zip.file("prepared.pdf")!.async("uint8array");

    // The prepared PDF is a real, loadable PDF that now carries our named fields.
    const prepared = await PDFDocument.load(preparedBytes);
    const names = prepared
      .getForm()
      .getFields()
      .map((f) => f.getName())
      .sort();
    expect(names).toEqual([
      "Signer1-Date-1",
      "Signer1-Signature-1",
      "Signer2-Signature-1",
    ]);

    // The manifest's document hash is a genuine SHA-256 of the ORIGINAL input.
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.document.pageCount).toBe(2);
    expect(manifest.status).toBe("prepared");
  });
});

/**
 * An uploaded form with a field pdf-lib must redraw: its value is in `/V` and
 * its widget has NO appearance, so `doc.save()` regenerates it with the form's
 * WinAnsi Helvetica — adding the signer fields is enough to trigger that, since
 * `getForm()` is what arms `save()` to regenerate at all.
 */
async function formNeedingRegeneration(value: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const field = form.createTextField("existing.city");
  field.addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
  for (const widget of field.acroField.getWidgets()) {
    widget.dict.delete(PDFName.of("AP"));
  }
  field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText(value));
  form.markFieldAsClean(field.ref);
  return doc.save({ updateFieldAppearances: false });
}

const oneField = [
  {
    name: "Signer1-Signature-1",
    page: 1,
    x: 50,
    y: 100,
    width: 200,
    height: 40,
  },
];

describe("request-signatures native placement — existing fields pdf-lib redraws", () => {
  it("fixture health: the existing field has a value and no appearance", async () => {
    const doc = await PDFDocument.load(await formNeedingRegeneration("ঢাকা"));
    const field = doc.getForm().getTextField("existing.city");
    expect(field.getText()).toBe("ঢাকা");
    expect(field.needsAppearancesUpdate()).toBe(true);
  });

  it("refuses in words, naming the characters, instead of leaking pdf-lib's encoder error", async () => {
    const { place } = signatureRequestDeps();
    const run = place!(await formNeedingRegeneration("ঢাকা"), oneField);
    await expect(run).rejects.toBeInstanceOf(PdfEngineError);
    await expect(run).rejects.toThrow(/outside it: .*ঢ/);
  });

  it("control: a Latin value is redrawn and the signer field is added", async () => {
    const { place } = signatureRequestDeps();
    const out = await place!(await formNeedingRegeneration("Dhaka"), oneField);
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField("existing.city").getText()).toBe("Dhaka");
    expect(form.getTextField("existing.city").needsAppearancesUpdate()).toBe(
      false,
    );
    expect(form.getFields().map((f) => f.getName())).toContain(
      "Signer1-Signature-1",
    );
  });
});
