/**
 * Pure, node-free **parser** for the release evidence restore drill CLI (`pnpm worker:release-restore-drill`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseRestoreDrillArgs} with no side effects, environment reads, or I/O, so every branch is unit-tested
 * deterministically. The CLI entry (`scripts/worker-release-restore-drill.ts`) is the only place that reads the
 * real `argv`, reads the records / stdin, hashes them, writes the output, and exits.
 *
 * Inputs: a required `--archive=<path>` (`pdfxyz.release-archive/1`, the PRIMARY anchor being drilled), plus
 * optional restored underlying records `--governance=<path>` (`pdfxyz.release-governance/1`), `--trend=<path>`
 * (`pdfxyz.release-trend/1`), `--report=<path>` (`pdfxyz.release-report/1`), `--audit=<path>`
 * (`pdfxyz.release-audit/1`), and `--bundle=<path>` (`pdfxyz.release-ci-bundle/1`). Any value may be the single
 * character `-` to read THAT input from stdin (at most one `-`). No input path is ever echoed.
 */

import type { ReleaseRestoreDrillFormat } from "./render";

/** The stdin sentinel: `--archive=-` / `--governance=-` / … reads THAT input from stdin. */
export const STDIN_SENTINEL = "-";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseRestoreDrillArgs {
  /** Output format (default `json`). */
  format: ReleaseRestoreDrillFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** `--archive-only`: scope the drill to the pack's own integrity; a restore need not be exercised. */
  archiveOnly: boolean;
  /** `--require-full-restore`: every usable archived record must be restored + matched, else incomplete. */
  requireFullRestore: boolean;
  /** `--strict-drift`: escalate an advisory-only posture (a drift) to `restore-failed` (exit 4 instead of 3). */
  strictDrift: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** The `pdfxyz.release-archive/1` pack to drill (or `-` for stdin). Always present (required). */
  archivePath: string;
  /** Present iff `--governance` was supplied: the restored `pdfxyz.release-governance/1` (or `-` for stdin). */
  governancePath?: string;
  /** Present iff `--trend` was supplied: the restored `pdfxyz.release-trend/1` (or `-` for stdin). */
  trendPath?: string;
  /** Present iff `--report` was supplied: the restored `pdfxyz.release-report/1` (or `-` for stdin). */
  reportPath?: string;
  /** Present iff `--audit` was supplied: the restored `pdfxyz.release-audit/1` (or `-` for stdin). */
  auditPath?: string;
  /** Present iff `--bundle` was supplied: the restored `pdfxyz.release-ci-bundle/1` (or `-` for stdin). */
  bundlePath?: string;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseRestoreDrillArgsResult =
  | { ok: true; kind: "run"; args: ReleaseRestoreDrillArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseRestoreDrillFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--archive-only", "--require-full-restore", "--strict-drift"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--archive", "--governance", "--trend", "--report", "--audit", "--bundle"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_RESTORE_DRILL_USAGE = `pdf.xyz secure-worker release evidence restore drill

Runs an OFFLINE restore drill over an archived release-evidence pack. It ingests a \`pdfxyz.release-archive/1\`
pack (the PRIMARY anchor) that an operator RESTORED from cold storage, RE-VALIDATES the pack against itself, and —
for each underlying record also restored (\`pdfxyz.release-governance/1\`, \`pdfxyz.release-trend/1\`,
\`pdfxyz.release-report/1\`, \`pdfxyz.release-audit/1\`, \`pdfxyz.release-ci-bundle/1\`) — RE-VALIDATES it and
CROSS-CHECKS its posture against what the pack recorded. It folds them into ONE restore verdict + a bounded
follow-up checklist an operator reads before relying on the archive. It answers ONE question: "Can this archived
release evidence be restored and trusted?"

It is local, offline, and READ-ONLY: it FETCHES nothing (the operator restores the files out of band and hands
them here), RUNS no gate / bundle / audit / report / trend / governance / archive itself, makes NO network call,
reads NO secret/bucket/object, and NEVER deletes, uploads, zips, copies, promotes, approves, or mutates anything.
It carries no filename, path, object key, bucket, URL, raw ref, raw label, commit URL, size, or byte, and never
echoes an ingested record's own stamp. This is NOT a deployment, a promotion, storage retrieval, or an unzip of
raw files.

Usage:
  pnpm worker:release-restore-drill --archive=<path> [--governance=<path>] [--trend=<path>] [--report=<path>] [--audit=<path>] [--bundle=<path>] [options]
  pnpm worker:release-restore-drill --archive=<path> --require-full-restore [options]
  cat archive.json | pnpm worker:release-restore-drill --archive=- --archive-only [options]

Inputs:
  --archive=<path>           REQUIRED. Ingest this \`pdfxyz.release-archive/1\` pack (re-validated against itself),
                             the PRIMARY anchor being drilled. A value of \`-\` reads the pack from stdin.
  --governance=<path>        Ingest the restored \`pdfxyz.release-governance/1\` (re-validated + cross-checked).
  --trend=<path>             Ingest the restored \`pdfxyz.release-trend/1\` (re-validated + cross-checked).
  --report=<path>            Ingest the restored \`pdfxyz.release-report/1\` (re-validated + cross-checked).
  --audit=<path>             Ingest the restored \`pdfxyz.release-audit/1\` (re-validated + cross-checked).
  --bundle=<path>            Ingest the restored \`pdfxyz.release-ci-bundle/1\` (re-validated + cross-checked).
                             (Each optional; a value of \`-\` reads it from stdin — at most one input may be \`-\`.)

Policy (small bounded knobs):
  --archive-only             Scope the drill to the pack's own integrity: a restore need not be exercised (a clean
                             archivable pack alone verifies). Without it, a drill that restored nothing is INCOMPLETE.
  --require-full-restore     Require every record the pack kept as usable to be restored + matched, else INCOMPLETE.
  --strict-drift             Escalate an advisory-only posture (a DRIFT) to a blocking hold (exit 4 instead of 3).
                             Blocking / insufficient outcomes are unaffected.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in
                             the output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / DR record / SIEM to parse.
  --text                     A DR-record-friendly restore summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  VERIFIED    — the restore drill passed (a usable archivable pack + every restored record matched + a restore exercised)
  1  USAGE       — the CLI was misused (a bad flag, no --archive, two stdin inputs, or an unwritable output)
  2  INCOMPLETE  — insufficient (an unreadable/incomplete pack, an unreadable restored record, a required record not
                   restored, or no restore exercised)
  3  DRIFT       — an advisory posture (a watch pack, or an out-of-band restored record the archive did not index)
  4  FAILED      — a blocking posture (a tampered pack, a blocked archive, a restore mismatch, or a corrupt restore)`;

function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-restore-drill argv (already sliced past `node script`). Deterministic and side-effect-free:
 * it validates flags, rejects conflicting formats / duplicate single-value flags / unknown options / a missing
 * value, requires the `--archive` anchor, rejects two stdin inputs, and never reads the environment or filesystem.
 */
export function parseReleaseRestoreDrillArgs(argv: readonly string[]): ParseReleaseRestoreDrillArgsResult {
  let format: ReleaseRestoreDrillFormat | undefined;
  let pretty = true;
  let archiveOnly = false;
  let requireFullRestore = false;
  let strictDrift = false;
  let outputPath: string | undefined;
  let archivePath: string | undefined;
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
      else if (name === "--archive-only") archiveOnly = true;
      else if (name === "--require-full-restore") requireFullRestore = true;
      else if (name === "--strict-drift") strictDrift = true;
      continue;
    }

    if (VALUE_FLAGS.has(name)) {
      // A bare `-` is a valid value (the stdin sentinel), so it is accepted as an inline value and never a flag.
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
        case "--archive":
          if (archivePath !== undefined) return { ok: false, message: "Duplicate --archive option." };
          archivePath = value;
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

  // The archive pack is the required anchor — a drill without it has nothing to restore.
  if (archivePath === undefined) {
    return {
      ok: false,
      message: "Supply the archive pack to drill: --archive=<path> (a pdfxyz.release-archive/1). It is required.",
    };
  }

  // stdin is a single stream: at most one input may be `-`.
  const stdinCount =
    (archivePath === STDIN_SENTINEL ? 1 : 0) +
    (governancePath === STDIN_SENTINEL ? 1 : 0) +
    (trendPath === STDIN_SENTINEL ? 1 : 0) +
    (reportPath === STDIN_SENTINEL ? 1 : 0) +
    (auditPath === STDIN_SENTINEL ? 1 : 0) +
    (bundlePath === STDIN_SENTINEL ? 1 : 0);
  if (stdinCount > 1) {
    return { ok: false, message: "Only one input may be read from stdin (`-`); give the others as file paths." };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      archiveOnly,
      requireFullRestore,
      strictDrift,
      ...(outputPath !== undefined ? { outputPath } : {}),
      archivePath,
      ...(governancePath !== undefined ? { governancePath } : {}),
      ...(trendPath !== undefined ? { trendPath } : {}),
      ...(reportPath !== undefined ? { reportPath } : {}),
      ...(auditPath !== undefined ? { auditPath } : {}),
      ...(bundlePath !== undefined ? { bundlePath } : {}),
    },
  };
}
