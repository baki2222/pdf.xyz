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
import * as pdfLib from "pdf-lib";
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

/** The `.test.ts(x)` files under `dir` — the modules `walk` leaves out. */
function walkTests(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTests(full));
    else if (/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full);
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
  /**
   * WHICH spellings make pdf-lib draw field text is DERIVED from pdf-lib, not
   * typed. The hand-typed pair this replaced (`.setText(`, `.flatten()`) lost a
   * member the day `flatten.ts` stopped calling `form.flatten()` and started
   * drawing through `field.defaultUpdateAppearances(font)` and
   * `form.markFieldAsDirty(...)`: the file fell out of the writer set, and a
   * neutered `assertFormFieldTextDrawable` stayed green (7/7). A list of names
   * cannot see a spelling it does not name.
   *
   * The derivation is a call graph over pdf-lib's own prototypes:
   *  - SEEDS, found by the shape of their body, not their name: the method that
   *    builds an appearance stream WITH A FONT, and the method that queues a
   *    field for regeneration at `save()` (`dirtyFields.add`).
   *  - CLASSES: the document, the form, the field base, and every field type
   *    that has a method calling a font seed. A checkbox or radio draws an
   *    on/off glyph, never field text, so its `check()` is not a writer — that
   *    exclusion is what keeps the set from widening into `[].check()`.
   *  - CLOSURE: any method of those classes whose body calls a member joins.
   */
  const FORM_LIB = pdfLib as unknown as Record<string, unknown>;
  const DRAWS_WITH_FONT = /\.createAppearanceStream\([^;]*\bfont\b/;
  const QUEUES_REDRAW = /\.dirtyFields\.add\(/;

  interface LibMethod {
    owner: string;
    name: string;
    body: string;
  }

  function calls(source: string, name: string): boolean {
    return new RegExp(`\\.${name}\\s*\\(`).test(source);
  }

  function ownMethods(owner: string, ctor: unknown): LibMethod[] {
    const proto = (ctor as { prototype: object }).prototype;
    return Object.getOwnPropertyNames(proto).flatMap((name) => {
      if (name === "constructor") return [];
      const value = Object.getOwnPropertyDescriptor(proto, name)?.value;
      return typeof value === "function"
        ? [{ owner, name, body: String(value) }]
        : [];
    });
  }

  const formClasses = Object.entries(FORM_LIB).filter(
    ([, value]) =>
      typeof value === "function" &&
      (value === pdfLib.PDFDocument ||
        value === pdfLib.PDFForm ||
        value === pdfLib.PDFField ||
        (value as { prototype: unknown }).prototype instanceof pdfLib.PDFField),
  );
  const formMethods = formClasses.flatMap(([owner, ctor]) =>
    ownMethods(owner, ctor),
  );
  const seeds = formMethods.filter(
    (m) => DRAWS_WITH_FONT.test(m.body) || QUEUES_REDRAW.test(m.body),
  );
  const fontSeeds = seeds.filter((m) => DRAWS_WITH_FONT.test(m.body));
  const GENERIC = new Set(["PDFDocument", "PDFForm", "PDFField"]);
  const textClasses = new Set(
    formClasses
      .map(([owner]) => owner)
      .filter(
        (owner) =>
          GENERIC.has(owner) ||
          formMethods.some(
            (m) =>
              m.owner === owner &&
              fontSeeds.some((seed) => calls(m.body, seed.name)),
          ),
      ),
  );
  const candidates = formMethods.filter((m) => textClasses.has(m.owner));

  const REGENERATING = new Set(seeds.map((m) => m.name));
  for (let grew = true; grew;) {
    grew = false;
    for (const m of candidates) {
      if (REGENERATING.has(m.name)) continue;
      if ([...REGENERATING].some((name) => calls(m.body, name))) {
        REGENERATING.add(m.name);
        grew = true;
      }
    }
  }

  /** Does this (comment-stripped) source make pdf-lib draw field text? */
  function writes(source: string): boolean {
    return [...REGENERATING].some((name) => calls(source, name));
  }

  /**
   * The ways into the form API. `getForm()` is how a document hands one out;
   * the rest are the writer spellings distinctive enough to scan the whole tree
   * for (a bare `.select(` or `.save(` would sweep in every DOM input). Each of
   * them must be a member of the DERIVED set — checked below — so this list
   * cannot name something that does not regenerate.
   */
  const FORM_ENTRY_METHODS = [
    "setText",
    "flatten",
    "defaultUpdateAppearances",
    "updateFieldAppearances",
    "markFieldAsDirty",
  ];

  function touchesForms(source: string): boolean {
    return (
      /getForm\s*\(\s*\)/.test(source) ||
      FORM_ENTRY_METHODS.some((name) => calls(source, name))
    );
  }

  const formFiles = files.filter((file) =>
    touchesForms(stripComments(readFileSync(file, "utf8"))),
  );

  it("derives pdf-lib's appearance-regenerating API — and nothing wider", () => {
    // Health: the shape predicates still see pdf-lib. If a pdf-lib upgrade
    // renames either seed's internals, this goes red HERE rather than the set
    // quietly collapsing to nothing and every writer passing.
    expect(formClasses.length).toBeGreaterThanOrEqual(8);
    expect(seeds.map((m) => m.name).sort()).toEqual([
      "markFieldAsDirty",
      "updateWidgetAppearanceWithFont",
    ]);
    expect(textClasses).toContain("PDFTextField");
    expect(textClasses).toContain("PDFDropdown");
    expect(textClasses).toContain("PDFOptionList");
    expect(textClasses).not.toContain("PDFCheckBox");
    expect(textClasses).not.toContain("PDFRadioGroup");

    // Bounded both ways: 24 today.
    expect(REGENERATING.size).toBeGreaterThanOrEqual(12);
    expect(REGENERATING.size).toBeLessThan(45);

    // Positive control: every spelling any hand-carried version of this guard
    // named, plus the ones `flatten.ts` draws through, plus `save()` itself.
    for (const name of [
      "setText",
      "flatten",
      "save",
      "defaultUpdateAppearances",
      "updateFieldAppearances",
      "markFieldAsDirty",
      "addToPage",
    ]) {
      expect(REGENERATING, `${name} is not derived`).toContain(name);
    }
    // Negative control: reading a form draws nothing, and an on/off field's
    // state change draws no text.
    for (const name of [
      "getForm",
      "getFields",
      "getText",
      "needsAppearancesUpdate",
      "check",
      "uncheck",
      "markFieldAsClean",
    ]) {
      expect(REGENERATING, `${name} should not be a writer`).not.toContain(
        name,
      );
    }
    // The entry spellings are a subset of the derived set, never a free list.
    for (const name of FORM_ENTRY_METHODS) {
      expect(REGENERATING).toContain(name);
    }
  });

  it("finds the AcroForm writers", () => {
    expect(
      formFiles.length,
      "the AcroForm scan matched nothing — its patterns are stale",
    ).toBeGreaterThanOrEqual(3);
    expect(formFiles.length).toBeLessThan(20);
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

  it("the writer predicate classifies the modules as they are written TODAY", () => {
    // A positive control on the real subject, not on a snippet: flatten.ts
    // draws through `defaultUpdateAppearances` and `markFieldAsDirty`, and the
    // predicate must say so — this is exactly the file that fell out.
    const flatten = stripComments(
      readFileSync(path.join(SRC, "lib/pdf/flatten.ts"), "utf8"),
    );
    expect(writes(flatten)).toBe(true);

    expect(writes("form.markFieldAsDirty(field.ref)")).toBe(true);
    expect(writes("field.defaultUpdateAppearances(font)")).toBe(true);
    expect(writes("form.updateFieldAppearances()")).toBe(true);
    expect(writes("form.flatten({ updateFieldAppearances: true })")).toBe(true);
    expect(writes("const out = await doc.save()")).toBe(true);
    expect(writes("const fields = form.getFields()")).toBe(false);
    expect(writes("const value = field.getText()")).toBe(false);
  });

  /**
   * `src/tests/` holds test SUPPORT — fixture builders a test imports. A module
   * there that writes a form (`unflattenable-form-pdf.ts` builds the orphan-
   * widget form Fill forms is tested on) draws text no user ever supplied, so
   * "the user gets `WinAnsi cannot encode`" is not a claim about it. Added
   * 2026-09-27 where this guard (L11) met that fixture (L12, merged beside it):
   * the walk is every non-test file, and the fixture landed in the writer set.
   *
   * The exclusion is a FACT checked below, not an exemption: no shipped module
   * imports anything under `src/tests/`, found by resolving every import in
   * the tree — so nothing a user runs can reach a module it skips.
   */
  const TEST_SUPPORT = path.join(SRC, "tests") + path.sep;
  const isTestSupport = (file: string) => file.startsWith(TEST_SUPPORT);

  /** Every module path `source` imports, resolved (aliases and relatives). */
  function importTargets(file: string, source: string): string[] {
    const specs = [
      ...source.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
    ].map((m) => m[1]!);
    return specs.flatMap((spec) => {
      if (spec.startsWith("@/")) return [path.join(SRC, spec.slice(2))];
      if (spec.startsWith(".")) return [path.resolve(path.dirname(file), spec)];
      return [];
    });
  }

  it("test-support modules are unreachable from shipped code (the exclusion's premise)", () => {
    const shipped = files.filter((file) => !isTestSupport(file));
    const reaching = shipped.flatMap((file) =>
      importTargets(file, stripComments(readFileSync(file, "utf8")))
        .filter(
          (target) => isTestSupport(target + path.sep) || isTestSupport(target),
        )
        .map(
          (target) =>
            `${path.relative(ROOT, file)} -> ${path.relative(ROOT, target)}`,
        ),
    );
    expect(reaching, "a shipped module imports test support").toEqual([]);
    // POSITIVE CONTROL: the same resolver sees the tests that DO import it,
    // so an empty list above is not a resolver that sees nothing.
    const testFiles = walkTests(SRC);
    const seen = testFiles.flatMap((file) =>
      importTargets(file, stripComments(readFileSync(file, "utf8"))).filter(
        (target) => isTestSupport(target),
      ),
    );
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(
      seen.some((target) => target.endsWith("unflattenable-form-pdf")),
    ).toBe(true);
    // And the exclusion is exercised: it skips a real module today, so it
    // is not a rule about nothing.
    expect(formFiles.some(isTestSupport)).toBe(true);
  });

  it("every AcroForm writer refuses in words rather than leaking a library error", () => {
    const writers = formFiles.filter(
      (file) =>
        !isTestSupport(file) &&
        writes(stripComments(readFileSync(file, "utf8"))),
    );
    // `[] ⊆ X` is vacuously true: at least the three known writers are in it.
    expect(writers.length).toBeGreaterThanOrEqual(3);
    const silent = writers
      .filter(
        (file) =>
          !/assertFormFieldTextDrawable/.test(
            stripComments(readFileSync(file, "utf8")),
          ),
      )
      .map((file) => path.relative(ROOT, file));
    expect(
      silent,
      'these modules make pdf-lib draw text into an AcroForm field with its built-in Helvetica. Without `assertFormFieldTextDrawable` the user gets `WinAnsi cannot encode "গ" (0x0997)` out of save(), with nothing naming the field or the limit',
    ).toEqual([]);
  });
});
