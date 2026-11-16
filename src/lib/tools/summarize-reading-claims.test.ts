/**
 * Summarize PDF's static copy never says the reading starts at page 1.
 *
 * WHY (slice 5, audit summarize-pdf#5, D9): once the running worker publishes
 * `summarizePages`, the panel offers "Pages…" and a long selection is read
 * from its first CHOSEN page. Two shipped sentences said otherwise — "A longer
 * document is summarized from its first page up to that point" (the tool
 * intro and its guide) and "Past the limit the summary covers only the
 * opening pages" (the tool FAQ, which is also FAQPage JSON-LD, and its
 * guide). True of main, false of every page-mode run after the image
 * redeploys, with no date on the follow-up PR. They were rewritten to
 * "covers only the pages that fit, taken in page order … name the pages that
 * were read", which holds in both modes; this file keeps them from coming
 * back.
 *
 * EXIT CONDITION (the property, not a mechanism): this guard may retire only
 * when Summarize can no longer read a set of pages that does not start at
 * page 1. Removing the heartbeat key, the panel control or this PR's route
 * admission is NOT that property: a later feature (a section picker, chat
 * hand-off) can reintroduce a non-prefix read without any of them.
 *
 * Shape (house rules 1 and 4):
 *  - The ban list has a corpus in BOTH directions: every sentence that
 *    shipped is caught by some shape, and every shape catches a shipped
 *    sentence.
 *  - The subjects are DISCOVERED: Summarize PDF's page copy through the
 *    accessors the page renders (`page-copy`, `tool-facts`), every guide
 *    whose PRIMARY tool is summarize-pdf, and any other catalogue sentence
 *    that names "Summarize PDF". The set is bounded below, and a planted
 *    sentence is caught through the same detector (positive control).
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { guides } from "@/lib/guides";
import { toolFacts } from "./tool-facts";
import {
  pageContent,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";

const SLUG = "summarize-pdf";

/** A prefix claim: "the reading starts at page 1 and goes as far as it can". */
const PREFIX_SHAPES: readonly RegExp[] = [
  /\bfrom (?:its|the) (?:first|opening) page\b/i,
  /\bopening pages\b/i,
  /\bhow far into the document\b/i,
  /\bhow far the reading (?:got|reached|went)\b/i,
];

/** The sentences that shipped (origin/main 85812cd3), verbatim. */
const SHIPPED: readonly string[] = [
  "A longer document is summarized from its first page up to that point, and both the results panel and summary.md say how far the reading got, by page.",
  "Past the limit the summary covers only the opening pages, and the panel and summary.md both state how far into the document the reading reached.",
  "Past that, the summary covers the opening pages, and the result says how far the reading got.",
];

interface Sentence {
  readonly at: string;
  readonly text: string;
}

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** Summarize's copy, discovered (see the header). */
function summarizeCopy(): Sentence[] {
  const out: Sentence[] = [];
  const push = (at: string, text: string) =>
    sentencesOf(text).forEach((s) => out.push({ at, text: s }));
  for (const tool of tools) {
    const own = tool.slug === SLUG;
    const at = (where: string, text: string) => {
      if (own) push(`${tool.slug} ${where}`, text);
      else
        sentencesOf(text)
          .filter((s) => /\bSummarize PDF\b/.test(s))
          .forEach((s) => out.push({ at: `${tool.slug} ${where}`, text: s }));
    };
    at("description", tool.description);
    pageIntro(tool).forEach((p, i) => at(`intro[${i}]`, p));
    pageSteps(tool).forEach((s, i) => at(`how[${i}]`, stepText(s)));
    pageFaq(tool).forEach((f, i) => {
      at(`faq[${i}].question`, f.question);
      at(`faq[${i}].answer`, f.answer);
    });
    pageUseCases(tool).forEach((u, i) => at(`useCases[${i}]`, u.body));
    toolFacts(tool.slug).forEach((f, i) => at(`facts[${i}]`, f.value));
    const content = pageContent(tool);
    if (content) at("metaDescription", content.metaDescription);
  }
  for (const guide of guides) {
    const own = guide.tools[0] === SLUG;
    const at = (where: string, text: string) => {
      if (own) push(`guide:${guide.slug} ${where}`, text);
      else
        sentencesOf(text)
          .filter((s) => /\bSummarize PDF\b/.test(s))
          .forEach((s) =>
            out.push({ at: `guide:${guide.slug} ${where}`, text: s }),
          );
    };
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

const prefixClaims = (corpus: readonly Sentence[]): Sentence[] =>
  corpus.filter((s) => PREFIX_SHAPES.some((shape) => shape.test(s.text)));

describe("Summarize PDF's copy makes no prefix-reading claim", () => {
  const COPY = summarizeCopy();

  it("every shipped sentence is caught, and every shape catches a shipped sentence", () => {
    const missed = SHIPPED.filter((s) => !PREFIX_SHAPES.some((p) => p.test(s)));
    expect(missed, "shipped sentences no shape catches").toEqual([]);
    const idle = PREFIX_SHAPES.filter((p) => !SHIPPED.some((s) => p.test(s)));
    expect(idle.map(String), "shapes no shipped sentence exercises").toEqual(
      [],
    );
  });

  it("health check: the discovered corpus is plausibly sized and reaches the limit sentences", () => {
    // Summarize's tool page alone is dozens of sentences; its guide adds as
    // many. A corpus that collapsed would pass the absence check vacuously.
    expect(COPY.length).toBeGreaterThan(40);
    expect(COPY.length).toBeLessThan(1000);
    // The four rewritten limit sentences: the tool intro and FAQ answer, the
    // guide's section and FAQ answer. Both surfaces must be in the set.
    const limit = COPY.filter((s) =>
      /\bpages that fit, taken in page order\b/.test(s.text),
    ).map((s) => s.at.replace(/\[\d+\].*$/, ""));
    expect(limit).toEqual(
      expect.arrayContaining([
        `${SLUG} intro`,
        `${SLUG} faq`,
        "guide:how-to-summarize-a-pdf sections",
        "guide:how-to-summarize-a-pdf faq",
      ]),
    );
  });

  it("no sentence in it says the reading starts at page 1", () => {
    const found = prefixClaims(COPY);
    expect(found, found.map((s) => `${s.at}: ${s.text}`).join("\n")).toEqual(
      [],
    );
  });

  it("positive control: each shipped sentence planted in the corpus is found by the same detector", () => {
    const before = prefixClaims(COPY).length;
    for (const text of SHIPPED) {
      const entry = { at: `${SLUG} planted`, text };
      const found = prefixClaims([...COPY, entry]);
      expect(found).toContainEqual(entry);
      expect(found).toHaveLength(before + 1);
    }
  });
});
