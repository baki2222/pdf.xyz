// @vitest-environment node
/**
 * A throttled user was told to read an HTTP header and a repo document.
 *
 * The 429 bodies said "retry after the interval in the Retry-After header. See
 * docs/SECURITY.md." and "...retry after the interval in the Retry-After
 * header." Every browser job client passed that message straight to the panel,
 * and none of them read the header: their response type did not declare one.
 * The allowance message also blamed "text translated by someone else" on the
 * users of Summarize, Chat and Extract.
 *
 * This drives the COMPOSED chain for every rate-limit action the policy table
 * has: the real `respondRateLimited` builds the wire Response, and the real
 * `readWorkerError` reads it, as the panels receive it.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { respondRateLimited } from "@/app/api/_lib/http";
import { RATE_LIMIT_POLICIES } from "@/lib/ratelimit/policy";
import type { RateLimitAction, RateLimitDecision } from "@/lib/ratelimit/types";
import { withoutComments } from "@/lib/tools/copy-surface";
import { runWorkerCompression } from "./client";
import { runWorkerUnlock } from "./pdf-security-client";
import { describeWait, readWorkerError } from "./read-error";

const ROOT = process.cwd();

/** Developer copy a panel must never show. */
const DEVELOPER_COPY = /Retry-After header|docs\/[\w.-]+\.md|See docs\//i;

const denied = (action: RateLimitAction, seconds: number): RateLimitDecision =>
  ({
    allowed: false,
    action,
    policyId: `${action}-policy`,
    provider: "memory",
    enforced: true,
    retryAfterSeconds: seconds,
    retryAfterBucket: "15m+",
  }) as unknown as RateLimitDecision;

const ACTIONS = Object.keys(RATE_LIMIT_POLICIES) as RateLimitAction[];

describe("a 429, as the panel receives it", () => {
  it("health: the policy table yields several actions and at least two distinct messages", async () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(3);
    const bodies = new Set<string>();
    for (const action of ACTIONS) {
      const body = (await respondRateLimited(denied(action, 60)).json()) as {
        error: { message: string };
      };
      bodies.add(body.error.message);
    }
    expect(bodies.size).toBeGreaterThanOrEqual(2);
  });

  it.each(ACTIONS)(
    "%s: a human wait, and no header or doc reference",
    async (action) => {
      const res = respondRateLimited(denied(action, 11_400));
      expect(res.status).toBe(429);
      const failure = await readWorkerError(res, "fallback");
      expect(failure.code).toBe("rate_limited");
      expect(failure.retryAfterSeconds).toBe(11_400);
      expect(failure.message).toContain("Try again in about 3 h 10 min.");
      expect(failure.message).not.toMatch(DEVELOPER_COPY);
      expect(failure.message).not.toMatch(/translated by someone else/i);
    },
  );

  it("positive control: the shipped sentences are caught by the predicate", () => {
    expect(
      "Too many requests. This endpoint is rate-limited to protect the service; retry after the interval in the Retry-After header. See docs/SECURITY.md.",
    ).toMatch(DEVELOPER_COPY);
    expect(
      "The allowance resets daily; retry after the interval in the Retry-After header.",
    ).toMatch(DEVELOPER_COPY);
  });

  it("no Retry-After header: the message stands, with no invented wait", async () => {
    const res = new Response(
      JSON.stringify({
        error: { code: "rate_limited", message: "Slow down." },
      }),
      { status: 429 },
    );
    const failure = await readWorkerError(res, "fallback");
    expect(failure.message).toBe("Slow down.");
    expect(failure.retryAfterSeconds).toBeUndefined();
  });
});

describe("describeWait rounds UP, so it never promises an early retry", () => {
  it.each([
    [1, "about 1 second"],
    [40, "about 40 seconds"],
    [60, "about 1 minute"],
    [61, "about 2 minutes"],
    [3600, "about 1 hour"],
    [11_400, "about 3 h 10 min"],
    [86_399, "about 24 hours"],
  ] as const)("%i s → %s", (seconds, words) => {
    expect(describeWait(seconds)).toBe(words);
  });
});

describe("the clients use the one reader", () => {
  /** A fetch stub whose FIRST call is a real 429 from the real builder. */
  const throttledFetch = (action: RateLimitAction): never =>
    (async () => respondRateLimited(denied(action, 125))) as never;

  it("compression client shows the wait", async () => {
    const result = await runWorkerCompression(
      { filename: "a.pdf", bytes: new Uint8Array([37, 80, 68, 70]) } as never,
      { fetchImpl: throttledFetch(ACTIONS[0]!) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.message).toContain("Try again in about 3 minutes.");
  });

  it("the shared runner (security, Office, HTML, AI tools) shows the wait", async () => {
    const result = await runWorkerUnlock(
      {
        filename: "a.pdf",
        bytes: new Uint8Array([37, 80, 68, 70]),
        password: "",
      },
      { fetchImpl: throttledFetch(ACTIONS[0]!) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.message).toContain("Try again in about 3 minutes.");
  });

  it("discovered: no worker client reads an error body except through readWorkerError", () => {
    const dir = path.join(ROOT, "src", "lib", "workers");
    const clients = readdirSync(dir).filter(
      (f) => /client\.ts$/.test(f) && !f.includes(".test."),
    );
    expect(clients.length).toBeGreaterThanOrEqual(4);
    const offenders = clients.filter((f) =>
      /\.error\.message/.test(
        withoutComments(readFileSync(path.join(dir, f), "utf8")),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
