// @native-canvas
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  type PDFContext,
  type PDFRef,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { ANNOTATION_GROUPS } from "./annotation-groups";
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

/**
 * Review finding 1 (2026-11-28): with the box ticked, an UNAPPLIED Redact
 * mark was drawn as its black box and the annotation deleted, while the text
 * under it stayed in the file: a redaction that looks done and is not, and
 * can no longer be applied in Acrobat. Kinds that carry data or are not a
 * drawing (a pending redaction, an attached file or sound, media, a 3D model)
 * are now kept and listed with a reason. The kept set is checked against
 * Remove Annotations' own groups, so a kind added there is asked about here.
 */
const KEPT_GROUPS = ["redaction-marks", "attachments"] as const;
const KEPT_MEDIA = ["Movie", "Screen", "RichMedia", "3D"];

describe("kinds that carry data are kept, not drawn (review finding 1)", () => {
  const kept = [
    ...ANNOTATION_GROUPS.filter((g) =>
      (KEPT_GROUPS as readonly string[]).includes(g.id),
    ).flatMap((g) => g.subtypes),
    ...KEPT_MEDIA,
  ];

  it("health: the kept set is the redaction and attachment groups plus media", () => {
    expect(kept).toContain("Redact");
    expect(kept).toContain("FileAttachment");
    expect(kept.length).toBeGreaterThanOrEqual(7);
    // The media kinds are all in Remove Annotations' table.
    const other = ANNOTATION_GROUPS.find((g) => g.id === "other")!.subtypes;
    for (const kind of KEPT_MEDIA) expect(other).toContain(kind);
  });

  it("a pending redaction over text is kept and listed; the text is not hidden under a baked box", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.width, PAGE.height]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("SSN 123-45-6789", { x: 50, y: 400, size: 14, font });
    const ctx = doc.context;
    const redact = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Redact",
        Rect: [45, 395, 200, 418],
        P: page.ref,
        AP: ctx.obj({ N: darkAppearance(ctx, 155, 23, 0) }),
      }),
    );
    page.node.set(PDFName.of("Annots"), ctx.obj([redact]));
    const source = await doc.save();
    expect((await inspectForm(source)).annotations).toBe(0);

    const out = await flattenPdf(source, { annotations: true });
    expect(await subtypesOn(out.bytes)).toEqual(["Redact"]);
    expect(out.flattenedAnnotations).toBe(0);
    expect(out.annotationsLeft).toHaveLength(1);
    expect(out.annotationsLeft[0]!.name).toBe("Redact on page 1");
    expect(out.annotationsLeft[0]!.reason).toMatch(/Redact PDF/);
    // Nothing was drawn into the page content where the mark sits.
    const flat = await PDFDocument.load(out.bytes);
    flat.getPage(0).node.delete(PDFName.of("Annots"));
    // Real Helvetica (standard font data) ends the text near x=162; the
    // probe is the part of the mark's box past it. CHANGED 2026-11-28: the
    // probe began at x=150 and rendered with no font data, so Linux CI's
    // wider fallback face ran into it (17.9 against < 10) while Windows'
    // narrower one did not. A baked box still fills the probe either way.
    const probe: [number, number, number, number] = [170, 396, 199, 417];
    const [bare] = await renderPdfPages(await flat.save(), 500, {
      standardFonts: true,
    });
    expect(darkness(bare!, probe)).toBeLessThan(10);
    // Positive control: where the mark's look IS painted (the output, with
    // its live mark), the same probe reads dark, so the probe can see a box.
    const [shown] = await renderPdfPages(out.bytes, 500, {
      standardFonts: true,
    });
    expect(darkness(shown!, probe)).toBeGreaterThan(100);
  });

  it("every kept kind stays live and listed, while a Square beside it is drawn (the control)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.width, PAGE.height]);
    const ctx = doc.context;
    const refs = [...kept, "Square"].map((subtype, i) =>
      ctx.register(
        ctx.obj({
          Type: "Annot",
          Subtype: subtype,
          Rect: [20, 20 + i * 40, 60, 50 + i * 40],
          P: page.ref,
          AP: ctx.obj({ N: darkAppearance(ctx, 40, 30) }),
        }),
      ),
    );
    page.node.set(PDFName.of("Annots"), ctx.obj(refs));
    const out = await flattenPdf(await doc.save(), { annotations: true });
    expect(await subtypesOn(out.bytes)).toEqual([...kept].sort());
    expect(out.flattenedAnnotations).toBe(1);
    expect(out.annotationsLeft.map((l) => l.name)).toEqual(
      kept.map((k) => `${k} on page 1`),
    );
    for (const l of out.annotationsLeft)
      expect(l.reason.length).toBeGreaterThan(10);
  });
});

/**
 * Review findings 4 and 6 (2026-11-28): an annotation's own /CA applies to
 * everything it shows (ISO 32000 12.5.2), and many highlighters keep the
 * appearance opaque and put the see-through effect only there. Drawn at full
 * strength, a 30% highlight became a solid yellow block over the text. pdf.js
 * ignores /CA on the SOURCE, so "render matches the source" could not see it;
 * this reads the flattened page, where /CA must now be page content (an
 * ExtGState around a transparency group), against the black bar beneath.
 */
describe("a see-through highlight stays see-through (review findings 4 and 6)", () => {
  async function highlightOverBar(ca?: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.width, PAGE.height]);
    page.drawRectangle({ x: 40, y: 400, width: 120, height: 20 });
    const ctx = doc.context;
    const yellow = ctx.register(
      ctx.flateStream("1 1 0 rg 0 0 120 20 re f", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 120, 20],
      }),
    );
    const dict: Record<string, unknown> = {
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [40, 400, 160, 420],
      QuadPoints: [40, 420, 160, 420, 40, 400, 160, 400],
      P: page.ref,
      AP: ctx.obj({ N: yellow }),
    };
    if (ca !== undefined) dict.CA = ca;
    page.node.set(
      PDFName.of("Annots"),
      ctx.obj([ctx.register(ctx.obj(dict as never))]),
    );
    return doc.save();
  }

  it("with /CA 0.3 the bar under it still shows dark on the flattened page", async () => {
    const out = await flattenPdf(await highlightOverBar(0.3), {
      annotations: true,
    });
    expect(await subtypesOn(out.bytes)).toEqual([]);
    const [after] = await renderPdfPages(out.bytes, 500);
    const [r, g, b] = regionMean(after!, ...area([40, 400, 160, 420]));
    // 30% yellow over black is about (77, 77, 0); opaque would be (255, 255, 0).
    expect(Math.max(r, g), `${r},${g},${b}`).toBeLessThan(140);
    expect(Math.max(r, g)).toBeGreaterThan(40);
  });

  it("control: without /CA the highlight is drawn opaque, as its appearance says", async () => {
    const out = await flattenPdf(await highlightOverBar(), {
      annotations: true,
    });
    const [after] = await renderPdfPages(out.bytes, 500);
    const [r, g] = regionMean(after!, ...area([40, 400, 160, 420]));
    expect(Math.min(r, g)).toBeGreaterThan(220);
  });
});

describe("the annotation's opacity applies to its whole look, not only until the look sets its own", () => {
  it("an appearance that sets its own full-opacity gs still comes out see-through", async () => {
    // Without painting the look as a transparency group, the stream's own
    // `/G0 gs` (ca 1) replaces the outer /CA and the box is opaque again.
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.width, PAGE.height]);
    page.drawRectangle({ x: 40, y: 400, width: 120, height: 20 });
    const ctx = doc.context;
    const look = ctx.register(
      ctx.flateStream("/G0 gs 1 1 0 rg 0 0 120 20 re f", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 120, 20],
        Resources: ctx.obj({
          ExtGState: ctx.obj({ G0: ctx.obj({ Type: "ExtGState", ca: 1 }) }),
        }),
      }),
    );
    const annot = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Square",
        Rect: [40, 400, 160, 420],
        P: page.ref,
        CA: 0.3,
        AP: ctx.obj({ N: look }),
      }),
    );
    page.node.set(PDFName.of("Annots"), ctx.obj([annot]));
    const out = await flattenPdf(await doc.save(), { annotations: true });
    expect(out.flattenedAnnotations).toBe(1);
    const [after] = await renderPdfPages(out.bytes, 500);
    const [r, g, b] = regionMean(after!, ...area([40, 400, 160, 420]));
    expect(Math.max(r, g), `${r},${g},${b}`).toBeLessThan(140);
  });
});
