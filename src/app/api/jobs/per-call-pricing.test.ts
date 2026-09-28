// @vitest-environment node
/**
 * How many Summarize, Chat and Extract runs a connection gets in a day — asked
 * of the real `POST /api/jobs`, with the running worker's heartbeat read off
 * the wire the route actually reads it from.
 *
 * Until 2026-09-27 the answer was three, for every document: a one-page summary
 * cost a third of a day advertised as 30,774 characters, and chat — one job per
 * question — allowed three questions. The route now charges a per-call run the
 * document characters it declared, plus the options the server measures and
 * the engine's instructions, but ONLY while the running worker proves on a
 * fresh heartbeat (`aiReadCap`) that it sends no more than that. The worker image is
 * deployed by hand, after the web tier; until it runs, the discount must not
 * exist, because a declaration nothing enforces is a full read sold at a
 * one-character price.
 *
 * Both halves are driven here through the route itself: a fresh heartbeat
 * that proves the cap, and the three ways a heartbeat does not (absent, an old
 * image that never published the key, stale).
 *
 * The heartbeat is served by stubbing the global `fetch` the Redis REST client
 * calls — not by mocking a module, which `vitest.config.ts`'s `isolate: false`
 * would leak into every later file in the thread (see
 * `workers/delivery-cap.chain.test.ts`). The stub is removed after each test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV, parseCreateJobRequest } from "@/lib/jobs";
import {
  AI_PER_CALL_INSTRUCTION_CHARACTERS,
  AI_RUN_PRICING,
  aiReservationFor,
  optionCharacters,
} from "@/lib/jobs/delivery-cap";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import {
  MAX_CONTEXT_TURNS,
  MAX_QUESTION_CHARS,
  MAX_TURN_CHARS,
} from "@/lib/jobs/chat-with-pdf";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import {
  enforceAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import {
  buildHeartbeat,
  emptyCapabilities,
  heartbeatKey,
  serializeHeartbeat,
  WORKER_HEARTBEAT_ENV,
} from "@/lib/workers/heartbeat";
import { REDIS_QUEUE_ENV } from "@/lib/workers/queue/redis-config";
import {
  PER_CALL_PROCESSORS,
  providerCharactersSent,
} from "@/lib/workers/processor/read-cap-proof";
import { POST } from "./route";

const REDIS_URL = "https://heartbeat.example.test";
const HEARTBEAT_ENV: Record<string, string> = {
  [REDIS_QUEUE_ENV.provider]: "redis",
  [REDIS_QUEUE_ENV.restUrl]: REDIS_URL,
  [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
  [WORKER_HEARTBEAT_ENV.enabled]: "enabled",
};
const DECLARED = 2_000;
const CLIENT_IP = "203.0.113.9";
/** One whole run: what an undeclared run has always cost. */
const WHOLE_RUN = Math.ceil(
  TRANSLATE_MAX_INPUT_CHARS * TRANSLATE_EXTRACTOR_HEADROOM,
);

function perCallTools(): string[] {
  return Object.entries(AI_RUN_PRICING)
    .filter(([, pricing]) => pricing === "per-call")
    .map(([slug]) => slug);
}

/** Serve `record` (or nothing) as the heartbeat key; answer anything else empty. */
function serveHeartbeat(record: string | null): { reads: () => number } {
  let reads = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (!String(url).startsWith(REDIS_URL)) {
      throw new Error(`unexpected request: ${String(url)}`);
    }
    const command = JSON.parse(String(init?.body)) as string[];
    const isHeartbeat =
      command[0] === "GET" && command[1] === heartbeatKey("pdfxyz");
    if (isHeartbeat) reads += 1;
    return new Response(
      JSON.stringify({ result: isHeartbeat ? record : null }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return { reads: () => reads };
}

function heartbeatRecord(aiReadCap: boolean | undefined, at: number): string {
  const record = JSON.parse(
    serializeHeartbeat(
      buildHeartbeat({
        mode: "loop",
        capabilities: { ...emptyCapabilities(), aiReadCap: aiReadCap === true },
        at,
      }),
    ),
  ) as { capabilities: Record<string, unknown> };
  // An image built before the key existed publishes no such field at all.
  if (aiReadCap === undefined) delete record.capabilities.aiReadCap;
  return JSON.stringify(record);
}

function jobBody(
  tool: string,
  options: Record<string, unknown>,
  declaredCharacters: number,
): Record<string, unknown> {
  return {
    tool,
    inputs: ["f_pricing000000001"],
    options,
    declaredCharacters,
  };
}

function submit(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": CLIENT_IP,
      },
      body: JSON.stringify(body),
    }),
  );
}

/** Submit the same one-page job until the route refuses it for the allowance. */
async function acceptedInADay(tool: string): Promise<number> {
  let accepted = 0;
  for (let i = 0; i < 40; i += 1) {
    const response = await submit(
      jobBody(tool, PER_CALL_PROCESSORS[tool]!.options, DECLARED),
    );
    if (response.status === 429) return accepted;
    accepted += 1;
  }
  return accepted;
}

/**
 * Would `claim` more characters still fit in this client's day?
 *
 * Asked of the REAL limiter the route spends from, for the same client. A
 * refusal spends nothing (`spendIfItFits`), so asking "is there room for
 * everything the run did not pay for?" does not change the answer to the next
 * question.
 */
async function roomFor(claim: number): Promise<boolean> {
  const decision = await enforceAiCharacterAllowance(
    claim,
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: { "x-forwarded-for": CLIENT_IP },
    }),
  );
  return decision.allowed;
}

beforeEach(() => {
  resetRateLimitGuardForTests();
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
});
afterEach(() => {
  // `isolate: false`: the limiter singleton, process.env and globals are all
  // shared with every later file in this thread.
  vi.unstubAllGlobals();
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  for (const name of Object.keys(HEARTBEAT_ENV)) delete process.env[name];
});

function enableHeartbeat(): void {
  Object.assign(process.env, HEARTBEAT_ENV);
}

describe("POST /api/jobs prices a per-call run by the running worker's proof", () => {
  it("has per-call tools to ask about", () => {
    expect(perCallTools().length).toBeGreaterThanOrEqual(3);
  });

  it.each(perCallTools())(
    "%s: a fresh heartbeat proving the read cap gives a one-page run its own size",
    async (tool) => {
      enableHeartbeat();
      const served = serveHeartbeat(heartbeatRecord(true, Date.now()));
      const accepted = await acceptedInADay(tool);
      expect(
        served.reads(),
        "the route never read the heartbeat, so this measured nothing about it",
      ).toBeGreaterThan(0);
      expect(accepted, "a one-page run still costs a third of the day").toBe(
        // The document at its declared size, plus what the server measures:
        // the options and the engine's own instructions. Until the review of
        // 2026-09-27 this was the document alone, and the options went free.
        Math.floor(
          AI_CHARACTER_ALLOWANCE /
            (DECLARED * TRANSLATE_EXTRACTOR_HEADROOM +
              optionCharacters(PER_CALL_PROCESSORS[tool]!.options) +
              AI_PER_CALL_INSTRUCTION_CHARACTERS),
        ),
      );
      expect(accepted).toBeGreaterThan(3);
    },
  );

  it.each(perCallTools())(
    "%s: no heartbeat at all charges every run a third of the day",
    async (tool) => {
      // The seam disabled: exactly the pre-fix price, which is the safe one.
      expect(await acceptedInADay(tool)).toBe(3);
    },
  );

  it.each(perCallTools())(
    "%s: an image that never published aiReadCap gets no discount",
    async (tool) => {
      enableHeartbeat();
      const served = serveHeartbeat(heartbeatRecord(undefined, Date.now()));
      expect(await acceptedInADay(tool)).toBe(3);
      expect(served.reads()).toBeGreaterThan(0);
    },
  );

  it.each(perCallTools())(
    "%s: a STALE heartbeat is not a witness, whatever it says",
    async (tool) => {
      enableHeartbeat();
      serveHeartbeat(heartbeatRecord(true, Date.now() - 24 * 3_600_000));
      expect(await acceptedInADay(tool)).toBe(3);
    },
  );
});

describe("POST /api/jobs charges a per-call run every character it sends", () => {
  /**
   * Found in review, 2026-09-27. The read cap bounds the DOCUMENT, and the
   * route charged a per-call run by the declared document alone. The chat
   * question and carried turns, the extract prompt or schema, and the summarize
   * focus reach the model verbatim, and nothing bounded them by the charge: a
   * direct caller declaring ONE character paid 4 and sent a full 8 KB of
   * conversation, up to the 60 jobs an hour `jobs.create` allows. The honest
   * chat client added the question and turns to its own declaration, and the
   * route trusted the sum; the server never measured them.
   *
   * Asked here of the real route and the real limiter: after one run, is there
   * room left in the day for everything that run sent and did not pay for?
   * "Sent" is read off the provider request the real processor builds under the
   * read bound the route's own pricing hands the worker, counting every
   * character, not only the document's.
   */
  it("CONTROL: the options the review sized at 50,000 characters are refused before anything is charged", async () => {
    // The contract allows 2,000 + 12 x 4,000 characters, but the route refuses
    // any options over its byte cap first, so the most a run can carry is
    // about 8 KB. The heavy bodies below are built to that cap.
    enableHeartbeat();
    serveHeartbeat(heartbeatRecord(true, Date.now()));
    const body = jobBody(
      "chat-with-pdf",
      {
        question: "x".repeat(MAX_QUESTION_CHARS),
        context: Array.from({ length: MAX_CONTEXT_TURNS }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: "x".repeat(MAX_TURN_CHARS),
        })),
      },
      1,
    );
    expect(parseCreateJobRequest(body).ok).toBe(false);
    expect((await submit(body)).status).toBe(413);
    expect(
      await roomFor(AI_CHARACTER_ALLOWANCE),
      "a refused body was charged",
    ).toBe(true);
  });

  for (const tool of perCallTools()) {
    const heavy = PER_CALL_PROCESSORS[tool]?.heavyOptions ?? [];

    it(`${tool}: has heavy bodies the route accepts`, () => {
      expect(
        heavy.length,
        "no heavy body for this tool, so nothing below asks about its options",
      ).toBeGreaterThan(0);
      for (const options of heavy) {
        expect(parseCreateJobRequest(jobBody(tool, options, 1)).ok).toBe(true);
      }
    });

    it.each(heavy.map((options, index) => [index, options] as const))(
      `${tool}: declaring one character with heavy body %i pays for all of it`,
      async (_index, options) => {
        enableHeartbeat();
        const served = serveHeartbeat(heartbeatRecord(true, Date.now()));

        const response = await submit(jobBody(tool, options, 1));
        expect(
          response.status,
          "the route refused the job, so it charged nothing to measure",
        ).toBe(503);
        expect(served.reads()).toBeGreaterThan(0);

        // What that job sends: the real processor, under the read bound the
        // route's own pricing hands the worker for this body.
        const { delivery } = await aiReservationFor(
          tool,
          { declaredCharacters: 1, options },
          {
            fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
            headroom: TRANSLATE_EXTRACTOR_HEADROOM,
            readCapEnforced: async () => true,
          },
        );
        expect(delivery, "the job was not read-capped at all").toBeDefined();
        const sent = await providerCharactersSent(tool, delivery, options);
        expect(sent, "the run did not complete").not.toBeNull();
        // It really is a small-document run: the document is capped.
        expect(sent!.document).toBeLessThanOrEqual(delivery!.characters);

        expect(
          await roomFor(AI_CHARACTER_ALLOWANCE - sent!.total + 1),
          `the run sent ${sent!.total} characters to the provider and the ` +
            "day still has room for everything it did not pay for",
        ).toBe(false);
        // CONTROL: and it is never charged more than one whole run.
        expect(await roomFor(AI_CHARACTER_ALLOWANCE - WHOLE_RUN)).toBe(true);
      },
    );
  }
});
