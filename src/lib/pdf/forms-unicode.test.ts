// @native-canvas
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFTextField,
  decodePDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderPdfPages, type RenderedPage } from "@/tests/pdf-render";
import { applyFormValues } from "./forms";

/**
 * Audit fill-forms#6 (2026-11-06, re-measured 2026-11-22): a field value
 * outside the built-in PDF alphabet was refused for the whole run, so nobody
 * could type a name in Cyrillic, Greek, Bengali or Chinese. Now the field's
 * appearance is drawn with an embedded Unicode face. Every check reads the
 * SAVED file: the field's /V, the font its appearance stream names (embedded,
 * with a font program), and pdf.js's render of the field's rectangle.
 */

const VALUES = {
  cyrillic: "Иван",
  greek: "Ελένη",
  bengali: "রবীন্দ্রনাথ ঠাকুর",
  han: "王小明",
  central: "Łukasz Čapek",
  latin: "Ada Lovelace",
} as const;
type Key = keyof typeof VALUES;
const KEYS = Object.keys(VALUES) as Key[];

const PAGE = { width: 400, height: 600 };
const rectOf = (i: number) => ({
  x: 40,
  y: 520 - i * 60,
  width: 300,
  height: 30,
});

async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const form = doc.getForm();
  KEYS.forEach((key, i) => {
    form.createTextField(key).addToPage(page, { ...rectOf(i), borderWidth: 0 });
  });
  // An untouched field: its rect must render blank (the render's control).
  form
    .createTextField("blank")
    .addToPage(page, { ...rectOf(KEYS.length), borderWidth: 0 });
  return doc.save();
}

/** Dark pixels inside a page-space rect of the rendered page. */
function inkIn(
  page: RenderedPage,
  r: { x: number; y: number; width: number; height: number },
): number {
  const sx = page.width / PAGE.width;
  const sy = page.height / PAGE.height;
  let dark = 0;
  for (
    let y = Math.floor((PAGE.height - r.y - r.height) * sy);
    y < (PAGE.height - r.y) * sy;
    y++
  ) {
    for (let x = Math.floor(r.x * sx); x < (r.x + r.width) * sx; x++) {
      const i = (y * page.width + x) * 4;
      if (
        page.data[i]! < 140 &&
        page.data[i + 1]! < 140 &&
        page.data[i + 2]! < 140
      )
        dark++;
    }
  }
  return dark;
}

/** The font dictionaries the field's normal appearance names. */
function appearanceFonts(doc: PDFDocument, name: string): PDFDict[] {
  const field = doc.getForm().getTextField(name);
  const widget = field.acroField.getWidgets()[0]!;
  const normal = widget.getAppearances()!.normal as PDFStream;
  const resources = normal.dict.lookup(PDFName.of("Resources"), PDFDict);
  const fonts = resources.lookup(PDFName.of("Font"), PDFDict);
  return fonts.keys().map((k) => fonts.lookup(k, PDFDict));
}

/** Whether a font dictionary carries an embedded program (FontFile2/3). */
function embedded(doc: PDFDocument, font: PDFDict): boolean {
  const descendants = font.lookup(PDFName.of("DescendantFonts"));
  const leaf =
    descendants && "asArray" in (descendants as object)
      ? (doc.context.lookup(
          (descendants as unknown as { asArray(): PDFRef[] }).asArray()[0]!,
        ) as PDFDict)
      : font;
  const descriptor = leaf.lookup(PDFName.of("FontDescriptor"));
  if (!(descriptor instanceof PDFDict)) return false;
  return ["FontFile", "FontFile2", "FontFile3"].some(
    (k) => descriptor.get(PDFName.of(k)) !== undefined,
  );
}

describe("non-Latin values in form fields (audit fill-forms#6)", () => {
  it("writes the exact Unicode value, draws it with an embedded face, and pdf.js shows the glyphs", async () => {
    const result = await applyFormValues(await formPdf(), { ...VALUES });
    expect(
      result.outcomes.map((o) => [o.name, o.status, o.detail ?? ""]),
    ).toEqual(KEYS.map((k) => [k, "applied", ""]));

    const doc = await PDFDocument.load(result.bytes);
    for (const key of KEYS) {
      const field = doc.getForm().getField(key) as PDFTextField;
      // /V: the exact string, not a transliteration or question marks.
      expect(field.getText(), key).toBe(VALUES[key]);
      const fonts = appearanceFonts(doc, key);
      expect(fonts.length, key).toBeGreaterThan(0);
      if (key === "latin") continue;
      // The non-Latin appearances use an EMBEDDED face (a standard
      // Helvetica has no program and no glyphs for these letters).
      expect(
        fonts.some((f) => embedded(doc, f)),
        key,
      ).toBe(true);
    }

    const [page] = await renderPdfPages(result.bytes, 800);
    for (const [i, key] of KEYS.entries()) {
      expect(inkIn(page!, rectOf(i)), key).toBeGreaterThan(40);
    }
    // Control: the untouched field's rect is blank, so ink above is the value.
    expect(inkIn(page!, rectOf(KEYS.length))).toBe(0);
  });

  it("a reader regenerating the field finds the same face: /DA names it and /DR holds it", async () => {
    const result = await applyFormValues(await formPdf(), {
      cyrillic: VALUES.cyrillic,
    });
    const doc = await PDFDocument.load(result.bytes);
    const field = doc.getForm().getTextField("cyrillic");
    const da = field.acroField.getDefaultAppearance() ?? "";
    const fontName = /\/(\S+)\s+[\d.]+\s+Tf/.exec(da)?.[1];
    expect(fontName, da).toBeDefined();
    const dr = doc
      .getForm()
      .acroForm.dict.lookup(PDFName.of("DR"), PDFDict)
      .lookup(PDFName.of("Font"), PDFDict);
    const font = dr.lookup(PDFName.of(fontName!), PDFDict);
    expect(embedded(doc, font)).toBe(true);
    // Control: an untouched Latin field keeps the form's Helvetica.
    expect(
      doc.getForm().getTextField("latin").acroField.getDefaultAppearance(),
    ).not.toContain(fontName!);
  });

  it("the filled and flattened copy still shows the glyphs", async () => {
    const result = await applyFormValues(
      await formPdf(),
      { cyrillic: VALUES.cyrillic, bengali: VALUES.bengali },
      { flatten: true },
    );
    expect(result.flattened).toBe(true);
    const [page] = await renderPdfPages(result.bytes, 800);
    expect(inkIn(page!, rectOf(KEYS.indexOf("cyrillic")))).toBeGreaterThan(40);
    expect(inkIn(page!, rectOf(KEYS.indexOf("bengali")))).toBeGreaterThan(40);
  });

  it("right-to-left text is still refused for that field, in words, and the others are filled", async () => {
    const result = await applyFormValues(await formPdf(), {
      cyrillic: VALUES.cyrillic,
      latin: "مرحبا",
    });
    const byName = new Map(result.outcomes.map((o) => [o.name, o]));
    expect(byName.get("cyrillic")!.status).toBe("applied");
    expect(byName.get("latin")!.status).toBe("invalid");
    expect(byName.get("latin")!.detail).toMatch(/Arabic/);
    const doc = await PDFDocument.load(result.bytes);
    // Left exactly as it came.
    expect(doc.getForm().getTextField("latin").getText()).toBeUndefined();
  });

  it("decodes the appearance stream text as glyph ids, never an empty string", async () => {
    const result = await applyFormValues(await formPdf(), { han: VALUES.han });
    const doc = await PDFDocument.load(result.bytes);
    const widget = doc.getForm().getTextField("han").acroField.getWidgets()[0]!;
    const normal = widget.getAppearances()!.normal as PDFRawStream;
    const ops = new TextDecoder().decode(decodePDFRawStream(normal).decode());
    const shown = /<([0-9A-Fa-f]+)>\s*Tj/.exec(ops);
    expect(shown, ops).not.toBeNull();
    // Three characters, two bytes each in an Identity-H face.
    expect(shown![1]!.length).toBe(12);
  });
});
