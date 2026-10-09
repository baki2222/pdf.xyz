// @vitest-environment node
/**
 * What a null means in AI Data Extraction, said truly wherever it is said.
 *
 * THE DEFECT (2026-10-09). The engine tells the model "When a requested value
 * is not present in the text, use null — never a guess". A single-value field
 * whose text holds several DIFFERENT values has no one right answer, and a
 * model may answer null rather than pick one — the production proof of
 * ai-extract failed exactly that way: one `region` asked of a four-row table.
 * Every surface then told the user that null meant ABSENT: extraction.md
 * showed "_(not found)_", the manifest said "A value of null means the model
 * reported the field as not found", and the panel, the page and its FAQ said
 * the same. A user whose PDF holds four values was told it holds none.
 * Nothing about the model's behaviour changes here; what changes is that
 * every sentence explaining a null names both reasons, and the way out — ask
 * for a list.
 *
 * THE FIRST REWORDING OVERCLAIMED (review, 2026-10-09), twice. It said a field
 * "comes back null" / "is null" when it "matches more than once" — a
 * certainty the engine does not make true: its prompt says null only for a
 * value not present, so a model may as well return one of the several, and a
 * reader told that several values always give null takes any single value
 * for the only one. And "more than once" covers the commonest repeat, the
 * SAME value printed twice (an invoice number in the header and the footer),
 * which a model returns, not null. So the other reason is now DIFFERENT
 * values ({@link AMBIGUITY}); a sentence that ties null to several values must
 * hedge it ({@link HEDGE}) and say they differ; and the page and the package
 * must warn that a value that is not null may still be one of several. Its
 * sentences are a second corpus below, each caught.
 *
 * THAT GUARD READ "different values" ANYWHERE IN THE SENTENCE (re-review,
 * 2026-10-09). The warning it asked for — "a value that is not null may
 * still be one of several different values" — sits in the same sentence as
 * the reasons on the page, so it licensed any reason clause beside it: the
 * intro rewritten to "…or when it matches more than once; …", the FAQ to
 * "…or when the same value is printed more than once; …", and the second
 * reason dropped altogether all passed every check here. A clause
 * that ties null to "not found", or to "more than one" or "several", must now
 * say "different values" ITSELF; the three mutations are positive controls
 * below, made to the page as served.
 *
 * THE GUARD. Its subjects are DISCOVERED, at the point of consumption:
 *  - the package a user downloads — every file in it — built by the real
 *    engine from a reply with a null, in schema and prompt mode, with a cut
 *    window so the truncation sentence is there too;
 *  - the tool page as served — visible text and FAQPage JSON-LD — rendered in
 *    a fresh process (`@/tests/rendered-tool-pages`);
 *  - the panel the page dispatches for `ai-extract`, found by the page's own
 *    dispatch (`@/tests/worker-panel-dispatch`), read without comments.
 * A clause that says null means ABSENT ({@link ABSENCE}) must also name the
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

/**
 * What makes such a sentence true: the other reason a model gives null —
 * DIFFERENT values. WAS `more than (one|once)`, which the first rewording
 * satisfied with "matches more than once": a value printed twice, which a
 * model returns rather than nulls.
 */
const AMBIGUITY = /\bdifferent (?:values?|answers?)\b/i;

/** Words for "more than one", whether or not the values differ. */
const PLURAL = /\bmore than (?:one|once)\b|\bseveral\b/i;

/**
 * A null attributed to a field or by a model: "comes back null", "is null",
 * "answers null". Not the bare "to answer null rather than guess" — that is
 * the instruction, quoted, not a claim about what comes back.
 */
const NULL_PREDICATE = /\b(?:comes? back|is|answers) null\b/i;

/**
 * What makes "several values → null" a possibility, not a rule — read in the
 * CLAUSE that says null, not anywhere in the sentence: a mutation of the FAQ
 * to "a field is null when … several different values; a value that is not
 * null may still be one of several" stayed green while the hedge was read
 * per sentence (2026-10-09).
 */
const HEDGE = /\b(?:can|may)\b/i;

/** A sentence's clauses: at a semicolon, a colon, or ", so". */
const clauses = (sentence: string) => sentence.split(/\s*(?:[;:]|,\s+so\b)\s*/);

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

/**
 * Every null-explaining sentence of the FIRST rewording (c46ff2ad, 2026-10-09),
 * as it reached the package, the panel and the page.
 */
const FIRST_REWORDING: readonly string[] = [
  "_(not found, or more than one match)_",
  "A value of null means the model gave no single value for the field: it was not found, or it matched more than once — ask for the field as a list (the array type) to get every value.",
  "A field shown as not found, or more than one match, was judged on the pages examined only — it may still appear later in the document.",
  "The model is told to answer null rather than guess, so a field that matches more than once can come back null.",
  "A field shown as not found, or more than one match, was judged on those pages only — it may still appear later in the document.",
  "The model's instructions are to use only that text and to answer null rather than guess, so a field comes back null when its value is not found, or when it matches more than once; ask for a list to get every value.",
  "Because the model is told to answer null rather than guess, a null means the pages it saw did not settle it: the answer was not found there, or the text said more than one thing.",
  "A field of any other type asks for one value, so where the text holds several it can come back null.",
  "It shows a null value as not found, or more than one match, marks a requested field the model never returned as not returned by the model, and lists any keys you did not ask for in a separate table.",
  "A field shown as not found, or more than one match, was judged only on the text that was read, so it may still appear further on.",
  "A field comes back null when the model found no single answer for it: it is told to answer null rather than guess, so a field is null when its value is not found, or when it matches more than once.",
  "A single-value field asked of a column of figures has a candidate in every row; extraction.md shows it as not found, or more than one match.",
];

/**
 * The first rewording's sentences that said several values MAKE a null — the
 * two the review named on the page, and the two comments that said it first
 * (engine.ts's NULL_VALUE_CELL docblock, this file's own docblock).
 */
const FIRST_REWORDING_CERTAIN: readonly string[] = [
  FIRST_REWORDING[5]!,
  FIRST_REWORDING[10]!,
  'Not "not found": the model is told to answer null rather than guess, so a single-value field whose value appears several times comes back null too — the ai-extract production proof failed exactly that way (one region asked of a four-row table, 2026-10-09).',
  "A single-value field whose value appears SEVERAL times has no one right answer, so the model answers null — the instruction followed (the production proof of ai-extract failed exactly that way: one `region` asked of a four-row table).",
];

const saysAbsent = (sentence: string) => ABSENCE.some((p) => p.test(sentence));
/**
 * A sentence that says null means absent and stops there: some CLAUSE of it
 * says "not found" without "different values" in that clause. Read per
 * sentence until 2026-10-09 (re-review), the page's own warning clause — "a
 * value that is not null may still be one of several different values" —
 * licensed any reason clause beside it, "not found" alone included.
 */
const falseMeaning = (sentence: string) =>
  clauses(sentence).some((c) => saysAbsent(c) && !AMBIGUITY.test(c));
/**
 * A sentence that says several values make a null, as a rule: it speaks of
 * more than one value, and some clause of it says null comes back with no
 * hedge in that clause. The plural may sit in another clause — "a field has
 * several values, so the model answers null" is the same claim.
 */
const certainNull = (sentence: string) =>
  (PLURAL.test(sentence) || AMBIGUITY.test(sentence)) &&
  clauses(sentence).some((c) => NULL_PREDICATE.test(c) && !HEDGE.test(c));
/**
 * A sentence about null with a clause that says "more than one" or "several"
 * without saying, in that clause, that the values differ. The null may sit
 * in another clause — "a field may hold several values, so it can come back
 * null" — but the "different" must sit with the plural: read per sentence,
 * "…or when it matches more than once; a value that is not null may still be
 * one of several different values" passed on the second clause's words
 * (re-review, 2026-10-09).
 */
const repeatsAsReason = (sentence: string) =>
  /\bnull\b/i.test(sentence) &&
  clauses(sentence).some((c) => PLURAL.test(c) && !AMBIGUITY.test(c));

/** Refused by any check above. */
const flagged = (sentence: string) =>
  falseMeaning(sentence) || certainNull(sentence) || repeatsAsReason(sentence);

/** The live page's second reason, as its intro and its FAQ word it. */
const SECOND_REASON =
  ", or when the text holds several different values for it";

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
    // Two regions on the page and one asked for: a model MAY answer null
    // here, though the prompt asks for null only when a value is absent —
    // what the package says about that null is what is checked.
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

  it("every sentence of the first rewording is caught by some check, and each check catches one", () => {
    const caughtBy = (s: string) =>
      [
        falseMeaning(s) && "absence",
        certainNull(s) && "certain",
        repeatsAsReason(s) && "repeat",
      ].filter(Boolean);
    for (const sentence of FIRST_REWORDING)
      expect(caughtBy(sentence).length, sentence).toBeGreaterThan(0);
    for (const sentence of FIRST_REWORDING_CERTAIN)
      expect(certainNull(sentence), sentence).toBe(true);
    // Each check, and each alternative of each pattern, catches a shipped
    // sentence — none is decoration.
    const all = [...FIRST_REWORDING, ...FIRST_REWORDING_CERTAIN];
    expect(all.filter(falseMeaning).length).toBeGreaterThan(0);
    expect(all.filter(certainNull).length).toBeGreaterThan(0);
    expect(all.filter(repeatsAsReason).length).toBeGreaterThan(0);
    for (const alternative of ["comes back", "is", "answers"])
      expect(
        all.some(
          (s) =>
            certainNull(s) &&
            new RegExp(`\\b${alternative} null\\b`, "i").test(s),
        ),
        `"${alternative} null" catches no shipped sentence`,
      ).toBe(true);
    for (const plural of [/\bmore than (?:one|once)\b/i, /\bseveral\b/i])
      expect(
        all.some((s) => repeatsAsReason(s) && plural.test(s)),
        `${plural} catches no shipped sentence`,
      ).toBe(true);
    // NEGATIVE CONTROL: a hedged sentence that names different values is
    // none of these — each check can say yes and no.
    const hedged =
      "A field can come back null when its value is not found, or when the text holds several different values for it.";
    expect(caughtBy(hedged)).toEqual([]);
    // POSITIVE CONTROL for the clause: a hedge elsewhere in the sentence does
    // not license an unhedged "is null" — the FAQ mutation that once stayed green.
    expect(
      certainNull(
        "It is told to answer null rather than guess, so a field is null when its value is not found, or when the text holds several different values for it; a value that is not null may still be one of several different values.",
      ),
    ).toBe(true);
  });

  it("the sentence splitter keeps a table cell, a markdown note and a FAQ sentence whole", () => {
    // The splitter is the instrument: a sentence cut in half could separate
    // "not found" from the "different values" that makes it true.
    expect(
      sentences(
        "| po_number | _(not found, or several different values)_ |\nNext. A null field was not found, or held several different values. It cannot find. pdf.xyz says **so.** Then.",
      ),
    ).toEqual([
      "| po_number",
      "_(not found, or several different values)_",
      "Next.",
      "A null field was not found, or held several different values.",
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

  it("no sentence says several values MAKE a null — only that they can", () => {
    const found = Object.entries(surfaces).flatMap(([name, list]) =>
      list.filter(certainNull).map((s) => `${name}: ${s}`),
    );
    expect(found).toEqual([]);
  });

  it("no sentence gives a value found more than once as a reason for null without saying the values differ", () => {
    const found = Object.entries(surfaces).flatMap(([name, list]) =>
      list.filter(repeatsAsReason).map((s) => `${name}: ${s}`),
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

  it("the package and the page warn that a value that is not null may still be one of several", () => {
    // The convenient direction of the first rewording: told that several
    // values make a null, a reader takes any single value for the only one.
    for (const name of [
      "the schema-mode package",
      "the rendered page",
    ] as const)
      expect(
        surfaces[name]!.some(
          (s) =>
            /\bnot null\b/i.test(s) &&
            /\bone of several\b/i.test(s) &&
            HEDGE.test(s),
        ),
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

  it("no live sentence, on any surface, is refused by any check", () => {
    // Health: each surface is read whole — 66 to 168 sentences each on
    // 2026-10-09 — so a reader that lost most of one cannot pass vacuously.
    for (const [name, list] of Object.entries(surfaces))
      expect(list.length, name).toBeGreaterThan(40);
    expect(
      Object.entries(surfaces).flatMap(([name, list]) =>
        list.filter(flagged).map((s) => `${name}: ${s}`),
      ),
    ).toEqual([]);
  });

  it("POSITIVE CONTROL: a reason clause that is not 'different values' is refused, though the warning clause beside it says 'different values'", () => {
    // The re-review's mutations (2026-10-09), made to the page AS SERVED and
    // read back through its own splitter. All three stayed green while
    // AMBIGUITY was read anywhere in the sentence: the warning clause ("a
    // value that is not null may still be one of several different values")
    // licensed whatever reason clause sat beside it.
    const intro = sentences(page.text).filter(
      (s) => s.includes(SECOND_REASON) && /\bask for a list\b/.test(s),
    );
    const faq = page.faq.filter((q) =>
      sentences(q.answer).some(
        (s) => s.includes(SECOND_REASON) && !/\bask for a list\b/.test(s),
      ),
    );
    // Health: each mutation starts from ONE live sentence.
    expect(intro, "the intro's null sentence").toHaveLength(1);
    expect(faq, "the FAQ answer with the null sentence").toHaveLength(1);
    const mutations = [
      {
        name: "intro: 'or when it matches more than once'",
        text: page.text,
        from: intro[0]!,
        to: ", or when it matches more than once",
      },
      {
        name: "FAQ: 'or when the same value is printed more than once'",
        text: faq[0]!.answer,
        from: sentences(faq[0]!.answer).find((s) => s.includes(SECOND_REASON))!,
        to: ", or when the same value is printed more than once",
      },
      {
        name: "intro: the second reason dropped",
        text: page.text,
        from: intro[0]!,
        to: "",
      },
    ];
    for (const { name, text, from, to } of mutations) {
      const mutated = from.replace(SECOND_REASON, to);
      const served = text.replace(from, mutated);
      // Health: the mutation landed, in the sentence and in the served text.
      expect(mutated, name).not.toBe(from);
      expect(served, name).not.toBe(text);
      expect(sentences(text).filter(flagged), `${name}: before`).toEqual([]);
      expect(sentences(served).filter(flagged), name).toEqual([mutated]);
    }
  });

  it("POSITIVE CONTROL: the page sentences the review named are refused as the page splits them", () => {
    // Through the same splitter the rendered page goes through, so a check
    // that only matched the corpus strings — not served sentences — fails here.
    const page = `${FIRST_REWORDING[5]} pdf.xyz invents no values. Compare the value with the page. ${FIRST_REWORDING[10]} Give that field the array type.`;
    expect(sentences(page).filter(certainNull)).toEqual([
      FIRST_REWORDING[5],
      FIRST_REWORDING[10],
    ]);
  });
});
