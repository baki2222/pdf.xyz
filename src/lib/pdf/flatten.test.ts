import {
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFForm,
  type PDFPage,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  DYNAMIC_XFA_MESSAGE,
  flattenDownloadName,
  flattenedOutputName,
  flattenPdf,
  inspectForm,
} from "./flatten";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * What a reader of the DOWNLOADED file sees, page by page — pdfjs's text layer
 * over the flattened bytes, not pdf-lib's view of its own model. A flattened
 * value lives in page content, so it is text here; an interactive field's value
 * is not (pdfjs `getTextContent` does not read annotations), which is exactly
 * the difference flattening makes.
 */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const texts: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const content = await (await doc.getPage(i)).getTextContent();
      texts.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

/** How many `FlatWidget` XObjects a page's resources carry — one per drawn widget. */
function flatWidgetCount(page: PDFPage): number {
  const resources = page.node.Resources();
  const xobjects = resources?.lookup(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return 0;
  return xobjects
    .keys()
    .filter((key) => key.decodeText().startsWith("FlatWidget")).length;
}

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

/**
 * A form as pdftk `need_appearances` (and many server-side fillers) leave it:
 * the value is in `/V`, the stored appearance is the BLANK one from before it
 * was filled, and `/NeedAppearances true` tells every reader to regenerate.
 * Acrobat and pdf.js therefore show "Ada Lovelace"; the stored stream does not.
 *
 * `markFieldAsClean` + `updateFieldAppearances: false` are load-bearing: without
 * them pdf-lib writes a fresh appearance on save and the fixture tests nothing.
 * `needAppearances: false` builds the SAME stale file without the flag — the
 * control that proves the fix keys on the flag, not on the value.
 */
async function staleAppearanceFormPdf({
  needAppearances = true,
  value = "Ada Lovelace",
}: { needAppearances?: boolean; value?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const field = form.createTextField("applicant.name");
  field.setText("");
  field.addToPage(page, { x: 50, y: 700, width: 300, height: 24 });
  await doc.save(); // writes the blank appearance into the field's widget
  field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText(value));
  if (needAppearances) {
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  }
  form.markFieldAsClean(field.ref);
  return doc.save({ updateFieldAppearances: false });
}

/** Register a raw `/FT /Sig` widget on `page`, optionally signed and drawn. */
function addSignatureField(
  doc: PDFDocument,
  form: PDFForm,
  page: PDFPage,
  { name, signed }: { name: string; signed: boolean },
): void {
  const ctx = doc.context;
  const dict = ctx.obj({
    FT: "Sig",
    T: PDFString.of(name),
    Type: "Annot",
    Subtype: "Widget",
    Rect: [50, 560, 250, 600],
    F: 4,
    P: page.ref,
  });
  if (signed) {
    dict.set(
      PDFName.of("V"),
      ctx.register(
        ctx.obj({
          Type: "Sig",
          Filter: "Adobe.PPKLite",
          Contents: PDFHexString.of("00"),
        }),
      ),
    );
    const appearance = ctx.register(
      ctx.formXObject([], { BBox: [0, 0, 200, 40] }),
    );
    dict.set(PDFName.of("AP"), ctx.obj({ N: appearance }));
  }
  const ref = ctx.register(dict);
  page.node.addAnnot(ref);
  form.acroForm.addField(ref);
}

/** A filled text field next to a signature field. */
async function signatureFormPdf(signed: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField("applicant.name");
  name.setText("Ada Lovelace");
  name.addToPage(page, { x: 50, y: 700, width: 300, height: 24 });
  addSignatureField(doc, form, page, { name: "Signature1", signed });
  return doc.save();
}

/**
 * Three text fields over two pages, then page 2 removed:
 *  - `kept` lives on page 1 only;
 *  - `orphan` lived on page 2 only, so its one widget is on no page;
 *  - `split` has a widget on each page, so one resolves and one does not.
 */
async function removedPageFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const first = doc.addPage([600, 800]);
  const second = doc.addPage([600, 800]);
  const form = doc.getForm();
  const kept = form.createTextField("kept");
  kept.setText("Kept Value");
  kept.addToPage(first, { x: 50, y: 700, width: 300, height: 24 });
  const orphan = form.createTextField("orphan");
  orphan.setText("Orphan Value");
  orphan.addToPage(second, { x: 50, y: 700, width: 300, height: 24 });
  const split = form.createTextField("split");
  split.setText("Split Value");
  split.addToPage(first, { x: 50, y: 600, width: 300, height: 24 });
  split.addToPage(second, { x: 50, y: 600, width: 300, height: 24 });
  await doc.save();
  doc.removePage(1);
  return doc.save();
}

/**
 * A filled name field next to a comb field (`MaxLen 4`) whose `/V` holds nine
 * digits, under `/NeedAppearances true` — a filler that wrote the value without
 * checking the field's length, which readers tolerate. The flag marks `pin`
 * dirty, and pdf-lib's regeneration then throws `Failed to layout combed text`:
 * the only real input that reaches `flattenFormFields`' "couldn't be drawn" arm.
 */
async function undrawableCombFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField("applicant.name");
  name.setText("Ada Lovelace");
  name.addToPage(page, { x: 50, y: 700, width: 300, height: 24 });
  const pin = form.createTextField("pin");
  pin.setMaxLength(4);
  pin.enableCombing();
  pin.setText("1234");
  pin.addToPage(page, { x: 50, y: 640, width: 120, height: 24 });
  await doc.save();
  pin.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("123456789"));
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  form.markFieldAsClean(pin.ref);
  return doc.save({ updateFieldAppearances: false });
}

/**
 * A filled name field next to a checked checkbox whose widget's `/AP /N` state
 * dictionary holds only a `/Custom` state — neither the field's `/V` (`/Yes`)
 * nor `/Off`. `/AS /Custom` is in the dictionary, so pdf-lib does not think it
 * needs regenerating: the field reaches `flattenFormFields`' "no appearance to
 * draw" arm with nothing to draw.
 */
async function noAppearanceCheckboxFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField("applicant.name");
  name.setText("Ada Lovelace");
  name.addToPage(page, { x: 50, y: 700, width: 300, height: 24 });
  const agree = form.createCheckBox("agree");
  agree.check();
  agree.addToPage(page, { x: 50, y: 660, width: 18, height: 18 });
  await doc.save();
  const [widget] = agree.acroField.getWidgets();
  if (!widget) throw new Error("fixture: the checkbox has no widget");
  const custom = doc.context.register(
    doc.context.formXObject([], { BBox: [0, 0, 18, 18] }),
  );
  widget.dict.set(
    PDFName.of("AP"),
    doc.context.obj({ N: doc.context.obj({ Custom: custom }) }),
  );
  widget.dict.set(PDFName.of("AS"), PDFName.of("Custom"));
  form.markFieldAsClean(agree.ref);
  return doc.save({ updateFieldAppearances: false });
}

/**
 * A dynamic XFA form as it arrives: no AcroForm fields, an XFA stream, the
 * catalog's `/NeedsRendering true`, and one placeholder page.
 */
async function dynamicXfaPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawText("Please wait... your viewer may not display this document.", {
    x: 50,
    y: 700,
    size: 12,
  });
  const ctx = doc.context;
  const xfa = ctx.register(
    ctx.stream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"></xdp:xdp>'),
  );
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [], XFA: xfa }));
  doc.catalog.set(PDFName.of("NeedsRendering"), PDFBool.True);
  return doc.save();
}

/** A hybrid form: real AcroForm fields that ALSO carry an XFA layer. */
async function hybridXfaPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await formPdf());
  const ctx = doc.context;
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
  acroForm.set(
    PDFName.of("XFA"),
    ctx.register(ctx.stream("<xdp:xdp></xdp:xdp>")),
  );
  doc.catalog.set(PDFName.of("NeedsRendering"), PDFBool.False);
  return doc.save();
}

describe("flattenPdf", () => {
  it("flattens all form fields and removes them from the document", async () => {
    const input = await formPdf();
    expect((await inspectForm(input)).fields).toBe(2);

    const result = await flattenPdf(input);
    expect(result.hadForm).toBe(true);
    expect(result.flattenedFields).toBe(2);
    expect(result.totalFields).toBe(2);
    expect(result.skipped).toEqual([]);

    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getCreator()).toBe("pdf.xyz");
    expect((await pageTexts(result.bytes))[0]).toContain("Ada Lovelace");
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
    expect(await inspectForm(await blankPdf(1))).toEqual({
      fields: 0,
      signatureFields: 0,
      signed: false,
      xfa: false,
      dynamicXfa: false,
    });
  });

  it("names the download from the source", () => {
    expect(flattenedOutputName("form.pdf")).toBe("form-flattened.pdf");
  });
});

describe("flattenPdf — a form whose reader regenerates its appearances", () => {
  it("fixture health: the value is in /V and NOT in the stored appearance", async () => {
    // If pdf-lib ever starts writing a fresh appearance on save, this fixture
    // stops modelling the defect and every test below passes vacuously.
    const input = await staleAppearanceFormPdf();
    const doc = await PDFDocument.load(input);
    expect(doc.getForm().getTextField("applicant.name").getText()).toBe(
      "Ada Lovelace",
    );
    // Flattening WITHOUT regeneration (pdf-lib's own default) shows what the
    // stored appearance holds: nothing.
    doc.getForm().flatten({ updateFieldAppearances: false });
    const stale = await doc.save({ updateFieldAppearances: false });
    expect((await pageTexts(stale))[0]).not.toContain("Ada");
  });

  it("bakes in the value every reader shows, not the stale appearance", async () => {
    const result = await flattenPdf(await staleAppearanceFormPdf());
    expect(result.flattenedFields).toBe(1);
    expect((await pageTexts(result.bytes))[0]).toContain("Ada Lovelace");
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

  it("control: without the flag the authored appearance is kept, because that is what readers show", async () => {
    const result = await flattenPdf(
      await staleAppearanceFormPdf({ needAppearances: false }),
    );
    expect(result.flattenedFields).toBe(1);
    expect((await pageTexts(result.bytes))[0]).not.toContain("Ada");
  });

  it("refuses a choice value it would have to draw outside WinAnsi, naming the characters", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const form = doc.getForm();
    const choice = form.createDropdown("district");
    choice.addOptions(["Dhaka"]);
    choice.select("Dhaka");
    choice.addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
    await doc.save();
    choice.acroField.dict.set(
      PDFName.of("Opt"),
      doc.context.obj([PDFHexString.fromText("ঢাকা")]),
    );
    choice.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("ঢাকা"));
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    form.markFieldAsClean(choice.ref);
    const input = await doc.save({ updateFieldAppearances: false });

    const run = flattenPdf(input);
    await expect(run).rejects.toBeInstanceOf(PdfEngineError);
    await expect(run).rejects.toThrow(/outside it: .*ঢ/);
  });

  it("refuses a TEXT value it would have to regenerate outside WinAnsi, naming the characters", async () => {
    // The text-field arm of the refusal. Without it the value is regenerated,
    // pdf-lib throws `WinAnsi cannot encode`, and the field is quietly skipped
    // as "couldn't be drawn" — a Bengali answer left behind with no reason
    // anyone could act on.
    const run = flattenPdf(await staleAppearanceFormPdf({ value: "ঢাকা" }));
    await expect(run).rejects.toBeInstanceOf(PdfEngineError);
    await expect(run).rejects.toThrow(/outside it: .*ঢ/);
  });

  it("control: a non-WinAnsi value whose AUTHORED appearance is what readers show is flattened, not refused", async () => {
    // Without the flag nothing is regenerated: the authored stream is drawn and
    // the form's WinAnsi font never sees the value. Refusing it would refuse a
    // file this tool can flatten exactly as every reader shows it.
    const result = await flattenPdf(
      await staleAppearanceFormPdf({ value: "ঢাকা", needAppearances: false }),
    );
    expect(result.flattenedFields).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it("refuses a list box whose regenerated appearance would draw a non-WinAnsi OPTION, even with a Latin selection", async () => {
    // A list box's appearance lists every option, not just the selected one,
    // so checking only the selection let `ঢাকা` reach the WinAnsi encoder.
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const form = doc.getForm();
    const list = form.createOptionList("district");
    list.addOptions(["Dhaka", "Chattogram"]);
    list.select("Dhaka");
    list.addToPage(page, { x: 50, y: 600, width: 200, height: 80 });
    await doc.save();
    list.acroField.dict.set(
      PDFName.of("Opt"),
      doc.context.obj([
        PDFHexString.fromText("Dhaka"),
        PDFHexString.fromText("ঢাকা"),
      ]),
    );
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    form.markFieldAsClean(list.ref);
    const input = await doc.save({ updateFieldAppearances: false });

    const run = flattenPdf(input);
    await expect(run).rejects.toBeInstanceOf(PdfEngineError);
    await expect(run).rejects.toThrow(/outside it: .*ঢ/);
  });
});

describe("flattenPdf — fields that cannot be drawn are left as-is, never fatal", () => {
  it("an EMPTY signature box stays interactive while the filled field is flattened", async () => {
    const input = await signatureFormPdf(false);
    expect(await inspectForm(input)).toMatchObject({
      fields: 2,
      signatureFields: 1,
      signed: false,
    });

    const result = await flattenPdf(input);
    expect(result.flattenedFields).toBe(1);
    expect(result.totalFields).toBe(2);
    expect(result.signed).toBe(false);
    expect(result.skipped).toEqual([
      { name: "Signature1", reason: expect.stringMatching(/empty signature/) },
    ]);

    const doc = await PDFDocument.load(result.bytes);
    expect(
      doc
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(["Signature1"]);
    // The signature box is still a widget on the page, ready to be signed.
    expect(doc.getPage(0).node.Annots()?.size()).toBe(1);
    expect((await pageTexts(result.bytes))[0]).toContain("Ada Lovelace");
  });

  it("a SIGNED signature field is reported and kept, not drawn in to look signed", async () => {
    const input = await signatureFormPdf(true);
    expect(await inspectForm(input)).toMatchObject({
      signatureFields: 1,
      signed: true,
    });
    const result = await flattenPdf(input);
    expect(result.signed).toBe(true);
    expect(result.flattenedFields).toBe(1);
    expect(result.skipped.map((s) => s.name)).toEqual(["Signature1"]);
    const doc = await PDFDocument.load(result.bytes);
    expect(
      doc
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(["Signature1"]);
  });

  it("a widget on a removed page is skipped; the rest of the form still flattens", async () => {
    const input = await removedPageFormPdf();
    // Fixture health: the page really is gone and the fields really survive.
    const before = await PDFDocument.load(input);
    expect(before.getPageCount()).toBe(1);
    expect(before.getForm().getFields()).toHaveLength(3);

    const result = await flattenPdf(input);
    expect(result.flattenedFields).toBe(1);
    expect(result.skipped.map((s) => s.name).sort()).toEqual([
      "orphan",
      "split",
    ]);

    const doc = await PDFDocument.load(result.bytes);
    expect(
      doc
        .getForm()
        .getFields()
        .map((f) => f.getName())
        .sort(),
    ).toEqual(["orphan", "split"]);
    // `kept` drew ONE widget. `split`'s resolvable widget drew NOTHING: half a
    // field drawn under a live field would show its value twice.
    expect(flatWidgetCount(doc.getPage(0))).toBe(1);
    const text = (await pageTexts(result.bytes))[0];
    expect(text).toContain("Kept Value");
    expect(text).not.toContain("Split Value");
  });

  it("fixture health: pdf-lib really cannot regenerate the comb field, in save() too", async () => {
    // If pdf-lib ever lays out an over-long comb value, this fixture stops
    // reaching the "couldn't be drawn" arm and the test below passes vacuously.
    const doc = await PDFDocument.load(await undrawableCombFormPdf());
    const form = doc.getForm();
    expect(form.acroForm.dict.lookup(PDFName.of("NeedAppearances"))).toBe(
      PDFBool.True,
    );
    const pin = form.getTextField("pin");
    expect(pin.getText()).toBe("123456789");
    expect(pin.getMaxLength()).toBe(4);
    expect(() => pin.defaultUpdateAppearances(form.getDefaultFont())).toThrow(
      /combed text/,
    );
    // The same field, still dirty, is what a default `save()` would regenerate.
    form.markFieldAsDirty(pin.ref);
    await expect(doc.save()).rejects.toThrow(/combed text/);
  });

  it("a value that cannot be drawn is skipped with its reason; the rest of the form still flattens", async () => {
    // Pins BOTH halves of "one field never fails the document": the per-field
    // catch around regeneration, AND the final `save({ updateFieldAppearances:
    // false })` — a plain `save()` regenerates the still-dirty skipped field
    // outside every try and rejects with pdf-lib's raw layout error.
    const run = flattenPdf(await undrawableCombFormPdf());
    await expect(run).resolves.toMatchObject({ flattenedFields: 1 });
    const result = await run;
    expect(result.totalFields).toBe(2);
    expect(result.skipped).toEqual([
      { name: "pin", reason: expect.stringMatching(/couldn't be drawn/) },
    ]);

    const text = (await pageTexts(result.bytes))[0];
    expect(text).toContain("Ada Lovelace");
    expect(text).not.toContain("1234");
    // Left as-is: still a live field, its value intact, its widget on the page.
    const doc = await PDFDocument.load(result.bytes);
    expect(
      doc
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(["pin"]);
    expect(doc.getForm().getTextField("pin").getText()).toBe("123456789");
    expect(doc.getPage(0).node.Annots()?.size()).toBe(1);
  });

  it("fixture health: the checkbox has neither its /V state nor /Off, and pdf-lib won't regenerate it", async () => {
    const doc = await PDFDocument.load(await noAppearanceCheckboxFormPdf());
    const agree = doc.getForm().getCheckBox("agree");
    const value = agree.acroField.getValue();
    expect(value).toBe(PDFName.of("Yes"));
    const normal = agree.acroField.getWidgets()[0]?.getAppearances()?.normal;
    expect(normal).toBeInstanceOf(PDFDict);
    const states = (normal as PDFDict).keys().map((k) => k.decodeText());
    expect(states).toEqual(["Custom"]);
    // Otherwise `defaultUpdateAppearances` would build /Off and the field would
    // be drawn, never reaching the arm under test.
    expect(agree.needsAppearancesUpdate()).toBe(false);
  });

  it("a field with no appearance to draw is skipped with its reason; the rest of the form still flattens", async () => {
    const run = flattenPdf(await noAppearanceCheckboxFormPdf());
    await expect(run).resolves.toMatchObject({ flattenedFields: 1 });
    const result = await run;
    expect(result.skipped).toEqual([
      { name: "agree", reason: expect.stringMatching(/no appearance/) },
    ]);
    expect((await pageTexts(result.bytes))[0]).toContain("Ada Lovelace");
    const doc = await PDFDocument.load(result.bytes);
    expect(
      doc
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(["agree"]);
    // Left exactly as it was: value, state and widget all untouched.
    const agree = doc.getForm().getCheckBox("agree");
    expect(agree.acroField.getValue()).toBe(PDFName.of("Yes"));
    expect(agree.acroField.getWidgets()[0]?.getAppearanceState()).toBe(
      PDFName.of("Custom"),
    );
    expect(doc.getPage(0).node.Annots()?.size()).toBe(1);
    expect(flatWidgetCount(doc.getPage(0))).toBe(1);
  });

  it("removes the flattened widget annotations from the page, not just the fields", async () => {
    const result = await flattenPdf(await formPdf());
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });
});

describe("flattenPdf — XFA", () => {
  it("refuses a dynamic XFA form instead of saving its placeholder page", async () => {
    const input = await dynamicXfaPdf();
    expect(await inspectForm(input)).toMatchObject({
      fields: 0,
      xfa: true,
      dynamicXfa: true,
    });
    const run = flattenPdf(input);
    await expect(run).rejects.toBeInstanceOf(PdfEngineError);
    await expect(run).rejects.toThrow(DYNAMIC_XFA_MESSAGE);
  });

  it("control: a hybrid form still flattens its AcroForm fields and says the XFA layer went", async () => {
    const input = await hybridXfaPdf();
    expect(await inspectForm(input)).toMatchObject({
      fields: 2,
      xfa: true,
      dynamicXfa: false,
    });
    const result = await flattenPdf(input);
    expect(result.flattenedFields).toBe(2);
    expect(result.droppedXfa).toBe(true);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.catalog.has(PDFName.of("NeedsRendering"))).toBe(false);
    expect((await pageTexts(result.bytes))[0]).toContain("Ada Lovelace");
  });

  it("control: a plain form reports no XFA", async () => {
    const result = await flattenPdf(await formPdf());
    expect(result.droppedXfa).toBe(false);
  });
});

describe("flattenDownloadName", () => {
  it("does not call a file in which nothing was flattened '-flattened'", async () => {
    const result = await flattenPdf(await blankPdf(1));
    const name = flattenDownloadName("contract.pdf", result);
    expect(name).not.toMatch(/flattened/);
    expect(name).toBe("contract-resaved.pdf");
  });

  it("control: a flattened form keeps the '-flattened' name", async () => {
    const result = await flattenPdf(await formPdf());
    expect(flattenDownloadName("form.pdf", result)).toBe("form-flattened.pdf");
  });
});
