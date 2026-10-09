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
import JSZip from "jszip";
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
  /** What is INSIDE the package, once the container shape has passed. */
  readonly verify?: (bytes: Uint8Array) => Promise<AiProofVerdict>;
  readonly keepArtifactAs?: string;
}

/**
 * The slice of `chat-with-pdf`'s `manifest.json` this proof reads. Counts only —
 * the harness never prints the answer text.
 */
interface ChatProofManifest {
  question?: string;
  contextTurns?: number;
  usage?: { input?: number; output?: number; cachedInput?: number };
}

/** Read `manifest.json` + `answer.txt` out of a chat answer ZIP. */
async function readChatAnswer(
  zipBytes: Uint8Array,
): Promise<{ manifest: ChatProofManifest; answer: string }> {
  const zip = await JSZip.loadAsync(zipBytes);
  const manifestFile = zip.file("manifest.json");
  const answerFile = zip.file("answer.txt");
  if (!manifestFile || !answerFile) {
    throw new Error("the answer ZIP is missing manifest.json or answer.txt");
  }
  const manifest = JSON.parse(
    await manifestFile.async("string"),
  ) as ChatProofManifest;
  return { manifest, answer: (await answerFile.async("string")).trim() };
}

/**
 * The contract caps one turn at `MAX_TURN_CHARS` (4000) and `POST /api/jobs` caps the
 * whole options object at 8 KB of UTF-8, so a long answer has to be shortened before
 * it can travel back as context — exactly what the browser-side builder does. Kept
 * well under both so this proof fails on the worker's behaviour, never on a bound.
 */
const PROOF_TURN_CHARS = 1500;

/** Report token accounting without ever printing text. */
function usageNote(m: ChatProofManifest): string {
  if (!m.usage) return "usage not reported";
  const cached = m.usage.cachedInput;
  return (
    `input=${m.usage.input ?? "?"} output=${m.usage.output ?? "?"} ` +
    `cachedInput=${cached ?? 0}${cached ? "" : " (no cache read)"}`
  );
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
  },
  {
    tool: "translate-pdf",
    make: memoProofPdf,
    name: "letter.pdf",
    options: { targetLanguage: "es", sourceLanguage: "auto" },
    want: "translation ZIP",
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
    options: { question: "In one sentence, what is this document for?" },
    want: "answer ZIP",
    // Pins the OPENING turn as context-free. Without this the follow-up below could
    // pass while every request silently carried the same context, and neither spec
    // would notice.
    verify: async (bytes) => {
      const { manifest } = await readChatAnswer(bytes);
      const turns = manifest.contextTurns ?? -1;
      return turns === 0
        ? {
            ok: true,
            detail: `contextTurns=0 (opening turn), ${usageNote(manifest)}`,
          }
        : {
            ok: false,
            detail: `opening turn reported contextTurns=${turns}, wanted 0`,
          };
    },
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
      build: async (bytes) => {
        const { manifest, answer } = await readChatAnswer(bytes);
        const asked =
          manifest.question ?? "In one sentence, what is this document for?";
        return {
          question: "Which document were you just asked about?",
          context: [
            { role: "user", content: asked.slice(0, PROOF_TURN_CHARS) },
            { role: "assistant", content: answer.slice(0, PROOF_TURN_CHARS) },
          ],
        };
      },
    },
    want: "answer ZIP",
    verify: async (bytes) => {
      const { manifest } = await readChatAnswer(bytes);
      const turns = manifest.contextTurns ?? -1;
      return turns === 2
        ? {
            ok: true,
            detail: `contextTurns=2 (conversation held), ${usageNote(manifest)}`,
          }
        : {
            ok: false,
            detail: `follow-up reported contextTurns=${turns}, wanted 2 — prior turns did not reach the worker`,
          };
    },
  },
];
