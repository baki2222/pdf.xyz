// res2 child: the form-tree repair on the getForm() paths EDIT-02 did not
// cover (the upload probe, the editor's open and export, n-up, and the
// signature-request worker's inspect and place). One case, one entry point,
// one plain Node process: an unrepaired cycle recursed until the stack ran
// out, and an unrepaired diamond walked 2^levels times (a hang only a kill
// can stop).
//
// argv: <case> <entry>
//   case: kids-self, diamond:<levels>, kids-chain:<depth>
//   entry: one key of ENTRIES
// Reports { ok: true, ...summary } or { ok: false, typed, kind, name, message }.
import { PdfEngineError } from "../../lib/pdf/engine-errors";
import { rawPdf, streamBody, type RawObject } from "./editing.fixtures";
import { reportResult } from "./report";

const [name, entry] = process.argv.slice(2);

/**
 * Catalog 1 (AcroForm with /NeedAppearances true, so n-up redraws every
 * value), Pages 2, Page 3 (annots), content 4; fields from 5.
 */
function formPdf(fields: string, annots: string, objects: RawObject[]) {
  return rawPdf({
    trailer: "/Root 1 0 R",
    objects: [
      {
        num: 1,
        body: `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${fields}] /NeedAppearances true /DA (/Helv 0 Tf 0 g) >> >>`,
      },
      { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        num: 3,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << >> /Annots [${annots}] >>`,
      },
      { num: 4, body: streamBody("", "0 0 1 rg 20 20 80 80 re f") },
      ...objects,
    ],
  }).bytes;
}

const WIDGET = "/Type /Annot /Subtype /Widget /Rect [20 200 200 230] /P 3 0 R";

/** A parent field whose /Kids names itself, above one filled text widget. */
function kidsSelf() {
  return formPdf("5 0 R", "6 0 R", [
    { num: 5, body: "<< /T (top) /Kids [5 0 R 6 0 R] >>" },
    {
      num: 6,
      body: `<< /FT /Tx /T (kid) /V (hello) /Parent 5 0 R ${WIDGET} >>`,
    },
  ]);
}

/** Each level names the next TWICE: 2^levels visits for an unrepaired walk. */
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
    body: `<< /FT /Tx /T (leaf) /V (hello) /Parent ${leaf - 1} 0 R ${WIDGET} >>`,
  });
  return formPdf("5 0 R", `${leaf} 0 R`, objects);
}

/** A /Kids-only chain `depth` fields deep, ending in a text widget. */
function kidsChain(depth: number) {
  const objects: RawObject[] = [];
  for (let d = 0; d < depth - 1; d += 1) {
    const num = 5 + d;
    objects.push({ num, body: `<< /T (n) /Kids [${num + 1} 0 R] >>` });
  }
  const leaf = 5 + depth - 1;
  objects.push({ num: leaf, body: `<< /FT /Tx /T (leaf) ${WIDGET} >>` });
  return formPdf("5 0 R", `${leaf} 0 R`, objects);
}

function build(id: string): Uint8Array {
  if (id === "kids-self") return kidsSelf();
  const [kind, n] = id.split(":");
  if (kind === "diamond") return diamond(Number(n));
  if (kind === "kids-chain") return kidsChain(Number(n));
  throw new Error(`unknown case ${id}`);
}

const noJpeg = { decodeJpeg: null };

const ENTRIES: Record<string, (b: Uint8Array) => Promise<object>> = {
  probe: async (b) => {
    const { probePdf } = await import("../../lib/pdf/probe");
    const r = await probePdf(b, { maxBytes: Number.POSITIVE_INFINITY });
    return { read: r.read, formFields: r.formFields };
  },
  readEditorDocument: async (b) => {
    const { readEditorDocument } = await import("../../lib/pdf/editor-export");
    const r = await readEditorDocument(b);
    return { fields: r.fields.map((f) => f.name) };
  },
  exportEditedPdf: async (b) => {
    const { readEditorDocument, exportEditedPdf } =
      await import("../../lib/pdf/editor-export");
    const names = (await readEditorDocument(b)).fields.map((f) => f.name);
    const fills = Object.fromEntries(names.map((n) => [n, "x"]));
    const r = await exportEditedPdf(b, [], noJpeg, { fills });
    return { filled: r.filled, saved: r.bytes.length > 0 };
  },
  exportNewField: async (b) => {
    // A new field and no fills: the write path's own repair, not the fill's.
    const { exportEditedPdf } = await import("../../lib/pdf/editor-export");
    const r = await exportEditedPdf(
      b,
      [
        {
          id: "f1",
          kind: "field",
          fieldType: "text",
          name: "added",
          page: 0,
          x: 20,
          y: 20,
          width: 100,
          height: 20,
          options: [],
          value: "",
          checked: false,
          multiline: false,
        } as never,
      ],
      noJpeg,
    );
    return { filled: r.filled, saved: r.bytes.length > 0 };
  },
  nup: async (b) => {
    const { nUpPdf, DEFAULT_N_UP_OPTIONS } = await import("../../lib/pdf/n-up");
    const r = await nUpPdf(b, { ...DEFAULT_N_UP_OPTIONS, perSheet: 2 });
    return { sheets: r.sheets, undrawn: r.undrawnFields };
  },
  signatureInspect: async (b) => {
    const { signatureRequestDeps } =
      await import("../../lib/workers/request-signatures/native");
    const r = await signatureRequestDeps().inspect!(b);
    return { pages: r.pageCount, fields: r.fieldNames };
  },
  signaturePlace: async (b) => {
    const { signatureRequestDeps } =
      await import("../../lib/workers/request-signatures/native");
    const out = await signatureRequestDeps().place!(b, [
      { name: "sign_here", page: 1, x: 20, y: 20, width: 100, height: 20 },
    ]);
    return { saved: out.length > 0 };
  },
};

async function main() {
  if (!name || !entry) throw new Error("usage: <case> <entry>");
  const run = ENTRIES[entry];
  if (!run) throw new Error(`unknown entry ${entry}`);
  const bytes = build(name);
  try {
    reportResult({ ok: true, ...(await run(bytes)) });
  } catch (err) {
    reportResult({
      ok: false,
      typed: err instanceof PdfEngineError,
      kind: (err as PdfEngineError)?.kind ?? null,
      name: (err as Error)?.name,
      message: (err as Error)?.message,
    });
  }
}
void main();
