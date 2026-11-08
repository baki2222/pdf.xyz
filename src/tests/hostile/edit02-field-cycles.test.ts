import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine-errors";
import { MAX_FIELD_DEPTH, repairFieldTree } from "@/lib/pdf/form-tree";
import { runBounded } from "./bounded";

// EDIT-02: an AcroForm field cycle (a field whose /Kids names itself, or whose
// /Parent climbs back into its own chain) reached all 7 form entry points as a
// raw "RangeError: Maximum call stack size exceeded", because pdf-lib walks
// the field tree by recursion both ways. pdf.js renders such a page, so the
// fix cuts the edge that closes the loop (src/lib/pdf/form-tree.ts) and the
// form keeps working: listed, filled, flattened, extended.
//
// Every case runs in a child process: the defect recursed until the stack ran
// out, the diamond case looped for 2^30 visits (a hang, killed at the bound),
// and a broken repair could loop forever just as easily.
const CHILD = "src/tests/hostile/edit02-field-cycles.child.ts";

const ENTRY_POINTS = [
  "inspectFormFields",
  "applyFormValues",
  "applyFormValuesFlatten",
  "readFormContext",
  "createFormFields",
  "inspectForm",
  "flattenPdf",
] as const;

type Row = Record<string, unknown> & { ok: boolean };

async function runAll(name: string, boundMs = 60_000) {
  const r = await runBounded(CHILD, [name, "all"], boundMs);
  expect(r.kind, JSON.stringify(r)).toBe("settled");
  const rows = (r as { value: Record<string, Row> }).value;
  // Health check: the child ran every entry point, not a subset.
  expect(Object.keys(rows).sort()).toEqual([...ENTRY_POINTS].sort());
  return rows;
}

/** What every entry point must report for a one-field form named `name`. */
function workingForm(field: string) {
  return {
    inspectFormFields: { ok: true, names: [field] },
    applyFormValues: { ok: true, applied: 1, values: ["x"], pages: 1 },
    applyFormValuesFlatten: { ok: true, applied: 1, flattened: true },
    readFormContext: { ok: true, names: [field], pages: 1 },
    createFormFields: { ok: true, names: [field, "added"] },
    inspectForm: { ok: true, fields: 1 },
    flattenPdf: { ok: true, total: 1, flattened: 1, pages: 1 },
  };
}

describe("EDIT-02: AcroForm field cycles are cut, and the form works", () => {
  test("EDIT-02: /Kids that names itself (H07-form-kids-cycle)", async () => {
    expect(await runAll("H07-form-kids-cycle")).toEqual(workingForm("loop"));
  }, 70_000);

  test("EDIT-02: /Parent that is itself (H07-form-parent-self)", async () => {
    expect(await runAll("H07-form-parent-self")).toEqual(workingForm("self"));
  }, 70_000);

  // The loop is two fields ABOVE the widget and outside the /Fields tree: the
  // widget gets back the parent whose /Kids lists it, so its name is the one
  // the tree gives it and pdf-lib's flatten can remove it (a plain cut left
  // flatten throwing "Tried to remove inexistent field").
  test("EDIT-02: a /Parent chain that loops above the field", async () => {
    expect(await runAll("parent-loop")).toEqual(workingForm("top.kid"));
  }, 70_000);

  // Not a cycle, the same root: 30 levels that each name the next twice cost
  // pdf-lib's walk 2^30 visits (a hang before the fix).
  test("EDIT-02: a field named twice by its parent (diamond, 30 levels)", async () => {
    const leaf = `${"d.".repeat(30)}leaf`;
    expect(await runAll("diamond:30")).toEqual(workingForm(leaf));
  }, 70_000);
});

describe("EDIT-02: the cut keeps a field where its /Parent puts it", () => {
  // A widget listed in /Fields AND in its parent's /Kids. Cutting "a field
  // named twice" must keep the edge its /Parent agrees with: pdf-lib alone
  // lists it twice ("p.kid", "p.kid"), and a cut that kept the first edge
  // would orphan the parent.
  test("EDIT-02: a widget in /Fields and in its parent's /Kids is listed once", async () => {
    expect(await runAll("root-and-kid")).toEqual(workingForm("p.kid"));
  }, 70_000);
});

describe("EDIT-02: field-tree depth limit", () => {
  test(`EDIT-02: a tree exactly MAX_FIELD_DEPTH (${MAX_FIELD_DEPTH}) deep works everywhere`, async () => {
    const leaf = `${"n.".repeat(MAX_FIELD_DEPTH - 1)}leaf`;
    expect(await runAll(`chain:${MAX_FIELD_DEPTH}`)).toEqual(workingForm(leaf));
  }, 70_000);

  // Both directions are bounded on their own: `kids-chain` exists only as
  // /Kids (only the downward walk sees its depth) and `parent-chain` only as
  // /Parent links above a root (only the upward walk does), so neither check
  // can hide behind the other. `chain` has both.
  for (const shape of ["chain", "kids-chain", "parent-chain"]) {
    test(`EDIT-02: one level deeper (${shape}) is refused with the unreadable-file copy`, async () => {
      const rows = await runAll(`${shape}:${MAX_FIELD_DEPTH + 1}`);
      for (const entry of ENTRY_POINTS) {
        expect(rows[entry], entry).toEqual({
          ok: false,
          typed: true,
          name: "PdfEngineError",
          message: UNREADABLE_PDF_MESSAGE,
        });
      }
    }, 70_000);
  }

  // The second, independent bound on the constant: pdf-lib's own walk, with
  // no repair in front of it, still survives 8x the limit on a default-size
  // Node stack. If pdf-lib ever recursed deeper per level, this goes red
  // before the limit stops leaving headroom.
  test("EDIT-02: pdf-lib's bare walk survives 8x MAX_FIELD_DEPTH on a default stack", async () => {
    const r = await runBounded(
      CHILD,
      [`chain:${MAX_FIELD_DEPTH * 8}`, "bareWalk"],
      60_000,
    );
    expect(r).toMatchObject({
      kind: "settled",
      value: { ok: true, fields: 1 },
    });
  }, 70_000);
});

describe("EDIT-02: a healthy form is left exactly as it was", () => {
  const saveClassic = (doc: PDFDocument) =>
    doc.save({ useObjectStreams: false, updateFieldAppearances: false });

  // `updateMetadata: false`: a load otherwise stamps ModDate with the clock,
  // and two saves a second apart differ for a reason that is not the repair.
  const load = (bytes: Uint8Array) =>
    PDFDocument.load(bytes, { updateMetadata: false });

  async function unchangedByRepair(bytes: Uint8Array) {
    const before = await saveClassic(await load(bytes));
    const doc = await load(bytes);
    repairFieldTree({ PDFArray, PDFDict, PDFName }, doc);
    expect(
      Buffer.from(await saveClassic(doc)).equals(Buffer.from(before)),
    ).toBe(true);
  }

  test("EDIT-02: nested names, a radio group and a two-widget checkbox", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const form = doc.getForm();
    form
      .createTextField("person.name.first")
      .addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    form
      .createTextField("person.name.last")
      .addToPage(page, { x: 10, y: 40, width: 100, height: 20 });
    const radio = form.createRadioGroup("person.choice");
    radio.addOptionToPage("a", page, { x: 10, y: 80, width: 15, height: 15 });
    radio.addOptionToPage("b", page, { x: 40, y: 80, width: 15, height: 15 });
    const box = form.createCheckBox("agree");
    box.addToPage(page, { x: 10, y: 120, width: 15, height: 15 });
    box.addToPage(page, { x: 40, y: 120, width: 15, height: 15 });
    const bytes = await doc.save();

    // Positive control: this form really has depth and shared parents.
    const loaded = await PDFDocument.load(bytes);
    const names = loaded
      .getForm()
      .getFields()
      .map((f) => f.getName())
      .sort();
    expect(names).toEqual([
      "agree",
      "person.choice",
      "person.name.first",
      "person.name.last",
    ]);
    await unchangedByRepair(bytes);
  });

  test("EDIT-02: every legit-corpus file is left byte-identical", async () => {
    const dir = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
    const files = readdirSync(dir).filter((f) => f.endsWith(".pdf"));
    // Health check: the corpus is the size the corpus test pins.
    expect(files.length).toBe(14);
    for (const file of files) {
      await unchangedByRepair(
        new Uint8Array(readFileSync(path.join(dir, file))),
      );
    }
  }, 60_000);
});
