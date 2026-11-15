// @vitest-environment node
/**
 * HEARTBEAT → `GET /api/worker/status` → `chatRetrieval`, through the REAL
 * route and the real Upstash REST wire (`@/tests/wired-job-route`), beat by
 * beat (competitor audit wave 2 #30, slice 3).
 *
 * The chat panel's sentence about how pages are chosen renders only on an
 * observed `chatRetrieval: true`. The worker image ships separately from the
 * web tier (CLAUDE.md rule 5), and an image built before retrieval sends
 * only the opening pages: an OLD worker (no key — the image production runs
 * today), a stale beat, a beat that says false, or none at all must read
 * false; only a NEW worker on a fresh beat reads true.
 *
 * And the predicate the route reads (`liveWorkerSelectsChatPages`) is held
 * on its own over the same shapes, so a route that stopped calling it and a
 * predicate that stopped checking `observed` are each a red here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import {
  buildHeartbeat,
  emptyCapabilities,
  liveWorkerSelectsChatPages,
  readWorkerHeartbeatLiveness,
  serializeHeartbeat,
  type HeartbeatCapabilities,
  type HeartbeatLiveness,
} from "@/lib/workers/heartbeat";
import {
  publishHeartbeat,
  unwireJobRoute,
  wireJobRoute,
  type WiredJobRoute,
} from "@/tests/wired-job-route";
import { GET } from "./route";

let route: WiredJobRoute;
const HOUR = 3_600_000;

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

const CASES = [
  [
    "an OLD worker: no chatRetrieval key (today's production image)",
    false,
    "drop",
  ],
  ["a NEW worker on a fresh beat", true, "fresh"],
  ["a NEW worker on a STALE beat", false, "stale"],
  ["a worker that says false", false, "false"],
  ["no heartbeat at all", false, "none"],
] as const;

async function publish(shape: (typeof CASES)[number][2]): Promise<void> {
  if (shape === "none") return publishHeartbeat(route, null);
  return publishHeartbeat(
    route,
    beat(
      { chatRetrieval: shape !== "false" },
      shape === "stale" ? Date.now() - 24 * HOUR : Date.now(),
      shape === "drop" ? "chatRetrieval" : undefined,
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

describe("chat pages chosen by the question: the status route reads the beat", () => {
  it.each(CASES)("%s → %s", async (_name, expected, shape) => {
    await publish(shape);
    const response = await GET(
      new Request("http://localhost/api/worker/status"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { chatRetrieval?: unknown };
    expect(body.chatRetrieval).toBe(expected);
  });
});

describe("liveWorkerSelectsChatPages", () => {
  const liveness = (
    observed: boolean,
    capabilities: Partial<HeartbeatCapabilities> | null,
  ): HeartbeatLiveness => ({
    state: observed ? "observed" : "stale",
    observed,
    source: "queue-broker",
    lastSeen: null,
    mode: "loop",
    capabilities: capabilities
      ? { ...emptyCapabilities(), ...capabilities }
      : null,
    fingerprint: null,
    detail: "",
  });

  it("is true only for an observed beat carrying chatRetrieval: true", () => {
    expect(
      liveWorkerSelectsChatPages(liveness(true, { chatRetrieval: true })),
    ).toBe(true);
  });

  it("is false for a STALE beat that says true", () => {
    expect(
      liveWorkerSelectsChatPages(liveness(false, { chatRetrieval: true })),
    ).toBe(false);
  });

  it("is false when the key is ABSENT (an older image's record, as the reader parses it)", async () => {
    await publish("drop");
    const read = await readWorkerHeartbeatLiveness(process.env);
    expect(read.observed, "the beat was not read at all").toBe(true);
    expect(read.capabilities?.chatRetrieval).toBe(false);
    expect(liveWorkerSelectsChatPages(read)).toBe(false);
  });

  it("is false with no capabilities at all", () => {
    expect(liveWorkerSelectsChatPages(liveness(true, null))).toBe(false);
  });
});
