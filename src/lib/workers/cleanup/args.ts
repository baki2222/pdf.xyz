/**
 * Pure, node-free parser for the operator cleanup-verification CLI (`pnpm worker:cleanup-check`).
 *
 * Like the ops-check parser, it maps `process.argv` to a validated {@link CleanupCheckArgs} with
 * no side effects, environment reads, or I/O, so every branch (including malformed input and
 * `--help`) is unit-tested deterministically. The CLI entry (`scripts/worker-cleanup-check.ts`)
 * is the only place that reads the real `argv`, resolves the provider from env, reads stdin/files,
 * prints {@link CLEANUP_CHECK_USAGE}, and exits.
 */

/**
 * Where the cleanup evidence comes from. `none` is the default: no evidence was supplied, so the
 * CLI reports the env-resolved posture honestly (`not-configured`, or `unknown` when storage is
 * wired but nothing was handed in) — it never blocks reading stdin unless asked.
 */
export type CleanupCheckSource = "none" | "stdin" | "file";

/** How the result is rendered. */
export type CleanupCheckFormat = "json" | "prometheus" | "text";

/** The validated arguments the CLI hands to the runner. */
export interface CleanupCheckArgs {
  /** Evidence source (default `none`). */
  source: CleanupCheckSource;
  /** Present iff `source === "file"`: the operator's own file reference (never logged). */
  filePath?: string;
  /** Output format (default `json`). */
  format: CleanupCheckFormat;
  /** Post-expiry reap grace in hours (default 48). Bounded and non-negative. */
  graceHours: number;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseCleanupCheckArgsResult =
  | { ok: true; kind: "run"; args: CleanupCheckArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Source selector flags (mutually exclusive; default `none`). `--file` is handled separately. */
const SOURCE_FLAGS: Record<string, CleanupCheckSource> = {
  "--stdin": "stdin",
};

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, CleanupCheckFormat> = {
  "--json": "json",
  "--prometheus": "prometheus",
  "--text": "text",
};

/** Default and bound on the post-expiry reap grace an operator can set. */
export const DEFAULT_GRACE_HOURS = 48;
const MAX_GRACE_HOURS = 24 * 365; // one year — an absurd upper bound, just a sanity cap.

/** Human-readable usage, printed on `--help` or a parse error. */
export const CLEANUP_CHECK_USAGE = `pdf.xyz secure-worker storage-artifact cleanup verifier

Evaluates content-free cleanup EVIDENCE — exported out-of-band from your object storage — to
prove whether storage artifacts that should be gone are actually ABSENT (deleted or reaped) or
only retrieval-denied. It NEVER calls the cloud, contacts a metrics backend, or pages anyone: it
is a LOCAL evaluation that exits with a documented code. Phase 41 already DENIES an expired or
tombstoned artifact at download; this check verifies the separate fact that its bytes are gone.

Usage:
  pnpm worker:cleanup-check [source] [format] [--grace-hours=N]

Evidence source (choose at most one; default: none):
  (no source)           No evidence supplied. Reports the env-resolved posture honestly:
                        not-configured when no storage is wired, else unknown (supply evidence).
  --stdin               Read a cleanup evidence document from stdin.
  --file=<path>         Read a cleanup evidence document from a file.

    The document is a bare JSON array, or { "objects": [ ... ] }, of content-free per-object
    observations. Each object: { "presence": "absent"|"present"|"error",
    "expiresAtMs"?: <epoch-ms>, "deleted"?: <bool>, "activeDelete"?: <bool> }. It carries NO
    object keys, bucket names, URLs, or bytes; any other field is ignored.

Options:
  --grace-hours=N       How long an expired object may linger in the bucket before its continued
                        presence is judged DRIFT rather than "denied, awaiting reap"
                        (default ${DEFAULT_GRACE_HOURS}; 0..${MAX_GRACE_HOURS}). 48h mirrors S3 lifecycle sweep latency.

Format (choose at most one; default: --json):
  --json                Stable JSON, suitable for a monitor to parse.
  --prometheus          Prometheus text-exposition gauges for a scrape.
  --text                A short human-readable summary.

  -h, --help            Show this help.

A present-but-denied object is reported as exactly that (cleanup pending), never as a proven
deletion: only a confirmed object ABSENCE yields "verified". This is local evaluation, not a
pager; your monitor still supplies the scheduling and notification.

Exit codes (higher = worse; 1 is a distinct "the check was misused" band):
  0  OK        — every should-be-gone artifact is confirmed absent (verified)
  1  usage     — the CLI was used incorrectly, or its input was unreadable/malformed
  2  UNKNOWN   — cleanup could not be proven (not-configured, no/insufficient evidence, or a
                 probe was unavailable)
  3  WARNING   — cleanup drift: an artifact is still present past its retention window + grace`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1
    ? { name: token }
    : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Parse and validate a `--grace-hours` value into a bounded non-negative number. */
function parseGraceHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > MAX_GRACE_HOURS)
    return null;
  return value;
}

/**
 * Parse the cleanup-check argv (already sliced past `node script`). Deterministic and
 * side-effect-free: it validates flags, rejects conflicting sources/formats and unknown options,
 * and never reads the environment.
 */
export function parseCleanupCheckArgs(
  argv: readonly string[],
): ParseCleanupCheckArgsResult {
  let source: CleanupCheckSource | undefined;
  let filePath: string | undefined;
  let format: CleanupCheckFormat | undefined;
  let graceHours: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") {
      return { ok: true, kind: "help" };
    }

    const setSource = (
      next: CleanupCheckSource,
    ): ParseCleanupCheckArgsResult | undefined => {
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

    if (name === "--grace-hours") {
      let value = inlineValue;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          value = next;
          i += 1;
        }
      }
      if (value === undefined) {
        return {
          ok: false,
          message: "--grace-hours requires a numeric value.",
        };
      }
      const parsed = parseGraceHours(value);
      if (parsed === null) {
        return {
          ok: false,
          message: `--grace-hours must be a number in 0..${MAX_GRACE_HOURS}.`,
        };
      }
      graceHours = parsed;
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
      source: source ?? "none",
      ...(filePath !== undefined ? { filePath } : {}),
      format: format ?? "json",
      graceHours: graceHours ?? DEFAULT_GRACE_HOURS,
    },
  };
}
