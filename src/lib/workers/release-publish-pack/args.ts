/**
 * Pure, node-free **parser** for the release evidence publish / handoff pack CLI (`pnpm worker:release-publish-pack`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated {@link ReleasePublishPackArgs}
 * with no side effects, environment reads, or I/O, so every branch (each input, the format, the policy knobs,
 * `--help`, and every malformed case) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-publish-pack.ts`) is the only place that reads the real `argv`, reads the documents /
 * stdin, writes the output, and exits.
 *
 * Inputs: a `--governance=<path>` (`pdfxyz.release-governance/1`, the PRIMARY summary), plus optionally
 * `--archive=<path>`, `--restore-drill=<path>`, `--report=<path>`, and/or `--trend=<path>` — each optional but AT
 * LEAST ONE is required (an empty invocation has nothing to pack and must never be a vacuous share-safe pack). Any
 * value may be the single character `-` to read THAT document from stdin (at most one `-`, since stdin is a single
 * stream). No input path is ever echoed.
 */

import type { ReleasePublishPackFormat } from "./render";

/** The stdin sentinel: `--governance=-` / `--archive=-` / … reads THAT document from stdin. */
export const STDIN_SENTINEL = "-";

/** The validated arguments the CLI hands to the runner. */
export interface ReleasePublishPackArgs {
  /** Output format (default `json`). */
  format: ReleasePublishPackFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** `--require-archive`: a `pdfxyz.release-archive/1` must be supplied, else the handoff is incomplete. */
  requireArchive: boolean;
  /** `--require-restore-drill`: a `pdfxyz.release-restore-drill/1` must be supplied, else the handoff is incomplete. */
  requireRestoreDrill: boolean;
  /** `--strict`: escalate a `review` OR `incomplete` posture to `blocked` (exit 4). */
  strict: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--governance` was supplied: the `pdfxyz.release-governance/1` to ingest (or `-` for stdin). */
  governancePath?: string;
  /** Present iff `--archive` was supplied: the `pdfxyz.release-archive/1` to ingest (or `-` for stdin). */
  archivePath?: string;
  /** Present iff `--restore-drill` was supplied: the `pdfxyz.release-restore-drill/1` to ingest (or `-` for stdin). */
  restoreDrillPath?: string;
  /** Present iff `--report` was supplied: the latest `pdfxyz.release-report/1` to ingest (or `-` for stdin). */
  reportPath?: string;
  /** Present iff `--trend` was supplied: the `pdfxyz.release-trend/1` to ingest (or `-` for stdin). */
  trendPath?: string;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleasePublishPackArgsResult =
  | { ok: true; kind: "run"; args: ReleasePublishPackArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleasePublishPackFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--require-archive", "--require-restore-drill", "--strict"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--governance",
  "--archive",
  "--restore-drill",
  "--report",
  "--trend",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_PUBLISH_PACK_USAGE = `pdf.xyz secure-worker release evidence publish / handoff pack

Composes the content-free release-evidence summaries — a \`pdfxyz.release-governance/1\` (the PRIMARY summary
judgment) plus, optionally, the related \`pdfxyz.release-archive/1\`, \`pdfxyz.release-restore-drill/1\`,
\`pdfxyz.release-report/1\`, and/or \`pdfxyz.release-trend/1\` — into ONE stable, content-free publish / handoff
manifest an operator hands to an external reviewer / approver / investor / incident responder: the evidence
coverage, per-source summaries, a publish verdict, a DISCLOSURE CLASSIFICATION (share-safe / internal-review /
blocked), and a handoff checklist. It re-validates each document against ITSELF and answers ONE question for a
handoff: "Is this release-evidence package safe to share, with whom, and what bounded evidence should it include?"

It is local, offline, and READ-ONLY: it INGESTS documents \`worker:release-governance\` / \`worker:release-archive\`
/ \`worker:release-restore-drill\` / \`worker:release-report\` / \`worker:release-trend\` already produced; it RUNS no
gate / bundle / audit / report / trend / governance / archive / restore-drill itself, makes NO network call, reads
NO secret / bucket / object, and NEVER publishes, shares, sends, uploads, signs, approves, promotes, deletes, or
mutates anything. It carries no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size,
digest, raw log, provider error, or byte, and never echoes an ingested document's own stamp. It is content-free
HANDOFF PACKAGING over evidence summaries — NOT external publishing, signing, approval, legal / compliance
sign-off, release promotion, cloud validation, or deletion.

Usage:
  pnpm worker:release-publish-pack --governance=<path> [--archive=<path>] [--restore-drill=<path>] [options]
  pnpm worker:release-publish-pack --governance=<path> --require-archive --require-restore-drill [options]
  cat governance.json | pnpm worker:release-publish-pack --governance=- [options]   # read governance from stdin

Inputs (each optional; supply AT LEAST ONE — a governance bundle for a share-safe pack):
  --governance=<path>        Ingest this \`pdfxyz.release-governance/1\` bundle (re-validated against itself), the
                             PRIMARY signal. A value of \`-\` reads the bundle from stdin.
  --archive=<path>           Ingest the related \`pdfxyz.release-archive/1\` pack (re-validated against itself). A
                             value of \`-\` reads it from stdin.
  --restore-drill=<path>     Ingest the related \`pdfxyz.release-restore-drill/1\` (re-validated against itself). A
                             value of \`-\` reads it from stdin.
  --report=<path>            Ingest the latest \`pdfxyz.release-report/1\` (re-validated against itself). A value of
                             \`-\` reads it from stdin.
  --trend=<path>             Ingest the \`pdfxyz.release-trend/1\` window summary (re-validated against itself). A
                             value of \`-\` reads it from stdin. (At most one input may be \`-\`.)

Policy (small bounded knobs):
  --require-archive          Require an archive pack (proof archived); else the handoff is INCOMPLETE (exit 2).
  --require-restore-drill    Require a restore drill (proof recoverable); else the handoff is INCOMPLETE (exit 2).
  --strict                   Escalate a REVIEW or INCOMPLETE posture to a blocking hold (exit 4 instead of 3 / 2).
                             Blocking outcomes are unaffected. Use for a hard "share-safe or do not share" gate.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in
                             the output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / handoff record / SIEM to parse.
  --text                     A handoff-friendly manifest summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  PUBLISHABLE — a coherent, share-safe evidence package (a healthy governance bundle, every supplied source clean)
  1  USAGE       — the CLI was misused (a bad flag, no document supplied, or an unwritable output)
  2  INCOMPLETE  — insufficient evidence (an absent / unreadable / incomplete governance bundle, an indeterminate
                   source, or a required-but-missing document); disclosure internal-review
  3  REVIEW      — an advisory posture (a watch governance, an archive-watch pack, a restore-drift drill, a
                   hold-warning report, or a warning trend); disclosure internal-review
  4  BLOCKED     — a blocking posture (a tampered document, a blocked governance, a failed restore drill, a
                   hold-fail report, or a failing trend); disclosure blocked (do not share)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-publish-pack argv (already sliced past `node script`). Deterministic and side-effect-free: it
 * validates flags, rejects conflicting formats / duplicate single-value flags / unknown options / a missing value,
 * requires at least one document input, rejects two stdin inputs, and never reads the environment or filesystem.
 */
export function parseReleasePublishPackArgs(argv: readonly string[]): ParseReleasePublishPackArgsResult {
  let format: ReleasePublishPackFormat | undefined;
  let pretty = true;
  let requireArchive = false;
  let requireRestoreDrill = false;
  let strict = false;
  let outputPath: string | undefined;
  let governancePath: string | undefined;
  let archivePath: string | undefined;
  let restoreDrillPath: string | undefined;
  let reportPath: string | undefined;
  let trendPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--require-archive") requireArchive = true;
      else if (name === "--require-restore-drill") requireRestoreDrill = true;
      else if (name === "--strict") strict = true;
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
        case "--archive":
          if (archivePath !== undefined) return { ok: false, message: "Duplicate --archive option." };
          archivePath = value;
          break;
        case "--restore-drill":
          if (restoreDrillPath !== undefined) return { ok: false, message: "Duplicate --restore-drill option." };
          restoreDrillPath = value;
          break;
        case "--report":
          if (reportPath !== undefined) return { ok: false, message: "Duplicate --report option." };
          reportPath = value;
          break;
        case "--trend":
          if (trendPath !== undefined) return { ok: false, message: "Duplicate --trend option." };
          trendPath = value;
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

  // At least one document input is required — an empty invocation has nothing to pack and must never be a vacuous
  // share-safe pack. (Whether the supplied documents certify a share-safe pack is a RUN concern, resolved by the
  // fold — a run without the PRIMARY governance bundle is honestly `incomplete`, never a share-safe pack.)
  if (
    governancePath === undefined &&
    archivePath === undefined &&
    restoreDrillPath === undefined &&
    reportPath === undefined &&
    trendPath === undefined
  ) {
    return {
      ok: false,
      message:
        "Supply at least one document: --governance (primary), --archive, --restore-drill, --report, and/or --trend.",
    };
  }

  // stdin is a single stream: at most one input may be `-`.
  const stdinCount =
    (governancePath === STDIN_SENTINEL ? 1 : 0) +
    (archivePath === STDIN_SENTINEL ? 1 : 0) +
    (restoreDrillPath === STDIN_SENTINEL ? 1 : 0) +
    (reportPath === STDIN_SENTINEL ? 1 : 0) +
    (trendPath === STDIN_SENTINEL ? 1 : 0);
  if (stdinCount > 1) {
    return {
      ok: false,
      message: "Only one document may be read from stdin (`-`); give the others as file paths.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      requireArchive,
      requireRestoreDrill,
      strict,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(governancePath !== undefined ? { governancePath } : {}),
      ...(archivePath !== undefined ? { archivePath } : {}),
      ...(restoreDrillPath !== undefined ? { restoreDrillPath } : {}),
      ...(reportPath !== undefined ? { reportPath } : {}),
      ...(trendPath !== undefined ? { trendPath } : {}),
    },
  };
}
