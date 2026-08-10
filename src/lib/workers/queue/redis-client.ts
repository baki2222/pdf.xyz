/**
 * A minimal, typed **Redis REST** transport (Upstash Redis REST and compatible
 * HTTP gateways) — the queue counterpart of the S3 signer: the one place that
 * actually speaks to the broker over the network.
 *
 * The REST protocol is simple: a command is a JSON array of arguments POSTed to
 * the base URL (`["SET","k","v","EX","60"]`), authenticated with a bearer token,
 * and the reply is `{ "result": … }` or `{ "error": … }`. A transaction posts an
 * array of such commands to `/multi-exec` and runs them atomically (MULTI/EXEC),
 * returning one reply per command. That is the entire surface this client needs.
 *
 * Security posture: the token is sent only as the `Authorization` header and is
 * **never** placed in a URL, a thrown error, or a returned value. Every failure —
 * a network error, a non-2xx status, a malformed body, or a Redis-level error —
 * collapses to a typed `{ ok: false }` with a short, secret-free reason, which the
 * provider maps to an honest `unavailable`. The transport is injectable, so tests
 * drive it with an in-memory fake and never touch a real network.
 */

/** A Redis reply value: RESP types map to these JSON shapes over REST. */
export type RedisValue = string | number | null | RedisValue[];

/** A command argument. Numbers are stringified (Redis values are bulk strings). */
export type RedisArg = string | number;

/** A typed transport result: a value, or a secret-free failure reason. */
export type RedisResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

/**
 * The minimal HTTP response shape the client needs — deliberately not the DOM
 * `Response` type, so tests inject a stub without the DOM lib and the module
 * never assumes a browser `fetch`.
 */
export interface RedisHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface RedisRequestInit {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** Transport for a REST command; defaults to the global `fetch`. */
export type RedisFetch = (
  url: string,
  init: RedisRequestInit,
) => Promise<RedisHttpResponse>;

export interface RedisClientOptions {
  baseUrl: string;
  /** SECRET — the bearer token. Sent only as a header; never logged or returned. */
  token: string;
  fetchImpl?: RedisFetch;
}

/** The typed Redis command surface the queue provider is built on. */
export interface RedisClient {
  /** Run one command and return its reply. */
  command(args: RedisArg[]): Promise<RedisResult<RedisValue>>;
  /** Run commands atomically (MULTI/EXEC); returns one reply per command. */
  transaction(commands: RedisArg[][]): Promise<RedisResult<RedisValue[]>>;
}

/** One `{ result } | { error }` envelope from the REST API. */
interface RedisEnvelope {
  result?: RedisValue;
  error?: string;
}

const defaultFetch: RedisFetch = (url, init) =>
  fetch(url, init) as unknown as Promise<RedisHttpResponse>;

function isEnvelope(value: unknown): value is RedisEnvelope {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Build the Redis REST client. `baseUrl`/`token` come from the parsed config. */
export function createRedisClient(options: RedisClientOptions): RedisClient {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const headers = {
    // Header only — the token never appears in a URL or a returned value.
    authorization: `Bearer ${options.token}`,
    "content-type": "application/json",
  } as const;

  /** POST a JSON body to a sub-path and return the parsed JSON, or a failure. */
  async function post(
    path: string,
    body: unknown,
  ): Promise<RedisResult<unknown>> {
    let res: RedisHttpResponse;
    try {
      res = await fetchImpl(`${options.baseUrl}${path}`, {
        method: "POST",
        headers: { ...headers },
        body: JSON.stringify(body),
      });
    } catch {
      // Network error / DNS / connection refused. Never surface the cause.
      return { ok: false, error: "unreachable" };
    }
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    try {
      return { ok: true, value: await res.json() };
    } catch {
      return { ok: false, error: "malformed_response" };
    }
  }

  return {
    async command(args) {
      const res = await post("", args.map(String));
      if (!res.ok) return res;
      if (!isEnvelope(res.value))
        return { ok: false, error: "malformed_response" };
      if (res.value.error) return { ok: false, error: "command_error" };
      return { ok: true, value: res.value.result ?? null };
    },

    async transaction(commands) {
      const res = await post(
        "/multi-exec",
        commands.map((cmd) => cmd.map(String)),
      );
      if (!res.ok) return res;
      // A top-level error means the whole transaction was rejected.
      if (isEnvelope(res.value) && res.value.error) {
        return { ok: false, error: "transaction_error" };
      }
      if (!Array.isArray(res.value)) {
        return { ok: false, error: "malformed_response" };
      }
      const values: RedisValue[] = [];
      for (const item of res.value) {
        if (!isEnvelope(item))
          return { ok: false, error: "malformed_response" };
        if (item.error) return { ok: false, error: "transaction_error" };
        values.push(item.result ?? null);
      }
      return { ok: true, value: values };
    },
  };
}
