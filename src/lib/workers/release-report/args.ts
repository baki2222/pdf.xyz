/**
 * Pure, node-free **parser** for the release evidence operator report CLI (`pnpm worker:release-report`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseReportArgs} with no side effects, environment reads, or I/O, so every branch (each input, the
 * format, the policy knob, `--help`, and every malformed case) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-report.ts`) is the only place that reads the real `argv`, reads the documents /
 * stdin, writes the output, and exits.
 *
 * Inputs: a `--bundle=<path>` (`pdfxyz.release-ci-bundle/1`) and/or a `--audit=<path>` (`pdfxyz.release-audit/1`),
 * each optional but AT LEAST ONE is required (an empty invocation has nothing to report on and must never be a
 * vacuous promote). Either value may be the single character `-` to read THAT document from stdin (at most one
 * `-`, since stdin is a single stream). No input path is ever echoed.
 */

import type { ReleaseReportFormat } from "./render";

/** The stdin sentinel: `--bundle=-` / `--audit=-` reads THAT document from stdin. */
export const STDIN_SENTINEL = "-";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseReportArgs {
  /** Output format (default `json`). */
  format: ReleaseReportFormat;
  /** Pretty JSON output. Defaults true for stdout JSON; explicit so tests can pin behavior. */
  pretty: boolean;
  /** `--strict`: treat an advisory-only concern (a bundle warn / audit drift) as a blocking hold-fail. */
  strict: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--bundle` was supplied: the `pdfxyz.release-ci-bundle/1` to ingest (or `-` for stdin). */
  bundlePath?: string;
  /** Present iff `--audit` was supplied: the `pdfxyz.release-audit/1` to ingest (or `-` for stdin). */
  auditPath?: string;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseReportArgsResult =
  | { ok: true; kind: "run"; args: ReleaseReportArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseReportFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--strict"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--bundle", "--audit"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_REPORT_USAGE = `pdf.xyz secure-worker release evidence operator report

Composes the content-free release-evidence composites — a \`pdfxyz.release-ci-bundle/1\` (this release's
evidence coherence) and/or a \`pdfxyz.release-audit/1\` (regression versus a baseline) — into ONE stable,
content-free operator report: the evidence coverage, per-source summaries, a final recommendation + bounded
rationale, an archive checklist, and an ordered next-action checklist. It answers ONE question for a CI
summary / deployment review / incident handoff: "What should the operator DO now, based only on the
content-free release evidence — is this release promote-ready, should it be held, or is the evidence
insufficient?"

It is local, offline, and READ-ONLY: it INGESTS documents \`worker:release-ci-bundle\` / \`worker:release-audit\`
already produced; it RUNS no stage / bundle / audit itself, makes NO network call, reads NO secret/bucket/
object, and NEVER deletes, prunes, uploads, promotes, approves, or mutates anything. It carries no filename,
path, object key, bucket, URL, raw ref, raw label, commit URL, size, digest, or byte. It is content-free
reporting over evidence — not signing, auth, cloud validation, storage retention enforcement, deployment
approval, or deployment promotion.

Usage:
  pnpm worker:release-report --bundle=<path> [--audit=<path>] [options]
  pnpm worker:release-report --audit=<path> [--bundle=<path>] [options]
  pnpm worker:release-report --bundle=- [options]                 # read the bundle from stdin

Inputs (each optional; supply AT LEAST ONE — a release CI bundle for a promote-ready):
  --bundle=<path>            Ingest this \`pdfxyz.release-ci-bundle/1\` (re-validated against itself). A value
                             of \`-\` reads the bundle from stdin.
  --audit=<path>             Ingest this \`pdfxyz.release-audit/1\` (re-validated against itself). A value of
                             \`-\` reads the audit from stdin. (At most one input may be \`-\`.)

Policy:
  --strict                   Treat an advisory-only concern (a bundle warn / a non-blocking audit drift) as a
                             blocking HOLD-FAIL (exit 4 instead of 3). Blocking / insufficient outcomes are
                             unaffected.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded
                             in the output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / release record / SIEM to parse.
  --text                     An operator-friendly report summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  PROMOTE-READY  — coherent (a usable bundle passed) and non-regressed under the evidence supplied
  1  USAGE          — the CLI was misused (a bad flag, no document supplied, or an unwritable output)
  2  NEEDS-EVIDENCE — insufficient evidence (an unreadable/indeterminate document, or no usable bundle)
  3  HOLD-WARNING   — an advisory concern was raised (a non-blocking bundle warn / audit drift)
  4  HOLD-FAIL      — a blocking issue (a tampered document, a failed bundle, or a blocking audit regression)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-report argv (already sliced past `node script`). Deterministic and side-effect-free: it
 * validates flags, rejects conflicting formats / duplicate single-value flags / unknown options / a missing
 * value, requires at least one document input, rejects two stdin inputs, and never reads the environment or
 * filesystem.
 */
export function parseReleaseReportArgs(argv: readonly string[]): ParseReleaseReportArgsResult {
  let format: ReleaseReportFormat | undefined;
  let pretty = true;
  let strict = false;
  let outputPath: string | undefined;
  let bundlePath: string | undefined;
  let auditPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--strict") strict = true;
      continue;
    }

    if (VALUE_FLAGS.has(name)) {
      // Value from `--flag=value`, or the next argv token — but NOT a following flag. A bare `-` is a valid
      // value (the stdin sentinel), so it is accepted as an inline value and never treated as a flag.
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
        case "--bundle":
          if (bundlePath !== undefined) return { ok: false, message: "Duplicate --bundle option." };
          bundlePath = value;
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

  // At least one document input is required — an empty invocation has nothing to report on and must never be a
  // vacuous promote. (Whether the supplied documents certify a promotion is a RUN concern, resolved by the fold.)
  if (bundlePath === undefined && auditPath === undefined) {
    return { ok: false, message: "Supply at least one document: --bundle and/or --audit." };
  }

  // stdin is a single stream: at most one input may be `-`.
  if (bundlePath === STDIN_SENTINEL && auditPath === STDIN_SENTINEL) {
    return { ok: false, message: "Only one document may be read from stdin (`-`); give the other as a file path." };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      strict,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(bundlePath !== undefined ? { bundlePath } : {}),
      ...(auditPath !== undefined ? { auditPath } : {}),
    },
  };
}
