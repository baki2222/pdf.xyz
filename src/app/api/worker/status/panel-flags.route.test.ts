// @vitest-environment node
/**
 * HEARTBEAT -> `GET /api/worker/status` -> each panel flag (audit wave 2),
 * through the REAL route, for EVERY key in `WORKER_PANEL_FLAGS` (the list
 * the route itself maps, so a flag added there is exercised here).
 *
 * Each flag gates a control a panel offers only when the RUNNING worker
 * proves it (Webpage to PDF's Hide common ads, …): the worker image ships
 * separately from the web tier (CLAUDE.md rule 5), and an image built before
 * the flag publishes no key. An OLD worker (key dropped), a stale beat, a
 * worker saying false, a worker proving every OTHER flag but this one (the
 * beat that tells a route keyed on the wrong flag from the right one), or no
 * beat at all reads false; a NEW worker on a fresh beat reads true.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import {
  buildHeartbeat,
  emptyCapabilities,
  liveWorkerProves,
  readWorkerHeartbeatLiveness,
  serializeHeartbeat,
  WORKER_PANEL_FLAGS,
  type HeartbeatCapabilities,
  type WorkerPanelFlag,
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

async function reported(key: WorkerPanelFlag): Promise<unknown> {
  const response = await GET(new Request("http://localhost/api/worker/status"));
  expect(response.status).toBe(200);
  return ((await response.json()) as Record<string, unknown>)[key];
}

const SHAPES = [
  ["an OLD worker: no key", false, "drop"],
  ["a NEW worker on a fresh beat", true, "fresh"],
  ["a NEW worker on a STALE beat", false, "stale"],
  ["a worker that says false", false, "false"],
  ["every other flag proven, this one false", false, "siblings"],
  ["no heartbeat at all", false, "none"],
] as const;
type Shape = (typeof SHAPES)[number][2];

async function publish(key: WorkerPanelFlag, shape: Shape): Promise<void> {
  if (shape === "none") return publishHeartbeat(route, null);
  const all = Object.fromEntries(
    [...WORKER_PANEL_FLAGS, "requestSignatureLabels" as const].map((k) => [
      k,
      true,
    ]),
  );
  if (shape === "siblings")
    return publishHeartbeat(route, beat({ ...all, [key]: false }, Date.now()));
  return publishHeartbeat(
    route,
    beat(
      { [key]: shape !== "false" },
      shape === "stale" ? Date.now() - 24 * HOUR : Date.now(),
      shape === "drop" ? key : undefined,
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

describe("panel flags: the status route reports what the running worker proves", () => {
  it("health: there are flags, each a heartbeat key, and one beat per flag proves it", () => {
    expect(WORKER_PANEL_FLAGS.length).toBeGreaterThan(0);
    for (const key of WORKER_PANEL_FLAGS)
      expect(Object.keys(emptyCapabilities())).toContain(key);
    expect(SHAPES.filter(([, expected]) => expected)).toHaveLength(1);
  });

  for (const key of WORKER_PANEL_FLAGS)
    it.each(SHAPES)(`${key}: %s -> %s`, async (_name, expected, shape) => {
      await publish(key, shape);
      expect({
        route: await reported(key),
        predicate: liveWorkerProves(await readWorkerHeartbeatLiveness(), key),
      }).toEqual({ route: expected, predicate: expected });
    });
});
