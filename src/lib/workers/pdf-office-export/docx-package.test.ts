/**
 * `./docx-package`'s `w:rFonts` (#28 slice 4, 2026-11-15): a word's typeface
 * as Word reads it. Read back from the package with `./docx-structure`'s
 * own parser and reader, never by matching the writer's strings.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { DocxDocument } from "./docx-layout";
import { docxPackage } from "./docx-package";
import type { DocxRunStyle } from "./docx-run-style";
import {
  docxStructureProblems,
  parseXml,
  readDocxStructure,
  type XmlElement,
} from "./docx-structure";

const doc = (runs: { text: string; style: DocxRunStyle | null }[]) =>
  ({
    page: { width: 612, height: 792, margin: 72 },
    pages: [
      [
        {
          kind: "text",
          cells: [runs.map((r) => r.text).join("")],
          runs: [runs],
        },
      ],
    ],
  }) as DocxDocument;

/** Every `<w:rPr>` of the body, as the reader's parser sees it. */
async function runPropertiesOf(bytes: Uint8Array): Promise<XmlElement[]> {
  const zip = await JSZip.loadAsync(bytes);
  const { root } = parseXml(
    await zip.file("word/document.xml")!.async("string"),
  );
  const out: XmlElement[] = [];
  const walk = (el: XmlElement) => {
    if (el.name === "w:rPr") out.push(el);
    for (const c of el.children) if (typeof c !== "string") walk(c);
  };
  walk(root!);
  return out;
}

const children = (el: XmlElement) =>
  el.children.filter((c): c is XmlElement => typeof c !== "string");

describe("docxPackage writes a word's typeface", () => {
  it("as w:rFonts, the FIRST child of w:rPr, ascii then hAnsi then cs, all three the family, never eastAsia", async () => {
    const bytes = (
      await docxPackage(
        doc([
          {
            text: "Bold",
            style: {
              bold: true,
              italic: true,
              halfPoints: 24,
              color: "FF0000",
              typeface: "Georgia",
            },
          },
        ]),
      )
    ).bytes;
    expect(await docxStructureProblems(bytes)).toEqual([]);
    const [rPr] = await runPropertiesOf(bytes);
    const names = children(rPr!).map((c) => c.name);
    expect(names).toEqual([
      "w:rFonts",
      "w:b",
      "w:bCs",
      "w:i",
      "w:iCs",
      "w:color",
      "w:sz",
      "w:szCs",
    ]);
    const fonts = children(rPr!)[0]!;
    expect(Object.keys(fonts.attrs)).toEqual(["w:ascii", "w:hAnsi", "w:cs"]);
    const body = await readDocxStructure(bytes);
    const run = body.blocks.flatMap((b) => (b.kind === "p" ? b.runs : []))[0]!;
    expect(run).toMatchObject({
      fonts: "Georgia",
      fontsHAnsi: "Georgia",
      fontsCs: "Georgia",
    });
    expect(run.fontsEastAsia).toBeUndefined();
    expect(run.fontsOther).toBeUndefined();
  });

  it("escapes the family name, and the reader reads it back exactly", async () => {
    const odd = `A&B "Sans" <x>`;
    const bytes = (
      await docxPackage(doc([{ text: "x", style: { typeface: odd } }]))
    ).bytes;
    expect(await docxStructureProblems(bytes)).toEqual([]);
    const run = (await readDocxStructure(bytes)).blocks.flatMap((b) =>
      b.kind === "p" ? b.runs : [],
    )[0]!;
    expect([run.fonts, run.fontsHAnsi, run.fontsCs]).toEqual([odd, odd, odd]);
  });

  it("a style with no typeface writes no w:rFonts, and a word with no style no w:rPr", async () => {
    const bytes = (
      await docxPackage(
        doc([
          { text: "sized ", style: { halfPoints: 24 } },
          { text: "plain", style: null },
        ]),
      )
    ).bytes;
    const props = await runPropertiesOf(bytes);
    expect(props).toHaveLength(1);
    expect(children(props[0]!).map((c) => c.name)).toEqual(["w:sz", "w:szCs"]);
  });

  it("no font is embedded: no fontTable part, no word/fonts/ part, no w:embed* anywhere", async () => {
    const bytes = (
      await docxPackage(doc([{ text: "x", style: { typeface: "Arial" } }]))
    ).bytes;
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    // Health: the package has its parts.
    expect(names).toContain("word/document.xml");
    expect(names.filter((n) => /fontTable|^word\/fonts\//i.test(n))).toEqual(
      [],
    );
    for (const n of names.filter((x) => /\.(xml|rels)$/.test(x)))
      expect(await zip.file(n)!.async("string"), n).not.toMatch(
        /w:embed|fontTable/,
      );
  });
});
