// @vitest-environment node
/**
 * Chat with PDF's STATIC copy may not describe how a longer file's pages are
 * chosen (audit #30, chat-with-pdf#2, slice 3). The property, the exit
 * condition and the corpus rule live with the shapes in
 * `./chat-retrieval-claims`; this file holds them to the catalogue.
 *
 * Why not a `claims-vs-capability` rule: its probe asks the tool AS SHIPPED
 * in this tree, and "has the capability" would be true here the moment the
 * code merged. The property is about the IMAGE serving production, which
 * this tree cannot observe; a probe that went true on merge would license
 * the defect (house rule 2).
 *
 * The corpus is DERIVED (house rule 4): the slug is the one the job contract
 * keys on (`CHAT_TOOL_SLUG`), the copy is reached through the accessors the
 * page renders and ships as JSON-LD (`page-copy`, `toolFacts`, `factFaq`),
 * and the guides are the ones whose PRIMARY tool is that slug. The served
 * `.next` body is held by `src/deploy/chat-retrieval-served.test.ts`, which
 * runs after the build.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import {
  CHAT_RELEVANCE_SOURCES,
  chatRelevanceNotice,
} from "@/lib/workers/chat-with-pdf/relevance-notice";
import { guides } from "@/lib/guides";
import { CHAT_TOOL_SLUG } from "@/lib/jobs/chat-with-pdf";
import {
  CHAT_RETRIEVAL_ANCHOR_SHARE,
  CHAT_RETRIEVAL_ANCHOR_SHARES,
  chatRetrievalPanelLine,
} from "@/lib/pdf/chat-retrieval-anchor";
import { factFaq, toolFacts } from "./tool-facts";
import {
  cardSummary,
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageTitle,
  pageUseCases,
  stepText,
} from "./page-copy";
import {
  CHAT_RETRIEVAL_HONEST,
  CHAT_RETRIEVAL_SHAPES,
  chatModelNoticeSentence,
  chatRetrievalShapesIn,
} from "./chat-retrieval-claims";

interface Entry {
  readonly where: string;
  readonly text: string;
}

function staticCorpus(): Entry[] {
  const tool = getToolBySlug(CHAT_TOOL_SLUG);
  if (!tool) throw new Error(`no tool for CHAT_TOOL_SLUG ${CHAT_TOOL_SLUG}`);
  const out: Entry[] = [];
  const at = (where: string, text: string) => out.push({ where, text });
  at("tool.tagline", tool.tagline);
  at("tool.description", tool.description);
  at("cardSummary", cardSummary(tool));
  at("pageTitle", pageTitle(tool));
  at("pageDescription", pageDescription(tool));
  pageIntro(tool).forEach((p, i) => at(`intro[${i}]`, p));
  pageUseCases(tool).forEach((u, i) => {
    at(`useCases[${i}].title`, u.title);
    at(`useCases[${i}].body`, u.body);
  });
  pageSteps(tool).forEach((s, i) => at(`steps[${i}]`, stepText(s)));
  pageFaq(tool).forEach((f, i) => {
    at(`faq[${i}].question`, f.question);
    at(`faq[${i}].answer`, f.answer);
  });
  // The tool-facts branch directly as well: `pageFaq` filters a fact whose
  // topic the authored FAQ covers, and the fact still ships as a spec row.
  factFaq(tool).forEach((f, i) => {
    at(`factFaq[${i}].question`, f.question);
    at(`factFaq[${i}].answer`, f.answer);
  });
  toolFacts(tool.slug).forEach((f, i) => {
    at(`facts[${i}].label`, f.label);
    at(`facts[${i}].value`, f.value);
  });
  for (const guide of guides.filter((g) => g.tools[0] === tool.slug)) {
    const g = (where: string, text: string) =>
      at(`guide:${guide.slug}.${where}`, text);
    g("title", guide.title);
    g("description", guide.description);
    guide.intro.forEach((p, i) => g(`intro[${i}]`, p));
    guide.steps.forEach((s, i) => g(`steps[${i}]`, s));
    guide.sections.forEach((section, i) => {
      g(`sections[${i}].heading`, section.heading);
      section.body.forEach((p, j) => g(`sections[${i}].body[${j}]`, p));
    });
    guide.faq.forEach((f, i) => {
      g(`faq[${i}].question`, f.question);
      g(`faq[${i}].answer`, f.answer);
    });
  }
  return out;
}

const CORPUS = staticCorpus();
const SENTENCES = CORPUS.flatMap(({ where, text }) =>
  text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0)
    .map((sentence) => ({ where, sentence })),
);

describe("Chat with PDF static copy names the pages read, never how they were chosen", () => {
  it("health: the derived corpus is the size it was when written, and reaches every source", () => {
    // Measured 2026-11-16: 88 entries, 189 sentences. A corpus that
    // quietly shrinks reports the strongest possible pass (rule 4).
    expect(CORPUS.length).toBeGreaterThanOrEqual(80);
    expect(SENTENCES.length).toBeGreaterThanOrEqual(170);
    const sources = new Set(CORPUS.map((e) => e.where.split(/[.[]/)[0]));
    for (const source of ["intro", "faq", "factFaq", "steps", "facts"])
      expect(sources, `no ${source} entries`).toContain(source);
    expect(
      CORPUS.some((e) => e.where.startsWith("guide:")),
      "the chat guide is not in the corpus",
    ).toBe(true);
  });

  it("health: every sentence this slice rewrote is in the corpus, verbatim", () => {
    // The relationship that keeps `honest` from being a list of sentences
    // nobody serves: each one must be found in the derived copy.
    const text = CORPUS.map((e) => e.text).join("\n");
    const missing = CHAT_RETRIEVAL_HONEST.filter((s) => !text.includes(s));
    expect(missing).toEqual([]);
  });

  it("no shape catches a sentence of the static corpus", () => {
    const caught = SENTENCES.flatMap(({ where, sentence }) =>
      chatRetrievalShapesIn(sentence).map(
        (name) => `${where} [${name}]: ${sentence}`,
      ),
    );
    expect(caught).toEqual([]);
  });

  it("rule 1, direction A: every shipped exemplar is caught by its own shape", () => {
    const holes: string[] = [];
    for (const { name, pattern, shipped } of CHAT_RETRIEVAL_SHAPES) {
      expect(shipped.length, `${name} has no shipped exemplar`).toBeGreaterThan(
        0,
      );
      for (const { text, source } of shipped)
        if (!pattern.test(text)) holes.push(`${name} misses ${source}`);
    }
    expect(holes).toEqual([]);
  });

  it("rule 1, direction B: no honest sentence is caught", () => {
    expect(CHAT_RETRIEVAL_HONEST.length).toBeGreaterThanOrEqual(7);
    const caught = CHAT_RETRIEVAL_HONEST.flatMap((s) =>
      chatRetrievalShapesIn(s).map((name) => `[${name}] ${s}`),
    );
    expect(caught).toEqual([]);
  });

  it("positive control through the detector: the gated panel line is caught, at every share the sweep measures", () => {
    // The line that MAY say it, run through the same function the corpus
    // scan uses. Both arms, because the measured share picks one of them.
    for (const share of [...CHAT_RETRIEVAL_ANCHOR_SHARES, 0]) {
      expect(chatRetrievalShapesIn(chatRetrievalPanelLine(share))).toEqual([
        "shares the most … words",
      ]);
    }
    const line = chatRetrievalPanelLine(CHAT_RETRIEVAL_ANCHOR_SHARE);
    expect(SENTENCES.some(({ sentence }) => sentence === line)).toBe(false);
  });

  it("positive control through the detector: the model notice's sentence, both arms, as the engine composes it", () => {
    // Review finding (mutation c3): "For a longer file, the model sees the
    // opening pages and pages chosen by the words they share with the
    // question." appended to the intro passed every test, because no shape
    // caught the model notice. Its exemplars are composed from the leaf the
    // engine sends (`chatRelevanceNotice`), so a reworded notice moves them.
    // Every arm the engine can send: anchored or not, by each source the
    // selection reports (a seed-only follow-up is not "chosen by the words
    // they share", so it has its own wording and its own shape).
    const ellipsis = String.fromCodePoint(0x2026);
    const SHAPE_FOR: Record<(typeof CHAT_RELEVANCE_SOURCES)[number], string> = {
      words: `pages chosen by ${ellipsis} words / question`,
      cited: "pages the previous answer cited",
      mixed: `pages chosen for ${ellipsis} question`,
    };
    expect(CHAT_RELEVANCE_SOURCES.length).toBe(3);
    for (const source of CHAT_RELEVANCE_SOURCES)
      for (const anchored of [true, false]) {
        const sentence = chatModelNoticeSentence(anchored, source);
        const { chosenBy } = chatRelevanceNotice(anchored, source);
        expect(sentence).toContain(chosenBy);
        expect(chatRetrievalShapesIn(sentence)).toEqual([SHAPE_FOR[source]]);
        // The chosen-by clause alone, as static copy would paraphrase it.
        expect(
          chatRetrievalShapesIn(
            `For a longer file, the model sees ${chosenBy}.`,
          ),
        ).toEqual([SHAPE_FOR[source]]);
        // Every arm is an exemplar of the corpus, so a new arm cannot ship
        // outside it (rule 1, direction A, over the engine's own words).
        expect(
          CHAT_RETRIEVAL_SHAPES.some(({ shipped }) =>
            shipped.some(({ text }) => text === sentence),
          ),
          `${source}/${anchored} is not a shipped exemplar`,
        ).toBe(true);
      }
    // Only the words arm may claim the words: the other two never do.
    for (const source of ["cited", "mixed"] as const)
      for (const anchored of [true, false])
        expect(chatRelevanceNotice(anchored, source).chosenBy).not.toMatch(
          /words|share/,
        );
    // The relationship that makes the exemplar the engine's words, not a
    // copy of them: the engine sends the notice from that leaf.
    const engine = readFileSync(
      path.join(process.cwd(), "src/lib/workers/chat-with-pdf/engine.ts"),
      "utf8",
    );
    expect(engine).toMatch(
      /import \{ chatRelevanceNotice \} from "\.\/relevance-notice";/,
    );
    expect(engine).toMatch(/noticeParts: chatRelevanceNotice\(/);
    // And with the source the selection reported, never a typed one.
    expect(engine).toMatch(
      /chatRelevanceNotice\(\s*CHAT_RETRIEVAL_ANCHOR_SHARE > 0 && retrieved\.anchorThrough !== null,\s*retrieved\.source,\s*\)/,
    );
  });
});
