// @vitest-environment node
/**
 * Summarize PDF's static copy advertises choosing pages or a bookmarked
 * section (PR 5b, audit summarize-pdf#5), and says so on every surface a
 * reader can meet alone, each time with the bookmarks limit.
 *
 * Why it may say it at all, and what bounds it, is in
 * `./summarize-page-choice.ts`; the claim's tie to the `summarizePages`
 * heartbeat key, with a planted deferral, is in `./capability-hedges.test.ts`
 * ("the static page-choice advertisement is a member of its capability's
 * subject").
 *
 * Shape (house rules 1 and 4):
 *  - The shapes and the shipped sentences are checked against each other in
 *    both directions, and the shipped list is held EQUAL to the served set.
 *  - The served set is DISCOVERED: every tool and guide, through the
 *    accessors the pages render (`page-copy`), split into
 *    sentences. It is bounded below and above.
 *  - The required surfaces are checked by a predicate that is itself run on
 *    a corpus with the advertisement removed (positive control).
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { guides } from "@/lib/guides";
import {
  pageContent,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import {
  SUMMARIZE_PAGE_CHOICE,
  SUMMARIZE_SECTIONS_NEED_BOOKMARKS,
} from "./summarize-page-choice";
import {
  SUMMARIZE_PAGE_CHOICE_SHAPES,
  SUMMARIZE_PAGE_CHOICE_SHIPPED,
} from "./summarize-page-choice-claims";

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

const advertises = (s: string) =>
  SUMMARIZE_PAGE_CHOICE_SHAPES.some((shape) => shape.pattern.test(s));

const ADVERT = SUMMARIZE_PAGE_CHOICE_SHAPES.find(
  (s) => s.name === "the advertisement",
)!.pattern;

/**
 * The surfaces that must carry the advertisement, each WITH the bookmarks
 * limit in the same entry (an entry can be read alone: a FAQ answer ships as
 * FAQPage JSON-LD, away from the intro). Returns what is missing.
 */
function missingSurfaces(entries: readonly Entry[]): string[] {
  const required: { name: string; pick: (e: Entry) => boolean }[] = [
    {
      name: "summarize-pdf intro",
      pick: (e) => e.slug === "summarize-pdf" && e.where.startsWith("intro["),
    },
    {
      name: "summarize-pdf authored FAQ answer",
      pick: (e) =>
        e.slug === "summarize-pdf" &&
        /^faq\[\d+\]\.answer$/.test(e.where) &&
        e.text.startsWith("Yes. Before you press"),
    },
    {
      name: "guide:how-to-summarize-a-pdf",
      pick: (e) => e.slug === "guide:how-to-summarize-a-pdf",
    },
  ];
  return required
    .filter(
      ({ pick }) =>
        !entries.some(
          (e) =>
            pick(e) &&
            ADVERT.test(e.text) &&
            e.text.includes(SUMMARIZE_SECTIONS_NEED_BOOKMARKS),
        ),
    )
    .map(({ name }) => name);
}

describe("Summarize PDF advertises choosing pages or a bookmarked section", () => {
  const COPY = corpus();
  const SERVED = COPY.flatMap((e) =>
    sentencesOf(e.text)
      .filter(advertises)
      .map((sentence) => ({ at: `${e.slug} ${e.where}`, sentence })),
  );

  it("every shipped sentence is caught, and every shape catches a shipped sentence", () => {
    const shipped = SUMMARIZE_PAGE_CHOICE_SHIPPED.map((s) => s.sentence);
    expect(shipped.filter((s) => !advertises(s))).toEqual([]);
    const idle = SUMMARIZE_PAGE_CHOICE_SHAPES.filter(
      ({ pattern }) => !shipped.some((s) => pattern.test(s)),
    ).map((s) => s.name);
    expect(idle, "shapes no shipped sentence exercises").toEqual([]);
  });

  it("health check: the corpus is plausibly sized and the advertisement is found", () => {
    expect(COPY.length).toBeGreaterThan(1000);
    expect(COPY.length).toBeLessThan(20000);
    // Intro, the FAQ answer and the guide carry the phrase; with the
    // question and the two "only the part" sentences, six (2026-11-16).
    expect(SERVED.length).toBeGreaterThanOrEqual(6);
    expect(SERVED.length).toBeLessThan(40);
  });

  it("the shipped list equals the served sentences, in both directions", () => {
    const served = new Set(SERVED.map((s) => s.sentence));
    const shipped = new Set(
      SUMMARIZE_PAGE_CHOICE_SHIPPED.map((s) => s.sentence),
    );
    expect(
      [...served].filter((s) => !shipped.has(s)),
      "served but not in SUMMARIZE_PAGE_CHOICE_SHIPPED",
    ).toEqual([]);
    expect(
      [...shipped].filter((s) => !served.has(s)),
      "in SUMMARIZE_PAGE_CHOICE_SHIPPED but no longer served",
    ).toEqual([]);
  });

  it("only Summarize's own page and guide carry it", () => {
    expect(new Set(SERVED.map((s) => s.at.split(" ")[0]))).toEqual(
      new Set(["summarize-pdf", "guide:how-to-summarize-a-pdf"]),
    );
  });

  it("every required surface carries it, with the bookmarks limit", () => {
    expect(missingSurfaces(COPY)).toEqual([]);
  });

  it("positive control: removing the phrase from the intro is caught", () => {
    const stripped = COPY.map((e) =>
      e.slug === "summarize-pdf" && e.where.startsWith("intro[")
        ? { ...e, text: e.text.replace(SUMMARIZE_PAGE_CHOICE, "") }
        : e,
    );
    // Health of the mutation itself: it must have changed something.
    expect(stripped).not.toEqual(COPY);
    expect(missingSurfaces(stripped)).toEqual(["summarize-pdf intro"]);
  });

  it("positive control: an advertisement without the bookmarks limit is caught", () => {
    const stripped = COPY.map((e) =>
      e.slug === "guide:how-to-summarize-a-pdf"
        ? { ...e, text: e.text.replace(SUMMARIZE_SECTIONS_NEED_BOOKMARKS, "") }
        : e,
    );
    expect(stripped).not.toEqual(COPY);
    expect(missingSurfaces(stripped)).toEqual(["guide:how-to-summarize-a-pdf"]);
  });
});
