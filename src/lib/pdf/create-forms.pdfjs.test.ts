// @native-canvas
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  createFormFields,
  readFormContext,
  RADIO_STACK_GAP,
  type NewFormField,
} from "./create-forms";
import { cropPdf } from "./crop";
import { rotatePages } from "./engine";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * Create Fillable Forms, read back the way a READER receives it.
 *
 * Every assertion here is made on what pdfjs — the engine behind Firefox's
 * viewer and this site's own page previews — reports after parsing the saved
 * bytes: the page's displayed size (its viewport, which applies `/Rotate` and
 * the CropBox), where each form widget sits on that displayed page, the widget
 * rotation it read from /MK /R, and which way the text in each widget's
 * appearance reads. None of it goes through create-forms.ts's own coordinate
 * mapping, so the mapping cannot certify itself.
 *
 * WHY THIS FILE EXISTS. Until 2026-09-27 create-forms placed every widget at
 * the user's numbers in the page's UNROTATED media box and reported that box's
 * size. On a page carrying `/Rotate 90` — which every page run through this
 * site's own Rotate tool carries, and which scanned landscape documents often
 * carry — the runner said "Page 1 is 612 × 792 pt" for a page the viewer shows
 * as 792 × 612, a field typed at "x 50, y 50 from the bottom-left" landed
 * somewhere else, and its text read sideways. On a cropped page the origin was
 * the media box's corner, not the visible one. The job said "Fillable form
 * ready" throughout, and the unit tests were green: they read the fields back
 * through pdf-lib, which reports the same unrotated numbers it was given.
 *
 * The pages are made by `rotatePages` and `cropPdf` — the site's own tools —
 * so the chain under test is the one a user walks: Rotate (or Crop) → Create
 * Fillable Forms → open the PDF.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewedWidget {
  /** pdfjs's annotation id, which its operator list tags each widget with. */
  id: string;
  name: string;
  /** The widget's rectangle on the DISPLAYED page, from its bottom-left. */
  box: Box;
  /** The widget rotation pdfjs read from /MK /R. */
  rotation: number;
  /** How many paths pdfjs paints for this widget's appearance. */
  paths: number;
  /** The text runs pdfjs paints for this widget's appearance. */
  texts: string[];
}

interface ViewedText {
  str: string;
  /** Baseline origin on the displayed page, from its bottom-left. */
  x: number;
  y: number;
  /** Unit reading direction on the displayed page (y up). */
  dirX: number;
  dirY: number;
}

interface ViewedPage {
  rotate: number;
  width: number;
  height: number;
  widgets: ViewedWidget[];
  /** Text drawn by the widgets' appearance streams, as pdfjs paints it. */
  texts: ViewedText[];
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m: Matrix, n: Matrix): Matrix {
  // pdfjs Util.transform order: apply n, then m.
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function asMatrix(value: unknown): Matrix {
  return Array.from(value as ArrayLike<number>) as Matrix;
}

async function readAsViewed(bytes: Uint8Array): Promise<ViewedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    useWorkerFetch: false,
    disableFontFace: true,
    standardFontDataUrl: `${pathToFileURL(join(dir, "standard_fonts")).href}/`,
  });
  const opName = new Map<number, string>(
    Object.entries(pdfjs.OPS).map(([name, code]) => [code as number, name]),
  );
  try {
    const doc = await task.promise;
    const pages: ViewedPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const vt = viewport.transform as Matrix;
      const H = viewport.height;
      // Viewport space is y-down from the displayed top-left; flip to the
      // bottom-left frame the tool's copy promises.
      const toViewer = (x: number, y: number): [number, number] => {
        const [px, py] = apply(vt, x, y);
        return [px, H - py];
      };

      const widgets: ViewedWidget[] = [];
      for (const raw of await page.getAnnotations()) {
        if (raw.subtype !== "Widget") continue;
        const [x0, y0, x1, y1] = raw.rect as [number, number, number, number];
        const pts = [
          toViewer(x0, y0),
          toViewer(x1, y0),
          toViewer(x0, y1),
          toViewer(x1, y1),
        ];
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        widgets.push({
          id: String(raw.id),
          name: String(raw.fieldName),
          box: {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          },
          rotation: Number(raw.rotation ?? 0),
          paths: 0,
          texts: [],
        });
      }

      // Walk the operator list pdfjs paints the widgets' appearances with,
      // tracking the CTM, and record where each run of text starts and which
      // way it reads.
      const texts: ViewedText[] = [];
      const ops = await page.getOperatorList({
        annotationMode: pdfjs.AnnotationMode.ENABLE,
      });
      let ctm: Matrix = IDENTITY;
      let tm: Matrix = IDENTITY;
      const stack: Matrix[] = [];
      let current: ViewedWidget | undefined;
      ops.fnArray.forEach((fn, i) => {
        const name = opName.get(fn);
        const args = ops.argsArray[i] as unknown[];
        if (name === "save") stack.push(ctm);
        else if (name === "restore") ctm = stack.pop() ?? IDENTITY;
        else if (name === "transform") ctm = mul(ctm, asMatrix(args));
        else if (name === "beginAnnotation") {
          stack.push(ctm);
          ctm = mul(mul(ctm, asMatrix(args[2])), asMatrix(args[3]));
          current = widgets.find((w) => w.id === String(args[0]));
        } else if (name === "endAnnotation") {
          ctm = stack.pop() ?? IDENTITY;
          current = undefined;
        } else if (name === "constructPath") {
          if (current) current.paths += 1;
        } else if (name === "beginText") tm = IDENTITY;
        else if (name === "setTextMatrix") tm = asMatrix(args[0] ?? args);
        else if (name === "moveText") {
          const [tx, ty] = args as [number, number];
          tm = mul(tm, [1, 0, 0, 1, tx, ty]);
        } else if (name === "showText") {
          const glyphs = args[0] as { unicode?: string }[];
          const str = glyphs.map((g) => g?.unicode ?? "").join("");
          if (str.trim().length === 0) return;
          current?.texts.push(str);
          const m = mul(ctm, tm);
          const [x, y] = toViewer(...apply(m, 0, 0));
          const [ax, ay] = toViewer(...apply(m, 1, 0));
          const len = Math.hypot(ax - x, ay - y) || 1;
          texts.push({ str, x, y, dirX: (ax - x) / len, dirY: (ay - y) / len });
        }
      });

      pages.push({
        rotate: page.rotate,
        width: viewport.width,
        height: viewport.height,
        widgets,
        texts,
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function letterPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

/**
 * Every value `/Rotate` can take, derived from the property that defines it —
 * a whole number of quarter turns — rather than typed as a list.
 */
const QUARTER_TURNS = Array.from({ length: 4 }, (_, q) => q * 90);

/** Each turn, on a plain page and on one cut down by the site's Crop tool. */
const CASES = QUARTER_TURNS.flatMap((turn) =>
  [false, true].map((cropped) => ({ turn, cropped })),
);

const CROP = { top: 30, right: 40, bottom: 50, left: 60 };

async function fixture(turn: number, cropped: boolean): Promise<Uint8Array> {
  let bytes = await letterPage();
  if (cropped) bytes = await cropPdf(bytes, { margins: CROP });
  return turn === 0 ? bytes : rotatePages(bytes, [0], turn);
}

/** One field of every type, in the DISPLAYED frame, plus one at the corner. */
function fields(): NewFormField[] {
  return [
    {
      type: "text",
      name: "corner",
      page: 1,
      x: 0,
      y: 0,
      width: 60,
      height: 18,
    },
    {
      type: "text",
      name: "name",
      page: 1,
      x: 40,
      y: 40,
      width: 180,
      height: 20,
      defaultValue: "TEXT-VALUE",
    },
    {
      type: "dropdown",
      name: "pick",
      page: 1,
      x: 40,
      y: 100,
      width: 150,
      height: 20,
      options: ["Alpha", "Bravo"],
      defaultValue: "Bravo",
    },
    {
      type: "optionlist",
      name: "list",
      page: 1,
      x: 40,
      y: 160,
      width: 150,
      height: 40,
      options: ["Charlie", "Delta"],
      defaultValue: "Delta",
    },
    {
      type: "checkbox",
      name: "agree",
      page: 1,
      x: 260,
      y: 40,
      width: 16,
      height: 16,
      checked: true,
    },
    {
      type: "radio",
      name: "choice",
      page: 1,
      x: 260,
      y: 140,
      width: 14,
      height: 14,
      options: ["Yes", "No"],
      defaultValue: "No",
    },
  ];
}

/** Every widget box a spec asks for, in the displayed frame, in order. */
function requestedBoxes(spec: NewFormField): Box[] {
  if (spec.type !== "radio") return [spec];
  const gap = spec.gap ?? RADIO_STACK_GAP;
  return spec.options.map((_, i) => ({
    x: spec.x,
    y: spec.y - i * (spec.height + gap),
    width: spec.width,
    height: spec.height,
  }));
}

/**
 * pdf-lib grows each widget by its 1 pt border, half on every side — the only
 * difference allowed between the box asked for and the box a reader gets.
 */
const BORDER_SLACK = 0.5 + 1e-6;

function expectBoxNear(actual: Box, wanted: Box): void {
  const edges = (b: Box) => [b.x, b.y, b.x + b.width, b.y + b.height];
  const a = edges(actual);
  edges(wanted).forEach((edge, i) => {
    expect(Math.abs(a[i]! - edge)).toBeLessThanOrEqual(BORDER_SLACK);
  });
}

describe("create-forms places fields where the reader sees them", () => {
  it("HEALTH CHECK: the fixtures really are rotated and cropped, and pdfjs sees it", async () => {
    // A blind reader returns `rotate: 0` and the media box for everything, and
    // every assertion below would then pass on the unrotated behaviour it
    // exists to catch. The corpus must also have the size it was built with.
    expect(CASES).toHaveLength(8);
    for (const { turn, cropped } of CASES) {
      const [page] = await readAsViewed(await fixture(turn, cropped));
      expect(page!.rotate).toBe(turn);
      const w = cropped ? 612 - CROP.left - CROP.right : 612;
      const h = cropped ? 792 - CROP.top - CROP.bottom : 792;
      const quarter = turn % 180 !== 0;
      expect({ width: page!.width, height: page!.height }).toEqual(
        quarter ? { width: h, height: w } : { width: w, height: h },
      );
    }
  });

  for (const { turn, cropped } of CASES) {
    const label = `/Rotate ${turn}${cropped ? ", cropped" : ""}`;

    it(`${label}: the size the runner shows is the size the reader sees`, async () => {
      const bytes = await fixture(turn, cropped);
      const [viewed] = await readAsViewed(bytes);
      const context = await readFormContext(bytes);
      expect(context.pageSizes[0]).toEqual({
        width: viewed!.width,
        height: viewed!.height,
      });
    });

    it(`${label}: every widget lands on the displayed page where it was asked for`, async () => {
      const specs = fields();
      const result = await createFormFields(
        await fixture(turn, cropped),
        specs,
      );
      const [page] = await readAsViewed(result.bytes);
      const expected = specs.flatMap((spec) =>
        requestedBoxes(spec).map((box) => ({ name: spec.name, box })),
      );
      // Health: every widget arrived, and nothing else did.
      expect(page!.widgets.map((w) => w.name)).toEqual(
        expected.map((e) => e.name),
      );
      page!.widgets.forEach((widget, i) => {
        expectBoxNear(widget.box, expected[i]!.box);
        // /MK /R must cancel the page's turn, or the contents read sideways.
        expect(widget.rotation).toBe(turn);
      });
    });

    it(`${label}: the text inside each widget reads left to right, inside its box`, async () => {
      const specs = fields();
      const result = await createFormFields(
        await fixture(turn, cropped),
        specs,
      );
      const [page] = await readAsViewed(result.bytes);
      // Health: the values the appearances must draw are all there — a reader
      // that saw no text would otherwise pass every direction check below.
      for (const value of ["TEXT-VALUE", "Bravo", "Charlie", "Delta"]) {
        expect(page!.texts.some((t) => t.str.includes(value))).toBe(true);
      }
      for (const text of page!.texts) {
        expect(text.dirX).toBeCloseTo(1, 5);
        expect(text.dirY).toBeCloseTo(0, 5);
        const owner = page!.widgets.find(
          (w) =>
            text.x >= w.box.x &&
            text.x <= w.box.x + w.box.width &&
            text.y >= w.box.y &&
            text.y <= w.box.y + w.box.height,
        );
        expect(
          owner,
          `"${text.str}" is drawn outside every widget`,
        ).toBeTruthy();
      }
    });
  }
});

describe("each new field shows its starting value", () => {
  // The save no longer regenerates appearances (it redrew the PDF's EXISTING
  // fields too, and crashed on their non-Latin values), so every new field's
  // appearance is whatever `addToPage` drew. A value set after that call never
  // reaches the page. Until 2026-09-27 that was already true of the checkbox:
  // "starts checked" set /V /Yes before the widget existed, the widget was born
  // /AS /Off, and a reader painted it unchecked.
  it("text, list values and checked buttons are painted, against unset controls", async () => {
    const specs: NewFormField[] = [
      ...fields().filter((f) => f.name !== "agree"),
      {
        type: "checkbox",
        name: "agree",
        page: 1,
        x: 260,
        y: 40,
        width: 16,
        height: 16,
        checked: true,
      },
      {
        type: "checkbox",
        name: "unset",
        page: 1,
        x: 300,
        y: 40,
        width: 16,
        height: 16,
      },
      {
        type: "text",
        name: "blank",
        page: 1,
        x: 40,
        y: 300,
        width: 120,
        height: 20,
      },
    ];
    const result = await createFormFields(await letterPage(), specs);
    const [page] = await readAsViewed(result.bytes);
    const widget = (name: string, nth = 0) =>
      page!.widgets.filter((w) => w.name === name)[nth]!;

    // Controls: an empty text field paints no text, and an unchecked box
    // paints its frame only. Both must hold or the comparisons below prove
    // nothing.
    expect(widget("blank").texts).toEqual([]);
    expect(widget("unset").paths).toBeGreaterThan(0);

    expect(widget("name").texts.join("")).toContain("TEXT-VALUE");
    expect(widget("pick").texts.join("")).toContain("Bravo");
    expect(widget("list").texts.join("")).toContain("Delta");
    // Checked paints a mark on top of the frame; unchecked does not.
    expect(widget("agree").paths).toBeGreaterThan(widget("unset").paths);
    // The radio default is "No", the second button: it carries the dot.
    expect(widget("choice", 1).paths).toBeGreaterThan(
      widget("choice", 0).paths,
    );
  });
});
