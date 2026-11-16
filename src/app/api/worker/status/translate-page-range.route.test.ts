// @vitest-environment node
/**
 * HEARTBEAT → the two routes that decide Translate PDF's page choice, through
 * the REAL routes (competitor audit #29, slice 6):
 *
 *   - `GET /api/worker/status` → `translatePageRange`, which the panel shows
 *     its Pages field on;
 *   - `POST /api/jobs` for translate-pdf carrying `pages`.
 *
 * The worker image ships separately from the web tier (CLAUDE.md rule 5),
 * and an image built before page selection parses options leniently: it
 * DROPS `pages` and translates the WHOLE document under a delivery cap sized
 * for the selection. So for every beat the two must agree: an OLD worker (no
 * `translatePageRange` key — today's production image), a stale beat, a
 * worker saying false, a worker proving only ANOTHER key (`htmlZip`, or the
 * sibling `summarizePages` — the beat that tells a gate keyed on the wrong
 * predicate from the right one), or none at all is not offered the choice,
 * and the job route refuses it with the typed message BEFORE the
 * spend-ceiling peek and the allowance reservation; a NEW worker on a fresh
 * beat is offered it, and the job is admitted and charged exactly
 * `ceil(declared × 4)`. A job WITHOUT `pages` is admitted on every beat
 * (positive control: the old behaviour is unchanged).
 *
 * "Called zero times" is read from STATE, not spies (the suite runs
 * `isolate: false` and allows no module mock): the reservation is the
 * allowance moving, and the peek's order is seen against a SPENT ceiling —
 * a gate below the peek would answer the ceiling's 503, not 501.
 *
 * The heartbeat is published into the in-memory Redis the routes read over
 * the real Upstash REST wire (`@/tests/wired-job-route`); the allowance and
 * the ceiling are the real local-memory limiter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";
import { TRANSLATE_PAGES_NOT_RUNNING_MESSAGE } from "@/lib/jobs/translate-pages";
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

const CLIENT_IP = "203.0.113.54";
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
  return ((await response.json()) as { translatePageRange?: unknown })
    .translatePageRange;
}

async function job(options: Record<string, unknown>) {
  const response = await createJob(
    post("/api/jobs", {
      tool: "translate-pdf",
      inputs: ["f_trpages00000001"],
      options,
      declaredCharacters: DECLARED,
      declaredTextPages: 2,
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
 * Each beat and whether it proves the key. "htmlzip-only" and
 * "summarize-only" are the divergence rows: a status route that passed
 * ANOTHER key's predicate into the new slot, a gate keyed on the sibling
 * `runningWorkerSummarizesPages` (the copy-paste a mirrored block invites,
 * M13), or a field set in only one of `buildWorkerStatus`'s returned shapes
 * would offer or admit on exactly these beats.
 */
const CASES = [
  ["an OLD worker: no translatePageRange key (today's image)", false, "drop"],
  ["a NEW worker on a fresh beat", true, "fresh"],
  ["a NEW worker on a STALE beat", false, "stale"],
  ["a worker that says false", false, "false"],
  ["htmlZip proven, translatePageRange false", false, "htmlzip-only"],
  ["summarizePages proven, translatePageRange false", false, "summarize-only"],
  ["no heartbeat at all", false, "none"],
] as const;

type Shape = (typeof CASES)[number][2];

async function publish(shape: Shape): Promise<void> {
  if (shape === "none") return publishHeartbeat(route, null);
  if (shape === "htmlzip-only")
    return publishHeartbeat(
      route,
      beat({ htmlZip: true, translatePageRange: false }, Date.now()),
    );
  if (shape === "summarize-only")
    return publishHeartbeat(
      route,
      beat({ summarizePages: true, translatePageRange: false }, Date.now()),
    );
  return publishHeartbeat(
    route,
    beat(
      { translatePageRange: shape !== "false" },
      shape === "stale" ? Date.now() - 24 * HOUR : Date.now(),
      shape === "drop" ? "translatePageRange" : undefined,
    ),
  );
}

const DECLARED = 1200;
const CLOSED = { status: 501, message: TRANSLATE_PAGES_NOT_RUNNING_MESSAGE };
const PAGES = {
  targetLanguage: "fr",
  pages: [
    [2, 2],
    [4, 4],
  ],
};
const WHOLE = { targetLanguage: "fr" };

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

describe("Translate's chosen pages: the offer and the gate agree, beat by beat", () => {
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

  // POSITIVE CONTROL for the charge: on the one beat that admits, the
  // reservation is exactly `ceil(declared × 4)` (Translate's per-character
  // price, the typed 4 an independent bound on the headroom constant): the
  // rest of the day is still there to the character, and not one more.
  it("fresh + true admits and reserves exactly ceil(declared × 4)", async () => {
    await publish("fresh");
    const admitted = await job(PAGES);
    expect(admitted.status).toBeLessThan(300);
    const charge = Math.ceil(DECLARED * 4);
    const probe = (characters: number) =>
      enforceAiCharacterAllowance(
        characters,
        new Request("http://localhost/api/jobs", {
          method: "POST",
          headers: { "x-forwarded-for": CLIENT_IP },
        }),
      );
    const rest = await probe(AI_CHARACTER_ALLOWANCE - charge);
    expect(rest.enforced, "health: the limiter must be counting").toBe(true);
    expect(rest.allowed, "the job reserved more than its declaration").toBe(
      true,
    );
    expect(
      (await probe(1)).allowed,
      "the job reserved less than its declaration",
    ).toBe(false);
  });

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
