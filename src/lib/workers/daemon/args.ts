/**
 * Pure, node-free parser for the worker-daemon CLI arguments.
 *
 * It maps `process.argv` flags to a validated {@link DaemonArgs} — the run mode
 * and its bounded knobs — with no side effects, no environment reads, and no I/O,
 * so every branch (including malformed input and `--help`) is unit-tested
 * deterministically. The CLI entry (`scripts/worker-daemon.ts`) is the only place
 * that reads the real `argv`, prints {@link DAEMON_USAGE}, and exits.
 */

import { isLifecycleProvider, LIFECYCLE_PROVIDERS, type LifecycleProvider } from "../lifecycle";

/** How the daemon runs one invocation. */
export type DaemonMode =
  | "loop" // long-running: keep polling, sleeping when the queue is idle
  | "once" // claim/run at most one job, then exit (smoke test)
  | "drain" // run until the queue is idle (or the tick cap), then exit
  | "dry-run-status" // resolve + report readiness only; never claim a job
  | "check" // evaluate deployment guardrails only; never claim a job
  | "lifecycle-policy" // generate + print a lifecycle policy; never claim a job
  | "lifecycle-verify"; // verify a generated policy against an observed config; claim nothing

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
  /** `lifecycle-policy`: which provider to render for; `undefined` ⇒ generic. */
  lifecycleProvider?: LifecycleProvider;
  /** `lifecycle-policy`: optional structural key prefix every rule nests under. */
  keyPrefix?: string;
  /** `lifecycle-policy`/`lifecycle-verify`: render/expect the versioned-bucket rules. */
  versioned?: boolean;
  /**
   * `lifecycle-verify`: path to the observed lifecycle document an operator exported
   * out-of-band (e.g. `s3api get-bucket-lifecycle-configuration`). Absent ⇒ nothing to
   * verify against, so the CLI reports an honest not-configured. The path is the
   * operator's own file reference and is never logged.
   */
  observedPath?: string;
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

/** The mutually-exclusive mode flags (default is `loop`). */
const MODE_FLAGS: Record<string, DaemonMode> = {
  "--once": "once",
  "--drain": "drain",
  "--dry-run-status": "dry-run-status",
  "--check": "check",
  "--lifecycle-policy": "lifecycle-policy",
  "--lifecycle-verify": "lifecycle-verify",
  "--loop": "loop",
};

/** A structural key prefix: relative, no traversal, path-safe characters only. */
const KEY_PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/;

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
  --dry-run-status      Report provider/daemon/deployment readiness and exit.
  --check               Evaluate deployment guardrails and exit. Claims nothing.
  --lifecycle-policy    Generate + print a lifecycle/retention policy and exit.
  --lifecycle-verify    Verify a generated policy against an observed bucket config.

Options:
  --max-ticks=<n>       Cap total ticks for --loop/--drain (1..1000000).
  --idle-sleep-ms=<ms>  --loop sleep after an idle tick (0..3600000; default 1000).
  --lease-ms=<ms>       Lease requested per claimed job (1000..3600000).
  --provider=<name>     --lifecycle-policy/--lifecycle-verify target: ${LIFECYCLE_PROVIDERS.join(" | ")}.
  --key-prefix=<p>      --lifecycle-policy/--lifecycle-verify: structural key prefix rules nest under.
  --versioned           --lifecycle-policy/--lifecycle-verify: also expect versioned-bucket rules.
  --observed=<path>     --lifecycle-verify: path to the lifecycle config an operator
                        exported out-of-band (e.g. s3api get-bucket-lifecycle-configuration).
                        Absent ⇒ nothing to verify against (honest not-configured, exit 2).
  -h, --help            Show this help.

--lifecycle-verify compares the policy the app WOULD generate against the observed
document you supply; the app never reads the bucket itself. It exits:
  0  verified   — every generated backstop is enforced at least as strongly
  2  unknown    — no --observed document was supplied (nothing to verify)
  4  invalid    — drift detected, or the observed document is malformed

Exit codes:
  0  clean exit (work done, drained, readiness/policy reported, guardrails clean)
  1  usage error
  2  not configured to run (no drainable queue + storage, or nothing to verify)
  3  runtime error (the queue could not be reached)
  4  guardrail violation, or lifecycle drift/invalid observed document`;

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
  let lifecycleProvider: LifecycleProvider | undefined;
  let keyPrefix: string | undefined;
  let versioned: boolean | undefined;
  let observedPath: string | undefined;

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
      case "--provider": {
        const value = takeValue();
        if (value === undefined || value === "") {
          return { ok: false, message: `${name} requires a value.` };
        }
        const lower = value.toLowerCase();
        if (!isLifecycleProvider(lower)) {
          return {
            ok: false,
            message: `${name} must be one of: ${LIFECYCLE_PROVIDERS.join(", ")}.`,
          };
        }
        lifecycleProvider = lower;
        break;
      }
      case "--key-prefix": {
        const value = takeValue();
        if (value === undefined || value === "") {
          return { ok: false, message: `${name} requires a value.` };
        }
        if (value.includes("..") || !KEY_PREFIX_RE.test(value)) {
          return {
            ok: false,
            message: `${name} must be a safe relative prefix (no '..', no leading slash).`,
          };
        }
        keyPrefix = value;
        break;
      }
      case "--versioned": {
        // A bare flag means true; an inline value may override (--versioned=false).
        if (inlineValue === undefined) {
          versioned = true;
        } else if (inlineValue === "true" || inlineValue === "false") {
          versioned = inlineValue === "true";
        } else {
          return { ok: false, message: `${name} must be true or false.` };
        }
        break;
      }
      case "--observed": {
        // A filesystem path to the operator's exported lifecycle document. Its only
        // constraint is being non-empty; it is the operator's own file reference (never
        // logged), and the CLI reads it defensively (bounded, content-free on error).
        const value = takeValue();
        if (value === undefined || value === "") {
          return { ok: false, message: `${name} requires a value.` };
        }
        observedPath = value;
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
      ...(lifecycleProvider !== undefined ? { lifecycleProvider } : {}),
      ...(keyPrefix !== undefined ? { keyPrefix } : {}),
      ...(versioned !== undefined ? { versioned } : {}),
      ...(observedPath !== undefined ? { observedPath } : {}),
    },
  };
}
