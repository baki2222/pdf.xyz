// @vitest-environment node
/**
 * Markdown to PDF's page, held to the renderer the runner calls.
 *
 * The L09 fixes (20ba6ce: wrapped long words, tables drawn as grids, rules as
 * lines, setext headings, ~~~ and indented code, underscores inside words
 * kept) and the monospace pack (Geist Mono, `role: "monospace"`) each made a
 * sentence on this page false, and on 2026-10-06 it still served eleven of
 * them: lines "break only at spaces" and run off the page, a Chinese
 * paragraph "does not wrap", a table "collapses into a single paragraph",
 * === headings, ~~~ fences and indented code are "not recognised",
 * snake_case_name "prints as snakecasename", a --- rule "prints as three
 * hyphens", levels 3 to 6 share one size, the quote bar sits beside the first
 * line only, one ż makes code "no longer monospaced", and a Unicode document
 * "usually" fetches one font file. The only guard on the page's syntax copy
 * read the derived "Which Markdown does it support?" answer, which was true;
 * nothing read the authored intro, use cases or FAQ the page serves beside it.
 *
 * So this reads everything the page SERVES and holds it to the renderer:
 *
 *   - the sentences that shipped are the corpus of a ban list, in both
 *     directions (house rule 1), and each ban is licensed by running the
 *     parser or the renderer to show the claim false — if the code ever makes
 *     one true again, the licence goes red first, not the ban;
 *   - the font answers are checked by rendering the very examples the page
 *     names, with the shipped font files, and reading which faces the saved
 *     PDF embeds.
 */
import { inflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  type PDFFont,
} from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import { toolFacts } from "./tool-facts";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { markdownToPdf, parseMarkdownBlocks } from "@/lib/pdf/markdown-to-pdf";
import { wrapTextLine } from "@/lib/pdf/text-to-pdf";
import { fontPack, MONOSPACE_CLAIMS } from "@/lib/pdf/font-packs";
import { formatBytes } from "@/lib/utils";
import { embeddedFaces, useNodeFontSource } from "@/tests/unicode-fonts";

const SLUGS = supportedToolSlugs.filter(
  (s) => getRunnerKind(s) === "markdown-to-pdf",
);

/** Everything the tool page renders, as the page renders it. */
function served(slug: string): string[] {
  const tool = getToolBySlug(slug)!;
  return [
    tool.tagline,
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...toolFacts(slug).map((f) => f.value),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

const sentences = (texts: readonly string[]) =>
  texts.flatMap((t) => t.split(/(?<=[.!?])\s+/));

const answer = (pattern: RegExp) =>
  pageFaq(getToolBySlug(SLUGS[0]!)!).find((f) => pattern.test(f.question))
    ?.answer ?? "";

/* ------------------------------------------------------------------ *
 *  Reading the saved PDF: Western European runs, their size, and the
 *  rectangles drawn.
 * ------------------------------------------------------------------ */

const winAnsi = new TextDecoder("windows-1252");

function inflateMaybe(raw: Uint8Array): string {
  try {
    return inflateSync(Buffer.from(raw)).toString("latin1");
  } catch {
    return Buffer.from(raw).toString("latin1");
  }
}

async function contentStreams(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  return doc
    .getPages()
    .flatMap((page) => {
      const contents = doc.context.lookup(
        page.node.get(PDFName.of("Contents")),
      );
      const streams =
        contents instanceof PDFArray
          ? contents.asArray().map((ref) => doc.context.lookup(ref))
          : [contents];
      return streams
        .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
        .map((s) =>
          inflateMaybe((s as unknown as { contents: Uint8Array }).contents),
        );
    })
    .join("\n");
}

/** Every `<hex> Tj` with the font size in force, for standard-font output. */
async function runs(
  bytes: Uint8Array,
): Promise<{ text: string; size: number }[]> {
  const out: { text: string; size: number }[] = [];
  let size = 0;
  for (const op of (await contentStreams(bytes)).matchAll(
    /\/[^\s/]+\s+([\d.]+)\s+Tf|<([0-9A-Fa-f]*)>\s*Tj/g,
  )) {
    if (op[1]) size = Number(op[1]);
    else
      out.push({
        text: winAnsi.decode(Buffer.from(op[2]!, "hex")),
        size,
      });
  }
  return out;
}

/**
 * The width of every filled rectangle drawn. pdf-lib's `drawRectangle` writes
 * a path from the origin of a translated frame (`0 0 m 0 h l w h l w 0 l h f`),
 * not an `re` operator.
 */
async function rectangleWidths(bytes: Uint8Array): Promise<number[]> {
  return [
    ...(await contentStreams(bytes)).matchAll(
      /0 0 m\s+0 [\d.]+ l\s+([\d.]+) [\d.]+ l\s+[\d.]+ 0 l\s+h\s+f\b/g,
    ),
  ].map((m) => Number(m[1]));
}

/** A font whose every character is one em wide: the wrapper's only input. */
const EVEN_FONT = {
  widthOfTextAtSize: (text: string, size: number) =>
    Array.from(text).length * size,
} as unknown as PDFFont;

describe("markdown-to-pdf: the page describes what the renderer draws", () => {
  it("finds the one tool, and the page it serves is not empty (health)", () => {
    expect(SLUGS).toEqual(["markdown-to-pdf"]);
    expect(sentences(served(SLUGS[0]!)).length).toBeGreaterThan(30);
  });

  /*
   * The sentences that shipped, verbatim (the size range interpolated as it
   * rendered), and the shapes that ban them.
   */
  const SHIPPED = [
    "Lines break only at spaces.",
    "A long unbroken string, such as a URL or a minified line of code, is not split and can run off the right edge of the page.",
    "Chinese and Japanese are usually written without spaces, so a paragraph in either stays on one line and most of it falls off the page; put line breaks or spaces into long passages before converting.",
    "A Chinese or Japanese translation converts, but its paragraphs do not wrap.",
    "Chinese and Japanese draw correctly too, but read the question on long lines before converting paragraphs that have no spaces.",
    "Delete colour emoji such as ✅ or 🚀 first, since one stops the conversion, and expect a table in the reply to collapse into a single paragraph.",
    "A table's rows run together into one paragraph with the pipes left in, strikethrough markers are removed without drawing a line, raw HTML prints literally, and task-list boxes print as [ ] or [x].",
    "Underlined === headings, four-space indented code and ~~~ fences are not recognised: their lines are read as ordinary Markdown, so they mostly merge into body text, and a line inside them that starts with # or - turns into a heading or a bullet.",
    "Paired underscores or asterisks outside ``` fences are read as emphasis and deleted, inside backticks too, so snake_case_name prints as snakecasename.",
    "Nested items sit at their parent's indent, and numbered lists keep the numbers you typed.",
    "Tables and YAML front matter are not recognised, so their lines are parsed like any other Markdown and mostly print as plain paragraphs, and a --- rule prints as three hyphens rather than a line.",
    "For Western European text, # headings are bold, with level 1 largest, level 2 next and levels 3 to 6 sharing one size; list items are indented; each > quote line is italic with an accent bar beside its first line; and fenced code is set in a monospaced face under its language tag.",
    "One character outside that set anywhere in the text or the file name, even a Polish ż or an arrow such as →, moves the whole document to a single regular-weight Noto face: headings then differ by size only, quotes are upright and code is no longer monospaced.",
    "Besides the tool's own code, the only other thing it may fetch is Noto font data from pdf.xyz's own server, when your text or file name goes beyond the Western European set: usually one file, from 137.8 KB for Bengali to 10.1 MB for Chinese, and a second only if the first cannot shape every character.",
  ];
  const BANNED: RegExp[] = [
    // Wrapping said to happen only at spaces, or long text said to overflow.
    /\b(?:break|wrap)s? only at spaces\b/i,
    /\b(?:runs?|falls?) off\b/i,
    /\b(?:do|does) not wrap\b|\bstays? on one line\b/i,
    /\bparagraphs? that (?:have|has) no spaces\b/i,
    // Tables, setext headings, fences and front matter said to be unparsed.
    /\btables?\b[^.]*\b(?:collapse|run together|plain paragraphs?)\b/i,
    /\bnot recognised\b/i,
    /\bsnakecasename\b/,
    /\bat (?:their|its) parent's indent\b/i,
    /\bthree hyphens\b/i,
    // Heading sizes and the quote bar.
    /\bsharing one size\b/i,
    /\bbeside its first line\b/i,
    // Fonts.
    /\bcode is no longer monospaced\b/i,
    /\busually one file\b/i,
  ];

  it("the banned shapes and the sentences that shipped catch each other (both directions)", () => {
    const uncaught = SHIPPED.filter((s) => !BANNED.some((p) => p.test(s)));
    expect(uncaught).toEqual([]);
    const idle = BANNED.filter((p) => !SHIPPED.some((s) => p.test(s))).map(
      String,
    );
    expect(idle).toEqual([]);
  });

  it("no served sentence matches a banned shape", () => {
    const offenders = SLUGS.flatMap((slug) =>
      sentences(served(slug))
        .filter((s) => BANNED.some((p) => p.test(s)))
        .map((s) => `${slug}: "${s}"`),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  describe("each banned claim is false of the renderer (the bans' licence)", () => {
    it("a word wider than the line is split, in Latin and in unspaced Chinese", async () => {
      const url = `https://example.com/${"segment/".repeat(20)}end`;
      const drawn = (await runs(await markdownToPdf(`See ${url} now.`)))
        .map((r) => r.text)
        .filter((t) => /segment|end|https/.test(t));
      expect(drawn.length).toBeGreaterThan(1);
      expect(
        drawn
          .join("")
          .replace(/^See /, "")
          .replace(/ now\.$/, ""),
      ).toBe(url);
      const chinese = "机密文件测试".repeat(30);
      const lines = wrapTextLine(chinese, EVEN_FONT, 200, 10);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.join("")).toBe(chinese);
    });

    it("tables, setext headings, fences, indented code, front matter and rules are parsed as such", () => {
      const kinds = (md: string) => parseMarkdownBlocks(md).map((b) => b.kind);
      expect(kinds("| a | b |\n| - | - |\n| 1 | 2 |")).toEqual(["table"]);
      expect(kinds("Title\n=====")).toEqual(["heading"]);
      expect(kinds("~~~\n# not a heading\n- not a bullet\n~~~")).toEqual([
        "code",
      ]);
      expect(kinds("    # code\n    - code")).toEqual(["code"]);
      expect(kinds("---\ntitle: x\n---\n\nBody")).toEqual([
        "code",
        "paragraph",
      ]);
      expect(kinds("Above\n\n---\n\nBelow")).toEqual([
        "paragraph",
        "rule",
        "paragraph",
      ]);
    });

    it("underscores inside words survive, and nested items go deeper", () => {
      const [para] = parseMarkdownBlocks("snake_case_name and `my_var_x`");
      expect(para && "text" in para && para.text).toBe(
        "snake_case_name and my_var_x",
      );
      const depths = parseMarkdownBlocks("- a\n  - b\n    - c").map((b) =>
        b.kind === "list-item" ? b.depth : -1,
      );
      expect(depths).toEqual([0, 1, 2]);
    });

    it("each heading level has its own size, and the quote bar runs every line", async () => {
      const levels = [1, 2, 3, 4, 5, 6];
      const pdf = await markdownToPdf(
        levels.map((n) => `${"#".repeat(n)} Level${n}`).join("\n\n"),
      );
      const drawn = await runs(pdf);
      const sized = levels.map(
        (n) => drawn.find((r) => r.text === `Level${n}`)?.size ?? 0,
      );
      expect(new Set(sized).size).toBe(levels.length);
      expect([...sized].sort((a, b) => b - a)).toEqual(sized);
      const quote = `> ${"A quoted sentence that keeps going. ".repeat(12)}`;
      const quoteRuns = (await runs(await markdownToPdf(quote))).filter((r) =>
        /quoted|keeps|going/.test(r.text),
      );
      expect(quoteRuns.length).toBeGreaterThan(2);
      const bars = (await rectangleWidths(await markdownToPdf(quote))).filter(
        (w) => w === 3,
      );
      expect(bars.length).toBe(quoteRuns.length);
    });
  });

  describe("the font answers, rendered with the shipped font files", () => {
    let restore: () => void;
    beforeEach(() => {
      restore = useNodeFontSource();
    });
    afterEach(() => restore());

    const CODE = "\n\n```\ncode()\n```";
    const monoDrawsCode = async (markdown: string) =>
      (await embeddedFaces(await markdownToPdf(markdown))).some(
        (face) =>
          face.baseFont.includes("GeistMono") &&
          face.characters.includes("c") &&
          face.characters.includes("("),
      );

    it("the alphabets answer names the monospace face's set, and its examples keep code monospaced", async () => {
      const text = answer(/Which alphabets/);
      expect(text.length).toBeGreaterThan(100);
      for (const claim of MONOSPACE_CLAIMS)
        expect(text, `does not name ${claim.label}`).toContain(claim.label);
      for (const example of ["ż", "→"]) {
        expect(text).toContain(example);
        expect(
          await monoDrawsCode(`# Head\n\nGo ${example} there${CODE}`),
          `code beside ${example} left the monospace face`,
        ).toBe(true);
      }
    }, 60_000);

    it("every script the alphabets answer says moves code to the Noto face does", async () => {
      const SAMPLES: Record<string, string> = {
        Greek: "Απόρρητο έγγραφο",
        "✓": "Done ✓",
        Bengali: "গোপনীয় নথি",
        Chinese: "机密文件",
        Japanese: "ひらがなカタカナ",
        Korean: "기밀 문서",
      };
      const sentence =
        sentences([answer(/Which alphabets/)]).find((s) =>
          /\bNoto face too\b/.test(s),
        ) ?? "";
      const named = Object.keys(SAMPLES).filter((k) => sentence.includes(k));
      // Health: the page names its examples, and this reads them.
      expect(named.length).toBeGreaterThanOrEqual(4);
      for (const name of named) {
        expect(
          await monoDrawsCode(`# Head\n\n${SAMPLES[name]}${CODE}`),
          `${name} kept code in the monospace face`,
        ).toBe(false);
      }
    }, 120_000);

    it("the upload answer names the monospace download, and a Polish document embeds exactly it and one Noto face", async () => {
      const text = answer(/uploaded/);
      expect(text).toContain(formatBytes(fontPack("mono").bytes));
      const faces = await embeddedFaces(
        await markdownToPdf(`# Zażółć\n\ngęślą jaźń${CODE}`),
      );
      expect(
        faces.map((f) => f.baseFont.replace(/^\/|-\d+$/g, "")).sort(),
      ).toEqual(["GeistMono-Regular", "NotoSans-Regular"]);
    }, 60_000);
  });
});
