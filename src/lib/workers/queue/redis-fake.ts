/**
 * A faithful **in-memory Redis** implementing exactly the command subset the
 * Redis queue provider uses (GET/SET/DEL, LPUSH/RPOP/LREM, ZADD/ZREM/
 * ZRANGEBYSCORE, and MULTI/EXEC via `transaction`). It exists only for tests: the
 * provider runs against real Redis *semantics* while never touching a network, so
 * `redis.test.ts` and `adapter.test.ts` are true integration tests of the provider
 * logic — the exact analogue of the fake `fetch` the S3 provider tests use.
 *
 * It is NOT a `*.test.ts` file (so vitest does not collect it) and is imported
 * only by tests, so it is never bundled into the app.
 */

import type {
  RedisArg,
  RedisClient,
  RedisResult,
  RedisValue,
} from "./redis-client";

/** A recording, in-memory Redis client plus test-only inspection helpers. */
export interface FakeRedis extends RedisClient {
  /** Every command run, flattened (transaction sub-commands included), as strings. */
  readonly calls: string[][];
  /** All live key names, for asserting prefixes and that no raw user key is used. */
  keys(): string[];
  /** When `true`, every command/transaction returns a transport failure. */
  failing: boolean;
}

function parseScore(raw: string): number {
  if (raw === "-inf" || raw === "-Infinity") return -Infinity;
  if (raw === "+inf" || raw === "inf" || raw === "+Infinity") return Infinity;
  return Number(raw);
}

export function createFakeRedis(): FakeRedis {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const zsets = new Map<string, Map<string, number>>();
  const calls: string[][] = [];

  const delAny = (key: string): boolean => {
    let existed = false;
    if (strings.delete(key)) existed = true;
    if (lists.delete(key)) existed = true;
    if (zsets.delete(key)) existed = true;
    return existed;
  };

  /** Execute one already-stringified command against the in-memory store. */
  const exec = (args: string[]): RedisValue => {
    const [cmdRaw, ...rest] = args;
    const cmd = (cmdRaw ?? "").toUpperCase();
    switch (cmd) {
      case "GET":
        return strings.get(rest[0]!) ?? null;
      case "SET":
        strings.set(rest[0]!, rest[1]!); // EX/args beyond value are recorded, not enforced
        return "OK";
      case "DEL": {
        let n = 0;
        for (const key of rest) if (delAny(key)) n++;
        return n;
      }
      case "LPUSH": {
        const list = lists.get(rest[0]!) ?? [];
        for (let i = 1; i < rest.length; i++) list.unshift(rest[i]!);
        lists.set(rest[0]!, list);
        return list.length;
      }
      case "RPOP": {
        const list = lists.get(rest[0]!);
        if (!list || list.length === 0) return null;
        return list.pop()!;
      }
      case "LREM": {
        const list = lists.get(rest[0]!) ?? [];
        const value = rest[2]!;
        const kept = list.filter((x) => x !== value);
        lists.set(rest[0]!, kept);
        return list.length - kept.length;
      }
      case "ZADD": {
        const zset = zsets.get(rest[0]!) ?? new Map<string, number>();
        const existed = zset.has(rest[2]!);
        zset.set(rest[2]!, Number(rest[1]));
        zsets.set(rest[0]!, zset);
        return existed ? 0 : 1;
      }
      case "ZREM": {
        const zset = zsets.get(rest[0]!);
        if (!zset) return 0;
        let n = 0;
        for (let i = 1; i < rest.length; i++) if (zset.delete(rest[i]!)) n++;
        return n;
      }
      case "ZRANGEBYSCORE": {
        const zset = zsets.get(rest[0]!);
        if (!zset) return [];
        const min = parseScore(rest[1]!);
        const max = parseScore(rest[2]!);
        return [...zset.entries()]
          .filter(([, score]) => score >= min && score <= max)
          .sort((a, b) => a[1] - b[1])
          .map(([member]) => member);
      }
      default:
        throw new Error(`fake-redis: unsupported command ${cmd}`);
    }
  };

  const fake: FakeRedis = {
    calls,
    failing: false,
    keys() {
      return [...strings.keys(), ...lists.keys(), ...zsets.keys()];
    },
    async command(args: RedisArg[]): Promise<RedisResult<RedisValue>> {
      const strArgs = args.map(String);
      calls.push(strArgs);
      if (fake.failing) return { ok: false, error: "unreachable" };
      return { ok: true, value: exec(strArgs) };
    },
    async transaction(commands: RedisArg[][]): Promise<RedisResult<RedisValue[]>> {
      const strCommands = commands.map((cmd) => cmd.map(String));
      for (const cmd of strCommands) calls.push(cmd);
      if (fake.failing) return { ok: false, error: "unreachable" };
      // MULTI/EXEC is atomic; a single-threaded fake runs them in order.
      return { ok: true, value: strCommands.map(exec) };
    },
  };
  return fake;
}
