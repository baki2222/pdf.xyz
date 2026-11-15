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
  normaliseRadicalToUnicode,
  RADICAL_EQUIVALENTS,
} from "./radical-equivalents";

const FIXTURES = path.join(import.meta.dirname, "fixtures");

/** Every Type 3 font's ToUnicode text in a fixture, as Skia wrote it. */
async function type3ToUnicode(file: string): Promise<string[]> {
  const doc = await PDFDocument.load(
    new Uint8Array(readFileSync(path.join(FIXTURES, file))),
    { updateMetadata: false },
  );
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Subtype")) !== PDFName.of("Type3")) continue;
    const ref = obj.get(PDFName.of("ToUnicode"));
    const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : null;
    if (stream instanceof PDFRawStream)
      out.push(
        Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"),
      );
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
    expect(normaliseRadicalToUnicode(cmap)).toBe(cmap);
  });
});

describe("normaliseRadicalToUnicode", () => {
  it("on the REAL pre-rewrite zh probe: <92> <2F42> becomes <92> <6587>, nothing else moves", async () => {
    const maps = await type3ToUnicode("zh-probe.pre-rewrite.pdf");
    const wen = maps.filter((m) => m.includes("<92> <2F42>"));
    // Health: the fixture still carries the defect it was captured for.
    expect(wen.length).toBeGreaterThan(0);
    for (const m of wen) {
      const next = normaliseRadicalToUnicode(m);
      expect(next).toBe(m.replace("<92> <2F42>", "<92> <6587>"));
    }
    // A map holding no radical is byte-identical.
    const plain = maps.filter((m) => !/<2F[0-9A-D][0-9A-F]>/.test(m));
    expect(plain.length).toBeGreaterThan(0);
    for (const m of plain) expect(normaliseRadicalToUnicode(m)).toBe(m);
  });

  it("the post-rewrite fixtures carry no Kangxi destination at all", async () => {
    for (const f of ["zh-probe.pdf", "ja-probe.pdf", "ko-probe.pdf"])
      for (const m of await type3ToUnicode(f))
        for (const t of parseToUnicode(m).values())
          for (const ch of t)
            expect(
              RADICAL_EQUIVALENTS.has(ch.codePointAt(0)!),
              `${f} ${ch}`,
            ).toBe(false);
  });

  it("splits a bfrange whose run crosses a radical, and every code still maps one to one", () => {
    // 2FD4 and 2FD5 are radicals; 2FD6 and 2FD7 are not.
    const cmap =
      "2 beginbfrange\n<01> <04> <2FD4>\n<10> <12> <0041>\nendbfrange";
    const next = normaliseRadicalToUnicode(cmap);
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
      ),
    ).toBe("1 beginbfrange\n<05> <06> [<6587> <0042>]\nendbfrange");
  });

  it("leaves a CMap with no radical byte-identical, and blocks with none untouched", () => {
    const cmap =
      "/CIDInit /ProcSet findresource begin\n2 beginbfchar\n<01> <0041>\n<02> <4E00>\nendbfchar\n1 beginbfrange\n<03> <05> <0061>\nendbfrange\nend";
    expect(normaliseRadicalToUnicode(cmap)).toBe(cmap);
    const mixed = `${cmap}\n1 beginbfchar\n<09> <2F00>\nendbfchar`;
    expect(normaliseRadicalToUnicode(mixed)).toBe(
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
    const next = normaliseRadicalToUnicode(cmap);
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
