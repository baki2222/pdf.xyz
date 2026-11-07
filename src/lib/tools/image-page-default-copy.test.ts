/**
 * Audit jpg-to-pdf#1 (2026-11-07): Image to PDF's page size now STARTS on
 * the paper of the browser's region — A4, or US Letter where the region
 * prints on Letter (`imagePageSizeForLocales`). Until then it was US Letter
 * for everyone, and the copy said so in five places on two tool pages, the
 * facts box, and a guide.
 *
 * This holds the copy to the new default in both directions (CLAUDE.md
 * "Guards — house style", rule 1):
 *  - BAN: a sentence that states the default page and names Letter without
 *    naming A4 is the old claim. Its corpus is the sentences that shipped.
 *  - PIN: every page that describes the default carries the sentence built
 *    from the runner's own constants, and every country it names is one the
 *    runner really starts on Letter for.
 *
 * Subjects are DISCOVERED: every tool the registry mounts the image-to-PDF
 * runner for, and every guide that lists one of them.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { getRunnerKind } from "@/lib/pdf/registry";
import { guides } from "@/lib/guides/catalog";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageUseCases,
  pageSteps,
  stepText,
} from "@/lib/tools/page-copy";
import { imageDefaultPaperCopy, toolFacts } from "@/lib/tools/tool-facts";
import {
  IMAGE_PAGE_SIZES,
  LETTER_PAPER_REGIONS,
  LETTER_REGION_PAGE_SIZE,
  WORLD_PAGE_SIZE,
  imagePageSizeForLocales,
} from "@/lib/pdf/image-page-layout";

const labelOf = (id: string) =>
  IMAGE_PAGE_SIZES.find((s) => s.id === id)!.label;
const WORLD = labelOf(WORLD_PAGE_SIZE);
const LETTER = labelOf(LETTER_REGION_PAGE_SIZE);

/** Sentences, split on a full stop or colon followed by a space. */
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The old claim: a sentence about the page you get when you change nothing
 * — said with a "default" word, or as "a photo per / on a … US Letter page"
 * — that names Letter and not A4.
 */
const DEFAULT_WORDS =
  /\b(?:unless you change|left alone|by default|the default|default page|usual layout)\b/i;
const LETTER_AS_THE_PAGE =
  /\b(?:per|on an?|on its own)\s+(?:[\w,]+\s+){0,3}?US\s+Letter\s+(?:page|sheet)s?\b/i;
function statesLetterOnlyDefault(sentence: string): boolean {
  return (
    (DEFAULT_WORDS.test(sentence) || LETTER_AS_THE_PAGE.test(sentence)) &&
    new RegExp(`\\b${LETTER.replace(" ", "\\s+")}\\b|\\bLetter\\b`).test(
      sentence,
    ) &&
    !new RegExp(`\\b${WORLD}\\b`).test(sentence)
  );
}

const SHIPPED = [
  "Unless you change the page setup, each photo goes on a white, portrait US Letter page, centred inside a 0.5 in margin.",
  "Left alone they give the usual layout: US Letter, portrait, a 0.5 in margin, no limit on size, one PDF.",
  "Unless you change the page setup, every page is a portrait US Letter sheet with a white background and a 0.5 in margin.",
  "Left alone: US Letter, portrait, a 0.5 in margin, no limit on size, one PDF.",
  "Unless you change the page setup, that page is US Letter (8.5 × 11 in) portrait with a 0.5 in margin.",
  "On the default US Letter page with its 0.5 in margin, a screenshot 1,920 pixels wide is shrunk to 7.5 inches across.",
  "One photo per US Letter page, in the order you set.",
];
/** Synonyms the shapes must also catch (rule 1: a synonym walks past). */
const SYNONYMS = [
  "Each image is placed on a portrait US Letter sheet.",
  "By default the paper is US Letter.",
];
const HONEST = [
  `Unless you change the page setup, that page is ${imageDefaultPaperCopy()}.`,
  "Photos to print on A4 or Letter paper",
  "On a US Letter page with the default 0.5 in margin, a screenshot 1,920 pixels wide is shrunk to 7.5 inches across, or 7.3 inches on A4.",
  "Pick US Letter under Page size for American paper.",
];

describe("the old 'US Letter for everyone' default, as a corpus", () => {
  it.each(SHIPPED)("catches what shipped: %s", (s) => {
    expect(statesLetterOnlyDefault(s)).toBe(true);
  });
  it.each(SYNONYMS)("catches a synonym: %s", (s) => {
    expect(statesLetterOnlyDefault(s)).toBe(true);
  });
  it.each(HONEST)("passes what is true: %s", (s) => {
    expect(statesLetterOnlyDefault(s)).toBe(false);
  });
});

const imageTools = tools.filter(
  (t) => getRunnerKind(t.slug) === "image-to-pdf",
);
const imageGuides = guides.filter((g) =>
  g.tools.some((slug) => imageTools.some((t) => t.slug === slug)),
);

function toolCopy(tool: (typeof tools)[number]): string[] {
  return [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
    ...toolFacts(tool.slug).map((f) => f.value),
  ];
}

describe("Image to PDF's pages describe the paper the runner starts on", () => {
  it("the subjects were found (health)", () => {
    expect(imageTools.map((t) => t.slug).sort()).toEqual(
      expect.arrayContaining(["jpg-to-pdf", "png-to-pdf"]),
    );
    expect(imageGuides.length).toBeGreaterThanOrEqual(2);
  });

  it.each(imageTools.map((t) => [t.slug, t] as const))(
    "%s states A4-or-Letter and never Letter alone",
    (_slug, tool) => {
      const copy = toolCopy(tool);
      expect(copy.join(" ")).toContain(imageDefaultPaperCopy());
      const stale = copy.flatMap(sentences).filter(statesLetterOnlyDefault);
      expect(stale).toEqual([]);
    },
  );

  it.each(imageGuides.map((g) => [g.slug, g] as const))(
    "guide %s never states Letter alone as the default",
    (_slug, guide) => {
      const copy = [
        guide.title,
        guide.description,
        ...guide.intro,
        ...guide.steps,
        ...guide.sections.flatMap((s) => s.body),
        ...guide.faq.flatMap((f) => [f.question, f.answer]),
      ];
      const stale = copy.flatMap(sentences).filter(statesLetterOnlyDefault);
      expect(stale).toEqual([]);
    },
  );

  it("every country the copy names starts on Letter, and A4 is the rest", () => {
    const copy = imageDefaultPaperCopy();
    const named = LETTER_PAPER_REGIONS.filter((r) => copy.includes(r.name));
    // Health: the sentence names some, so "every named one" is not vacuous.
    expect(named.length).toBeGreaterThanOrEqual(2);
    for (const r of named) {
      expect(imagePageSizeForLocales([`en-${r.code}`])).toBe("letter");
    }
    expect(copy.startsWith(WORLD)).toBe(true);
    expect(copy).toContain(LETTER);
  });
});
