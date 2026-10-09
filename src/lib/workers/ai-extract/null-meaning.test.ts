// @vitest-environment node
/**
 * What a null means in AI Data Extraction, said truly wherever it is said.
 *
 * THE DEFECT (2026-10-09). The engine tells the model "When a requested value
 * is not present in the text, use null — never a guess". A single-value field
 * whose value appears SEVERAL times has no one right answer, so the model
 * answers null — the instruction followed (the production proof of ai-extract
 * failed exactly that way: one `region` asked of a four-row table). Every
 * surface then told the user that null meant ABSENT: extraction.md showed
 * "_(not found)_", the manifest said "A value of null means the model
 * reported the field as not found", and the panel, the page and its FAQ said
 * the same. A user whose PDF holds the value four times was told it holds it
 * none. Nothing about the model's behaviour changes here; what changes is
 * that every sentence explaining a null now names both reasons, and the way
 * out — ask for a list.
 *
 * THE GUARD. Its subjects are DISCOVERED, at the point of consumption:
 *  - the package a user downloads — every file in it — built by the real
 *    engine from a reply with a null, in schema and prompt mode, with a cut
 *    window so the truncation sentence is there too;
 *  - the tool page as served — visible text and FAQPage JSON-LD — rendered in
 *    a fresh process (`@/tests/rendered-tool-pages`);
 *  - the panel the page dispatches for `ai-extract`, found by the page's own
 *    dispatch (`@/tests/worker-panel-dispatch`), read without comments.
 * A sentence that says null means ABSENT ({@link ABSENCE}) must also name the
 * other reason ({@link AMBIGUITY}). Each surface must contribute at least one
 * such sentence — a surface that stopped explaining null would otherwise pass
 * by saying nothing (`[] ⊆ X`).
 *
 * CORPUS IN BOTH DIRECTIONS (CLAUDE.md rule 1): every sentence that shipped
 * with the false meaning is caught by some ABSENCE shape, and every shape
 * catches some shipped sentence.
 */
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { ExtractOptions } from "@/lib/jobs/ai-extract";
import type { AiProvider } from "../ai/provider";
import { runAiExtract } from "./engine";
import { createRequire } from "node:module";
import type * as TS from "typescript";
import { flattenForPhraseSearch } from "@/lib/tools/copy-surface";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";
import { panelDispatchArms } from "@/tests/worker-panel-dispatch";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

/** Shapes that tell a user a null means the value is ABSENT. */
const ABSENCE: readonly RegExp[] = [
  // "_(not found)_", "reported as not found", "null values as not found"
  /\bnot found\b/i,
  // "answer null for whatever it cannot find"
  /\bcannot find\b/i,
  // "use null when the text is silent"
  /\bis silent\b/i,
];

/** What makes such a sentence true: the other reason a model answers null. */
const AMBIGUITY = /\bmore than (?:one|once)\b/i;

/** Every sentence of the false meaning the product shipped (origin/main, 2026-10-09). */
const SHIPPED: readonly string[] = [
  "| po_number | _(not found)_ |",
  "Fields shown as `null` were not found in the pages examined — they may still appear later in the document.",
  "A value of null means the model reported the field as not found; a requested field the model did not return at all is also null in extraction.json, and is listed in manifest.json under extraction.missingKeys.",
  "A field reported as not found was not found in those pages — it may still appear later in the document.",
  "The model's instructions are to use only that text and to answer null for whatever it cannot find.",
  "Because the model is told to use null when the text is silent, a null reads as not found in the pages it saw, which is weaker than a confirmed no.",
  "It shows null values as not found, marks a requested field the model never returned as not returned by the model, and lists any keys you did not ask for in a separate table.",
  "A field reported as not found may still appear further on.",
];

const saysAbsent = (sentence: string) => ABSENCE.some((p) => p.test(sentence));
/** A sentence that says null means absent and stops there. */
const falseMeaning = (sentence: string) =>
  saysAbsent(sentence) && !AMBIGUITY.test(sentence);

/** Sentences, as a reader meets them: by line, by table cell, by full stop. */
function sentences(text: string): string[] {
  return (
    text
      // After a full stop, whatever follows: "find. pdf.xyz" is two sentences,
      // and merging them could let one sentence's "more than one" license the
      // other's "not found". Markdown emphasis may close a sentence ("…**").
      .split(/\n+|\s\|\s|(?<=[.!?][*_)"”]*)\s+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 0)
  );
}

// ── the package ─────────────────────────────────────────────────────────────

/** Two pages, the second past the read window, so the cut is disclosed. */
const PAGE_1 = "Invoice INV-7 from Acme. Region North 1200. Region South 980.";
const PAGE_2 = "Payment terms: 30 days. Late fee 2%.";
const extract = async (): Promise<ExtractedPdfText> => {
  const text = `${PAGE_1}\n\n${PAGE_2}`;
  return {
    pageCount: 2,
    pages: [
      { pageNumber: 1, text: PAGE_1, characterCount: PAGE_1.length },
      { pageNumber: 2, text: PAGE_2, characterCount: PAGE_2.length },
    ],
    text,
    characterCount: text.length,
    hasText: true,
  };
};

const replying = (reply: unknown): AiProvider => ({
  id: "openai",
  model: "gpt-test",
  complete: async () => ({
    ok: true,
    text: JSON.stringify(reply),
    model: "gpt-test",
  }),
});

/** Every file of a package the engine builds for `options` from `reply`. */
async function packageText(
  options: ExtractOptions,
  reply: unknown,
): Promise<string> {
  const run = await runAiExtract(new Uint8Array([1]), options, {
    extract,
    provider: replying(reply),
    // Page 1 and a little more: the window ends inside page 2.
    limits: { maxInputChars: PAGE_1.length + 6 },
  });
  if (!run.ok) throw new Error(`engine: ${run.message}`);
  const zip = await JSZip.loadAsync(run.output);
  const files = await Promise.all(
    Object.values(zip.files).map((f) => f.async("string")),
  );
  // Health: the package is the five files a user downloads.
  expect(Object.keys(zip.files).sort()).toEqual([
    "README.txt",
    "extraction.json",
    "extraction.md",
    "manifest.json",
    "model-output.json",
  ]);
  return files.join("\n");
}

// ── the surfaces ────────────────────────────────────────────────────────────

/**
 * The text a panel can show: every string literal, template text and JSX
 * text in its source, read through the TypeScript parser — so a sentence is
 * never glued to the markup around it, and a comment is never copy.
 */
function panelCopy(source: string): string[] {
  const file = ts.createSourceFile(
    "panel.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: string[] = [];
  const walk = (n: TS.Node) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isJsxText(n)
    )
      out.push(n.text);
    else if (ts.isTemplateExpression(n))
      out.push(
        [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" "),
      );
    ts.forEachChild(n, walk);
  };
  walk(file);
  return out.map((text) => flattenForPhraseSearch(text));
}

let page: RenderedToolPage;
let surfaces: Record<string, string[]>;

beforeAll(async () => {
  const schemaPackage = await packageText(
    {
      mode: "schema",
      schema: [
        { name: "region", type: "string" },
        { name: "q1", type: "number" },
      ],
    },
    // One region of two is a guess, so null — the instruction followed.
    { region: null, q1: 1200 },
  );
  const promptPackage = await packageText(
    { mode: "prompt", prompt: "Extract the region and its Q1 figure." },
    { region: null, invoice: "INV-7" },
  );
  page = renderToolPages().get("ai-extract")!;
  const arm = panelDispatchArms().find((a) => a.slugs.includes("ai-extract"));
  if (!arm) throw new Error("the tool page dispatches no panel for ai-extract");
  const panelFile = path.resolve(
    arm.specifier.replace(/^@\//, "src/") + ".tsx",
  );
  surfaces = {
    "the schema-mode package": sentences(schemaPackage),
    "the prompt-mode package": sentences(promptPackage),
    "the rendered page": [
      ...sentences(page.text),
      ...page.faq.flatMap((q) => sentences(q.answer)),
    ],
    "the panel": panelCopy(readFileSync(panelFile, "utf8")).flatMap(sentences),
  };
}, 180_000);

describe("the corpus", () => {
  it("every sentence that shipped the false meaning is caught, and every shape catches one", () => {
    for (const sentence of SHIPPED)
      expect(falseMeaning(sentence), sentence).toBe(true);
    for (const shape of ABSENCE)
      expect(
        SHIPPED.some((s) => shape.test(s)),
        `${shape} catches no shipped sentence`,
      ).toBe(true);
  });

  it("the sentence splitter keeps a table cell, a markdown note and a FAQ sentence whole", () => {
    // The splitter is the instrument: a sentence cut in half could separate
    // "not found" from the "more than one" that makes it true.
    expect(
      sentences(
        "| po_number | _(not found, or more than one match)_ |\nNext. A null field was not found, or matched more than once. It cannot find. pdf.xyz says **so.** Then.",
      ),
    ).toEqual([
      "| po_number",
      "_(not found, or more than one match)_",
      "Next.",
      "A null field was not found, or matched more than once.",
      "It cannot find.",
      "pdf.xyz says **so.**",
      "Then.",
    ]);
  });
});

describe("every surface says what a null means truly", () => {
  it("each surface explains a null at least once (the guard is not reading silence)", () => {
    expect(page, "the ai-extract page did not render").toBeDefined();
    for (const [name, list] of Object.entries(surfaces))
      expect(list.filter(saysAbsent).length, name).toBeGreaterThan(0);
  });

  it("no sentence says a null means absent without naming the other reason", () => {
    const found = Object.entries(surfaces).flatMap(([name, list]) =>
      list.filter(falseMeaning).map((s) => `${name}: ${s}`),
    );
    expect(found).toEqual([]);
  });

  it("the package and the page say how to get every value: ask for a list", () => {
    for (const name of [
      "the schema-mode package",
      "the rendered page",
    ] as const)
      expect(
        surfaces[name]!.some((s) => AMBIGUITY.test(s) && /\blist\b/i.test(s)),
        name,
      ).toBe(true);
  });

  it("POSITIVE CONTROL: the package as it shipped is refused", () => {
    expect(
      sentences("| region | _(not found)_ |\n| q1 | 1200 |").filter(
        falseMeaning,
      ),
    ).toEqual(["_(not found)_"]);
  });
});
