// @vitest-environment node
/**
 * A job whose options the contract refuses costs none of the free daily AI
 * allowance — through the REAL route, against a real limiter, with a deployment
 * wired so that a job that got past the check would really be created.
 *
 * THE DEFECT (2026-09-28): `POST /api/jobs` reserved the allowance and queued
 * the job; only the worker parsed the options. Two schema fields named "Total"
 * and "total" — which the panel allowed — uploaded the file, reserved 41,032 of
 * the 123,096 bucket, failed on the worker, and showed "`schema[1].name`
 * duplicates an earlier field name." A worker-side failure never refunds.
 *
 * WHY THE DEPLOYMENT IS WIRED: with no worker configured the adapter's
 * `createJob` fails and the route REFUNDS the reservation
 * (`allowance-refund.chain.test.ts`). A refused-options test run there passes
 * whether or not the check comes first, because the refund hides the charge.
 * Only a job that would really be created can show the order.
 *
 * WHAT IS ASSERTED IS THE DEBIT, not only the status: a 400 that arrived after
 * the charge is the defect wearing the right status code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV, capabilityForMode } from "@/lib/jobs";
import { tools } from "@/lib/tools";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import {
  enforceAiCharacterAllowance,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import { parseAiToolOptions } from "@/lib/jobs/ai-tool-options";
import {
  AI_TOOL_OPTION_COUNTEREXAMPLES,
  AI_TOOL_OPTION_EXAMPLES,
} from "@/lib/jobs/ai-tool-options.examples";
import { S3_ENV } from "@/lib/workers/storage/s3-config";
import { REDIS_QUEUE_ENV } from "@/lib/workers/queue/redis-config";
import {
  createFakeRedis,
  type FakeRedis,
} from "@/lib/workers/queue/redis-fake";
import { redisRestFetch } from "@/lib/workers/queue/redis-rest-fake";
import { POST } from "./route";

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

const AI_TOOLS = tools
  .filter((tool) => capabilityForMode(tool.processing) === "ai")
  .map((tool) => tool.slug);

let queue: FakeRedis;

beforeEach(() => {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  resetRateLimitGuardForTests();
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  Object.assign(process.env, WIRED_ENV);
  queue = createFakeRedis();
  vi.stubGlobal("fetch", redisRestFetch(queue, QUEUE_URL));
});

afterEach(() => {
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  for (const name of Object.keys(WIRED_ENV)) delete process.env[name];
  vi.unstubAllGlobals();
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const job = (tool: string, options: Record<string, unknown>) => ({
  tool,
  inputs: ["f_1234567890"],
  options,
});

/** True when the WHOLE day can still be reserved in one go. */
async function dayUntouched(): Promise<boolean> {
  const whole = await enforceAiCharacterAllowance(
    AI_CHARACTER_ALLOWANCE,
    post({}),
  );
  expect(whole.enforced, "health: the limiter must be counting").toBe(true);
  return whole.allowed;
}

describe("POST /api/jobs checks AI options before it charges", () => {
  it("health: the corpus is every catalog AI tool", () => {
    expect(AI_TOOLS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(AI_TOOLS.map((slug) => [slug] as const))(
    "%s: refused options are a 400 that spent nothing and queued nothing",
    async (slug) => {
      const bag =
        AI_TOOL_OPTION_COUNTEREXAMPLES[
          slug as keyof typeof AI_TOOL_OPTION_COUNTEREXAMPLES
        ];
      const res = await POST(post(job(slug, bag)));
      const body = (await res.json()) as { error: { message: string } };
      expect(res.status).toBe(400);
      // The words the worker would have used — the one parser, read twice.
      const verdict = parseAiToolOptions(slug, bag)!;
      expect(verdict.ok).toBe(false);
      if (!verdict.ok)
        expect(body.error.message).toBe(verdict.error.body.error.message);
      expect(queue.keys(), `${slug}: a refused job was queued`).toEqual([]);
      expect(
        await dayUntouched(),
        `${slug}: a job the contract refused still reserved part of the day`,
      ).toBe(true);
    },
  );

  it.each(AI_TOOLS.map((slug) => [slug] as const))(
    "POSITIVE CONTROL %s: admitted options are created and DO spend",
    async (slug) => {
      // Without this, "nothing was spent" could mean nothing is ever spent here.
      const bag =
        AI_TOOL_OPTION_EXAMPLES[slug as keyof typeof AI_TOOL_OPTION_EXAMPLES];
      const res = await POST(post(job(slug, bag)));
      expect(res.status).toBe(202);
      expect(queue.keys().length).toBeGreaterThan(0);
      expect(await dayUntouched()).toBe(false);
    },
  );
});
