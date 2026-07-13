import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PdfEngineError } from "./engine";
import { inspectFormFields } from "./forms";
import {
  createdFormOutputName,
  createFormFields,
  describeFieldType,
  parseOptions,
  readFormContext,
  validateFormFields,
  type NewFormField,
  type PageDimensions,
} from "./create-forms";

/** A plain PDF with `pages` blank pages of the given size — no form fields. */
async function blankPdf(
  pages = 1,
  size: [number, number] = [612, 792],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage(size);
  return doc.save();
}

/** A PDF that already carries one AcroForm text field named "existing". */
async function pdfWithExistingField(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const field = doc.getForm().createTextField("existing");
  field.setText("keep me");
  field.addToPage(page, { x: 20, y: 700, width: 120, height: 20 });
  return doc.save();
}

/** Find the field / outcome with a given name, or fail loudly. */
function byName<T extends { name: string }>(items: T[], name: string): T {
  const item = items.find((i) => i.name === name);
  if (!item) throw new Error(`missing: ${name}`);
  return item;
}

const PAGE: PageDimensions[] = [{ width: 612, height: 792 }];

describe("createdFormOutputName", () => {
  it("derives a -form name from the source", () => {
    expect(createdFormOutputName("W-9.pdf")).toBe("W-9-form.pdf");
    expect(createdFormOutputName("")).toBe("document-form.pdf");
  });
});

describe("describeFieldType", () => {
  it("labels each creatable type", () => {
    expect(describeFieldType("text")).toBe("Text field");
    expect(describeFieldType("optionlist")).toBe("Option list");
    expect(describeFieldType("radio")).toBe("Radio group");
  });
});

describe("parseOptions", () => {
  it("splits one option per line and drops blanks", () => {
    expect(parseOptions("A\nB\n\n  C  ")).toEqual(["A", "B", "C"]);
    expect(parseOptions("")).toEqual([]);
  });

  it("keeps commas so options can contain them", () => {
    expect(parseOptions("New York, NY\nLos Angeles, CA")).toEqual([
      "New York, NY",
      "Los Angeles, CA",
    ]);
  });
});

describe("readFormContext", () => {
  it("reports page count, sizes, and existing field names", async () => {
    const ctx = await readFormContext(await pdfWithExistingField());
    expect(ctx.pageCount).toBe(1);
    expect(ctx.pageSizes[0]).toMatchObject({ width: 612, height: 792 });
    expect(ctx.existingNames).toEqual(["existing"]);
  });

  it("returns no names for a form-less PDF", async () => {
    const ctx = await readFormContext(await blankPdf(2));
    expect(ctx.pageCount).toBe(2);
    expect(ctx.existingNames).toEqual([]);
  });
});

describe("validateFormFields", () => {
  it("requires at least one field", () => {
    expect(validateFormFields([], PAGE)).toEqual([
      { index: -1, message: "Add at least one field to create." },
    ]);
  });

  it("flags a missing name", () => {
    const errors = validateFormFields(
      [{ type: "text", name: "  ", page: 1, x: 10, y: 10, width: 100, height: 20 }],
      PAGE,
    );
    expect(errors).toContainEqual({ index: 0, message: "Give this field a name." });
  });

  it("flags duplicate names on every occurrence", () => {
    const errors = validateFormFields(
      [
        { type: "text", name: "dupe", page: 1, x: 10, y: 10, width: 100, height: 20 },
        { type: "checkbox", name: "dupe", page: 1, x: 10, y: 40, width: 15, height: 15 },
      ],
      PAGE,
    );
    const dupes = errors.filter((e) => /Duplicate field name/.test(e.message));
    expect(dupes.map((e) => e.index)).toEqual([0, 1]);
  });

  it("rejects a name already used by the PDF's existing fields", () => {
    const errors = validateFormFields(
      [{ type: "text", name: "existing", page: 1, x: 10, y: 10, width: 100, height: 20 }],
      PAGE,
      ["existing"],
    );
    expect(errors.some((e) => /already exists in this PDF/.test(e.message))).toBe(true);
  });

  it("rejects an out-of-range page", () => {
    const errors = validateFormFields(
      [{ type: "text", name: "a", page: 2, x: 10, y: 10, width: 100, height: 20 }],
      PAGE,
    );
    expect(errors.some((e) => /Page 2 is out of range/.test(e.message))).toBe(true);
  });

  it("rejects non-positive width and height", () => {
    const errors = validateFormFields(
      [{ type: "text", name: "a", page: 1, x: 10, y: 10, width: 0, height: -5 }],
      PAGE,
    );
    expect(errors.some((e) => /Width must be greater than 0/.test(e.message))).toBe(true);
    expect(errors.some((e) => /Height must be greater than 0/.test(e.message))).toBe(true);
  });

  it("rejects a field that extends past the page", () => {
    const errors = validateFormFields(
      [{ type: "text", name: "a", page: 1, x: 500, y: 10, width: 200, height: 20 }],
      PAGE,
    );
    expect(errors.some((e) => /extends past page 1/.test(e.message))).toBe(true);
  });

  it("checks each stacked radio button against the page bounds", () => {
    const small: PageDimensions[] = [{ width: 200, height: 200 }];
    const off = validateFormFields(
      [
        {
          type: "radio",
          name: "r",
          page: 1,
          x: 10,
          y: 10,
          width: 15,
          height: 15,
          options: ["a", "b", "c"],
        },
      ],
      small,
    );
    expect(off.some((e) => /extends past page/.test(e.message))).toBe(true);

    const ok = validateFormFields(
      [
        {
          type: "radio",
          name: "r",
          page: 1,
          x: 10,
          y: 150,
          width: 15,
          height: 15,
          options: ["a", "b", "c"],
        },
      ],
      small,
    );
    expect(ok).toEqual([]);
  });

  it("enforces per-type option requirements", () => {
    const noOptions = validateFormFields(
      [{ type: "dropdown", name: "d", page: 1, x: 10, y: 10, width: 100, height: 20, options: [] }],
      PAGE,
    );
    expect(noOptions.some((e) => /at least one option/.test(e.message))).toBe(true);

    const oneRadio = validateFormFields(
      [
        {
          type: "radio",
          name: "r",
          page: 1,
          x: 10,
          y: 10,
          width: 15,
          height: 15,
          options: ["only"],
        },
      ],
      PAGE,
    );
    expect(oneRadio.some((e) => /at least two options/.test(e.message))).toBe(true);
  });

  it("rejects blank and duplicate options", () => {
    const errors = validateFormFields(
      [
        {
          type: "optionlist",
          name: "l",
          page: 1,
          x: 10,
          y: 10,
          width: 100,
          height: 60,
          options: ["a", "", "a"],
        },
      ],
      PAGE,
    );
    expect(errors.some((e) => /can't be blank/.test(e.message))).toBe(true);
    expect(errors.some((e) => /Duplicate option/.test(e.message))).toBe(true);
  });

  it("requires a default value to match the options unless the dropdown is a combo box", () => {
    const bad = validateFormFields(
      [
        {
          type: "dropdown",
          name: "d",
          page: 1,
          x: 10,
          y: 100,
          width: 100,
          height: 20,
          options: ["a", "b"],
          defaultValue: "zzz",
        },
      ],
      PAGE,
    );
    expect(bad.some((e) => /isn't one of the options/.test(e.message))).toBe(true);

    const editableOk = validateFormFields(
      [
        {
          type: "dropdown",
          name: "d",
          page: 1,
          x: 10,
          y: 100,
          width: 100,
          height: 20,
          options: ["a", "b"],
          editable: true,
          defaultValue: "zzz",
        },
      ],
      PAGE,
    );
    expect(editableOk).toEqual([]);
  });

  it("validates text max length and default length", () => {
    const badMax = validateFormFields(
      [{ type: "text", name: "t", page: 1, x: 10, y: 10, width: 100, height: 20, maxLength: 0 }],
      PAGE,
    );
    expect(badMax.some((e) => /Max length must be a positive/.test(e.message))).toBe(true);

    const tooLong = validateFormFields(
      [
        {
          type: "text",
          name: "t",
          page: 1,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
          maxLength: 3,
          defaultValue: "abcd",
        },
      ],
      PAGE,
    );
    expect(tooLong.some((e) => /longer than the 3-character limit/.test(e.message))).toBe(true);
  });

  it("returns no errors for a valid field", () => {
    expect(
      validateFormFields(
        [{ type: "text", name: "ok", page: 1, x: 20, y: 700, width: 200, height: 24 }],
        PAGE,
      ),
    ).toEqual([]);
  });
});

describe("createFormFields", () => {
  it("creates every field type and persists them on reload", async () => {
    const specs: NewFormField[] = [
      {
        type: "text",
        name: "full_name",
        page: 1,
        x: 20,
        y: 740,
        width: 200,
        height: 24,
        defaultValue: "Ada",
        maxLength: 40,
      },
      { type: "checkbox", name: "agree", page: 1, x: 20, y: 710, width: 15, height: 15, checked: true },
      {
        type: "dropdown",
        name: "city",
        page: 1,
        x: 20,
        y: 670,
        width: 200,
        height: 22,
        options: ["NYC", "LA", "SF"],
        defaultValue: "LA",
      },
      {
        type: "optionlist",
        name: "langs",
        page: 1,
        x: 20,
        y: 560,
        width: 200,
        height: 80,
        options: ["EN", "FR", "DE"],
        multiselect: true,
        defaultValue: "FR",
      },
      {
        type: "radio",
        name: "color",
        page: 1,
        x: 300,
        y: 740,
        width: 15,
        height: 15,
        options: ["Red", "Blue"],
        defaultValue: "Blue",
      },
    ];

    const result = await createFormFields(await blankPdf(), specs);
    expect(result.fieldCount).toBe(5);
    expect(result.names).toEqual(["full_name", "agree", "city", "langs", "color"]);

    const { hasFields, fields, fillableCount } = await inspectFormFields(result.bytes);
    expect(hasFields).toBe(true);
    expect(fillableCount).toBe(5);

    expect(byName(fields, "full_name")).toMatchObject({
      type: "text",
      text: "Ada",
      maxLength: 40,
    });
    expect(byName(fields, "agree")).toMatchObject({ type: "checkbox", checked: true });
    expect(byName(fields, "city")).toMatchObject({
      type: "dropdown",
      options: ["NYC", "LA", "SF"],
      selected: ["LA"],
    });
    expect(byName(fields, "langs")).toMatchObject({
      type: "optionlist",
      options: ["EN", "FR", "DE"],
      selected: ["FR"],
      multiselect: true,
    });
    expect(byName(fields, "color")).toMatchObject({
      type: "radio",
      options: ["Red", "Blue"],
      selected: ["Blue"],
    });
  });

  it("creates a multiline text field", async () => {
    const result = await createFormFields(await blankPdf(), [
      { type: "text", name: "notes", page: 1, x: 20, y: 600, width: 200, height: 60, multiline: true },
    ]);
    expect(byName((await inspectFormFields(result.bytes)).fields, "notes")).toMatchObject({
      type: "text",
      multiline: true,
    });
  });

  it("creates an editable (combo) dropdown holding a custom default", async () => {
    const result = await createFormFields(await blankPdf(), [
      {
        type: "dropdown",
        name: "combo",
        page: 1,
        x: 20,
        y: 700,
        width: 200,
        height: 22,
        options: ["A", "B"],
        editable: true,
        defaultValue: "Custom",
      },
    ]);
    expect(byName((await inspectFormFields(result.bytes)).fields, "combo")).toMatchObject({
      type: "dropdown",
      editable: true,
      selected: ["Custom"],
    });
  });

  it("adds fields without disturbing the PDF's existing form fields", async () => {
    const result = await createFormFields(await pdfWithExistingField(), [
      { type: "checkbox", name: "newbox", page: 1, x: 20, y: 600, width: 15, height: 15 },
    ]);
    const { fields } = await inspectFormFields(result.bytes);
    expect([...fields.map((f) => f.name)].sort()).toEqual(["existing", "newbox"]);
    expect(byName(fields, "existing")).toMatchObject({ type: "text", text: "keep me" });
  });

  it("throws a typed error for an invalid spec instead of writing a broken form", async () => {
    await expect(
      createFormFields(await blankPdf(), [
        { type: "text", name: "", page: 1, x: 10, y: 10, width: 100, height: 20 },
      ]),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });

  it("refuses to create a field that collides with an existing name", async () => {
    await expect(
      createFormFields(await pdfWithExistingField(), [
        { type: "text", name: "existing", page: 1, x: 10, y: 10, width: 100, height: 20 },
      ]),
    ).rejects.toThrow(/already exists/);
  });
});
