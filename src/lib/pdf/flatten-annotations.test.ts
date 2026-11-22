// @native-canvas
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
  type PDFContext,
  type PDFRef,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  regionMean,
  renderPdfPages,
  type RenderedPage,
} from "@/tests/pdf-render";
import { applyFormValues } from "./forms";
import { flattenPdf, inspectForm } from "./flatten";

/**
 * Audit flatten-pdf#3 (2026-11-06, re-measured 2026-11-22): only AcroForm
 * fields were flattened, so a highlight, a stamp, ink or a typed comment
 * stayed an annotation anyone could move or delete. With "Also flatten
 * comments and markup" each visible non-Link annotation's appearance is drawn
 * into the page and the annotation removed. Read back from the SAVED file:
 * /Annots, and pdf.js renders of the annotated regions against the source.
 */

const PAGE = { width: 400, height: 500 };

/** A dark filled box as an appearance: what a reader paints for the mark. */
function darkAppearance(
  ctx: PDFContext,
  width: number,
  height: number,
  gray = 0.1,
  extra: Record<string, unknown> = {},
): PDFRef {
  return ctx.register(
    ctx.flateStream(`${gray} g 0 0 ${width} ${height} re f`, {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, width, height],
      ...extra,
    }),
  );
}

interface Spot {
  subtype: string;
  rect: [number, number, number, number];
}

/** Where each annotation sits (page space), shared by the fixture and checks. */
const SPOTS: Spot[] = [
  { subtype: "Highlight", rect: [40, 400, 160, 420] },
  { subtype: "Ink", rect: [200, 380, 300, 440] },
  { subtype: "Stamp", rect: [40, 280, 160, 330] },
  { subtype: "FreeText", rect: [200, 280, 340, 320] },
  { subtype: "Text", rect: [40, 200, 64, 224] },
];
const LINK_RECT: [number, number, number, number] = [200, 180, 300, 200];
const NO_AP_RECT: [number, number, number, number] = [40, 100, 160, 120];

async function annotatedPdf(
  options: { noAppearance?: boolean; hidden?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  // A field too, so fields and annotations flatten in one run.
  const form = doc.getForm();
  const name = form.createTextField("applicant.name");
  name.setText("Ada");
  name.addToPage(page, { x: 200, y: 100, width: 150, height: 24 });
  const ctx = doc.context;
  const refs: PDFRef[] = [];
  for (const { subtype, rect } of SPOTS) {
    const [x0, y0, x1, y1] = rect;
    const dict: Record<string, unknown> = {
      Type: "Annot",
      Subtype: subtype,
      Rect: rect,
      P: page.ref,
      AP: ctx.obj({ N: darkAppearance(ctx, x1 - x0, y1 - y0) }),
    };
    if (subtype === "Highlight")
      dict.QuadPoints = [x0, y1, x1, y1, x0, y0, x1, y0];
    if (subtype === "Ink") dict.InkList = [[x0, y0, x1, y1]];
    refs.push(ctx.register(ctx.obj(dict as never)));
  }
  // The sticky note's pop-up: no appearance of its own, belongs to the note.
  const note = refs[refs.length - 1]!;
  const popup = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Popup",
      Rect: [70, 200, 200, 260],
      P: page.ref,
      Parent: note,
    }),
  );
  (ctx.lookup(note) as PDFDict).set(PDFName.of("Popup"), popup);
  (ctx.lookup(note) as PDFDict).set(
    PDFName.of("Contents"),
    PDFString.of("Check this"),
  );
  refs.push(popup);
  refs.push(
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: LINK_RECT,
        P: page.ref,
        A: ctx.obj({ S: "URI", URI: PDFString.of("https://example.com/") }),
      }),
    ),
  );
  if (options.noAppearance) {
    refs.push(
      ctx.register(
        ctx.obj({
          Type: "Annot",
          Subtype: "Square",
          Rect: NO_AP_RECT,
          P: page.ref,
          C: [1, 0, 0],
        }),
      ),
    );
  }
  if (options.hidden) {
    refs.push(
      ctx.register(
        ctx.obj({
          Type: "Annot",
          Subtype: "Stamp",
          Rect: NO_AP_RECT,
          P: page.ref,
          F: 2, // Hidden
          AP: ctx.obj({ N: darkAppearance(ctx, 120, 20) }),
        }),
      ),
    );
  }
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (annots instanceof PDFArray) for (const r of refs) annots.push(r);
  else page.node.set(PDFName.of("Annots"), ctx.obj(refs));
  return doc.save();
}

async function subtypesOn(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return [];
  return annots
    .asArray()
    .map((ref) => doc.context.lookup(ref) as PDFDict)
    .map((d) => d.get(PDFName.of("Subtype"))!.toString().slice(1))
    .sort();
}

/** A page-space rect as normalized viewer coordinates for regionMean. */
const area = ([x0, y0, x1, y1]: [number, number, number, number]) =>
  [
    x0 / PAGE.width + 0.01,
    1 - y1 / PAGE.height + 0.01,
    x1 / PAGE.width - 0.01,
    1 - y0 / PAGE.height - 0.01,
  ] as const;

const darkness = (page: RenderedPage, rect: [number, number, number, number]) =>
  255 - Math.max(...regionMean(page, ...area(rect)));

describe("flatten comments and markup too (audit flatten-pdf#3)", () => {
  it("draws every visible non-Link annotation into the page; /Annots keeps only the Link", async () => {
    const source = await annotatedPdf();
    const result = await flattenPdf(source, { annotations: true });
    expect(await subtypesOn(result.bytes)).toEqual(["Link"]);
    expect(result.flattenedAnnotations).toBe(SPOTS.length);
    expect(result.annotationsLeft).toEqual([]);
    // The form field was flattened in the same run.
    expect(result.flattenedFields).toBe(1);

    const [before] = await renderPdfPages(source, 500);
    const [after] = await renderPdfPages(result.bytes, 500);
    for (const { subtype, rect } of SPOTS) {
      // Health: the source render shows the mark (pdf.js paints its /AP).
      expect(darkness(before!, rect), `${subtype} before`).toBeGreaterThan(150);
      // The flattened page shows the same, now as page content.
      expect(darkness(after!, rect), `${subtype} after`).toBeGreaterThan(150);
      expect(
        Math.abs(darkness(after!, rect) - darkness(before!, rect)),
        subtype,
      ).toBeLessThan(25);
    }
  });

  it("inspection counts the marks the option acts on: not the link, the pop-up or the field", async () => {
    expect((await inspectForm(await annotatedPdf())).annotations).toBe(
      SPOTS.length,
    );
  });

  it("leaves every annotation in place when the option is off (the default)", async () => {
    const source = await annotatedPdf();
    const result = await flattenPdf(source);
    expect(await subtypesOn(result.bytes)).toEqual(
      ["FreeText", "Highlight", "Ink", "Link", "Popup", "Stamp", "Text"].sort(),
    );
    expect(result.flattenedAnnotations).toBe(0);
    // Fields are flattened either way.
    expect(result.flattenedFields).toBe(1);
  });

  it("an annotation with nothing to draw is left and listed; a hidden one is left undrawn", async () => {
    const source = await annotatedPdf({ noAppearance: true, hidden: true });
    const result = await flattenPdf(source, { annotations: true });
    expect((await subtypesOn(result.bytes)).sort()).toEqual(
      ["Link", "Square", "Stamp"].sort(),
    );
    expect(result.annotationsLeft).toEqual([
      { name: "Square on page 1", reason: "it has no appearance to draw" },
      {
        name: "Stamp on page 1",
        reason: "hidden, so there is nothing to draw",
      },
    ]);
    // The hidden stamp's box stays empty on the page.
    const [after] = await renderPdfPages(result.bytes, 500);
    expect(darkness(after!, NO_AP_RECT)).toBeLessThan(10);
  });

  it("places an appearance whose box differs from the annotation's Rect as a reader does", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.width, PAGE.height]);
    const ctx = doc.context;
    // A 50 x 10 appearance on a 100 x 20 Rect: a reader scales it to fit.
    const stamp = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Stamp",
        Rect: [100, 100, 200, 120],
        P: page.ref,
        AP: ctx.obj({ N: darkAppearance(ctx, 50, 10) }),
      }),
    );
    page.node.set(PDFName.of("Annots"), ctx.obj([stamp]));
    const source = await doc.save();
    const out = await flattenPdf(source, { annotations: true });
    // The stamp is page content now, so the render below is the drawing's.
    expect(await subtypesOn(out.bytes)).toEqual([]);
    const [before] = await renderPdfPages(source, 500);
    const [after] = await renderPdfPages(out.bytes, 500);
    for (const rect of [
      [100, 100, 200, 120],
      [200, 100, 260, 120],
    ] as [number, number, number, number][]) {
      expect(
        Math.abs(darkness(after!, rect) - darkness(before!, rect)),
      ).toBeLessThan(25);
    }
  });

  it("chain: a Bengali answer drawn by Fill Forms survives Flatten PDF", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.width, PAGE.height]);
    doc.getForm().createTextField("name").addToPage(page, {
      x: 40,
      y: 400,
      width: 300,
      height: 30,
      borderWidth: 0,
    });
    const filled = await applyFormValues(await doc.save(), {
      name: "রবীন্দ্রনাথ",
    });
    const flat = await flattenPdf(filled.bytes, { annotations: true });
    expect(flat.flattenedFields).toBe(1);
    expect(flat.skipped).toEqual([]);
    const [after] = await renderPdfPages(flat.bytes, 500);
    expect(darkness(after!, [40, 400, 340, 430])).toBeGreaterThan(5);
    // Control: the empty area beside it stays white.
    expect(darkness(after!, [40, 300, 340, 330])).toBeLessThan(3);
  });
});
