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
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
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
  parts: [{ kind: "body", pages: [1], text: `## ${judged}\n\n${judged}` }],
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

/** Every font's ToUnicode stream object: its encoded bytes and its dict. */
async function toUnicodeObjects(doc: PDFDocument) {
  const out = new Map<string, { contents: Uint8Array; dict: string }>();
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
  });
});
