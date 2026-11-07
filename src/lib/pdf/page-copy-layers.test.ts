// @native-canvas
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
} from "pdf-lib";
import {
  deletePages,
  extractPages,
  mergePdfs,
  organizePages,
  splitPdf,
} from "./engine";
import { loadPdfjs } from "./pdfjs";

/**
 * Layers (optional content) through the page assembler, read the way a
 * READER receives them: pdf.js's optional-content config of the output file.
 *
 * WHY THIS FILE EXISTS. Until 2026-11-06 (audit #1) `assemblePages` treated
 * the source catalog's `/OCProperties` like every other catalog entry —
 * foreign, never copied — and nothing rebuilt it. The kept pages still drew
 * their layers inside `/OC /MC0 BDC ... EMC` and still named the groups in
 * `/Resources /Properties`, but with no `/OCProperties` in the output a
 * viewer has no configuration to read, so it governs nothing and draws every
 * layer: a print-only watermark, an answer key or an alternate-language layer
 * that was OFF by default became visible after Merge, Extract, Delete, Split
 * or Organize. pdf.js reported the group hidden in the input and no groups at
 * all in the output.
 */

interface Layered {
  bytes: Uint8Array;
}

/**
 * A `pages`-page PDF. Page 1 (index 0) draws inside a HIDDEN layer and a
 * VISIBLE layer; the last page draws inside a layer only it uses. Every
 * layer is listed in `/OCProperties`, with `hidden` in `/D /OFF`.
 */
async function layeredPdf(
  names: { hidden: string; shown: string; lastOnly: string },
  pages = 3,
  baseStateOff = false,
): Promise<Layered> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const ocg = (name: string) =>
    ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of(name) }) as PDFDict);
  const hidden = ocg(names.hidden);
  const shown = ocg(names.shown);
  const lastOnly = ocg(names.lastOnly);
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  const drawLayers = (index: number, groups: Record<string, PDFRef>) => {
    const page = doc.getPage(index);
    const props = ctx.obj({}) as PDFDict;
    let ops = "";
    for (const [tag, ref] of Object.entries(groups)) {
      props.set(PDFName.of(tag), ref);
      ops += `/OC /${tag} BDC 0 0 1 rg 10 10 50 50 re f EMC\n`;
    }
    const resources = page.node.Resources() ?? (ctx.obj({}) as PDFDict);
    resources.set(PDFName.of("Properties"), props);
    page.node.set(PDFName.of("Resources"), resources);
    page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(ops)));
  };
  drawLayers(0, { MC0: hidden, MC1: shown });
  drawLayers(pages - 1, { MC2: lastOnly });
  const d = ctx.obj({
    Name: PDFString.of("Default"),
    Order: [hidden, shown, lastOnly],
  }) as PDFDict;
  if (baseStateOff) {
    d.set(PDFName.of("BaseState"), PDFName.of("OFF"));
    d.set(PDFName.of("ON"), ctx.obj([shown, lastOnly]));
  } else {
    d.set(PDFName.of("OFF"), ctx.obj([hidden]));
  }
  doc.catalog.set(
    PDFName.of("OCProperties"),
    ctx.register(ctx.obj({ OCGs: [hidden, shown, lastOnly], D: d })),
  );
  return { bytes: await doc.save() };
}

/** Each optional-content group pdf.js sees, by name, and whether it shows. */
async function layers(bytes: Uint8Array): Promise<Record<string, boolean>> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const config = await pdf.getOptionalContentConfig();
    const out: Record<string, boolean> = {};
    for (const [id, group] of config) {
      const name = (group as { name: string | null }).name ?? id;
      out[name] = config.isVisible({ type: "OCG", id } as never);
    }
    return out;
  } finally {
    await task.destroy();
  }
}

const NAMES = { hidden: "Answer key", shown: "Body", lastOnly: "Last page" };

describe("page tools keep a document's layers as the reader saw them", () => {
  it("POSITIVE CONTROL: pdf.js sees the input's hidden layer as hidden", async () => {
    const { bytes } = await layeredPdf(NAMES);
    expect(await layers(bytes)).toEqual({
      "Answer key": false,
      Body: true,
      "Last page": true,
    });
  });

  it("extract-pages keeps a hidden layer hidden and drops the layers of pages it left out", async () => {
    const { bytes } = await layeredPdf(NAMES);
    expect(await layers(await extractPages(bytes, [0]))).toEqual({
      "Answer key": false,
      Body: true,
    });
  });

  it("remove-pages keeps a hidden layer hidden", async () => {
    const { bytes } = await layeredPdf(NAMES);
    expect(await layers(await deletePages(bytes, [1]))).toEqual({
      "Answer key": false,
      Body: true,
      "Last page": true,
    });
  });

  it("split-pdf gives each part the layers of its own pages, hidden ones still hidden", async () => {
    const { bytes } = await layeredPdf(NAMES);
    const parts = await splitPdf(bytes, [
      { name: "a.pdf", indices: [0] },
      { name: "b.pdf", indices: [1] },
      { name: "c.pdf", indices: [2] },
    ]);
    expect(await layers(parts[0]!.bytes)).toEqual({
      "Answer key": false,
      Body: true,
    });
    expect(await layers(parts[1]!.bytes)).toEqual({});
    expect(await layers(parts[2]!.bytes)).toEqual({ "Last page": true });
  });

  it("organize-pages (reorder and duplicate) keeps a hidden layer hidden", async () => {
    const { bytes } = await layeredPdf(NAMES);
    const out = await organizePages(bytes, [
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 0, rotation: 90 },
    ]);
    expect(await layers(out)).toEqual({
      "Answer key": false,
      Body: true,
      "Last page": true,
    });
  });

  it("merge-pdf keeps every file's layers, each with its own default state", async () => {
    const a = await layeredPdf(NAMES);
    // The second file states its default the other way round: everything
    // OFF unless listed ON. The merged file must still show what each file
    // showed and hide what each file hid.
    const b = await layeredPdf(
      { hidden: "B hidden", shown: "B body", lastOnly: "B last" },
      2,
      true,
    );
    expect(await layers(b.bytes)).toEqual({
      "B hidden": false,
      "B body": true,
      "B last": true,
    });
    expect(await layers(await mergePdfs([a.bytes, b.bytes]))).toEqual({
      "Answer key": false,
      Body: true,
      "Last page": true,
      "B hidden": false,
      "B body": true,
      "B last": true,
    });
  });

  it("a print-only layer keeps its usage rule (/AS), filtered to kept groups", async () => {
    const doc = await PDFDocument.load((await layeredPdf(NAMES)).bytes);
    const props = doc.catalog.lookup(PDFName.of("OCProperties"), PDFDict);
    const [hidden, , lastOnly] = props
      .lookup(PDFName.of("OCGs"), PDFArray)
      .asArray();
    props
      .lookup(PDFName.of("D"), PDFDict)
      .set(
        PDFName.of("AS"),
        doc.context.obj([
          { Event: "Print", Category: ["Print"], OCGs: [hidden!, lastOnly!] },
        ]),
      );
    const out = await PDFDocument.load(
      await extractPages(await doc.save(), [0]),
    );
    const d = out.catalog
      .lookup(PDFName.of("OCProperties"), PDFDict)
      .lookup(PDFName.of("D"), PDFDict);
    const rule = d.lookup(PDFName.of("AS"), PDFArray).lookup(0, PDFDict);
    expect(rule.get(PDFName.of("Event"))).toBe(PDFName.of("Print"));
    const groups = rule.lookup(PDFName.of("OCGs"), PDFArray).asArray();
    expect(
      groups.map((ref) =>
        out.context
          .lookup(ref, PDFDict)
          .lookup(PDFName.of("Name"), PDFString)
          .decodeText(),
      ),
    ).toEqual(["Answer key"]);
  });

  it("the output's layer panel lists only kept groups, in the source's order", async () => {
    const { bytes } = await layeredPdf(NAMES);
    const out = await PDFDocument.load(await extractPages(bytes, [0]));
    const props = out.catalog.lookup(PDFName.of("OCProperties"), PDFDict);
    const order = props
      .lookup(PDFName.of("D"), PDFDict)
      .lookup(PDFName.of("Order"), PDFArray);
    const names = order
      .asArray()
      .map((ref) =>
        out.context
          .lookup(ref, PDFDict)
          .lookup(PDFName.of("Name"), PDFString)
          .decodeText(),
      );
    expect(names).toEqual(["Answer key", "Body"]);
  });
});
