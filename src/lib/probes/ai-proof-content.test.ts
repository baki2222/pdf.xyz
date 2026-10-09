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
 * Every package below is built OFFLINE — no provider is called. The right
 * ones and most wrong ones come out of the REAL engine (`runSummarize`,
 * `runTranslate`, `runChatWithPdf`) reading the REAL fixture through the real
 * extractor, with a stand-in model that returns a given text; shapes the
 * engine refuses to build (an empty file) are written by hand. Each check is
 * driven twice: as a function, and as the `verify` the harness actually runs
 * (`AI_PROOF_SPECS`), so a correct check wired to the wrong spec — or to no
 * spec — fails here.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "@/lib/pdf/text";
import type { AiProvider } from "@/lib/workers/ai/provider";
import { runSummarize } from "@/lib/workers/summarize/engine";
import { runTranslate } from "@/lib/workers/translate/engine";
import { runChatWithPdf } from "@/lib/workers/chat-with-pdf/engine";
import type { ChatTurn } from "@/lib/jobs/chat-with-pdf";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import { buildChatContext } from "@/lib/workers/chat-with-pdf-conversation";
import { AI_PROOF_SPECS, type AiProofSpec } from "@/tests/ai-proof-specs";
import { chatProofPdf, memoProofPdf } from "@/tests/ai-proof-fixtures";
import {
  CHAT_PROOF_FACTS,
  CHAT_PROOF_FOLLOW_UP,
  CHAT_PROOF_OPENING,
  CHAT_PROOF_PAGES,
  PROOF_MEMO_NAMES,
  PROOF_MEMO_SENTENCES,
  PROOF_MEMO_TITLE,
  echoes,
  languageMarkers,
  mentions,
  readsAsSpanish,
  sentencesCarried,
  verifyChatProof,
  verifySummaryProof,
  verifyTranslationProof,
} from "./ai-proof-content";

// ── the stand-in model, and packages built by the real engines ──────────────

const replying = (text: string): AiProvider => ({
  id: "openai",
  model: "gpt-test",
  complete: async () => ({ ok: true, text, model: "gpt-test" }),
});

const extract = (bytes: Uint8Array) => extractPdfText(bytes);

const MEMO_TEXT = [PROOF_MEMO_TITLE, ...PROOF_MEMO_SENTENCES].join("\n");
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

async function chatPackage(
  question: string,
  answer: string,
  context?: ChatTurn[],
): Promise<Uint8Array> {
  const run = await runChatWithPdf(
    await chatProofPdf(),
    { question, ...(context ? { context } : {}) },
    { extract, provider: replying(answer) },
  );
  if (!run.ok) throw new Error(`chat engine: ${run.message}`);
  return run.output;
}

/** A package the engine would refuse to build, written by hand. */
async function handPackage(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: "uint8array" });
}

// ── the answers, right and wrong ────────────────────────────────────────────

const RIGHT_SUMMARY =
  "The memo reports corrosion on the Kestrel Bridge over the Varrow River. " +
  "Engineer Ingrid Halvorsen found four of its twelve cables damaged; replacing them " +
  "will take nine weeks and cost about 2.48 million euros, with trucks sent to a ferry. " +
  "The council has to approve the budget by the end of April.";
/** What a summary of the harness's old `textPdf` says: fluent, and about something else. */
const OTHER_DOCUMENT_SUMMARY =
  "This document is a short deployment proof for pdf.xyz. It carries real, " +
  "selectable text so that text-extracting tools have something honest to extract.";

const RIGHT_TRANSLATION = [
  "Memorando de inspección del puente Kestrel",
  "El puente Kestrel lleva la carretera de la costa sobre el río Varrow.",
  "La ingeniera Ingrid Halvorsen inspeccionó el puente el 14 de marzo.",
  "Encontró corrosión en cuatro de los doce cables de acero que sostienen el tramo principal.",
  "Dos de esos cables han perdido más de una décima parte de su resistencia.",
  "La reparación sustituirá los cuatro cables y durará nueve semanas.",
  "Se espera que cueste 2.480.000 euros, pagados con el fondo regional de carreteras.",
  "Los camiones de más de siete toneladas no podrán cruzar el puente mientras duren las obras.",
  "Los coches y las bicicletas aún podrán cruzar, pero solo por un carril a la vez.",
  "Un transbordador desde el puerto de Ostby llevará los camiones al otro lado del río.",
  "El ayuntamiento debe aprobar el presupuesto antes de finales de abril.",
  "Si las obras se retrasan más allá de junio, el puente se cerrará a todo el tráfico.",
  "Halvorsen también recomienda sustituir los otros ocho cables en un plazo de cinco años.",
  "La próxima inspección completa del puente Kestrel está prevista dentro de dos años.",
].join("\n");
/** The memo re-told in its OWN language: names kept, nothing verbatim, not Spanish. */
const ENGLISH_PARAPHRASE =
  "Memo on the Kestrel Bridge: the crossing over the Varrow River was checked by " +
  "Ingrid Halvorsen, who saw that four of its cables are corroded. They are to be " +
  "replaced over nine weeks for 2.48 million euros, and trucks must use a ferry " +
  "while the work is under way.";
/** A Spanish translation of some other document. */
const OTHER_DOCUMENT_SPANISH =
  "Prueba de despliegue de pdf.xyz. El documento es una prueba breve. Contiene " +
  "texto real y seleccionable para que las herramientas que extraen texto " +
  "tengan algo honesto que extraer.";

const RIGHT_OPENING = `The ${CHAT_PROOF_FACTS.team} team maintains the secure worker fleet [p.2].`;
const WRONG_OPENING =
  "The secure worker fleet is maintained by the platform team [p.1].";
const RIGHT_FOLLOW_UP = `That team takes its pages on the #${CHAT_PROOF_FACTS.channel} channel [p.2].`;
const WRONG_FOLLOW_UP =
  "That team takes its pages on the on-call channel [p.2].";

/** The follow-up's context, as the browser builds it from the right opening. */
const FOLLOW_UP_CONTEXT = buildChatContext([
  { question: CHAT_PROOF_OPENING.question, answer: RIGHT_OPENING },
]).turns;

// ── the fixtures carry what the checks look for ─────────────────────────────

describe("the fixtures are what the checks assume", () => {
  it("every name the summary and translation checks look for is in the memo, and the memo reads as English", () => {
    for (const name of PROOF_MEMO_NAMES)
      expect(mentions(MEMO_TEXT, name), name).toBe(true);
    expect(readsAsSpanish(MEMO_TEXT)).toBe(false);
    expect(languageMarkers(MEMO_TEXT).english).toBeGreaterThanOrEqual(20);
    // And the right translation the controls use reads as Spanish.
    expect(readsAsSpanish(RIGHT_TRANSLATION)).toBe(true);
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
    // An answer that repeats its question cannot pass by naming the fact.
    expect(
      mentions(CHAT_PROOF_OPENING.question, CHAT_PROOF_OPENING.mustMention),
    ).toBe(false);
    expect(
      mentions(CHAT_PROOF_FOLLOW_UP.question, CHAT_PROOF_FOLLOW_UP.mustMention),
    ).toBe(false);
    // The PDF says it, and is still long enough for the prompt-cache measurement.
    const text = (await extract(await chatProofPdf())).text;
    for (const line of [...withTeam, ...withChannel])
      expect(sentencesCarried(text, [line]), line).toBe(1);
    expect(text.length).toBeGreaterThan(20_000);
  });
});

// ── each check, as a function ───────────────────────────────────────────────

describe("verifySummaryProof", () => {
  it("passes a summary of the memo", async () => {
    const verdict = await verifySummaryProof(
      await summaryPackage(RIGHT_SUMMARY),
    );
    expect(verdict, verdict.detail).toMatchObject({ ok: true });
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

  it("fails a fluent summary of some other document", async () => {
    const verdict = await verifySummaryProof(
      await summaryPackage(OTHER_DOCUMENT_SUMMARY),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/names none of Kestrel, Halvorsen, Varrow/);
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
  it("passes a Spanish translation of the memo", async () => {
    const verdict = await verifyTranslationProof(
      await translationPackage(RIGHT_TRANSLATION),
    );
    expect(verdict, verdict.detail).toMatchObject({ ok: true });
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
    expect(verdict.detail).toMatch(/does not read as Spanish/);
  });

  it("fails a Spanish translation of some other document", async () => {
    const verdict = await verifyTranslationProof(
      await translationPackage(OTHER_DOCUMENT_SPANISH),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/keeps none of Kestrel, Halvorsen, Varrow/);
  });

  it("fails a package made for another target language", async () => {
    const verdict = await verifyTranslationProof(
      await translationPackage(RIGHT_TRANSLATION, "fr"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/target was "fr", not "es"/);
  });
});

describe("verifyChatProof", () => {
  const opening = { ...CHAT_PROOF_OPENING, contextTurns: 0 };
  const followUp = { ...CHAT_PROOF_FOLLOW_UP, contextTurns: 2 };

  it("passes an opening answer that names the planted team", async () => {
    const verdict = await verifyChatProof(
      await chatPackage(CHAT_PROOF_OPENING.question, RIGHT_OPENING),
      opening,
    );
    expect(verdict, verdict.detail).toMatchObject({ ok: true });
  });

  it("passes a follow-up that names the channel, with both turns received", async () => {
    const verdict = await verifyChatProof(
      await chatPackage(
        CHAT_PROOF_FOLLOW_UP.question,
        RIGHT_FOLLOW_UP,
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
    right: [
      {
        name: "a summary of the memo",
        bytes: () => summaryPackage(RIGHT_SUMMARY),
      },
    ],
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
    ],
  },
  "translate-pdf": {
    right: [
      {
        name: "a Spanish translation",
        bytes: () => translationPackage(RIGHT_TRANSLATION),
      },
    ],
    wrong: [
      { name: "the memo echoed", bytes: () => translationPackage(MEMO_TEXT) },
      {
        name: "an English paraphrase",
        bytes: () => translationPackage(ENGLISH_PARAPHRASE),
      },
      {
        name: "another document in Spanish",
        bytes: () => translationPackage(OTHER_DOCUMENT_SPANISH),
      },
      {
        name: "a French package",
        bytes: () => translationPackage(RIGHT_TRANSLATION, "fr"),
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
    right: [
      {
        name: "the team, named",
        bytes: () => chatPackage(CHAT_PROOF_OPENING.question, RIGHT_OPENING),
      },
    ],
    wrong: [
      {
        name: "another team",
        bytes: () => chatPackage(CHAT_PROOF_OPENING.question, WRONG_OPENING),
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
      {
        name: "the channel, named",
        bytes: () =>
          chatPackage(
            CHAT_PROOF_FOLLOW_UP.question,
            RIGHT_FOLLOW_UP,
            FOLLOW_UP_CONTEXT,
          ),
      },
    ],
    wrong: [
      {
        name: "another channel",
        bytes: () =>
          chatPackage(
            CHAT_PROOF_FOLLOW_UP.question,
            WRONG_FOLLOW_UP,
            FOLLOW_UP_CONTEXT,
          ),
      },
      {
        name: "turns that never arrived",
        bytes: () =>
          chatPackage(CHAT_PROOF_FOLLOW_UP.question, RIGHT_FOLLOW_UP),
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
