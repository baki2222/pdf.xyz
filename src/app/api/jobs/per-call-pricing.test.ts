// @vitest-environment node
/**
 * How many Summarize, Chat and Extract runs a connection gets in a day — asked
 * of the real `POST /api/jobs`, with the running worker's heartbeat read off
 * the wire the route actually reads it from.
 *
 * Until 2026-09-27 the answer was three, for every document: a one-page summary
 * cost a third of a day advertised as 30,774 characters, and chat — one job per
 * question — allowed three questions. The route now charges a per-call run the
 * characters it declared, but ONLY while the running worker proves on a fresh
 * heartbeat (`aiReadCap`) that it reads no more than that. The worker image is
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
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { AI_RUN_PRICING } from "@/lib/jobs/delivery-cap";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import { TRANSLATE_EXTRACTOR_HEADROOM } from "@/lib/jobs/translate-limits";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import {
  buildHeartbeat,
  emptyCapabilities,
  heartbeatKey,
  serializeHeartbeat,
  WORKER_HEARTBEAT_ENV,
} from "@/lib/workers/heartbeat";
import { REDIS_QUEUE_ENV } from "@/lib/workers/queue/redis-config";
import { PER_CALL_PROCESSORS } from "@/lib/workers/processor/read-cap-proof";
import { POST } from "./route";

const REDIS_URL = "https://heartbeat.example.test";
const HEARTBEAT_ENV: Record<string, string> = {
  [REDIS_QUEUE_ENV.provider]: "redis",
  [REDIS_QUEUE_ENV.restUrl]: REDIS_URL,
  [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
  [WORKER_HEARTBEAT_ENV.enabled]: "enabled",
};
const DECLARED = 2_000;

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

/** Submit the same one-page job until the route refuses it for the allowance. */
async function acceptedInADay(tool: string): Promise<number> {
  let accepted = 0;
  for (let i = 0; i < 40; i += 1) {
    const response = await POST(
      new Request("http://localhost/api/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.9",
        },
        body: JSON.stringify({
          tool,
          inputs: ["f_pricing000000001"],
          options: PER_CALL_PROCESSORS[tool]!.options,
          declaredCharacters: DECLARED,
        }),
      }),
    );
    if (response.status === 429) return accepted;
    accepted += 1;
  }
  return accepted;
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
        Math.floor(
          AI_CHARACTER_ALLOWANCE / (DECLARED * TRANSLATE_EXTRACTOR_HEADROOM),
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
