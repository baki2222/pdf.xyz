// @vitest-environment node
/**
 * HEARTBEAT -> `GET /api/worker/status` -> `requestSignatureLabels`, through
 * the REAL route (2026-11-18).
 *
 * Request Signatures writes each box's label into prepared.pdf as the box's
 * tooltip (PR #364). The worker image ships separately from the web tier
 * (CLAUDE.md rule 5), and an image built before #364 writes none, so whether
 * the RUNNING worker does is a live capability: the daemon proves it at
 * start-up (`request-signatures/labels-capability.ts`) and the status route
 * reports it. An OLD worker (no key), a stale beat, a worker saying false, a
 * worker proving only ANOTHER key (the sibling `ocrOwnerPassword`, the beat
 * that tells a route keyed on the wrong predicate from the right one), or no
 * beat at all reads false; a NEW worker on a fresh beat reads true.
 *
 * Nothing is gated on it: a label sent to an older worker still lands in
 * manifest.json, so the job route admits labels on every beat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import {
  buildHeartbeat,
  emptyCapabilities,
  liveWorkerWritesRequestSignatureLabels,
  readWorkerHeartbeatLiveness,
  serializeHeartbeat,
  type HeartbeatCapabilities,
} from "@/lib/workers/heartbeat";
import {
  publishHeartbeat,
  unwireJobRoute,
  wireJobRoute,
  type WiredJobRoute,
} from "@/tests/wired-job-route";
import { GET } from "./route";

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

async function reported(): Promise<unknown> {
  const response = await GET(new Request("http://localhost/api/worker/status"));
  expect(response.status).toBe(200);
  return ((await response.json()) as { requestSignatureLabels?: unknown })
    .requestSignatureLabels;
}

const CASES = [
  ["an OLD worker: no requestSignatureLabels key", false, "drop"],
  ["a NEW worker on a fresh beat", true, "fresh"],
  ["a NEW worker on a STALE beat", false, "stale"],
  ["a worker that says false", false, "false"],
  ["ocrOwnerPassword proven, requestSignatureLabels false", false, "sibling"],
  ["no heartbeat at all", false, "none"],
] as const;

type Shape = (typeof CASES)[number][2];

async function publish(shape: Shape): Promise<void> {
  if (shape === "none") return publishHeartbeat(route, null);
  if (shape === "sibling")
    return publishHeartbeat(
      route,
      beat(
        { ocrOwnerPassword: true, requestSignatureLabels: false },
        Date.now(),
      ),
    );
  return publishHeartbeat(
    route,
    beat(
      { requestSignatureLabels: shape !== "false" },
      shape === "stale" ? Date.now() - 24 * HOUR : Date.now(),
      shape === "drop" ? "requestSignatureLabels" : undefined,
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

describe("Request Signatures' labels in prepared.pdf: the status route reports the running worker", () => {
  it("health: the corpus has exactly one beat that proves the key", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    expect(CASES.filter(([, expected]) => expected)).toHaveLength(1);
  });

  it.each(CASES)("%s -> %s", async (_name, expected, shape) => {
    await publish(shape);
    // The route and the predicate it is built on agree, beat by beat.
    expect({
      route: await reported(),
      predicate: liveWorkerWritesRequestSignatureLabels(
        await readWorkerHeartbeatLiveness(),
      ),
    }).toEqual({ route: expected, predicate: expected });
  });
});
