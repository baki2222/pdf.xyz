// @vitest-environment node
/**
 * HEARTBEAT → `GET /api/worker/status` → `translateOcr`, through the real
 * route (review finding, honesty lens, translate-pdf#3).
 *
 * The panel offers the OCR language picker, and uploads a scan, only on
 * `status.translateOcr`. Until this file the only status-level test called
 * `buildWorkerStatus` with a boolean the test supplied itself, so the route
 * could ignore the heartbeat key — `const workerTranslateOcr = observed` —
 * and every test stayed green while the status offered OCR against today's
 * production image, which publishes no such key (CLAUDE.md rule 5).
 *
 * The heartbeat is published into the in-memory Redis the route reads over
 * the real Upstash REST wire (`@/tests/wired-job-route`). The LAST block runs
 * each beat through BOTH routes: what the status offers and what
 * `POST /api/jobs` admits must agree, since they read one predicate
 * (`translateScanAdmission`).
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
import {
  publishHeartbeat,
  unwireJobRoute,
  wireJobRoute,
  type WiredJobRoute,
} from "@/tests/wired-job-route";
import { POST } from "../../jobs/route";
import { GET } from "./route";

let route: WiredJobRoute;

function beat(
  caps: Partial<HeartbeatCapabilities>,
  at = Date.now(),
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

async function statusTranslateOcr(): Promise<unknown> {
  const response = await GET(new Request("http://localhost/api/worker/status"));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { translateOcr?: unknown };
  return body.translateOcr;
}

async function routeAdmitsOcr(): Promise<boolean> {
  const response = await POST(
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.47",
      },
      body: JSON.stringify({
        tool: "translate-pdf",
        inputs: ["f_translateocr0002"],
        options: { targetLanguage: "en", ocr: true, languages: ["eng"] },
      }),
    }),
  );
  return response.status < 300;
}

const HOUR = 3_600_000;
const LIVE = { translateOcr: true, ocr: true, ocrLanguages: ["eng", "deu"] };

/** Each heartbeat shape and what the status must say about it. */
const CASES = [
  ["today's production image: no translateOcr key", false, LIVE, "drop"],
  ["translateOcr and OCR on a fresh beat", true, LIVE, undefined],
  ["translateOcr and OCR on a STALE beat", false, LIVE, "stale"],
  ["translateOcr without OCR", false, { ...LIVE, ocr: false }, undefined],
  [
    "translateOcr and OCR with NO packs",
    false,
    { ...LIVE, ocrLanguages: [] },
    undefined,
  ],
  ["no heartbeat at all", false, null, undefined],
] as const;

async function publish(
  caps: Partial<HeartbeatCapabilities> | null,
  shape: "drop" | "stale" | undefined,
): Promise<void> {
  if (caps === null) return publishHeartbeat(route, null);
  return publishHeartbeat(
    route,
    beat(
      caps,
      shape === "stale" ? Date.now() - 24 * HOUR : Date.now(),
      shape === "drop" ? "translateOcr" : undefined,
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

describe("GET /api/worker/status derives translateOcr from the running worker's heartbeat", () => {
  it.each(CASES)("%s → %s", async (_name, expected, caps, shape) => {
    await publish(caps, shape);
    expect(await statusTranslateOcr()).toBe(expected);
    if (caps !== null)
      expect(route.heartbeatReads(), "the route never read the beat").toBe(1);
  });
});

describe("the panel's offer and the route's admission agree, beat by beat", () => {
  it.each(CASES)("%s", async (_name, expected, caps, shape) => {
    await publish(caps, shape);
    const offered = await statusTranslateOcr();
    const admitted = await routeAdmitsOcr();
    expect({ offered, admitted }).toEqual({
      offered: expected,
      admitted: expected,
    });
  });
});
