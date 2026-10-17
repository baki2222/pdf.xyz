// @vitest-environment node
// @native-canvas
/**
 * A conversation about a small PDF survives the daily allowance — driven from
 * the panel's own measurement, through the REAL client, onto the wire, into the
 * REAL `POST /api/jobs`, and against the REAL limiter. The seams, not the ends.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * `runWorkerChatWithPdf` passed no `declaredCharacters`, so every question fell
 * to the route's undeclared fallback and reserved a whole call's worth —
 * `TRANSLATE_MAX_INPUT_CHARS × headroom` = 41,032 of a 123,096 bucket. **Every
 * question about a one-page PDF cost a third of the day**, the fourth was
 * refused, and the refusal told the reader that the connection had used up
 * 30,774 characters of text "translated by someone else". A tool sold on
 * follow-ups held a three-message conversation per day.
 *
 * Nothing caught it because every piece was correct alone: the client reached
 * the route, the route charged what it was told, the limiter debited what it was
 * charged. Only the COMPOSED path — "ask four short questions about one page" —
 * shows the product refusing the fourth, so that is the test.
 *
 * ── WHY THE ROUTE IS DRIVEN HERE AND NOT AST-CHECKED ────────────────────────
 *
 * `delivery-cap.chain.test.ts` explains why the route may not be driven into a
 * MOCKED adapter (`isolate: false` shares the module registry). Nothing here is
 * mocked: the transport hands the client's real bytes to the real `POST`, and
 * the deployment is WIRED (`@/tests/wired-job-route`), so the real adapter
 * queues each job in an in-memory Redis. The limiter is the real local-memory
 * provider, reset on both sides of every test.
 *
 * INTEGRATED (wave1/l01-page-leak): this file used to leave the worker
 * unconfigured — the route answered 503 AFTER charging, "the same technique
 * `ratelimit/allowance-probe.test.ts` uses". Since that merge a job that is not
 * created costs nothing (the charge is released), so every question here would
 * have been free and the refusals below could never happen. A kept charge
 * needs a created job: each admitted question now answers 202.
 *
 * ── THE DISCOUNT NEEDS A WORKER THAT PROVES ITS READ CAP ────────────────────
 *
 * Added when this fix met the per-call pricing of Summarize, Chat and Extract
 * (2026-09-27): the route honours a chat question's declaration only while the
 * running worker proves on a fresh heartbeat (`aiReadCap`) that it reads no
 * more of the document than was declared (`aiReservationFor`). The worker image
 * is built by hand after the web tier deploys, so until it runs, every question
 * costs the fallback again. The declared cases below therefore serve such a
 * heartbeat, read by the route off the same wire it reads in production — the
 * wired deployment's Redis, behind a stubbed global `fetch`, never a module
 * mock — and a CONTROL runs the same conversation without one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { ChatTurn } from "@/lib/jobs/chat-with-pdf";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import {
  AI_PER_CALL_INSTRUCTION_CHARACTERS,
  optionCharacters,
} from "@/lib/jobs/delivery-cap";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import {
  enforceAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import { POST } from "@/app/api/jobs/route";
import {
  buildHeartbeat,
  emptyCapabilities,
  serializeHeartbeat,
} from "./heartbeat";
import {
  publishHeartbeat,
  unwireJobRoute,
  wireJobRoute,
  type WiredJobRoute,
} from "@/tests/wired-job-route";
import {
  measureChatDocument,
  runWorkerChatWithPdf,
  type ChatDocumentCount,
} from "./chat-with-pdf-client";

/** The wired deployment for the current test. */
let route: WiredJobRoute;

/**
 * A running worker whose fresh heartbeat proves the read cap, published where
 * the route reads it: the wired deployment's Redis, which the heartbeat reader
 * reaches through the global `fetch`. The client's own requests go through
 * the injected transport, so they never reach that stub. Returns how often
 * the heartbeat was read.
 */
async function workerProvesReadCap(): Promise<{ reads: () => number }> {
  const record = serializeHeartbeat(
    buildHeartbeat({
      mode: "loop",
      capabilities: { ...emptyCapabilities(), aiReadCap: true },
      at: Date.now(),
    }),
  );
  await publishHeartbeat(route, record);
  return { reads: () => route.heartbeatReads() };
}

const FILE_ID = "f_chat00000000001";
const BYTES = new Uint8Array([37, 80, 68, 70]);

/** A one-page document of about 2,000 characters, as pdfjs hands it over. */
const PAGE_TEXT = "The invoice total is 1,200 dollars, due on 1 March. ".repeat(
  40,
);
const ONE_PAGE: ExtractedPdfText = {
  pageCount: 1,
  pages: [{ pageNumber: 1, text: PAGE_TEXT, characterCount: PAGE_TEXT.length }],
  text: PAGE_TEXT,
  characterCount: PAGE_TEXT.length,
  hasText: true,
};

/** What one undeclared job reserves — the route's fallback, derived. */
const FALLBACK_RESERVATION = Math.ceil(
  TRANSLATE_MAX_INPUT_CHARS * TRANSLATE_EXTRACTOR_HEADROOM,
);

/** The real `POST /api/jobs` behind a transport that fakes only the upload. */
function routedTransport() {
  const jobStatuses: number[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target === "/api/uploads") {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          slots: [{ fileId: FILE_ID, url: "/upload/slot-1" }],
        }),
      };
    }
    if (target === "/upload/slot-1") {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (target === "/api/jobs") {
      const response = await POST(
        new Request("http://localhost/api/jobs", {
          method: "POST",
          headers: init?.headers,
          body: init?.body,
        }),
      );
      jobStatuses.push(response.status);
      return response;
    }
    throw new Error(`unexpected request: ${target}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, jobStatuses };
}

/** Four questions, each carrying the earlier exchanges — as the panel sends them. */
const QUESTIONS = [
  "What is the total amount due?",
  "And when is it due?",
  "Is there a late fee mentioned?",
  "Who issued the invoice?",
];
/**
 * Trimmed, because the contract trims every turn before anything counts it —
 * the first version of this fixture ended in a space, and the charge assertion
 * below failed by exactly one character for its own bug.
 */
const ANSWER = "The document states the total is 1,200 dollars [p.1]. "
  .repeat(3)
  .trim();

async function converse(
  declaration: ChatDocumentCount | null,
  transport = routedTransport(),
) {
  const documentCharacters = declaration?.characters ?? null;
  const context: ChatTurn[] = [];
  for (const question of QUESTIONS) {
    await runWorkerChatWithPdf(
      {
        filename: "invoice.pdf",
        bytes: BYTES,
        question,
        ...(context.length > 0 ? { context: [...context] } : {}),
        documentCharacters,
      },
      { fetchImpl: transport.fetchImpl, pollIntervalMs: 0, maxPollAttempts: 1 },
    );
    context.push(
      { role: "user", content: question },
      { role: "assistant", content: ANSWER },
    );
  }
  return transport.jobStatuses;
}

async function measured(): Promise<ChatDocumentCount> {
  const count = await measureChatDocument(BYTES, async () => ONE_PAGE);
  if (count.kind !== "counted") {
    throw new Error(`the one-page fixture measured as ${count.kind}`);
  }
  return count.count;
}

const bare = (): Request =>
  new Request("http://localhost/spend", { method: "POST" });

beforeEach(() => {
  resetRateLimitGuardForTests();
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  route = wireJobRoute();
});
afterEach(() => {
  // Both hooks, and the env vars deleted: `isolate: false` shares the limiter
  // singleton, globals and `process.env` with every other file in this worker.
  vi.unstubAllGlobals();
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  unwireJobRoute();
});

describe("a follow-up conversation about a one-page PDF", () => {
  it("measures the document the panel is about to upload", async () => {
    // The fixture must be what the property is about — a SMALL document —
    // or every assertion below is about a different case.
    const count = await measured();
    expect(count.characters).toBe(PAGE_TEXT.length);
    expect(count.characters).toBeGreaterThan(1_500);
    expect(count.characters).toBeLessThan(2_500);
    expect(count.textPages).toBe(1);
  });

  it("is allowed four questions in a row, once the worker proves its read cap", async () => {
    const worker = await workerProvesReadCap();
    const statuses = await converse(await measured());
    expect(
      worker.reads(),
      "the route never read the heartbeat, so this measured nothing about it",
    ).toBeGreaterThan(0);
    // Every job reached the route — a chain that broke before the seam would
    // otherwise report "nothing refused" for the wrong reason.
    expect(statuses, "the client never reached POST /api/jobs").toHaveLength(
      QUESTIONS.length,
    );
    expect(
      statuses.filter((status) => status === 429),
      "a question about a one-page PDF was refused by the daily allowance — " +
        "each question is being charged as if the document were a whole " +
        "call's worth of text",
    ).toEqual([]);
    // And it got PAST the allowance for the reason we think: each question
    // became a job, and its charge stands. (503 until the integration of
    // wave1/l01-page-leak: an unconfigured worker answering after the charge,
    // which a created-or-refunded route no longer keeps.)
    expect(new Set(statuses)).toEqual(new Set([202]));
  });

  it("CONTROL: the same conversation, undeclared, is refused on the fourth question", async () => {
    // The mirror, and the proof that the test above can fail: with nothing
    // declared every question reserves the fallback, and three of them are
    // the whole bucket. If this ever stops refusing, the property above is
    // being certified by a limiter that is not counting. The same proving
    // worker as above, so the declaration is the only difference.
    await workerProvesReadCap();
    const statuses = await converse(null);
    expect(statuses).toHaveLength(QUESTIONS.length);
    expect(statuses.slice(0, 3).every((status) => status !== 429)).toBe(true);
    expect(
      statuses[3],
      "an undeclared question no longer reserves the fallback",
    ).toBe(429);
  });

  it("CONTROL: the same declared conversation is refused on the fourth while no worker proves the read cap", async () => {
    // The gate. A declaration nothing enforces would be a full read sold at a
    // document's price, so until the running image proves the cap every
    // question costs the fallback — the price before counting existed.
    const statuses = await converse(await measured());
    expect(statuses).toHaveLength(QUESTIONS.length);
    expect(statuses.slice(0, 3).every((status) => status !== 429)).toBe(true);
    expect(
      statuses[3],
      "a declaration was honoured with no worker proving it reads no more",
    ).toBe(429);
  });
});

describe("what one question is charged", () => {
  it("an undeclared direct API chat job still reserves exactly the fallback", async () => {
    // A caller with bytes and no extracted text pays the maximum — the
    // behaviour every caller had before the declaration existed. Pinned from
    // both sides: the rest of the bucket fits, and one more character does not.
    const { fetchImpl, jobStatuses } = routedTransport();
    await runWorkerChatWithPdf(
      {
        filename: "invoice.pdf",
        bytes: BYTES,
        question: QUESTIONS[0]!,
        documentCharacters: null,
      },
      { fetchImpl, pollIntervalMs: 0, maxPollAttempts: 1 },
    );
    // Created, so the charge stands (a job that is not created is given back).
    expect(jobStatuses).toEqual([202]);
    expect(
      (
        await enforceAiCharacterAllowance(
          AI_CHARACTER_ALLOWANCE - FALLBACK_RESERVATION,
          bare(),
        )
      ).allowed,
      `an undeclared chat question reserved more than ${FALLBACK_RESERVATION}`,
    ).toBe(true);
    expect(
      (await enforceAiCharacterAllowance(1, bare())).allowed,
      `an undeclared chat question reserved less than ${FALLBACK_RESERVATION}`,
    ).toBe(false);
  });

  it("a declared question costs the document with headroom, plus everything else it sends", async () => {
    // The question and the carried turns are sent to the model too, so they
    // are AI text and are charged — with no extractor headroom: the headroom
    // exists because two PDF extractors disagree, and a request-body string
    // has nothing to disagree about. Charging them ×4 would make a long
    // conversation cost more than the fallback, which is the defect this file
    // exists to close, one notch over.
    //
    // CHANGED 2026-09-27, history kept: this said "plus the conversation
    // EXACTLY" — the question and turns counted character for character. The
    // per-call pricing of Summarize, Chat and Extract found that a run also
    // sends the engine's own instructions, and prices the options as the
    // server measured them off the body (`optionCharacters`, which can only
    // over-count a string the engine sends verbatim) plus
    // `AI_PER_CALL_INSTRUCTION_CHARACTERS`. Exactly-the-conversation left the
    // instructions free.
    await workerProvesReadCap();
    const count = await measured();
    const context: ChatTurn[] = [
      { role: "user", content: QUESTIONS[0]! },
      { role: "assistant", content: ANSWER },
    ];
    const question = QUESTIONS[1]!;
    const { fetchImpl, jobStatuses } = routedTransport();
    await runWorkerChatWithPdf(
      {
        filename: "invoice.pdf",
        bytes: BYTES,
        question,
        context,
        documentCharacters: count.characters,
      },
      { fetchImpl, pollIntervalMs: 0, maxPollAttempts: 1 },
    );
    // Created, so the charge stands (a job that is not created is given back).
    expect(jobStatuses).toEqual([202]);

    const conversation =
      question.length + context.reduce((n, t) => n + t.content.length, 0);
    // The options exactly as the client puts them on the wire.
    const sent = optionCharacters({ question, context });
    expect(sent).toBeGreaterThanOrEqual(conversation);
    const cost =
      Math.ceil(count.characters * TRANSLATE_EXTRACTOR_HEADROOM) +
      sent +
      AI_PER_CALL_INSTRUCTION_CHARACTERS;
    expect(cost).toBeLessThan(FALLBACK_RESERVATION);
    expect(
      (await enforceAiCharacterAllowance(AI_CHARACTER_ALLOWANCE - cost, bare()))
        .allowed,
      `the question cost more than ${cost}`,
    ).toBe(true);
    expect(
      (await enforceAiCharacterAllowance(1, bare())).allowed,
      `the question cost less than ${cost} — the conversation is not charged`,
    ).toBe(false);
  });

  it("a declared question never costs more than an undeclared one", async () => {
    // A long document declared honestly must not be refused on its first
    // question because it declared: the reservation is capped at the fallback,
    // and the worker reads no more than that. Asked of a worker that proves
    // its cap — without one every question costs the fallback anyway, and
    // this would ask nothing.
    await workerProvesReadCap();
    const huge: ChatDocumentCount = { characters: 400_000, textPages: 120 };
    const { fetchImpl, jobStatuses } = routedTransport();
    await runWorkerChatWithPdf(
      {
        filename: "report.pdf",
        bytes: BYTES,
        question: QUESTIONS[0]!,
        documentCharacters: huge.characters,
      },
      { fetchImpl, pollIntervalMs: 0, maxPollAttempts: 1 },
    );
    // Created, so the charge stands (a job that is not created is given back).
    expect(jobStatuses).toEqual([202]);
    expect(
      (
        await enforceAiCharacterAllowance(
          AI_CHARACTER_ALLOWANCE - FALLBACK_RESERVATION,
          bare(),
        )
      ).allowed,
      "declaring a long document reserved more than not declaring it",
    ).toBe(true);
    expect((await enforceAiCharacterAllowance(1, bare())).allowed).toBe(false);
  });
});

describe("the panel's measurement", () => {
  it("reports a PDF with no selectable text as such, so nothing is uploaded or charged", async () => {
    const blank: ExtractedPdfText = {
      pageCount: 2,
      pages: [
        { pageNumber: 1, text: "   ", characterCount: 3 },
        { pageNumber: 2, text: "", characterCount: 0 },
      ],
      text: "",
      characterCount: 0,
      hasText: false,
    };
    const result = await measureChatDocument(BYTES, async () => blank);
    // Never a zero: the contract refuses `declaredCharacters: 0` with a 400.
    expect(result.kind).toBe("no-text");
  });

  it("falls back to an undeclared job when the browser cannot read the PDF", async () => {
    // The worker has the real extractor and gives the real reason; the
    // browser's failure to parse is not the user's problem to be told about.
    const result = await measureChatDocument(BYTES, async () => {
      throw new Error("encrypted");
    });
    expect(result.kind).toBe("uncounted");
  });
});
