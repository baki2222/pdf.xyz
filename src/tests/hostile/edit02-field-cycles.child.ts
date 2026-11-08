// EDIT-02 child: one form entry point on one AcroForm field-tree case, in a
// plain Node process (a cycle used to recurse until the stack ran out, and a
// broken fix could just as easily loop forever, which only a kill can stop).
//
// argv: <case> <entry point | all>
//   entry: one key of ENTRIES, or `all` to run every one in this process.
//   case: an editingFixtures() id (H07-form-kids-cycle, H07-form-parent-self),
//         or one built here: parent-loop, root-and-kid, diamond:<levels>,
//         chain:<depth>, kids-chain:<depth>, parent-chain:<depth>.
// Reports { ok: true, ...summary } or { ok: false, typed, name, message }.
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { applyFormValues, inspectFormFields } from "../../lib/pdf/forms";
import { createFormFields, readFormContext } from "../../lib/pdf/create-forms";
import { PdfEngineError } from "../../lib/pdf/engine-errors";
import { flattenPdf, inspectForm } from "../../lib/pdf/flatten";
import { reportResult } from "./report";
import {
  editingFixtures,
  rawPdf,
  streamBody,
  type RawObject,
} from "./editing.fixtures";

const [name, entry] = process.argv.slice(2);

/** Catalog 1, Pages 2, Page 3 (annots), content 4; fields from 5. */
function formPdf(fields: string, annots: string, objects: RawObject[]) {
  return rawPdf({
    trailer: "/Root 1 0 R",
    objects: [
      {
        num: 1,
        body: `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${fields}] >> >>`,
      },
      { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        num: 3,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << >> /Annots [${annots}] >>`,
      },
      { num: 4, body: streamBody("", "") },
      ...objects,
    ],
  }).bytes;
}

const WIDGET = "/Type /Annot /Subtype /Widget /Rect [20 200 200 230] /P 3 0 R";

/**
 * A Kids chain `depth` fields deep: 5 is the root, each names the next, and
 * the last is a text widget. Its full name is `n.n.n…leaf`. Without
 * `parents` the chain exists only as /Kids (`kids-chain:<depth>`): the shape
 * pdf-lib's downward walk recurses on, whatever /Parent says.
 */
function chain(depth: number, parents = true) {
  const objects: RawObject[] = [];
  for (let d = 0; d < depth - 1; d += 1) {
    const num = 5 + d;
    const parent = d === 0 || !parents ? "" : ` /Parent ${num - 1} 0 R`;
    objects.push({
      num,
      body: `<< /T (n)${parent} /Kids [${num + 1} 0 R] >>`,
    });
  }
  const leaf = 5 + depth - 1;
  const parent = depth > 1 && parents ? ` /Parent ${leaf - 1} 0 R` : "";
  objects.push({
    num: leaf,
    body: `<< /FT /Tx /T (leaf)${parent} ${WIDGET} >>`,
  });
  return formPdf("5 0 R", `${leaf} 0 R`, objects);
}

/**
 * Each level names the next level TWICE: no cycle, but a walk that does not
 * remember where it has been visits the leaf 2^levels times.
 */
function diamond(levels: number) {
  const objects: RawObject[] = [];
  for (let d = 0; d < levels; d += 1) {
    const num = 5 + d;
    const parent = d === 0 ? "" : ` /Parent ${num - 1} 0 R`;
    objects.push({
      num,
      body: `<< /T (d)${parent} /Kids [${num + 1} 0 R ${num + 1} 0 R] >>`,
    });
  }
  const leaf = 5 + levels;
  objects.push({
    num: leaf,
    body: `<< /FT /Tx /T (leaf) /Parent ${leaf - 1} 0 R ${WIDGET} >>`,
  });
  return formPdf("5 0 R", `${leaf} 0 R`, objects);
}

/** A widget whose /Parent climbs into a 2-node loop outside the field tree. */
function parentLoop() {
  return formPdf("5 0 R", "6 0 R", [
    { num: 5, body: "<< /T (top) /Kids [6 0 R] >>" },
    { num: 6, body: `<< /FT /Tx /T (kid) /Parent 7 0 R ${WIDGET} >>` },
    { num: 7, body: "<< /T (a) /Parent 8 0 R /Kids [6 0 R] >>" },
    { num: 8, body: "<< /T (b) /Parent 7 0 R >>" },
  ]);
}

/** A widget listed both in /Fields and in its parent's /Kids (listed first). */
function rootAndKid() {
  return formPdf("6 0 R 5 0 R", "6 0 R", [
    { num: 5, body: "<< /T (p) /Kids [6 0 R] >>" },
    { num: 6, body: `<< /FT /Tx /T (kid) /Parent 5 0 R ${WIDGET} >>` },
  ]);
}

/**
 * A root widget whose /Parent climbs `above` dictionaries that no /Kids names:
 * deep only upward, the shape pdf-lib's `ascend` and full-name walk recurse on.
 */
function parentChain(above: number) {
  const objects: RawObject[] = [
    { num: 5, body: `<< /FT /Tx /T (leaf) /Parent 6 0 R ${WIDGET} >>` },
  ];
  for (let i = 0; i < above; i += 1) {
    const num = 6 + i;
    const parent = i === above - 1 ? "" : ` /Parent ${num + 1} 0 R`;
    objects.push({ num, body: `<< /T (u)${parent} >>` });
  }
  return formPdf("5 0 R", "5 0 R", objects);
}

async function build(id: string): Promise<Uint8Array> {
  if (id === "parent-loop") return parentLoop();
  if (id === "root-and-kid") return rootAndKid();
  const [kind, n] = id.split(":");
  if (kind === "chain") return chain(Number(n));
  if (kind === "kids-chain") return chain(Number(n), false);
  if (kind === "parent-chain") return parentChain(Number(n) - 1);
  if (kind === "diamond") return diamond(Number(n));
  const fixture = (await editingFixtures()).find((f) => f.id === id);
  if (!fixture) throw new Error(`unknown case ${id}`);
  return fixture.bytes;
}

/** Every field's /V in a saved output, read without the field walk. */
async function valuesIn(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const v = (obj as { get?: (k: PDFName) => unknown }).get?.(PDFName.of("V"));
    if (v instanceof PDFString || v instanceof PDFHexString)
      out.push(v.decodeText());
  }
  return out;
}

const ENTRIES: Record<string, (b: Uint8Array) => Promise<object>> = {
  inspectFormFields: async (b) => {
    const r = await inspectFormFields(b);
    return { names: r.fields.map((f) => f.name) };
  },
  applyFormValues: async (b) => {
    const names = (await inspectFormFields(b)).fields.map((f) => f.name);
    const values = Object.fromEntries(names.map((n) => [n, "x"]));
    const r = await applyFormValues(b, values);
    return {
      applied: r.appliedCount,
      values: await valuesIn(r.bytes),
      pages: (await PDFDocument.load(r.bytes)).getPageCount(),
    };
  },
  applyFormValuesFlatten: async (b) => {
    const names = (await inspectFormFields(b)).fields.map((f) => f.name);
    const values = Object.fromEntries(names.map((n) => [n, "x"]));
    const r = await applyFormValues(b, values, { flatten: true });
    return { applied: r.appliedCount, flattened: r.flattened };
  },
  readFormContext: async (b) => {
    const r = await readFormContext(b);
    return { names: r.existingNames, pages: r.pageCount };
  },
  createFormFields: async (b) => {
    const r = await createFormFields(b, [
      {
        type: "text",
        name: "added",
        page: 1,
        x: 10,
        y: 10,
        width: 100,
        height: 20,
      } as never,
    ]);
    return {
      names: (await inspectFormFields(r.bytes)).fields.map((f) => f.name),
    };
  },
  inspectForm: async (b) => {
    const r = await inspectForm(b);
    return { fields: r.fields };
  },
  flattenPdf: async (b) => {
    const r = await flattenPdf(b);
    return {
      total: r.totalFields,
      flattened: r.flattenedFields,
      pages: (await PDFDocument.load(r.bytes)).getPageCount(),
    };
  },
};

/**
 * pdf-lib's own field walk with NO repair in front of it: the stack the
 * depth limit is measured against (not one of the product's entry points).
 */
async function bareWalk(b: Uint8Array) {
  const doc = await PDFDocument.load(b);
  const names = doc
    .getForm()
    .getFields()
    .map((f) => f.getName());
  return { fields: names.length };
}

async function outcome(
  run: (b: Uint8Array) => Promise<object>,
  bytes: Uint8Array,
) {
  try {
    return { ok: true, ...(await run(bytes)) };
  } catch (err) {
    return {
      ok: false,
      typed: err instanceof PdfEngineError,
      name: (err as Error)?.name,
      message: (err as Error)?.message,
    };
  }
}

async function main() {
  if (!name || !entry) throw new Error("usage: <case> <entry|all>");
  const bytes = await build(name);
  if (entry === "all") {
    const all: Record<string, object> = {};
    for (const [key, run] of Object.entries(ENTRIES)) {
      all[key] = await outcome(run, bytes);
    }
    reportResult(all);
    return;
  }
  const run = entry === "bareWalk" ? bareWalk : ENTRIES[entry];
  if (!run) throw new Error(`unknown entry ${entry}`);
  reportResult(await outcome(run, bytes));
}
void main();
