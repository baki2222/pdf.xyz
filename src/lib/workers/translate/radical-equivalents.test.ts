// @vitest-environment node
/**
 * The vendored Kangxi table and the ToUnicode rewrite, held to bounds that do
 * not come from the table itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseToUnicode } from "./pdf-readers";
import {
  isUnifiedIdeograph,
  kangxiRadicalsIn,
  normaliseRadicalToUnicode,
  RADICAL_EQUIVALENTS,
  RADICAL_GLYPH_FACTS,
  radicalRewritesFor,
  type RadicalGlyphFacts,
} from "./radical-equivalents";

/** The generic CMap-mechanics tests use the UCD table as "a table". */
const UCD = RADICAL_EQUIVALENTS;

const FIXTURES = path.join(import.meta.dirname, "fixtures");

/** Every Type 3 font's face and ToUnicode text in a fixture, as Skia wrote it. */
async function type3Maps(
  file: string,
): Promise<{ face: string | null; text: string }[]> {
  const doc = await PDFDocument.load(
    new Uint8Array(readFileSync(path.join(FIXTURES, file))),
    { updateMetadata: false },
  );
  const out: { face: string | null; text: string }[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Subtype")) !== PDFName.of("Type3")) continue;
    const ref = obj.get(PDFName.of("ToUnicode"));
    const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : null;
    const descriptor = obj.lookup(PDFName.of("FontDescriptor"));
    const name =
      descriptor instanceof PDFDict
        ? descriptor.get(PDFName.of("FontName"))
        : undefined;
    if (stream instanceof PDFRawStream)
      out.push({
        face:
          name instanceof PDFName
            ? name.decodeText().replace(/^[A-Z]{6}\+/, "")
            : null,
        text: Buffer.from(decodePDFRawStream(stream).decode()).toString(
          "latin1",
        ),
      });
  }
  return out;
}

describe("the table", () => {
  it("health: all 214 Kangxi radicals, each equal to its NFKC form — an independent second bound", () => {
    let kangxi = 0;
    for (let k = 0x2f00; k <= 0x2fd5; k++) {
      expect(RADICAL_EQUIVALENTS.has(k), k.toString(16)).toBe(true);
      expect(String.fromCodePoint(RADICAL_EQUIVALENTS.get(k)!)).toBe(
        String.fromCodePoint(k).normalize("NFKC"),
      );
      kangxi += 1;
    }
    expect(kangxi).toBe(214);
    expect(RADICAL_EQUIVALENTS.size).toBe(214);
  });

  it("the CJK Radicals Supplement is NOT rewritten (measured 2026-11-16: SC draws 彐 with ⺕'s glyph)", () => {
    for (let k = 0x2e80; k <= 0x2ef3; k++)
      expect(RADICAL_EQUIVALENTS.has(k)).toBe(false);
    // The real case from the live image: SC's 彐 glyph is mapped to U+2E95,
    // whose UCD equivalent U+2B739 is a different ideograph. Left alone.
    const cmap = "1 beginbfchar\n<CD> <2E95>\nendbfchar";
    expect(
      normaliseRadicalToUnicode(
        cmap,
        radicalRewritesFor("NotoSansCJKsc-Regular"),
      ),
    ).toBe(cmap);
    for (const table of Object.values(RADICAL_GLYPH_FACTS.faces))
      for (const r of Object.keys(table))
        expect(parseInt(r, 16) >= 0x2f00 && parseInt(r, 16) <= 0x2fd5, r).toBe(
          true,
        );
  });
});

describe("normaliseRadicalToUnicode", () => {
  it("on the REAL pre-rewrite zh probe: <92> <2F42> becomes <92> <6587>, nothing else moves", async () => {
    const maps = await type3Maps("zh-probe.pre-rewrite.pdf");
    const wen = maps.filter((m) => m.text.includes("<92> <2F42>"));
    // Health: the fixture still carries the defect it was captured for, and
    // names the face the table is derived for.
    expect(wen.length).toBeGreaterThan(0);
    for (const m of wen) {
      expect(m.face, "a Type 3 font with no descriptor face").not.toBe(null);
      const next = normaliseRadicalToUnicode(
        m.text,
        radicalRewritesFor(m.face!),
      );
      expect(next).toBe(m.text.replace("<92> <2F42>", "<92> <6587>"));
    }
    // A map holding no radical is byte-identical.
    const plain = maps.filter((m) => !/<2F[0-9A-D][0-9A-F]>/.test(m.text));
    expect(plain.length).toBeGreaterThan(0);
    for (const m of plain)
      expect(
        normaliseRadicalToUnicode(m.text, radicalRewritesFor(m.face ?? "")),
      ).toBe(m.text);
  });

  it("the post-rewrite fixtures carry no destination their face's table would rewrite", async () => {
    let fonts = 0;
    for (const f of ["zh-probe.pdf", "ja-probe.pdf", "ko-probe.pdf"])
      for (const m of await type3Maps(f)) {
        fonts += 1;
        const table = radicalRewritesFor(m.face ?? "");
        for (const t of parseToUnicode(m.text).values())
          for (const ch of t)
            expect(table.has(ch.codePointAt(0)!), `${f} ${ch}`).toBe(false);
      }
    expect(fonts).toBeGreaterThanOrEqual(6);
  });

  it("splits a bfrange whose run crosses a radical, and every code still maps one to one", () => {
    // 2FD4 and 2FD5 are radicals; 2FD6 and 2FD7 are not.
    const cmap =
      "2 beginbfrange\n<01> <04> <2FD4>\n<10> <12> <0041>\nendbfrange";
    const next = normaliseRadicalToUnicode(cmap, UCD);
    expect(next).toBe(
      "4 beginbfrange\n<01> <01> <9F9C>\n<02> <02> <9FA0>\n<03> <04> <2FD6>\n<10> <12> <0041>\nendbfrange",
    );
    // An independent reader of the result: no off-by-one at either seam.
    const read = parseToUnicode(next);
    expect([1, 2, 3, 4, 0x10, 0x11, 0x12].map((c) => read.get(c))).toEqual([
      "龜",
      "龠",
      "⿖",
      "⿗",
      "A",
      "B",
      "C",
    ]);
  });

  it("a radical in the middle of a run splits it in three", () => {
    const next = normaliseRadicalToUnicode(
      "1 beginbfrange\n<20> <22> <2EFF>\nendbfrange",
      UCD,
    );
    // 2EFF (unassigned) · 2F00 (radical ONE → 一) · 2F01 (radical LINE → 丨)
    const read = parseToUnicode(next);
    expect([0x20, 0x21, 0x22].map((c) => read.get(c))).toEqual([
      "⻿",
      "一",
      "丨",
    ]);
  });

  it("rewrites the array form of bfrange in place", () => {
    expect(
      normaliseRadicalToUnicode(
        "1 beginbfrange\n<05> <06> [<2F42> <0042>]\nendbfrange",
        UCD,
      ),
    ).toBe("1 beginbfrange\n<05> <06> [<6587> <0042>]\nendbfrange");
  });

  it("leaves a CMap with no radical byte-identical, and blocks with none untouched", () => {
    const cmap =
      "/CIDInit /ProcSet findresource begin\n2 beginbfchar\n<01> <0041>\n<02> <4E00>\nendbfchar\n1 beginbfrange\n<03> <05> <0061>\nendbfrange\nend";
    expect(normaliseRadicalToUnicode(cmap, UCD)).toBe(cmap);
    const mixed = `${cmap}\n1 beginbfchar\n<09> <2F00>\nendbfchar`;
    expect(normaliseRadicalToUnicode(mixed, UCD)).toBe(
      `${cmap}\n1 beginbfchar\n<09> <4E00>\nendbfchar`,
    );
  });

  it("keeps a block within 100 entries when a split grows it", () => {
    const entries = Array.from(
      { length: 99 },
      (_, i) =>
        `<${(i + 0x100).toString(16).toUpperCase()}> <${(i + 0x100).toString(16).toUpperCase()}> <0041>`,
    );
    const cmap = `100 beginbfrange\n${entries.join("\n")}\n<0300> <0302> <2F00>\nendbfrange`;
    const next = normaliseRadicalToUnicode(cmap, UCD);
    const counts = [...next.matchAll(/(\d+) beginbfrange/g)].map((m) =>
      Number(m[1]),
    );
    expect(counts).toEqual([100, 2]);
    const read = parseToUnicode(next);
    expect([0x300, 0x301, 0x302].map((c) => read.get(c))).toEqual([
      "一",
      "丨",
      "丶",
    ]);
  });
});

/**
 * The per-face table (review 2026-11-16). The first version rewrote U+2F3E
 * to its UCD equivalent 戶 U+6236 in every face, so pdf.js read SC 用户 as
 * 用戶 and JP 江戸 as 江戶: the glyph was 户 / 戸. These hold the table the
 * render pass USES to the PROPERTY (the face sends the target to the same
 * glyph), measured from the image's cmaps, and to the UCD as a second bound.
 */
describe("the per-face rewrite table, against measured cmap facts", () => {
  const faces = Object.keys(RADICAL_GLYPH_FACTS.faces);
  const sharers = (face: string, radical: number) =>
    (RADICAL_GLYPH_FACTS.faces[face]![radical.toString(16)] ?? "")
      .split(" ")
      .filter(Boolean)
      .map((h) => parseInt(h, 16));

  it("health: 30 faces, every one mapping all 214 radicals; the faces the fixtures were drawn with are among them", async () => {
    expect(faces.length).toBe(30);
    for (const face of faces)
      expect(Object.keys(RADICAL_GLYPH_FACTS.faces[face]!).length, face).toBe(
        214,
      );
    // Derived, not typed: every Type 3 face in the real fixtures.
    const drawn = new Set<string>();
    for (const f of [
      "zh-probe.pdf",
      "ja-probe.pdf",
      "ko-probe.pdf",
      "zh-radicals.printed.pdf",
      "ja-radicals.printed.pdf",
      "en-radical.printed.pdf",
    ])
      for (const m of await type3Maps(f)) drawn.add(m.face ?? "(none)");
    expect(drawn.size).toBeGreaterThanOrEqual(3);
    expect([...drawn].filter((face) => !faces.includes(face))).toEqual([]);
  });

  it("PROPERTY: every entry the render pass would use rewrites to the one unified ideograph sharing the radical's glyph in THAT face", () => {
    let entries = 0;
    for (const face of faces)
      for (const [radical, target] of radicalRewritesFor(face)) {
        entries += 1;
        expect(
          sharers(face, radical).filter(isUnifiedIdeograph),
          `${face} ${radical.toString(16)}`,
        ).toEqual([target]);
      }
    // Health: 30 faces × (203..214) entries.
    expect(entries).toBeGreaterThan(30 * 200);
  });

  it("SECOND BOUND: every derived target equals the UCD equivalent, except exactly U+2F3E in SC (户) and JP (戸)", () => {
    const disagree: string[] = [];
    for (const face of faces)
      for (const [radical, target] of radicalRewritesFor(face))
        if (UCD.get(radical) !== target)
          disagree.push(
            `${face} ${radical.toString(16)}->${target.toString(16)}`,
          );
    const expected = faces
      .filter((f) => /CJK(sc|jp)-/.test(f))
      .map((f) => `${f} 2f3e->${/CJKsc-/.test(f) ? "6237" : "6238"}`);
    expect(expected.length).toBe(12);
    expect(disagree.sort()).toEqual(expected.sort());
  });

  it("a radical whose glyph no unified ideograph shares is not rewritten (measured: Sans KR has 9)", () => {
    const kr = radicalRewritesFor("NotoSansCJKkr-Regular");
    const unshared = [...UCD.keys()].filter(
      (r) =>
        sharers("NotoSansCJKkr-Regular", r).filter(isUnifiedIdeograph)
          .length === 0,
    );
    expect(unshared.length).toBe(9);
    for (const r of unshared) expect(kr.has(r), r.toString(16)).toBe(false);
    expect(kr.size).toBe(214 - 9);
  });

  it("a face the facts do not name gets no rewrite", () => {
    expect(radicalRewritesFor("NotoSansCJKxx-Regular").size).toBe(0);
    expect(radicalRewritesFor("").size).toBe(0);
  });

  it("an ambiguous radical (two unified sharers) is left out — a synthetic face, since no measured face has one", () => {
    const facts: RadicalGlyphFacts = {
      faces: { F: { "2f3e": "6236 6237", "2f42": "6587 f9fe" } },
    };
    const t = radicalRewritesFor("F", new Set(), facts);
    expect(t.has(0x2f3e)).toBe(false);
    // A compatibility ideograph is not a candidate.
    expect(t.get(0x2f42)).toBe(0x6587);
  });

  it("the radicals the job's text contains are kept out of the table", () => {
    const keep = kangxiRadicalsIn("Mixed: \u2f42 and \u6587, \u2f08.");
    expect([...keep].sort()).toEqual([0x2f08, 0x2f42]);
    const t = radicalRewritesFor("NotoSansCJKsc-Regular", keep);
    expect(t.has(0x2f42)).toBe(false);
    expect(t.has(0x2f08)).toBe(false);
    expect(t.get(0x2f00)).toBe(0x4e00);
    // Health: without the keep set both are rewritten.
    const all = radicalRewritesFor("NotoSansCJKsc-Regular");
    expect(all.get(0x2f42)).toBe(0x6587);
    expect(all.get(0x2f08)).toBe(0x4eba);
  });
});

describe("the vendored facts' shape and the image check's diff", () => {
  it("compact → expand round-trips the vendored facts, and a changed entry is one named difference", async () => {
    const { compactFacts, diffRadicalGlyphFacts } =
      await import("./radical-glyph-measure");
    const compact = compactFacts(RADICAL_GLYPH_FACTS, "test");
    expect(compact.tables.length).toBe(10);
    expect(
      diffRadicalGlyphFacts(RADICAL_GLYPH_FACTS, RADICAL_GLYPH_FACTS),
    ).toEqual([]);
    const changed: RadicalGlyphFacts = {
      faces: {
        ...RADICAL_GLYPH_FACTS.faces,
        "NotoSansCJKsc-Regular": {
          ...RADICAL_GLYPH_FACTS.faces["NotoSansCJKsc-Regular"],
          "2f3e": "6236",
        },
      },
    };
    expect(diffRadicalGlyphFacts(RADICAL_GLYPH_FACTS, changed)).toEqual([
      "NotoSansCJKsc-Regular 2f3e: vendored [6237] measured [6236]",
    ]);
  });
});
