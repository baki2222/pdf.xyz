// @vitest-environment node
/**
 * HEARTBEAT → the three routes that decide a ZIP for HTML to PDF, through
 * the REAL routes (competitor audit #26):
 *
 *   - `GET /api/worker/status` → `htmlZip`, which the page offers ZIP on;
 *   - `POST /api/uploads` with a .zip for html-to-pdf;
 *   - `POST /api/jobs` for html-to-pdf naming a page of a ZIP (`entry`).
 *
 * The worker image ships separately from the web tier (CLAUDE.md rule 5),
 * and an image built before ZIP input renders a ZIP's bytes as HTML and
 * reports success. So for every beat the three must agree: an OLD worker
 * (no `htmlZip` key — today's production image), a stale beat or none at
 * all is not offered ZIP and both APIs refuse it with the typed message; a
 * NEW worker on a fresh beat is offered it and both APIs admit it. And an
 * HTML file is admitted either way: the gate is for ZIPs only.
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
import { HTML_ZIP_NOT_RUNNING_MESSAGE } from "@/lib/workers/html-render/zip-config";
import {
  publishHeartbeat,
  unwireJobRoute,
  wireJobRoute,
  type WiredJobRoute,
} from "@/tests/wired-job-route";
import { POST as createJob } from "../../jobs/route";
import { POST as createUpload } from "../../uploads/route";
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

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.48",
    },
    body: JSON.stringify(body),
  });

async function offered(): Promise<unknown> {
  const response = await GET(new Request("http://localhost/api/worker/status"));
  expect(response.status).toBe(200);
  return ((await response.json()) as { htmlZip?: unknown }).htmlZip;
}

async function upload(filename: string, contentType: string) {
  const response = await createUpload(
    post("/api/uploads", {
      tool: "html-to-pdf",
      files: [{ filename, contentType, bytes: 2048 }],
    }),
  );
  const body = (await response.json()) as { error?: { message?: string } };
  return { status: response.status, message: body.error?.message };
}

async function job(options: Record<string, unknown>, inputName: string) {
  const response = await createJob(
    post("/api/jobs", {
      tool: "html-to-pdf",
      inputs: ["f_htmlzip00000001"],
      inputNames: [inputName],
      options,
    }),
  );
  const body = (await response.json()) as { error?: { message?: string } };
  return { status: response.status, message: body.error?.message };
}

const CASES = [
  ["an OLD worker: no htmlZip key (today's production image)", false, "drop"],
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
      { htmlZip: shape !== "false" },
      shape === "stale" ? Date.now() - 24 * HOUR : Date.now(),
      shape === "drop" ? "htmlZip" : undefined,
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

describe("ZIP for HTML to PDF: the offer and both gates agree, beat by beat", () => {
  it.each(CASES)("%s → %s", async (_name, expected, shape) => {
    await publish(shape);
    expect(await offered()).toBe(expected);

    for (const [name, type] of [
      ["site.zip", "application/zip"],
      ["site.zip", "application/x-zip-compressed"],
    ] as const) {
      const up = await upload(name, type);
      if (expected) expect(up.status, `${type} upload`).toBeLessThan(300);
      else
        expect(up, `${type} upload`).toEqual({
          status: 501,
          message: HTML_ZIP_NOT_RUNNING_MESSAGE,
        });
    }

    const zipJob = await job({ entry: "site/index.html" }, "site.zip");
    if (expected) expect(zipJob.status).toBeLessThan(300);
    else
      expect(zipJob).toEqual({
        status: 501,
        message: HTML_ZIP_NOT_RUNNING_MESSAGE,
      });
    // A .zip input with no page named is still a ZIP job.
    const unnamed = await job({}, "site.zip");
    expect(unnamed.status < 300).toBe(expected);
  });

  it.each(CASES)(
    "an HTML file is admitted whatever the beat: %s",
    async (_n, _e, shape) => {
      await publish(shape);
      expect((await upload("page.html", "text/html")).status).toBeLessThan(300);
      expect((await job({}, "page.html")).status).toBeLessThan(300);
    },
  );

  it("a page name that is not a servable .html path is refused with its field named", async () => {
    await publish("fresh");
    const bad = await job({ entry: "../index.html" }, "site.zip");
    expect(bad.status).toBe(422);
    expect(bad.message).toMatch(/options\.entry/);
  });
});
