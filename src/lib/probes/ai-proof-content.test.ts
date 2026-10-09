// @vitest-environment node
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
 * turns passes every time — now a pinned limit.
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
  ITALIAN_TRANSLATION,
  MEMO_RENDERINGS,
  MEMO_TEXT,
  NEIGHBOUR_RENDERINGS,
  PORTUGUESE_TRANSLATION,
  SPANISH_DRIFTING_INTO_ITALIAN,
  SPANISH_TRANSLATION,
  SPANISH_TRANSLATION_CERNICALO,
  SPANISH_TRANSLATION_CUT_SHORT,
  SPANISH_TRANSLATION_KESTREL_BRIDGE,
  spanishDriftingInto,
  spanishWithEnglishLine,
} from "@/tests/ai-proof-memo-renderings";
import {
  CHAT_PROOF_DECOYS,
  CHAT_PROOF_FACTS,
  CHAT_PROOF_FOLLOW_UP,
  CHAT_PROOF_OPENING,
  CHAT_PROOF_PAGES,
  LANGUAGE_MARKERS,
  MARKED_LANGUAGES,
  PROOF_MEMO_BODY_NAMES,
  PROOF_MEMO_BODY_STEMS,
  PROOF_MEMO_FIGURES,
  PROOF_MEMO_SENTENCES,
  PROOF_MEMO_SUBJECT,
  PROOF_MEMO_TITLE,
  SPANISH_MARKERS_AT_LEAST,
  echoes,
  languageMarkers,
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
 * Summaries of the memo in many wordings: four full ones, then terse ones that
 * each carry ONE mark of the body, so every mark the check counts passes some
 * summary on its own.
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
    expect(memoBodyMarksIn(body).length).toBe(
      PROOF_MEMO_BODY_NAMES.length +
        PROOF_MEMO_BODY_STEMS.length +
        PROOF_MEMO_FIGURES.length,
    );
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
      expect(verdict.detail).toMatch(
        /but nothing only the memo's body says \(Halvorsen, Varrow, Ostby, ferry…, nine weeks, /,
      );
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
    // goes red the check got stronger — invert it and rewrite the docblock.
    expect(readsAsSpanish(spanishWithEnglishLine(0))).toBe(true);
    expect(
      Object.entries(NEIGHBOUR_RENDERINGS)
        .filter(([, rendering]) =>
          readsAsSpanish(spanishDriftingInto(rendering, 1)),
        )
        .map(([language]) => language),
    ).toEqual(["italian", "portuguese", "catalan"]);
  });

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
