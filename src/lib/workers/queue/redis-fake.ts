/**
 * A faithful **in-memory Redis** implementing exactly the command subset the
 * Redis queue provider uses (GET/SET/DEL, LPUSH/RPOP/LREM, ZADD/ZREM/
 * ZRANGEBYSCORE, MULTI/EXEC via `transaction`, and — since Phase 21 — `EVAL` of
 * the atomic transition scripts). It exists only for tests: the provider runs
 * against real Redis *semantics* while never touching a network, so `redis.test.ts`
 * and `adapter.test.ts` are true integration tests of the provider logic — the
 * exact analogue of the fake `fetch` the S3 provider tests use.
 *
 * `EVAL` support: rather than embed a Lua VM, the fake dispatches on the exact text
 * of the frozen {@link TRANSITION_SCRIPTS} constants to a JS **twin** of each
 * script, run to completion with no interleaving (the fake is single-threaded, so
 * this matches Redis's atomic script execution). The twins operate through the same
 * in-memory primitives as every other command, so they can never diverge in how a
 * SET/DEL/ZADD behaves — only the guard/effect *sequence* is transcribed, and the
 * behavioral + payload tests in `redis-scripts.test.ts`/`redis-atomic.test.ts` pin
 * that against the provider. Because dispatch is by constant text, a script whose
 * body changes without a matching twin update fails loudly (`unknown EVAL script`).
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
import { TRANSITION_SCRIPTS, type TransitionScriptName } from "./redis-scripts";

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

/** Reverse lookup from a script's exact text to its name, for `EVAL` dispatch. */
const SCRIPT_NAME_BY_TEXT = new Map<string, TransitionScriptName>(
  (Object.entries(TRANSITION_SCRIPTS) as [TransitionScriptName, string][]).map(
    ([name, text]) => [text, name],
  ),
);

export function createFakeRedis(): FakeRedis {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const zsets = new Map<string, Map<string, number>>();
  const calls: string[][] = [];

  // ── Primitive store operations, shared by both the command dispatcher and the
  // EVAL twins so they can never disagree on a SET/DEL/LPUSH/ZADD's semantics. ──
  const delAny = (key: string): boolean => {
    let existed = false;
    if (strings.delete(key)) existed = true;
    if (lists.delete(key)) existed = true;
    if (zsets.delete(key)) existed = true;
    return existed;
  };
  const del = (...keys: string[]): number => {
    let n = 0;
    for (const key of keys) if (delAny(key)) n++;
    return n;
  };
  const lpush = (key: string, ...values: string[]): number => {
    const list = lists.get(key) ?? [];
    for (const value of values) list.unshift(value);
    lists.set(key, list);
    return list.length;
  };
  const rpop = (key: string): string | null => {
    const list = lists.get(key);
    if (!list || list.length === 0) return null;
    return list.pop()!;
  };
  const lrem = (key: string, value: string): number => {
    const list = lists.get(key) ?? [];
    const kept = list.filter((x) => x !== value);
    lists.set(key, kept);
    return list.length - kept.length;
  };
  const zadd = (key: string, score: number, member: string): number => {
    const zset = zsets.get(key) ?? new Map<string, number>();
    const existed = zset.has(member);
    zset.set(member, score);
    zsets.set(key, zset);
    return existed ? 0 : 1;
  };
  const zrem = (key: string, ...members: string[]): number => {
    const zset = zsets.get(key);
    if (!zset) return 0;
    let n = 0;
    for (const member of members) if (zset.delete(member)) n++;
    return n;
  };
  const zrangebyscore = (key: string, min: number, max: number): string[] => {
    const zset = zsets.get(key);
    if (!zset) return [];
    return [...zset.entries()]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
  };

  /**
   * Execute one atomic transition script's JS twin. KEYS are the fixed positional
   * [job, spec, lease, ready, active]; ARGV is script-specific. Returns the Lua
   * status-code string the provider maps to an outcome. Kept in lock-step with the
   * Lua in `./redis-scripts.ts` — same guard order, same effects.
   */
  const runTwin = (
    name: TransitionScriptName,
    keys: string[],
    argv: string[],
  ): string => {
    const [jobKey, specKey, leaseKey, readyKey, activeKey] = keys as [
      string,
      string,
      string,
      string,
      string,
    ];
    const jobRaw = strings.get(jobKey);
    if (jobRaw === undefined) return "missing";
    const job = JSON.parse(jobRaw) as { status: string };
    const statusIn = (csv: string): boolean => csv.split(",").includes(job.status);
    const ownershipStale = (attemptArg: string): boolean => {
      if (attemptArg === "") return false;
      const leaseRaw = strings.get(leaseKey);
      if (leaseRaw === undefined) return true;
      const lease = JSON.parse(leaseRaw) as { attempts: number };
      return String(lease.attempts) !== attemptArg;
    };

    switch (name) {
      case "claimCommit": {
        // ARGV: [jobJson, ttl, leaseJson, leaseScore, jobId]
        if (job.status !== "queued") return "invalid";
        strings.set(jobKey, argv[0]!);
        strings.set(leaseKey, argv[2]!);
        zadd(activeKey, Number(argv[3]), argv[4]!);
        return "applied";
      }
      case "redeliver": {
        // ARGV: [jobJson, ttl, jobId]
        if (job.status !== "scanning" && job.status !== "processing") return "invalid";
        strings.set(jobKey, argv[0]!);
        lpush(readyKey, argv[2]!);
        return "applied";
      }
      case "heartbeat": {
        // ARGV: [leaseExpiresAt, expectedAttempt, ttl, jobId]
        if (job.status !== "scanning" && job.status !== "processing") return "invalid";
        const leaseRaw = strings.get(leaseKey);
        if (leaseRaw === undefined) return "stale";
        const lease = JSON.parse(leaseRaw) as {
          attempts: number;
          leaseExpiresAt: number;
        };
        if (argv[1] !== "" && String(lease.attempts) !== argv[1]) return "stale";
        lease.leaseExpiresAt = Number(argv[0]);
        strings.set(leaseKey, JSON.stringify(lease));
        zadd(activeKey, Number(argv[0]), argv[3]!);
        return "applied";
      }
      case "advance": {
        // ARGV: [jobJson, ttl, expectedAttempt, allowedCsv]
        if (!statusIn(argv[3]!)) return "invalid";
        if (ownershipStale(argv[2]!)) return "stale";
        strings.set(jobKey, argv[0]!);
        return "applied";
      }
      case "finalize": {
        // ARGV: [jobJson, ttl, expectedAttempt, allowedCsv, jobId]
        if (!statusIn(argv[3]!)) return "invalid";
        if (ownershipStale(argv[2]!)) return "stale";
        strings.set(jobKey, argv[0]!);
        del(specKey);
        del(leaseKey);
        lrem(readyKey, argv[4]!);
        zrem(activeKey, argv[4]!);
        return "applied";
      }
      case "requeue": {
        // ARGV: [jobJson, ttl, expectedAttempt, allowedCsv, jobId]
        if (!statusIn(argv[3]!)) return "invalid";
        if (ownershipStale(argv[2]!)) return "stale";
        strings.set(jobKey, argv[0]!);
        lpush(readyKey, argv[4]!);
        zrem(activeKey, argv[4]!);
        return "applied";
      }
    }
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
      case "DEL":
        return del(...rest);
      case "LPUSH":
        return lpush(rest[0]!, ...rest.slice(1));
      case "RPOP":
        return rpop(rest[0]!);
      case "LREM":
        return lrem(rest[0]!, rest[2]!);
      case "ZADD":
        return zadd(rest[0]!, Number(rest[1]), rest[2]!);
      case "ZREM":
        return zrem(rest[0]!, ...rest.slice(1));
      case "ZRANGEBYSCORE":
        return zrangebyscore(rest[0]!, parseScore(rest[1]!), parseScore(rest[2]!));
      case "EVAL": {
        // ["EVAL", script, numkeys, key1.., arg1..] — run the matching twin atomically.
        const script = rest[0]!;
        const numkeys = Number(rest[1]);
        const keys = rest.slice(2, 2 + numkeys);
        const argv = rest.slice(2 + numkeys);
        const name = SCRIPT_NAME_BY_TEXT.get(script);
        if (!name) throw new Error("fake-redis: unknown EVAL script");
        return runTwin(name, keys, argv);
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
