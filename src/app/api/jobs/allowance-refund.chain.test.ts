// @vitest-environment node
/**
 * A job that was never created must not cost any of the free daily AI
 * allowance.
 *
 * THE DEFECT (audit at 67e8d0f): `POST /api/jobs` reserved the caller's
 * characters and then asked the adapter to create the job. When
 * `adapter.createJob` failed — a queue outage, storage not ready, a broker
 * error — the route returned the error and kept the reservation. Nothing
 * anywhere gave it back: a search for refund/release/settle across the limiter
 * and the worker found nothing. An undeclared job reserves a third of the day,
 * so three failed creations locked the connection out of AI until tomorrow,
 * with no job, no result, and a 429 that said they had used their allowance.
 *
 * WHY NOTHING CAUGHT IT: every allowance test drove the GUARD, and the guard is
 * correct — it charges what it is asked to charge. The defect lived one hop
 * later, in the route's ORDER: the charge sat above a fork whose failure branch
 * never looked back. Rule 3 of the house style, "failure paths get the minimal
 * type", in a route handler.
 *
 * SO THIS DRIVES THE REAL ROUTE, not the guard, and fails the job the honest
 * way rather than with a mock: with no worker environment the real adapter's
 * `createJob` returns `503 worker_not_configured`. No `vi.mock` — the suite
 * runs `isolate: false`, and a mocked `@/lib/workers` once leaked a fake
 * adapter into three unrelated files (see `delivery-cap.chain.test.ts`).
 *
 * THE CORPUS IS DERIVED: every catalog tool whose processing mode is the AI
 * capability and whose minimal request parses. A new AI tool is in it the day
 * it ships, and a floor stops the set from quietly shrinking to nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REQUIRED_WORKER_ENV,
  capabilityForMode,
  deliveryCapFor,
  parseCreateJobRequest,
} from "@/lib/jobs";
import { tools } from "@/lib/tools";
import { RATE_LIMIT_ENV, policyFor } from "@/lib/ratelimit";
import {
  enforceAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import { S3_ENV } from "@/lib/workers/storage/s3-config";
import { REDIS_QUEUE_ENV } from "@/lib/workers/queue/redis-config";
import { createFakeRedis } from "@/lib/workers/queue/redis-fake";
import { redisRestFetch } from "@/lib/workers/queue/redis-rest-fake";
import { POST } from "./route";
import { aiToolOptionExample } from "@/lib/jobs/ai-tool-options.examples";

function post(body: unknown): Request {
  return new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The minimal request for a tool, and whether the route would parse it. */
function minimalJob(slug: string) {
  // With options the route ADMITS: since 2026-09-28 an AI job's options are
  // parsed before the allowance, so an option-less job is a 400 that never
  // reaches the charge this file is about.
  const options = aiToolOptionExample(slug);
  return {
    tool: slug,
    inputs: ["f_1234567890"],
    ...(options ? { options } : {}),
  };
}

const AI_TOOLS = tools
  .filter((tool) => capabilityForMode(tool.processing) === "ai")
  .filter((tool) => parseCreateJobRequest(minimalJob(tool.slug)).ok)
  .map((tool) => tool.slug);

/** What the route reserves for an undeclared job — derived, never typed. */
function undeclaredReservation(slug: string): number {
  const parsed = parseCreateJobRequest(minimalJob(slug));
  if (!parsed.ok) throw new Error(`${slug} stopped parsing`);
  return deliveryCapFor(parsed.value, {
    fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
    headroom: TRANSLATE_EXTRACTOR_HEADROOM,
  }).characters;
}

beforeEach(() => {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  resetRateLimitGuardForTests();
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
});

/** A wired S3 + Redis environment, so the REAL adapter creates the job. */
const QUEUE_URL = "https://queue-example-12345.upstash.io";
const WIRED_ENV: Record<string, string> = {
  [S3_ENV.provider]: "s3",
  [S3_ENV.endpoint]: "https://s3.us-east-1.amazonaws.com",
  [S3_ENV.region]: "us-east-1",
  [S3_ENV.bucket]: "pdfxyz-test",
  [S3_ENV.accessKeyId]: "AKIAEXAMPLE0000000",
  [S3_ENV.secretAccessKey]: "s3cr3tEXAMPLEkeyValue00000000000000000000",
  [REDIS_QUEUE_ENV.provider]: "redis",
  [REDIS_QUEUE_ENV.restUrl]: QUEUE_URL,
  [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
};

afterEach(() => {
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  for (const name of Object.keys(WIRED_ENV)) delete process.env[name];
  vi.unstubAllGlobals();
});

describe("the corpus of AI tools", () => {
  it("is derived from the catalog and is not implausibly small", () => {
    // Four AI tools ship today (chat, summarize, translate, extract). A set of
    // zero would make every assertion below vacuously green.
    expect(AI_TOOLS.length).toBeGreaterThanOrEqual(4);
  });

  it("each tool's undeclared job reserves a real share of the day", () => {
    for (const slug of AI_TOOLS) {
      const reservation = undeclaredReservation(slug);
      expect(reservation).toBeGreaterThan(0);
      // The defect needs a reservation large enough that a handful of failed
      // creations exhaust the day; if this stops holding, the test below
      // would pass without exercising the lock-out it guards against.
      expect(Math.floor(AI_CHARACTER_ALLOWANCE / reservation)).toBeLessThan(
        policyFor("jobs.create").limit / AI_TOOLS.length - 1,
      );
    }
  });
});

describe("POST /api/jobs — a failed creation gives the reservation back", () => {
  it("never answers 429 for the allowance after creations that all failed", async () => {
    for (const slug of AI_TOOLS) {
      // More failed creations than the day holds jobs of this size: under the
      // defect the (jobsPerDay + 1)th is refused as "allowance used".
      const jobsPerDay = Math.floor(
        AI_CHARACTER_ALLOWANCE / undeclaredReservation(slug),
      );
      for (let attempt = 1; attempt <= jobsPerDay + 2; attempt += 1) {
        const res = await POST(post(minimalJob(slug)));
        const body = (await res.json()) as { error?: { code?: string } };
        // Health check on the chain itself: every one of these is a FAILED
        // creation. If the adapter ever started succeeding here, the test
        // would be about something else.
        expect(
          res.status,
          `${slug}, failed creation ${attempt} of ${jobsPerDay + 2}: expected ` +
            `the adapter's honest 503, got ${res.status} ${body.error?.code}. ` +
            "A 429 here means a job that was never created spent the allowance.",
        ).toBe(503);
        expect(body.error?.code).toBe("worker_not_configured");
      }
    }
  });

  it("leaves the whole day's allowance spendable afterwards", async () => {
    const slug = AI_TOOLS[0]!;
    for (let i = 0; i < 5; i += 1) await POST(post(minimalJob(slug)));
    // The same connection (no forwarded address ⇒ the same bucket token) can
    // still reserve the ENTIRE day in one go — nothing was kept back.
    const whole = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE,
      post(minimalJob(slug)),
    );
    expect(whole.enforced).toBe(true);
    expect(whole.allowed).toBe(true);
  });

  it("positive control: a genuinely spent allowance is still refused with 429", async () => {
    // Without this, "no 429" could mean the harness can never produce one —
    // a limiter that is off, a bucket the route does not share.
    const slug = AI_TOOLS[0]!;
    const spent = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE,
      post(minimalJob(slug)),
    );
    expect(spent.allowed).toBe(true);
    const refused = await POST(post(minimalJob(slug)));
    expect(refused.status).toBe(429);
  });
});

describe("POST /api/jobs — a created job keeps its charge", () => {
  /**
   * The other branch of the same fork. Without this, a route that released on
   * EVERY outcome would pass everything above — and hand out unlimited AI.
   * The job is created for real: the Redis queue provider over the REST client
   * against the in-memory Redis, reached through the global `fetch`.
   */
  it("debits exactly the reservation — pinned from both sides", async () => {
    Object.assign(process.env, WIRED_ENV);
    const fake = createFakeRedis();
    vi.stubGlobal("fetch", redisRestFetch(fake, QUEUE_URL));

    const slug = AI_TOOLS[0]!;
    const created = await POST(post(minimalJob(slug)));
    expect(
      created.status,
      "health: the job must really be created for this to test anything",
    ).toBe(202);
    expect(
      fake.keys().length,
      "health: the queue must hold the job",
    ).toBeGreaterThan(0);

    const reservation = undeclaredReservation(slug);
    const rest = await enforceAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE - reservation,
      post(minimalJob(slug)),
    );
    expect(rest.allowed, "the created job cost MORE than its reservation").toBe(
      true,
    );
    const oneMore = await enforceAiCharacterAllowance(
      1,
      post(minimalJob(slug)),
    );
    expect(
      oneMore.allowed,
      "the created job cost LESS than its reservation — a refund ran on success",
    ).toBe(false);
  });
});
