import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
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
    for (const type of ["text", "checkbox", "radio", "dropdown", "optionlist"] as const) {
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
    const { hasFields, fields, fillableCount, unsupportedCount } = await inspectFormFields(bytes);

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
    const { bytes: filled, appliedCount, flattened, outcomes } = await applyFormValues(bytes, {
      "applicant.name": "Grace Hopper",
      "applicant.agree": false,
      "applicant.color": "Blue",
      "applicant.city": "LA",
      "applicant.langs": ["EN", "DE"],
    });

    expect(flattened).toBe(false);
    expect(appliedCount).toBe(5);
    expect(outcomes.every((o) => o.status === "applied")).toBe(true);

    const after = await inspectFormFields(filled);
    expect(byName(after.fields, "applicant.name").text).toBe("Grace Hopper");
    expect(byName(after.fields, "applicant.agree").checked).toBe(false);
    expect(byName(after.fields, "applicant.color").selected).toEqual(["Blue"]);
    expect(byName(after.fields, "applicant.city").selected).toEqual(["LA"]);
    expect(byName(after.fields, "applicant.langs").selected).toEqual(["EN", "DE"]);
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
      { name: "applicant.color", type: "radio", status: "invalid", detail: '"Green" is not an option' },
      { name: "applicant.city", type: "dropdown", status: "invalid", detail: "Not an option: Paris" },
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
    expect(byName(outcomes, "applicant.id")).toMatchObject({ status: "skipped", detail: "Read-only field" });
    expect(byName(outcomes, "applicant.submit")).toMatchObject({ status: "skipped" });
    expect(byName(outcomes, "applicant.missing")).toMatchObject({ status: "missing" });

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

    const { outcomes, bytes: filled } = await applyFormValues(await doc.save(), {
      combo: "Custom",
    });
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
});
