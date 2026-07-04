/**
 * Pure, node-free **parser** for the release evidence governance bundle CLI (`pnpm worker:release-governance`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseGovernanceArgs} with no side effects, environment reads, or I/O, so every branch (each input,
 * the format, the policy knobs, `--help`, and every malformed case) is unit-tested deterministically. The CLI
 * entry (`scripts/worker-release-governance.ts`) is the only place that reads the real `argv`, reads the
 * documents / stdin, writes the output, and exits.
 *
 * Inputs: a `--trend=<path>` (`pdfxyz.release-trend/1`, the PRIMARY window signal), an optional
 * `--report=<path>` (latest `pdfxyz.release-report/1`), and an optional `--audit=<path>` (latest
 * `pdfxyz.release-audit/1`) — each optional but AT LEAST ONE is required (an empty invocation has nothing to
 * bundle and must never be a vacuous healthy). Any value may be the single character `-` to read THAT document
 * from stdin (at most one `-`, since stdin is a single stream). No input path is ever echoed.
 */

import type { ReleaseGovernanceFormat } from "./render";

/** The stdin sentinel: `--trend=-` / `--report=-` / `--audit=-` reads THAT document from stdin. */
export const STDIN_SENTINEL = "-";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseGovernanceArgs {
  /** Output format (default `json`). */
  format: ReleaseGovernanceFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** `--require-report`: a latest `pdfxyz.release-report/1` must be supplied, else the window is incomplete. */
  requireReport: boolean;
  /** `--require-audit`: a latest `pdfxyz.release-audit/1` must be supplied, else the window is incomplete. */
  requireAudit: boolean;
  /** `--strict-watch`: escalate an advisory-only posture (a watch) to `blocked` (exit 4 instead of 3). */
  strictWatch: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--trend` was supplied: the `pdfxyz.release-trend/1` to ingest (or `-` for stdin). */
  trendPath?: string;
  /** Present iff `--report` was supplied: the latest `pdfxyz.release-report/1` to ingest (or `-` for stdin). */
  reportPath?: string;
  /** Present iff `--audit` was supplied: the latest `pdfxyz.release-audit/1` to ingest (or `-` for stdin). */
  auditPath?: string;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseGovernanceArgsResult =
  | { ok: true; kind: "run"; args: ReleaseGovernanceArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseGovernanceFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--require-report", "--require-audit", "--strict-watch"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--trend", "--report", "--audit"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_GOVERNANCE_USAGE = `pdf.xyz secure-worker release evidence governance bundle

Composes the content-free release-evidence summaries — a \`pdfxyz.release-trend/1\` (the PRIMARY window signal)
plus, optionally, the LATEST \`pdfxyz.release-report/1\` and/or \`pdfxyz.release-audit/1\` — into ONE stable,
content-free governance bundle for a weekly / monthly review: the evidence coverage, per-source summaries, a
governance verdict + bounded reasons, an archive checklist, and an ordered follow-up assignment list. It
re-validates each document against ITSELF and answers ONE question for a governance review: "What is the
governance posture for this review window, what bounded evidence should be archived, and what follow-up should
be assigned?"

It is local, offline, and READ-ONLY: it INGESTS documents \`worker:release-trend\` / \`worker:release-report\` /
\`worker:release-audit\` already produced; it RUNS no gate / bundle / audit / report / trend itself, makes NO
network call, reads NO secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, approves, or mutates
anything. It carries no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest,
or byte, and never echoes an ingested document's own stamp. It is content-free governance bundling over evidence
summaries — not signing, auth, cloud validation, storage retention enforcement, deployment approval, or
deployment promotion.

Usage:
  pnpm worker:release-governance --trend=<path> [--report=<path>] [--audit=<path>] [options]
  pnpm worker:release-governance --trend=<path> --require-report --require-audit [options]
  cat trend.json | pnpm worker:release-governance --trend=- [options]     # read the trend from stdin

Inputs (each optional; supply AT LEAST ONE — a release trend for a healthy window):
  --trend=<path>             Ingest this \`pdfxyz.release-trend/1\` window summary (re-validated against itself),
                             the PRIMARY governance signal. A value of \`-\` reads the trend from stdin.
  --report=<path>            Ingest the latest \`pdfxyz.release-report/1\` (re-validated against itself). A value
                             of \`-\` reads it from stdin.
  --audit=<path>             Ingest the latest \`pdfxyz.release-audit/1\` (re-validated against itself). A value
                             of \`-\` reads it from stdin. (At most one input may be \`-\`.)

Policy (small bounded knobs):
  --require-report           Require a latest report; else the window is INCOMPLETE (exit 2).
  --require-audit            Require a latest audit; else the window is INCOMPLETE (exit 2).
  --strict-watch             Escalate an advisory-only posture (a WATCH) to a blocking hold (exit 4 instead of 3).
                             Blocking / insufficient outcomes are unaffected.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in
                             the output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A governance-review-friendly bundle summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  HEALTHY    — a coherent window (a stable trend, and every supplied latest source clean)
  1  USAGE      — the CLI was misused (a bad flag, no document supplied, or an unwritable output)
  2  INCOMPLETE — insufficient evidence (an absent/unreadable/unknown trend, an indeterminate latest, or a
                  required-but-missing document)
  3  WATCH      — an advisory posture (a warning trend, a hold-warning report, an audit drift, or a trend drift)
  4  BLOCKED    — a blocking posture (a tampered document, a failing trend, a hold-fail report, or a regression)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-governance argv (already sliced past `node script`). Deterministic and side-effect-free: it
 * validates flags, rejects conflicting formats / duplicate single-value flags / unknown options / a missing
 * value, requires at least one document input, rejects two stdin inputs, and never reads the environment or
 * filesystem.
 */
export function parseReleaseGovernanceArgs(argv: readonly string[]): ParseReleaseGovernanceArgsResult {
  let format: ReleaseGovernanceFormat | undefined;
  let pretty = true;
  let requireReport = false;
  let requireAudit = false;
  let strictWatch = false;
  let outputPath: string | undefined;
  let trendPath: string | undefined;
  let reportPath: string | undefined;
  let auditPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--require-report") requireReport = true;
      else if (name === "--require-audit") requireAudit = true;
      else if (name === "--strict-watch") strictWatch = true;
      continue;
    }

    if (VALUE_FLAGS.has(name)) {
      // Value from `--flag=value`, or the next argv token — but NOT a following flag. A bare `-` is a valid value
      // (the stdin sentinel), so it is accepted as an inline value and never treated as a flag.
      let value = inlineValue;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && (next === STDIN_SENTINEL || !next.startsWith("-"))) {
          value = next;
          i += 1;
        }
      }
      if (value === undefined || value === "") {
        return { ok: false, message: `${name} requires a value.` };
      }
      switch (name) {
        case "--output":
          if (value === STDIN_SENTINEL) return { ok: false, message: "--output cannot be stdin (`-`)." };
          if (outputPath !== undefined) return { ok: false, message: "Duplicate --output option." };
          outputPath = value;
          break;
        case "--trend":
          if (trendPath !== undefined) return { ok: false, message: "Duplicate --trend option." };
          trendPath = value;
          break;
        case "--report":
          if (reportPath !== undefined) return { ok: false, message: "Duplicate --report option." };
          reportPath = value;
          break;
        case "--audit":
          if (auditPath !== undefined) return { ok: false, message: "Duplicate --audit option." };
          auditPath = value;
          break;
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

  // At least one document input is required — an empty invocation has nothing to bundle and must never be a
  // vacuous healthy. (Whether the supplied documents certify a healthy window is a RUN concern, resolved by the
  // fold — a run without the PRIMARY trend is honestly `incomplete`, never a healthy.)
  if (trendPath === undefined && reportPath === undefined && auditPath === undefined) {
    return { ok: false, message: "Supply at least one document: --trend (primary), --report, and/or --audit." };
  }

  // stdin is a single stream: at most one input may be `-`.
  const stdinCount =
    (trendPath === STDIN_SENTINEL ? 1 : 0) +
    (reportPath === STDIN_SENTINEL ? 1 : 0) +
    (auditPath === STDIN_SENTINEL ? 1 : 0);
  if (stdinCount > 1) {
    return { ok: false, message: "Only one document may be read from stdin (`-`); give the others as file paths." };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      requireReport,
      requireAudit,
      strictWatch,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(trendPath !== undefined ? { trendPath } : {}),
      ...(reportPath !== undefined ? { reportPath } : {}),
      ...(auditPath !== undefined ? { auditPath } : {}),
    },
  };
}
