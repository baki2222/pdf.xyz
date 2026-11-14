// @vitest-environment node
// @native-canvas
/**
 * The note a preview draws in place of a page past the page budget
 * (`drawPageNote`), at the point of consumption: the pixels a reader sees,
 * turned as the board turns them, and the name a screen reader reads.
 *
 * History (hostile review r2, 2026-11-14): the sentence existed only as
 * canvas pixels; `Thumbnail.note` claimed to be "for an accessible name" and
 * nothing read it; and a base-orientation tile, turned in CSS by the page's
 * /Rotate, showed the note sideways on a /Rotate 90 scan.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_IMAGES_NOTE, drawPageNote } from "./pdfjs-guard";

const requireHere = createRequire(import.meta.url);
const napi = createRequire(requireHere.resolve("pdfjs-dist/package.json"))(
  "@napi-rs/canvas",
) as {
  createCanvas(
    width: number,
    height: number,
  ): {
    width: number;
    height: number;
    getContext(kind: "2d"): CanvasRenderingContext2D;
  };
};

/** `canvas` turned 90 degrees clockwise, as `rotate(90deg)` shows it. */
function turned(src: ReturnType<typeof napi.createCanvas>) {
  const out = napi.createCanvas(src.height, src.width);
  const ctx = out.getContext("2d");
  ctx.translate(out.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src as unknown as CanvasImageSource, 0, 0);
  return out;
}

const pixels = (c: ReturnType<typeof napi.createCanvas>) =>
  c.getContext("2d").getImageData(0, 0, c.width, c.height).data;

/** Pixels that differ by more than a rounding step. */
function differing(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 1) if (Math.abs(a[i]! - b[i]!) > 8) n += 1;
  return n;
}

describe("the page note", () => {
  it("drawn for a tile the board turns 90 degrees, reads exactly as an upright note of that shape", () => {
    const tile = napi.createCanvas(400, 600);
    drawPageNote(tile, PAGE_IMAGES_NOTE, 90);
    const upright = napi.createCanvas(600, 400);
    drawPageNote(upright, PAGE_IMAGES_NOTE, 0);
    const seen = pixels(turned(tile));
    const want = pixels(upright);
    // Health: the note has ink (a blank canvas would match a blank one).
    let ink = 0;
    for (let i = 0; i < want.length; i += 4) if (want[i]! < 120) ink += 1;
    expect(ink).toBeGreaterThan(500);
    expect(differing(seen, want)).toBeLessThan(want.length / 1000);
    // Positive control: the same tile drawn without the turn is sideways.
    const sideways = napi.createCanvas(400, 600);
    drawPageNote(sideways, PAGE_IMAGES_NOTE, 0);
    expect(differing(pixels(turned(sideways)), want)).toBeGreaterThan(
      want.length / 100,
    );
  });

  it("names a DOM canvas with its sentence", () => {
    const attrs = new Map<string, string>();
    const canvas = {
      width: 10,
      height: 10,
      getContext: () => null,
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
    };
    drawPageNote(canvas, PAGE_IMAGES_NOTE);
    expect(Object.fromEntries(attrs)).toEqual({
      role: "img",
      "aria-label": PAGE_IMAGES_NOTE,
    });
  });
});

/**
 * Every component that shows a rendered page (it renders one, or takes a
 * `Thumbnail`), found by walking src/components: each `<img>` in it names
 * the note drawn in the page's place, so a screen reader is told the page
 * was not drawn, and why.
 */
describe("every rendered-page <img> carries the note as its name", () => {
  const ROOT = path.join(process.cwd(), "src/components");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) ? [p] : [];
    });
  const SHOWS_A_PAGE =
    /\b(createThumbnailRenderer|usePdfThumbnails|usePageImage|Thumbnail)\b/;
  const files = walk(ROOT).filter((f) =>
    SHOWS_A_PAGE.test(readFileSync(f, "utf8")),
  );
  /** Each `<img ...>` element's text in `src`. */
  const imgs = (src: string) =>
    [...src.matchAll(/<img\s[\s\S]*?\/>/g)].map((m) => m[0]);

  it("health: the walk finds the page-showing components, and their images", () => {
    const names = files.map((f) => path.basename(f));
    for (const known of [
      "page-tile.tsx",
      "page-zoom-dialog.tsx",
      "crop-runner.tsx",
      "viewer-sidebar.tsx",
    ]) {
      expect(names).toContain(known);
    }
    const all = files.flatMap((f) => imgs(readFileSync(f, "utf8")));
    expect(all.length).toBeGreaterThanOrEqual(6);
  });

  it("each <img> in them names the note", () => {
    const missing = files.flatMap((f) =>
      imgs(readFileSync(f, "utf8"))
        .filter((img) => !/alt=\{[^}]*\bnote\b/.test(img))
        .map((img) => `${path.relative(ROOT, f)}: ${img.replace(/\s+/g, " ")}`),
    );
    expect(missing).toEqual([]);
  });

  it('positive control: an <img alt=""> in such a file is caught', () => {
    const img = '<img src={thumbnail.url} alt="" />';
    expect(imgs(img).filter((i) => !/alt=\{[^}]*\bnote\b/.test(i))).toEqual([
      img,
    ]);
  });
});

/**
 * A page canvas is inserted by hand (the Viewer, the editor's page and its
 * rail), so the `<img>` rule above cannot see it. Wherever such a canvas is
 * hidden from screen readers, it is hidden only when it carries no name:
 * the note drawn in a page's place names itself, and must stay heard.
 *
 * History (review r3, 2026-11-14): both consumers set `aria-hidden` on
 * every canvas `render` returned, note canvases included, and the Viewer's
 * page read as "Page 1" and nothing more. The consumer's view of it (the
 * name a screen reader gets, through buttons that make their contents
 * presentational) is proved in e2e/page-note-a11y.spec.ts.
 */
describe("a page canvas is hidden from screen readers only when it is not a note", () => {
  const ROOT = path.join(process.cwd(), "src/components");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
    });
  /** Each `X.setAttribute("aria-hidden"` in `src`, and whether a test of X's name guards it. */
  const hides = (src: string) =>
    [...src.matchAll(/(\w+)\.setAttribute\(\s*"aria-hidden"/g)].map((m) => {
      const before = src.slice(Math.max(0, m.index - 120), m.index);
      const guard = new RegExp(
        `if \\(!${m[1]}\\.hasAttribute\\("aria-label"\\)\\) \\{\\s*$`,
      );
      return { what: m[0], guarded: guard.test(before) };
    });
  // A file that draws pages: it calls a document's `.render(`.
  const drawing = walk(ROOT).filter((f) =>
    /\.render\(/.test(readFileSync(f, "utf8")),
  );

  it("health: the walk finds the Viewer's page and the editor's page canvas, each hiding a canvas", () => {
    const names = drawing
      .filter((f) => hides(readFileSync(f, "utf8")).length > 0)
      .map((f) => path.basename(f));
    expect(names).toEqual(
      expect.arrayContaining(["viewer-page.tsx", "page-canvas.tsx"]),
    );
  });

  it("every canvas hidden there is hidden only when it has no name", () => {
    const bare = drawing.flatMap((f) =>
      hides(readFileSync(f, "utf8"))
        .filter((h) => !h.guarded)
        .map((h) => `${path.relative(ROOT, f)}: ${h.what}`),
    );
    expect(bare).toEqual([]);
  });

  it("positive control: an unguarded hide is caught, a guarded one passes", () => {
    expect(hides('canvas.setAttribute("aria-hidden", "true");')).toEqual([
      { what: 'canvas.setAttribute("aria-hidden"', guarded: false },
    ]);
    expect(
      hides(
        'if (!canvas.hasAttribute("aria-label")) {\n  canvas.setAttribute("aria-hidden", "true");',
      ),
    ).toEqual([{ what: 'canvas.setAttribute("aria-hidden"', guarded: true }]);
  });
});
