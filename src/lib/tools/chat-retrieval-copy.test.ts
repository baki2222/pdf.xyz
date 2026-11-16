// @vitest-environment node
/**
 * Chat with PDF's STATIC copy says how a longer file's pages are chosen, and
 * never overclaims (audit #30, chat-with-pdf#2, slice 4). The property, the
 * exit condition and the corpus rule live with the shapes in
 * `./chat-retrieval-claims`; this file holds them to the catalogue.
 *
 * HISTORY, inverted not deleted. Slice 3 wrote this file as a BAN: "Chat
 * with PDF's STATIC copy may not describe how a longer file's pages are
 * chosen", because a static page could be served beside a worker image
 * that reads only the opening pages. Its exit condition (the production
 * image chooses pages by the question, observed on the wire) held on
 * 2026-11-16, so "no shape catches a sentence of the static corpus" became
 * "no OVERCLAIM catches …", and the panel line's shape became a REQUIRED
 * row beside every static mention of the notice.
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
import {
  describeSelection,
  describeWindow,
  userTruncationNotice,
} from "@/lib/workers/ai/truncation";
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
  CHAT_NOTICE_CLAIM,
  CHAT_RETRIEVAL_HONEST,
  CHAT_RETRIEVAL_OVERCLAIMS,
  CHAT_RETRIEVAL_SHAPES,
  CHAT_RETRIEVAL_SLICE3_HEDGES,
  CHAT_SELECTION_LIMIT,
  CHAT_SELECTION_REQUIRED,
  chatModelNoticeSentence,
  chatRetrievalOverclaimsIn,
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

const sentencesOf = (text: string) =>
  text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);

const CORPUS = staticCorpus();
const SENTENCES = CORPUS.flatMap(({ where, text }) =>
  sentencesOf(text).map((sentence) => ({ where, sentence })),
);

/** The tool the static copy sends a reader to for a page that was not read. */
const EXTRACT_TOOL = getToolBySlug("extract-pages")?.name;
if (!EXTRACT_TOOL) throw new Error("no extract-pages tool in the catalogue");

/**
 * The REQUIRED row: every entry that mentions the notice
 * ({@link CHAT_NOTICE_CLAIM}) without a sentence the selection shape
 * catches. Exported through the tests below so a planted entry can run
 * through the same function the corpus does.
 */
function selectionHoles(corpus: readonly Entry[]): string[] {
  return corpus
    .filter(
      ({ text }) =>
        CHAT_NOTICE_CLAIM.test(text) &&
        !sentencesOf(text).some((s) => CHAT_SELECTION_REQUIRED.pattern.test(s)),
    )
    .map(({ where, text }) => `${where}: ${text}`);
}

/** Which served page an entry is on: the tool page, or one guide. */
const pageOf = (where: string) =>
  where.startsWith("guide:") ? where.split(".")[0]! : "tool";

describe("Chat with PDF static copy says how a longer file's pages are chosen, and never overclaims", () => {
  it("health: the derived corpus is the size it was when written, and reaches every source", () => {
    // Measured 2026-11-16 (slice 3): 88 entries, 189 sentences; slice 4,
    // the same day: 88 entries, 193 sentences. A corpus that
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

  it("health: every honest sentence is in the corpus, verbatim", () => {
    // The relationship that keeps `honest` from being a list of sentences
    // nobody serves: each one must be found in the derived copy.
    const text = CORPUS.map((e) => e.text).join("\n");
    const missing = CHAT_RETRIEVAL_HONEST.filter((s) => !text.includes(s));
    expect(missing).toEqual([]);
  });

  it("no OVERCLAIM catches a sentence of the static corpus (slice 3: no shape at all)", () => {
    // INVERTED 2026-11-16. Slice 3 ran every shape here, so describing the
    // page choice at all was red; since the production proof only the
    // overclaims are banned. The describing shapes are held the other way,
    // by the required row below.
    expect(CHAT_RETRIEVAL_OVERCLAIMS.length).toBeGreaterThanOrEqual(2);
    const caught = SENTENCES.flatMap(({ where, sentence }) =>
      chatRetrievalOverclaimsIn(sentence).map(
        (name) => `${where} [${name}]: ${sentence}`,
      ),
    );
    expect(caught).toEqual([]);
  });

  it("REQUIRED: every entry that mentions the notice says how the pages are chosen", () => {
    // Health first: the set the row is asked of is derived from the copy,
    // and an empty set would pass vacuously (rule 4).
    const carriers = CORPUS.filter(({ text }) => CHAT_NOTICE_CLAIM.test(text));
    expect(carriers.length).toBeGreaterThanOrEqual(4);
    const sources = new Set(
      carriers.map(({ where }) =>
        where.startsWith("guide:") ? "guide" : where.split(/[.[]/)[0],
      ),
    );
    for (const source of ["intro", "faq", "factFaq", "guide"])
      expect(sources, `no ${source} entry mentions the notice`).toContain(
        source,
      );
    expect(selectionHoles(CORPUS)).toEqual([]);
  });

  it("positive control through the detector: slice 3's intro sentence, restored, is a hole", () => {
    const intro = CORPUS.find(({ where }) => where === "intro[1]");
    expect(intro, "intro[1] is not in the corpus").toBeDefined();
    const old = CHAT_RETRIEVAL_SLICE3_HEDGES[0]!.text;
    const selection = sentencesOf(intro!.text).find((s) =>
      CHAT_SELECTION_REQUIRED.pattern.test(s),
    );
    expect(selection, "intro[1] has no selection sentence").toBeDefined();
    const planted = {
      where: "intro[1]",
      text: intro!.text.replace(selection!, old),
    };
    expect(planted.text).not.toBe(intro!.text);
    expect(selectionHoles([planted])).toEqual([`intro[1]: ${planted.text}`]);
  });

  it("history: no sentence slice 3 wrote is served verbatim any more", () => {
    // Slice 3's hedged sentences said only that part was read. Each was
    // rewritten with the selection clause beside it; serving one again is
    // the regression this pins.
    expect(CHAT_RETRIEVAL_SLICE3_HEDGES.length).toBe(4);
    const served = CORPUS.map((e) => e.text).join("\n");
    const back = CHAT_RETRIEVAL_SLICE3_HEDGES.filter(({ text }) =>
      served.includes(text),
    ).map(({ source }) => source);
    expect(back).toEqual([]);
  });

  it("every page that claims selection says matching is by words and names the fallback", () => {
    // The honest limits that keep the claim from becoming "always finds":
    // the match can miss a page asked about in other words, and Extract
    // pages is the way to ask about a page that was not read.
    const claiming = new Set(
      SENTENCES.filter(({ sentence }) =>
        CHAT_SELECTION_REQUIRED.pattern.test(sentence),
      ).map(({ where }) => pageOf(where)),
    );
    expect([...claiming].sort()).toEqual(
      [
        "tool",
        ...guides
          .filter((g) => g.tools[0] === CHAT_TOOL_SLUG)
          .map((g) => `guide:${g.slug}`),
      ].sort(),
    );
    const missing: string[] = [];
    for (const page of claiming) {
      const own = SENTENCES.filter(({ where }) => pageOf(where) === page);
      if (
        !own.some(({ sentence }) => CHAT_SELECTION_LIMIT.pattern.test(sentence))
      )
        missing.push(
          `${page}: no sentence says matching is by words and can miss`,
        );
      if (!own.some(({ sentence }) => sentence.includes(EXTRACT_TOOL)))
        missing.push(`${page}: never names ${EXTRACT_TOOL}`);
    }
    expect(missing).toEqual([]);
  });

  it("rule 1, direction A: every shipped exemplar is caught by its own shape", () => {
    const holes: string[] = [];
    for (const { name, pattern, shipped } of [
      ...CHAT_RETRIEVAL_SHAPES,
      CHAT_SELECTION_LIMIT,
    ]) {
      expect(shipped.length, `${name} has no shipped exemplar`).toBeGreaterThan(
        0,
      );
      for (const { text, source } of shipped)
        if (!pattern.test(text)) holes.push(`${name} misses ${source}`);
    }
    expect(holes).toEqual([]);
  });

  it("rule 1, direction B: no honest sentence is caught by an overclaim", () => {
    // Slice 3 asked this of every shape; slice 4's honest sentences include
    // the selection claim, which the required shape is MEANT to catch.
    expect(CHAT_RETRIEVAL_HONEST.length).toBeGreaterThanOrEqual(11);
    const caught = CHAT_RETRIEVAL_HONEST.flatMap((s) =>
      chatRetrievalOverclaimsIn(s).map((name) => `[${name}] ${s}`),
    );
    expect(caught).toEqual([]);
  });

  it("the hedged static sentence is true of the user notice in every state, on both images", () => {
    // The static copy says the notice "says that only part of it was read,
    // naming the pages when it can". Not "names the pages that were read":
    // when the first page alone overflows the budget, the old image's notice
    // says "the first part of this N-page document" and names none. Every
    // state either image can produce, through the one renderer both use.
    const hedge = "naming the pages when it can";
    const served = CORPUS.map((e) => e.text).join("\n");
    expect(served).toContain(hedge);
    expect(served).not.toMatch(/names the pages that were read/);
    const page = "[Page 1]\n" + "a".repeat(400);
    const two = `${page}\n\n[Page 2]\n${"b".repeat(400)}`;
    const starts = [
      { pageNumber: 1, offset: 0, length: page.length },
      { pageNumber: 2, offset: page.length + 2, length: page.length },
    ];
    const states = {
      // old and new image: a prefix that holds a whole page names it
      "prefix, a page complete": describeWindow(two, starts, 9, 500),
      // old and new image: the first page alone overflows, nothing to name
      "prefix, first page overflows": describeWindow(two, starts, 9, 100),
      // new image: pages chosen for the question
      "relevance, spans": describeSelection(9_000, 800, 9, [1, 7], null),
      // new image: spans dropped by the writer's re-bounding
      "relevance, spans dropped": {
        ...describeSelection(9_000, 800, 9, [1, 7], null),
        pagesSent: undefined,
      },
    } as const;
    const named: Record<string, boolean> = {};
    const dash = String.fromCodePoint(0x2013);
    const onlyPart = new RegExp(
      "^Only (?:pages 1" +
        dash +
        "\\d+ of \\d+|the first part of this \\d+-page document) could be read" +
        "|\\bso (?:only some|\\d+) of its \\d+ pages (?:were|was) read\\b",
    );
    for (const [name, window] of Object.entries(states)) {
      const notice = userTruncationNotice(window);
      // "only part was read" holds in every state.
      expect(notice, name).toMatch(onlyPart);
      named[name] = /\bpages? \d/.test(notice);
    }
    // "naming the pages WHEN IT CAN": both branches occur, so the hedge is
    // load-bearing, not decoration.
    expect(named).toEqual({
      "prefix, a page complete": true,
      "prefix, first page overflows": false,
      "relevance, spans": true,
      "relevance, spans dropped": false,
    });
  });

  it("positive control through the detector: the gated panel line is caught, at every share the sweep measures", () => {
    // The line that MAY say it, run through the same function the corpus
    // scan uses. Both arms, because the measured share picks one of them.
    for (const share of [...CHAT_RETRIEVAL_ANCHOR_SHARES, 0]) {
      expect(chatRetrievalShapesIn(chatRetrievalPanelLine(share))).toEqual([
        "shares the most … words",
      ]);
    }
    // Still distinct from every static sentence: the served-HTML check
    // (`src/deploy/chat-retrieval-served.test.ts`) finds the panel line's
    // exact text to prove it is not server-rendered.
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
