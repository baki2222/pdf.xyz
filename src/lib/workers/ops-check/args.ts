/**
 * Pure, node-free parser for the operator healthcheck CLI (`pnpm worker:ops-check`).
 *
 * Like the daemon's parser, it maps `process.argv` to a validated {@link OpsCheckArgs}
 * with no side effects, environment reads, or I/O, so every branch (including
 * malformed input and `--help`) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-ops-check.ts`) is the only place that reads the real `argv`, prints
 * {@link OPS_CHECK_USAGE}, reads stdin/files, and exits.
 */

/** Where the snapshot to evaluate comes from. */
export type OpsCheckSource = "runtime" | "web" | "stdin" | "file";

/** How the result is rendered. */
export type OpsCheckFormat = "json" | "prometheus" | "text";

/** The validated arguments the CLI hands to the runner. */
export interface OpsCheckArgs {
  /** Snapshot source (default `runtime`). */
  source: OpsCheckSource;
  /** Present iff `source === "file"`: the operator's own file reference (never logged). */
  filePath?: string;
  /** Output format (default `json`). */
  format: OpsCheckFormat;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseOpsCheckArgsResult =
  | { ok: true; kind: "run"; args: OpsCheckArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Source selector flags (mutually exclusive; default `runtime`). */
const SOURCE_FLAGS: Record<string, OpsCheckSource> = {
  "--runtime": "runtime",
  "--web": "web",
  "--stdin": "stdin",
};

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, OpsCheckFormat> = {
  "--json": "json",
  "--prometheus": "prometheus",
  "--text": "text",
};

/** Human-readable usage, printed on `--help` or a parse error. */
export const OPS_CHECK_USAGE = `pdf.xyz secure-worker operations healthcheck

Evaluates the SAME content-free runtime operations evidence the worker daemon reports
(readiness, deployment, guardrails, engine/OCR/scanner health, lifecycle backstop) plus
the Phase 30 liveness heartbeat, and prints a stable alert verdict for cron jobs, uptime
monitors, CI gates, or a process supervisor. It never processes a job, contacts a metrics
backend, or pages anyone — it is a LOCAL evaluation that exits with a documented code.

Usage:
  pnpm worker:ops-check [source] [format]

Snapshot source (choose at most one; default: --runtime):
  --runtime             Resolve this host's runtime + read the heartbeat. Run ON the
                        worker image/host: it probes real engine/OCR/scanner health.
  --web                 Config-only web-vantage snapshot + heartbeat (no host probe).
                        Run on a separate monitor host that cannot see the worker image.
  --stdin               Read a snapshot from stdin (a monitor that already has one).
  --file=<path>         Read a snapshot from a file.

    Ingested JSON may be a bare operations snapshot, the GET /api/worker/operations
    envelope ({ "data": <snapshot> }), or { "operations": <snapshot>, "metrics": {...} }.
    A "metrics" series (from the daemon's content-free metrics line) enables full SLOs.

Format (choose at most one; default: --json):
  --json                Stable JSON, suitable for a monitor to parse.
  --prometheus          Prometheus text-exposition gauges for a scrape.
  --text                A short human-readable summary.

  -h, --help            Show this help.

Neither --runtime nor --web ever fakes a running worker: liveness is observed ONLY when
a recent heartbeat is visible (with the feature enabled + a broker configured), a stale
or absent beat is an actionable warning, and a disabled heartbeat stays a neutral
"confirm a worker out-of-band". This is local evaluation, not a pager: your monitor still
supplies the scheduling and notification.

Exit codes (higher = worse; 1 is a distinct "the check was misused" band):
  0  OK        — everything observable here is healthy; no action needed
  1  usage     — the CLI was used incorrectly, or its input was unreadable/malformed
  2  UNKNOWN   — worker health could not be determined from this evidence (no data)
  3  WARNING   — a recommended fix is outstanding (degraded; a worker can still run)
  4  CRITICAL  — a worker cannot run correctly here, or an SLO breached`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1
    ? { name: token }
    : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the ops-check argv (already sliced past `node script`). Deterministic and
 * side-effect-free: it validates flags, rejects conflicting sources/formats and
 * unknown options, and never reads the environment.
 */
export function parseOpsCheckArgs(argv: readonly string[]): ParseOpsCheckArgsResult {
  let source: OpsCheckSource | undefined;
  let filePath: string | undefined;
  let format: OpsCheckFormat | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") {
      return { ok: true, kind: "help" };
    }

    const setSource = (next: OpsCheckSource): ParseOpsCheckArgsResult | undefined => {
      if (source !== undefined && source !== next) {
        return {
          ok: false,
          message: `Conflicting sources: --${source} and ${name} cannot be combined.`,
        };
      }
      source = next;
      return undefined;
    };

    if (name in SOURCE_FLAGS) {
      const conflict = setSource(SOURCE_FLAGS[name]!);
      if (conflict) return conflict;
      continue;
    }

    if (name === "--file") {
      // Value from `--file=path` or the next argv token (not another flag).
      let value = inlineValue;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          value = next;
          i += 1;
        }
      }
      if (value === undefined || value === "") {
        return { ok: false, message: "--file requires a path value." };
      }
      const conflict = setSource("file");
      if (conflict) return conflict;
      filePath = value;
      continue;
    }

    if (name in FORMAT_FLAGS) {
      const next = FORMAT_FLAGS[name]!;
      if (format !== undefined && format !== next) {
        return {
          ok: false,
          message: `Conflicting formats: --${format} and ${name} cannot be combined.`,
        };
      }
      format = next;
      continue;
    }

    return { ok: false, message: `Unknown option: ${name}` };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      source: source ?? "runtime",
      ...(filePath !== undefined ? { filePath } : {}),
      format: format ?? "json",
    },
  };
}
