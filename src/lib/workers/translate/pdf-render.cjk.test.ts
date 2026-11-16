// @vitest-environment node
// @native-canvas
/**
 * The ToUnicode rewrite, verified as a COMPOSED CHAIN: real pre-rewrite bytes
 * the worker image's Chromium printed → `renderTranslationPdf`'s own
 * post-process (the pdf-lib pass in `printAndCheck`) → the bytes it delivers
 * → a REAL pdf.js (`viewerText`), the reader that ignores ActualText.
 *
 * This is the guard the per-job conservation check cannot be: pdftotext
 * honours the ActualText Skia writes on exactly the glyphs the rewrite
 * touches, so a broken rewrite conserves. Only a reader that ignores
 * ActualText sees it, at the point of consumption.
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
import type { ChromiumPackageRunner } from "../html-render/engine";
import { LANGUAGE_SAMPLES, probeJudgedText } from "./pdf-capability";
import { viewerText } from "./pdf-readers";
import { normaliseToUnicodeStreams, renderTranslationPdf } from "./pdf-render";
import { typesetText, type TypesetInput } from "./typeset";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const fixture = (f: string) =>
  new Uint8Array(readFileSync(path.join(FIXTURES, f)));

const judged = probeJudgedText("zh", LANGUAGE_SAMPLES.zh);
const INPUT: TypesetInput = {
  parts: [
    {
      kind: "body",
      pages: [1],
      chosen: null,
      text: `## ${judged}\n\n${judged}`,
    },
  ],
  target: "zh",
  sourceName: "probe.pdf",
};

describe("the composed chain: Chromium's bytes → the render post-process → pdf.js", () => {
  it("health: the pre-rewrite fixture still exhibits the defect (pdf.js reads ⽂)", async () => {
    // If pdf.js ever honours ActualText upstream, THIS goes red — for an
    // explainable reason: the defect is gone, and so is this fixture's use.
    const text = await viewerText(fixture("zh-probe.pre-rewrite.pdf"));
    expect(text).toContain("⽂");
    expect(text).not.toContain("文");
  });

  it("delivers bytes in which pdf.js reads 文, and the read-back judged THOSE bytes", async () => {
    const printed = fixture("zh-probe.pre-rewrite.pdf");
    const chromium: ChromiumPackageRunner = {
      renderPackage: async () => [printed],
    };
    let readBackSaw: Uint8Array | null = null;
    const result = await renderTranslationPdf({
      chromium,
      readBack: async (bytes) => {
        readBackSaw = bytes;
        return typesetText(INPUT);
      },
      input: INPUT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = await viewerText(result.bytes);
    expect(text).toContain("文");
    expect(text).toContain("一");
    expect(text).toContain("人");
    expect(text).not.toMatch(/[⼀-⿕]/u);
    // Order (rule 3): the read-back and the size cap saw the delivered bytes.
    expect(readBackSaw).toBe(result.bytes);
  });
});

/**
 * Review 2026-11-16, both at the point of consumption. Chromium's own bytes
 * (`*.printed.pdf`, captured in the image BEFORE the post-process) for texts
 * that literally hold a Kangxi radical, and characters that share U+2F3E's
 * glyph in SC (户) and JP (戸). Through `renderTranslationPdf` to real pdf.js.
 * Built from code points so no tool layer can fold a radical.
 */
const t = (...cps: number[]) => String.fromCodePoint(...cps);
const SP = 0x20;

async function deliver(
  file: string,
  target: TypesetInput["target"],
  text: string,
) {
  const input: TypesetInput = {
    parts: [{ kind: "body", pages: [1], text, chosen: null }],
    target,
    sourceName: "probe.pdf",
  };
  const printed = fixture(file);
  const result = await renderTranslationPdf({
    chromium: { renderPackage: async () => [printed] },
    readBack: async () => typesetText(input),
    input,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("not delivered");
  return {
    before: new Set(await viewerText(printed)),
    after: new Set(await viewerText(result.bytes)),
  };
}

describe("a literal radical keeps its entry; the target is the glyph's ideograph in the face that drew it", () => {
  it("zh ⽂ 文 一 人 用户 户口: pdf.js reads ⽂ (kept), 一 人 (rewritten) and 户 — never 戶", async () => {
    const { before, after } = await deliver(
      "zh-radicals.printed.pdf",
      "zh",
      t(
        0x2f42,
        SP,
        0x6587,
        SP,
        0x4e00,
        SP,
        0x4eba,
        SP,
        0x7528,
        0x6237,
        SP,
        0x6237,
        0x53e3,
      ),
    );
    // Health: Chromium's bytes exhibit both defects' preconditions.
    expect(before.has(t(0x2f3e))).toBe(true);
    expect(before.has(t(0x2f00))).toBe(true);
    for (const ch of [0x2f42, 0x4e00, 0x4eba, 0x6237, 0x7528, 0x53e3])
      expect(after.has(t(ch)), ch.toString(16)).toBe(true);
    for (const ch of [0x6236, 0x2f3e, 0x2f00, 0x2f08])
      expect(after.has(t(ch)), ch.toString(16)).toBe(false);
  });

  it("ja ⼈ 人 日本 戸籍 江戸: pdf.js reads ⼈ (kept), 日 and 戸 — never 戶", async () => {
    const { before, after } = await deliver(
      "ja-radicals.printed.pdf",
      "ja",
      t(
        0x2f08,
        SP,
        0x4eba,
        SP,
        0x65e5,
        0x672c,
        SP,
        0x6238,
        0x7c4d,
        SP,
        0x6c5f,
        0x6238,
      ),
    );
    expect(before.has(t(0x2f3e))).toBe(true);
    for (const ch of [0x2f08, 0x65e5, 0x6238])
      expect(after.has(t(ch)), ch.toString(16)).toBe(true);
    for (const ch of [0x6236, 0x2f3e, 0x2f47])
      expect(after.has(t(ch)), ch.toString(16)).toBe(false);
  });

  it("en 'Radical only: ⽂ here.': the radical's entry is not rewritten, so no reader turns it into 文", async () => {
    const { after } = await deliver(
      "en-radical.printed.pdf",
      "en",
      `Radical only: ${t(0x2f42)} here.`,
    );
    expect(after.has(t(0x2f42))).toBe(true);
    expect(after.has(t(0x6587))).toBe(false);
  });
});

/** Every font's ToUnicode stream object: its encoded bytes and its dict. */
async function toUnicodeObjects(doc: PDFDocument) {
  const out = new Map<
    string,
    { contents: Uint8Array; dict: string; text: string; type3: boolean }
  >();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const ref = obj.get(PDFName.of("ToUnicode"));
    if (!(ref instanceof PDFRef)) continue;
    const s = doc.context.lookup(ref);
    if (s instanceof PDFRawStream)
      out.set(ref.toString(), {
        contents: s.contents,
        dict: s.dict.toString(),
        text: Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"),
        type3: obj.get(PDFName.of("Subtype")) === PDFName.of("Type3"),
      });
  }
  return out;
}

describe("streams with no radical are left byte-identical", () => {
  it.each(["en-probe.pdf", "bn-probe.pdf"])(
    "%s: every ToUnicode stream object is unchanged",
    async (f) => {
      const doc = await PDFDocument.load(fixture(f), { updateMetadata: false });
      const before = await toUnicodeObjects(doc);
      // Health: the fixture has ToUnicode streams to compare.
      expect(before.size).toBeGreaterThanOrEqual(2);
      expect(normaliseToUnicodeStreams(doc)).toBe(0);
      const after = await toUnicodeObjects(doc);
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [ref, b] of before) {
        expect(
          Buffer.from(after.get(ref)!.contents).equals(Buffer.from(b.contents)),
        ).toBe(true);
        expect(after.get(ref)!.dict).toBe(b.dict);
      }
    },
  );

  it("the pre-rewrite zh fixture: only the maps holding a radical are replaced", async () => {
    const doc = await PDFDocument.load(fixture("zh-probe.pre-rewrite.pdf"), {
      updateMetadata: false,
    });
    const before = await toUnicodeObjects(doc);
    const replaced = normaliseToUnicodeStreams(doc);
    const after = await toUnicodeObjects(doc);
    let changed = 0;
    for (const [ref, b] of before)
      if (
        !Buffer.from(after.get(ref)!.contents).equals(Buffer.from(b.contents))
      )
        changed += 1;
    expect(replaced).toBe(changed);
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(before.size);
    // Every Type 3 map holding no Kangxi destination is byte-identical — read
    // from its decoded text, not from the pass's own "changed?" test. These
    // are maps whose face HAS a table, so they reach the skip the en/bn
    // fixtures no longer can (their faces have no table at all; review r2).
    const plainType3 = [...before].filter(
      ([, b]) => b.type3 && !/<2F[0-9A-D][0-9A-F]>/.test(b.text),
    );
    expect(plainType3.length).toBeGreaterThan(0);
    for (const [ref, b] of plainType3)
      expect(
        Buffer.from(after.get(ref)!.contents).equals(Buffer.from(b.contents)),
        ref,
      ).toBe(true);
  });
});
