// @vitest-environment node
/**
 * Translate PDF's static copy advertises choosing pages (competitor audit
 * #29, slice 7), on every surface a reader can meet alone, each time with
 * the scan limit; and the split-first advice it retires is gone from every
 * served Translate surface.
 *
 * Why it may say it at all, and what bounds it, is in
 * `./translate-page-choice.ts`; the claim's tie to the `translatePageRange`
 * heartbeat key, with planted deferrals, is in `./capability-hedges.test.ts`
 * ("the translatePageRange subject").
 *
 * Shape (house rules 1 and 4):
 *  - Each vocabulary's shapes and shipped sentences are checked against each
 *    other in both directions (`./translate-page-choice-claims.ts`).
 *  - The served set is DISCOVERED: every tool and guide, through the
 *    accessors the pages render (`page-copy`; the FAQ is the same list the
 *    FAQPage JSON-LD is built from), split into sentences, bounded below
 *    and above. Translate's surfaces are derived from it: the tool whose
 *    slug is the worker's `TRANSLATE_TOOL`, and every guide whose primary
 *    tool (`tools[0]`) it is.
 *  - Every predicate is run on a corpus mutated to fail (positive control).
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { guides } from "@/lib/guides";
import {
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  translateMaxInputChars,
  translateTooLongMessage,
} from "@/lib/jobs/translate-limits";
import { TRANSLATE_TOOL } from "@/lib/workers/translate/engine";
import {
  nothingDeliverableMessage,
  WITHHELD_SEPARATE_DOCUMENT,
} from "@/lib/workers/translate/chunking";
import { deliveryConsequence } from "@/components/tools/delivery-notice";
import {
  pageContent,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import {
  TRANSLATE_ONLY_CHOSEN_PAGES,
  TRANSLATE_OVER_ALLOWANCE_REMEDY,
  TRANSLATE_PAGE_CHOICE,
  TRANSLATE_PAGES_NEED_TEXT,
} from "./translate-page-choice";
import {
  SPLIT_ADVICE_SHAPES,
  SPLIT_ADVICE_SHIPPED_STATIC,
  TRANSLATE_PAGE_CHOICE_SHAPES,
  TRANSLATE_PAGE_CHOICE_SHIPPED,
} from "./translate-page-choice-claims";

interface Entry {
  readonly slug: string;
  readonly where: string;
  readonly text: string;
}

/** Every catalogue string a reader or crawler gets, tools and guides. */
function corpus(): Entry[] {
  const out: Entry[] = [];
  for (const tool of tools) {
    const at = (where: string, text: string) =>
      out.push({ slug: tool.slug, where, text });
    at("description", tool.description);
    at("tagline", tool.tagline);
    pageIntro(tool).forEach((p, i) => at(`intro[${i}]`, p));
    pageSteps(tool).forEach((s, i) => at(`how[${i}]`, stepText(s)));
    pageFaq(tool).forEach((f, i) => {
      at(`faq[${i}].question`, f.question);
      at(`faq[${i}].answer`, f.answer);
    });
    pageUseCases(tool).forEach((u, i) => at(`useCases[${i}]`, u.body));
    const content = pageContent(tool);
    if (content) at("metaDescription", content.metaDescription);
  }
  for (const guide of guides) {
    const at = (where: string, text: string) =>
      out.push({ slug: `guide:${guide.slug}`, where, text });
    at("description", guide.description);
    guide.intro.forEach((p, i) => at(`intro[${i}]`, p));
    guide.steps.forEach((s, i) => at(`steps[${i}]`, s));
    guide.sections.forEach((section, i) =>
      section.body.forEach((p, j) => at(`sections[${i}].body[${j}]`, p)),
    );
    guide.faq.forEach((f, i) => {
      at(`faq[${i}].question`, f.question);
      at(`faq[${i}].answer`, f.answer);
    });
  }
  return out;
}

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const COPY = corpus();

/** Translate's served surfaces, DERIVED from the corpus (never a file list). */
function translateSurfaces(copy: readonly Entry[]): Entry[] {
  const guideSlugs = new Set(
    guides
      .filter((guide) => guide.tools[0] === TRANSLATE_TOOL)
      .map((guide) => `guide:${guide.slug}`),
  );
  return copy.filter(
    (e) => e.slug === TRANSLATE_TOOL || guideSlugs.has(e.slug),
  );
}

/* ------------------------------------------------------------------ *
 *  1. The advertisement
 * ------------------------------------------------------------------ */

const advertises = (s: string) =>
  TRANSLATE_PAGE_CHOICE_SHAPES.some((shape) => shape.pattern.test(s));

/**
 * The surfaces that must carry the advertisement. Returns what is missing.
 * And, derived rather than named: EVERY entry that carries it must carry the
 * scan limit too (an entry can be read alone: a FAQ answer ships as FAQPage
 * JSON-LD, away from the intro).
 */
function missingSurfaces(entries: readonly Entry[]): string[] {
  const ADVERT = (text: string) => text.includes(TRANSLATE_PAGE_CHOICE);
  const faqAnswerTo = (question: RegExp) => (e: Entry) => {
    if (e.slug !== TRANSLATE_TOOL) return false;
    const m = /^faq\[(\d+)\]\.answer$/.exec(e.where);
    if (!m) return false;
    const q = entries.find(
      (x) => x.slug === e.slug && x.where === `faq[${m[1]}].question`,
    );
    return q !== undefined && question.test(q.text);
  };
  const required: { name: string; pick: (e: Entry) => boolean }[] = [
    {
      name: "translate-pdf intro",
      pick: (e) => e.slug === TRANSLATE_TOOL && e.where.startsWith("intro["),
    },
    {
      name: "translate-pdf FAQ: Can I translate only some pages?",
      pick: faqAnswerTo(/^Can I translate only some pages\?$/),
    },
    {
      name: "translate-pdf served fact: How much of my PDF...",
      pick: faqAnswerTo(/^How much of my PDF/),
    },
    {
      name: "guide:how-to-translate-a-pdf",
      pick: (e) => e.slug === "guide:how-to-translate-a-pdf",
    },
  ];
  const missing = required
    .filter(({ pick }) => !entries.some((e) => pick(e) && ADVERT(e.text)))
    .map(({ name }) => name);
  const withoutLimit = entries
    .filter(
      (e) => ADVERT(e.text) && !e.text.includes(TRANSLATE_PAGES_NEED_TEXT),
    )
    .map((e) => `no scan limit: ${e.slug} ${e.where}`);
  return [...missing, ...withoutLimit];
}

describe("Translate PDF advertises choosing pages (slice 7)", () => {
  const SERVED = COPY.flatMap((e) =>
    sentencesOf(e.text)
      .filter(advertises)
      .map((sentence) => ({ at: `${e.slug} ${e.where}`, sentence })),
  );

  it("every shipped sentence is caught, and every shape catches a shipped sentence", () => {
    const shipped = TRANSLATE_PAGE_CHOICE_SHIPPED.map((s) => s.sentence);
    expect(shipped.filter((s) => !advertises(s))).toEqual([]);
    const idle = TRANSLATE_PAGE_CHOICE_SHAPES.filter(
      ({ pattern }) => !shipped.some((s) => pattern.test(s)),
    ).map((s) => s.name);
    expect(idle, "shapes no shipped sentence exercises").toEqual([]);
  });

  it("health check: the corpus is plausibly sized and the advertisement is found", () => {
    expect(COPY.length).toBeGreaterThan(1000);
    expect(COPY.length).toBeLessThan(20000);
    // Measured 2026-11-17: the remedy five times (intro, served fact, guide
    // section and two guide FAQs), "only the pages you choose" three times,
    // the question and the FAQ's opening sentence once each: ten.
    expect(SERVED.length).toBeGreaterThanOrEqual(10);
    expect(SERVED.length).toBeLessThan(40);
  });

  it("the shipped list equals the served sentences, in both directions", () => {
    const served = new Set(SERVED.map((s) => s.sentence));
    const shipped = new Set(
      TRANSLATE_PAGE_CHOICE_SHIPPED.map((s) => s.sentence),
    );
    expect(
      [...served].filter((s) => !shipped.has(s)),
      "served but not in TRANSLATE_PAGE_CHOICE_SHIPPED",
    ).toEqual([]);
    expect(
      [...shipped].filter((s) => !served.has(s)),
      "in TRANSLATE_PAGE_CHOICE_SHIPPED but no longer served",
    ).toEqual([]);
  });

  it("only Translate's own page and guide carry it", () => {
    expect(new Set(SERVED.map((s) => s.at.split(" ")[0]))).toEqual(
      new Set([TRANSLATE_TOOL, "guide:how-to-translate-a-pdf"]),
    );
  });

  it("every required surface carries it, and every entry that carries it names the scan limit", () => {
    expect(missingSurfaces(COPY)).toEqual([]);
  });

  it("positive control: removing the phrase from the intro is caught", () => {
    const stripped = COPY.map((e) =>
      e.slug === TRANSLATE_TOOL && e.where.startsWith("intro[")
        ? { ...e, text: e.text.split(TRANSLATE_PAGE_CHOICE).join("") }
        : e,
    );
    // Health of the mutation itself: it must have changed something.
    expect(stripped).not.toEqual(COPY);
    expect(missingSurfaces(stripped)).toEqual(["translate-pdf intro"]);
  });

  it("positive control: an advertisement without the scan limit is caught", () => {
    const stripped = COPY.map((e) =>
      e.slug === "guide:how-to-translate-a-pdf"
        ? { ...e, text: e.text.split(TRANSLATE_PAGES_NEED_TEXT).join("") }
        : e,
    );
    expect(stripped).not.toEqual(COPY);
    const found = missingSurfaces(stripped);
    expect(found.length).toBeGreaterThan(0);
    expect(
      found.every((f) =>
        f.startsWith("no scan limit: guide:how-to-translate-a-pdf "),
      ),
      found.join("\n"),
    ).toBe(true);
  });

  it("names no refill time: the allowance window is not a calendar day", () => {
    for (const s of [
      TRANSLATE_OVER_ALLOWANCE_REMEDY,
      TRANSLATE_ONLY_CHOSEN_PAGES,
      TRANSLATE_PAGES_NEED_TEXT,
    ])
      expect(s).not.toMatch(/\b(?:tomorrow|midnight|tonight|next day)\b/i);
  });
});

/* ------------------------------------------------------------------ *
 *  2. The split-first advice, banned from the served Translate surfaces
 * ------------------------------------------------------------------ */

const CEILING = translateMaxInputChars(TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS);
const sentenceWith = (text: string, needle: RegExp): string => {
  const hit = sentencesOf(text).find((s) => needle.test(s));
  if (!hit) throw new Error(`no sentence matching ${needle} in: ${text}`);
  return hit;
};

/**
 * Every split sentence the product has shipped on a Translate surface. The
 * static ones are history (typed, verbatim); the per-job ones are DERIVED
 * from the functions that still write them, so a reworded tail moves here.
 * Those per-job sentences are kept where page choice does not solve their
 * situation (verdicts in the slice 7 PR); they are not static copy, so they
 * are in the corpus and not under the ban.
 */
const SPLIT_SHIPPED: readonly { at: string; sentence: string }[] = [
  ...SPLIT_ADVICE_SHIPPED_STATIC,
  {
    at: "translateTooLongMessage (no page structure), per job",
    sentence: sentenceWith(
      translateTooLongMessage(CEILING * 2, CEILING),
      /^Split it/,
    ),
  },
  {
    at: "withheldPagesMarker, separate-document remedy, per job",
    sentence: WITHHELD_SEPARATE_DOCUMENT,
  },
  {
    at: "nothingDeliverableMessage, characters, per job",
    sentence: sentenceWith(
      nothingDeliverableMessage("characters", { characters: 9 }, false),
      /^Submit the document again/,
    ),
  },
  {
    at: "DeliveryNotice, characters bound, panel per job",
    sentence: sentenceWith(
      deliveryConsequence({
        boundBy: "characters",
        deliveredPages: 1,
        withheldPages: 1,
      }),
      /separate document/,
    ),
  },
];

const splitAdvice = (s: string) =>
  SPLIT_ADVICE_SHAPES.filter((shape) => shape.pattern.test(s)).map(
    (shape) => shape.name,
  );

function splitOffenders(copy: readonly Entry[]): string[] {
  return translateSurfaces(copy).flatMap((e) =>
    sentencesOf(e.text)
      .filter((s) => splitAdvice(s).length > 0)
      .map((s) => `${e.slug} ${e.where}: ${s}`),
  );
}

describe("the split-first advice is gone from Translate's served pages (slice 7)", () => {
  const SURFACES = translateSurfaces(COPY);

  it("every shipped split sentence is caught, and every shape catches a shipped one", () => {
    expect(
      SPLIT_SHIPPED.filter((s) => splitAdvice(s.sentence).length === 0).map(
        (s) => s.at,
      ),
    ).toEqual([]);
    const idle = SPLIT_ADVICE_SHAPES.filter(
      ({ pattern }) => !SPLIT_SHIPPED.some((s) => pattern.test(s.sentence)),
    ).map((s) => s.name);
    expect(idle, "shapes no shipped sentence exercises").toEqual([]);
  });

  it("health: the surfaces are Translate's page and guide, plausibly sized, and the advertisement is among them", () => {
    expect(new Set(SURFACES.map((e) => e.slug))).toEqual(
      new Set([TRANSLATE_TOOL, "guide:how-to-translate-a-pdf"]),
    );
    // Measured 2026-11-17: 70 entries (tool 38, guide 32).
    expect(SURFACES.length).toBeGreaterThanOrEqual(60);
    expect(SURFACES.length).toBeLessThan(150);
    expect(SURFACES.some((e) => e.text.includes(TRANSLATE_PAGE_CHOICE))).toBe(
      true,
    );
  });

  it("no served Translate sentence carries split-first advice", () => {
    expect(splitOffenders(COPY)).toEqual([]);
  });

  it("positive control: each shipped split sentence, planted in the intro, is caught", () => {
    for (const { sentence } of SPLIT_SHIPPED) {
      const planted = COPY.map((e) =>
        e.slug === TRANSLATE_TOOL && e.where === "intro[2]"
          ? { ...e, text: `${e.text} ${sentence}` }
          : e,
      );
      expect(planted).not.toEqual(COPY);
      expect(splitOffenders(planted)).toEqual([
        `${TRANSLATE_TOOL} intro[2]: ${sentence}`,
      ]);
    }
  });

  it("negative control: the new sentences and the chunking mechanism are not split advice", () => {
    for (const s of [
      ...TRANSLATE_PAGE_CHOICE_SHIPPED.map((x) => x.sentence),
      TRANSLATE_PAGES_NEED_TEXT,
      "One pass carries up to 10,258 characters; longer documents are split at page boundaries, translated in order and reassembled.",
      "A long document is not refused: it is split at page boundaries, translated a few pages at a time, and reassembled in order.",
    ])
      expect(splitAdvice(s), s).toEqual([]);
  });
});
