// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFBool, PDFDocument, PDFName, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  BOOKLET_BINDINGS,
  BOOKLET_FLIPS,
  BOOKLET_SHEETS,
  DEFAULT_BOOKLET_OPTIONS,
  bookletBackCoverBlocked,
  bookletHalves,
  bookletDrawnPair,
  bookletOrder,
  bookletOutputName,
  bookletPageSlots,
  bookletPdf,
  bookletSheetSize,
  type BookletOptions,
  type BookletSide,
} from "./booklet";
import { PdfEncryptedError, PdfEngineError } from "./engine";
import { MAX_PAGE_SIDE_PT } from "./image-page-layout";
import { N_UP_MARGINS, N_UP_SHEETS } from "./n-up";

/**
 * Booklet, checked three ways: the side order as numbers against literal
 * tables; the same order against an INDEPENDENT model that folds a stack of
 * sheets and reads the pages off in turn (`foldedReadingOrder`, which shares
 * no code or formula with `bookletOrder`); and the OUTPUT read by pdf.js —
 * which page's marker sits in which half of which side, at what size, which
 * way up.
 */

const require = createRequire(import.meta.url);
type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;
function pdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<Pdfjs>;
  return pdfjsPromise;
}

// ── The order, as numbers ────────────────────────────────────────────────

/** "_|1 2|_": each side's left|right, blank as "_". */
const show = (sides: BookletSide[]) =>
  sides.map((s) => `${s.left ?? "_"}|${s.right ?? "_"}`).join(" ");

const LEFT = { binding: "left", backCover: false } as const;

describe("bookletOrder: literal tables", () => {
  // Worked out by hand from a paper dummy: sheet 1 front is last | first.
  const TABLE: Record<number, string> = {
    1: "_|1 _|_",
    2: "_|1 2|_",
    3: "_|1 2|3",
    4: "4|1 2|3",
    5: "_|1 2|_ _|3 4|5",
    6: "_|1 2|_ 6|3 4|5",
    7: "_|1 2|7 6|3 4|5",
    8: "8|1 2|7 6|3 4|5",
    9: "_|1 2|_ _|3 4|9 8|5 6|7",
    16: "16|1 2|15 14|3 4|13 12|5 6|11 10|7 8|9",
  };
  for (const [n, want] of Object.entries(TABLE)) {
    it(`${n} page(s), left binding`, () => {
      expect(show(bookletOrder(Number(n), LEFT))).toBe(want);
    });
    it(`${n} page(s), right binding is each side mirrored`, () => {
      const mirrored = want
        .split(" ")
        .map((s) => s.split("|").reverse().join("|"))
        .join(" ");
      expect(
        show(bookletOrder(Number(n), { binding: "right", backCover: false })),
      ).toBe(mirrored);
    });
  }

  // Back cover: the blanks go before the last page, which stays outside.
  const BACK: Record<number, string> = {
    3: "3|1 2|_",
    5: "5|1 2|_ _|3 4|_",
    6: "6|1 2|_ _|3 4|5",
    7: "7|1 2|_ 6|3 4|5",
    9: "9|1 2|_ _|3 4|_ 8|5 6|7",
  };
  for (const [n, want] of Object.entries(BACK)) {
    it(`${n} pages, back cover on`, () => {
      expect(
        show(bookletOrder(Number(n), { binding: "left", backCover: true })),
      ).toBe(want);
    });
  }

  it("nothing for a count that is not a page count", () => {
    expect(bookletOrder(0, LEFT)).toEqual([]);
    expect(bookletOrder(-3, LEFT)).toEqual([]);
    expect(bookletOrder(2.5, LEFT)).toEqual([]);
  });
});

/**
 * The independent oracle: lay S sheets on top of each other (sheet 0 at the
 * bottom, outermost), fold the stack in half along the middle, and read the
 * booklet front to back. Each half-sheet becomes one LEAF: for a left
 * binding the right halves are the leaves before the fold (outermost sheet
 * first), and the left halves the leaves after it (innermost first). A leaf
 * cut from the front's right half has the back's LEFT half behind it,
 * because a short-edge flip turns the sheet over left to right. Reading a
 * leaf gives its recto, then its verso. The pages, in reading order, are the
 * document's pages with the blanks where the options put them.
 */
function foldedReadingOrder(
  pageCount: number,
  binding: "left" | "right",
  backCover: boolean,
): BookletSide[] {
  const sheets = Math.ceil(Math.max(pageCount, 1) / 4);
  const total = sheets * 4;
  // Reading order of the document, blanks placed.
  const pages: (number | null)[] = [];
  const movable = backCover && pageCount > 1 && pageCount % 4 !== 0;
  const body = movable ? pageCount - 1 : pageCount;
  for (let p = 1; p <= body; p += 1) pages.push(p);
  while (pages.length < (movable ? total - 1 : total)) pages.push(null);
  if (movable) pages.push(pageCount);

  type Half = "left" | "right";
  type Spot = { sheet: number; face: "front" | "back"; half: Half };
  const opposite = (h: Half): Half => (h === "left" ? "right" : "left");
  // Before the fold: the half on the binding's far side, outermost first.
  const opening: Half = binding === "left" ? "right" : "left";
  const leaves: [Spot, Spot][] = [];
  for (let s = 0; s < sheets; s += 1)
    leaves.push([
      { sheet: s, face: "front", half: opening },
      { sheet: s, face: "back", half: opposite(opening) },
    ]);
  for (let s = sheets - 1; s >= 0; s -= 1)
    leaves.push([
      { sheet: s, face: "back", half: opening },
      { sheet: s, face: "front", half: opposite(opening) },
    ]);
  const spots = leaves.flat();

  const sides: BookletSide[] = [];
  for (let s = 0; s < sheets; s += 1)
    for (const face of ["front", "back"] as const)
      sides.push({ sheet: s, face, left: null, right: null });
  spots.forEach((spot, k) => {
    const side = sides.find(
      (x) => x.sheet === spot.sheet && x.face === spot.face,
    )!;
    side[spot.half] = pages[k]!;
  });
  return sides;
}

/** What Multiple Pages per Sheet does with two to a side: 1|2, 3|4, … */
function nUpOrder(pageCount: number): BookletSide[] {
  const sides: BookletSide[] = [];
  for (let k = 0; k < Math.ceil(pageCount / 2); k += 1)
    sides.push({
      sheet: Math.floor(k / 2),
      face: k % 2 === 0 ? "front" : "back",
      left: 2 * k + 1,
      right: 2 * k + 2 <= pageCount ? 2 * k + 2 : null,
    });
  return sides;
}

/**
 * The order with the padding dropped: the same formula with the page count
 * where the multiple of 4 belongs — what the engine would make if it forgot
 * to round up. Halves past either end are blank.
 */
function unpaddedOrder(pageCount: number): BookletSide[] {
  const at = (k: number) => (k >= 1 && k <= pageCount ? k : null);
  const sides: BookletSide[] = [];
  for (let i = 0; i < Math.ceil(pageCount / 4); i += 1) {
    sides.push({
      sheet: i,
      face: "front",
      left: at(pageCount - 2 * i),
      right: at(2 * i + 1),
    });
    sides.push({
      sheet: i,
      face: "back",
      left: at(2 * i + 2),
      right: at(pageCount - 2 * i - 1),
    });
  }
  return sides;
}

describe("bookletOrder against the folded stack", () => {
  it("agrees for every count up to 200, both bindings, back cover on and off", () => {
    const disagreements: string[] = [];
    for (let n = 1; n <= 200; n += 1)
      for (const binding of ["left", "right"] as const)
        for (const backCover of [false, true]) {
          const got = show(bookletOrder(n, { binding, backCover }));
          const want = show(foldedReadingOrder(n, binding, backCover));
          if (got !== want)
            disagreements.push(`${n} ${binding} ${backCover}: ${got}`);
        }
    expect(disagreements).toEqual([]);
  });

  it("positive control: the oracle rejects n-up order and an unpadded order", () => {
    for (const n of [4, 6, 8, 12]) {
      expect(show(nUpOrder(n))).not.toBe(
        show(foldedReadingOrder(n, "left", false)),
      );
    }
    for (const n of [5, 6, 7]) {
      expect(show(unpaddedOrder(n))).not.toBe(
        show(foldedReadingOrder(n, "left", false)),
      );
    }
    // …and a fold read the wrong way (right binding) for a left booklet.
    expect(show(foldedReadingOrder(8, "right", false))).not.toBe(
      show(bookletOrder(8, LEFT)),
    );
  });

  it("health check: the oracle's literal tables are the hand-made dummy's", () => {
    expect(show(foldedReadingOrder(6, "left", false))).toBe("_|1 2|_ 6|3 4|5");
    expect(show(foldedReadingOrder(8, "left", false))).toBe("8|1 2|7 6|3 4|5");
  });
});

describe("bookletOrder: properties", () => {
  for (let n = 1; n <= 64; n += 1) {
    it(`${n} pages: every page once, blanks = slots − pages, two sides a sheet`, () => {
      for (const backCover of [false, true]) {
        const sides = bookletOrder(n, { binding: "left", backCover });
        const cells = sides.flatMap((s) => [s.left, s.right]);
        const pages = cells.filter((c): c is number => c !== null);
        expect([...pages].sort((a, b) => a - b)).toEqual(
          Array.from({ length: n }, (_, i) => i + 1),
        );
        expect(cells.length - pages.length).toBe(bookletPageSlots(n) - n);
        expect(sides.length).toBe((2 * bookletPageSlots(n)) / 4);
      }
    });
  }

  it("right binding mirrors left on every side", () => {
    for (let n = 1; n <= 40; n += 1)
      for (const backCover of [false, true]) {
        const l = bookletOrder(n, { binding: "left", backCover });
        const r = bookletOrder(n, { binding: "right", backCover });
        expect(r.map((s) => [s.right, s.left])).toEqual(
          l.map((s) => [s.left, s.right]),
        );
      }
  });

  it("back cover changes nothing when there are no blanks, or one page", () => {
    for (const n of [1, 4, 8, 12, 16, 20]) {
      expect(bookletOrder(n, { binding: "left", backCover: true })).toEqual(
        bookletOrder(n, LEFT),
      );
      expect(bookletBackCoverBlocked(n)).not.toBeNull();
    }
    for (const n of [2, 3, 5, 6, 7, 9]) {
      expect(bookletBackCoverBlocked(n)).toBeNull();
      expect(
        show(bookletOrder(n, { binding: "left", backCover: true })),
      ).not.toBe(show(bookletOrder(n, LEFT)));
    }
  });
});

describe("bookletHalves", () => {
  it("folds exactly at W / 2, with the margin on every edge of each half", () => {
    const sheet = { width: 841.89, height: 595.28 };
    for (const { points: m } of N_UP_MARGINS) {
      const [l, r] = bookletHalves(sheet, m);
      expect(l.x).toBe(m);
      expect(l.x + l.width + m).toBeCloseTo(sheet.width / 2, 9);
      expect(r.x - m).toBeCloseTo(sheet.width / 2, 9);
      expect(r.x + r.width + m).toBeCloseTo(sheet.width, 9);
      expect([l.y, r.y]).toEqual([m, m]);
      expect(l.height).toBeCloseTo(sheet.height - 2 * m, 9);
      expect(l.width).toBeCloseTo(r.width, 9);
    }
  });
});

describe("bookletSheetSize", () => {
  it("turns every paper landscape, and doubles the first page for Two pages at full size", () => {
    for (const s of BOOKLET_SHEETS) {
      const size = bookletSheetSize(s.id, { width: 300, height: 400 });
      if (s.size) {
        expect(size.width).toBe(Math.max(s.size.width, s.size.height));
        expect(size.height).toBe(Math.min(s.size.width, s.size.height));
      } else {
        expect(size).toEqual({ width: 600, height: 400 });
      }
    }
  });

  it("offers Multiple Pages per Sheet's papers, not its Original page size", () => {
    expect(BOOKLET_SHEETS.filter((s) => s.size).map((s) => s.id)).toEqual(
      N_UP_SHEETS.filter((s) => s.id !== "source").map((s) => s.id),
    );
  });

  it("refuses two pages side by side past PDF's page-side limit, naming it", () => {
    const err = (() => {
      try {
        bookletSheetSize("double", { width: 7300, height: 500 });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(PdfEngineError);
    expect((err as Error).message).toContain(
      MAX_PAGE_SIDE_PT.toLocaleString("en-US"),
    );
    expect((err as Error).message).toContain("14,600");
    // The limit itself is allowed.
    expect(
      bookletSheetSize("double", { width: MAX_PAGE_SIDE_PT / 2, height: 500 })
        .width,
    ).toBe(MAX_PAGE_SIDE_PT);
  });
});

describe("bookletOutputName", () => {
  it("adds -booklet", () => {
    expect(bookletOutputName("zine.pdf")).toBe("zine-booklet.pdf");
  });
});

// ── The output, read back with pdf.js ────────────────────────────────────

interface Marker {
  text: string;
  /** Displayed position of the run's origin, top-left origin. */
  x: number;
  y: number;
  /** Run direction on screen, rounded unit vector. */
  dir: [number, number];
}

interface Side {
  width: number;
  height: number;
  markers: Marker[];
  texts: string[];
}

async function readSides(
  bytes: Uint8Array,
  pattern = /^P\d+$/,
): Promise<Side[]> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: Side[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const markers: Marker[] = [];
    const texts: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      texts.push(item.str);
      if (!pattern.test(item.str)) continue;
      const [a, b, , , e, f] = item.transform as number[];
      const [x, y] = viewport.convertToViewportPoint(e!, f!);
      const [x2, y2] = viewport.convertToViewportPoint(e! + a!, f! + b!);
      const len = Math.hypot(x2! - x!, y2! - y!) || 1;
      markers.push({
        text: item.str,
        x: x!,
        y: y!,
        dir: [
          Math.round((x2! - x!) / len) + 0,
          Math.round((y2! - y!) / len) + 0,
        ],
      });
    }
    out.push({
      width: viewport.width,
      height: viewport.height,
      markers,
      texts,
    });
  }
  await task.destroy();
  return out;
}

/**
 * Which page sits in each half of each side, read off the markers: a run
 * whose origin is left of the fold is the left half's. "_" for an empty half.
 */
function readOrder(sides: Side[]): string {
  return sides
    .map((side) => {
      const half = (left: boolean) =>
        side.markers
          .filter((m) => m.x < side.width / 2 === left)
          .map((m) => m.text.slice(1))
          .join("+") || "_";
      return `${half(true)}|${half(false)}`;
    })
    .join(" ");
}

/** `count` 300 × 400 pages, each labelled "P<n>" near its top-left corner. */
async function labelledPdf(
  count: number,
  { size = [300, 400] as [number, number], rotate = 0 } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i += 1) {
    const page = doc.addPage(size);
    page.drawText(`P${i}`, { x: 20, y: size[1] - 40, size: 24, font });
    page.setRotation(degrees(rotate));
  }
  return doc.save();
}

const opts = (over: Partial<BookletOptions> = {}): BookletOptions => ({
  ...DEFAULT_BOOKLET_OPTIONS,
  ...over,
});

const A4 = N_UP_SHEETS.find((s) => s.id === "a4")!.size!;
const LETTER = N_UP_SHEETS.find((s) => s.id === "letter")!.size!;

describe("bookletPdf: the output, read by pdf.js", () => {
  it("1 to 17 pages: each marker in the half the folded stack puts it, on 2·⌈N/4⌉ landscape A4 sides", async () => {
    for (let n = 1; n <= 17; n += 1) {
      const r = await bookletPdf(await labelledPdf(n), opts());
      const sides = await readSides(r.bytes);
      expect(sides.length, `${n} pages`).toBe(2 * Math.ceil(n / 4));
      expect(r.sides).toBe(sides.length);
      expect(r.sheets).toBe(Math.ceil(n / 4));
      expect(r.blanks).toBe(4 * Math.ceil(n / 4) - n);
      expect(r.sourcePages).toBe(n);
      for (const side of sides) {
        expect([side.width, side.height].map(Math.round)).toEqual(
          [A4.height, A4.width].map(Math.round),
        );
        for (const m of side.markers) expect(m.dir).toEqual([1, 0]);
      }
      expect(readOrder(sides), `${n} pages`).toBe(
        show(foldedReadingOrder(n, "left", false)),
      );
    }
  }, 60_000);

  it("right binding and the back cover reach the file", async () => {
    const bytes = await labelledPdf(6);
    const right = await readSides(
      (await bookletPdf(bytes, opts({ binding: "right" }))).bytes,
    );
    expect(readOrder(right)).toBe("1|_ _|2 3|6 5|4");
    const back = await readSides(
      (await bookletPdf(bytes, opts({ backCover: true }))).bytes,
    );
    expect(readOrder(back)).toBe("6|1 2|_ _|3 4|5");
  });

  it("each page is fitted, centred, in its half: the marker sits where the geometry puts it", async () => {
    const r = await bookletPdf(await labelledPdf(4), opts());
    const [front] = await readSides(r.bytes);
    // Independent arithmetic: a 300 × 400 page in a 420.9 × 595.3 half.
    const W = A4.height;
    const H = A4.width;
    const scale = Math.min(W / 2 / 300, H / 400);
    const drawnH = 400 * scale;
    const top = (H - drawnH) / 2;
    const leftX = (W / 2 - 300 * scale) / 2;
    const markerAt = (half: 0 | 1) => ({
      x: half * (W / 2) + leftX + 20 * scale,
      y: top + 40 * scale,
    });
    const p4 = front!.markers.find((m) => m.text === "P4")!;
    const p1 = front!.markers.find((m) => m.text === "P1")!;
    expect(p4.x).toBeCloseTo(markerAt(0).x, 0);
    expect(p4.y).toBeCloseTo(markerAt(0).y, 0);
    expect(p1.x).toBeCloseTo(markerAt(1).x, 0);
    expect(p1.y).toBeCloseTo(markerAt(1).y, 0);
    expect(r.scalePercent).toEqual({
      min: Math.round(scale * 100),
      max: Math.round(scale * 100),
    });
  });

  it("Two pages at full size draws at 100%; a margin shrinks the pages and says by how much", async () => {
    const bytes = await labelledPdf(4);
    const full = await bookletPdf(bytes, opts({ sheet: "double" }));
    expect(full.sheetSize).toEqual({ width: 600, height: 400 });
    expect(full.scalePercent).toEqual({ min: 100, max: 100 });
    const large = N_UP_MARGINS.find((m) => m.id === "large")!.points;
    const margined = await bookletPdf(
      bytes,
      opts({ sheet: "double", margin: "large" }),
    );
    const want = Math.round(
      Math.min((300 - 2 * large) / 300, (400 - 2 * large) / 400) * 100,
    );
    expect(margined.scalePercent).toEqual({ min: want, max: want });
    expect(want).toBeLessThan(100);
  });

  it("mixed page sizes report the smallest and largest scale", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]).drawText("P1", { x: 20, y: 360 });
    doc.addPage([600, 800]).drawText("P2", { x: 20, y: 760 });
    const r = await bookletPdf(await doc.save(), opts({ sheet: "letter" }));
    const W = Math.max(LETTER.width, LETTER.height);
    const H = Math.min(LETTER.width, LETTER.height);
    const at = (w: number, h: number) =>
      Math.round(Math.min(W / 2 / w, H / h) * 100);
    expect(r.scalePercent).toEqual({ min: at(600, 800), max: at(300, 400) });
  });

  it("Long edge turns every BACK side 180° and no front", async () => {
    const bytes = await labelledPdf(8);
    const short = await readSides((await bookletPdf(bytes, opts())).bytes);
    const long = await readSides(
      (await bookletPdf(bytes, opts({ flip: "long" }))).bytes,
    );
    expect(long.length).toBe(short.length);
    long.forEach((side, k) => {
      const back = k % 2 === 1;
      for (const m of side.markers)
        expect(m.dir, `side ${k + 1}`).toEqual(back ? [-1, 0] : [1, 0]);
      for (const m of short[k]!.markers) expect(m.dir).toEqual([1, 0]);
    });
    // Turned about the centre: a back's halves swap places on the sheet.
    const turned = (s: string) =>
      s
        .split(" ")
        .map((pair, k) =>
          k % 2 === 1 ? pair.split("|").reverse().join("|") : pair,
        )
        .join(" ");
    expect(readOrder(long)).toBe(turned(readOrder(short)));
    expect(readOrder(short)).toBe("8|1 2|7 6|3 4|5");
  });

  it("the editor's preview pairs (bookletDrawnPair) are the pages as the PDF draws them, on each flip", async () => {
    const bytes = await labelledPdf(8);
    const read: Record<string, string> = {};
    const preview: Record<string, string> = {};
    for (const flip of BOOKLET_FLIPS.map((f) => f.id)) {
      read[flip] = readOrder(
        await readSides((await bookletPdf(bytes, opts({ flip }))).bytes),
      );
      preview[flip] = bookletOrder(8, opts({ flip }))
        .map((side) =>
          bookletDrawnPair(flip, side)
            .map((p) => (p === null ? "_" : `${p}`))
            .join("|"),
        )
        .join(" ");
    }
    expect(preview).toEqual(read);
    // Health: the two flips really differ, so the comparison has teeth.
    expect(read.long).not.toBe(read.short);
    expect(read.long).toBe("8|1 7|2 6|3 5|4");
  });

  it("a page carrying /Rotate 90 lands upright in its half", async () => {
    const input = await labelledPdf(2, { rotate: 90 });
    // The way a viewer shows the source: the label runs down the page.
    const shown = (await readSides(input))[0]!.markers[0]!.dir;
    expect(shown).toEqual([0, 1]);
    const r = await bookletPdf(input, opts());
    const sides = await readSides(r.bytes);
    expect(readOrder(sides)).toBe("_|1 2|_");
    for (const side of sides)
      for (const m of side.markers) expect(m.dir).toEqual(shown);
    // Control: the same pages unrotated read across, so the check can tell.
    const flat = await readSides(
      (await bookletPdf(await labelledPdf(2), opts())).bytes,
    );
    expect(flat[0]!.markers[0]!.dir).toEqual([1, 0]);
  });

  it("an inset CropBox: only the visible part is drawn, fitted to the half", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText("HIDDEN", { x: 10, y: 10, size: 12, font });
    page.drawText("P1", { x: 120, y: 660, size: 24, font });
    page.setCropBox(100, 100, 300, 600);
    const r = await bookletPdf(await doc.save(), opts());
    const sides = await readSides(r.bytes);
    expect(sides[0]!.texts).not.toContain("HIDDEN");
    const p1 = sides[0]!.markers.find((m) => m.text === "P1")!;
    expect(p1.dir).toEqual([1, 0]);
    expect(p1.x).toBeGreaterThan(sides[0]!.width / 2);
    // The 300 × 600 crop, not the 600 × 800 page, sets the scale.
    const W = A4.height;
    const H = A4.width;
    expect(r.scalePercent.min).toBe(
      Math.round(Math.min(W / 2 / 300, H / 600) * 100),
    );
  });

  it("a form value stored with no drawing (/NeedAppearances) is drawn onto the booklet", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    doc.addPage([400, 400]);
    const form = doc.getForm();
    const field = form.createTextField("name");
    field.addToPage(doc.getPage(0), { x: 20, y: 200, width: 200, height: 30 });
    field.setText("FILLEDVALUE");
    for (const widget of field.acroField.getWidgets())
      widget.dict.delete(PDFName.of("AP"));
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    const bytes = await doc.save({ updateFieldAppearances: false });
    // Control: the input page holds no drawing of the value.
    const before = await readSides(bytes);
    expect(before[0]!.texts.join("")).not.toContain("FILLEDVALUE");
    const r = await bookletPdf(bytes, opts());
    const sides = await readSides(r.bytes);
    expect(sides[0]!.texts.join("")).toContain("FILLEDVALUE");
    expect(r.undrawnFields).toEqual([]);
  });
});

describe("bookletPdf: options and hostile input", () => {
  it("refuses an option the runner never offers, naming the choices", async () => {
    const bytes = await labelledPdf(2);
    const cases: [Partial<BookletOptions>, string][] = [
      [{ sheet: "tabloid" as never }, BOOKLET_SHEETS.at(-1)!.label],
      [{ binding: "top" as never }, BOOKLET_BINDINGS[0]!.label],
      [{ flip: "none" as never }, BOOKLET_FLIPS[1]!.label],
      [{ margin: "huge" as never }, N_UP_MARGINS[0]!.label],
    ];
    for (const [over, named] of cases) {
      const err = await bookletPdf(bytes, opts(over)).catch((e) => e);
      expect(err).toBeInstanceOf(PdfEngineError);
      expect((err as Error).message).toContain(named);
    }
  });

  it("refuses a PDF too wide for Two pages at full size through the engine", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([7300, 500]);
    const err = await bookletPdf(
      await doc.save(),
      opts({ sheet: "double" }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PdfEngineError);
    // …and the same file on a paper size is fine.
    const ok = await bookletPdf(await doc.save(), opts());
    expect(ok.sides).toBe(2);
  });

  it("refuses bytes that are not a PDF with the engine's typed error", async () => {
    const err = await bookletPdf(
      new TextEncoder().encode("not a pdf at all"),
      opts(),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PdfEngineError);
  });

  it("refuses an encrypted PDF with the engine's encrypted error", async () => {
    const { encryptedPdf } = await import("@/tests/encrypted-pdf-fixture");
    const locked = encryptedPdf({ userPassword: "open", ownerPassword: "own" });
    const err = await bookletPdf(locked, opts()).catch((e) => e);
    expect(err).toBeInstanceOf(PdfEncryptedError);
  });
});
