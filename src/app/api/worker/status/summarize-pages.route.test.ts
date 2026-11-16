// @vitest-environment node
/**
 * HEARTBEAT → the two routes that decide Summarize PDF's page choice, through
 * the REAL routes (competitor audit summarize-pdf#5):
 *
 *   - `GET /api/worker/status` → `summarizePages`, which the panel shows its
 *     "Part to summarize" control on;
 *   - `POST /api/jobs` for summarize-pdf carrying `pages`.
 *
 * The worker image ships separately from the web tier (CLAUDE.md rule 5),
 * and an image built before page selection parses options leniently: it
 * DROPS `pages` and summarizes the opening pages under an allowance sized for
 * the selection. So for every beat the two must agree: an OLD worker (no
 * `summarizePages` key — today's production image), a stale beat, a worker
 * saying false, or none at all is not offered the choice and the job route
 * refuses it with the typed message, BEFORE the spend-ceiling peek and the
 * allowance reservation; a NEW worker on a fresh beat is offered it and the
 * job is admitted and charged. A job WITHOUT `pages` is admitted on every
 * beat (positive control: the old behaviour is unchanged).
 *
 * The heartbeat is published into the in-memory Redis the routes read over
 * the real Upstash REST wire (`@/tests/wired-job-route`); the allowance and
 * the ceiling are the real local-memory limiter. No module mock: the suite
 * runs `isolate: false`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";
import { SUMMARIZE_PAGES_NOT_RUNNING_MESSAGE } from "@/lib/jobs/summarize-pages";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { policyFor } from "@/lib/ratelimit/policy";
import {
  enforceAiCharacterAllowance,
  recordAiSpend,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import {
  buildHeartbeat,
  emptyCapabilities,
  serializeHeartbeat,
  type HeartbeatCapabilities,
} from "@/lib/workers/heartbeat";
import {
  publishHeartbeat,
  unwireJobRoute,
  wireJobRoute,
  type WiredJobRoute,
} from "@/tests/wired-job-route";
import { POST as createJob } from "../../jobs/route";
import { GET } from "./route";

const CLIENT_IP = "203.0.113.53";
const HOUR = 3_600_000;
let route: WiredJobRoute;

function beat(
  caps: Partial<HeartbeatCapabilities>,
  at: number,
  drop?: keyof HeartbeatCapabilities,
): string {
  const record = JSON.parse(
    serializeHeartbeat(
      buildHeartbeat({
        mode: "loop",
        capabilities: { ...emptyCapabilities(), ...caps },
        at,
      }),
    ),
  ) as { capabilities: Record<string, unknown> };
  if (drop) delete record.capabilities[drop];
  return JSON.stringify(record);
}

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": CLIENT_IP,
    },
    body: JSON.stringify(body),
  });

async function offered(): Promise<unknown> {
  const response = await GET(new Request("http://localhost/api/worker/status"));
  expect(response.status).toBe(200);
  return ((await response.json()) as { summarizePages?: unknown })
    .summarizePages;
}

async function job(options: Record<string, unknown>) {
  const response = await createJob(
    post("/api/jobs", {
      tool: "summarize-pdf",
      inputs: ["f_sumpages0000001"],
      options,
      declaredCharacters: 1200,
    }),
  );
  const body = (await response.json()) as { error?: { message?: string } };
  return { status: response.status, message: body.error?.message };
}

/** Is the whole day's allowance still there? (A refusal spends nothing.) */
async function wholeDayLeft(): Promise<boolean> {
  const decision = await enforceAiCharacterAllowance(
    AI_CHARACTER_ALLOWANCE,
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: { "x-forwarded-for": CLIENT_IP },
    }),
  );
  expect(decision.enforced, "health: the limiter must be counting").toBe(true);
  return decision.allowed;
}

/**
 * Each beat and whether it proves the key. "htmlzip-only" is the divergence
 * row (m8b): a status route that passed ANOTHER key's predicate into the new
 * slot, or set the field in only one of `buildWorkerStatus`'s returned
 * shapes, would offer what the gate refuses on exactly this beat.
 */
const CASES = [
  ["an OLD worker: no summarizePages key (today's image)", false, "drop"],
  ["a NEW worker on a fresh beat", true, "fresh"],
  ["a NEW worker on a STALE beat", false, "stale"],
  ["a worker that says false", false, "false"],
  ["htmlZip proven, summarizePages false", false, "htmlzip-only"],
  ["no heartbeat at all", false, "none"],
] as const;

type Shape = (typeof CASES)[number][2];

async function publish(shape: Shape): Promise<void> {
  if (shape === "none") return publishHeartbeat(route, null);
  if (shape === "htmlzip-only")
    return publishHeartbeat(
      route,
      beat({ htmlZip: true, summarizePages: false }, Date.now()),
    );
  return publishHeartbeat(
    route,
    beat(
      { summarizePages: shape !== "false" },
      shape === "stale" ? Date.now() - 24 * HOUR : Date.now(),
      shape === "drop" ? "summarizePages" : undefined,
    ),
  );
}

const CLOSED = { status: 501, message: SUMMARIZE_PAGES_NOT_RUNNING_MESSAGE };
const PAGES = { length: "brief", format: "bullets", pages: [[3, 4]] };
const WHOLE = { length: "brief", format: "bullets" };

beforeEach(() => {
  resetRateLimitGuardForTests();
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  route = wireJobRoute();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  unwireJobRoute();
});

describe("Summarize's chosen pages: the offer and the gate agree, beat by beat", () => {
  it("health: the corpus has exactly one beat that proves the key", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    expect(CASES.filter(([, expected]) => expected)).toHaveLength(1);
  });

  it.each(CASES)("%s → %s", async (_name, expected, shape) => {
    await publish(shape);
    const offer = await offered();
    const admitted = await job(PAGES);
    expect({ offer, admitted: admitted.status < 300 }).toEqual({
      offer: expected,
      admitted: expected,
    });
    if (expected) {
      // Admitted AND charged: the allowance moved.
      expect(await wholeDayLeft(), "the admitted job was not charged").toBe(
        false,
      );
    } else {
      expect(admitted).toEqual(CLOSED);
      expect(await wholeDayLeft(), "the refusal charged the allowance").toBe(
        true,
      );
    }
  });

  // THE ORDER, against the ceiling: with the global spend ceiling SPENT, a
  // gate that ran after `peekAiSpendCeiling` would answer the ceiling's 503;
  // only a gate above it answers 501. (POSITIVE CONTROL in the same test: a
  // job without `pages` on the same beat does meet the ceiling, so the
  // ceiling really is spent and the route really reads it.)
  it.each(CASES.filter(([, expected]) => !expected))(
    "refused BEFORE the ceiling peek: %s",
    async (_name, _expected, shape) => {
      await publish(shape);
      const recorded = await recordAiSpend(policyFor("ai.spend").limit);
      expect(recorded, "health: the ceiling could not be spent").toBe(true);
      expect(await job(PAGES)).toEqual(CLOSED);
      expect(await job(WHOLE)).toEqual({
        status: 503,
        message: AI_CEILING_REACHED_MESSAGE,
      });
    },
  );

  it.each(CASES)(
    "a job WITHOUT pages is admitted whatever the beat: %s",
    async (_name, _expected, shape) => {
      await publish(shape);
      expect((await job(WHOLE)).status).toBeLessThan(300);
    },
  );

  it.each(CASES)(
    "an empty pages list is the contract's 400 on every beat, charging nothing: %s",
    async (_name, _expected, shape) => {
      await publish(shape);
      const refused = await job({ ...WHOLE, pages: [] });
      expect(refused.status).toBe(400);
      expect(refused.message).toMatch(/cannot be empty/);
      expect(await wholeDayLeft()).toBe(true);
    },
  );
});
