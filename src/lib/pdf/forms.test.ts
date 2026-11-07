import { describe, expect, it, vi } from "vitest";
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  PDFTextField,
  decodePDFRawStream,
  type PDFDropdown,
  type PDFOptionList,
} from "pdf-lib";
import {
  ORPHAN_FIELD,
  VISIBLE_FIELD,
  formPdf,
} from "@/tests/unflattenable-form-pdf";
import {
  applyFormValues,
  filledFormsOutputName,
  inspectFormFields,
  isFillableType,
} from "./forms";

/**
 * Build a fixture PDF containing one of every field type pdf-lib exposes,
 * including a push button (which we treat as unsupported) and a read-only text
 * field. Creating fields here is a test-only concern — the runner never builds
 * forms, it only fills existing ones.
 */
async function buildFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();

  const name = form.createTextField("applicant.name");
  name.setText("Ada");
  name.addToPage(page, { x: 10, y: 740, width: 200, height: 20 });

  const notes = form.createTextField("applicant.notes");
  notes.enableMultiline();
  notes.setMaxLength(10);
  notes.addToPage(page, { x: 10, y: 680, width: 200, height: 40 });

  const agree = form.createCheckBox("applicant.agree");
  agree.check();
  agree.addToPage(page, { x: 10, y: 650, width: 15, height: 15 });

  const color = form.createRadioGroup("applicant.color");
  color.addOptionToPage("Red", page, { x: 10, y: 620, width: 15, height: 15 });
  color.addOptionToPage("Blue", page, { x: 40, y: 620, width: 15, height: 15 });
  color.select("Red");

  const city = form.createDropdown("applicant.city");
  city.addOptions(["NYC", "LA", "SF"]);
  city.select("NYC");
  city.addToPage(page, { x: 10, y: 580, width: 200, height: 20 });

  const langs = form.createOptionList("applicant.langs");
  langs.addOptions(["EN", "FR", "DE"]);
  langs.enableMultiselect();
  langs.select(["EN"]);
  langs.addToPage(page, { x: 10, y: 500, width: 200, height: 60 });

  const locked = form.createTextField("applicant.id");
  locked.setText("R-100");
  locked.enableReadOnly();
  locked.addToPage(page, { x: 10, y: 470, width: 200, height: 20 });

  const submit = form.createButton("applicant.submit");
  submit.addToPage("Submit", page, { x: 10, y: 430, width: 80, height: 24 });

  return doc.save();
}

/** Find the field / outcome with a given name, or fail loudly. */
function byName<T extends { name: string }>(items: T[], name: string): T {
  const item = items.find((i) => i.name === name);
  if (!item) throw new Error(`missing: ${name}`);
  return item;
}

describe("filledFormsOutputName", () => {
  it("derives a -filled name from the source", () => {
    expect(filledFormsOutputName("W-9.pdf")).toBe("W-9-filled.pdf");
    expect(filledFormsOutputName("")).toBe("document-filled.pdf");
  });
});

describe("isFillableType", () => {
  it("treats every classified type except unsupported as fillable", () => {
    for (const type of [
      "text",
      "checkbox",
      "radio",
      "dropdown",
      "optionlist",
    ] as const) {
      expect(isFillableType(type)).toBe(true);
    }
    expect(isFillableType("unsupported")).toBe(false);
  });
});

describe("inspectFormFields", () => {
  it("reports no fields for a plain PDF without an AcroForm", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const result = await inspectFormFields(await doc.save());
    expect(result.hasFields).toBe(false);
    expect(result.fields).toEqual([]);
    expect(result.fillableCount).toBe(0);
    expect(result.unsupportedCount).toBe(0);
  });

  it("classifies every field type and surfaces safe metadata", async () => {
    const bytes = await buildFormPdf();
    const { hasFields, fields, fillableCount, unsupportedCount } =
      await inspectFormFields(bytes);

    expect(hasFields).toBe(true);
    // 7 fillable (name, notes, agree, color, city, langs, read-only id) + 1
    // unsupported push button.
    expect(fillableCount).toBe(7);
    expect(unsupportedCount).toBe(1);

    expect(byName(fields, "applicant.name")).toMatchObject({
      type: "text",
      text: "Ada",
      widgetLabel: "Text field",
      readOnly: false,
    });
    expect(byName(fields, "applicant.notes")).toMatchObject({
      type: "text",
      multiline: true,
      maxLength: 10,
    });
    expect(byName(fields, "applicant.agree")).toMatchObject({
      type: "checkbox",
      checked: true,
    });
    expect(byName(fields, "applicant.color")).toMatchObject({
      type: "radio",
      options: ["Red", "Blue"],
      selected: ["Red"],
    });
    expect(byName(fields, "applicant.city")).toMatchObject({
      type: "dropdown",
      options: ["NYC", "LA", "SF"],
      selected: ["NYC"],
      multiselect: false,
      editable: false,
    });
    expect(byName(fields, "applicant.langs")).toMatchObject({
      type: "optionlist",
      options: ["EN", "FR", "DE"],
      selected: ["EN"],
      multiselect: true,
    });
    expect(byName(fields, "applicant.id")).toMatchObject({
      type: "text",
      readOnly: true,
    });
    expect(byName(fields, "applicant.submit")).toMatchObject({
      type: "unsupported",
      widgetLabel: "Push button",
    });
  });
});

describe("applyFormValues", () => {
  it("writes values of every supported type and persists them on reload", async () => {
    const bytes = await buildFormPdf();
    const {
      bytes: filled,
      appliedCount,
      flattened,
      flattenRequested,
      outcomes,
    } = await applyFormValues(bytes, {
      "applicant.name": "Grace Hopper",
      "applicant.agree": false,
      "applicant.color": "Blue",
      "applicant.city": "LA",
      "applicant.langs": ["EN", "DE"],
    });

    expect(flattened).toBe(false);
    expect(flattenRequested, "nobody asked for a flatten").toBe(false);
    expect(appliedCount).toBe(5);
    expect(outcomes.every((o) => o.status === "applied")).toBe(true);

    const after = await inspectFormFields(filled);
    expect(byName(after.fields, "applicant.name").text).toBe("Grace Hopper");
    expect(byName(after.fields, "applicant.agree").checked).toBe(false);
    expect(byName(after.fields, "applicant.color").selected).toEqual(["Blue"]);
    expect(byName(after.fields, "applicant.city").selected).toEqual(["LA"]);
    expect(byName(after.fields, "applicant.langs").selected).toEqual([
      "EN",
      "DE",
    ]);
  });

  it("rejects an out-of-range text value without corrupting the field", async () => {
    const bytes = await buildFormPdf();
    const { outcomes, appliedCount } = await applyFormValues(bytes, {
      "applicant.notes": "way too long to fit",
    });
    expect(appliedCount).toBe(0);
    expect(outcomes[0]).toMatchObject({
      name: "applicant.notes",
      status: "invalid",
    });
    expect(outcomes[0]?.detail).toContain("10");
  });

  it("rejects off-list radio and dropdown values", async () => {
    const bytes = await buildFormPdf();
    const { outcomes } = await applyFormValues(bytes, {
      "applicant.color": "Green",
      "applicant.city": "Paris",
    });
    expect(outcomes).toEqual([
      {
        name: "applicant.color",
        type: "radio",
        status: "invalid",
        detail: '"Green" is not an option',
      },
      {
        name: "applicant.city",
        type: "dropdown",
        status: "invalid",
        detail: "Not an option: Paris",
      },
    ]);

    // The rejected values must not have leaked into the saved document.
    const after = await inspectFormFields(bytes);
    expect(byName(after.fields, "applicant.color").selected).toEqual(["Red"]);
    expect(byName(after.fields, "applicant.city").selected).toEqual(["NYC"]);
  });

  it("skips read-only and unsupported fields, and flags unknown names", async () => {
    const bytes = await buildFormPdf();
    const { outcomes, appliedCount } = await applyFormValues(bytes, {
      "applicant.id": "HACKED",
      "applicant.submit": "click",
      "applicant.missing": "nope",
    });
    expect(appliedCount).toBe(0);
    expect(byName(outcomes, "applicant.id")).toMatchObject({
      status: "skipped",
      detail: "Read-only field",
    });
    expect(byName(outcomes, "applicant.submit")).toMatchObject({
      status: "skipped",
    });
    expect(byName(outcomes, "applicant.missing")).toMatchObject({
      status: "missing",
    });

    // Read-only value is preserved.
    const after = await inspectFormFields(bytes);
    expect(byName(after.fields, "applicant.id").text).toBe("R-100");
  });

  it("clears a radio group and a dropdown when given empty values", async () => {
    const bytes = await buildFormPdf();
    const { bytes: filled } = await applyFormValues(bytes, {
      "applicant.color": "",
      "applicant.city": [],
    });
    const after = await inspectFormFields(filled);
    expect(byName(after.fields, "applicant.color").selected).toEqual([]);
    expect(byName(after.fields, "applicant.city").selected).toEqual([]);
  });

  it("accepts a free-text value for an editable (combo) dropdown", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const dd = doc.getForm().createDropdown("combo");
    dd.addOptions(["A", "B"]);
    dd.enableEditing();
    dd.addToPage(page, { x: 10, y: 250, width: 120, height: 20 });

    const { outcomes, bytes: filled } = await applyFormValues(
      await doc.save(),
      {
        combo: "Custom",
      },
    );
    expect(outcomes[0]).toMatchObject({ status: "applied" });
    const after = await inspectFormFields(filled);
    expect(byName(after.fields, "combo").selected).toEqual(["Custom"]);
  });

  it("flattens filled values into static content when requested", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const form = doc.getForm();
    const name = form.createTextField("who");
    name.addToPage(page, { x: 10, y: 250, width: 120, height: 20 });
    const agree = form.createCheckBox("ok");
    agree.addToPage(page, { x: 10, y: 220, width: 15, height: 15 });

    const { bytes: filled, flattened } = await applyFormValues(
      await doc.save(),
      { who: "Turing", ok: true },
      { flatten: true },
    );
    expect(flattened).toBe(true);

    // After flattening the AcroForm is gone — the values live in page content.
    const after = await inspectFormFields(filled);
    expect(after.hasFields).toBe(false);
  });

  /*
   * Audit 2026-09-27: when pdf-lib threw inside `flatten()`, this function
   * quietly returned the filled-but-editable bytes with `flattened: false` —
   * the same value it returns when nobody asked. The runner could not tell
   * "you did not ask" from "you asked and did not get it", so it showed a
   * green "Form filled" over a form the user believed was locked.
   *
   * The fixture is a real structure pdf-lib cannot flatten (an orphan widget),
   * not a stubbed `flatten()`: the question is what happens to a file a person
   * can upload.
   */
  describe("a flatten that fails", () => {
    const fill = { [VISIBLE_FIELD]: "Turing", [ORPHAN_FIELD]: "REF-7" };

    it("health check: the fixture really is one pdf-lib cannot flatten", async () => {
      const broken = await PDFDocument.load(await formPdf({ orphan: true }));
      expect(() => broken.getForm().flatten()).toThrow(/page/i);
      // …and its positive control flattens cleanly, so a failure below is the
      // orphan widget and nothing else about the fixture.
      const sound = await PDFDocument.load(await formPdf({ orphan: false }));
      expect(() => sound.getForm().flatten()).not.toThrow();
    });

    it("says the flatten was asked for and did not happen, and still hands back the filled form", async () => {
      const result = await applyFormValues(
        await formPdf({ orphan: true }),
        fill,
        { flatten: true },
      );
      expect(result.flattenRequested).toBe(true);
      expect(result.flattened).toBe(false);
      expect(result.appliedCount).toBe(2);

      // What the user downloads: still a live form, carrying their values.
      const after = await inspectFormFields(result.bytes);
      expect(after.hasFields, "the output is still an editable form").toBe(
        true,
      );
      expect(byName(after.fields, VISIBLE_FIELD).text).toBe("Turing");
      expect(byName(after.fields, ORPHAN_FIELD).text).toBe("REF-7");
    });

    it("positive control: the same form without the orphan flattens", async () => {
      const result = await applyFormValues(
        await formPdf({ orphan: false }),
        fill,
        { flatten: true },
      );
      expect(result.flattenRequested).toBe(true);
      expect(result.flattened).toBe(true);
      expect((await inspectFormFields(result.bytes)).hasFields).toBe(false);
    });
  });
});

/* ------------------------------------------------------------------ *
 *  Audit #15 (2026-11-06). Three ways filling one field disturbed the
 *  rest of the form, or wrote the wrong thing into the field itself.
 * ------------------------------------------------------------------ */

/**
 * A combo box and a list box whose `/Opt` holds [export, display] pairs, as
 * government and enterprise forms write country lists: the reader shows
 * "United States", the form's data (`/V`) holds "US".
 */
async function exportDisplayFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const pairs = doc.context.obj([
    [PDFString.of("US"), PDFString.of("United States")],
    [PDFString.of("BD"), PDFString.of("Bangladesh")],
  ]);
  const country = form.createDropdown("country");
  country.addOptions(["United States", "Bangladesh"]);
  country.addToPage(page, { x: 10, y: 700, width: 200, height: 20 });
  country.acroField.dict.set(PDFName.of("Opt"), pairs);
  country.acroField.dict.set(PDFName.of("V"), PDFString.of("US"));
  const visited = form.createOptionList("visited");
  visited.addOptions(["United States", "Bangladesh"]);
  visited.addToPage(page, { x: 10, y: 600, width: 200, height: 60 });
  visited.acroField.dict.set(PDFName.of("Opt"), pairs);
  visited.acroField.dict.set(PDFName.of("V"), PDFString.of("US"));
  return doc.save();
}

/** The raw `/V` strings of a choice field, as a form's data consumer reads them. */
function rawValues(doc: PDFDocument, name: string): string[] {
  const field = doc.getForm().getField(name) as PDFDropdown | PDFOptionList;
  return field.acroField.getValues().map((v) => v.decodeText());
}

/** A string as pdf-lib's standard-font text operators write it: WinAnsi hex. */
function hexOf(text: string): string {
  return [...text]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

/** The decoded normal appearance stream of a field's first widget. */
function appearanceText(doc: PDFDocument, name: string): string {
  const widget = doc.getForm().getField(name).acroField.getWidgets()[0];
  const normal = widget?.getAppearances()?.normal;
  if (!(normal instanceof PDFRawStream)) throw new Error(`${name}: no /AP /N`);
  return new TextDecoder("latin1").decode(decodePDFRawStream(normal).decode());
}

/**
 * Text fields that carry NO appearance stream — as generators that set
 * `/NeedAppearances` write them — next to a normal field the user fills:
 *  - `city`, read-only, holding Bengali text;
 *  - `serial`, editable but never touched, styled in Courier.
 */
async function appearanceLessFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField("name");
  name.addToPage(page, { x: 10, y: 740, width: 200, height: 20 });
  const city = form.createTextField("city");
  city.setText("x");
  city.enableReadOnly();
  city.addToPage(page, { x: 10, y: 700, width: 200, height: 20 });
  const serial = form.createTextField("serial");
  serial.setText("AB-12");
  serial.addToPage(page, { x: 10, y: 660, width: 200, height: 20 });
  await doc.save();
  city.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("ঢাকা"));
  serial.acroField.setDefaultAppearance("/Courier 12 Tf 0 g");
  for (const field of [city, serial]) {
    for (const widget of field.acroField.getWidgets()) {
      widget.dict.delete(PDFName.of("AP"));
    }
    form.markFieldAsClean(field.ref);
  }
  return doc.save({ updateFieldAppearances: false });
}

describe("applyFormValues — the rest of the form is left as it was (audit #15)", () => {
  it("shows a choice's DISPLAY text and reads its stored EXPORT value back as that text", async () => {
    const info = await inspectFormFields(await exportDisplayFormPdf());
    for (const name of ["country", "visited"]) {
      const field = byName(info.fields, name);
      expect(field.options).toEqual(["United States", "Bangladesh"]);
      expect(field.selected).toEqual(["United States"]);
    }
  });

  it("re-sending the pre-filled choice is applied, not refused as 'Not an option'", async () => {
    const bytes = await exportDisplayFormPdf();
    const result = await applyFormValues(bytes, {
      country: "United States",
      visited: ["United States"],
    });
    expect(result.outcomes.map((o) => o.status)).toEqual([
      "applied",
      "applied",
    ]);
    const doc = await PDFDocument.load(result.bytes);
    expect(rawValues(doc, "country")).toEqual(["US"]);
    expect(rawValues(doc, "visited")).toEqual(["US"]);
    // A caller that sends the stored export value itself is understood too.
    const byExport = await applyFormValues(bytes, { country: "US" });
    expect(byExport.outcomes[0]?.status).toBe("applied");
  });

  it("a new choice stores the EXPORT value in /V and shows the display text", async () => {
    const result = await applyFormValues(await exportDisplayFormPdf(), {
      country: "Bangladesh",
      visited: ["Bangladesh"],
    });
    expect(result.appliedCount).toBe(2);
    const doc = await PDFDocument.load(result.bytes);
    expect(rawValues(doc, "country")).toEqual(["BD"]);
    expect(rawValues(doc, "visited")).toEqual(["BD"]);
    // pdf-lib's select() turns on free typing for a value outside its display
    // list; writing the export value must not do that.
    expect(doc.getForm().getDropdown("country").isEditable()).toBe(false);
    const info = await inspectFormFields(result.bytes);
    expect(byName(info.fields, "country").selected).toEqual(["Bangladesh"]);
    // What the reader draws is the display text, not the code.
    const shown = appearanceText(doc, "country");
    expect(shown).toContain(hexOf("Bangladesh"));
    expect(shown).not.toContain(hexOf("BD") + ">");
  });

  it("an untouched read-only field holding Bengali with no appearance does not sink the save", async () => {
    const result = await applyFormValues(await appearanceLessFormPdf(), {
      name: "John",
    });
    expect(result.appliedCount).toBe(1);
    const doc = await PDFDocument.load(result.bytes);
    const city = doc.getForm().getTextField("city");
    expect(city.getText()).toBe("ঢাকা");
    expect(
      city.acroField.getWidgets()[0]?.dict.has(PDFName.of("AP")),
      "left exactly as it was: no appearance drawn for it",
    ).toBe(false);
    expect(doc.getForm().getTextField("name").getText()).toBe("John");
  });

  it("an untouched field keeps its author's font; only the filled field is redrawn", async () => {
    const result = await applyFormValues(await appearanceLessFormPdf(), {
      name: "John",
    });
    const doc = await PDFDocument.load(result.bytes);
    const serial = doc.getForm().getTextField("serial");
    expect(serial.acroField.getDefaultAppearance()).toBe("/Courier 12 Tf 0 g");
    expect(serial.acroField.getWidgets()[0]?.dict.has(PDFName.of("AP"))).toBe(
      false,
    );
    // Positive control: the field that WAS filled is DRAWN with its answer.
    // The save runs with updateFieldAppearances:false, so nothing but the
    // per-field redraw puts "John" in the appearance; `name` already had a
    // blank /AP from the fixture's first save, so checking that an /AP merely
    // exists passed with the redraw deleted (review of d5217459, 2026-11-06).
    expect(appearanceText(doc, "name")).toContain(hexOf("John"));
  });

  it("a filled checkbox shows its new state: /AS names an /AP /N appearance", async () => {
    const result = await applyFormValues(await appearanceLessCheckboxPdf(), {
      agree: true,
    });
    expect(result.outcomes.map((o) => o.status)).toEqual(["applied"]);
    const doc = await PDFDocument.load(result.bytes);
    const agree = doc.getForm().getCheckBox("agree");
    const on = agree.acroField.getOnValue();
    expect(on).toBeDefined();
    expect(agree.acroField.getValue()).toBe(on);
    const widgets = agree.acroField.getWidgets().map((w) => {
      const normal = w.getAppearances()?.normal;
      const state = w.getAppearanceState();
      return {
        state: state?.decodeText(),
        drawn: normal instanceof PDFDict && !!state && normal.has(state),
      };
    });
    expect(widgets).toEqual([{ state: on?.decodeText(), drawn: true }]);
  });

  it("a field whose redraw throws is reported invalid AND left as it was", async () => {
    const bytes = await prefilledTextPdf();
    const spy = vi
      .spyOn(PDFTextField.prototype, "defaultUpdateAppearances")
      .mockImplementation(() => {
        throw new Error("layout failed");
      });
    let result: Awaited<ReturnType<typeof applyFormValues>>;
    let calls = 0;
    try {
      result = await applyFormValues(bytes, { note: "new", blank: "new" });
      calls = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
    expect(calls, "the injected failure really ran").toBeGreaterThan(0);
    expect(result.outcomes.map((o) => o.status)).toEqual([
      "invalid",
      "invalid",
    ]);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getForm().getTextField("note").getText()).toBe("old");
    expect(
      doc.getForm().getTextField("blank").acroField.dict.has(PDFName.of("V")),
    ).toBe(false);
    // Positive control: without the failure the same answers are written.
    const ok = await applyFormValues(bytes, { note: "new", blank: "new" });
    const okDoc = await PDFDocument.load(ok.bytes);
    expect(okDoc.getForm().getTextField("note").getText()).toBe("new");
    expect(okDoc.getForm().getTextField("blank").getText()).toBe("new");
  });
});

/**
 * A checkbox with NO appearance stream, as a generator that sets
 * `/NeedAppearances` writes it, so only our redraw can give the checked state
 * something to show. (A radio group cannot be built this way: pdf-lib finds a
 * radio's options in its widgets' appearance names.)
 */
async function appearanceLessCheckboxPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 10, y: 740, width: 20, height: 20 });
  await doc.save();
  for (const widget of agree.acroField.getWidgets()) {
    widget.dict.delete(PDFName.of("AP"));
  }
  form.markFieldAsClean(agree.ref);
  return doc.save({ updateFieldAppearances: false });
}

/** `note` already holds "old"; `blank` has never had a value. */
async function prefilledTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const note = form.createTextField("note");
  note.setText("old");
  note.addToPage(page, { x: 10, y: 740, width: 200, height: 20 });
  const blank = form.createTextField("blank");
  blank.addToPage(page, { x: 10, y: 700, width: 200, height: 20 });
  return doc.save();
}
