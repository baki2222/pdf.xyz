// @native-canvas
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { handBuiltPptx } from "@/tests/pptx-fixture";
import { pptxBefore20260927 } from "@/tests/pptx-before-2026-09-27";
import { pptxProofVerdict, readPptx, xmlProblems } from "./validate-ooxml";
import { runPdfOfficeExport } from "./engine";
import { scanPdfPages } from "./page-scan";
import { linesPdf, pdftotextStandIn } from "@/tests/pptx-fidelity-fixtures";

/**
 * The checker PDF to PowerPoint's unit tests AND its deployment proof share.
 * Every negative control below breaks ONE thing in a deck the checker passes,
 * and runs the result THROUGH the checker: a control that only proves a string
 * was edited proves nothing about the detector.
 */

/** Rewrite one part of a deck; throws if the edit did not land. */
async function mutate(
  deck: Uint8Array,
  part: string,
  edit: (xml: string) => string,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(deck);
  const before = await zip.file(part)!.async("string");
  const after = edit(before);
  // The mutation's own health check: a no-op edit would read as "the
  // checker is blind" when the mutation simply never landed.
  expect(after, `${part} edit landed`).not.toBe(before);
  zip.file(part, after);
  return zip.generateAsync({ type: "uint8array" });
}
async function drop(deck: Uint8Array, part: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(deck);
  expect(zip.file(part), `${part} exists before the drop`).not.toBeNull();
  zip.remove(part);
  return zip.generateAsync({ type: "uint8array" });
}

describe("readPptx — the checker itself", () => {
  it("POSITIVE CONTROL: passes a hand-built deck PowerPoint and LibreOffice open", async () => {
    const deck = await readPptx(await handBuiltPptx());
    expect(deck.problems).toEqual([]);
    // Health check: presentation, slide, layout, master, theme.
    expect(deck.reached).toHaveLength(5);
    expect(deck.slides).toEqual([["PowerPoint to PDF — pdf.xyz proof"]]);
  });

  // The two controls below came with the package inspector (`./pptx-inspect`),
  // which was written on another branch against the same refusal. Each reader
  // now answers to both branches' evidence: the deck PowerPoint saved itself,
  // and the deck it refused.
  it("POSITIVE CONTROL: passes the deck PowerPoint saved itself", async () => {
    const deck = await readPptx(
      new Uint8Array(
        readFileSync(
          new URL("./fixtures/powerpoint-authored.pptx", import.meta.url),
        ),
      ),
    );
    expect(deck.problems).toEqual([]);
    expect(deck.reached).toHaveLength(5);
    expect(deck.slides).toEqual([["Saved by Microsoft PowerPoint"]]);
  });

  it("NEGATIVE CONTROL: fails the package PowerPoint refused, as it was written", async () => {
    const { problems } = await readPptx(
      await pptxBefore20260927([
        { pageNumber: 1, text: "One", characterCount: 3 },
        { pageNumber: 2, text: "", characterCount: 0 },
      ]),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/no p:sldMasterIdLst/),
        expect.stringMatching(/no p:sldSz/),
        expect.stringMatching(/slide1\.xml: 0 slideLayout relationships/),
        expect.stringMatching(/slide2\.xml: a txBody holds no a:p/),
      ]),
    );
  });

  it.each([
    [
      "no slide master list",
      "ppt/presentation.xml",
      (x: string) =>
        x.replace(/<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>/, ""),
      /no p:sldMasterIdLst/,
    ],
    [
      "no slide size",
      "ppt/presentation.xml",
      (x: string) => x.replace(/<p:sldSz [^>]*\/>/, ""),
      /no p:sldSz/,
    ],
    [
      "a slide size PowerPoint refuses",
      "ppt/presentation.xml",
      (x: string) => x.replace(/<p:sldSz cx="\d+"/, '<p:sldSz cx="595"'),
      /sldSz cx="595" is outside/,
    ],
    [
      "slide list before master list",
      "ppt/presentation.xml",
      (x: string) =>
        x.replace(
          /(<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>)\s*(<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>)/,
          "$2$1",
        ),
      /out of schema order/,
    ],
    [
      "an empty nvSpPr",
      "ppt/slides/slide1.xml",
      (x: string) => x.replace(/<p:nvSpPr>[\s\S]*?<\/p:nvSpPr>/, "<p:nvSpPr/>"),
      /nvSpPr holds \[\], needs \[cNvPr, cNvSpPr, nvPr\]/,
    ],
    [
      "an empty nvGrpSpPr",
      "ppt/slides/slide1.xml",
      (x: string) =>
        x.replace(/<p:nvGrpSpPr>[\s\S]*?<\/p:nvGrpSpPr>/, "<p:nvGrpSpPr/>"),
      /nvGrpSpPr holds \[\]/,
    ],
    [
      "a txBody with no paragraph",
      "ppt/slides/slide1.xml",
      (x: string) => x.replace(/<a:p>[\s\S]*?<\/a:p>/, ""),
      /txBody holds no a:p/,
    ],
    [
      "an XML-illegal control character",
      "ppt/slides/slide1.xml",
      (x: string) => x.replace("pdf.xyz proof", "pdf.xyz\u0001proof"),
      /slide1\.xml: not well-formed XML/,
    ],
    [
      "an unbound namespace prefix",
      "ppt/slides/slide1.xml",
      (x: string) =>
        x
          .replace(/ xmlns:r="[^"]*"/, "")
          .replace("<p:cSld>", '<p:cSld r:id="rId1">'),
      /not well-formed XML — .*unbound namespace prefix/,
    ],
    [
      "a master with no theme",
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      (x: string) => x.replace(/<Relationship Id="rId2"[^>]*\/>/, ""),
      /slideMaster1\.xml: 0 theme relationships/,
    ],
    [
      "a theme missing its format lists",
      "ppt/theme/theme1.xml",
      (x: string) =>
        x.replace(/<a:effectStyleLst>[\s\S]*?<\/a:effectStyleLst>/, ""),
      /effectStyleLst needs at least 3 entries/,
    ],
  ])("NEGATIVE CONTROL: sees %s", async (_, part, edit, want) => {
    const broken = await mutate(await handBuiltPptx(), part, edit);
    const { problems } = await readPptx(broken);
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringMatching(want)]),
    );
  });

  it.each([
    [
      "a slide with no layout relationship",
      "ppt/slides/_rels/slide1.xml.rels",
      /slide1\.xml: 0 slideLayout relationships/,
    ],
    [
      "a missing slide master part",
      "ppt/slideMasters/slideMaster1.xml",
      /targets ppt\/slideMasters\/slideMaster1\.xml, which is not in the package/,
    ],
    [
      "a missing theme part",
      "ppt/theme/theme1.xml",
      /theme1\.xml, which is not in the package/,
    ],
  ])("NEGATIVE CONTROL: sees %s (part deleted)", async (_, part, want) => {
    const { problems } = await readPptx(
      await drop(await handBuiltPptx(), part),
    );
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringMatching(want)]),
    );
  });

  it("NEGATIVE CONTROL: sees a slide part whose content type was never declared", async () => {
    const broken = await mutate(
      await handBuiltPptx(),
      "[Content_Types].xml",
      (x) =>
        x.replace(
          /<Override PartName="\/ppt\/slides\/slide1\.xml"[^>]*\/>/,
          "",
        ),
    );
    expect((await readPptx(broken)).problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /slide relationship, but ppt\/slides\/slide1\.xml is declared application\/xml/,
        ),
      ]),
    );
  });

  it("reports a non-ZIP as one problem instead of throwing", async () => {
    const read = await readPptx(new TextEncoder().encode("%PDF-1.7"));
    expect(read.problems).toEqual([
      expect.stringMatching(/^not a ZIP package/),
    ]);
    expect(read.reached).toEqual([]);
  });

  it("xmlProblems passes well-formed XML and names what is wrong otherwise", () => {
    expect(xmlProblems('<a xmlns:p="urn:x"><p:b/>&amp;</a>')).toEqual([]);
    expect(xmlProblems("<a>\u0001</a>")).toEqual([
      expect.stringMatching(/disallowed character/),
    ]);
    expect(xmlProblems("<a><b></a>")).toHaveLength(1);
  });
});

describe("pptxProofVerdict — what the deployment proof prints", () => {
  it("passes a good deck that carries the text, and names the slide count", async () => {
    await expect(
      pptxProofVerdict(await handBuiltPptx(), "pdf.xyz proof"),
    ).resolves.toEqual({
      ok: true,
      detail: "1 slide(s), 5 parts walked, fixture text found",
    });
  });

  it("fails a good deck that lacks the text", async () => {
    await expect(
      pptxProofVerdict(await handBuiltPptx(), "not on any slide"),
    ).resolves.toMatchObject({ ok: false });
  });

  it("POSITIVE CONTROL: passes the deck PowerPoint saved itself, text and all", async () => {
    // Both readers the verdict runs must pass the consumer's own file, or a
    // red from either is the instrument's opinion and not PowerPoint's.
    const saved = new Uint8Array(
      readFileSync(
        new URL("./fixtures/powerpoint-authored.pptx", import.meta.url),
      ),
    );
    await expect(
      pptxProofVerdict(saved, "Saved by Microsoft PowerPoint"),
    ).resolves.toMatchObject({ ok: true });
  });

  it("fails a deck only the package inspector sees is broken", async () => {
    // A content-type override naming a part the package does not hold.
    // readPptx walks relationships and never reads an override for a part
    // nothing points at, so it passes this deck; `./pptx-inspect` does not.
    // Measured on the writer's own deck: of the inspector's 26 checks,
    // readPptx misses three (override-without-part, unreachable-part,
    // unlisted-slide) — and the inspector misses every shape-tree and theme
    // check readPptx makes. The deployment proof prints ONE verdict, so it
    // has to be both readers'.
    const broken = await mutate(
      await handBuiltPptx(),
      "[Content_Types].xml",
      (x) =>
        x.replace(
          "</Types>",
          '<Override PartName="/ppt/slides/slide99.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
        ),
    );
    expect((await readPptx(broken)).problems).toEqual([]);
    const verdict = await pptxProofVerdict(broken, "pdf.xyz proof");
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/override-without-part/);
  });

  it("fails a deck with the text when PowerPoint could not open it", async () => {
    const broken = await drop(
      await handBuiltPptx(),
      "ppt/slides/_rels/slide1.xml.rels",
    );
    const verdict = await pptxProofVerdict(broken, "pdf.xyz proof");
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/^PowerPoint cannot open this deck/);
  });
});

describe("readPptx — pictures (since 2026-10-10, when decks began carrying them)", () => {
  /** The engine's deck for a real page with a picture, through the real reader. */
  async function pictureDeck(): Promise<Uint8Array> {
    const fixture = await linesPdf([["A page with a picture"]], {
      picture: true,
    });
    const run = await runPdfOfficeExport("pdf-to-powerpoint", fixture.pdf, {
      extract: async () => pdftotextStandIn(fixture),
      scanPages: scanPdfPages,
    });
    if (!run.ok) throw new Error(run.message);
    return run.output;
  }

  it("POSITIVE CONTROL: passes the engine's deck, picture and all", async () => {
    const deck = await pictureDeck();
    expect((await readPptx(deck)).problems).toEqual([]);
    // Health: there IS a picture for the checks below to see.
    const zip = await JSZip.loadAsync(deck);
    expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).toMatch(
      /<p:pic>/,
    );
  });

  it.each([
    [
      "a picture with its parts out of order",
      "ppt/slides/slide1.xml",
      (x: string) =>
        x.replace(
          /(<p:pic>)(<p:nvPicPr>[\s\S]*?<\/p:nvPicPr>)(<p:blipFill>[\s\S]*?<\/p:blipFill>)/,
          "$1$3$2",
        ),
      /pic holds \[blipFill, nvPicPr, spPr\]/,
    ],
    [
      "a picture with no cNvPicPr",
      "ppt/slides/slide1.xml",
      (x: string) => x.replace(/<p:cNvPicPr>[\s\S]*?<\/p:cNvPicPr>/, ""),
      /nvPicPr holds \[cNvPr, nvPr\]/,
    ],
    [
      "a blipFill that does not start with its blip",
      "ppt/slides/slide1.xml",
      (x: string) =>
        x.replace(
          /(<p:blipFill>)(<a:blip [^>]*\/>)(<a:stretch>[\s\S]*?<\/a:stretch>)/,
          "$1$3$2",
        ),
      /blipFill does not start with a:blip/,
    ],
    [
      "a blip pointing at the slide's layout relationship",
      "ppt/slides/slide1.xml",
      (x: string) =>
        x.replace(/<a:blip r:embed="[^"]*"/, '<a:blip r:embed="rId1"'),
      /a:blip r:embed="rId1" is not an image relationship/,
    ],
    [
      "a picture offset that is not a number",
      "ppt/slides/slide1.xml",
      (x: string) => x.replace(/(<p:pic>[\s\S]*?<a:off x=")\d+/, "$1left"),
      /a:off x="left" is not a whole number/,
    ],
    [
      "a picture extent that is negative",
      "ppt/slides/slide1.xml",
      (x: string) => x.replace(/(<p:pic>[\s\S]*?<a:ext cx=")(\d+)/, "$1-$2"),
      /a:ext cx="-\d+" is not a whole, non-negative number/,
    ],
    [
      "an image part declared as something other than an image",
      "[Content_Types].xml",
      (x: string) =>
        x.replace(
          /<Default Extension="(png|jpeg)" ContentType="image\/(png|jpeg)"\/>/,
          '<Default Extension="$1" ContentType="application/octet-stream"/>',
        ),
      /is an image relationship, but ppt\/media\/image1\.\w+ is declared application\/octet-stream/,
    ],
  ])("NEGATIVE CONTROL: sees %s", async (_, part, edit, want) => {
    const broken = await mutate(await pictureDeck(), part, edit);
    const { problems } = await readPptx(broken);
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringMatching(want)]),
    );
  });
});
