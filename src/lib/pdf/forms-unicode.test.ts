// @native-canvas
import {
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFTextField,
  decodePDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { toolContent } from "@/lib/tools/content";
import { renderPdfPages, type RenderedPage } from "@/tests/pdf-render";
import { flattenPdf } from "./flatten";
import { applyFormValues } from "./forms";
import { embedDrawingFont } from "./unicode-font";

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

  it("a list box whose OPTIONS are Bengali gets the embedded face even when the choice is Latin", async () => {
    // Review finding 8 (2026-11-28): a list box's appearance lists every
    // option, so the face is chosen from the options too. Dropping them from
    // that choice (`? shown`) left every other test green while this field
    // went to Helvetica and failed inside save().
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.width, PAGE.height]);
    const form = doc.getForm();
    const list = form.createOptionList("district");
    list.addOptions(["Dhaka", "Chattogram"]);
    list.addToPage(page, { ...rectOf(0), height: 80, borderWidth: 0 });
    await doc.save();
    list.acroField.dict.set(
      PDFName.of("Opt"),
      doc.context.obj([
        PDFHexString.fromText("Dhaka"),
        PDFHexString.fromText("ঢাকা"),
      ]),
    );
    form.markFieldAsClean(list.ref);
    const input = await doc.save({ updateFieldAppearances: false });

    const result = await applyFormValues(input, { district: "Dhaka" });
    expect(result.outcomes.map((o) => [o.name, o.status])).toEqual([
      ["district", "applied"],
    ]);
    const out = await PDFDocument.load(result.bytes);
    const widget = out.getForm().getOptionList("district").acroField;
    const normal = widget.getWidgets()[0]!.getAppearances()!
      .normal as PDFStream;
    const fonts = normal.dict
      .lookup(PDFName.of("Resources"), PDFDict)
      .lookup(PDFName.of("Font"), PDFDict);
    expect(
      fonts.keys().some((k) => embedded(out, fonts.lookup(k, PDFDict))),
    ).toBe(true);
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

/**
 * Review finding 2 (2026-11-28): many real forms carry /NeedAppearances true,
 * which tells a reader to redraw every field from its /V and /DA. pdf.js then
 * redrew a Bengali answer from the SUBSET face without shaping (cut short,
 * gaps, a wrong vowel sign), and Flatten PDF refused the file Fill Forms had
 * just made. Now a run that writes an embedded face into such a form draws
 * every field's appearance itself and clears the flag, so readers show what
 * was drawn. The other fields' values must survive that: a field the run did
 * not touch, whose answer lived only in /V, gets its appearance drawn too.
 */
async function needAppearancesForm(flag: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const form = doc.getForm();
  form.createTextField("answer").addToPage(page, {
    ...rectOf(0),
    borderWidth: 0,
  });
  const prior = form.createTextField("prior");
  prior.setText("");
  prior.addToPage(page, { ...rectOf(1), borderWidth: 0 });
  await doc.save(); // writes the blank appearances
  prior.acroField.dict.set(
    PDFName.of("V"),
    PDFHexString.fromText("Ada Lovelace"),
  );
  form.markFieldAsClean(prior.ref);
  if (flag) form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  return doc.save({ updateFieldAppearances: false });
}

/** Pixels that differ between two renders inside a page-space rect. */
function pixelsDiffering(
  a: RenderedPage,
  b: RenderedPage,
  r: { x: number; y: number; width: number; height: number },
): number {
  const sx = a.width / PAGE.width;
  const sy = a.height / PAGE.height;
  let differing = 0;
  for (
    let y = Math.floor((PAGE.height - r.y - r.height) * sy);
    y < (PAGE.height - r.y) * sy;
    y++
  ) {
    for (let x = Math.floor(r.x * sx); x < (r.x + r.width) * sx; x++) {
      const i = (y * a.width + x) * 4;
      if (
        Math.abs(a.data[i]! - b.data[i]!) > 60 ||
        Math.abs(a.data[i + 1]! - b.data[i + 1]!) > 60
      )
        differing++;
    }
  }
  return differing;
}

const NA_ANSWER = "রহিম কিশোর ক্ষমা";

describe("a form flagged /NeedAppearances (review finding 2)", () => {
  it("fixture health: the flag is set, and the prior answer lives only in /V", async () => {
    const doc = await PDFDocument.load(await needAppearancesForm(true));
    const flag = doc.getForm().acroForm.dict.get(PDFName.of("NeedAppearances"));
    expect(flag).toBe(PDFBool.True);
    expect(doc.getForm().getTextField("prior").getText()).toBe("Ada Lovelace");
  });

  it("clears the flag, so pdf.js shows the drawn answer: the same pixels as on an unflagged form", async () => {
    const flagged = await applyFormValues(await needAppearancesForm(true), {
      answer: NA_ANSWER,
    });
    const plain = await applyFormValues(await needAppearancesForm(false), {
      answer: NA_ANSWER,
    });
    const doc = await PDFDocument.load(flagged.bytes);
    expect(
      doc.getForm().acroForm.dict.get(PDFName.of("NeedAppearances")),
    ).not.toBe(PDFBool.True);
    const [a] = await renderPdfPages(flagged.bytes, 800);
    const [b] = await renderPdfPages(plain.bytes, 800);
    // Health: the answer is drawn at all.
    expect(inkIn(b!, rectOf(0))).toBeGreaterThan(40);
    expect(pixelsDiffering(a!, b!, rectOf(0))).toBe(0);
    // The untouched field's answer, once only in /V, is drawn too: clearing
    // the flag without drawing it would blank it in every reader.
    expect(inkIn(a!, rectOf(1))).toBeGreaterThan(40);
    expect(doc.getForm().getTextField("prior").getText()).toBe("Ada Lovelace");
  });

  it("control: a Latin-only run on a flagged form leaves the flag as it was", async () => {
    const result = await applyFormValues(await needAppearancesForm(true), {
      answer: "Rahim",
    });
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getForm().acroForm.dict.get(PDFName.of("NeedAppearances"))).toBe(
      PDFBool.True,
    );
  });

  it("chain: Flatten PDF flattens the file Fill Forms made, with both answers on the page", async () => {
    const filled = await applyFormValues(await needAppearancesForm(true), {
      answer: NA_ANSWER,
    });
    const flat = await flattenPdf(filled.bytes);
    expect(flat.flattenedFields).toBe(2);
    expect(flat.skipped).toEqual([]);
    const [page] = await renderPdfPages(flat.bytes, 800);
    expect(inkIn(page!, rectOf(0))).toBeGreaterThan(40);
    expect(inkIn(page!, rectOf(1))).toBeGreaterThan(40);
  });
});

/**
 * Review finding 3 (2026-11-28): the shaper picks the right glyphs for a
 * Bengali conjunct and asks for some marks to be moved (GPOS offsets), but
 * pdf-lib draws every glyph at its advance with no offset, so a few joined
 * letters show a mark out of place. An ink count cannot see that. This pins
 * the RELATIONSHIP instead: while the drawn stream carries no positioning,
 * the page says so in plain words; whoever teaches the engine offsets turns
 * this red and must change both.
 */
describe("joined letters: the limit is stated while the engine has it", () => {
  it("the shaper asks for offsets, the stream draws none, and the FAQ says marks may be out of place", async () => {
    const word = "রবীন্দ্রনাথ";
    const scratch = await PDFDocument.create();
    const face = await embedDrawingFont(scratch, [word]);
    const shaper = (
      face as unknown as {
        embedder: {
          font: {
            layout(t: string): {
              positions: { xOffset: number; yOffset: number }[];
            };
          };
        };
      }
    ).embedder.font;
    const offsets = shaper
      .layout(word)
      .positions.filter((p) => p.xOffset !== 0 || p.yOffset !== 0);
    // Health: the shaper really does want a mark moved in this word.
    expect(offsets.length).toBeGreaterThan(0);

    const result = await applyFormValues(await formPdf(), { bengali: word });
    const doc = await PDFDocument.load(result.bytes);
    const widget = doc.getForm().getTextField("bengali").acroField;
    const normal = widget.getWidgets()[0]!.getAppearances()!
      .normal as PDFRawStream;
    const ops = new TextDecoder().decode(decodePDFRawStream(normal).decode());
    expect(ops).toMatch(/<[0-9A-Fa-f]+>\s*Tj/);
    // No TJ array with adjustments: every glyph at its plain advance.
    expect(ops).not.toMatch(/\]\s*TJ/);

    const faq = JSON.stringify(toolContent["fill-forms"]);
    expect(faq).toMatch(
      /some joined letters may be drawn with a mark slightly out of place/,
    );
  });
});

describe("the shared refusal stops saying no field can carry these letters", () => {
  /** What the refusal shipped until 2026-11-28, word for word. */
  const SHIPPED = [
    "The stamping tools (watermark, page numbers, header/footer, notes, signature) do embed a Unicode font and can draw them — a fillable field cannot yet, because a PDF reader regenerates its appearance from the form's own font.",
  ];
  const BAN = /\bfillable field\s+cannot\b/;

  it("the ban catches what shipped; Flatten's refusal of a third-party flagged form now names Fill Forms", async () => {
    for (const s of SHIPPED) expect(BAN.test(s), s).toBe(true);
    // A Bengali answer some other tool left only in /V, on a flagged form:
    // Flatten must redraw it with the form's font, so it still refuses.
    const doc = await PDFDocument.load(await needAppearancesForm(true));
    doc
      .getForm()
      .getTextField("prior")
      .acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("ঢাকা"));
    const input = await doc.save({ updateFieldAppearances: false });
    const message = await flattenPdf(input).then(
      () => "",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(message).toMatch(/outside it: .*ঢ/);
    expect(message).not.toMatch(BAN);
    expect(message).toMatch(/Fill Forms can type them into a field/);
  });
});
