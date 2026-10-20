// @vitest-environment node
/**
 * The JSON API refuses cross-site browser writes — before it charges anyone's
 * rate-limit bucket.
 *
 * WHY. Any page on the web can make its visitor's browser send a CORS "simple"
 * request with no preflight: method POST and a safelisted Content-Type. Until
 * 2026-09 `readJsonBody` accepted any Content-Type that merely CONTAINED
 * "application/json", and `text/plain;application/json` parses (Fetch spec) to
 * the essence `text/plain` — safelisted. So a hostile page could POST to
 * /api/interest, /api/uploads and /api/jobs from every visitor's browser: each
 * request charged to the VISITOR's bucket (their uploads/hour, their daily AI
 * runs) and the interest counter stuffed from thousands of real addresses.
 * And no route looked at `Sec-Fetch-Site` or `Origin`.
 *
 * THE SET IS DISCOVERED: every state-changing handler (POST/PUT/PATCH/DELETE)
 * exported by a `route.ts` under src/app, from `git ls-files` — a handler added
 * tomorrow is in the corpus the day it exists.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RATE_LIMIT_ENV, policyFor } from "@/lib/ratelimit";
import { resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import { readJsonBody, rejectCrossSite } from "./_lib/http";

const ROOT = process.cwd();
const STATE_CHANGING = ["POST", "PUT", "PATCH", "DELETE"] as const;

type Handler = (request: Request, context: unknown) => Promise<Response>;

async function stateChangingHandlers(): Promise<
  { route: string; method: string; handler: Handler }[]
> {
  const files = execFileSync("git", ["ls-files", "src/app"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f.endsWith("/route.ts"));
  const out: { route: string; method: string; handler: Handler }[] = [];
  for (const file of files) {
    const mod = (await import(path.join(ROOT, file))) as Record<
      string,
      unknown
    >;
    for (const method of STATE_CHANGING)
      if (typeof mod[method] === "function")
        out.push({ route: file, method, handler: mod[method] as Handler });
  }
  return out;
}

/** Route params for any dynamic segment: a well-formed id of every shape. */
const context = {
  params: Promise.resolve(
    new Proxy({} as Record<string, string>, {
      get: (_t, key) =>
        key === "then"
          ? undefined
          : String(key).startsWith("file")
            ? "f_1234567890"
            : "job_1234567890",
    }),
  ),
};

function request(
  method: string,
  headers: Record<string, string>,
  body = '{"slug":"merge-pdf"}',
): Request {
  return new Request("https://pdf.xyz/api/x", {
    method,
    headers: { host: "pdf.xyz", ...headers },
    ...(method === "DELETE" ? {} : { body }),
  });
}

describe("rejectCrossSite", () => {
  it.each([
    [{ "sec-fetch-site": "cross-site" }, 403],
    [{ "sec-fetch-site": "same-site" }, 403],
    [{ origin: "https://evil.example" }, 403],
    [{ origin: "null" }, 403],
    // Positive controls: same-origin browsers, user navigation, and
    // server-to-server callers (the proof harness, curl) all pass.
    [{ "sec-fetch-site": "same-origin", origin: "https://pdf.xyz" }, null],
    [{ "sec-fetch-site": "none" }, null],
    [{ origin: "https://pdf.xyz" }, null],
    [{}, null],
  ] as const)("%j → %s", (headers, expected) => {
    const res = rejectCrossSite(request("POST", headers));
    expect(res?.status ?? null).toBe(expected);
  });
});

describe("readJsonBody reads the MIME essence, not a substring", () => {
  it("refuses text/plain;application/json — a CORS-safelisted type", async () => {
    const res = await readJsonBody(
      request("POST", { "content-type": "text/plain;application/json" }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(415);
  });

  it("still accepts application/json with parameters (positive control)", async () => {
    for (const type of [
      "application/json",
      "application/json; charset=utf-8",
      "Application/JSON",
    ]) {
      const res = await readJsonBody(request("POST", { "content-type": type }));
      expect(res.ok, type).toBe(true);
    }
  });
});

describe("every state-changing route refuses a cross-site browser first", () => {
  beforeEach(() => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    resetRateLimitGuardForTests();
  });
  afterEach(() => {
    delete process.env[RATE_LIMIT_ENV.provider];
    resetRateLimitGuardForTests();
  });

  it("discovers the handlers (health check)", async () => {
    const found = await stateChangingHandlers();
    // interest POST, jobs POST, jobs/[id] DELETE, uploads POST, uploads/local PUT
    expect(found.length).toBeGreaterThanOrEqual(5);
    expect(found.map((h) => `${h.method} ${h.route}`)).toEqual(
      expect.arrayContaining([
        "POST src/app/api/interest/route.ts",
        "POST src/app/api/jobs/route.ts",
        "POST src/app/api/uploads/route.ts",
      ]),
    );
    // Reads and parses every route handler's source: 3.5-4.3 s on a quiet machine
    // against vitest's 5 s default, and it timed out under load (2026-10-11,
    // during a parallel build) — the same class as 2b20baa7.
  }, 30_000);

  it("answers 403 to a cross-site request on every one of them", async () => {
    const refusedWrongly: string[] = [];
    for (const { route, method, handler } of await stateChangingHandlers()) {
      const res = await handler(
        request(method, {
          "sec-fetch-site": "cross-site",
          origin: "https://evil.example",
          "content-type": "application/json",
        }),
        context,
      );
      if (res.status !== 403)
        refusedWrongly.push(`${method} ${route} → ${res.status}`);
    }
    expect(refusedWrongly).toEqual([]);
  });

  it("refuses BEFORE charging the visitor's bucket (ordering, observed through the limiter)", async () => {
    const { POST } = await import("./interest/route");
    const limit = policyFor("interest.note").limit;
    const crossSite = () =>
      POST(
        request("POST", {
          "sec-fetch-site": "cross-site",
          "content-type": "application/json",
        }),
      );
    const sameOrigin = () =>
      POST(
        request("POST", {
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        }),
      );
    // A hostile page fires the visitor's whole budget and more…
    for (let i = 0; i <= limit; i++)
      expect((await crossSite()).status).toBe(403);
    // …and the visitor's own first request is still within budget.
    expect((await sameOrigin()).status).not.toBe(429);

    // POSITIVE CONTROL: the same number of SAME-origin requests does spend it,
    // so the line above is not passing because nothing is enforced.
    resetRateLimitGuardForTests();
    for (let i = 0; i < limit; i++) await sameOrigin();
    expect((await sameOrigin()).status).toBe(429);
  });
});
