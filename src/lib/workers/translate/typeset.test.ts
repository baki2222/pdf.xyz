// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TRANSLATE_LANGUAGES } from "@/lib/jobs/translate-pdf";
import { TRANSLATE_RTL_LANGUAGES } from "@/lib/jobs/translate-pdf-render";
import { HTML_DOCUMENT_URL } from "../html-render/document-url";
import { gapMarkdown, type TranslationPart } from "./assembly";
import {
  pageRangeLabel,
  translationDirection,
  translationDocument,
  translationHtml,
  typesetText,
} from "./typeset";

const HOSTILE = [
  "Avant <script>alert(1)</script> après.",
  "Fin de style </style> ici.",
  "Une image <img src=http://x> ici.",
  "Un chemin file:///etc/passwd ici.",
].join("\n\n");

const PARTS: TranslationPart[] = [
  { kind: "body", pages: [1, 2, 3], text: `# Titre\n\n${HOSTILE}` },
  { kind: "gap", reason: "oversize", pages: [4], characters: 12_345 },
  {
    kind: "body",
    pages: [5],
    text: "- un\n- deux\n\n1. premier\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode <x>\n```",
  },
  { kind: "gap", reason: "interrupted", pages: [6, 7] },
];

const input = (target: (typeof TRANSLATE_LANGUAGES)[number] = "fr") => ({
  parts: PARTS,
  target,
  sourceName: "Rapport <final>.pdf",
});

/** Tags in the HTML — a `<` that survived escaping starts one. */
const tagNames = (html: string) =>
  [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) =>
    m[1]!.toLowerCase(),
  );

describe("every text run is escaped, and nothing is fetched", () => {
  const html = translationHtml(input());

  it("hostile text renders as text, never as markup", () => {
    const tags = new Set(tagNames(html));
    expect(tags.has("script")).toBe(false);
    expect(tags.has("img")).toBe(false);
    // Exactly one </style>: the document's own.
    expect(html.split("</style>")).toHaveLength(2);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=http://x&gt;");
    expect(html).toContain("&lt;/style&gt;");
    expect(html).toContain("file:///etc/passwd");
  });

  it("positive control: the tag scanner sees a tag that was not escaped", () => {
    expect(tagNames("<p>a <script>x</script></p>")).toContain("script");
  });

  it("no link, no source, no remote font", () => {
    expect(html).not.toMatch(/<[^>]*\s(?:href|src)\s*=/i);
    expect(html).not.toMatch(/@font-face/i);
    expect(html).not.toMatch(/url\(/i);
  });

  it("the text the PDF must carry is the raw text, unescaped", () => {
    const text = typesetText(input());
    expect(text).toContain("<script>alert(1)</script>");
    expect(text).toContain("Rapport <final>.pdf");
    expect(text).toContain("Translated to French by an AI model");
    expect(text).toContain("•");
    expect(text).toContain("1.");
  });

  it("serves the one document and nothing else", () => {
    const pkg = translationDocument(input());
    expect(pkg.documents.map((d) => d.url)).toEqual([HTML_DOCUMENT_URL]);
    expect(pkg.serve(HTML_DOCUMENT_URL)?.contentType).toMatch(/text\/html/);
    expect(pkg.serve(`${HTML_DOCUMENT_URL}x.css`)).toBeNull();
    expect(pkg.serve("https://example.com/")).toBeNull();
  });
});

describe("the writing direction is derived from the target", () => {
  const dirOf = (html: string) => /<html[^>]*\sdir="(rtl|ltr)"/.exec(html)?.[1];

  it.each(TRANSLATE_LANGUAGES.map((l) => [l]))("%s", (target) => {
    const expected = (TRANSLATE_RTL_LANGUAGES as readonly string[]).includes(
      target,
    )
      ? "rtl"
      : "ltr";
    expect(translationDirection(target)).toBe(expected);
    expect(dirOf(translationHtml(input(target)))).toBe(expected);
  });

  it("positive control: Arabic really is laid out right-to-left", () => {
    expect(dirOf(translationHtml(input("ar")))).toBe("rtl");
    expect(TRANSLATE_RTL_LANGUAGES).toContain("ar");
  });
});

describe("gaps are words only", () => {
  const FE0F = String.fromCharCode(0xfe0f);
  const WARN = String.fromCharCode(0x26a0);
  const asides = (html: string) =>
    [...html.matchAll(/<aside>([\s\S]*?)<\/aside>/g)].map((m) => m[1]!);

  it("positive control: the ZIP's marker carries the emoji the PDF must not", () => {
    const zip = gapMarkdown({ kind: "gap", reason: "interrupted", pages: [6] });
    expect(zip.includes(FE0F)).toBe(true);
    expect(zip.includes(WARN)).toBe(true);
  });

  it("no aside carries U+FE0F or U+26A0", () => {
    const found = asides(translationHtml(input()));
    expect(found).toHaveLength(2);
    for (const aside of found) {
      expect(aside.includes(FE0F)).toBe(false);
      expect(aside.includes(WARN)).toBe(false);
    }
    expect(found[0]).toContain("Page 4 is not translated.");
    expect(found[1]).toContain("Pages 6–7 could not be translated.");
  });
});

describe("section headings equal the parts' page ranges", () => {
  it("one h2 per body, naming its own pages", () => {
    const html = translationHtml(input());
    const headings = [...html.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map(
      (m) => m[1],
    );
    const expected = PARTS.filter((p) => p.kind === "body").map((p) =>
      pageRangeLabel(p.pages),
    );
    expect(headings).toEqual(expected);
    expect(expected).toEqual(["Pages 1–3", "Page 5"]);
  });

  it("an unchunked body has no page heading to invent", () => {
    const html = translationHtml({
      parts: [{ kind: "body", pages: [], text: "Bonjour." }],
      target: "fr",
      sourceName: "a.pdf",
    });
    expect(html).not.toMatch(/<h2>/);
    expect(html).toContain("<p>Bonjour.</p>");
  });
});
