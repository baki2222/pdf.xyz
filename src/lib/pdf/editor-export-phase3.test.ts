// @native-canvas
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { awaitPdfjsDocument } from "./pdfjs";
import {
  exportEditedPdf,
  readEditorDocument,
  readExportFrames,
} from "./editor-export";
import { commit, EMPTY_HISTORY, stackChanges, undo } from "./editor/history";
import {
  DEFAULT_TEXT_STYLE,
  type EditorObject,
  type FieldObject,
  type LinkObject,
  type Rect,
  type ShapeObject,
} from "./editor/model";
import {
  deletePage,
  displayFrames,
  insertBlankAfter,
  movePage,
  rotatePage,
  sourcePages,
  turnRect,
  type PageRef,
} from "./editor/pages";
import { parseLinkInput } from "./editor/links";
import {
  formatDate,
  initialsOf,
  markObject,
  quickTextObject,
} from "./editor/quick-fields";
import { createStandardMeasure } from "./editor/text";

/**
 * Phase 3 of the editor, read back from the exported bytes by pdf.js — the
 * engine a reader's viewer runs — never by our own mapping: links as
 * `/Link` annotations (box and target), quick fields at their place, the
 * page list (order, rotation, blank and deleted pages, objects following
 * their page), z-order as drawing order, and AcroForm fields with their
 * names, types, options and values.
 *
 * Rects are compared in the editor's own frame: viewer points, top-left
 * origin, y down — pdf.js's `convertToViewportRectangle` at scale 1.
 */

const TOL = 1;

const nodeAssets = () => {
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"))
    .split("\\")
    .join("/");
  return { wasmUrl: `${dir}/wasm/`, cMapUrl: `${dir}/cmaps/` };
};

interface ReadAnnot {
  subtype: string;
  /** Viewer frame, top-left origin. */
  rect: Rect;
  url?: string;
  /** 0-based page a GoTo lands on. */
  destPage?: number;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: unknown;
  options?: { exportValue: string; displayValue: string }[];
  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: string;
}

interface ReadPage {
  width: number;
  height: number;
  rotate: number;
  annots: ReadAnnot[];
}

async function readPages(bytes: Uint8Array): Promise<ReadPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...nodeAssets(),
    data: bytes.slice(),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  try {
    const doc = await awaitPdfjsDocument(task);
    const out: ReadPage[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const annots: ReadAnnot[] = [];
      for (const a of (await page.getAnnotations()) as Record<
        string,
        unknown
      >[]) {
        const r = a.rect as number[];
        const m = vp.transform as number[];
        const to = (x: number, y: number) => [
          m[0]! * x + m[2]! * y + m[4]!,
          m[1]! * x + m[3]! * y + m[5]!,
        ];
        const [x0, y0] = to(r[0]!, r[1]!);
        const [x1, y1] = to(r[2]!, r[3]!);
        let destPage: number | undefined;
        if (Array.isArray(a.dest) && a.dest[0]) {
          destPage = await doc.getPageIndex(a.dest[0]);
        }
        annots.push({
          subtype: a.subtype as string,
          rect: {
            x: Math.min(x0!, x1!),
            y: Math.min(y0!, y1!),
            width: Math.abs(x1! - x0!),
            height: Math.abs(y1! - y0!),
          },
          url: a.url as string | undefined,
          destPage,
          fieldName: a.fieldName as string | undefined,
          fieldType: a.fieldType as string | undefined,
          fieldValue: a.fieldValue,
          options: a.options as ReadAnnot["options"],
          checkBox: a.checkBox as boolean | undefined,
          radioButton: a.radioButton as boolean | undefined,
          buttonValue: a.buttonValue as string | undefined,
        });
      }
      out.push({
        width: vp.width,
        height: vp.height,
        rotate: page.rotate,
        annots,
      });
    }
    return out;
  } finally {
    await task.destroy();
  }
}

function expectRect(got: Rect, want: Rect) {
  expect(Math.abs(got.x - want.x)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(got.y - want.y)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(got.width - want.width)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(got.height - want.height)).toBeLessThanOrEqual(TOL);
}

/** Pages labelled ONE, TWO, … ; `rotate[i]` gives page i a /Rotate. */
async function labelled(
  count: number,
  rotate: number[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const names = ["ONE", "TWO", "THREE", "FOUR", "FIVE"];
  for (let i = 0; i < count; i += 1) {
    const p = doc.addPage([612, 792]);
    p.drawText(`PAGE ${names[i]}`, { x: 72, y: 720, size: 14, font });
    if (rotate[i]) p.setRotation(degrees(rotate[i]!));
  }
  return doc.save();
}

/** Every page's text, by pdf.js. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const read = await readPages(bytes);
  const out: string[] = [];
  for (let i = 1; i <= read.length; i += 1) {
    out.push((await readAsViewer(bytes, i)).texts.map((t) => t.str).join(" "));
  }
  return out;
}

const style = { ...DEFAULT_TEXT_STYLE, size: 12 };

function textBox(id: string, page: number, x: number, y: number, text: string) {
  return {
    id,
    kind: "text" as const,
    page,
    x,
    y,
    width: 200,
    text,
    ...style,
  };
}

/* --------------------------------- links --------------------------------- */

describe("links are real /Link annotations, where they were drawn", () => {
  it("a web link on a plain page and a go-to-page link on a /Rotate 90 page", async () => {
    const bytes = await labelled(2, [0, 90]);
    const web: LinkObject = {
      id: "a",
      kind: "link",
      page: 0,
      x: 100,
      y: 120,
      width: 160,
      height: 24,
      target: { type: "uri", uri: "https://example.com/terms" },
    };
    // Page 2 shows 792 × 612 (turned); the link is in that frame.
    const toPage: LinkObject = {
      id: "b",
      kind: "link",
      page: 1,
      x: 500,
      y: 60,
      width: 120,
      height: 40,
      target: { type: "page", pageId: "s0" },
    };
    const mail: LinkObject = {
      id: "c",
      kind: "link",
      page: 0,
      x: 100,
      y: 300,
      width: 80,
      height: 16,
      target: { type: "uri", uri: "mailto:hi@example.com" },
    };
    const out = await exportEditedPdf(bytes, [web, toPage, mail]);
    const pages = await readPages(out.bytes);
    expect(pages[1]!.rotate).toBe(90);
    expect(pages[1]!.width).toBeCloseTo(792, 3);
    const links0 = pages[0]!.annots.filter((a) => a.subtype === "Link");
    expect(links0).toHaveLength(2);
    const w = links0.find((a) => a.url?.includes("example.com/terms"))!;
    expect(w.url).toBe("https://example.com/terms");
    expectRect(w.rect, web);
    const m = links0.find((a) => a.url?.startsWith("mailto:"))!;
    expect(m.url).toBe("mailto:hi@example.com");
    expectRect(m.rect, mail);
    const links1 = pages[1]!.annots.filter((a) => a.subtype === "Link");
    expect(links1).toHaveLength(1);
    expect(links1[0]!.destPage).toBe(0);
    expectRect(links1[0]!.rect, toPage);
    // Not drawn: nothing of a link is painted on the page.
    expect((await readAsViewer(out.bytes, 1)).paths).toHaveLength(0);
  });

  it("control: a link drawn 20 pt off fails the same reading", async () => {
    const bytes = await labelled(1);
    const link: LinkObject = {
      id: "a",
      kind: "link",
      page: 0,
      x: 100,
      y: 120,
      width: 160,
      height: 24,
      target: { type: "uri", uri: "https://example.com/" },
    };
    const out = await exportEditedPdf(bytes, [{ ...link, x: 120 }]);
    const got = (await readPages(out.bytes))[0]!.annots[0]!.rect;
    expect(Math.abs(got.x - link.x)).toBeGreaterThan(TOL);
  });

  it("a link to a page follows that page when pages are reordered", async () => {
    const bytes = await labelled(3);
    // Page 3 (s2) moves to the front; a link on page 1 aims at it.
    const pages = movePage(sourcePages(3), 2, 0, [])!.pages;
    const link: LinkObject = {
      id: "a",
      kind: "link",
      page: 1, // old page 1 is now page 2
      x: 72,
      y: 72,
      width: 100,
      height: 20,
      target: { type: "page", pageId: "s2" },
    };
    const out = await exportEditedPdf(bytes, [link], undefined, { pages });
    const read = await readPages(out.bytes);
    expect(read[1]!.annots[0]!.destPage).toBe(0);
    expect((await pageTexts(out.bytes))[0]).toContain("PAGE THREE");
  });

  it("refuses a link to a page that was deleted", async () => {
    const bytes = await labelled(2);
    const pages = deletePage(sourcePages(2), 1, [])!.pages;
    const link: LinkObject = {
      id: "a",
      kind: "link",
      page: 0,
      x: 72,
      y: 72,
      width: 100,
      height: 20,
      target: { type: "page", pageId: "s1" },
    };
    await expect(
      exportEditedPdf(bytes, [link], undefined, { pages }),
    ).rejects.toThrow(/goes to a page you deleted/);
  });
});

describe("the file's own links are read, edited and deleted", () => {
  async function withLinks(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const one = doc.addPage([612, 792]);
    const two = doc.addPage([612, 792]);
    two.setRotation(degrees(90));
    const uri = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [100, 600, 250, 620],
        Border: [0, 0, 2],
        H: "P",
        A: { S: "URI", URI: PDFString.of("https://old.example.org/") },
      }),
    );
    const goTo = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [100, 500, 200, 520],
        Dest: [two.ref, "Fit"],
      }),
    );
    const onRotated = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [300, 100, 340, 300],
        A: { S: "URI", URI: PDFString.of("https://rotated.example.org/") },
      }),
    );
    one.node.set(PDFName.of("Annots"), doc.context.obj([uri, goTo]));
    two.node.set(PDFName.of("Annots"), doc.context.obj([onRotated]));
    return doc.save();
  }

  it("reads each link's box (as pdf.js places it) and its target", async () => {
    const bytes = await withLinks();
    const { links } = await readEditorDocument(bytes);
    const read = await readPages(bytes);
    expect(links).toHaveLength(3);
    const uri = links.find(
      (l) => l.target.type === "uri" && l.target.uri.includes("old"),
    )!;
    expectRect(uri, read[0]!.annots.find((a) => a.url)!.rect);
    const goTo = links.find((l) => l.target.type === "page")!;
    expect(goTo.target).toEqual({ type: "page", pageId: "s1" });
    const rotated = links.find((l) => l.page === 1)!;
    expectRect(rotated, read[1]!.annots[0]!.rect);
  });

  it("an edited link keeps its other entries; a deleted one is gone; an untouched one is left alone", async () => {
    const bytes = await withLinks();
    const { links } = await readEditorDocument(bytes);
    const uri = links.find(
      (l) => l.target.type === "uri" && l.target.uri.includes("old"),
    )!;
    const goTo = links.find((l) => l.target.type === "page")!;
    const rotated = links.find((l) => l.page === 1)!;
    const edited: LinkObject = {
      ...uri,
      x: uri.x + 30,
      target: { type: "uri", uri: "https://new.example.org/" },
    };
    const out = await exportEditedPdf(bytes, [edited, rotated], undefined, {
      removedLinks: [goTo.origin!.ref],
    });
    const read = await readPages(out.bytes);
    const p0 = read[0]!.annots.filter((a) => a.subtype === "Link");
    expect(p0).toHaveLength(1);
    expect(p0[0]!.url).toBe("https://new.example.org/");
    expectRect(p0[0]!.rect, edited);
    expect(read[1]!.annots[0]!.url).toBe("https://rotated.example.org/");
    // The edited annotation is the SAME object, its border kept.
    const doc = await PDFDocument.load(out.bytes);
    const annots = doc.getPages()[0]!.node.Annots()!;
    expect(annots.size()).toBe(1);
    const dict = doc.context.lookup(annots.get(0)) as unknown as {
      lookup(n: PDFName): unknown;
    };
    expect(String(dict.lookup(PDFName.of("Border")))).toBe("[ 0 0 2 ]");
    expect(String(dict.lookup(PDFName.of("H")))).toBe("/P");
  });
});

describe("what a person may type as a link", () => {
  it("accepts web, email and phone; adds the scheme a bare one needs", () => {
    expect(parseLinkInput("https://a.example.com/x?y=1")).toEqual({
      ok: true,
      uri: "https://a.example.com/x?y=1",
    });
    expect(parseLinkInput("example.com")).toEqual({
      ok: true,
      uri: "https://example.com/",
    });
    expect(parseLinkInput("hi@example.com")).toEqual({
      ok: true,
      uri: "mailto:hi@example.com",
    });
    expect(parseLinkInput("mailto:hi@example.com")).toEqual({
      ok: true,
      uri: "mailto:hi@example.com",
    });
    expect(parseLinkInput("+1 (555) 010-0199")).toEqual({
      ok: true,
      uri: "tel:+15550100199",
    });
    expect(parseLinkInput("tel:+44 20 7946 0000")).toEqual({
      ok: true,
      uri: "tel:+442079460000",
    });
  });

  it("refuses other schemes and things that are not addresses", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hi",
      "ftp://example.com",
      "",
      "not an address",
      "mailto:nobody",
    ]) {
      expect(parseLinkInput(bad).ok, bad).toBe(false);
    }
  });
});

/* ------------------------------ quick fields ------------------------------ */

describe("quick fields: date, initials, name and a check mark", () => {
  it("formats today and makes initials", () => {
    const d = new Date(2026, 9, 4);
    expect(formatDate(d, "dmy")).toBe("04/10/2026");
    expect(formatDate(d, "mdy")).toBe("10/04/2026");
    expect(formatDate(d, "iso")).toBe("2026-10-04");
    expect(formatDate(d, "long")).toBe("October 4, 2026");
    expect(formatDate(d, "dmonthy")).toBe("4 Oct 2026");
    expect(initialsOf("Baki Billah")).toBe("BB");
    expect(initialsOf("  jean-luc picard ")).toBe("JLP");
  });

  it("the date and initials land as text where they were placed, the mark as strokes", async () => {
    const bytes = await labelled(1, [90]);
    const frame = (await readExportFrames(bytes))[0]!;
    const measure = (await createStandardMeasure())("sans");
    const size = { width: frame.width, height: frame.height };
    const date = quickTextObject(
      "d",
      0,
      { x: 300, y: 200 },
      formatDate(new Date(2026, 9, 24), "iso"),
      style,
      (t) => measure(t, style.size),
      size,
    );
    const ini = quickTextObject(
      "i",
      0,
      { x: 500, y: 400 },
      initialsOf("Baki Billah"),
      style,
      (t) => measure(t, style.size),
      size,
    );
    const mark = markObject(
      "m",
      0,
      { x: 200, y: 300 },
      "check",
      "#000000",
      size,
    );
    const out = await exportEditedPdf(bytes, [date, ini, mark]);
    const read = await readAsViewer(out.bytes);
    const at = (s: string) => read.texts.find((t) => t.str === s)!;
    for (const [obj, s] of [
      [date, "2026-10-24"],
      [ini, "BB"],
    ] as const) {
      const t = at(s);
      expect(t, s).toBeDefined();
      expect(t.upright).toBe(true);
      expect(Math.abs(t.x - obj.x)).toBeLessThanOrEqual(TOL);
      // Baseline: viewer-frame y-up → top-left y-down.
      const baselineDown = read.height - t.y;
      expect(baselineDown).toBeGreaterThan(obj.y);
      expect(baselineDown).toBeLessThan(obj.y + style.size * style.lineHeight);
    }
    // The mark's strokes sit inside its box.
    const [x0, y0, x1, y1] = read.paths[0]!;
    expect(x0).toBeGreaterThanOrEqual(mark.x - TOL);
    expect(x1).toBeLessThanOrEqual(mark.x + mark.width + TOL);
    expect(read.height - y1).toBeGreaterThanOrEqual(mark.y - TOL);
    expect(read.height - y0).toBeLessThanOrEqual(mark.y + mark.height + TOL);
  });
});

/* --------------------------------- pages --------------------------------- */

describe("page operations are replayed on the file, objects with their page", () => {
  it("move, insert blank, delete and rotate: order, count, rotation and objects", async () => {
    const bytes = await labelled(4);
    const frames0 = await readExportFrames(bytes);
    let pages: PageRef[] = sourcePages(4);
    let objects: EditorObject[] = [
      textBox("t0", 0, 72, 100, "ON-ONE"),
      textBox("t1", 1, 72, 100, "ON-TWO"),
      textBox("t2", 2, 72, 100, "ON-THREE"),
      textBox("t3", 3, 72, 100, "ON-FOUR"),
    ];
    const th = () => style.size * style.lineHeight;
    const run = (op: ReturnType<typeof movePage>) => {
      const done = commit(objects, EMPTY_HISTORY, {
        label: op!.label,
        changes: op!.changes,
      });
      objects = done.objects;
      pages = op!.pages;
    };
    // 4 → first: FOUR ONE TWO THREE
    run(movePage(pages, 3, 0, objects));
    // delete TWO (now index 2): FOUR ONE THREE
    run(deletePage(pages, 2, objects));
    // blank after ONE: FOUR ONE [blank] THREE
    run(
      insertBlankAfter(pages, 1, objects, displayFrames(pages, frames0), "b1"),
    );
    // rotate THREE (index 3)
    const before = objects.find((o) => o.id === "t2")!;
    run(rotatePage(pages, 3, objects, displayFrames(pages, frames0), th));
    const turned = objects.find((o) => o.id === "t2")!;
    expect(turned.page).toBe(3);
    expect(objects.some((o) => o.id === "t1")).toBe(false);
    // A box on the blank page.
    objects = [...objects, textBox("tb", 2, 50, 50, "ON-BLANK")];

    const out = await exportEditedPdf(bytes, objects, undefined, { pages });
    expect(out.pageCount).toBe(4);
    const texts = await pageTexts(out.bytes);
    expect(texts[0]).toMatch(/PAGE FOUR.*ON-FOUR|ON-FOUR.*PAGE FOUR/);
    expect(texts[1]).toContain("PAGE ONE");
    expect(texts[1]).toContain("ON-ONE");
    expect(texts[2]).toBe("ON-BLANK");
    expect(texts[3]).toContain("PAGE THREE");
    expect(texts[3]).toContain("ON-THREE");
    expect(texts.join(" ")).not.toContain("TWO");
    const read = await readPages(out.bytes);
    expect(read.map((p) => p.rotate)).toEqual([0, 0, 0, 90]);
    expect(read[2]!.width).toBeCloseTo(612, 3);
    // The text on the turned page: upright, where the editor showed it.
    const v = await readAsViewer(out.bytes, 4);
    const t = v.texts.find((x) => x.str === "ON-THREE")!;
    expect(t.upright).toBe(true);
    expect(Math.abs(t.x - (turned as { x: number }).x)).toBeLessThanOrEqual(
      TOL,
    );
    expect((before as { x: number }).x).not.toBeCloseTo(
      (turned as { x: number }).x,
      0,
    );
    // The page's own words turned with it: no longer upright.
    expect(v.texts.find((x) => x.str === "PAGE THREE")!.upright).toBe(false);
  });

  it("a deleted page's content is not left in the file", async () => {
    const bytes = await labelled(2);
    const pages = deletePage(sourcePages(2), 0, [])!.pages;
    const out = await exportEditedPdf(bytes, [], undefined, { pages });
    expect(out.pageCount).toBe(1);
    expect(await pageTexts(out.bytes)).toEqual(["PAGE TWO"]);
    // The deleted page's own objects (its node and content stream) are not
    // in the saved file; the kept page's are.
    const src = await PDFDocument.load(bytes);
    const [gone, kept] = src.getPages();
    // Contents is an array of stream refs; take the first.
    const contents = (p: typeof gone) =>
      (
        p!.node.get(PDFName.of("Contents")) as unknown as {
          get(i: number): Parameters<typeof src.context.lookup>[0];
        }
      ).get(0);
    const saved = await PDFDocument.load(out.bytes);
    expect(contents(gone)).toBeDefined();
    expect(saved.context.lookup(gone!.ref)).toBeUndefined();
    expect(saved.context.lookup(contents(gone))).toBeUndefined();
    expect(saved.context.lookup(contents(kept))).toBeDefined();
  });

  it("a rotated page's box-shaped objects turn exactly with it", async () => {
    const bytes = await labelled(1);
    const frames0 = await readExportFrames(bytes);
    const rect: ShapeObject = {
      id: "r",
      kind: "shape",
      shape: "rect",
      page: 0,
      x: 100,
      y: 150,
      width: 80,
      height: 30,
      stroke: null,
      strokeWidth: 1,
      fill: "#ff0000",
      opacity: 1,
    };
    const op = rotatePage(sourcePages(1), 0, [rect], frames0, () => 0)!;
    const turned = commit([rect], EMPTY_HISTORY, {
      label: op.label,
      changes: op.changes,
    }).objects[0] as ShapeObject;
    expect(turned).toMatchObject(turnRect(rect, 792));
    const out = await exportEditedPdf(bytes, [turned], undefined, {
      pages: op.pages,
    });
    const v = await readAsViewer(out.bytes);
    const [x0, y0, x1, y1] = v.paths[0]!;
    expectRect(
      { x: x0, y: v.height - y1, width: x1 - x0, height: y1 - y0 },
      turned,
    );
    // And in the page's ORIGINAL frame it is where it was first drawn: the
    // object marked the same content.
    expect(v.width).toBeCloseTo(792, 3);
  });

  it("an operation and its undo are one step for pages and objects", () => {
    const pages = sourcePages(3);
    const objects: EditorObject[] = [
      textBox("a", 0, 0, 0, "A"),
      textBox("b", 1, 0, 0, "B"),
      textBox("c", 2, 0, 0, "C"),
    ];
    const op = deletePage(pages, 1, objects)!;
    const command = {
      label: op.label,
      changes: op.changes,
      pages: { before: pages, after: op.pages },
    };
    const done = commit(objects, EMPTY_HISTORY, command);
    expect(done.objects.map((o) => [o.id, o.page])).toEqual([
      ["a", 0],
      ["c", 1],
    ]);
    const back = undo(done.objects, done.history);
    expect(back.objects).toEqual(objects);
    expect(back.command?.pages?.before).toEqual(pages);
    // A page op with no objects is still a step.
    const empty = commit([], EMPTY_HISTORY, { ...command, changes: [] });
    expect(empty.history.past).toHaveLength(1);
  });
});

/* --------------------------------- z-order --------------------------------- */

describe("z-order is drawing order", () => {
  const red: ShapeObject = {
    id: "red",
    kind: "shape",
    shape: "rect",
    page: 0,
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    stroke: null,
    strokeWidth: 1,
    fill: "#ff0000",
    opacity: 1,
  };
  const blue: ShapeObject = {
    ...red,
    id: "blue",
    x: 150,
    width: 60,
    fill: "#0000ff",
  };
  const green: ShapeObject = { ...red, id: "green", page: 1, fill: "#00ff00" };

  it("bring to front, send backward — and undo puts the stack back", async () => {
    const list: EditorObject[] = [red, blue, green];
    const front = commit(list, EMPTY_HISTORY, {
      label: "Bring to front",
      changes: stackChanges(list, ["red"], "front"),
    });
    expect(front.objects.map((o) => o.id)).toEqual(["blue", "red", "green"]);
    const back = undo(front.objects, front.history);
    expect(back.objects.map((o) => o.id)).toEqual(["red", "blue", "green"]);
    const backward = stackChanges(front.objects, ["red"], "backward");
    expect(
      commit(front.objects, EMPTY_HISTORY, {
        label: "x",
        changes: backward,
      }).objects.map((o) => o.id),
    ).toEqual(["red", "blue", "green"]);
    // Nothing to move past on its page: no change.
    expect(stackChanges(list, ["green"], "forward")).toEqual([]);

    const bytes = await labelled(2);
    const widthOrder = async (objs: EditorObject[]) =>
      (
        await readAsViewer((await exportEditedPdf(bytes, objs)).bytes)
      ).paths.map((p) => Math.round(p[2] - p[0]));
    expect(await widthOrder(list)).toEqual([100, 60]);
    expect(await widthOrder(front.objects)).toEqual([60, 100]);
  });
});

/* ------------------------------ form fields ------------------------------ */

describe("form fields are real AcroForm fields", () => {
  const base = {
    page: 0,
    options: [],
    value: "",
    checked: false,
    multiline: false,
  };
  const fields: FieldObject[] = [
    {
      ...base,
      id: "f1",
      kind: "field",
      fieldType: "text",
      name: "full_name",
      x: 72,
      y: 100,
      width: 200,
      height: 22,
      value: "Ada",
    },
    {
      ...base,
      id: "f2",
      kind: "field",
      fieldType: "checkbox",
      name: "agree",
      x: 72,
      y: 140,
      width: 14,
      height: 14,
      checked: true,
    },
    {
      ...base,
      id: "f3",
      kind: "field",
      fieldType: "dropdown",
      name: "country",
      x: 72,
      y: 170,
      width: 140,
      height: 22,
      options: ["Bangladesh", "Canada", "Japan"],
      value: "Canada",
    },
    {
      ...base,
      id: "f4",
      kind: "field",
      fieldType: "radio",
      name: "size",
      x: 72,
      y: 210,
      width: 80,
      height: 60,
      options: ["S", "M", "L"],
      value: "M",
    },
    {
      ...base,
      id: "f5",
      kind: "field",
      fieldType: "signature",
      name: "signer",
      x: 300,
      y: 400,
      width: 180,
      height: 40,
    },
  ];

  it("names, types, options, values and boxes, on a plain and a rotated page", async () => {
    for (const rotate of [0, 90]) {
      const bytes = await labelled(1, [rotate]);
      const out = await exportEditedPdf(bytes, fields);
      const annots = (await readPages(out.bytes))[0]!.annots.filter(
        (a) => a.subtype === "Widget",
      );
      const by = (name: string) => annots.filter((a) => a.fieldName === name);
      const text = by("full_name")[0]!;
      expect(text.fieldType).toBe("Tx");
      expect(text.fieldValue).toBe("Ada");
      expectRect(text.rect, fields[0]!);
      // Exactly, not just within the editor's 1 pt: pdf-lib grows a widget
      // by half its border, which the export insets for.
      expect(Math.abs(text.rect.width - fields[0]!.width)).toBeLessThan(0.05);
      expect(Math.abs(text.rect.x - fields[0]!.x)).toBeLessThan(0.05);
      const box = by("agree")[0]!;
      expect(box.checkBox).toBe(true);
      expect(box.fieldValue).not.toBe("Off");
      expectRect(box.rect, fields[1]!);
      const drop = by("country")[0]!;
      expect(drop.fieldType).toBe("Ch");
      expect(drop.options!.map((o) => o.exportValue)).toEqual([
        "Bangladesh",
        "Canada",
        "Japan",
      ]);
      expect(drop.fieldValue).toEqual(["Canada"]);
      const radios = by("size");
      expect(radios).toHaveLength(3);
      expect(radios.every((r) => r.radioButton)).toBe(true);
      expect(radios.map((r) => r.buttonValue)).toEqual(["S", "M", "L"]);
      expect(radios[0]!.fieldValue).toBe("M");
      const sig = by("signer")[0]!;
      expect(sig.fieldType).toBe("Sig");
      expectRect(sig.rect, fields[4]!);

      const doc = await PDFDocument.load(out.bytes);
      const form = doc.getForm();
      expect(
        form.getFields().map((f) => [f.getName(), f.constructor.name]),
      ).toEqual([
        ["full_name", "PDFTextField"],
        ["agree", "PDFCheckBox"],
        ["country", "PDFDropdown"],
        ["size", "PDFRadioGroup"],
        ["signer", "PDFSignature"],
      ]);
      // The radio options' names are written beside their buttons.
      const texts = (await readAsViewer(out.bytes)).texts.map((t) => t.str);
      expect(texts).toEqual(expect.arrayContaining(["S", "M", "L"]));
    }
  });

  it("refuses duplicate names and a radio group with one option, before writing", async () => {
    const bytes = await labelled(1);
    await expect(
      exportEditedPdf(bytes, [
        fields[0]!,
        { ...fields[1]!, name: "full_name" },
      ]),
    ).rejects.toThrow(/Two form fields are named “full_name”/);
    await expect(
      exportEditedPdf(bytes, [{ ...fields[3]!, options: ["Only"], value: "" }]),
    ).rejects.toThrow(/at least two options/);
  });

  it("the file's own fields are read with their boxes, and filled in place", async () => {
    // A form made the ordinary way, with pdf-lib.
    const src = await PDFDocument.create();
    const page = src.addPage([612, 792]);
    const form = src.getForm();
    form
      .createTextField("city")
      .addToPage(page, { x: 100, y: 600, width: 150, height: 20 });
    form
      .createCheckBox("subscribe")
      .addToPage(page, { x: 100, y: 560, width: 12, height: 12 });
    const dd = form.createDropdown("plan");
    dd.addOptions(["Free", "Pro"]);
    dd.addToPage(page, { x: 100, y: 520, width: 100, height: 20 });
    const bytes = await src.save();

    const { fields: read } = await readEditorDocument(bytes);
    expect(read.map((f) => [f.name, f.type])).toEqual([
      ["city", "text"],
      ["subscribe", "checkbox"],
      ["plan", "dropdown"],
    ]);
    const city = read[0]!.widgets[0]!;
    expect(city.source).toBe(0);
    // pdf-lib grows a widget by half its border: within the editor's 1 pt.
    for (const [k, want] of [
      ["x0", 100],
      ["y0", 600],
      ["x1", 250],
      ["y1", 620],
    ] as const) {
      expect(Math.abs(city.rect[k] - want)).toBeLessThanOrEqual(TOL);
    }

    const out = await exportEditedPdf(bytes, [], undefined, {
      fills: { city: "Dhaka", subscribe: true, plan: "Pro" },
    });
    expect(out.filled).toBe(3);
    const annots = (await readPages(out.bytes))[0]!.annots;
    const v = (n: string) => annots.find((a) => a.fieldName === n)!.fieldValue;
    expect(v("city")).toBe("Dhaka");
    expect(v("subscribe")).not.toBe("Off");
    expect(v("plan")).toEqual(["Pro"]);
    await expect(
      exportEditedPdf(bytes, [], undefined, { fills: { plan: "Gold" } }),
    ).rejects.toThrow(/not an option/);
  });
});
