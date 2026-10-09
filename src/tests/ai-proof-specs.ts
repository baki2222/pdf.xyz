/**
 * The production proofs of the AI tools, as values — what
 * `scripts/worker-prove-tools.ts` uploads, asks and accepts for summarize-pdf,
 * translate-pdf, ai-extract and chat-with-pdf.
 *
 * WHY THEY LIVE HERE, NOT IN THE SCRIPT (2026-10-09). The script runs on
 * import, so a test can read its specs only as source. Two properties of an
 * AI proof cannot be read off source: what the browser would DECLARE for its
 * fixture (a number, counted from the PDF the spec builds — see
 * `@/lib/probes/ai-proof-declaration`), and whether its check refuses a
 * wrong package (a verdict, computed from bytes). Here the specs are objects
 * a test can run. The script spreads {@link AI_PROOF_SPECS} into its own list
 * and adds only the container check, and `ai-proof-declaration.test.tsx`
 * holds that no AI spec is written anywhere else.
 */
import {
  PROOF_EXTRACTION_SCHEMA,
  verifyExtractionProof,
} from "@/lib/probes/extraction-proof";
import {
  CHAT_PROOF_FOLLOW_UP,
  CHAT_PROOF_OPENING,
  PROOF_TRANSLATION_TARGET,
  verifyChatProof,
  verifySummaryProof,
  verifyTranslationProof,
} from "@/lib/probes/ai-proof-content";
import {
  buildChatContext,
  readAnswerFromPackage,
} from "@/lib/workers/chat-with-pdf-conversation";
import { proofTablePdf } from "./extraction-proof-fixtures";
import { chatProofPdf, memoProofPdf } from "./ai-proof-fixtures";

export interface AiProofVerdict {
  ok: boolean;
  detail: string;
}

export interface AiProofSpec {
  readonly tool: string;
  /** Distinguishes two specs for the same tool (the chat follow-up). */
  readonly label?: string;
  readonly make: () => Promise<Uint8Array>;
  readonly name: string;
  readonly options?: Record<string, unknown>;
  /**
   * Build `options` from a previously kept artifact — what a chat follow-up
   * needs, since it carries the previous question and answer as context while
   * re-sending the same document.
   */
  readonly optionsFrom?: {
    readonly artifact: string;
    readonly build: (bytes: Uint8Array) => Promise<Record<string, unknown>>;
  };
  readonly want: string;
  /**
   * What is INSIDE the package, once the container shape has passed. Required:
   * every AI tool returns a ZIP, so the container says only "a ZIP came back",
   * which was all summarize-pdf and translate-pdf were proven by until
   * 2026-10-09 (`@/lib/probes/ai-proof-content`).
   */
  readonly verify: (bytes: Uint8Array) => Promise<AiProofVerdict>;
  readonly keepArtifactAs?: string;
}

// The AI tools run only when an operator has configured a provider; with none
// they fail honestly as not-configured, which is correct behaviour rather than
// a proof — so a run against an AI-less deployment reports them as failures
// and that is the honest answer, not a bug in the harness.
export const AI_PROOF_SPECS: readonly AiProofSpec[] = [
  {
    tool: "summarize-pdf",
    make: memoProofPdf,
    name: "report.pdf",
    options: { length: "brief", format: "paragraphs" },
    want: "summary ZIP",
    // A summary OF THE MEMO: not empty, not the memo echoed, naming what it
    // is about. A ZIP alone passed this spec until 2026-10-09.
    verify: (bytes) => verifySummaryProof(bytes),
  },
  {
    tool: "translate-pdf",
    make: memoProofPdf,
    name: "letter.pdf",
    options: {
      targetLanguage: PROOF_TRANSLATION_TARGET,
      sourceLanguage: "auto",
    },
    want: "translation ZIP",
    // Spanish, of the memo: not empty, not the memo echoed, not its English,
    // keeping its names. A ZIP alone passed this spec until 2026-10-09.
    verify: (bytes) => verifyTranslationProof(bytes),
  },
  {
    tool: "ai-extract",
    // The fixture, the request and the expected answer are one definition
    // (`@/lib/probes/extraction-proof`). Until 2026-10-09 the request asked
    // for ONE region and ONE Q1 figure of a four-row table — no single right
    // answer, so the model answered null as the engine instructs — and the
    // verifier accepted any one row. It now asks for each column as a list
    // and accepts the whole column, top to bottom, and nothing less.
    make: proofTablePdf,
    name: "table.pdf",
    options: {
      mode: "schema",
      schema: PROOF_EXTRACTION_SCHEMA.map((field) => ({ ...field })),
    },
    want: "extraction ZIP",
    // The VALUES, not the container: a ZIP whose extraction.json was `{}`
    // passed this spec until 2026-09-28 (`@/lib/probes/extraction-proof`).
    verify: (bytes) => verifyExtractionProof(bytes),
  },
  {
    tool: "chat-with-pdf",
    make: chatProofPdf,
    name: "doc.pdf",
    // A question the notes answer, and only with the team planted in them.
    // Until 2026-10-09 it asked "what is this document for?", which any
    // fluent sentence answers, and the check read the turn count alone.
    options: { question: CHAT_PROOF_OPENING.question },
    want: "answer ZIP",
    // Pins the OPENING turn as context-free — without it the follow-up below
    // could pass while every request silently carried the same context — and
    // its answer as THE NOTES' answer to THIS question.
    verify: (bytes) =>
      verifyChatProof(bytes, { ...CHAT_PROOF_OPENING, contextTurns: 0 }),
    keepArtifactAs: "chat-answer-1",
  },
  // The conversation itself. `chat-with-pdf` accepted prior turns on the wire long
  // before anything produced any, so the tool shipped unable to hold a conversation
  // while every readiness surface said it was fine. The spec above cannot catch that:
  // it sends no context, so it passes identically whether or not the worker supports
  // any. This one sends a real follow-up built from the previous answer and asserts
  // the worker received both turns — a claim that is false if context is dropped
  // anywhere between the API, the queue, the engine and the provider.
  //
  // It also carries the only measurement of the prompt-caching bet. Caching the
  // document is justified in the engine by follow-ups re-sending it verbatim, and
  // `cachedInput` is the number that decides whether that pays. Nothing else in this
  // repo ever issues a request carrying prior turns, so without this spec the bet
  // stays unfalsifiable no matter how long the deployment runs.
  {
    tool: "chat-with-pdf",
    label: "chat-with-pdf (follow-up)",
    // The SAME document as the opening turn: the cached span is the document inside
    // the system prompt, so a different fixture here would guarantee a miss.
    make: chatProofPdf,
    name: "doc.pdf",
    optionsFrom: {
      artifact: "chat-answer-1",
      // As the panel builds it: the answer read back with the browser's own
      // reader, the turns with the browser's own builder. Until 2026-10-09
      // this sent answer.txt whole — "Q: … A: …" — as the assistant turn,
      // cut at a length of its own, which no browser ever sends.
      build: async (bytes) => {
        const answer = await readAnswerFromPackage(
          bytes,
          CHAT_PROOF_OPENING.question,
        );
        if (answer === null)
          throw new Error(
            "the opening answer could not be read back as the browser reads it",
          );
        return {
          question: CHAT_PROOF_FOLLOW_UP.question,
          context: buildChatContext([
            { question: CHAT_PROOF_OPENING.question, answer },
          ]).turns,
        };
      },
    },
    want: "answer ZIP",
    // Both turns reached the worker, and "that team" was answered from the
    // notes: the channel only that team's line names.
    verify: (bytes) =>
      verifyChatProof(bytes, { ...CHAT_PROOF_FOLLOW_UP, contextTurns: 2 }),
  },
];
