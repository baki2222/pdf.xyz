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
  isExtensionA,
  isRadical,
  isUnifiedIdeograph,
  normaliseRadicalToUnicode,
  RADICAL_EQUIVALENTS,
  RADICAL_GLYPH_FACTS,
  radicalRewritesFor,
  rewriteSourcesIn,
  SUPPLEMENT_EQUIVALENTS,
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

  /**
   * INVERTED 2026-11-16, not deleted. #335 pinned "the CJK Radicals
   * Supplement is NOT rewritten (measured 2026-11-16: SC draws 彐 with ⺕'s
   * glyph)": the flat UCD table sent U+2E95 to U+2B739 𫜹, a different real
   * ideograph, so the whole block was left alone — and a real zh job then
   * read 门 as ⻔ U+2ED4 in pdf.js. The exclusion belonged to the flat table,
   * not to the property: by per-face measured glyph sharing, SC's ⺕ glyph
   * is 彐's, so ⺕ now rewrites to 彐 U+5F50 — and NOT to the flat U+2B739.
   */
  it("the CJK Radicals Supplement IS rewritten, by measurement: in SC ⺕ U+2E95 → 彐 U+5F50, not the flat table's U+2B739; ⻔ U+2ED4 → 门", () => {
    // The flat table still says 𫜹 — the second bound, never the rewrite.
    expect(SUPPLEMENT_EQUIVALENTS.get(0x2e95)).toBe(0x2b739);
    const sc = radicalRewritesFor("NotoSansCJKsc-Regular");
    expect(sc.get(0x2e95)).toBe(0x5f50);
    expect(sc.get(0x2ed4)).toBe(0x95e8);
    const cmap = "2 beginbfchar\n<CD> <2E95>\n<CE> <2ED4>\nendbfchar";
    expect(normaliseRadicalToUnicode(cmap, sc)).toBe(
      "2 beginbfchar\n<CD> <5F50>\n<CE> <95E8>\nendbfchar",
    );
    // JP draws ⺕ with a glyph no ideograph shares: left alone there.
    expect(radicalRewritesFor("NotoSansCJKjp-Regular").has(0x2e95)).toBe(false);
  });

  it("health: the Supplement's flat table has 114 rows inside U+2E80–U+2EF3, and none outside", () => {
    expect(SUPPLEMENT_EQUIVALENTS.size).toBe(114);
    for (const k of SUPPLEMENT_EQUIVALENTS.keys())
      expect(isRadical(k) && k < 0x2f00, k.toString(16)).toBe(true);
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

  it("health: 30 faces, every one mapping all 214 Kangxi and all 115 assigned Supplement radicals; the faces the fixtures were drawn with are among them", async () => {
    expect(faces.length).toBe(30);
    // The bound is the Unicode blocks (`isRadical`), not the facts.
    const kangxi = (cp: number) => cp >= 0x2f00;
    let assigned = 0;
    for (let cp = 0x2e80; cp <= 0x2fff; cp++) if (isRadical(cp)) assigned += 1;
    expect(assigned).toBe(214 + 115);
    for (const face of faces) {
      const keys = Object.keys(RADICAL_GLYPH_FACTS.faces[face]!).map((k) =>
        parseInt(k, 16),
      );
      const radicals = keys.filter(isRadical);
      expect(radicals.filter(kangxi).length, face).toBe(214);
      expect(radicals.filter((cp) => !kangxi(cp)).length, face).toBe(115);
      // Everything else measured is Extension A, and only where shared.
      expect(
        keys.filter((cp) => !isRadical(cp) && !isExtensionA(cp)),
        face,
      ).toEqual([]);
    }
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
    // Health: 30 faces × (203..214 Kangxi + 60..80 Supplement) entries.
    expect(entries).toBeGreaterThan(30 * 260);
  });

  it("SECOND BOUND: every derived target equals the UCD equivalent, except exactly U+2F3E in SC (户) and JP (戸)", () => {
    const disagree: string[] = [];
    for (const face of faces)
      for (const [radical, target] of radicalRewritesFor(face))
        if (UCD.has(radical) && UCD.get(radical) !== target)
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
    expect([...kr.keys()].filter((r) => UCD.has(r)).length).toBe(214 - 9);
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

  it("the sources the job's text contains are kept out of the table — Kangxi, Supplement and Extension A alike", () => {
    const keep = rewriteSourcesIn(
      "Mixed: \u2f42 and \u6587, \u2f08, \u2ed4 \u95e8, \u3b35.",
    );
    expect([...keep].sort()).toEqual([0x2ed4, 0x2f08, 0x2f42, 0x3b35]);
    const t = radicalRewritesFor("NotoSansCJKsc-Regular", keep);
    for (const k of keep) expect(t.has(k), k.toString(16)).toBe(false);
    expect(t.get(0x2f00)).toBe(0x4e00);
    // Health: without the keep set every one is rewritten.
    const all = radicalRewritesFor("NotoSansCJKsc-Regular");
    expect(all.get(0x2f42)).toBe(0x6587);
    expect(all.get(0x2f08)).toBe(0x4eba);
    expect(all.get(0x2ed4)).toBe(0x95e8);
    expect(all.get(0x3b35)).toBe(0x80f6);
  });

  /**
   * The Supplement's second bound, as MEMBERS (rule 1: a list nothing
   * exercises is decoration). Every face where a Supplement radical's flat
   * UCD equivalent differs from the one ideograph the face measures on its
   * glyph — the flat table would have rewritten these to a different glyph.
   */
  it("SECOND BOUND (Supplement): every face where the flat equivalent differs from the measured sharer, by member", () => {
    const disagree = new Map<string, string[]>();
    let agree = 0;
    for (const face of faces)
      for (const [radical, target] of radicalRewritesFor(face)) {
        if (radical >= 0x2f00 || !isRadical(radical)) continue;
        const flat = SUPPLEMENT_EQUIVALENTS.get(radical);
        if (flat === target) {
          agree += 1;
          continue;
        }
        const key = `${radical.toString(16)}->${target.toString(16)} (flat ${flat?.toString(16) ?? "none"})`;
        disagree.set(key, [...(disagree.get(key) ?? []), face]);
      }
    const counted = Object.fromEntries(
      [...disagree].map(([k, v]) => [k, v.length]),
    );
    expect(counted).toEqual({
      "2e8d->2d544 (flat 5c0f)": 30,
      "2ea9->248e9 (flat 738b)": 30,
      "2eab->7f52 (flat 76ee)": 18,
      "2e95->5f50 (flat 2b739)": 6,
    });
    // ⺕ → 彐 is exactly the six SC faces.
    expect(disagree.get("2e95->5f50 (flat 2b739)")!.sort()).toEqual(
      faces.filter((f) => /CJKsc-/.test(f)).sort(),
    );
    // Health: the flat table and the facts agree far more often than not.
    expect(agree).toBeGreaterThan(30 * 55);
  });

  it("Extension A is rewritten only to a single URO sharer: 㬵 → 胶 in SC; two Extension A characters on one glyph, or a radical sharer, are left alone", () => {
    const sc = radicalRewritesFor("NotoSansCJKsc-Regular");
    expect(sc.get(0x3b35)).toBe(0x80f6);
    // 㖈 U+3588 and 䎛 U+439B share one glyph: no way to know which was meant.
    expect(sharers("NotoSansCJKsc-Regular", 0x3588)).toEqual([0x439b]);
    expect(sc.has(0x3588)).toBe(false);
    expect(sc.has(0x439b)).toBe(false);
    // 㓁 U+34C1 shares only with a radical (⺳): not a unified ideograph.
    expect(sharers("NotoSansCJKsc-Regular", 0x34c1)).toEqual([0x2eb3]);
    expect(sc.has(0x34c1)).toBe(false);
    // Every Extension A entry in every face: a URO target, by the facts.
    let n = 0;
    for (const face of faces)
      for (const [source, target] of radicalRewritesFor(face))
        if (isExtensionA(source)) {
          n += 1;
          expect(target >= 0x4e00 && target <= 0x9fff, face).toBe(true);
          expect(sharers(face, source).filter(isUnifiedIdeograph)).toEqual([
            target,
          ]);
        }
    expect(n).toBe(12 + 6 + 16 + 12 + 4);
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
