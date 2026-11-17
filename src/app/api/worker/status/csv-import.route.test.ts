// @vitest-environment node
/**
 * HEARTBEAT → the two routes that decide Excel to PDF's CSV Delimiter and
 * Character set, through the REAL routes (competitor audit #18):
 *
 *   - `GET /api/worker/status` → `csvImportOptions`, which the panel shows
 *     the two selects on;
 *   - `POST /api/jobs` for excel-to-pdf carrying `csvDelimiter` or
 *     `csvCharset`.
 *
 * The worker image ships separately from the web tier (CLAUDE.md rule 5),
 * and an image built before the choices parses options leniently: it DROPS
 * both keys and reads the CSV as comma separated. So for every beat the two
 * must agree: an OLD worker (no key), a stale beat, a worker saying false, a
 * worker proving only ANOTHER key (the sibling `translatePageRange`, the
 * beat that tells a gate keyed on the wrong predicate from the right one),
 * or none at all is not offered the choice, and the job route refuses it
 * with the typed message; a NEW worker on a fresh beat is offered it and the
 * job is admitted. A job WITHOUT the keys is admitted on every beat
 * (positive control: the old request is unchanged), and an unknown value is
 * the contract's 422 on every beat, with its field named.
 *
 * The heartbeat is published into the in-memory Redis the routes read over
 * the real Upstash REST wire (`@/tests/wired-job-route`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import {
  buildHeartbeat,
  emptyCapabilities,
  serializeHeartbeat,
  type HeartbeatCapabilities,
} from "@/lib/workers/heartbeat";
import { CSV_IMPORT_NOT_RUNNING_MESSAGE } from "@/lib/workers/office-conversion/csv-import";
import {
  publishHeartbeat,
  unwireJobRoute,
  wireJobRoute,
  type WiredJobRoute,
} from "@/tests/wired-job-route";
import { POST as createJob } from "../../jobs/route";
import { GET } from "./route";

const CLIENT_IP = "203.0.113.61";
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

async function offered(): Promise<unknown> {
  const response = await GET(new Request("http://localhost/api/worker/status"));
  expect(response.status).toBe(200);
  return ((await response.json()) as { csvImportOptions?: unknown })
    .csvImportOptions;
}

async function job(options: Record<string, unknown>) {
  const response = await createJob(
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": CLIENT_IP,
      },
      body: JSON.stringify({
        tool: "excel-to-pdf",
        inputs: ["f_csvimport000001"],
        options,
      }),
    }),
  );
  const body = (await response.json()) as {
    error?: { message?: string; details?: Array<{ field?: string }> };
  };
  return {
    status: response.status,
    message: body.error?.message,
    field: body.error?.details?.[0]?.field,
  };
}

const CASES = [
  ["an OLD worker: no csvImportOptions key", false, "drop"],
  ["a NEW worker on a fresh beat", true, "fresh"],
  ["a NEW worker on a STALE beat", false, "stale"],
  ["a worker that says false", false, "false"],
  ["translatePageRange proven, csvImportOptions false", false, "sibling-only"],
  ["no heartbeat at all", false, "none"],
] as const;

type Shape = (typeof CASES)[number][2];

async function publish(shape: Shape): Promise<void> {
  if (shape === "none") return publishHeartbeat(route, null);
  if (shape === "sibling-only")
    return publishHeartbeat(
      route,
      beat({ translatePageRange: true, csvImportOptions: false }, Date.now()),
    );
  return publishHeartbeat(
    route,
    beat(
      { csvImportOptions: shape !== "false" },
      shape === "stale" ? Date.now() - 24 * HOUR : Date.now(),
      shape === "drop" ? "csvImportOptions" : undefined,
    ),
  );
}

const CHOSEN = { csvDelimiter: "semicolon", csvCharset: "windows-1251" };

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

describe("Excel to PDF's CSV choices: the offer and the gate agree, beat by beat", () => {
  it("health: the corpus has exactly one beat that proves the key", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    expect(CASES.filter(([, expected]) => expected)).toHaveLength(1);
  });

  it.each(CASES)("%s → %s", async (_name, expected, shape) => {
    await publish(shape);
    const offer = await offered();
    const admitted = await job(CHOSEN);
    expect({ offer, admitted: admitted.status < 300 }).toEqual({
      offer: expected,
      admitted: expected,
    });
    if (!expected)
      expect(admitted).toMatchObject({
        status: 501,
        message: CSV_IMPORT_NOT_RUNNING_MESSAGE,
      });
  });

  it.each(CASES)(
    'either key alone, even "auto", is gated the same way: %s',
    async (_name, expected, shape) => {
      await publish(shape);
      for (const options of [{ csvDelimiter: "tab" }, { csvCharset: "auto" }])
        expect((await job(options)).status < 300, JSON.stringify(options)).toBe(
          expected,
        );
    },
  );

  it.each(CASES)(
    "a job WITHOUT the keys is admitted whatever the beat: %s",
    async (_name, _expected, shape) => {
      await publish(shape);
      expect((await job({})).status).toBeLessThan(300);
      expect((await job({ onePagePerSheet: true })).status).toBeLessThan(300);
    },
  );

  it.each(CASES)(
    "an unknown value is the contract's 422, field named, on every beat: %s",
    async (_name, _expected, shape) => {
      await publish(shape);
      expect(await job({ csvDelimiter: "colon" })).toMatchObject({
        status: 422,
        field: "options.csvDelimiter",
      });
      expect(await job({ csvCharset: "koi8-r" })).toMatchObject({
        status: 422,
        field: "options.csvCharset",
      });
    },
  );
});
