// @vitest-environment node
/**
 * HEARTBEAT → the two routes that decide OCR PDF's Owner password field for
 * a restricted PDF, through the REAL routes (competitor-audit backlog #11):
 *
 *   - `GET /api/worker/status` → `ocrOwnerPassword`, which the panel shows
 *     the field on;
 *   - `POST /api/jobs` for ocr-pdf carrying `ownerPassword`.
 *
 * The worker image ships separately from the web tier (CLAUDE.md rule 5),
 * and an image built before the field parses options leniently: it DROPS
 * the password and refuses the file as restricted. So for every beat the two
 * must agree: an OLD worker (no key), a stale beat, a worker saying false, a
 * worker proving only ANOTHER key (the sibling `csvImportOptions`, the beat
 * that tells a gate keyed on the wrong predicate from the right one), or
 * none at all is not offered the field, and the job route refuses the job
 * with the typed message; a NEW worker on a fresh beat is offered it and the
 * job is admitted. An OCR job WITHOUT the key is admitted on every beat
 * (positive control: today's request is unchanged).
 *
 * The heartbeat is published into the in-memory Redis the routes read over
 * the real Upstash REST wire (`@/tests/wired-job-route`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { OCR_OWNER_PASSWORD_NOT_RUNNING_MESSAGE } from "@/lib/jobs/ocr-owner-password";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
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

const CLIENT_IP = "203.0.113.62";
const HOUR = 3_600_000;
const OWNER = "owner-route-test";
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
  return ((await response.json()) as { ocrOwnerPassword?: unknown })
    .ocrOwnerPassword;
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
        tool: "ocr-pdf",
        inputs: ["f_ocrowner0000001"],
        options,
      }),
    }),
  );
  const text = await response.text();
  const body = JSON.parse(text) as { error?: { message?: string } };
  return { status: response.status, message: body.error?.message, text };
}

const CASES = [
  ["an OLD worker: no ocrOwnerPassword key", false, "drop"],
  ["a NEW worker on a fresh beat", true, "fresh"],
  ["a NEW worker on a STALE beat", false, "stale"],
  ["a worker that says false", false, "false"],
  ["csvImportOptions proven, ocrOwnerPassword false", false, "sibling-only"],
  ["no heartbeat at all", false, "none"],
] as const;

type Shape = (typeof CASES)[number][2];

async function publish(shape: Shape): Promise<void> {
  if (shape === "none") return publishHeartbeat(route, null);
  if (shape === "sibling-only")
    return publishHeartbeat(
      route,
      beat({ csvImportOptions: true, ocrOwnerPassword: false }, Date.now()),
    );
  return publishHeartbeat(
    route,
    beat(
      { ocrOwnerPassword: shape !== "false" },
      shape === "stale" ? Date.now() - 24 * HOUR : Date.now(),
      shape === "drop" ? "ocrOwnerPassword" : undefined,
    ),
  );
}

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

describe("OCR PDF's owner password: the offer and the gate agree, beat by beat", () => {
  it("health: the corpus has exactly one beat that proves the key", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    expect(CASES.filter(([, expected]) => expected)).toHaveLength(1);
  });

  it.each(CASES)("%s → %s", async (_name, expected, shape) => {
    await publish(shape);
    const offer = await offered();
    const admitted = await job({ languages: ["eng"], ownerPassword: OWNER });
    expect({ offer, admitted: admitted.status < 300 }).toEqual({
      offer: expected,
      admitted: expected,
    });
    if (!expected)
      expect(admitted).toMatchObject({
        status: 501,
        message: OCR_OWNER_PASSWORD_NOT_RUNNING_MESSAGE,
      });
    // The password is in no response, admitted or refused.
    expect(admitted.text).not.toContain(OWNER);
  });

  it.each(CASES)(
    "an OCR job WITHOUT the key is admitted whatever the beat: %s",
    async (_name, _expected, shape) => {
      await publish(shape);
      expect((await job({ languages: ["eng"] })).status).toBeLessThan(300);
    },
  );
});
