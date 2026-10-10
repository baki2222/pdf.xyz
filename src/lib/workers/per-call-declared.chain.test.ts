// @vitest-environment node
// @native-canvas
/**
 * Summarize, Chat and Extract put a character count on the wire, and the route
 * prices the job by it — the seam from the client's call to the route's charge.
 *
 * Until 2026-09-27 none of the three sent one, so every run was priced at the
 * undeclared fallback: a third of the day. The fallback is correct and SILENT —
 * if a declaration stops reaching the route, every run quietly costs a third of
 * the day again and nothing fails. So this drives each REAL client with a fake
 * transport, reads the body it actually POSTs, runs it through the REAL
 * `parseCreateJobRequest` and prices it with the REAL `aiReservationFor`.
 *
 * The set of clients is held equal to the tools priced per call, so a per-call
 * tool without a declaring client fails here rather than shipping at the
 * fallback price.
 *
 * WHAT A CLIENT DECLARES IS ITS DOCUMENT, AND ONLY ITS DOCUMENT. Until the
 * review of 2026-09-27 the chat client added its question and carried turns to
 * the count, and this file pinned that sum. The server trusted it, so a direct
 * caller could leave them out, declare 1, and send 8 KB of conversation for 4
 * characters. The route now measures the options itself (`optionCharacters`)
 * and charges them on top, so a client that still folded them in would pay for
 * them twice. The pin is inverted: chat declares exactly the counted document.
 */
import { describe, expect, it } from "vitest";
import { parseCreateJobRequest } from "@/lib/jobs";
import {
  AI_PER_CALL_INSTRUCTION_CHARACTERS,
  AI_RUN_PRICING,
  aiReservationFor,
  optionCharacters,
} from "@/lib/jobs/delivery-cap";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import type { ChatTurn } from "@/lib/jobs/chat-with-pdf";
import { runWorkerSummarize } from "./summarize-client";
import { runWorkerChatWithPdf } from "./chat-with-pdf-client";
import { runWorkerAiExtract } from "./ai-extract-client";
import type { PdfSecurityWorkerOptions } from "./pdf-security-client";

const FILE_ID = "f_abc123def456";
const BYTES = new Uint8Array([1, 2, 3, 4]);
const COUNTED = 1_837;
const QUESTION = "What is the total?";
const CONTEXT: ChatTurn[] = [
  { role: "user", content: "Who signed it?" },
  { role: "assistant", content: "Jane Doe [p.2]." },
];

/** Answers the calls `runSecurityJob` makes and records the job body. */
function captureTransport() {
  const jobBodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target === "/api/uploads") {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          slots: [{ fileId: FILE_ID, url: "/upload/slot-1", method: "PUT" }],
        }),
      };
    }
    if (target === "/upload/slot-1") {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (target === "/api/jobs") {
      const raw = init?.body;
      const text =
        typeof raw === "string"
          ? raw
          : new TextDecoder().decode(raw as ArrayBuffer);
      jobBodies.push(JSON.parse(text) as Record<string, unknown>);
      // Refuse, so the client stops here: the body is all this test reads.
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: "invalid_request", message: "stop here" },
        }),
      };
    }
    throw new Error(`unexpected request: ${target}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, jobBodies };
}

type Run = (
  counted: number | null,
  options: PdfSecurityWorkerOptions,
) => Promise<unknown>;

/** Each per-call client, called the way its panel calls it. */
const CLIENTS: Record<string, { run: Run }> = {
  "summarize-pdf": {
    run: (counted, options) =>
      runWorkerSummarize(
        {
          filename: "report.pdf",
          bytes: BYTES,
          length: "brief",
          format: "paragraphs",
          declaredCharacters: counted,
        },
        options,
      ),
  },
  "ai-extract": {
    run: (counted, options) =>
      runWorkerAiExtract(
        {
          filename: "report.pdf",
          bytes: BYTES,
          mode: "prompt",
          prompt: "List every total.",
          declaredCharacters: counted,
        },
        options,
      ),
  },
  "chat-with-pdf": {
    run: (counted, options) =>
      runWorkerChatWithPdf(
        {
          filename: "report.pdf",
          bytes: BYTES,
          question: QUESTION,
          context: CONTEXT,
          documentCharacters: counted,
        },
        options,
      ),
    // INVERTED 2026-09-27. This used to declare the document PLUS the question
    // and every carried turn ("all of it is read, so all of it is declared"),
    // and the route trusted that sum, so a caller who left them out sent them
    // free. The server measures them now; the client declares the document.
  },
};

function perCallTools(): string[] {
  return Object.entries(AI_RUN_PRICING)
    .filter(([, pricing]) => pricing === "per-call")
    .map(([slug]) => slug);
}

describe("every per-call tool has a declaring client here", () => {
  it("is the per-call set, derived from the pricing", () => {
    expect(perCallTools().length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(CLIENTS).sort()).toEqual(perCallTools().sort());
  });
});

describe.each(Object.keys(CLIENTS))("%s", (tool) => {
  const client = CLIENTS[tool]!;

  it("puts the count on the wire, the route parses it, and prices the run by it", async () => {
    const { fetchImpl, jobBodies } = captureTransport();
    await client.run(COUNTED, {
      fetchImpl,
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });
    expect(
      jobBodies.length,
      "the client never reached POST /api/jobs — the chain broke before the seam",
    ).toBe(1);
    const body = jobBodies[0]!;
    expect(body.tool).toBe(tool);
    expect(
      body.declaredCharacters,
      "the client did not put its count on the wire (every run silently " +
        "costs a third of the day), or declared more than its document (and " +
        "pays for its options twice)",
    ).toBe(COUNTED);
    expect(
      "declaredTextPages" in body,
      "a page count was declared that no per-call engine enforces",
    ).toBe(false);

    const parsed = parseCreateJobRequest(body);
    expect(parsed.ok, "the body the client sends does not parse").toBe(true);
    if (!parsed.ok) return;
    const priced = await aiReservationFor(tool, parsed.value, {
      fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
      headroom: TRANSLATE_EXTRACTOR_HEADROOM,
      readCapEnforced: async () => true,
    });
    // The document at its declared size, plus what the SERVER measured of the
    // body it received, plus the engine's instructions. The options term is
    // read off the parsed body, not the client's input, so it is what the
    // route saw on the wire.
    expect(
      optionCharacters(parsed.value.options),
      "the body carried no options, so this asks nothing about them",
    ).toBeGreaterThan(0);
    expect(priced.charge).toBe(
      Math.ceil(COUNTED * TRANSLATE_EXTRACTOR_HEADROOM) +
        optionCharacters(parsed.value.options) +
        AI_PER_CALL_INSTRUCTION_CHARACTERS,
    );
  });

  it("CONTROL: a panel that could not count sends no declaration, not a zero", async () => {
    // `null` is "could not count" (a scan, a file pdfjs cannot open). The
    // contract refuses 0, so a zero here would turn an unreadable-in-the-browser
    // PDF into a 400 instead of a job at the old price.
    const { fetchImpl, jobBodies } = captureTransport();
    await client.run(null, {
      fetchImpl,
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });
    expect(jobBodies.length).toBe(1);
    expect("declaredCharacters" in jobBodies[0]!).toBe(false);
    expect(parseCreateJobRequest(jobBodies[0]!).ok).toBe(true);
  });
});
