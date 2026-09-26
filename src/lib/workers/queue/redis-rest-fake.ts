/**
 * The Upstash REST wire in front of {@link createFakeRedis}, for tests that
 * drive a REAL route handler.
 *
 * A route builds its own adapter from `process.env` and the global `fetch`, so
 * the only seam that reaches it without `vi.mock` is the transport — and the
 * suite runs `isolate: false`, where a mocked `@/lib/workers` once leaked a
 * fake adapter into three unrelated files (see `delivery-cap.chain.test.ts`).
 * Stub `fetch` with this and the real Redis queue provider runs, over the real
 * REST client, against the faithful in-memory Redis.
 *
 * Any request to another origin is refused loudly rather than passed through:
 * a test that reached the network would be testing something else.
 *
 * Not a `*.test.ts` file, imported only by tests, never bundled.
 */
import type { FakeRedis } from "./redis-fake";
import type { RedisArg } from "./redis-client";

export function redisRestFetch(
  fake: FakeRedis,
  baseUrl: string,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.startsWith(baseUrl)) {
      throw new Error(`redisRestFetch: unexpected request to ${url}`);
    }
    const path = url.slice(baseUrl.length);
    const body = JSON.parse(String(init?.body ?? "null")) as unknown;
    if (path === "" || path === "/") {
      const res = await fake.command(body as RedisArg[]);
      return Response.json(
        res.ok ? { result: res.value } : { error: res.error },
      );
    }
    if (path === "/multi-exec") {
      const res = await fake.transaction(body as RedisArg[][]);
      return Response.json(
        res.ok ? res.value.map((result) => ({ result })) : { error: res.error },
      );
    }
    throw new Error(`redisRestFetch: unsupported path ${path}`);
  };
}
