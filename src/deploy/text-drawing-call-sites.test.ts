// @vitest-environment node
/**
 * Every place this codebase puts text on a page goes through the one font
 * chooser — DISCOVERED, not listed.
 *
 * A named list cannot see a file it does not name, and this exact set has been
 * mis-carried twice in one day: a hand-written list of eight text-drawing
 * modules was short by `watermark.ts`, and the list before it was short by two.
 * So nothing here is typed. The set is derived by scanning `src/` for the
 * pdf-lib text APIs themselves, and the assertion is that each file that uses
 * one gets its font from `unicode-font.ts` — directly or through `stamp.ts`.
 *
 * WHY IT MATTERS. A module that calls `doc.embedFont(StandardFonts.Helvetica)`
 * on its own is a module that can encode WinAnsi and nothing else. Adding one
 * is how the product would quietly regain a tool that cannot write Chinese, in
 * a release whose notes say Chinese now works.
 *
 * THE SECOND DIRECTION, which is the half a scanner usually skips: the detector
 * is exercised against sources that MUST trip it and sources that must not, so
 * a pattern that stopped matching anything fails here instead of reporting a
 * clean scan of nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/**
 * The pdf-lib calls that put glyphs on a page or measure them for placement.
 *
 * Measurement counts: `widthOfTextAtSize` on the wrong font puts every line
 * break in the wrong place even when the drawing itself is fine, so a module
 * that measures with a standard face and draws with a Unicode one is broken in
 * a way no rendering check would see.
 */
const TEXT_API = [
  /\.drawText\s*\(/,
  /\bStandardFonts\b/,
  /\.embedFont\s*\(/,
  /\.widthOfTextAtSize\s*\(/,
  /\.heightAtSize\s*\(/,
];

/** Imports that mean "this module asked the chooser for its font". */
const ROUTED = [
  /from\s+["'][^"']*\/unicode-font["']/,
  /from\s+["'][^"']*\/stamp["']/,
  /from\s+["']\.\/unicode-font["']/,
  /from\s+["']\.\/stamp["']/,
];

/**
 * The chooser and its parts. Not an exemption list for call sites — these are
 * the modules the rule is ABOUT, and `unicode-font.ts` is the only one allowed
 * to name a standard face.
 */
const CHOOSER = new Set(
  ["src/lib/pdf/unicode-font.ts", "src/lib/pdf/stamp.ts"].map((rel) =>
    path.join(ROOT, rel),
  ),
);

/** All non-test `.ts`/`.tsx` under `src/`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function usesTextApi(source: string): boolean {
  return TEXT_API.some((re) => re.test(source));
}

function isRouted(source: string): boolean {
  return ROUTED.some((re) => re.test(source));
}

const files = walk(SRC);
const drawing = files.filter((file) =>
  usesTextApi(stripComments(readFileSync(file, "utf8"))),
);

describe("text-drawing call sites", () => {
  it("the scan found a plausible number of them", () => {
    // Bounded in BOTH directions. Too few means the patterns stopped matching
    // and every assertion below passes over an empty set; too many means the
    // scan widened into something it was not asking about, and a guard that
    // fails for the wrong reason gets deleted. Nine modules draw text today.
    expect(files.length).toBeGreaterThan(50);
    expect(
      drawing.length,
      "the text-API scan matched almost nothing — the patterns are stale and this guard is checking an empty set",
    ).toBeGreaterThanOrEqual(8);
    expect(drawing.length).toBeLessThan(30);
  });

  it("finds the modules that are known to draw text", () => {
    // A positive control on the SET, not on the predicate: if the scanner ever
    // stops seeing one of these, it has stopped answering the question it
    // claims to, and a clean report would be the loudest possible lie.
    //
    // Note what is NOT here. `stamp.ts` was on every hand-carried version of
    // this list and no longer touches a pdf-lib text API at all — it delegates
    // to the chooser, so it is correctly no longer a call site. The set is
    // eight tool modules plus `unicode-font.ts`, which is the only module in
    // the repo allowed to name a face.
    const relative = drawing.map((f) =>
      path.relative(ROOT, f).split(path.sep).join("/"),
    );
    for (const expected of [
      "src/lib/pdf/annotate.ts",
      "src/lib/pdf/edit.ts",
      "src/lib/pdf/header-footer.ts",
      "src/lib/pdf/markdown-to-pdf.ts",
      "src/lib/pdf/page-numbers.ts",
      "src/lib/pdf/signature.ts",
      "src/lib/pdf/text-to-pdf.ts",
      "src/lib/pdf/unicode-font.ts",
      "src/lib/pdf/watermark.ts",
    ]) {
      expect(relative, `${expected} is no longer discovered`).toContain(
        expected,
      );
    }
  });

  it("every one of them gets its font from the chooser", () => {
    const unrouted = drawing
      .filter((file) => !CHOOSER.has(file))
      .filter((file) => !isRouted(stripComments(readFileSync(file, "utf8"))))
      .map((file) => path.relative(ROOT, file));
    expect(
      unrouted,
      "these modules draw or measure text without going through `embedDrawingFont`/`embedStampFont`, so they can encode WinAnsi and nothing else — no Chinese, Japanese, Korean, Bengali, Cyrillic, Greek or Devanagari",
    ).toEqual([]);
  });

  it("only the chooser names a built-in standard face", () => {
    // One definition of "which standard font", so a second copy cannot start
    // drifting. This is the check that catches a new module doing the obvious
    // thing.
    const offenders = files
      .filter((file) => !CHOOSER.has(file))
      .filter((file) =>
        /\bStandardFonts\b/.test(stripComments(readFileSync(file, "utf8"))),
      )
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("the detector actually detects — and does not fire on everything", () => {
    // `[] ⊆ X` is vacuously true, so the predicate is failed on purpose.
    expect(usesTextApi("page.drawText('hi', { x: 0 })")).toBe(true);
    expect(usesTextApi("await doc.embedFont(StandardFonts.Helvetica)")).toBe(
      true,
    );
    expect(usesTextApi("font.widthOfTextAtSize(s, 12)")).toBe(true);
    expect(usesTextApi("font.heightAtSize(12)")).toBe(true);
    // A module that only reads text out of a PDF is not a drawing site — this
    // is why `pdf/text.ts` (pdfjs extraction) is not in the set.
    expect(usesTextApi("const items = await page.getTextContent()")).toBe(
      false,
    );
    expect(usesTextApi("export const label = 'draw text later'")).toBe(false);

    expect(isRouted('import { embedStampFont } from "./stamp";')).toBe(true);
    expect(isRouted('import { embedDrawingFont } from "./unicode-font";')).toBe(
      true,
    );
    expect(isRouted('import { PDFDocument } from "pdf-lib";')).toBe(false);
  });
});

describe("the AcroForm family, which draws text WITHOUT calling drawText", () => {
  /**
   * pdf-lib generates a form field's appearance stream itself — inside
   * `setText`, `flatten()` and, implicitly, `save()` — using the form's own
   * Helvetica. None of those spellings appears in the scan above, which is
   * precisely why they were missed by every hand-carried list: they are text
   * drawing that never mentions text drawing.
   *
   * They are NOT fixed by the Unicode chooser. They refuse, which is correct,
   * and `assertFormFieldTextDrawable` makes the refusal say so in words instead
   * of leaking `WinAnsi cannot encode "গ" (0x0997)` out of `save()`. This test
   * is the tie that stops a new AcroForm call site from shipping without it.
   */
  const FORM_API = [
    /\.setText\s*\(/,
    /\.flatten\s*\(\s*\)/,
    /getForm\s*\(\s*\)/,
  ];

  const formFiles = files.filter((file) => {
    const source = stripComments(readFileSync(file, "utf8"));
    return FORM_API.some((re) => re.test(source));
  });

  it("finds the AcroForm writers", () => {
    expect(
      formFiles.length,
      "the AcroForm scan matched nothing — its patterns are stale",
    ).toBeGreaterThanOrEqual(3);
    const relative = formFiles.map((f) =>
      path.relative(ROOT, f).split(path.sep).join("/"),
    );
    for (const expected of [
      "src/lib/pdf/forms.ts",
      "src/lib/pdf/create-forms.ts",
      "src/lib/pdf/flatten.ts",
    ]) {
      expect(relative).toContain(expected);
    }
  });

  it("every AcroForm writer refuses in words rather than leaking a library error", () => {
    const silent = formFiles
      .filter((file) => {
        const source = stripComments(readFileSync(file, "utf8"));
        // Only the modules that WRITE a value or flatten one need the guard;
        // reading a form's shape draws nothing.
        const writes =
          /\.setText\s*\(/.test(source) || /\.flatten\s*\(\s*\)/.test(source);
        if (!writes) return false;
        return !/assertFormFieldTextDrawable/.test(source);
      })
      .map((file) => path.relative(ROOT, file));
    expect(
      silent,
      'these modules write text into an AcroForm field, where pdf-lib regenerates the appearance with its built-in Helvetica. Without `assertFormFieldTextDrawable` the user gets `WinAnsi cannot encode "গ" (0x0997)` out of save(), with nothing naming the field or the limit',
    ).toEqual([]);
  });
});
