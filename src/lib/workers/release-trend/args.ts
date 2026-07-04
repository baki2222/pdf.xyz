/**
 * Pure, node-free **parser** for the release evidence trend summary CLI (`pnpm worker:release-trend`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated {@link ReleaseTrendArgs}
 * with no side effects, environment reads, or I/O, so every branch (each input, the format, the policy knobs,
 * `--help`, and every malformed case) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-trend.ts`) is the only place that reads the real `argv`, reads the reports / stdin,
 * writes the output, and exits.
 *
 * Inputs (choose ONE mode): one or more `--report=<path>` / `--file=<path>` (chronological, oldest first /
 * newest LAST), OR `--stdin` (a JSON array of reports, newest last). At least one report is required — an empty
 * invocation has nothing to summarize and must never be a vacuous stable trend. No input path is ever echoed.
 */

import type { ReleaseTrendFormat } from "./render";

/** The default window cap: the newest N reports considered when `--max-reports` is not given. */
export const DEFAULT_MAX_REPORTS = 20;

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseTrendArgs {
  /** Output format (default `json`). */
  format: ReleaseTrendFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--report` / `--file` was supplied: the chronological report list (oldest first, newest last). */
  reportPaths?: string[];
  /** True when the report list is read as a JSON array from stdin. */
  stdin: boolean;
  /** `--max-reports=N`: consider only the newest N reports (default {@link DEFAULT_MAX_REPORTS}). */
  maxReports: number;
  /** `--max-hold-warning=N`: tolerate up to N hold-warning reports before `repeated-hold-warning` fires. */
  maxHoldWarning: number;
  /** `--max-hold-fail=N`: tolerate up to N hold-fail reports before `repeated-hold-fail` fires. */
  maxHoldFail: number;
  /** `--require-latest-ready`: the newest usable report must be `promote-ready`, else the trend is failing. */
  requireLatestReady: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseTrendArgsResult =
  | { ok: true; kind: "run"; args: ReleaseTrendArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseTrendFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--require-latest-ready"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--report",
  "--file",
  "--max-reports",
  "--max-hold-warning",
  "--max-hold-fail",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_TREND_USAGE = `pdf.xyz secure-worker release evidence trend summary

Summarizes a bounded history of content-free \`pdfxyz.release-report/1\` operator reports (a week / month of
release handoffs) into ONE stable, content-free trend summary — the recommendation distribution, a per-report
posture sequence, a final trend verdict + bounded reasons, and an ordered follow-up checklist. It re-validates
each report against ITSELF and answers ONE question for a governance review: "How has release evidence posture
changed over the recent report history, and what bounded operator follow-up is warranted?"

It is local, offline, and READ-ONLY: it INGESTS reports \`worker:release-report\` already produced; it RUNS no
gate / bundle / audit / report itself, makes NO network call, reads NO secret/bucket/object, and NEVER deletes,
prunes, uploads, promotes, approves, or mutates anything. It carries no filename, path, object key, bucket, URL,
raw ref, raw label, commit URL, size, digest, or byte, and never echoes an ingested report's own stamp. It is
content-free trend reporting over evidence reports — not signing, auth, cloud validation, storage retention
enforcement, deployment approval, or deployment promotion.

Usage:
  pnpm worker:release-trend --report=<older> --report=<newer> [--report=...] [options]
  pnpm worker:release-trend --file=<path> [--file=...] [options]
  cat reports.json | pnpm worker:release-trend --stdin [options]

Inputs (choose ONE mode; supply reports oldest first, newest LAST):
  --report=<path>            A \`pdfxyz.release-report/1\` report. Repeat for a chronological history (newest
                             last). \`--file=<path>\` is an accepted alias.
  --stdin                    Read a JSON array of reports from stdin (newest last). Cannot combine with --report.

Policy (small bounded knobs):
  --max-reports=N            Consider only the newest N reports (default ${DEFAULT_MAX_REPORTS}). Older reports are
                             dropped from the window (the count dropped is surfaced, never silent).
  --max-hold-warning=N       Tolerate up to N hold-warning reports in the window before flagging (default 0).
  --max-hold-fail=N          Tolerate up to N hold-fail reports in the window before flagging (default 0). The
                             NEWEST report is always authoritative — a hold-fail tip fails the trend regardless.
  --require-latest-ready     Require the newest usable report to be promote-ready; else the trend is failing.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded
                             in the output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A governance-review-friendly trend summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  STABLE   — a clean recent trend (newest promote-ready, no tamper, no threshold breach)
  1  USAGE    — the CLI was misused (a bad flag, no report supplied, or an unwritable output)
  2  UNKNOWN  — the history was insufficient (an unreadable / empty history, or a needs-evidence newest)
  3  WARNING  — an advisory trend (a hold-warning newest, warnings increased, or a threshold breach)
  4  FAILING  — a blocking trend (a tampered report, a hold-fail newest / threshold, or a required not-ready tip)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Parse a non-negative integer flag value, or return an error message. */
function nonNegativeInt(name: string, value: string): { ok: true; n: number } | { ok: false; message: string } {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    return { ok: false, message: `${name} requires a non-negative integer.` };
  }
  return { ok: true, n };
}

/**
 * Parse the release-trend argv (already sliced past `node script`). Deterministic and side-effect-free: it
 * validates flags, rejects conflicting formats / duplicate single-value flags / unknown options / a missing
 * value, requires exactly one input mode, rejects a `--stdin` + `--report` combination, and never reads the
 * environment or filesystem.
 */
export function parseReleaseTrendArgs(argv: readonly string[]): ParseReleaseTrendArgsResult {
  let format: ReleaseTrendFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  const reportPaths: string[] = [];
  let stdin = false;
  let maxReports = DEFAULT_MAX_REPORTS;
  let maxHoldWarning = 0;
  let maxHoldFail = 0;
  let requireLatestReady = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--stdin") stdin = true;
      else if (name === "--require-latest-ready") requireLatestReady = true;
      continue;
    }

    if (VALUE_FLAGS.has(name)) {
      // Value from `--flag=value` or the next argv token (not another flag).
      let value = inlineValue;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          value = next;
          i += 1;
        }
      }
      if (value === undefined || value === "") {
        return { ok: false, message: `${name} requires a value.` };
      }
      switch (name) {
        case "--output":
          if (value === "-") return { ok: false, message: "--output cannot be stdin (`-`)." };
          if (outputPath !== undefined) return { ok: false, message: "Duplicate --output option." };
          outputPath = value;
          break;
        case "--report":
        case "--file":
          reportPaths.push(value);
          break;
        case "--max-reports": {
          const parsed = nonNegativeInt("--max-reports", value);
          if (!parsed.ok) return parsed;
          maxReports = parsed.n;
          break;
        }
        case "--max-hold-warning": {
          const parsed = nonNegativeInt("--max-hold-warning", value);
          if (!parsed.ok) return parsed;
          maxHoldWarning = parsed.n;
          break;
        }
        case "--max-hold-fail": {
          const parsed = nonNegativeInt("--max-hold-fail", value);
          if (!parsed.ok) return parsed;
          maxHoldFail = parsed.n;
          break;
        }
      }
      continue;
    }

    if (name in FORMAT_FLAGS) {
      const next = FORMAT_FLAGS[name]!;
      if (format !== undefined && format !== next) {
        return { ok: false, message: `Conflicting formats: --${format} and ${name} cannot be combined.` };
      }
      format = next;
      continue;
    }

    return { ok: false, message: `Unknown option: ${name}` };
  }

  if (reportPaths.length > 0 && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --report / --file." };
  }
  // At least one report input is required — an empty invocation has nothing to summarize and must never be a
  // vacuous stable trend. (Whether the supplied reports certify a healthy trend is a RUN concern, resolved by the fold.)
  if (reportPaths.length === 0 && !stdin) {
    return { ok: false, message: "Supply at least one report: --report=<path> (repeatable), --file=<path>, or --stdin." };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      maxReports,
      maxHoldWarning,
      maxHoldFail,
      requireLatestReady,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(reportPaths.length > 0 ? { reportPaths } : {}),
    },
  };
}
