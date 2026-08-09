// @vitest-environment node
/**
 * Proofs for the interest counter's abuse + honesty posture, per the ruling:
 * the endpoint rejects an unknown slug and can never write an arbitrary key
 * (the catalogue is the allowlist, and the stored key is derived from the
 * catalogue's copy of the slug); a failing or missing store never surfaces an
 * error to the user (fail open, 202 regardless) but is NOT silent to the
 * operator (the throttled warn line); and the endpoint reveals nothing back.
 *
 * These import the new route, so they cannot fail on pre-fix `main` — the
 * behavioural fails-on-main proof for this feature lives in
 * `notify-me.test.tsx` ("the click sends the interest beacon"), which ran red
 * against the unmodified component before this route existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import { RATE_LIMIT_REDIS_ENV } from "@/lib/ratelimit/redis-config";
import {
  enforceRateLimit,
  resetRateLimitGuardForTests,
  resetSelfBuiltProviderForTests,
} from "@/lib/ratelimit/guard";
import { policyFor } from "@/lib/ratelimit";
import { resetInterestFailOpenLogForTests } from "@/lib/interest/store";
import { POST } from "./route";

const OLD_ENV = { ...process.env };
const OLD_FETCH = globalThis.fetch;

/** Only the STORE credentials — the guard's provider stays unset (disabled),
 *  so every stubbed fetch in these tests belongs to the counter alone. */
const STORE_ENV: Record<string, string> = {
  [RATE_LIMIT_REDIS_ENV.restUrl]: "https://example-store.upstash.io",
  [RATE_LIMIT_REDIS_ENV.restToken]: "A".repeat(48),
};

function interestReq(body: unknown): Request {
  return new Request("http://localhost/api/interest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimitGuardForTests();
  resetSelfBuiltProviderForTests();
  resetInterestFailOpenLogForTests();
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  globalThis.fetch = OLD_FETCH;
  resetRateLimitGuardForTests();
  resetSelfBuiltProviderForTests();
  vi.restoreAllMocks();
});

describe("POST /api/interest — the write path", () => {
  it("counts a catalogue slug: one INCR on the namespaced per-slug key, 202, no count echoed", async () => {
    Object.assign(process.env, STORE_ENV);
    const commands: unknown[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      commands.push(JSON.parse(String(init?.body)));
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: 1 };
        },
      };
    }) as unknown as typeof fetch;

    const res = await POST(interestReq({ slug: "chat-with-pdf" }));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ noted: true });
    // Exactly one store write: INCR on the interest-namespaced catalogue key.
    expect(commands).toEqual([["INCR", "pdfxyz:interest:chat-with-pdf"]]);
  });

  it("rejects an unknown slug with a content-free 400 and touches the store not at all", async () => {
    Object.assign(process.env, STORE_ENV);
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      throw new Error("must not be called");
    }) as unknown as typeof fetch;

    const res = await POST(interestReq({ slug: "not-a-real-tool" }));

    expect(res.status).toBe(400);
    expect(fetched).toBe(0);
    // The offending string is never echoed back.
    expect(JSON.stringify(await res.json())).not.toContain("not-a-real-tool");
  });

  it("cannot be used to write an arbitrary key — a key-shaped slug is rejected, not joined", async () => {
    Object.assign(process.env, STORE_ENV);
    const commands: unknown[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      commands.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, async json() { return { result: 1 }; } };
    }) as unknown as typeof fetch;

    for (const hostile of [
      "merge-pdf:extra:segments",
      "../../workspace",
      "merge-pdf\nratelimit",
      "*",
      "",
      42,
      { slug: "merge-pdf" },
      null,
    ]) {
      const res = await POST(interestReq({ slug: hostile }));
      expect(res.status, JSON.stringify(hostile)).toBe(400);
    }
    expect(commands).toEqual([]);
  });

  it("a failing store never surfaces to the user — 202 either way — but warns the operator once", async () => {
    Object.assign(process.env, STORE_ENV);
    globalThis.fetch = (async () => {
      throw new Error("store unreachable");
    }) as unknown as typeof fetch;
    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warned.push(args.join(" "));
    });

    const first = await POST(interestReq({ slug: "chat-with-pdf" }));
    const second = await POST(interestReq({ slug: "merge-pdf" }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await first.json()).toEqual({ noted: true });
    // Silent to the user, never to the operator — and throttled, not per-request.
    const failOpenLines = warned.filter((w) => w.includes("FAILING OPEN"));
    expect(failOpenLines).toHaveLength(1);
    expect(failOpenLines[0]).toContain("clicks are not being counted");
    // Content-free: no endpoint, token, or slug in the line.
    expect(failOpenLines[0]).not.toMatch(/upstash|AAAA|chat-with-pdf/);
  });

  it("no store configured (the default) is a quiet no-op: 202, no fetch, no warn", async () => {
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    const warned: unknown[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args) => {
      warned.push(args);
    });

    const res = await POST(interestReq({ slug: "chat-with-pdf" }));

    expect(res.status).toBe(202);
    expect(fetched).toBe(0);
    expect(warned).toEqual([]);
  });

  it("is guarded: the interest.note budget produces a content-free 429 before the body is read", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    const policy = policyFor("interest.note");
    const bare = new Request("http://localhost/api/interest", { method: "POST" });
    for (let i = 0; i < policy.limit; i++) {
      await enforceRateLimit("interest.note", bare);
    }

    const denied = await POST(interestReq({ slug: "chat-with-pdf" }));

    expect(denied.status).toBe(429);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe(
      "rate_limited",
    );
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("a malformed body is a content-free 400, never a store write", async () => {
    Object.assign(process.env, STORE_ENV);
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      throw new Error("must not be called");
    }) as unknown as typeof fetch;

    const res = await POST(
      new Request("http://localhost/api/interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );

    expect(res.status).toBe(400);
    expect(fetched).toBe(0);
  });
});
