/**
 * Translate PDF's column-order and page-heading sentences (audit #29).
 *
 * ── HISTORY ────────────────────────────────────────────────────────────────
 *
 * Slice 3 (2026-11-16) wrote this file to keep useCases[1] TRUE ON BOTH
 * WORKER IMAGES while the old one (which always sent a two-column page line
 * by line across it) could still be running. It pinned the both-states
 * DISCLOSURE: "On a two-column paper, our server can send the two columns'
 * lines to the model interleaved, so compare the order of the translated
 * paragraphs with the original before you rely on it." Three tests held it:
 *
 *   - "still discloses that columns can reach the model interleaved"
 *     (`/interleav/i` and `/\bcan send\b/i` REQUIRED);
 *   - "makes no positive claim that columns are read in order" (`column by
 *     column`, `one after the other` BANNED);
 *   - the old-image sentence "reads each line straight across" banned.
 *
 * Slice 5 (2026-11-16) flipped the copy after `translateReadingOrder` and
 * `translatePageMap` were observed in production and one real job of each
 * was decoded (a two-column page came back Z1..Z4 then Q1..Q4; a three-page
 * PDF printed "Page 1", "Page 2", "Page 3", each over its own code word).
 * The tests were INVERTED, not deleted (house rule): the positive claim is now
 * REQUIRED, the interleave admission is BANNED with its shipped sentences as
 * the corpus in both directions, and what slice 3 really meant by requiring
 * "interleav" — that fallback pages are disclosed — survives as a required
 * FALLBACK CLAUSE, for as long as any fallback reason exists.
 *
 * Review (2026-11-16) found both new sentences naming a cause the worker does
 * not have: a column-order CHECK (none exists; the ink gate is order-blind)
 * and the MODEL as the only reason pages share a heading (the server sends no
 * marker on "collision" or "budget"). The sentences now state outcomes; the
 * required shapes were inverted, and the retired causes are banned with their
 * shipped sentences as the corpus.
 */
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { guides } from "@/lib/guides";
import type { AiReadingOrderMeta } from "@/lib/jobs/ai-results";
import {
  TRANSLATE_COLUMN_ORDER,
  TRANSLATE_PAGE_HEADINGS,
} from "@/lib/jobs/translate-reading-copy";
import { pageRangeLabel } from "@/lib/workers/translate/typeset";
import { isStrongRtl } from "@/lib/workers/translate/reading-order";
import { ADVERTISED_WORKER_CAPABILITIES } from "@/lib/workers/observability/snapshot";
import { getToolContent } from "./content";
import {
  pageContent,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";

const TOOL = "translate-pdf";

interface Entry {
  readonly where: string;
  readonly text: string;
}

/**
 * Translate's surfaces, DISCOVERED: the tool page through the accessors the
 * page renders, every guide whose primary tool is Translate, and the two
 * operations promises that name these sentences. A named list of fields
 * could not see a field it did not name.
 */
function translateSurfaces(): Entry[] {
  const tool = getToolBySlug(TOOL);
  if (!tool) throw new Error(`${TOOL} left the catalogue`);
  const out: Entry[] = [];
  const at = (where: string, text: string) => out.push({ where, text });
  at("description", tool.description);
  pageSteps(tool).forEach((s, i) => at(`how[${i}]`, stepText(s)));
  pageFaq(tool).forEach((f, i) => {
    at(`faq[${i}].question`, f.question);
    at(`faq[${i}].answer`, f.answer);
  });
  pageIntro(tool).forEach((p, i) => at(`intro[${i}]`, p));
  pageUseCases(tool).forEach((u, i) => {
    at(`useCases[${i}].title`, u.title);
    at(`useCases[${i}].body`, u.body);
  });
  const content = pageContent(tool);
  if (content) at("metaDescription", content.metaDescription);
  for (const guide of guides.filter((g) => g.tools[0] === TOOL)) {
    const g = (where: string, text: string) =>
      at(`guide:${guide.slug} ${where}`, text);
    g("description", guide.description);
    guide.intro.forEach((p, i) => g(`intro[${i}]`, p));
    guide.steps.forEach((s, i) => g(`steps[${i}]`, s));
    guide.sections.forEach((section, i) =>
      section.body.forEach((p, j) => g(`sections[${i}].body[${j}]`, p)),
    );
    guide.faq.forEach((f, i) => {
      g(`faq[${i}].question`, f.question);
      g(`faq[${i}].answer`, f.answer);
    });
  }
  for (const key of ["translateReadingOrder", "translatePageMap"] as const) {
    const promise = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === key,
    )?.promise;
    if (promise) at(`promise:${key}`, promise);
  }
  return out;
}

const SURFACES = translateSurfaces();

describe("the Translate surfaces corpus is plausible", () => {
  it("health: tool page, a guide and both promises are in it, and it is not implausibly small", () => {
    expect(SURFACES.length).toBeGreaterThan(30);
    expect(SURFACES.some((e) => e.where.startsWith("guide:"))).toBe(true);
    expect(SURFACES.filter((e) => e.where.startsWith("promise:")).length).toBe(
      2,
    );
    expect(SURFACES.some((e) => e.where === "useCases[1].body")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 *  The retired interleave admission: a ban with a corpus, both ways
 * ------------------------------------------------------------------ */

/**
 * Every sentence that SHIPPED admitting interleaving as the general
 * behaviour, verbatim. Each must be caught by some pattern below.
 */
const SHIPPED_ADMISSIONS = [
  // useCases[1], slice 3 (2026-11-16), both-states disclosure.
  "On a two-column paper, our server can send the two columns' lines to the model interleaved, so compare the order of the translated paragraphs with the original before you rely on it.",
  // useCases[1] before reading order (true of images before it, 2026-11).
  "Our server reads each line straight across the page, so on a two-column paper the two columns' lines reach the model interleaved.",
  // The operations promise for translateReadingOrder, slice 3.
  "nothing yet about Translate PDF's column order: its page says a two-column paper's lines can reach the model interleaved, and no sentence rests on this proof until that changes",
] as const;

/** The SHAPES of the admission. Each must catch some shipped sentence. */
const ADMISSION_SHAPES: readonly { name: string; shape: RegExp }[] = [
  {
    name: "columns' lines reach the model",
    shape: /\bcolumns'? lines\b[^.]{0,40}\b(?:reach|to) the model\b/i,
  },
  {
    name: "lines can reach / can send ... interleaved",
    shape:
      /\blines? can reach the model interleaved\b|\bcan send\b[^.]{0,80}\binterleaved\b/i,
  },
  {
    name: "reads each line straight across",
    shape: /\breads? each line straight across\b/i,
  },
  {
    name: "compare the translated paragraphs with the original",
    shape: /\btranslated paragraphs with the original\b/i,
  },
];

const admissionHits = (text: string) =>
  ADMISSION_SHAPES.filter((s) => s.shape.test(text)).map((s) => s.name);

describe("the retired interleave admission is banned (slice 5)", () => {
  it("every shipped admission is caught by some shape", () => {
    for (const sentence of SHIPPED_ADMISSIONS)
      expect(admissionHits(sentence), sentence).not.toEqual([]);
  });

  it("every shape catches some shipped admission", () => {
    for (const { name, shape } of ADMISSION_SHAPES)
      expect(
        SHIPPED_ADMISSIONS.some((s) => shape.test(s)),
        `${name} catches no shipped sentence: decoration`,
      ).toBe(true);
  });

  it("no Translate surface carries it", () => {
    const offenders = SURFACES.flatMap((e) =>
      admissionHits(e.text).map((name) => `${e.where}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("positive control: the slice-3 sentence planted in the corpus is caught", () => {
    const planted = [
      ...SURFACES,
      { where: "useCases[1].body", text: SHIPPED_ADMISSIONS[0] },
    ];
    expect(planted.some((e) => admissionHits(e.text).length > 0)).toBe(true);
  });

  it("negative control: the new sentences are not admissions", () => {
    expect(admissionHits(TRANSLATE_COLUMN_ORDER)).toEqual([]);
    expect(admissionHits(TRANSLATE_PAGE_HEADINGS)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  The retired CAUSE claims: a ban with a corpus, both ways
 * ------------------------------------------------------------------ */

/**
 * Review, 2026-11-16: slice 5's two sentences each named a cause that is not
 * the worker's. "When our server cannot confirm a page's column order"
 * claimed a check that does not exist (the ink gate is order-blind; every
 * fallback reason is a loss, a length, a script or a failed run). "When the
 * AI model keeps the page breaks. When it does not" blamed the model where
 * the server never sent a marker (`markerFallback` "collision" and "budget",
 * chunking.ts). Every such sentence that shipped, verbatim; each must be
 * caught by some shape below.
 */
const SHIPPED_FALSE_CAUSES = [
  // TRANSLATE_COLUMN_ORDER, slice 5.
  "A two-column page is read column by column. When our server cannot confirm a page's column order, it reads that page line by line across the columns, and its lines can come out mixed.",
  // TRANSLATE_PAGE_HEADINGS, slice 5.
  "In the PDF, each page's translation comes under its own heading, such as Page 2, when the AI model keeps the page breaks. When it does not, a few pages share one heading.",
  // The translatePageMap operations promise, slice 5.
  "Translate PDF's reflowed PDF puts each page's translation under its own page heading when the model returns the page breaks in order, and one page-range heading otherwise, as its page and guide say",
] as const;

/** The SHAPES of the false cause. Each must catch some shipped sentence. */
const FALSE_CAUSE_SHAPES: readonly { name: string; shape: RegExp }[] = [
  {
    name: "a check of column order",
    shape:
      /\b(?:confirm|check|verif(?:y|ies))\w*\b[^.]{0,40}\bcolumn order\b|\bcolumn order\b[^.]{0,40}\b(?:confirmed|checked|verified)\b/i,
  },
  {
    name: "the model alone decides the page headings",
    shape:
      /\b(?:model|it) (?:keeps|returns|loses|drops) the page breaks\b|\bwhen it does not, a few pages\b/i,
  },
];

const falseCauseHits = (text: string) =>
  FALSE_CAUSE_SHAPES.filter((s) => s.shape.test(text)).map((s) => s.name);

describe("the retired cause claims are banned (review 2026-11-16)", () => {
  it("every shipped false cause is caught by some shape", () => {
    for (const sentence of SHIPPED_FALSE_CAUSES)
      expect(falseCauseHits(sentence), sentence).not.toEqual([]);
  });

  it("every shape catches some shipped false cause", () => {
    for (const { name, shape } of FALSE_CAUSE_SHAPES)
      expect(
        SHIPPED_FALSE_CAUSES.some((s) => shape.test(s)),
        `${name} catches no shipped sentence: decoration`,
      ).toBe(true);
  });

  it("no Translate surface, promises included, carries one", () => {
    const offenders = SURFACES.flatMap((e) =>
      falseCauseHits(e.text).map((name) => `${e.where}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("positive control: the slice-5 column sentence planted in the corpus is caught", () => {
    const planted = [
      ...SURFACES,
      { where: "useCases[1].body", text: SHIPPED_FALSE_CAUSES[0] },
    ];
    expect(planted.some((e) => falseCauseHits(e.text).length > 0)).toBe(true);
  });

  it("negative control: the current sentences name no false cause", () => {
    expect(falseCauseHits(TRANSLATE_COLUMN_ORDER)).toEqual([]);
    expect(falseCauseHits(TRANSLATE_PAGE_HEADINGS)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  The positive claims, required where they live
 * ------------------------------------------------------------------ */

/**
 * The fallback reasons the worker can record for a page sent line by line.
 * A `Record` over the type's own keys, so a reason added to
 * `AiReadingOrderMeta` fails the build until it is listed here.
 */
type FallbackReason =
  | keyof AiReadingOrderMeta["fellBack"]
  | Exclude<AiReadingOrderMeta["source"], "flow" | "not_run">;
const FALLBACK_REASONS = {
  ink: true,
  longer: true,
  rtl: true,
  bbox_failed: true,
  page_count: true,
} satisfies Record<FallbackReason, true>;

/** The clause that discloses fallback pages, in the copy's own shape. */
// Was, until review 2026-11-16: `cannot confirm … line by line`, the shape
// of a sentence that named a column-order check the worker does not make.
const FALLBACK_CLAUSE = /\bsome pages are read line by line\b/i;
const COLUMN_CLAIM = /\btwo-column page is usually read column by column\b/i;

describe("Translate says a two-column page is read column by column (slice 5)", () => {
  // INVERTED from slice 3's "makes no positive claim that columns are read
  // in order": the claim is now shipped, tied to the translateReadingOrder
  // key's promise.
  it("the shared sentence makes the claim, and keeps the fallback clause while any fallback reason exists", () => {
    expect(TRANSLATE_COLUMN_ORDER).toMatch(COLUMN_CLAIM);
    expect(Object.keys(FALLBACK_REASONS).length).toBeGreaterThan(0);
    // INVERTED from slice 3's "still discloses that columns can reach the
    // model interleaved": the disclosure is the fallback clause now.
    expect(TRANSLATE_COLUMN_ORDER).toMatch(FALLBACK_CLAUSE);
  });

  it("right-to-left honesty: the RTL fallback is named, and the worker's gate still treats Arabic as RTL", () => {
    expect(FALLBACK_REASONS.rtl).toBe(true);
    expect(TRANSLATE_COLUMN_ORDER).toMatch(
      /\bright-to-left\b[^.]{0,60}\balways\b/i,
    );
    // Built from code points: ARABIC LETTER ALEF, LAM, ALEF.
    const arabic = String.fromCodePoint(0x627, 0x644, 0x627);
    expect(isStrongRtl(arabic)).toBe(true);
    expect(TRANSLATE_COLUMN_ORDER).toMatch(/\bArabic\b/);
  });

  it("useCases[1] and the guide FAQ carry the shared sentence verbatim", () => {
    const useCase = getToolContent(TOOL)?.useCases?.[1]?.body;
    expect(useCase).toContain(TRANSLATE_COLUMN_ORDER);
    const carriers = SURFACES.filter(
      (e) => !e.where.startsWith("promise:") && COLUMN_CLAIM.test(e.text),
    ).map((e) => e.where);
    expect(carriers.sort()).toEqual([
      "guide:how-to-translate-a-pdf faq[6].answer",
      "useCases[1].body",
    ]);
    // Every carrier takes the WHOLE sentence: no copy with the claim and
    // without the fallback clause.
    for (const e of SURFACES.filter((s) => COLUMN_CLAIM.test(s.text)))
      if (!e.where.startsWith("promise:"))
        expect(e.text, e.where).toContain(TRANSLATE_COLUMN_ORDER);
  });

  it("positive control: the claim without its fallback clause fails the clause check", () => {
    const dropped = TRANSLATE_COLUMN_ORDER.split(/(?<=\.)\s+/)[0]!;
    expect(dropped).toMatch(COLUMN_CLAIM);
    expect(dropped).not.toMatch(FALLBACK_CLAUSE);
  });

  it("the operations promise names the same behaviour, tied to the key", () => {
    const promise = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "translateReadingOrder",
    )?.promise;
    expect(promise).toMatch(/column by column/);
    expect(promise).toMatch(/right-to-left/);
    expect(promise).toMatch(/line by line otherwise/);
    expect(promise).not.toMatch(/nothing yet/);
  });
});

describe("Translate says how the PDF heads pages, with the per-job condition (slice 5)", () => {
  it("the examples are the worker's own heading labels", () => {
    // `null`: a whole-document job's labels (since slice 6 every label
    // names its scope; the copy describes the whole-document case).
    expect(TRANSLATE_PAGE_HEADINGS).toContain(pageRangeLabel([2], null));
    expect(TRANSLATE_PAGE_HEADINGS).toContain(pageRangeLabel([1, 2, 3], null));
  });

  it("states both outcomes, and promises no exact boundary", () => {
    // INVERTED at review 2026-11-16: this REQUIRED "when … keeps the page
    // breaks" and "When it does not", a cause that is the model's in only
    // one of three fallbacks (the server sends no marker on "collision" or
    // "budget"). Now the OUTCOME is required, and the old cause is banned
    // above.
    expect(TRANSLATE_PAGE_HEADINGS).toMatch(
      /\busually comes under its own heading\b/,
    );
    expect(TRANSLATE_PAGE_HEADINGS).toMatch(
      /\bWhen our server cannot tell where each page's translation starts\b/,
    );
    expect(TRANSLATE_PAGE_HEADINGS).toMatch(
      /\bseveral pages share one heading\b/,
    );
    expect(TRANSLATE_PAGE_HEADINGS).toMatch(/\beither heading\b/);
    expect(TRANSLATE_PAGE_HEADINGS).toMatch(/^In the PDF\b/);
  });

  it("the tool FAQ and the guide carry it verbatim", () => {
    const carriers = SURFACES.filter(
      (e) =>
        !e.where.startsWith("promise:") &&
        e.text.includes(TRANSLATE_PAGE_HEADINGS),
    ).map((e) => e.where);
    expect(carriers.sort()).toEqual([
      "faq[0].answer",
      "guide:how-to-translate-a-pdf sections[0].body[1]",
    ]);
  });

  it("the operations promise names the same behaviour, tied to the key", () => {
    const promise = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "translatePageMap",
    )?.promise;
    expect(promise).toMatch(/own page heading/);
    expect(promise).toMatch(/page-range heading otherwise/);
    expect(promise).not.toMatch(/nothing yet/);
  });
});
