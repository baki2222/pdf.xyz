// @vitest-environment node
/**
 * Does non-Latin text actually come out of these tools as GLYPHS?
 *
 * "It did not throw" is not evidence. This repo has shipped two silent blanks —
 * pdfjs `wasmUrl` (every JPEG2000/JBIG2 image decoded to nothing) and `cMapUrl`
 * (every non-embedded CJK page completely blank) — and both were invisible to
 * the entire suite, because every test asked whether the call succeeded. So
 * every assertion here follows the chain in `src/tests/unicode-fonts.ts`:
 * characters -> glyph ids in the saved content stream -> outlines inside the
 * embedded subset.
 *
 * THE INDEPENDENT BOUND, measured once in Chromium by rasterising the output at
 * 3x and counting pixels darker than mid-grey. The structural chain below and
 * these numbers agree, which is the point of having both:
 *
 *   text                     subsetter                   ink px
 *   "机密文件测试"             @pdf-lib/fontkit             1,748   renders "件"
 *   "机密文件测试"             fontkit@2                   11,337
 *   "机密文件测试"             fontkit@2, NOT subset       11,337   <- identical
 *   "Привет Ελληνικά ĄĆŁŻ"   @pdf-lib/fontkit             3,109   renders "При"
 *   "Привет Ελληνικά ĄĆŁŻ"   fontkit@2                   15,518
 *   "গোপনীয় নথি বাংলা"          fontkit@2                   12,821
 *
 * The subset-equals-unsubset row is the control that matters: subsetting is
 * supposed to change the file size and nothing else.
 *
 * AND ONCE THROUGH THE SHIPPED PRODUCT, because everything above and everything
 * below runs in Node, and "webpack's browser build of fontkit works" was
 * otherwise an assumption. A real Chromium, driving the real `/tools/watermark-
 * pdf` page of a real `next start` build: pick a PDF, type the text, click the
 * button, save the download, rasterise it. Zero console errors, one request for
 * `/fonts/0.4.4/NotoSansBengali_400Regular.ttf`, and at 3x:
 *
 *   watermark text        base-page ink   watermark ink
 *   "গোপনীয় নথি"             1,408          44,057
 *   "机密文件"                 1,408          36,621
 *   "CONFIDENTIAL"           1,408          79,204   (standard font, no fetch)
 *
 * The identical base-page figure is the control: the page underneath did not
 * move, so the difference is the stamp. Before this change the first two rows
 * were not smaller — they did not exist, because the tool refused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { addWatermark } from "./watermark";
import { addPageNumbers } from "./page-numbers";
import { addHeaderFooter } from "./header-footer";
import { textToPdf } from "./text-to-pdf";
import { markdownToPdf } from "./markdown-to-pdf";
import { annotatePdf } from "./annotate";
import { signPdf } from "./signature";
import {
  embedDrawingFont,
  resetFontCache,
  setFontByteSource,
} from "./unicode-font";
import { readNotoTtf } from "./noto-source";
import { proveGlyphs, useNodeFontSource } from "@/tests/unicode-fonts";
import { BROKEN_CJK_SUBSET_PDF_BASE64 } from "@/tests/fixtures-broken-subset";

/** A blank one-page PDF to stamp. */
async function blankPdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([420, 320]);
  return doc.save();
}

/** Characters that must each end up as a real, drawable glyph. */
const SAMPLES = [
  { script: "Bengali", text: "গোপনীয় নথি" },
  { script: "Chinese", text: "机密文件" },
  { script: "Japanese", text: "秘密ひらがなカタカナ" },
  { script: "Korean", text: "기밀 문서" },
  { script: "Cyrillic", text: "Секретный документ" },
  { script: "Greek", text: "Απόρρητο έγγραφο" },
  { script: "Devanagari", text: "गोपनीय दस्तावेज़" },
  { script: "Vietnamese", text: "Tài liệu mật" },
  { script: "Polish and Turkish", text: "Poufne Łódź gizli belge" },
] as const;

let restore: () => void;
beforeEach(() => {
  restore = useNodeFontSource();
});
afterEach(() => {
  restore();
});

describe("a stamped page carries drawable glyphs, not just a successful call", () => {
  it.each(SAMPLES)(
    "$script survives watermarking as real outlines",
    async ({ text }) => {
      const out = await addWatermark(await blankPdf(), text);
      const proof = await proveGlyphs(out);

      expect(
        proof.embeddedFonts,
        "no font programme was embedded, so the page can only be showing the standard fonts — which cannot encode this script at all",
      ).toBe(1);
      expect(
        proof.glyphIds.length,
        "the content stream shows no glyphs: the page is blank",
      ).toBeGreaterThan(0);
      expect(
        proof.notdefIds,
        ".notdef glyphs were drawn — those render as blank or as a hollow box, never as the user's letters",
      ).toEqual([]);
      expect(
        proof.unreadableIds,
        "the embedded subset cannot resolve glyphs its own content stream references. This is the @pdf-lib/fontkit subsetting defect: it does not throw, it writes a font whose glyphs render as nothing",
      ).toEqual([]);
      expect(
        proof.emptyOutlineIds,
        "glyphs with no drawing commands are blank on the page",
      ).toEqual([]);
      expect(
        proof.outlineCommands,
        "the referenced glyphs contain no drawing commands at all",
      ).toBeGreaterThan(20);
      expect(
        proof.untranslatableIds,
        "glyphs are drawn that /ToUnicode does not map, so the text is on the page but cannot be selected, copied or searched",
      ).toEqual([]);
    },
    30_000,
  );
});

describe("what a reader can select out of the page again", () => {
  it("round-trips scripts that are not reordered", async () => {
    // /ToUnicode is what makes the stamp searchable. For scripts whose shaping
    // does not move characters about, the text comes back exactly.
    for (const text of ["机密文件", "기밀 문서", "Секретный", "Απόρρητο"]) {
      const proof = await proveGlyphs(
        await addWatermark(await blankPdf(), text),
      );
      expect(proof.extractedText).toBe(text);
    }
  }, 30_000);

  it("returns Indic text in VISUAL order, which is not the order it was typed", async () => {
    // A measured limitation, written down rather than discovered later. The
    // GLYPHS are correct — "গোপনীয়" renders as "গোপনীয়", verified in Chromium —
    // but the Indic shaper decomposes ো (U+09CB) into a prepended ে and an
    // appended া and reorders the i-kar, and pdf-lib's /ToUnicode is built from
    // the glyph sequence. So the drawn page is right and a copy-paste comes
    // back rearranged.
    //
    // This is asserted rather than merely noted so that the day it is fixed,
    // this test fails and someone updates the claim instead of the claim
    // quietly becoming false in the other direction.
    const source = "গোপনীয়";
    const proof = await proveGlyphs(
      await addWatermark(await blankPdf(), source),
    );
    expect(proof.untranslatableIds).toEqual([]);
    expect(proof.extractedText).not.toBe(source);
    // Precisely what happens, so the claim is falsifiable rather than vague:
    // U+09CB (ো) is decomposed by the shaper into U+09C7 (ে), which is drawn
    // BEFORE its consonant, and U+09BE (া), drawn after. Both appear in the
    // extracted text and the composed form does not, and the string is one
    // character longer than it was typed.
    expect(proof.extractedText).toContain("ে");
    expect(proof.extractedText).toContain("া");
    expect(proof.extractedText).not.toContain("ো");
    expect(proof.extractedText.length).toBe(source.length + 1);
  }, 30_000);
});

describe("the proof can tell a drawn page from a blank one", () => {
  // A predicate that cannot fail proves nothing, so here it is failed on
  // purpose. Both controls are the shapes a real regression would take: the
  // font arrives but nothing is drawn with it, and text is drawn but with no
  // embedded font at all.
  it("reports zero ink when the face is embedded but nothing is drawn", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    await embedDrawingFont(doc, ["机密文件"], "sans");
    const proof = await proveGlyphs(await doc.save());
    expect(proof.glyphIds).toEqual([]);
    expect(proof.outlineCommands).toBe(0);
  }, 30_000);

  it("reports no embedded font for the standard-font path", async () => {
    const out = await addWatermark(await blankPdf(), "CONFIDENTIAL");
    const proof = await proveGlyphs(out);
    expect(proof.embeddedFonts).toBe(0);
    expect(proof.outlineCommands).toBe(0);
  });

  it("goes RED on the real defect, not just on a synthetic one", async () => {
    // The strongest control available: an actual file produced by
    // `@pdf-lib/fontkit`, which renders "机密文件测试" as the single character 件
    // in Chromium and raised no error at any point in making it. If this ever
    // comes back clean, the proof above has stopped discriminating and every
    // green in this file means nothing.
    const bytes = Uint8Array.from(
      Buffer.from(BROKEN_CJK_SUBSET_PDF_BASE64, "base64"),
    );
    const proof = await proveGlyphs(bytes);

    // Everything a shallower check would look at is FINE on this file: a font
    // is embedded, glyphs are drawn, none of them is .notdef, and the text
    // extracts perfectly. That is exactly why "it did not throw" proves nothing.
    expect(proof.embeddedFonts).toBe(1);
    expect(proof.glyphIds.length).toBeGreaterThan(0);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.extractedText).toBe("机密文件测试");

    // And the chain still catches it, at the hop that matters: the embedded
    // subset cannot resolve the glyph ids its own content stream references.
    expect(
      [...proof.unreadableIds, ...proof.emptyOutlineIds].length,
      "the negative control passed — proveGlyphs no longer detects the defect it was written for",
    ).toBeGreaterThan(0);
  });
});

describe("Western text still takes the free path", () => {
  it("downloads nothing and embeds no font programme", async () => {
    // Counted, not assumed. The whole point of the WinAnsi fork is that a
    // "CONFIDENTIAL" watermark keeps costing zero bytes; a chooser that fetched
    // a 629 KB face anyway would still pass every rendering assertion in this
    // file and would have made every tool page slower for the majority of
    // users, invisibly.
    let requests = 0;
    const previous = setFontByteSource(async (pack) => {
      requests += 1;
      return readNotoTtf(pack);
    });
    resetFontCache();
    try {
      const out = await addWatermark(await blankPdf(), "CONFIDENTIAL — draft");
      const proof = await proveGlyphs(out);
      expect(proof.embeddedFonts).toBe(0);
      expect(requests, "a font was downloaded for pure Latin text").toBe(0);

      // Positive control on the counter itself: it must be capable of moving,
      // or "0 requests" is a statement about a broken counter.
      await addWatermark(await blankPdf(), "机密");
      expect(requests).toBeGreaterThan(0);
    } finally {
      setFontByteSource(previous);
      resetFontCache();
    }
  }, 30_000);

  it("keeps the CP1252 punctuation the standard fonts can encode", async () => {
    // Em dash, curly quotes, euro: all WinAnsi, none of them a reason to pull
    // down a 629 KB face.
    const out = await addWatermark(await blankPdf(), "“Draft” — €10");
    expect((await proveGlyphs(out)).embeddedFonts).toBe(0);
  });
});

describe("the font is chosen from what will be DRAWN, not from what was typed", () => {
  it("page numbers pick a face from the substituted label, not the template", async () => {
    // The template is ASCII; the substituted text is not. A font chosen from
    // the template would be Helvetica, and pdf-lib would throw a raw
    // `WinAnsi cannot encode` part-way through the page loop, after page one
    // had already been stamped.
    const out = await addPageNumbers(await blankPdf(3), {
      format: "পৃষ্ঠা {n} / {total}",
    });
    const proof = await proveGlyphs(out);
    expect(proof.embeddedFonts).toBe(1);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.emptyOutlineIds).toEqual([]);
  }, 30_000);

  it("headers pick a face from the {date} the runner supplies", async () => {
    // `{date}` is a locale string the runner passes in, so an all-ASCII header
    // template can still draw Japanese. This is the one that a template-based
    // corpus gets wrong.
    const out = await addHeaderFooter(await blankPdf(2), {
      footer: { center: "Report — {date}" },
      date: "令和七年",
    });
    const proof = await proveGlyphs(out);
    expect(proof.embeddedFonts).toBe(1);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.unreadableIds).toEqual([]);
  }, 30_000);

  it("markdown picks a face that can draw the bullet it invents", async () => {
    // "• " is U+2022 — inside WinAnsi, but inside only 14% of Noto Sans
    // Bengali's General Punctuation. A corpus taken from the raw markdown would
    // have chosen a face that cannot draw its own bullets.
    const out = await markdownToPdf("- গোপনীয়\n- নথি\n");
    const proof = await proveGlyphs(out);
    expect(proof.embeddedFonts).toBe(1);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.emptyOutlineIds).toEqual([]);
  }, 30_000);
});

describe("every text tool reaches the same font chooser", () => {
  it("text-to-pdf writes Bengali as outlines", async () => {
    const proof = await proveGlyphs(
      await textToPdf("গোপনীয় নথি\nদ্বিতীয় লাইন", { title: "নথি" }),
    );
    expect(proof.embeddedFonts).toBe(1);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.outlineCommands).toBeGreaterThan(20);
  }, 30_000);

  it("annotate writes a Chinese note as outlines", async () => {
    const result = await annotatePdf(await blankPdf(), [
      {
        type: "note",
        page: 1,
        color: "#101010",
        x: 20,
        y: 200,
        text: "机密文件",
        size: 14,
      },
    ]);
    const proof = await proveGlyphs(result.bytes);
    expect(proof.embeddedFonts).toBe(1);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.emptyOutlineIds).toEqual([]);
  }, 30_000);

  it("a typed signature can spell a Korean name", async () => {
    const out = await signPdf(
      await blankPdf(),
      { kind: "typed", text: "김민준", style: "signature" },
      { pageIndex: 0, position: "bottom-right", width: 160 },
    );
    const proof = await proveGlyphs(out);
    expect(proof.embeddedFonts).toBe(1);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.emptyOutlineIds).toEqual([]);
  }, 30_000);
});

describe("it refuses rather than substituting, and says what it cannot do", () => {
  it("names the script and the reason for right-to-left text", async () => {
    await expect(addWatermark(await blankPdf(), "سري للغاية")).rejects.toThrow(
      /Arabic is not supported because/i,
    );
    await expect(addWatermark(await blankPdf(), "سري للغاية")).rejects.toThrow(
      /right to left/i,
    );
  });

  it("names the scripts it CAN draw in the same breath", async () => {
    // A refusal that only says "no" leaves the user guessing whether the
    // product does their language at all.
    await expect(addWatermark(await blankPdf(), "סודי ביותר")).rejects.toThrow(
      /Bengali/,
    );
    await expect(addWatermark(await blankPdf(), "סודי ביותר")).rejects.toThrow(
      /Hebrew is not supported because/,
    );
  });

  it("distinguishes a script we lack a font for from one we lay out wrongly", async () => {
    // Thai and Hebrew are both refused, for different reasons, and the message
    // must not flatten them into "unsupported characters" — the day a Thai face
    // is added, only one of those sentences stops being true.
    await expect(addWatermark(await blankPdf(), "เอกสารลับ")).rejects.toThrow(
      /no Thai face is shipped/,
    );
  });

  it("refuses emoji as pictures rather than letters", async () => {
    await expect(addWatermark(await blankPdf(), "draft 😀")).rejects.toThrow(
      /emoji is not supported because/i,
    );
  });

  it("refuses a mix no single face can draw, naming both scripts", async () => {
    await expect(
      addWatermark(await blankPdf(), "গোপনীয় 기밀"),
    ).rejects.toThrow(/mixes Bengali and Korean/i);
  });

  it("never puts a question mark where a character used to be", async () => {
    // The 2026-08-10 defect in one line: the output must not contain a
    // substitution, and the only way to be sure is that there is no output.
    await expect(addWatermark(await blankPdf(), "🎉")).rejects.toThrow(
      /Rather than replace them with/,
    );
  });
});
