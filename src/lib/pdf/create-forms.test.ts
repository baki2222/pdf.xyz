import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
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
      [
        {
          type: "text",
          name: "  ",
          page: 1,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
        },
      ],
      PAGE,
    );
    expect(errors).toContainEqual({
      index: 0,
      message: "Give this field a name.",
    });
  });

  it("flags duplicate names on every occurrence", () => {
    const errors = validateFormFields(
      [
        {
          type: "text",
          name: "dupe",
          page: 1,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
        },
        {
          type: "checkbox",
          name: "dupe",
          page: 1,
          x: 10,
          y: 40,
          width: 15,
          height: 15,
        },
      ],
      PAGE,
    );
    const dupes = errors.filter((e) => /Duplicate field name/.test(e.message));
    expect(dupes.map((e) => e.index)).toEqual([0, 1]);
  });

  it("rejects a name already used by the PDF's existing fields", () => {
    const errors = validateFormFields(
      [
        {
          type: "text",
          name: "existing",
          page: 1,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
        },
      ],
      PAGE,
      ["existing"],
    );
    expect(
      errors.some((e) => /already exists in this PDF/.test(e.message)),
    ).toBe(true);
  });

  it("rejects an out-of-range page", () => {
    const errors = validateFormFields(
      [
        {
          type: "text",
          name: "a",
          page: 2,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
        },
      ],
      PAGE,
    );
    expect(errors.some((e) => /Page 2 is out of range/.test(e.message))).toBe(
      true,
    );
  });

  it("rejects non-positive width and height", () => {
    const errors = validateFormFields(
      [
        {
          type: "text",
          name: "a",
          page: 1,
          x: 10,
          y: 10,
          width: 0,
          height: -5,
        },
      ],
      PAGE,
    );
    expect(
      errors.some((e) => /Width must be greater than 0/.test(e.message)),
    ).toBe(true);
    expect(
      errors.some((e) => /Height must be greater than 0/.test(e.message)),
    ).toBe(true);
  });

  it("rejects a field that extends past the page", () => {
    const errors = validateFormFields(
      [
        {
          type: "text",
          name: "a",
          page: 1,
          x: 500,
          y: 10,
          width: 200,
          height: 20,
        },
      ],
      PAGE,
    );
    expect(errors.some((e) => /extends past page 1/.test(e.message))).toBe(
      true,
    );
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
      [
        {
          type: "dropdown",
          name: "d",
          page: 1,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
          options: [],
        },
      ],
      PAGE,
    );
    expect(noOptions.some((e) => /at least one option/.test(e.message))).toBe(
      true,
    );

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
    expect(oneRadio.some((e) => /at least two options/.test(e.message))).toBe(
      true,
    );
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
    expect(bad.some((e) => /isn't one of the options/.test(e.message))).toBe(
      true,
    );

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
      [
        {
          type: "text",
          name: "t",
          page: 1,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
          maxLength: 0,
        },
      ],
      PAGE,
    );
    expect(
      badMax.some((e) => /Max length must be a positive/.test(e.message)),
    ).toBe(true);

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
    expect(
      tooLong.some((e) => /longer than the 3-character limit/.test(e.message)),
    ).toBe(true);
  });

  it("returns no errors for a valid field", () => {
    expect(
      validateFormFields(
        [
          {
            type: "text",
            name: "ok",
            page: 1,
            x: 20,
            y: 700,
            width: 200,
            height: 24,
          },
        ],
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
      {
        type: "checkbox",
        name: "agree",
        page: 1,
        x: 20,
        y: 710,
        width: 15,
        height: 15,
        checked: true,
      },
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
    expect(result.names).toEqual([
      "full_name",
      "agree",
      "city",
      "langs",
      "color",
    ]);

    const { hasFields, fields, fillableCount } = await inspectFormFields(
      result.bytes,
    );
    expect(hasFields).toBe(true);
    expect(fillableCount).toBe(5);

    expect(byName(fields, "full_name")).toMatchObject({
      type: "text",
      text: "Ada",
      maxLength: 40,
    });
    expect(byName(fields, "agree")).toMatchObject({
      type: "checkbox",
      checked: true,
    });
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
      {
        type: "text",
        name: "notes",
        page: 1,
        x: 20,
        y: 600,
        width: 200,
        height: 60,
        multiline: true,
      },
    ]);
    expect(
      byName((await inspectFormFields(result.bytes)).fields, "notes"),
    ).toMatchObject({
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
    expect(
      byName((await inspectFormFields(result.bytes)).fields, "combo"),
    ).toMatchObject({
      type: "dropdown",
      editable: true,
      selected: ["Custom"],
    });
  });

  it("adds fields without disturbing the PDF's existing form fields", async () => {
    const result = await createFormFields(await pdfWithExistingField(), [
      {
        type: "checkbox",
        name: "newbox",
        page: 1,
        x: 20,
        y: 600,
        width: 15,
        height: 15,
      },
    ]);
    const { fields } = await inspectFormFields(result.bytes);
    expect([...fields.map((f) => f.name)].sort()).toEqual([
      "existing",
      "newbox",
    ]);
    expect(byName(fields, "existing")).toMatchObject({
      type: "text",
      text: "keep me",
    });
  });

  it("throws a typed error for an invalid spec instead of writing a broken form", async () => {
    await expect(
      createFormFields(await blankPdf(), [
        {
          type: "text",
          name: "",
          page: 1,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
        },
      ]),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });

  it("refuses to create a field that collides with an existing name", async () => {
    await expect(
      createFormFields(await pdfWithExistingField(), [
        {
          type: "text",
          name: "existing",
          page: 1,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
        },
      ]),
    ).rejects.toThrow(/already exists/);
  });
});

/* ------------------------------------------------------------------ *
 *  Rotated and offset pages — pdf-lib's view of the widget dictionary.
 *  What a READER sees is pinned in create-forms.pdfjs.test.ts; these pin
 *  the numbers written into /Rect and /MK /R, worked by hand.
 * ------------------------------------------------------------------ */

/** A page of the given media-box size carrying `/Rotate turn`. */
async function rotatedPdf(
  turn: number,
  size: [number, number] = [612, 792],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage(size).setRotation(degrees(turn));
  return doc.save();
}

/** The widget rectangle and /MK /R of the first widget of field `name`. */
async function widgetOf(
  bytes: Uint8Array,
  name: string,
): Promise<{
  rect: { x: number; y: number; width: number; height: number };
  rotation: number | undefined;
}> {
  const doc = await PDFDocument.load(bytes);
  const widget = doc.getForm().getField(name).acroField.getWidgets()[0]!;
  return {
    rect: widget.getRectangle(),
    rotation: widget.getAppearanceCharacteristics()?.getRotation(),
  };
}

const PROBE_FIELD: NewFormField = {
  type: "text",
  name: "probe",
  page: 1,
  x: 50,
  y: 50,
  width: 200,
  height: 20,
};

describe("createFormFields on rotated and offset pages", () => {
  // A 200×20 field at displayed (50, 50) on a Letter page, turned. pdf-lib
  // grows the box by its 1 pt border (201×21, shifted 0.5). Worked by hand
  // from the page's clockwise display turn, not from the code under test.
  const LETTER_RECTS: Record<number, object> = {
    0: { x: 49.5, y: 49.5, width: 201, height: 21 },
    90: { x: 541.5, y: 49.5, width: 21, height: 201 },
    180: { x: 361.5, y: 721.5, width: 201, height: 21 },
    270: { x: 49.5, y: 541.5, width: 21, height: 201 },
  };
  const QUARTER_TURNS = Array.from({ length: 4 }, (_, q) => q * 90);

  it("HEALTH CHECK: the worked table covers every quarter turn", () => {
    expect(Object.keys(LETTER_RECTS).map(Number)).toEqual(QUARTER_TURNS);
  });

  for (const turn of QUARTER_TURNS) {
    it(`/Rotate ${turn}: the widget's /Rect and /MK /R`, async () => {
      const result = await createFormFields(await rotatedPdf(turn), [
        PROBE_FIELD,
      ]);
      const { rect, rotation } = await widgetOf(result.bytes, "probe");
      expect(rect).toEqual(LETTER_RECTS[turn]);
      expect(rotation).toBe(turn);
    });
  }

  it("the audit's case: landscape media shown portrait by /Rotate 90", async () => {
    const bytes = await rotatedPdf(90, [842, 595]);
    const ctx = await readFormContext(bytes);
    expect(ctx.pageSizes).toEqual([{ width: 595, height: 842 }]);

    const result = await createFormFields(bytes, [PROBE_FIELD]);
    expect((await widgetOf(result.bytes, "probe")).rect).toEqual({
      x: 771.5,
      y: 49.5,
      width: 21,
      height: 201,
    });
  });

  it("validates against the DISPLAYED size: y 700 fits a portrait-shown page, x 700 does not", async () => {
    const bytes = await rotatedPdf(90, [842, 595]);
    const { pageSizes } = await readFormContext(bytes);
    const tall = { ...PROBE_FIELD, name: "tall", y: 700 };
    const wide = { ...PROBE_FIELD, name: "wide", x: 700 };
    // Positive control: before the fix, the media box (842 wide, 595 tall)
    // was the bound, and exactly these two verdicts were the other way round.
    expect(validateFormFields([tall], pageSizes)).toEqual([]);
    expect(validateFormFields([wide], pageSizes)).toHaveLength(1);
    await expect(createFormFields(bytes, [tall])).resolves.toBeTruthy();
    await expect(createFormFields(bytes, [wide])).rejects.toBeInstanceOf(
      PdfEngineError,
    );
  });

  it("measures from the visible corner of a page whose MediaBox is offset", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).setMediaBox(0, 200, 612, 592);
    const bytes = await doc.save();
    expect((await readFormContext(bytes)).pageSizes).toEqual([
      { width: 612, height: 592 },
    ]);

    const result = await createFormFields(bytes, [PROBE_FIELD]);
    const { rect } = await widgetOf(result.bytes, "probe");
    expect(rect.y).toBe(249.5);
    expect(rect.y).toBeGreaterThanOrEqual(200);

    // The top of the visible box is 592 up from ITS corner, not from 0.
    await expect(
      createFormFields(bytes, [{ ...PROBE_FIELD, y: 580 }]),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });
});

/* ------------------------------------------------------------------ *
 *  Dotted names. pdf-lib reads "." as a group separator, so a name can
 *  clash with another it does not equal. The validator is checked against
 *  pdf-lib ITSELF over a generated corpus — the relationship, both ways.
 * ------------------------------------------------------------------ */

/** Every name of 1–3 parts over {"a", "b", ""} — well-formed and not. */
function nameCorpus(): string[] {
  const parts = ["a", "b", ""];
  let level = parts.map((p) => [p]);
  const all: string[][] = [...level];
  for (let depth = 2; depth <= 3; depth += 1) {
    level = level.flatMap((path) => parts.map((p) => [...path, p]));
    all.push(...level);
  }
  // The single empty name is the "Give this field a name" case, covered
  // above and not a hierarchy question.
  return [...new Set(all.map((path) => path.join(".")))].filter(Boolean);
}

/** pdf-lib's own verdict: can these names be created, in this order? */
function pdfLibAccepts(doc: PDFDocument, names: string[]): boolean {
  const form = doc.getForm();
  try {
    for (const name of names) form.createTextField(name);
    return true;
  } catch {
    return false;
  }
}

async function pdfWithField(name: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  doc
    .getForm()
    .createTextField(name)
    .addToPage(page, { x: 20, y: 700, width: 120, height: 20 });
  return doc.save();
}

const at = (name: string, y = 10): NewFormField => ({
  type: "text",
  name,
  page: 1,
  x: 10,
  y,
  width: 100,
  height: 20,
});

describe("dotted field names agree with pdf-lib", () => {
  it("a single name: flagged exactly when pdf-lib refuses it", async () => {
    const names = nameCorpus();
    const refused: string[] = [];
    for (const name of names) {
      const ok = pdfLibAccepts(await PDFDocument.create(), [name]);
      if (!ok) refused.push(name);
      expect(
        validateFormFields([at(name)], PAGE).length === 0,
        `validator vs pdf-lib on "${name}"`,
      ).toBe(ok);
    }
    // Health: the corpus is the size it was built to be, and both verdicts
    // occur — including the three shapes the audit named.
    expect(names.length).toBeGreaterThan(30);
    expect(refused).toEqual(expect.arrayContaining(["a..b", ".a", "a."]));
    expect(names.length - refused.length).toBe(14);
  });

  it("two new names, and a new name against the PDF's: flagged exactly when pdf-lib refuses the pair", async () => {
    const wellFormed: string[] = [];
    for (const name of nameCorpus()) {
      if (pdfLibAccepts(await PDFDocument.create(), [name])) {
        wellFormed.push(name);
      }
    }
    const verdicts = { accepted: 0, refused: 0 };
    for (const first of wellFormed) {
      const existing = await pdfWithField(first);
      const { existingNames } = await readFormContext(existing);
      for (const second of wellFormed) {
        const ok = pdfLibAccepts(await PDFDocument.create(), [first, second]);
        verdicts[ok ? "accepted" : "refused"] += 1;
        const pair = `"${first}" then "${second}"`;

        // Both new in one run.
        expect(
          validateFormFields([at(first), at(second, 40)], PAGE).length === 0,
          `new + new: ${pair}`,
        ).toBe(ok);
        // `first` already in the PDF; the runner passes its names as reserved.
        expect(
          validateFormFields([at(second)], PAGE, existingNames).length === 0,
          `existing + new: ${pair}`,
        ).toBe(ok);

        // And the consumer: the job either succeeds, or refuses with OUR
        // typed error — never pdf-lib's raw one.
        const run = createFormFields(existing, [at(second)]);
        if (ok) await expect(run, pair).resolves.toBeTruthy();
        else await expect(run, pair).rejects.toBeInstanceOf(PdfEngineError);
      }
    }
    // Health: 14 well-formed names, 196 ordered pairs, both verdicts common.
    expect(wellFormed).toHaveLength(14);
    expect(verdicts.accepted + verdicts.refused).toBe(196);
    expect(verdicts.accepted).toBeGreaterThan(50);
    expect(verdicts.refused).toBeGreaterThan(14);
  });

  it("the audit's cases refuse with a message that names the clash", async () => {
    await expect(
      createFormFields(await blankPdf(), [
        at("address.city"),
        at("address", 40),
      ]),
    ).rejects.toThrow(/"address" is also a field here/);
    await expect(
      createFormFields(await pdfWithField("a"), [at("a.b")]),
    ).rejects.toThrow(/"a" is already a field in this PDF/);
    await expect(
      createFormFields(await pdfWithField("a.b"), [at("a")]),
    ).rejects.toThrow(/"a" is also the group of "a.b" in this PDF/);
    // Positive control: siblings in one group are fine.
    await expect(
      createFormFields(await pdfWithField("a.b"), [at("a.c")]),
    ).resolves.toMatchObject({ names: ["a.c"] });
  });
});

/* ------------------------------------------------------------------ *
 *  Existing fields are left exactly as they came.
 * ------------------------------------------------------------------ */

/**
 * A PDF whose one text field "old" holds `value` and has NO appearance stream
 * — the shape generators that set NeedAppearances produce.
 */
async function pdfWithBareField(value: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const field = doc.getForm().createTextField("old");
  field.addToPage(page, { x: 20, y: 700, width: 120, height: 20 });
  field.acroField.getWidgets()[0]!.dict.delete(PDFName.of("AP"));
  field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText(value));
  return doc.save({ updateFieldAppearances: false });
}

/** The existing field's dictionary and its widget's, as serialized. */
async function oldFieldDicts(bytes: Uint8Array): Promise<{
  field: string;
  widget: string;
  hasAp: boolean;
}> {
  const doc = await PDFDocument.load(bytes);
  const acro = doc.getForm().getTextField("old").acroField;
  const widget = acro.getWidgets()[0]!;
  return {
    field: acro.dict.toString(),
    widget: widget.dict.toString(),
    hasAp: widget.dict.has(PDFName.of("AP")),
  };
}

describe("existing fields are preserved untouched", () => {
  for (const [label, value] of [
    ["a Latin value (positive control)", "plain words"],
    ["a Bengali and CJK value", "নাম 名前"],
  ] as const) {
    it(`an existing field with ${label} and no /AP keeps its dictionary`, async () => {
      const source = await pdfWithBareField(value);
      const before = await oldFieldDicts(source);
      // Health: the fixture really has no appearance stream.
      expect(before.hasAp).toBe(false);

      const result = await createFormFields(source, [at("new1")]);
      const after = await oldFieldDicts(result.bytes);
      expect(after).toEqual(before);
      const { fields } = await inspectFormFields(result.bytes);
      expect(byName(fields, "old")).toMatchObject({ text: value });
    });
  }
});
