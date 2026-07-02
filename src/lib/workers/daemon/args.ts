/**
 * Pure, node-free parser for the worker-daemon CLI arguments.
 *
 * It maps `process.argv` flags to a validated {@link DaemonArgs} — the run mode
 * and its bounded knobs — with no side effects, no environment reads, and no I/O,
 * so every branch (including malformed input and `--help`) is unit-tested
 * deterministically. The CLI entry (`scripts/worker-daemon.ts`) is the only place
 * that reads the real `argv`, prints {@link DAEMON_USAGE}, and exits.
 */

/** How the daemon runs one invocation. */
export type DaemonMode =
  | "loop" // long-running: keep polling, sleeping when the queue is idle
  | "once" // claim/run at most one job, then exit (smoke test)
  | "drain" // run until the queue is idle (or the tick cap), then exit
  | "dry-run-status"; // resolve + report readiness only; never claim a job

/** The validated arguments the CLI hands to the runtime + daemon. */
export interface DaemonArgs {
  mode: DaemonMode;
  /**
   * Hard cap on total ticks for `loop`/`drain`. `undefined` means unbounded for
   * `loop` and "use the executor's default drain cap" for `drain`.
   */
  maxTicks?: number;
  /** `loop`: milliseconds to sleep after an idle/error tick before re-polling. */
  idleSleepMs: number;
  /** Lease duration (ms) requested per claim; `undefined` uses the executor default. */
  leaseMs?: number;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseArgsResult =
  | { ok: true; kind: "run"; args: DaemonArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

export const DEFAULT_IDLE_SLEEP_MS = 1_000;
const MIN_IDLE_SLEEP_MS = 0;
const MAX_IDLE_SLEEP_MS = 3_600_000; // 1h — a generous upper bound.
const MIN_MAX_TICKS = 1;
const MAX_MAX_TICKS = 1_000_000;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 3_600_000; // 1h — matches the queue's lease ceiling.

/** The three mutually-exclusive mode flags (default is `loop`). */
const MODE_FLAGS: Record<string, DaemonMode> = {
  "--once": "once",
  "--drain": "drain",
  "--dry-run-status": "dry-run-status",
  "--loop": "loop",
};

/** Human-readable usage, printed by the CLI on `--help` or a parse error. */
export const DAEMON_USAGE = `pdf.xyz secure-worker daemon

Drains the configured job queue, runs the registered processors against the
configured object storage, and drives each job to an honest terminal state.
Reads provider configuration from the environment (never printed or logged).

Usage:
  pnpm worker:daemon [options]

Modes (choose at most one; default: --loop):
  --loop                Run continuously, sleeping when the queue is idle.
  --drain               Run until the queue is idle, then exit.
  --once                Claim and run at most one job, then exit.
  --dry-run-status      Report provider/daemon readiness and exit. Claims nothing.

Options:
  --max-ticks=<n>       Cap total ticks for --loop/--drain (1..1000000).
  --idle-sleep-ms=<ms>  --loop sleep after an idle tick (0..3600000; default 1000).
  --lease-ms=<ms>       Lease requested per claimed job (1000..3600000).
  -h, --help            Show this help.

Exit codes:
  0  clean exit (work done, drained, or readiness reported)
  1  usage error
  2  not configured to run (no drainable queue + storage in this environment)
  3  runtime error (the queue could not be reached)`;

/** Split `--flag=value` / `--flag value` into a name and an optional inline value. */
interface Flag {
  name: string;
  inlineValue?: string;
}

function toFlag(token: string): Flag {
  const eq = token.indexOf("=");
  return eq === -1
    ? { name: token }
    : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Parse a bounded integer from a flag value, or return an error message. */
function parseBoundedInt(
  flagName: string,
  raw: string | undefined,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false; message: string } {
  if (raw === undefined || raw === "") {
    return { ok: false, message: `${flagName} requires a value.` };
  }
  if (!/^\d{1,10}$/.test(raw)) {
    return { ok: false, message: `${flagName} must be a non-negative integer.` };
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return { ok: false, message: `${flagName} must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

/**
 * Parse the worker-daemon argv (already sliced past `node script`). Deterministic
 * and side-effect-free: it validates flags, rejects conflicting modes and
 * malformed values, and never reads the environment.
 */
export function parseDaemonArgs(argv: readonly string[]): ParseArgsResult {
  let mode: DaemonMode | undefined;
  let maxTicks: number | undefined;
  let idleSleepMs = DEFAULT_IDLE_SLEEP_MS;
  let leaseMs: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") {
      return { ok: true, kind: "help" };
    }

    // A value flag reads its inline `=value` or the next argv token.
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) return undefined;
      i += 1;
      return next;
    };

    if (name in MODE_FLAGS) {
      const nextMode = MODE_FLAGS[name]!;
      if (mode !== undefined && mode !== nextMode) {
        return {
          ok: false,
          message: `Conflicting modes: --${mode} and ${name} cannot be combined.`,
        };
      }
      mode = nextMode;
      continue;
    }

    switch (name) {
      case "--max-ticks": {
        const parsed = parseBoundedInt(name, takeValue(), MIN_MAX_TICKS, MAX_MAX_TICKS);
        if (!parsed.ok) return parsed;
        maxTicks = parsed.value;
        break;
      }
      case "--idle-sleep-ms": {
        const parsed = parseBoundedInt(
          name,
          takeValue(),
          MIN_IDLE_SLEEP_MS,
          MAX_IDLE_SLEEP_MS,
        );
        if (!parsed.ok) return parsed;
        idleSleepMs = parsed.value;
        break;
      }
      case "--lease-ms": {
        const parsed = parseBoundedInt(name, takeValue(), MIN_LEASE_MS, MAX_LEASE_MS);
        if (!parsed.ok) return parsed;
        leaseMs = parsed.value;
        break;
      }
      default:
        return { ok: false, message: `Unknown option: ${name}` };
    }
  }

  return {
    ok: true,
    kind: "run",
    args: {
      mode: mode ?? "loop",
      ...(maxTicks !== undefined ? { maxTicks } : {}),
      idleSleepMs,
      ...(leaseMs !== undefined ? { leaseMs } : {}),
    },
  };
}
