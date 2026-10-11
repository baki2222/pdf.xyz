// @vitest-environment node
// @native-canvas
/**
 * The AI proofs read what is INSIDE the package, and a wrong-but-plausible
 * package fails them.
 *
 * THE DEFECT (2026-10-09). summarize-pdf and translate-pdf were proven by "a
 * ZIP came back" (`isZipContainer`) and chat-with-pdf by its manifest's turn
 * COUNT. A package holding an empty summary, the document echoed back, a
 * summary of some other document, an English "translation" or a chat answer
 * naming nothing in the document passed, and the ledger recorded the tool as
 * proven. The same run that found ai-extract's nulls "passed" both.
 *
 * THE FIRST FIX HAD THREE HOLES (review, 2026-10-09), each a package built by
 * hand to pass it, and each now a wrong package below: a summary of the
 * memo's TITLE, or of a kestrel (the bird), passed on the one word "Kestrel";
 * Italian, Portuguese, Catalan and French renderings of the memo, packaged as
 * Spanish, passed as Spanish; and the chat notes named one channel, so a
 * model sent no prior turns still answered the follow-up — while the check's
 * docblock said a right answer had used both turns.
 *
 * THE SECOND FIX HAD FOUR MORE (re-review, 2026-10-09), each a wrong package
 * below: the summary's body words (cable, corrosion, repair, truck) are what
 * any bridge report says, so a refusal that saw only the title, a one-line
 * description and another bridge's summary passed; one sentence left in
 * English passed as Spanish at 6 of 13 positions, and the memo's last lines
 * in Portuguese, Catalan or Italian passed; a translation cut short passed on
 * one name; and the follow-up's docblock still called a right answer evidence
 * the turns reached the model, while a worker that forwards only the user's
 * turns can pass (and with a reading model does) — now a pinned limit.
 *
 * THE THIRD FIX WAS TOO NARROW ON ONE SIDE AND STILL OPEN ON THE OTHER
 * (re-review 3, 2026-10-09). The summary check refused faithful summaries —
 * one that rounded the cost and named no one, a TL;DR, "7 tons" — so its
 * marks are wider, and those summaries are right packages below. The
 * translation check passed a Spanish summary, the translation with its middle
 * six sentences dropped, and Galician or German lines; it gained a length
 * floor DERIVED from the correct renderings, and a per-line check, each with
 * its wrong packages here and its limits pinned.
 *
 * Every package below is built OFFLINE — no provider is called. The right
 * ones and most wrong ones come out of the REAL engine (`runSummarize`,
 * `runTranslate`, `runChatWithPdf`) reading the REAL fixture through the real
 * extractor, with a stand-in model that returns a given text or reads its
 * request; shapes the engine refuses to build (an empty file) are written by
 * hand. Each check is driven twice: as a function, and as the `verify` the
 * harness actually runs (`AI_PROOF_SPECS`), so a correct check wired to the
 * wrong spec — or to no spec — fails here.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "@/lib/pdf/text";
import type {
  AiCompletionRequest,
  AiProvider,
} from "@/lib/workers/ai/provider";
import { runSummarize } from "@/lib/workers/summarize/engine";
import { runTranslate } from "@/lib/workers/translate/engine";
import { runChatWithPdf } from "@/lib/workers/chat-with-pdf/engine";
import type { ChatTurn } from "@/lib/jobs/chat-with-pdf";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import { buildChatContext } from "@/lib/workers/chat-with-pdf-conversation";
import { AI_PROOF_SPECS, type AiProofSpec } from "@/tests/ai-proof-specs";
import { chatProofPdf, memoProofPdf } from "@/tests/ai-proof-fixtures";
import {
  CATALAN_TRANSLATION,
  ENGLISH_PARAPHRASE,
  FRENCH_TRANSLATION,
  GALICIAN_TRANSLATION,
  GERMAN_TRANSLATION,
  ITALIAN_TRANSLATION,
  MEMO_RENDERINGS,
  MEMO_TEXT,
  NEIGHBOUR_RENDERINGS,
  PORTUGUESE_TRANSLATION,
  SPANISH_DRIFTING_INTO_ITALIAN,
  SPANISH_SUMMARY_AS_TRANSLATION,
  SPANISH_TRANSLATION,
  SPANISH_TRANSLATION_CERNICALO,
  SPANISH_TRANSLATION_CUT_SHORT,
  SPANISH_TRANSLATION_KESTREL_BRIDGE,
  SPANISH_TRANSLATION_MIDDLE_DROPPED,
  UNMARKED_RENDERINGS,
  spanishDriftingInto,
  spanishWithEnglishLine,
  spanishWithLineFrom,
  spanishWithout,
} from "@/tests/ai-proof-memo-renderings";
import {
  CHAT_PROOF_DECOYS,
  CHAT_PROOF_FACTS,
  CHAT_PROOF_FOLLOW_UP,
  CHAT_PROOF_OPENING,
  CHAT_PROOF_PAGES,
  LANGUAGE_MARKERS,
  LINE_CHECK_WORDS_AT_LEAST,
  MARKED_LANGUAGES,
  PROOF_MEMO_BODY_MARKS,
  PROOF_MEMO_BODY_MONTHS,
  PROOF_MEMO_BODY_NAMES,
  PROOF_MEMO_BODY_STEMS,
  PROOF_MEMO_FIGURES,
  PROOF_MEMO_SENTENCES,
  PROOF_MEMO_SUBJECT,
  PROOF_MEMO_TITLE,
  SPANISH_LINE_MARKERS,
  SPANISH_MARKERS_AT_LEAST,
  TRANSLATION_LENGTH_AT_LEAST,
  TRANSLATION_LENGTH_MARGIN,
  echoes,
  languageMarkers,
  lengthAgainstMemo,
  linesNotInSpanish,
  memoBodyMarksIn,
  mentions,
  mentionsStem,
  readsAsSpanish,
  sentencesCarried,
  verifyChatProof,
  verifySummaryProof,
  verifyTranslationProof,
} from "./ai-proof-content";

// ── the stand-in models, and packages built by the real engines ─────────────

const replying = (text: string): AiProvider => ({
  id: "openai",
  model: "gpt-test",
  complete: async () => ({ ok: true, text, model: "gpt-test" }),
});

/**
 * A model that READS its request, as a careful one does: the team "that team"
 * means, from the prior turns — a team they name, or a part of the worker
 * they ask about, which the notes say one team maintains; that team's
 * channel, from the notes in the system prompt. When the prior turns settle
 * no one team, it does not guess — it lists every team's channel.
 */
const readingModel: AiProvider = {
  id: "openai",
  model: "gpt-test",
  complete: async (request) => {
    const notes = request.system ?? "";
    const channels = [
      ...notes.matchAll(
        /The (\w+) team takes its pages on the ([\w-]+) channel\./g,
      ),
    ].map((m) => ({ team: m[1]!, channel: m[2]! }));
    const parts = [
      ...notes.matchAll(/The (.+?) is maintained by the (\w+) team\./g),
    ].map((m) => ({ part: m[1]!, team: m[2]! }));
    // Health: the notes reached the model through the real engine.
    if (channels.length === 0 || parts.length !== channels.length)
      throw new Error("the notes did not reach the model whole");
    const prior = request.messages
      .slice(0, -1)
      .map((m) => m.content)
      .join(" ");
    const meant = new Set([
      ...channels.filter((c) => mentions(prior, c.team)).map((c) => c.team),
      ...parts.filter((p) => mentions(prior, p.part)).map((p) => p.team),
    ]);
    const team = meant.size === 1 ? [...meant][0]! : null;
    const text = team
      ? `That team takes its pages on the ${channels.find((c) => c.team === team)!.channel} channel [p.2].`
      : `The notes give each team's channel: ${channels.map((c) => `the ${c.team} team on ${c.channel}`).join(", ")} [p.2].`;
    return { ok: true, text, model: "gpt-test" };
  },
};

/** A worker that kept the turns in the job's options and dropped them before the model. */
const droppingTurns = (model: AiProvider): AiProvider => ({
  id: model.id,
  model: model.model,
  complete: (request) =>
    model.complete({ ...request, messages: request.messages.slice(-1) }),
});

/**
 * A worker that sent the model the USER's turns and dropped the assistant's —
 * the opening answer never reaches it. Records what the model was sent.
 */
const userTurnsOnly = (model: AiProvider) => {
  const sent: AiCompletionRequest["messages"][] = [];
  const provider: AiProvider = {
    id: model.id,
    model: model.model,
    complete: (request) => {
      const messages = request.messages.filter((m) => m.role === "user");
      sent.push(messages);
      return model.complete({ ...request, messages });
    },
  };
  return { provider, sent };
};

const extract = (bytes: Uint8Array) => extractPdfText(bytes);

/** A line's words, as the per-line check counts them. */
const normalizeLine = (line: string) =>
  line
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const CHAT_LINES = CHAT_PROOF_PAGES.flatMap((page) => page.lines);

async function summaryPackage(summary: string): Promise<Uint8Array> {
  const run = await runSummarize(
    await memoProofPdf(),
    { length: "brief", format: "paragraphs" },
    { extract, provider: replying(summary) },
  );
  if (!run.ok) throw new Error(`summarize engine: ${run.message}`);
  return run.output;
}

async function translationPackage(
  translation: string,
  targetLanguage: TranslateLanguage = "es",
): Promise<Uint8Array> {
  const run = await runTranslate(
    await memoProofPdf(),
    { targetLanguage, sourceLanguage: "auto" },
    { extract, provider: replying(translation) },
  );
  if (!run.ok) throw new Error(`translate engine: ${run.message}`);
  return run.output;
}

async function chatPackageFrom(
  provider: AiProvider,
  question: string,
  context?: ChatTurn[],
): Promise<Uint8Array> {
  const run = await runChatWithPdf(
    await chatProofPdf(),
    { question, ...(context ? { context } : {}) },
    { extract, provider },
  );
  if (!run.ok) throw new Error(`chat engine: ${run.message}`);
  return run.output;
}

const chatPackage = (question: string, answer: string, context?: ChatTurn[]) =>
  chatPackageFrom(replying(answer), question, context);

/** A package the engine would refuse to build, written by hand. */
async function handPackage(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: "uint8array" });
}

// ── the answers, right and wrong ────────────────────────────────────────────

/**
 * Faithful summaries the third version of the check REFUSED (re-review 3,
 * 2026-10-09): each names no person, river or harbour, does not say ferry,
 * and rounds or respells every figure it gives.
 */
const REVIEWED_RIGHT_SUMMARIES: readonly string[] = [
  "An inspection of the Kestrel Bridge found corrosion on four of its twelve main cables, two of which have lost over 10% of their strength. " +
    "Replacing them will cost about €2.5 million and take roughly two months; heavy trucks will be diverted and traffic limited to one lane, " +
    "and the council must approve the budget by April.",
  "TL;DR: the Kestrel Bridge needs its corroded cables replaced, and heavy trucks will be diverted while the work goes on.\n" +
    "- Four of the bridge's cables are corroded and will be replaced.\n" +
    "- Heavy trucks will be diverted during the repair.\n" +
    "- The budget must be approved by April, and the bridge closes to all traffic if the work runs past June.",
  "Trucks over 7 tons may not cross the Kestrel Bridge while its cables are repaired.",
  "Trucks over seven tons are barred from the Kestrel Bridge during the cable repair.",
];

/**
 * Summaries of the memo in many wordings: four full ones, then terse ones that
 * each carry ONE mark of the body, so every mark the check counts passes some
 * summary on its own — and the reviewed ones above.
 */
const RIGHT_SUMMARY =
  "The memo reports corrosion on the Kestrel Bridge over the Varrow River. " +
  "Engineer Ingrid Halvorsen found four of its twelve cables damaged; replacing them " +
  "will take nine weeks and cost about 2.48 million euros, with trucks sent to a ferry. " +
  "The council has to approve the budget by the end of April.";
const RIGHT_SUMMARIES: readonly string[] = [
  RIGHT_SUMMARY,
  "An inspection found corroded steel cables on the Kestrel Bridge; replacing four " +
    "of them will take nine weeks and cost about 2.48 million euros.",
  "- The Kestrel Bridge over the Varrow needs a nine-week repair.\n" +
    "- Four of its twelve cables are corroded, two of them badly.\n" +
    "- Trucks will be sent to a ferry from Ostby while the work goes on.",
  "The bridge needs a nine-week repair costing 2.48 million euros, and the council " +
    "must approve the budget by the end of April.",
  // Terse, one mark of the body each — a name, the ferry, or one form of a
  // figure — so every mark the check accepts is what passes some summary.
  "Engineer Halvorsen inspected the Kestrel Bridge and wants its damaged cables replaced.",
  "The Kestrel Bridge over the Varrow River needs four new cables.",
  "While the Kestrel Bridge is repaired, heavy trucks will cross the river by boat from Ostby.",
  "Heavy trucks will take a ferry while the Kestrel Bridge's cables are replaced.",
  "Replacing the Kestrel Bridge's corroded cables will take nine weeks.",
  "Kestrel Bridge cable repair: 9 weeks.",
  "The Kestrel Bridge repair will cost €2.48m from the regional roads fund.",
  "Trucks over seven tonnes are barred from the Kestrel Bridge during its cable repair.",
  "Trucks over 7 tonnes may not use the Kestrel Bridge while its cables are replaced.",
  // The marks the third review asked for (re-review 3, 2026-10-09), each the
  // only mark of one summary: a month, the council, and every form of the
  // cables, the lanes and the strength lost.
  "The Kestrel Bridge was inspected in March and needs new cables.",
  "The budget for the Kestrel Bridge repair must be approved by April.",
  "If the Kestrel Bridge repair runs past June, the bridge will close.",
  "The city council must approve the money for the Kestrel Bridge repair.",
  "Four of the Kestrel Bridge's twelve cables are corroded.",
  "Corrosion was found on 4 of the Kestrel Bridge's 12 cables.",
  "Cars may cross the Kestrel Bridge in one lane during the repair.",
  "Kestrel Bridge repair: cars limited to 1 lane.",
  "Cars will use a single lane on the Kestrel Bridge while its cables are fixed.",
  "Two of the Kestrel Bridge's corroded cables have lost over a tenth of their strength.",
  "Some Kestrel Bridge cables have lost more than one tenth of their strength.",
  "Two Kestrel Bridge cables have lost over 10% of their strength.",
  ...REVIEWED_RIGHT_SUMMARIES,
];
/** What a summary of the harness's old `textPdf` says: fluent, and about something else. */
const OTHER_DOCUMENT_SUMMARY =
  "This document is a short deployment proof for pdf.xyz. It carries real, " +
  "selectable text so that text-extracting tools have something honest to extract.";
/** A summary of some other document about corroded cables: the body's words, not its subject. */
const OTHER_CORROSION_SUMMARY =
  "A survey of the harbour crane found corroded cables and recommends a repair before winter.";
/** What a summary says when only the heading line was extracted. */
const TITLE_ONLY_SUMMARY = PROOF_MEMO_TITLE;
/** An answer from outside knowledge: "kestrel" is a bird. */
const KESTREL_BIRD_SUMMARY =
  "The kestrel is a small falcon that hovers over open fields while hunting.";

/**
 * Summaries that name the memo's subject and only words ANY bridge report
 * says — cables, corrosion, repairs, trucks. Each passed the check until
 * 2026-10-09 (re-review), on those generic words.
 */
const GENERIC_BRIDGE_SUMMARIES: readonly { name: string; text: string }[] = [
  {
    // The summarize prompt's own way out ("If the text is empty or
    // unintelligible, say so plainly"), when only the heading was extracted.
    name: "a refusal: only the title was given",
    text: `The provided text contains only the title "${PROOF_MEMO_TITLE}". It gives no details of the inspection's findings, repairs or costs, so there is nothing more to summarize.`,
  },
  {
    name: "the same refusal, naming cables and corrosion",
    text: `The provided text contains only the title "${PROOF_MEMO_TITLE}". It says nothing about the bridge's cables or corrosion, so no summary of the inspection can be given.`,
  },
  {
    name: "a description of the memo that says nothing in it",
    text: "This memo records an inspection of the Kestrel Bridge and the repairs it recommends.",
  },
  {
    name: "a summary of ANOTHER bridge",
    text: "The memo reports an inspection of the Harlan Street Bridge, which found corroded suspension cables. Repairs will close the bridge to heavy trucks for three months.",
  },
];

/** A Spanish translation of some other document: Spanish enough, and none of the memo's names. */
const OTHER_DOCUMENT_SPANISH =
  "Prueba de despliegue de pdf.xyz. El documento es una prueba breve y contiene " +
  "texto real y seleccionable, para que las herramientas que extraen texto tengan " +
  "algo honesto que extraer. Los archivos se procesan en el servidor y los " +
  "resultados se descargan como un paquete, pero también se pueden borrar antes.";

const ALL_TEAMS = [
  CHAT_PROOF_FACTS.team,
  ...CHAT_PROOF_DECOYS.map((d) => d.team),
];

const RIGHT_OPENING = `The ${CHAT_PROOF_FACTS.team} team maintains the secure worker fleet [p.2].`;
const RIGHT_OPENINGS: readonly string[] = [
  RIGHT_OPENING,
  `According to the notes, the secure worker fleet is maintained by the ${CHAT_PROOF_FACTS.team} team (p. 2).`,
];
const WRONG_OPENING =
  "The secure worker fleet is maintained by the platform team [p.1].";
/** Another team the notes name, given as the answer. */
const DECOY_OPENING = `The ${CHAT_PROOF_DECOYS[0].team} team maintains the secure worker fleet [p.2].`;
/** Every team the notes name: the planted one among them, and no answer. */
const EVERY_TEAM_OPENING = `The notes name the ${ALL_TEAMS.join(", ")} teams [p.2].`;

const RIGHT_FOLLOW_UP = `That team takes its pages on the #${CHAT_PROOF_FACTS.channel} channel [p.2].`;
const RIGHT_FOLLOW_UPS: readonly string[] = [
  RIGHT_FOLLOW_UP,
  `The ${CHAT_PROOF_FACTS.team} team is paged on ${CHAT_PROOF_FACTS.channel} (p. 2).`,
];
const WRONG_FOLLOW_UP =
  "That team takes its pages on the on-call channel [p.2].";
/** Another team's channel: what a model sent no turns says when it guesses wrong. */
const DECOY_FOLLOW_UP = `That team takes its pages on the ${CHAT_PROOF_DECOYS[0].channel} channel [p.2].`;
/** What a model sent no turns says when it asks instead. */
const CLARIFYING_FOLLOW_UP =
  "Which team do you mean? The notes give a paging channel for several teams [p.2].";

/** The follow-up's context, as the browser builds it from the right opening. */
const FOLLOW_UP_CONTEXT = buildChatContext([
  { question: CHAT_PROOF_OPENING.question, answer: RIGHT_OPENING },
]).turns;

/** The word before `noun` in `line` ("Brenner" in "the Brenner team"). */
const wordBefore = (line: string, noun: string): string | null =>
  new RegExp(`(\\S+) ${noun}\\b`).exec(line)?.[1] ?? null;

// ── the fixtures carry what the checks look for ─────────────────────────────

describe("the fixtures are what the checks assume", () => {
  const body = PROOF_MEMO_SENTENCES.join("\n");

  it("the memo's subject is in its title; each body name, stem and figure is in its body and NOT in its title", () => {
    for (const word of PROOF_MEMO_SUBJECT)
      expect(mentionsStem(PROOF_MEMO_TITLE, word), word).toBe(true);
    for (const name of PROOF_MEMO_BODY_NAMES) {
      expect(mentions(body, name), name).toBe(true);
      expect(mentions(PROOF_MEMO_TITLE, name), name).toBe(false);
    }
    for (const stem of PROOF_MEMO_BODY_STEMS) {
      expect(mentionsStem(body, stem), stem).toBe(true);
      expect(mentionsStem(PROOF_MEMO_TITLE, stem), stem).toBe(false);
    }
    for (const month of PROOF_MEMO_BODY_MONTHS) {
      expect(mentions(body, month), month).toBe(true);
      expect(mentions(PROOF_MEMO_TITLE, month), month).toBe(false);
    }
    // Each figure is drawn into a sentence as its label says it, and some
    // form of it is what the body carries.
    for (const { label, forms } of PROOF_MEMO_FIGURES) {
      expect(mentions(body, label), label).toBe(true);
      expect(
        forms.some((form) => mentionsStem(body, form)),
        label,
      ).toBe(true);
      for (const form of forms)
        expect(mentionsStem(PROOF_MEMO_TITLE, form), form).toBe(false);
    }
    // POSITIVE CONTROL: the title says the subject and none of the body.
    expect(memoBodyMarksIn(PROOF_MEMO_TITLE)).toEqual([]);
    expect(memoBodyMarksIn(body)).toEqual(PROOF_MEMO_BODY_MARKS);
  });

  it("every mark the summary check accepts is the ONLY mark of some right summary — so each is what passes it, and none is decoration", () => {
    for (const word of PROOF_MEMO_SUBJECT)
      expect(
        RIGHT_SUMMARIES.some((s) => mentionsStem(s, word)),
        word,
      ).toBe(true);
    // A mark that is only ever said beside another passes nothing on its
    // own: the check would pass the same summaries without it.
    const soleMark = (s: string) => {
      const marks = memoBodyMarksIn(s);
      return marks.length === 1 ? marks[0]! : null;
    };
    for (const mark of [
      ...PROOF_MEMO_BODY_NAMES,
      ...PROOF_MEMO_BODY_MONTHS,
      ...PROOF_MEMO_BODY_STEMS.map((stem) => `${stem}…`),
    ])
      expect(
        RIGHT_SUMMARIES.some((s) => soleMark(s) === mark),
        mark,
      ).toBe(true);
    // Every FORM of every figure, not only every figure.
    for (const { label, forms } of PROOF_MEMO_FIGURES)
      for (const form of forms)
        expect(
          RIGHT_SUMMARIES.some(
            (s) =>
              soleMark(s) === label &&
              forms.filter((f) => mentionsStem(s, f)).join() === form,
          ),
          form,
        ).toBe(true);
    // And no form catches what another already does.
    const forms = PROOF_MEMO_FIGURES.flatMap((figure) => figure.forms);
    for (const a of forms)
      for (const b of forms)
        if (a !== b) expect(mentionsStem(b, a), `${a} within ${b}`).toBe(false);
  });

  it("every way a summary may write the repair's cost starts with its one form", () => {
    const [cost] = PROOF_MEMO_FIGURES.filter((f) => /euros$/.test(f.label));
    expect(cost, "the cost is not a figure").toBeDefined();
    for (const written of [
      "2,480,000 euros",
      "2.480.000 euros",
      "2 480 000 euros",
      "2.48 million euros",
      "€2.48m",
      "2,48 millones de euros",
    ])
      expect(memoBodyMarksIn(written), written).toEqual([cost!.label]);
    // NEGATIVE CONTROL: a cost the memo does not give.
    expect(memoBodyMarksIn("2.5 million euros")).toEqual([]);
    expect(memoBodyMarksIn("12,480,000 euros")).toEqual([]);
  });

  it("every way a summary may write the truck limit, the lanes, the cables and the strength lost is its figure's", () => {
    const figure = (label: string) => {
      const found = PROOF_MEMO_FIGURES.find((f) => f.label === label);
      expect(found, label).toBeDefined();
      return found!.label;
    };
    for (const [written, label] of [
      ["Trucks over 7 tonnes", "seven tonnes"],
      ["trucks over 7 tons", "seven tonnes"],
      ["a 7-ton limit", "seven tonnes"],
      ["seven tons", "seven tonnes"],
      ["one lane", "one lane"],
      ["a single-lane crossing", "one lane"],
      ["1 lane", "one lane"],
      ["four of its twelve main cables", "twelve steel cables"],
      ["4 of 12 cables", "twelve steel cables"],
      ["more than a tenth", "more than a tenth"],
      ["over one tenth", "more than a tenth"],
      ["over 10%", "more than a tenth"],
      ["over 10 %", "more than a tenth"],
      ["over 10 per cent", "more than a tenth"],
      ["over 10 percent", "more than a tenth"],
    ] as const)
      expect(memoBodyMarksIn(written), written).toEqual([figure(label)]);
    // NEGATIVE CONTROLS: what "10%" is not the start of, any more.
    expect(memoBodyMarksIn("100 trucks a day")).toEqual([]);
    expect(memoBodyMarksIn("10,000 cars")).toEqual([]);
  });

  it("THE LIMITS the figures' docblock states: €2.48bn passes as the cost; '12 main cables' and 'ten percent' are not forms", () => {
    // Pinned so each limit is a fact. If one goes red, a form changed —
    // invert it and rewrite PROOF_MEMO_FIGURES's docblock.
    expect(memoBodyMarksIn("€2.48bn")).toEqual(["2,480,000 euros"]);
    expect(memoBodyMarksIn("4 of its 12 main cables")).toEqual([]);
    expect(memoBodyMarksIn("lost ten percent of their strength")).toEqual([]);
  });

  it("the memo PDF's extracted text carries every sentence verbatim — so an echo of it is seen", async () => {
    const text = (await extract(await memoProofPdf())).text;
    expect(sentencesCarried(text, PROOF_MEMO_SENTENCES)).toBe(
      PROOF_MEMO_SENTENCES.length,
    );
    expect(echoes(text, PROOF_MEMO_SENTENCES)).toBe(true);
  });

  it("each chat fact is in the notes, only where it was planted, and in no question", async () => {
    const withTeam = CHAT_LINES.filter((l) =>
      mentions(l, CHAT_PROOF_FACTS.team),
    );
    const withChannel = CHAT_LINES.filter((l) =>
      mentions(l, CHAT_PROOF_FACTS.channel),
    );
    expect(withTeam).toHaveLength(2);
    expect(withChannel).toHaveLength(1);
    // The opening's answer is in one line, and it names the planted team.
    const fleet = CHAT_LINES.filter((l) => mentions(l, "secure worker fleet"));
    expect(fleet).toHaveLength(1);
    expect(mentions(fleet[0]!, CHAT_PROOF_FACTS.team)).toBe(true);
    // An answer that repeats its question can neither pass by naming the fact
    // nor fail by naming another team's.
    for (const { question, mustMention, mustNotMention } of [
      CHAT_PROOF_OPENING,
      CHAT_PROOF_FOLLOW_UP,
    ])
      for (const term of [mustMention, ...mustNotMention])
        expect(mentions(question, term), `${term} in "${question}"`).toBe(
          false,
        );
    // The PDF says it, and is still long enough for the prompt-cache measurement.
    const text = (await extract(await chatProofPdf())).text;
    for (const line of CHAT_LINES.filter((l) => /\bteam\b/.test(l)))
      expect(sentencesCarried(text, [line]), line).toBe(1);
    expect(text.length).toBeGreaterThan(20_000);
  });

  it("the notes leave 'that team' open without the opening exchange: every team and channel they name is one the checks know", () => {
    // DERIVED from the notes, not from CHAT_PROOF_DECOYS: a team or channel
    // added to the notes and not to the checks fails here.
    const teams = CHAT_LINES.filter((l) => /\bteam\b/.test(l)).map((l) =>
      wordBefore(l, "team"),
    );
    const channels = CHAT_LINES.filter((l) => /\bchannel\b/.test(l)).map((l) =>
      wordBefore(l, "channel"),
    );
    const sorted = (xs: readonly (string | null)[]) => [...new Set(xs)].sort();
    expect(sorted(teams)).toEqual(
      sorted([
        CHAT_PROOF_OPENING.mustMention,
        ...CHAT_PROOF_OPENING.mustNotMention,
      ]),
    );
    expect(sorted(channels)).toEqual(
      sorted([
        CHAT_PROOF_FOLLOW_UP.mustMention,
        ...CHAT_PROOF_FOLLOW_UP.mustNotMention,
      ]),
    );
    // Health: more than one channel, so the notes alone do not answer the
    // follow-up; each team has one channel line.
    expect(new Set(channels).size).toBeGreaterThanOrEqual(3);
    expect(channels).toHaveLength(new Set(channels).size);
    // The asked-about team is neither the first nor the last the notes name,
    // so a model that guesses by position names another.
    const order = [...new Set(teams)];
    expect(order.indexOf(CHAT_PROOF_FACTS.team)).toBeGreaterThan(0);
    expect(order.indexOf(CHAT_PROOF_FACTS.team)).toBeLessThan(order.length - 1);
  });
});

describe("the per-line check, against the memo in Spanish, English, German and Galician", () => {
  /** The lines of every rendering in a language no Spanish line may be. */
  const NOT_SPANISH: Record<string, readonly string[]> = {
    english: MEMO_RENDERINGS.english,
    galician: [GALICIAN_TRANSLATION],
    german: [GERMAN_TRANSLATION],
  };
  const lineWords = (line: string) =>
    normalizeLine(line).split(" ").filter(Boolean);

  it("every line marker occurs in a Spanish rendering, and in no English, German or Galician one — none is decoration, none is theirs", () => {
    for (const marker of SPANISH_LINE_MARKERS)
      expect(
        MEMO_RENDERINGS.spanish.some((text) => mentions(text, marker)),
        `"${marker}"`,
      ).toBe(true);
    const found = Object.entries(NOT_SPANISH).flatMap(([language, texts]) =>
      [...SPANISH_LINE_MARKERS]
        .filter((marker) => texts.some((text) => mentions(text, marker)))
        .map((marker) => `${language} "${marker}"`),
    );
    expect(found).toEqual([]);
    // "pero" is Galician too: the reason it is not a line marker.
    expect(mentions(GALICIAN_TRANSLATION, "pero")).toBe(true);
    expect(SPANISH_LINE_MARKERS.has("pero")).toBe(false);
  });

  it("every line of every Spanish rendering is marked — the check refuses no correct translation", () => {
    for (const text of MEMO_RENDERINGS.spanish)
      expect(linesNotInSpanish(text), text.split("\n")[0]).toEqual([]);
  });

  it("every line of an English, German or Galician rendering is refused, unless it names someone, is under the word floor, or is the title", () => {
    for (const [language, texts] of Object.entries(NOT_SPANISH))
      for (const text of texts) {
        const lines = text.split("\n");
        const expected = lines.flatMap((line, i) =>
          lineWords(line).length >= LINE_CHECK_WORDS_AT_LEAST &&
          !PROOF_MEMO_BODY_NAMES.some((name) => mentions(line, name)) &&
          !(i === 0 && !/[.!?]$/.test(line))
            ? [i + 1]
            : [],
        );
        // The paraphrase runs its sentences together: read apart below.
        if (text === ENGLISH_PARAPHRASE) continue;
        // Health: most of each rendering is refused, so the check is not blind.
        expect(expected.length, language).toBeGreaterThan(lines.length / 2);
        expect(linesNotInSpanish(text), language).toEqual(expected);
      }
    expect(linesNotInSpanish(ENGLISH_PARAPHRASE).length).toBeGreaterThan(0);
  });
});

describe("the language markers, against the memo in six languages", () => {
  it("every language the check counts has renderings, and every rendering is a whole translation", () => {
    expect(Object.keys(MEMO_RENDERINGS).sort()).toEqual(
      [...MARKED_LANGUAGES].sort(),
    );
    for (const language of MARKED_LANGUAGES)
      for (const text of MEMO_RENDERINGS[language].filter(
        (t) => t !== ENGLISH_PARAPHRASE,
      ))
        expect(text.split("\n"), language).toHaveLength(
          PROOF_MEMO_SENTENCES.length + 1,
        );
  });

  it("every marker occurs in a rendering of its own language — no marker is decoration", () => {
    for (const language of MARKED_LANGUAGES)
      for (const marker of LANGUAGE_MARKERS[language])
        expect(
          MEMO_RENDERINGS[language].some((text) => mentions(text, marker)),
          `${language} "${marker}"`,
        ).toBe(true);
  });

  it("no Spanish marker occurs in another language's rendering, and no other language's marker in a Spanish one", () => {
    const found: string[] = [];
    for (const language of MARKED_LANGUAGES)
      for (const text of MEMO_RENDERINGS[language]) {
        const counts = languageMarkers(text);
        if (language === "spanish") {
          for (const other of MARKED_LANGUAGES)
            if (other !== "spanish" && counts[other] > 0)
              found.push(`${counts[other]} ${other} in a Spanish rendering`);
        } else if (counts.spanish > 0)
          found.push(`${counts.spanish} Spanish in a ${language} rendering`);
      }
    expect(found).toEqual([]);
    // And the Spanish set shares no word with any other.
    for (const other of MARKED_LANGUAGES.filter((l) => l !== "spanish"))
      expect(
        [...LANGUAGE_MARKERS.spanish].filter((w) =>
          LANGUAGE_MARKERS[other].has(w),
        ),
        other,
      ).toEqual([]);
  });

  it("the words Spanish shares with a neighbour — left out of every set on purpose — are in a Spanish rendering", () => {
    // The left-out words the LANGUAGE_MARKERS docblock names. Each one in a
    // Spanish rendering is what makes the test above refuse a marker set that
    // takes it in; without one, that claim would rest on the comment.
    for (const word of ["o", "dos", "le", "les", "une", "es", "va"]) {
      expect(
        MEMO_RENDERINGS.spanish.some((text) => mentions(text, word)),
        word,
      ).toBe(true);
      for (const language of MARKED_LANGUAGES)
        expect(
          LANGUAGE_MARKERS[language].has(word),
          `${language} "${word}"`,
        ).toBe(false);
    }
  });

  it("every unmarked rendering is a whole translation, and is not Spanish by count", () => {
    for (const [language, text] of Object.entries(UNMARKED_RENDERINGS)) {
      expect(text.split("\n"), language).toHaveLength(
        PROOF_MEMO_SENTENCES.length + 1,
      );
      expect(readsAsSpanish(text), language).toBe(false);
    }
  });

  it("each Spanish rendering reads as Spanish with room to spare; no other rendering does", () => {
    for (const text of MEMO_RENDERINGS.spanish) {
      expect(readsAsSpanish(text)).toBe(true);
      expect(languageMarkers(text).spanish).toBeGreaterThanOrEqual(
        2 * SPANISH_MARKERS_AT_LEAST,
      );
    }
    for (const language of MARKED_LANGUAGES.filter((l) => l !== "spanish"))
      for (const text of MEMO_RENDERINGS[language])
        expect(readsAsSpanish(text), language).toBe(false);
    // The drifting translation clears the Spanish minimum on its own, so only
    // the other languages' count can refuse it.
    expect(
      languageMarkers(SPANISH_DRIFTING_INTO_ITALIAN).spanish,
    ).toBeGreaterThanOrEqual(SPANISH_MARKERS_AT_LEAST);
    expect(readsAsSpanish(SPANISH_DRIFTING_INTO_ITALIAN)).toBe(false);
  });
});

// ── each check, as a function ───────────────────────────────────────────────

describe("verifySummaryProof", () => {
  it("passes a summary of the memo, in every wording", async () => {
    for (const summary of RIGHT_SUMMARIES) {
      const verdict = await verifySummaryProof(await summaryPackage(summary));
      expect(verdict, verdict.detail).toMatchObject({ ok: true });
    }
  });

  it("fails an empty summary", async () => {
    const verdict = await verifySummaryProof(
      await handPackage({ "summary.txt": "  \n", "manifest.json": "{}" }),
    );
    expect(verdict).toEqual({ ok: false, detail: "summary.txt is empty" });
  });

  it("fails the memo echoed back", async () => {
    const verdict = await verifySummaryProof(await summaryPackage(MEMO_TEXT));
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/echoed back: 13 of its 13 sentences/);
  });

  it("fails a fluent summary of some other document, and of another document about corroded cables", async () => {
    for (const summary of [OTHER_DOCUMENT_SUMMARY, OTHER_CORROSION_SUMMARY]) {
      const verdict = await verifySummaryProof(await summaryPackage(summary));
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toMatch(
        /names neither Kestrel nor bridge — it is not about the memo's subject/,
      );
    }
  });

  it("fails a summary of the memo's title, and a sentence about a kestrel — the subject's words and nothing of the body", async () => {
    for (const summary of [TITLE_ONLY_SUMMARY, KESTREL_BIRD_SUMMARY]) {
      const verdict = await verifySummaryProof(await summaryPackage(summary));
      expect(verdict.ok, summary).toBe(false);
      expect(verdict.detail).toContain(
        `but nothing only the memo's body says (${PROOF_MEMO_BODY_MARKS.join(", ")})`,
      );
      // Health: the list is the marks, names first.
      expect(PROOF_MEMO_BODY_MARKS.slice(0, 3)).toEqual([
        ...PROOF_MEMO_BODY_NAMES,
      ]);
    }
  });

  it("fails a summary that names the subject and only what any bridge report says — a refusal, a description, another bridge", async () => {
    for (const { name, text } of GENERIC_BRIDGE_SUMMARIES) {
      const verdict = await verifySummaryProof(await summaryPackage(text));
      expect(verdict.ok, `${name}: ${verdict.detail}`).toBe(false);
      expect(verdict.detail, name).toMatch(
        /but nothing only the memo's body says/,
      );
    }
  });

  it("passes the faithful summaries the third version refused — rounded figures, no names, 'tons'", async () => {
    for (const summary of REVIEWED_RIGHT_SUMMARIES) {
      // Health: each names no person, river or harbour and says no ferry,
      // which is why the narrowed marks refused it.
      expect(
        [...PROOF_MEMO_BODY_NAMES, "ferry"].filter((m) =>
          mentionsStem(summary, m),
        ),
        summary,
      ).toEqual([]);
      const verdict = await verifySummaryProof(await summaryPackage(summary));
      expect(verdict, verdict.detail).toMatchObject({ ok: true });
    }
  }, 60_000);

  it("THE LIMIT the check's docblock states: a summary of ANOTHER bridge passes when it names one of the memo's months", async () => {
    // The price of not refusing a faithful summary that names no one. Pinned
    // so it is a fact; if it goes red, the months stopped counting — invert
    // it, rewrite verifySummaryProof's docblock, and check the reviewed
    // summaries above still pass.
    const verdict = await verifySummaryProof(
      await summaryPackage(
        "The Harlan Street Bridge needs new cables, and its repair budget is due in April.",
      ),
    );
    expect(verdict, verdict.detail).toMatchObject({ ok: true });
  });

  it("THE LIMIT the check's docblock states: a summary wrong about the memo passes when it carries a mark of the body", async () => {
    // Pinned so the limit is a fact: the check asks whether the body reached
    // the summary, not whether the summary is true to it.
    const verdict = await verifySummaryProof(
      await summaryPackage(
        "Halvorsen found the Kestrel Bridge sound and recommends no work.",
      ),
    );
    expect(verdict, verdict.detail).toMatchObject({ ok: true });
  });

  it("fails bytes that are not a package, and a package with no summary", async () => {
    expect((await verifySummaryProof(new Uint8Array([1, 2, 3]))).ok).toBe(
      false,
    );
    expect(
      (await verifySummaryProof(await handPackage({ "manifest.json": "{}" })))
        .detail,
    ).toBe("the package has no summary.txt");
  });
});

describe("verifyTranslationProof", () => {
  it("passes a Spanish translation of the memo, in every translator's words — the bridge's name kept, translated or left in English", async () => {
    // Health: the two name variants are what they say they are.
    const named = SPANISH_TRANSLATION.split("puente Kestrel").length - 1;
    expect(named).toBeGreaterThan(1);
    expect(SPANISH_TRANSLATION_CERNICALO).not.toMatch(/Kestrel/);
    expect(
      SPANISH_TRANSLATION_KESTREL_BRIDGE.split("Kestrel Bridge"),
    ).toHaveLength(named + 1);
    expect(MEMO_RENDERINGS.spanish).toContain(SPANISH_TRANSLATION_CERNICALO);
    expect(MEMO_RENDERINGS.spanish).toContain(
      SPANISH_TRANSLATION_KESTREL_BRIDGE,
    );
    for (const translation of MEMO_RENDERINGS.spanish) {
      const verdict = await verifyTranslationProof(
        await translationPackage(translation),
      );
      expect(verdict, verdict.detail).toMatchObject({ ok: true });
    }
  });

  it("fails an empty translation", async () => {
    const verdict = await verifyTranslationProof(
      await handPackage({
        "translation.txt": "",
        "manifest.json": JSON.stringify({ options: { targetLanguage: "es" } }),
      }),
    );
    expect(verdict).toEqual({ ok: false, detail: "translation.txt is empty" });
  });

  it("fails the memo echoed back", async () => {
    const verdict = await verifyTranslationProof(
      await translationPackage(MEMO_TEXT),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/echoed back: 13 of its 13 sentences/);
  });

  it("fails the memo re-told in English — the source language", async () => {
    const verdict = await verifyTranslationProof(
      await translationPackage(ENGLISH_PARAPHRASE),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(
      /does not read as Spanish.* reads as English/,
    );
  });

  it("fails the memo in Spanish's neighbours, packaged as Spanish — each named as the language it reads as", async () => {
    for (const [translation, language] of [
      [ITALIAN_TRANSLATION, "Italian"],
      [PORTUGUESE_TRANSLATION, "Portuguese"],
      [CATALAN_TRANSLATION, "Catalan"],
      [FRENCH_TRANSLATION, "French"],
    ] as const) {
      const verdict = await verifyTranslationProof(
        await translationPackage(translation),
      );
      expect(verdict.ok, language).toBe(false);
      expect(verdict.detail).toMatch(
        new RegExp(
          `does not read as Spanish: 0 Spanish .* reads as ${language}$`,
        ),
      );
    }
  });

  it("fails a translation that drifts into Italian partway — though its Spanish half clears the minimum", async () => {
    const verdict = await verifyTranslationProof(
      await translationPackage(SPANISH_DRIFTING_INTO_ITALIAN),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(
      /does not read as Spanish: \d+ Spanish marker words against \d+ Italian/,
    );
  });

  it("fails Spanish with ONE sentence left in English — at every position", async () => {
    // Until 2026-10-09 (re-review) the other languages' markers could be a
    // quarter of the Spanish ones: one English sentence passed at 6 of 13
    // positions. Line 0 is the title, which carries no English marker word —
    // pinned as a limit below.
    const passed: number[] = [];
    for (let line = 1; line <= PROOF_MEMO_SENTENCES.length; line += 1)
      if (readsAsSpanish(spanishWithEnglishLine(line))) passed.push(line);
    expect(passed, "lines left in English that passed as Spanish").toEqual([]);
    // Health: each control IS one line of English in the Spanish rendering.
    for (let line = 1; line <= PROOF_MEMO_SENTENCES.length; line += 1)
      expect(
        sentencesCarried(spanishWithEnglishLine(line), PROOF_MEMO_SENTENCES),
      ).toBe(1);
    // And through the package, as the harness reads it.
    const verdict = await verifyTranslationProof(
      await translationPackage(spanishWithEnglishLine(2)),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/does not read as Spanish: \d+ Spanish/);
  });

  it("fails a translation that drifts into EVERY neighbour for its last two or more lines", async () => {
    // Until 2026-10-09 (re-review) the last 4 lines in Portuguese or
    // Catalan, or the last 2 in Italian, passed.
    const passed: string[] = [];
    for (const [language, rendering] of Object.entries(NEIGHBOUR_RENDERINGS))
      for (let count = 2; count <= PROOF_MEMO_SENTENCES.length; count += 1)
        if (readsAsSpanish(spanishDriftingInto(rendering, count)))
          passed.push(`the last ${count} lines in ${language}`);
    expect(passed).toEqual([]);
    for (const [language, rendering] of Object.entries(NEIGHBOUR_RENDERINGS)) {
      const verdict = await verifyTranslationProof(
        await translationPackage(spanishDriftingInto(rendering, 2)),
      );
      expect(verdict.ok, `${language}: ${verdict.detail}`).toBe(false);
    }
  });

  it("THE LIMIT of a marker count: one line with at most one marker word passes, wherever it came from", () => {
    // Pinned so the readsAsSpanish docblock's limit is a fact: the title
    // left in English carries no English marker, and the memo's last line
    // in Italian, Portuguese or Catalan carries at most one marker. If this
    // goes red the count got stronger — invert it and rewrite the docblock.
    // (The per-line check refuses two of these; see below.)
    expect(readsAsSpanish(spanishWithEnglishLine(0))).toBe(true);
    expect(
      Object.entries(NEIGHBOUR_RENDERINGS)
        .filter(([, rendering]) =>
          readsAsSpanish(spanishDriftingInto(rendering, 1)),
        )
        .map(([language]) => language),
    ).toEqual(["italian", "portuguese", "catalan"]);
  });

  it("INVERTED: the last line in Portuguese is refused now — line by line", async () => {
    // It passed while only the count read the text (pinned above, true of
    // the count still): Portuguese writes none of Spanish's line markers.
    const verdict = await verifyTranslationProof(
      await translationPackage(spanishDriftingInto(PORTUGUESE_TRANSLATION, 1)),
    );
    expect(verdict.ok, verdict.detail).toBe(false);
    expect(verdict.detail).toMatch(
      /\(line 14\) — a line left in another language$/,
    );
  }, 60_000);

  it("THE LIMITS of the per-line check: the title is not checked, and an article-less Spanish sentence is refused", async () => {
    // Pinned so linesNotInSpanish's docblock is a fact. The title left in
    // English still passes — a Spanish heading drops its articles, so the
    // first line without a full stop is not read. If this goes red, the
    // check got stronger — invert it.
    const title = await verifyTranslationProof(
      await translationPackage(spanishWithEnglishLine(0)),
    );
    expect(title, title.detail).toMatchObject({ ok: true });
    // What the check gets WRONG: a correct Spanish sentence that writes none
    // of its words. No rendering here has one; a model's may. If this goes
    // green, the markers widened — invert it.
    const lines = SPANISH_TRANSLATION.split("\n");
    const costLine = lines.findIndex((line) => /2\.480\.000/.test(line));
    expect(costLine).toBeGreaterThan(0);
    const articleless = lines
      .map((line, i) =>
        i === costLine
          ? "Se prevé un coste de 2.480.000 euros, pagados con fondos regionales de carreteras."
          : line,
      )
      .join("\n");
    expect(readsAsSpanish(articleless)).toBe(true);
    const refused = await verifyTranslationProof(
      await translationPackage(articleless),
    );
    expect(refused.ok).toBe(false);
    expect(refused.detail).toContain(`(line ${costLine + 1})`);
  }, 60_000);

  it("THE LIMIT of the per-line check: the last line in Italian or Catalan still passes — they write 'la' and 'del'", async () => {
    // Pinned so linesNotInSpanish's docblock is a fact: a neighbour that
    // writes Spanish's articles is the count's to refuse, and the count lets
    // one line through. If this goes red the check got stronger — invert it.
    const passed: string[] = [];
    for (const [language, rendering] of Object.entries(NEIGHBOUR_RENDERINGS)) {
      const verdict = await verifyTranslationProof(
        await translationPackage(spanishDriftingInto(rendering, 1)),
      );
      if (verdict.ok) passed.push(language);
    }
    expect(passed).toEqual(["italian", "catalan"]);
  }, 60_000);

  it("fails Spanish that drifts into Galician — for its last line, or any number of lines", async () => {
    // Until 2026-10-09 (re-review 3) the last 1 to 6 lines in Galician passed:
    // no marker set counts it. Health: the count alone still passes some.
    expect(readsAsSpanish(spanishDriftingInto(GALICIAN_TRANSLATION, 6))).toBe(
      true,
    );
    const passed: number[] = [];
    for (let count = 1; count <= PROOF_MEMO_SENTENCES.length; count += 1) {
      const verdict = await verifyTranslationProof(
        await translationPackage(
          spanishDriftingInto(GALICIAN_TRANSLATION, count),
        ),
      );
      if (verdict.ok) passed.push(count);
    }
    expect(passed, "Galician drifts that passed").toEqual([]);
  }, 60_000);

  it("fails ONE line of Galician or German at every position — except the title and a line that names someone, pinned limits", async () => {
    // Until 2026-10-09 (re-review 3) one German sentence in the middle passed.
    const named = SPANISH_TRANSLATION.split("\n").flatMap((line, i) =>
      PROOF_MEMO_BODY_NAMES.some((name) => mentions(line, name)) ? [i] : [],
    );
    for (const [language, rendering] of Object.entries(UNMARKED_RENDERINGS)) {
      const passed: number[] = [];
      for (let line = 0; line <= PROOF_MEMO_SENTENCES.length; line += 1) {
        const verdict = await verifyTranslationProof(
          await translationPackage(spanishWithLineFrom(rendering, line)),
        );
        if (verdict.ok) passed.push(line);
      }
      // THE LIMITS linesNotInSpanish states: the title is not read, and a
      // line carrying a body name is not refused. If this goes red, the
      // check got stronger — invert it.
      expect(passed, language).toEqual([0, ...named]);
    }
    // Health: the named lines are a minority.
    expect(named.length).toBeLessThan(PROOF_MEMO_SENTENCES.length / 2);
  }, 60_000);

  it("fails a whole Galician or German rendering, packaged as Spanish", async () => {
    for (const [language, rendering] of Object.entries(UNMARKED_RENDERINGS)) {
      const verdict = await verifyTranslationProof(
        await translationPackage(rendering),
      );
      expect(verdict.ok, language).toBe(false);
    }
  }, 60_000);

  it("fails a Spanish translation cut short — of the memo, Spanish, and missing a name the memo goes on to give", async () => {
    // Health: the cut is Spanish and keeps SOME body names, so only the
    // whole-names rule can refuse it.
    expect(readsAsSpanish(SPANISH_TRANSLATION_CUT_SHORT)).toBe(true);
    const kept = PROOF_MEMO_BODY_NAMES.filter((name) =>
      mentions(SPANISH_TRANSLATION_CUT_SHORT, name),
    );
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(PROOF_MEMO_BODY_NAMES.length);
    const verdict = await verifyTranslationProof(
      await translationPackage(SPANISH_TRANSLATION_CUT_SHORT),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain(
      `but not ${PROOF_MEMO_BODY_NAMES.filter((n) => !kept.includes(n)).join(", ")} — `,
    );
  });

  it("the length floor is DERIVED: the most concise correct rendering's length, less the stated margin", () => {
    const ratios = MEMO_RENDERINGS.spanish.map(lengthAgainstMemo);
    const lowest = Math.min(...ratios);
    expect(TRANSLATION_LENGTH_AT_LEAST).toBe(
      Math.floor((lowest - TRANSLATION_LENGTH_MARGIN) * 100) / 100,
    );
    // Health: the memo itself is 1, and a Spanish rendering runs longer than
    // the concise one — the floor is not set by a broken reader.
    expect(lengthAgainstMemo(MEMO_TEXT)).toBe(1);
    expect(Math.max(...ratios)).toBeGreaterThan(1.1);
    expect(lowest).toBeGreaterThan(0.9);
  });

  it("fails a Spanish SUMMARY as the translation, and the translation with its middle dropped — Spanish, every name, too short", async () => {
    for (const [name, translation] of [
      ["a Spanish summary", SPANISH_SUMMARY_AS_TRANSLATION],
      ["the middle six sentences dropped", SPANISH_TRANSLATION_MIDDLE_DROPPED],
    ] as const) {
      // Health: Spanish by count and line, and keeping every body name, so
      // only the length can refuse it.
      expect(readsAsSpanish(translation), name).toBe(true);
      expect(linesNotInSpanish(translation), name).toEqual([]);
      for (const body of PROOF_MEMO_BODY_NAMES)
        expect(mentions(translation, body), `${name}: ${body}`).toBe(true);
      const verdict = await verifyTranslationProof(
        await translationPackage(translation),
      );
      expect(verdict.ok, name).toBe(false);
      expect(verdict.detail, name).toMatch(
        /of the memo's length, under 0\.8 — a summary of the memo, or a translation of part of it$/,
      );
    }
    // Health: the middle-dropped one is six sentences short.
    expect(SPANISH_TRANSLATION_MIDDLE_DROPPED.split("\n")).toHaveLength(
      PROOF_MEMO_SENTENCES.length + 1 - 6,
    );
  }, 60_000);

  it("THE LIMIT the floor's docblock states: the Spain rendering with ANY three unnamed sentences dropped passes", async () => {
    // Pinned so the limit is a fact. A length cannot see which part is
    // missing. If this goes red, the floor rose — invert it and rewrite
    // TRANSLATION_LENGTH_AT_LEAST's docblock.
    const lines = SPANISH_TRANSLATION.split("\n");
    const unnamed = lines.flatMap((line, i) =>
      PROOF_MEMO_BODY_NAMES.some((name) => mentions(line, name)) ? [] : [i],
    );
    let worst = Infinity;
    for (let a = 0; a < unnamed.length; a += 1)
      for (let b = a + 1; b < unnamed.length; b += 1)
        for (let c = b + 1; c < unnamed.length; c += 1)
          worst = Math.min(
            worst,
            lengthAgainstMemo(
              spanishWithout([unnamed[a]!, unnamed[b]!, unnamed[c]!]),
            ),
          );
    expect(worst).toBeGreaterThanOrEqual(TRANSLATION_LENGTH_AT_LEAST);
    // And through the package, the three longest gone.
    const longest = [...unnamed]
      .sort((x, y) => lines[y]!.length - lines[x]!.length)
      .slice(0, 3);
    const verdict = await verifyTranslationProof(
      await translationPackage(spanishWithout(longest)),
    );
    expect(verdict, verdict.detail).toMatchObject({ ok: true });
  }, 60_000);

  it("THE LIMIT the floor's docblock states: a telegraphic translation that keeps every fact is refused", async () => {
    // What a length floor gets WRONG, pinned so it is a fact: every sentence
    // of the memo, in Spanish, cut to its bones. If this goes green, the floor
    // dropped — invert it and rewrite TRANSLATION_LENGTH_AT_LEAST's docblock.
    const telegraphic = [
      "Memorando: puente Kestrel",
      "El puente Kestrel cruza el río Varrow por la costa.",
      "La ingeniera Ingrid Halvorsen lo inspeccionó el 14 de marzo.",
      "Cuatro de los doce cables tienen corrosión.",
      "Dos han perdido más del 10 % de su resistencia.",
      "Cambiar los cuatro llevará nueve semanas.",
      "Coste: 2.480.000 euros, del fondo regional.",
      "Los camiones de más de siete toneladas no podrán pasar.",
      "Coches y bicicletas, por un solo carril.",
      "Un ferry desde Ostby llevará los camiones.",
      "El ayuntamiento debe aprobarlo antes de fin de abril.",
      "Si las obras pasan de junio, se cerrará el puente.",
      "Halvorsen aconseja cambiar los otros ocho en cinco años.",
      "La próxima inspección, en dos años.",
    ].join("\n");
    // Health: Spanish by count and by line, every name — only length refuses.
    expect(readsAsSpanish(telegraphic)).toBe(true);
    expect(linesNotInSpanish(telegraphic)).toEqual([]);
    expect(lengthAgainstMemo(telegraphic)).toBeLessThan(
      TRANSLATION_LENGTH_AT_LEAST,
    );
    const verdict = await verifyTranslationProof(
      await translationPackage(telegraphic),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/of the memo's length, under 0\.8/);
  });

  it("fails a Spanish translation of some other document", async () => {
    const verdict = await verifyTranslationProof(
      await translationPackage(OTHER_DOCUMENT_SPANISH),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/keeps none of Halvorsen, Varrow, Ostby/);
  });

  it("fails a package made for another target language", async () => {
    const verdict = await verifyTranslationProof(
      await translationPackage(SPANISH_TRANSLATION, "fr"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/target was "fr", not "es"/);
  });
});

describe("verifyChatProof", () => {
  const opening = { ...CHAT_PROOF_OPENING, contextTurns: 0 };
  const followUp = { ...CHAT_PROOF_FOLLOW_UP, contextTurns: 2 };

  it("passes an opening answer that names the planted team, in either wording", async () => {
    for (const answer of RIGHT_OPENINGS) {
      const verdict = await verifyChatProof(
        await chatPackage(CHAT_PROOF_OPENING.question, answer),
        opening,
      );
      expect(verdict, verdict.detail).toMatchObject({ ok: true });
    }
  });

  it("passes a follow-up that names the channel, with both turns received, in either wording", async () => {
    for (const answer of RIGHT_FOLLOW_UPS) {
      const verdict = await verifyChatProof(
        await chatPackage(
          CHAT_PROOF_FOLLOW_UP.question,
          answer,
          FOLLOW_UP_CONTEXT,
        ),
        followUp,
      );
      expect(verdict, verdict.detail).toMatchObject({ ok: true });
    }
  });

  it("passes a model that resolves 'that team' from the turns the real engine sent it", async () => {
    const verdict = await verifyChatProof(
      await chatPackageFrom(
        readingModel,
        CHAT_PROOF_FOLLOW_UP.question,
        FOLLOW_UP_CONTEXT,
      ),
      followUp,
    );
    expect(verdict, verdict.detail).toMatchObject({ ok: true });
  });

  it("fails a fluent answer that does not come from the notes", async () => {
    const verdict = await verifyChatProof(
      await chatPackage(CHAT_PROOF_OPENING.question, WRONG_OPENING),
      opening,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/does not name "Ostrander"/);
    const second = await verifyChatProof(
      await chatPackage(
        CHAT_PROOF_FOLLOW_UP.question,
        WRONG_FOLLOW_UP,
        FOLLOW_UP_CONTEXT,
      ),
      followUp,
    );
    expect(second.detail).toMatch(/does not name "heron-pager"/);
  });

  it("fails an opening that names another team, or every team", async () => {
    for (const answer of [DECOY_OPENING, EVERY_TEAM_OPENING]) {
      const verdict = await verifyChatProof(
        await chatPackage(CHAT_PROOF_OPENING.question, answer),
        opening,
      );
      expect(verdict.ok, answer).toBe(false);
      expect(verdict.detail).toMatch(
        /names "Brenner".*which the notes give for another team/,
      );
    }
  });

  it("fails a follow-up whose turns never reached the model: it lists every channel, asks, or names another team's", async () => {
    const listing = await verifyChatProof(
      await chatPackageFrom(
        droppingTurns(readingModel),
        CHAT_PROOF_FOLLOW_UP.question,
        FOLLOW_UP_CONTEXT,
      ),
      followUp,
    );
    expect(listing.ok).toBe(false);
    expect(listing.detail).toMatch(
      /names "kite-desk", "wren-relay", "lark-watch", which the notes give for another team/,
    );
    // The manifest cannot see it: the engine counted the turns it was GIVEN.
    expect(listing.detail).not.toMatch(/contextTurns/);
    const asking = await verifyChatProof(
      await chatPackageFrom(
        droppingTurns(replying(CLARIFYING_FOLLOW_UP)),
        CHAT_PROOF_FOLLOW_UP.question,
        FOLLOW_UP_CONTEXT,
      ),
      followUp,
    );
    expect(asking.detail).toMatch(/does not name "heron-pager"/);
    const wrongGuess = await verifyChatProof(
      await chatPackageFrom(
        droppingTurns(replying(DECOY_FOLLOW_UP)),
        CHAT_PROOF_FOLLOW_UP.question,
        FOLLOW_UP_CONTEXT,
      ),
      followUp,
    );
    expect(wrongGuess.detail).toMatch(/names "kite-desk"/);
  });

  it("THE LIMIT the follow-up's docblock states: a model sent no turns that guesses the right team passes", async () => {
    // Pinned so the docblock's limit is a fact, not a comment: if this goes
    // red, delivery became visible — invert it, and rewrite CHAT_PROOF_FOLLOW_UP.
    const verdict = await verifyChatProof(
      await chatPackageFrom(
        droppingTurns(replying(RIGHT_FOLLOW_UP)),
        CHAT_PROOF_FOLLOW_UP.question,
        FOLLOW_UP_CONTEXT,
      ),
      followUp,
    );
    expect(verdict.ok).toBe(true);
  });

  it("THE LIMIT, deterministic: a worker that forwards only the USER's turns passes — the opening question names the part only one team maintains", async () => {
    // Pinned so the docblock's second limit is a fact. The opening asks which
    // team maintains the secure worker fleet; the notes give one team for
    // it; so the follow-up is answerable from the user's own turn and the
    // notes, without the assistant's answer. If this goes red, the follow-up
    // came to need the assistant's turn — invert it, and rewrite
    // CHAT_PROOF_FOLLOW_UP and the follow-up spec's comment.
    const { provider, sent } = userTurnsOnly(readingModel);
    const verdict = await verifyChatProof(
      await chatPackageFrom(
        provider,
        CHAT_PROOF_FOLLOW_UP.question,
        FOLLOW_UP_CONTEXT,
      ),
      followUp,
    );
    // Health: the model got the opening question and no assistant turn.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((m) => m.role)).toEqual(["user", "user"]);
    expect(sent[0]![0]!.content).toContain(CHAT_PROOF_OPENING.question);
    expect(
      sent[0]!.some((m) => mentions(m.content, CHAT_PROOF_FACTS.team)),
    ).toBe(false);
    expect(verdict, verdict.detail).toMatchObject({ ok: true });
  });

  it("fails the notes echoed back as the answer — though it names the team", async () => {
    const verdict = await verifyChatProof(
      await chatPackage(CHAT_PROOF_OPENING.question, CHAT_LINES.join("\n")),
      opening,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/the notes echoed back/);
  });

  it("fails an empty answer, and an answer to a different question", async () => {
    const empty = await verifyChatProof(
      await handPackage({
        "answer.txt": `Q: ${CHAT_PROOF_OPENING.question}\n\nA: \n`,
        "manifest.json": JSON.stringify({ contextTurns: 0 }),
      }),
      opening,
    );
    expect(empty.detail).toMatch(/holds no answer to the question asked/);
    const elsewhere = await verifyChatProof(
      await chatPackage("What is this document for?", RIGHT_OPENING),
      opening,
    );
    expect(elsewhere.detail).toMatch(/holds no answer to the question asked/);
  });

  it("fails a follow-up the worker received without its turns", async () => {
    const verdict = await verifyChatProof(
      await chatPackage(CHAT_PROOF_FOLLOW_UP.question, RIGHT_FOLLOW_UP),
      followUp,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/contextTurns=0, wanted 2/);
  });
});

// ── and as the harness runs them ────────────────────────────────────────────

type Case = {
  readonly name: string;
  readonly bytes: () => Promise<Uint8Array>;
};

/**
 * For each AI proof the harness runs, by its ledger key: packages it must
 * pass and packages it must fail. Held equal to `AI_PROOF_SPECS` below in
 * both directions, so a new AI proof arrives with its wrong packages.
 */
const CASES: Record<string, { right: Case[]; wrong: Case[] }> = {
  "summarize-pdf": {
    right: RIGHT_SUMMARIES.map((summary, i) => ({
      name: `a summary of the memo (wording ${i + 1})`,
      bytes: () => summaryPackage(summary),
    })),
    wrong: [
      {
        name: "an empty summary",
        bytes: () => handPackage({ "summary.txt": "" }),
      },
      { name: "the memo echoed", bytes: () => summaryPackage(MEMO_TEXT) },
      {
        name: "another document's summary",
        bytes: () => summaryPackage(OTHER_DOCUMENT_SUMMARY),
      },
      {
        name: "another document about corroded cables",
        bytes: () => summaryPackage(OTHER_CORROSION_SUMMARY),
      },
      {
        name: "the title alone",
        bytes: () => summaryPackage(TITLE_ONLY_SUMMARY),
      },
      {
        name: "a kestrel, the bird",
        bytes: () => summaryPackage(KESTREL_BIRD_SUMMARY),
      },
      ...GENERIC_BRIDGE_SUMMARIES.map(({ name, text }) => ({
        name,
        bytes: () => summaryPackage(text),
      })),
    ],
  },
  "translate-pdf": {
    right: MEMO_RENDERINGS.spanish.map((translation, i) => ({
      name: `a Spanish translation (rendering ${i + 1})`,
      bytes: () => translationPackage(translation),
    })),
    wrong: [
      { name: "the memo echoed", bytes: () => translationPackage(MEMO_TEXT) },
      {
        name: "an English paraphrase",
        bytes: () => translationPackage(ENGLISH_PARAPHRASE),
      },
      {
        name: "Italian, as Spanish",
        bytes: () => translationPackage(ITALIAN_TRANSLATION),
      },
      {
        name: "Portuguese, as Spanish",
        bytes: () => translationPackage(PORTUGUESE_TRANSLATION),
      },
      {
        name: "Catalan, as Spanish",
        bytes: () => translationPackage(CATALAN_TRANSLATION),
      },
      {
        name: "French, as Spanish",
        bytes: () => translationPackage(FRENCH_TRANSLATION),
      },
      {
        name: "Spanish drifting into Italian",
        bytes: () => translationPackage(SPANISH_DRIFTING_INTO_ITALIAN),
      },
      ...Object.entries(NEIGHBOUR_RENDERINGS).map(([language, rendering]) => ({
        name: `Spanish whose last two lines are ${language}`,
        bytes: () => translationPackage(spanishDriftingInto(rendering, 2)),
      })),
      {
        name: "Spanish with one sentence left in English",
        bytes: () => translationPackage(spanishWithEnglishLine(2)),
      },
      {
        name: "Spanish whose last six lines are Galician",
        bytes: () =>
          translationPackage(spanishDriftingInto(GALICIAN_TRANSLATION, 6)),
      },
      {
        name: "Spanish with one German sentence in the middle",
        bytes: () =>
          translationPackage(spanishWithLineFrom(GERMAN_TRANSLATION, 7)),
      },
      {
        name: "a Spanish summary as the translation",
        bytes: () => translationPackage(SPANISH_SUMMARY_AS_TRANSLATION),
      },
      {
        name: "Spanish with its middle six sentences dropped",
        bytes: () => translationPackage(SPANISH_TRANSLATION_MIDDLE_DROPPED),
      },
      {
        name: "a Spanish translation cut short",
        bytes: () => translationPackage(SPANISH_TRANSLATION_CUT_SHORT),
      },
      {
        name: "another document in Spanish",
        bytes: () => translationPackage(OTHER_DOCUMENT_SPANISH),
      },
      {
        name: "a French package",
        bytes: () => translationPackage(SPANISH_TRANSLATION, "fr"),
      },
    ],
  },
  // Its own suite (`./extraction-proof.test.ts`) reads the values; here only
  // that the harness's spec is that check, on a right and a wrong package.
  "ai-extract": {
    right: [],
    wrong: [
      {
        name: "no extraction at all",
        bytes: () => handPackage({ "extraction.json": "{}" }),
      },
    ],
  },
  "chat-with-pdf": {
    right: RIGHT_OPENINGS.map((answer, i) => ({
      name: `the team, named (wording ${i + 1})`,
      bytes: () => chatPackage(CHAT_PROOF_OPENING.question, answer),
    })),
    wrong: [
      {
        name: "a team the notes do not name",
        bytes: () => chatPackage(CHAT_PROOF_OPENING.question, WRONG_OPENING),
      },
      {
        name: "another team the notes name",
        bytes: () => chatPackage(CHAT_PROOF_OPENING.question, DECOY_OPENING),
      },
      {
        name: "every team the notes name",
        bytes: () =>
          chatPackage(CHAT_PROOF_OPENING.question, EVERY_TEAM_OPENING),
      },
      {
        name: "the notes echoed",
        bytes: () =>
          chatPackage(CHAT_PROOF_OPENING.question, CHAT_LINES.join("\n")),
      },
      {
        name: "context it was never sent",
        bytes: () =>
          chatPackage(
            CHAT_PROOF_OPENING.question,
            RIGHT_OPENING,
            FOLLOW_UP_CONTEXT,
          ),
      },
    ],
  },
  "chat-with-pdf (follow-up)": {
    right: [
      ...RIGHT_FOLLOW_UPS.map((answer, i) => ({
        name: `the channel, named (wording ${i + 1})`,
        bytes: () =>
          chatPackage(CHAT_PROOF_FOLLOW_UP.question, answer, FOLLOW_UP_CONTEXT),
      })),
      {
        name: "a model that read the turns the engine sent",
        bytes: () =>
          chatPackageFrom(
            readingModel,
            CHAT_PROOF_FOLLOW_UP.question,
            FOLLOW_UP_CONTEXT,
          ),
      },
    ],
    wrong: [
      {
        name: "a channel the notes do not name",
        bytes: () =>
          chatPackage(
            CHAT_PROOF_FOLLOW_UP.question,
            WRONG_FOLLOW_UP,
            FOLLOW_UP_CONTEXT,
          ),
      },
      {
        name: "another team's channel",
        bytes: () =>
          chatPackage(
            CHAT_PROOF_FOLLOW_UP.question,
            DECOY_FOLLOW_UP,
            FOLLOW_UP_CONTEXT,
          ),
      },
      {
        name: "turns that never arrived",
        bytes: () =>
          chatPackage(CHAT_PROOF_FOLLOW_UP.question, RIGHT_FOLLOW_UP),
      },
      {
        name: "turns counted by the engine and dropped before the model",
        bytes: () =>
          chatPackageFrom(
            droppingTurns(readingModel),
            CHAT_PROOF_FOLLOW_UP.question,
            FOLLOW_UP_CONTEXT,
          ),
      },
      {
        name: "the opening's answer, again",
        bytes: () =>
          chatPackage(
            CHAT_PROOF_OPENING.question,
            RIGHT_OPENING,
            FOLLOW_UP_CONTEXT,
          ),
      },
    ],
  },
};

const labelOf = (spec: AiProofSpec) => spec.label ?? spec.tool;

describe("the harness runs these checks", () => {
  it("every AI proof has right and wrong packages here, and nothing else does", () => {
    expect(Object.keys(CASES).sort()).toEqual(
      AI_PROOF_SPECS.map(labelOf).sort(),
    );
    // Health: the corpus is not hollow — each proof has a wrong package.
    for (const [label, { wrong }] of Object.entries(CASES))
      expect(wrong.length, label).toBeGreaterThan(0);
  });

  for (const spec of AI_PROOF_SPECS) {
    const cases = CASES[labelOf(spec)];
    it(`${labelOf(spec)}: checks the content, passing the right package and failing every wrong one`, async () => {
      expect(
        spec.verify,
        `${labelOf(spec)} checks nothing inside the package`,
      ).toBeDefined();
      for (const right of cases?.right ?? []) {
        const verdict = await spec.verify!(await right.bytes());
        expect(verdict, `${right.name}: ${verdict.detail}`).toMatchObject({
          ok: true,
        });
      }
      for (const wrong of cases?.wrong ?? []) {
        const verdict = await spec.verify!(await wrong.bytes());
        expect(verdict.ok, `${wrong.name} passed: ${verdict.detail}`).toBe(
          false,
        );
      }
    }, 60_000);
  }
});

describe("the chat follow-up is built the way the browser builds it", () => {
  it("asks the follow-up, carrying the opening exchange as buildChatContext makes it from the answer readAnswerFromPackage reads", async () => {
    const spec = AI_PROOF_SPECS.find((s) => s.optionsFrom)!;
    const openingSpec = AI_PROOF_SPECS.find(
      (s) => s.keepArtifactAs === spec.optionsFrom!.artifact,
    )!;
    expect(openingSpec.options).toEqual({
      question: CHAT_PROOF_OPENING.question,
    });
    const options = await spec.optionsFrom!.build(
      await chatPackage(CHAT_PROOF_OPENING.question, RIGHT_OPENING),
    );
    expect(options).toEqual({
      question: CHAT_PROOF_FOLLOW_UP.question,
      context: FOLLOW_UP_CONTEXT,
    });
    // POSITIVE CONTROL: the assistant turn is the ANSWER — until 2026-10-09
    // the harness sent answer.txt whole, "Q: … A: …", which no browser sends.
    expect(FOLLOW_UP_CONTEXT[1]).toEqual({
      role: "assistant",
      content: RIGHT_OPENING,
    });
  });

  it("refuses to build a follow-up from an opening it cannot read back", async () => {
    const spec = AI_PROOF_SPECS.find((s) => s.optionsFrom)!;
    await expect(
      spec.optionsFrom!.build(
        await chatPackage("What is this document for?", RIGHT_OPENING),
      ),
    ).rejects.toThrow(/could not be read back/);
  });
});
