import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  layoutPlainText,
  textPdfOutputName,
  textToPdf,
  validatePlainTextInput,
  wrapTextLine,
} from "./text-to-pdf";
import { markdownToPdf } from "./markdown-to-pdf";
import { addWatermark } from "./watermark";
import { FONT_PACKS, type FontPack } from "./font-packs";
import { loadCoverage, packCovers } from "./font-coverage";
import { isWinAnsiEncodable } from "./winansi";
import { readNotoTtf } from "./noto-source";
import { resetFontCache, setFontByteSource } from "./unicode-font";
import { embeddedFaces, proveGlyphs } from "@/tests/unicode-fonts";

describe("text-to-pdf", () => {
  it("rejects empty text", () => {
    expect(() => validatePlainTextInput("   \n\t  ")).toThrow(/Add some text/);
  });

  it("wraps long lines", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Courier);
    const lines = wrapTextLine("alpha beta gamma delta", font, 60, 11);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toContain("alpha");
  });

  it("paginates plain text", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Courier);
    const layout = layoutPlainText(
      Array.from({ length: 90 }, (_, i) => `Line ${i + 1}`).join("\n"),
      font,
    );
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.lineCount).toBe(90);
  });

  it("creates a readable PDF", async () => {
    const bytes = await textToPdf("Hello pdf.xyz\nThis is a text file.", {
      title: "notes.txt",
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("names PDF downloads from source text files", () => {
    expect(textPdfOutputName("notes.txt")).toBe("notes-pdf.pdf");
  });
});

/**
 * "Readable monospace typography" is a property of the PAGE, so it is read off
 * the saved bytes: the embedded face that drew the text, and the advance
 * widths of its glyphs.
 *
 * The defect: one character outside WinAnsi — an arrow, a `tree` connector —
 * sent the whole document from Courier to the only shipped face that had it,
 * Noto Sans JP. That face is proportional for Latin (i=275, W=878, space=224),
 * so every column in the file stopped lining up, and a phone downloaded
 * 5.4 MB to draw one arrow.
 */
describe("the monospace promise holds beyond WinAnsi", () => {
  async function recording<T>(
    run: () => Promise<T>,
  ): Promise<{ result: T; requested: FontPack[] }> {
    const requested: FontPack[] = [];
    const previous = setFontByteSource(async (pack) => {
      requested.push(pack);
      return readNotoTtf(pack);
    });
    resetFontCache();
    try {
      return { result: await run(), requested };
    } finally {
      setFontByteSource(previous);
      resetFontCache();
    }
  }

  it("keeps arrows, box drawing and CLI output monospaced, from a small download", async () => {
    const text = "Step 1 → done\n├── src\n│   └── a.ts\n└── b ≥ c — ok";
    const { result, requested } = await recording(() =>
      textToPdf(text, { title: "notes" }),
    );
    const faces = await embeddedFaces(result);
    const body = faces.find((face) => face.characters.includes("├"));
    expect(
      body,
      "no embedded face drew the box-drawing characters",
    ).toBeDefined();
    for (const ch of "→├│└─≥") expect(body!.characters).toContain(ch);
    expect(
      [...body!.advanceWidths],
      `${body!.baseFont} draws these glyphs at different widths, so the columns of this text no longer line up`,
    ).toHaveLength(1);

    expect(
      requested.length,
      "nothing was fetched, so nothing was measured",
    ).toBeGreaterThan(0);
    expect(
      requested.filter((pack) => pack.bytes > 1_000_000).map((p) => p.id),
      "a multi-megabyte face was downloaded to draw an arrow",
    ).toEqual([]);
    // And the glyphs are real outlines, not blanks from a bad subset.
    expect(body!.blankCharacters).toEqual([]);
  }, 30_000);

  it("draws EVERY character the monospace face claims at one width", async () => {
    // Derived, not typed: the corpus is the monospace face's own cmap (the
    // generated coverage table) minus what Courier already draws, minus
    // combining marks, which have no advance by design.
    const coverage = await loadCoverage();
    const mono = FONT_PACKS.find((pack) => pack.role === "monospace");
    expect(mono, "no monospace face ships").toBeDefined();
    const chars: string[] = [];
    for (let cp = 0x20; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (!packCovers(coverage, mono!, cp) || isWinAnsiEncodable(cp)) continue;
      const ch = String.fromCodePoint(cp);
      if (/[\p{M}\p{Cc}\p{Cf}\p{Cn}\p{Zs}\p{Zl}\p{Zp}]/u.test(ch)) continue;
      chars.push(ch);
    }
    // Bounded: a coverage table that decoded to nearly nothing would make
    // every assertion below vacuous.
    expect(chars.length).toBeGreaterThan(300);

    const lines: string[] = [];
    for (let i = 0; i < chars.length; i += 40) {
      lines.push(chars.slice(i, i + 40).join(""));
    }
    const { result } = await recording(() =>
      textToPdf(lines.join("\n"), { title: "corpus" }),
    );
    const faces = await embeddedFaces(result);
    expect(faces).toHaveLength(1);
    expect([...faces[0]!.advanceWidths]).toHaveLength(1);
    expect(faces[0]!.blankCharacters).toEqual([]);
    const missing = chars.filter((ch) => !faces[0]!.characters.includes(ch));
    expect(
      missing,
      "characters the face claims but the page does not carry",
    ).toEqual([]);
  }, 60_000);

  it("still draws CJK text — a correct proportional face beats a refusal (positive control)", async () => {
    // A CJK title too: `proveGlyphs` reads every `<hex> Tj` as glyph ids, so a
    // Helvetica title beside a CID face would be misread as blank glyphs.
    const { result, requested } = await recording(() =>
      textToPdf("机密文件\n├── 草稿", { title: "草稿" }),
    );
    expect(requested.map((pack) => pack.id)).toContain("chinese");
    const proof = await proveGlyphs(result);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.emptyOutlineIds).toEqual([]);
    expect(proof.extractedText).toContain("机密文件");
  }, 60_000);

  it("keeps pure WinAnsi text on Courier with nothing downloaded", async () => {
    const { result, requested } = await recording(() =>
      textToPdf("Plain notes — “quoted” café", { title: "notes" }),
    );
    expect(requested).toEqual([]);
    expect(await embeddedFaces(result)).toEqual([]);
    const doc = await PDFDocument.load(result);
    const baseFonts: string[] = [];
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (object instanceof PDFDict) {
        const name = object.get(PDFName.of("BaseFont"));
        if (name) baseFonts.push(String(name));
      }
    }
    expect(baseFonts).toContain("/Courier");
  });

  it.each([
    // Cyrillic: Noto Sans carries a signal for it, which alone would not stop
    // a smaller face that is offered to everyone.
    ["a Cyrillic watermark", "Привет Wi"],
    // No signal at all: an arrow only the CJK faces and the monospace face
    // draw. Offered to every face, the monospace pack would win on size.
    ["a watermark with an arrow", "Draft → Wi"],
  ])(
    "does not set %s in the monospace face (and the width probe sees proportional text)",
    async (_label, text) => {
      // A face is monospace only where monospace was asked for. This is also
      // the positive control for the width probe above: it must be able to
      // see a proportional face.
      const blank = await PDFDocument.create();
      blank.addPage([420, 320]);
      const { result, requested } = await recording(async () =>
        addWatermark(await blank.save(), text),
      );
      expect(requested.map((pack) => pack.role)).not.toContain("monospace");
      const faces = await embeddedFaces(result);
      expect(faces).toHaveLength(1);
      expect(faces[0]!.advanceWidths.size).toBeGreaterThan(1);
    },
    60_000,
  );

  it("sets Cyrillic notes in the monospace face, which the runner tile promises", async () => {
    // Noto Sans has a SIGNAL for Cyrillic and would otherwise rank first; a
    // caller that asked for monospace asked for equal widths.
    const { result, requested } = await recording(() =>
      textToPdf("Привет, мир\nWide iii", { title: "notes" }),
    );
    expect(requested.map((pack) => pack.role)).toEqual(["monospace"]);
    const faces = await embeddedFaces(result);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.characters).toContain("Привет");
    expect([...faces[0]!.advanceWidths]).toHaveLength(1);
  }, 30_000);

  it("sets a Markdown code block containing an arrow in the monospace face", async () => {
    const { result } = await recording(() =>
      markdownToPdf("# Tree\n\n```\na → b\n├── x\n└── y\n```\n"),
    );
    const faces = await embeddedFaces(result);
    const code = faces.find((face) => face.characters.includes("├"));
    expect(code, "no embedded face drew the code block").toBeDefined();
    expect([...code!.advanceWidths]).toHaveLength(1);
  }, 60_000);
});
