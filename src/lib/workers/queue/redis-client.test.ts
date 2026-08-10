// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createRedisClient,
  type RedisFetch,
  type RedisHttpResponse,
} from "./redis-client";

const BASE = "https://us1-example-12345.upstash.io";
const TOKEN = "AX_tokenEXAMPLEvalue000000000000000000000";

interface Recorded {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

/** A recording fake transport that replays canned JSON bodies. */
function fakeFetch(
  replies: Array<{
    ok?: boolean;
    status?: number;
    body: unknown;
    throws?: boolean;
  }>,
) {
  const calls: Recorded[] = [];
  let i = 0;
  const fn: RedisFetch = async (url, init) => {
    calls.push({ url, init });
    const reply = replies[Math.min(i++, replies.length - 1)]!;
    if (reply.throws) throw new Error("network down");
    const res: RedisHttpResponse = {
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      async json() {
        return reply.body;
      },
    };
    return res;
  };
  return { fn, calls };
}

function client(fn: RedisFetch) {
  return createRedisClient({ baseUrl: BASE, token: TOKEN, fetchImpl: fn });
}

describe("createRedisClient — command", () => {
  it("POSTs to the base url, authorizes via header, and returns the result", async () => {
    const { fn, calls } = fakeFetch([{ body: { result: "OK" } }]);
    const res = await client(fn).command(["SET", "k", "v", "EX", 60]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBe("OK");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(BASE);
    // The token travels in the Authorization header — never in the URL.
    expect(calls[0]!.init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.url).not.toContain(TOKEN);
    // Args are sent as a JSON array of strings (numbers stringified).
    expect(JSON.parse(calls[0]!.init.body)).toEqual([
      "SET",
      "k",
      "v",
      "EX",
      "60",
    ]);
  });

  it("maps a null result and a numeric result faithfully", async () => {
    const nul = await client(
      fakeFetch([{ body: { result: null } }]).fn,
    ).command(["GET", "k"]);
    expect(nul.ok && nul.value).toBeNull();
    const num = await client(fakeFetch([{ body: { result: 1 } }]).fn).command([
      "ZREM",
      "z",
      "m",
    ]);
    expect(num.ok && num.value).toBe(1);
  });

  it("fails on a Redis-level command error", async () => {
    const { fn } = fakeFetch([{ body: { error: "WRONGTYPE" } }]);
    const res = await client(fn).command(["GET", "k"]);
    expect(res.ok).toBe(false);
  });

  it("fails on a non-2xx status without leaking the token", async () => {
    const { fn } = fakeFetch([{ ok: false, status: 401, body: {} }]);
    const res = await client(fn).command(["GET", "k"]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).not.toContain(TOKEN);
  });

  it("fails when the network throws", async () => {
    const { fn } = fakeFetch([{ throws: true, body: {} }]);
    const res = await client(fn).command(["GET", "k"]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("unreachable");
  });

  it("fails on a malformed (non-envelope) response", async () => {
    const { fn } = fakeFetch([{ body: [1, 2, 3] }]);
    const res = await client(fn).command(["GET", "k"]);
    expect(res.ok).toBe(false);
  });
});

describe("createRedisClient — transaction", () => {
  it("POSTs commands to /multi-exec and returns one result per command", async () => {
    const { fn, calls } = fakeFetch([
      { body: [{ result: "OK" }, { result: "OK" }, { result: 1 }] },
    ]);
    const res = await client(fn).transaction([
      ["SET", "job", "{}", "EX", 60],
      ["SET", "spec", "{}", "EX", 60],
      ["LPUSH", "ready", "job_1"],
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual(["OK", "OK", 1]);
    expect(calls[0]!.url).toBe(`${BASE}/multi-exec`);
    expect(JSON.parse(calls[0]!.init.body)).toEqual([
      ["SET", "job", "{}", "EX", "60"],
      ["SET", "spec", "{}", "EX", "60"],
      ["LPUSH", "ready", "job_1"],
    ]);
  });

  it("fails when any queued command errors", async () => {
    const { fn } = fakeFetch([{ body: [{ result: "OK" }, { error: "ERR" }] }]);
    const res = await client(fn).transaction([
      ["SET", "a", "1"],
      ["INCR", "a"],
    ]);
    expect(res.ok).toBe(false);
  });

  it("fails when the whole transaction is rejected (top-level error)", async () => {
    const { fn } = fakeFetch([{ body: { error: "EXECABORT" } }]);
    const res = await client(fn).transaction([["SET", "a", "1"]]);
    expect(res.ok).toBe(false);
  });
});
