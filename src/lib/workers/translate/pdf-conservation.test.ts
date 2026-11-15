// @vitest-environment node
/**
 * The per-job text check is against the ASSEMBLED TRANSLATION — the bodies the
 * model returned, which the ZIP carries byte for byte — not against the
 * typesetter's own output.
 *
 * HISTORY, kept on purpose (2026-11-15, review r1 of feat/translate-pdf-output):
 *   The check used to compare `pdftotext`'s read-back with `typesetText`, which
 *   is recorded as the HTML is written — AFTER `parseMarkdownBlocks` has run.
 *   Whatever the parser dropped was missing from both sides, so the check
 *   passed by construction: a translated reference list
 *   `参考文献\n\n[1]: 山田太郎\n[2]: 鈴木花子` parses as two link-reference
 *   definitions, prints as "参考文献" alone, and was delivered as a PDF beside a
 *   `translation.md` that carried both names (CLAUDE.md rule 5: the check
 *   verified the author's artifact, not what the reader receives). The first
 *   test below was green on that code with `ok: true`; it is the inverted pin.
 *
 * The comparison now reads the parts' raw text, with only Markdown SYNTAX
 * allowed to go missing (`MARKDOWN_SYNTAX`, and the three syntax-only spans
 * `markdownContent` removes). The corpus below runs in BOTH directions
 * (CLAUDE.md rule 1): every syntax member is stripped by some shape the
 * typesetter really prints, and every lossy shape is refused.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { ChromiumPackageRunner } from "../html-render/engine";
import type { TranslationPart } from "./assembly";
import { partsToMarkdown } from "./assembly";
import {
  MARKDOWN_SYNTAX,
  carriesTranslation,
  conservedCodePoints,
  markdownContent,
  renderTranslationPdf,
} from "./pdf-render";
import {
  typesetFurnitureText,
  typesetText,
  type TypesetInput,
} from "./typeset";

const body = (text: string): TranslationPart => ({
  kind: "body",
  pages: [1],
  text,
});
const inputOf = (text: string, target: TypesetInput["target"] = "fr") =>
  ({ parts: [body(text)], target, sourceName: "paper.pdf" }) as TypesetInput;

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

/** A renderer and a reader that print and read back EXACTLY what was typeset. */
async function faithfulRun(input: TypesetInput) {
  const pdf = await blankPdf();
  const chromium: ChromiumPackageRunner = { renderPackage: async () => [pdf] };
  return renderTranslationPdf({
    chromium,
    readBack: async () => typesetText(input),
    input,
  });
}

/** Text the parser drops although the ZIP carries it. */
const LOSSY: Record<string, { text: string; lost: string; target?: "ja" }> = {
  "a Japanese reference list": {
    text: "参考文献\n\n[1]: 山田太郎\n[2]: 鈴木花子",
    lost: "山田太郎",
    target: "ja",
  },
  "a German reference list": {
    text: "Literatur\n\n[1]: Mueller\n[2]: Schmidt",
    lost: "Mueller",
  },
  "an unused reference line": {
    text: "Siehe oben.\n\n[Quelle]: https://example.org/q",
    lost: "Quelle",
  },
};

describe("the check reads the translation the ZIP carries", () => {
  for (const [name, { text, lost, target }] of Object.entries(LOSSY)) {
    it(`${name}: a PDF that printed only what the parser kept is withheld`, async () => {
      const input = inputOf(text, target);
      // Health: the shape really is lossy, and the ZIP really has the words.
      expect(partsToMarkdown(input.parts)).toContain(lost);
      expect(typesetText(input)).not.toContain(lost);
      expect(await faithfulRun(input)).toEqual({
        ok: false,
        reason: "not_conserved",
      });
    });
  }

  it("the furniture cannot mask a loss: a word in the title does not stand in for the body", () => {
    const input: TypesetInput = {
      parts: [body("Literatur\n\n[1]: Mueller")],
      target: "de",
      sourceName: "Mueller.pdf",
    };
    expect(carriesTranslation(input, typesetText(input))).toBe(false);
    expect(typesetFurnitureText(input)).toContain("Mueller.pdf");
  });
});

/**
 * Markdown the typesetter prints faithfully, each shape stripping some syntax.
 * A PDF of any of these must pass — a check that refused ordinary Markdown
 * would withhold every PDF and look like caution.
 */
const FAITHFUL: Record<string, string> = {
  headings: "# Titre\n\n## Sous-titre\n\nSetext\n======\n\nAutre\n------",
  emphasis: "**gras** et *italique* et __b__ et _i_ et ~~barré~~",
  code: "`code` puis\n\n```js\nlet a = 1;\n```\n\n    indenté",
  quote: "> cité\n> > deux fois",
  bullets: "- un\n- deux\n  - trois\n* quatre\n+ cinq",
  ordered: "1. un\n2. deux\n3. trois",
  "ordered, all ones": "1. un\n1. deux\n1. trois",
  "ordered from five": "5. cinq\n6. six",
  table: "| a | b |\n|:--|--:|\n| c | d |",
  rules: "texte\n\n---\n\n***\n\nfin",
  links: "voir [le site](https://ex.com/a) et ![image](https://ex.com/i.png)",
  autolink: "voir <https://ex.com> et https://ex.com/b",
  footnote: "texte[^1]\n\n[^1]: une note",
  "named footnote": "texte[^x]\n\n[^x]: une note",
  tasks: "- [ ] tâche\n- [x] faite",
  "inline html": "a <b>gras</b> <!-- c --> d",
  breaks: "ligne  \nsuivante\\\nautre",
  plain: "Hello, world: 1-2; (x) [y] {z} a_b c*d e#f g|h i~j k>l m+n o=p q!r",
  japanese: "第一章\n\n本文です。数字123とPDFを含む。",
};

describe("ordinary Markdown passes (positive control)", () => {
  for (const [name, text] of Object.entries(FAITHFUL)) {
    it(`${name}`, async () => {
      const input = inputOf(text);
      expect(carriesTranslation(input, typesetText(input))).toBe(true);
      expect((await faithfulRun(input)).ok).toBe(true);
    });
  }
});

describe("MARKDOWN_SYNTAX is exactly what the corpus strips (both directions)", () => {
  /** Code points of the raw text the typesetter printed fewer of. */
  function stripped(text: string): Set<string> {
    const input = inputOf(text);
    const raw = conservedCodePoints(markdownContent(text));
    const out = conservedCodePoints(typesetText(input));
    const furniture = conservedCodePoints(typesetFurnitureText(input));
    const lost = new Set<string>();
    for (const [c, n] of raw)
      if ((out.get(c) ?? 0) < n + (furniture.get(c) ?? 0)) lost.add(c);
    return lost;
  }

  const strippedByCorpus = new Set(
    Object.values(FAITHFUL).flatMap((t) => [...stripped(t)]),
  );

  it("health: the corpus is not empty and really strips something", () => {
    expect(Object.keys(FAITHFUL).length).toBeGreaterThanOrEqual(15);
    expect(strippedByCorpus.size).toBeGreaterThanOrEqual(10);
  });

  it("every member is stripped by some shape the typesetter really prints", () => {
    const decorative = [...MARKDOWN_SYNTAX].filter(
      (c) => !strippedByCorpus.has(c),
    );
    expect(decorative).toEqual([]);
  });

  it("everything the corpus strips is a member", () => {
    const holes = [...strippedByCorpus].filter((c) => !MARKDOWN_SYNTAX.has(c));
    expect(holes).toEqual([]);
  });

  it("no letter, digit or CJK character is ever syntax", () => {
    expect([...MARKDOWN_SYNTAX].filter((c) => /[\p{L}\p{N}]/u.test(c))).toEqual(
      [],
    );
  });
});

describe("markdownContent removes only syntax-only spans", () => {
  it("ordered-list numbers, footnote labels and fence lines", () => {
    expect(markdownContent("1. un\n  12) deux\n> 3. trois")).toBe(
      " un\n   deux\n>  trois",
    );
    expect(markdownContent("a[^note] b\n\n[^note]: c")).toBe("a b\n\n: c");
    expect(markdownContent("```js\nx\n```")).toBe("\nx\n");
  });

  it("leaves a numbered sentence and a reference definition alone", () => {
    expect(markdownContent("In 2024. the year")).toBe("In 2024. the year");
    expect(markdownContent("[1]: 山田太郎")).toBe("[1]: 山田太郎");
  });
});
