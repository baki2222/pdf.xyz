/**
 * Pure, node-free **parser** for the release evidence archive pack CLI (`pnpm worker:release-archive`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseArchiveArgs} with no side effects, environment reads, or I/O, so every branch (each input, the
 * format, the policy knobs, `--help`, and every malformed case) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-archive.ts`) is the only place that reads the real `argv`, reads the records / stdin,
 * writes the output, and exits.
 *
 * Inputs: a `--governance=<path>` (`pdfxyz.release-governance/1`, the PRIMARY window posture), plus optional
 * `--trend=<path>` (`pdfxyz.release-trend/1`), `--report=<path>` (`pdfxyz.release-report/1`), `--audit=<path>`
 * (`pdfxyz.release-audit/1`), and `--bundle=<path>` (`pdfxyz.release-ci-bundle/1`) — each optional but AT LEAST
 * ONE is required (an empty invocation has nothing to archive and must never be a vacuous archivable). Any value
 * may be the single character `-` to read THAT record from stdin (at most one `-`, since stdin is a single
 * stream). No input path is ever echoed.
 */

import type { ReleaseArchiveFormat } from "./render";

/** The stdin sentinel: `--governance=-` / `--trend=-` / … reads THAT record from stdin. */
export const STDIN_SENTINEL = "-";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseArchiveArgs {
  /** Output format (default `json`). */
  format: ReleaseArchiveFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** `--require-trend`: a `pdfxyz.release-trend/1` must be supplied, else the record is incomplete. */
  requireTrend: boolean;
  /** `--require-report`: a latest `pdfxyz.release-report/1` must be supplied, else the record is incomplete. */
  requireReport: boolean;
  /** `--require-audit`: a latest `pdfxyz.release-audit/1` must be supplied, else the record is incomplete. */
  requireAudit: boolean;
  /** `--require-bundle`: a latest `pdfxyz.release-ci-bundle/1` must be supplied, else the record is incomplete. */
  requireBundle: boolean;
  /** `--strict-watch`: escalate an advisory-only posture (a watch) to `archive-blocked` (exit 4 instead of 3). */
  strictWatch: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--governance` was supplied: the `pdfxyz.release-governance/1` to ingest (or `-` for stdin). */
  governancePath?: string;
  /** Present iff `--trend` was supplied: the `pdfxyz.release-trend/1` to ingest (or `-` for stdin). */
  trendPath?: string;
  /** Present iff `--report` was supplied: the latest `pdfxyz.release-report/1` to ingest (or `-` for stdin). */
  reportPath?: string;
  /** Present iff `--audit` was supplied: the latest `pdfxyz.release-audit/1` to ingest (or `-` for stdin). */
  auditPath?: string;
  /** Present iff `--bundle` was supplied: the latest `pdfxyz.release-ci-bundle/1` to ingest (or `-` for stdin). */
  bundlePath?: string;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseArchiveArgsResult =
  | { ok: true; kind: "run"; args: ReleaseArchiveArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseArchiveFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set([
  "--pretty",
  "--require-trend",
  "--require-report",
  "--require-audit",
  "--require-bundle",
  "--strict-watch",
]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--governance", "--trend", "--report", "--audit", "--bundle"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_ARCHIVE_USAGE = `pdf.xyz secure-worker release evidence archive pack

Indexes the content-free release-evidence records — a \`pdfxyz.release-governance/1\` bundle (the PRIMARY window
posture) plus, optionally, the related \`pdfxyz.release-trend/1\`, LATEST \`pdfxyz.release-report/1\`, LATEST
\`pdfxyz.release-audit/1\`, and LATEST \`pdfxyz.release-ci-bundle/1\` — into ONE stable, content-free archive pack
manifest for a periodic review record: the evidence coverage, per-record summaries, an archive posture + bounded
reasons, an archive checklist (the record classes to keep together), and an ordered follow-up assignment list. It
re-validates each record against ITSELF and cross-checks the related records against the governance bundle's own
recorded postures. It answers ONE question for a review record: "What bounded content-free release evidence
records should be archived together, what is their governance posture, and what caveats / follow-up remain?"

It is local, offline, and READ-ONLY: it INGESTS records \`worker:release-governance\` / \`worker:release-trend\` /
\`worker:release-report\` / \`worker:release-audit\` / \`worker:release-ci-bundle\` already produced; it RUNS none of
them itself, makes NO network call, reads NO secret/bucket/object, and NEVER deletes, prunes, uploads, zips,
tars, copies, promotes, approves, or mutates anything. It carries no filename, path, object key, bucket, URL, raw
ref, raw label, commit URL, size, digest, or byte, and never echoes an ingested record's own stamp. It is
content-free ARCHIVE INDEXING over evidence summaries — not signing, auth, cloud validation, storage retention
enforcement, immutable archive storage, deployment approval, deployment promotion, or a ZIP / tar of raw files.

Usage:
  pnpm worker:release-archive --governance=<path> [--trend=<path>] [--report=<path>] [--audit=<path>] [--bundle=<path>] [options]
  pnpm worker:release-archive --governance=<path> --require-trend --require-report [options]
  cat governance.json | pnpm worker:release-archive --governance=- [options]     # read the governance from stdin

Inputs (each optional; supply AT LEAST ONE — a governance bundle for an archivable record):
  --governance=<path>        Ingest this \`pdfxyz.release-governance/1\` bundle (re-validated against itself), the
                             PRIMARY archive signal. A value of \`-\` reads the governance from stdin.
  --trend=<path>             Ingest the \`pdfxyz.release-trend/1\` window summary (re-validated + cross-checked). A
                             value of \`-\` reads it from stdin.
  --report=<path>            Ingest the latest \`pdfxyz.release-report/1\` (re-validated + cross-checked). A value
                             of \`-\` reads it from stdin.
  --audit=<path>             Ingest the latest \`pdfxyz.release-audit/1\` (re-validated + cross-checked). A value of
                             \`-\` reads it from stdin.
  --bundle=<path>            Ingest the latest \`pdfxyz.release-ci-bundle/1\` job evidence (re-validated). A value of
                             \`-\` reads it from stdin. (At most one input may be \`-\`.)

Policy (small bounded knobs):
  --require-trend            Require a trend; else the record is INCOMPLETE (exit 2).
  --require-report           Require a latest report; else the record is INCOMPLETE (exit 2).
  --require-audit            Require a latest audit; else the record is INCOMPLETE (exit 2).
  --require-bundle           Require a latest CI bundle; else the record is INCOMPLETE (exit 2).
  --strict-watch             Escalate an advisory-only posture (a WATCH) to a blocking hold (exit 4 instead of 3).
                             Blocking / insufficient outcomes are unaffected.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in
                             the output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / review record / SIEM to parse.
  --text                     A review-record-friendly archive summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  ARCHIVABLE  — a coherent review record (a healthy governance, and every supplied related record clean + coherent)
  1  USAGE       — the CLI was misused (a bad flag, no record supplied, or an unwritable output)
  2  INCOMPLETE  — insufficient evidence (an absent/unreadable/incomplete governance, an indeterminate related
                   record, or a required-but-missing record)
  3  WATCH       — an advisory posture (a watch governance, a warning trend, a hold-warning report, an audit /
                   bundle drift, or a record that disagrees with the governance record)
  4  BLOCKED     — a blocking posture (a tampered record, a blocked governance, a failing trend, a hold-fail
                   report, a blocking audit regression, or a failed CI bundle)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-archive argv (already sliced past `node script`). Deterministic and side-effect-free: it
 * validates flags, rejects conflicting formats / duplicate single-value flags / unknown options / a missing
 * value, requires at least one record input, rejects two stdin inputs, and never reads the environment or
 * filesystem.
 */
export function parseReleaseArchiveArgs(argv: readonly string[]): ParseReleaseArchiveArgsResult {
  let format: ReleaseArchiveFormat | undefined;
  let pretty = true;
  let requireTrend = false;
  let requireReport = false;
  let requireAudit = false;
  let requireBundle = false;
  let strictWatch = false;
  let outputPath: string | undefined;
  let governancePath: string | undefined;
  let trendPath: string | undefined;
  let reportPath: string | undefined;
  let auditPath: string | undefined;
  let bundlePath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--require-trend") requireTrend = true;
      else if (name === "--require-report") requireReport = true;
      else if (name === "--require-audit") requireAudit = true;
      else if (name === "--require-bundle") requireBundle = true;
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
        case "--governance":
          if (governancePath !== undefined) return { ok: false, message: "Duplicate --governance option." };
          governancePath = value;
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
        case "--bundle":
          if (bundlePath !== undefined) return { ok: false, message: "Duplicate --bundle option." };
          bundlePath = value;
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

  // At least one record input is required — an empty invocation has nothing to archive and must never be a
  // vacuous archivable. (Whether the supplied records certify an archivable record is a RUN concern, resolved by
  // the fold — a run without the PRIMARY governance is honestly `archive-incomplete`, never an archivable.)
  if (
    governancePath === undefined &&
    trendPath === undefined &&
    reportPath === undefined &&
    auditPath === undefined &&
    bundlePath === undefined
  ) {
    return {
      ok: false,
      message:
        "Supply at least one record: --governance (primary), --trend, --report, --audit, and/or --bundle.",
    };
  }

  // stdin is a single stream: at most one input may be `-`.
  const stdinCount =
    (governancePath === STDIN_SENTINEL ? 1 : 0) +
    (trendPath === STDIN_SENTINEL ? 1 : 0) +
    (reportPath === STDIN_SENTINEL ? 1 : 0) +
    (auditPath === STDIN_SENTINEL ? 1 : 0) +
    (bundlePath === STDIN_SENTINEL ? 1 : 0);
  if (stdinCount > 1) {
    return { ok: false, message: "Only one record may be read from stdin (`-`); give the others as file paths." };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      requireTrend,
      requireReport,
      requireAudit,
      requireBundle,
      strictWatch,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(governancePath !== undefined ? { governancePath } : {}),
      ...(trendPath !== undefined ? { trendPath } : {}),
      ...(reportPath !== undefined ? { reportPath } : {}),
      ...(auditPath !== undefined ? { auditPath } : {}),
      ...(bundlePath !== undefined ? { bundlePath } : {}),
    },
  };
}
