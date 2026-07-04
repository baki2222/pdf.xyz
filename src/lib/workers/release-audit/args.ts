/**
 * Pure, node-free **parser** for the release evidence audit CLI (`pnpm worker:release-audit`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseAuditArgs} with no side effects, environment reads, or I/O, so every branch (each input
 * mode, the format, the policy knobs, `--help`, and every malformed case) is unit-tested deterministically.
 * The CLI entry (`scripts/worker-release-audit.ts`) is the only place that reads the real `argv`, reads the
 * bundle files / stdin, writes the output, and exits.
 *
 * Two input modes, chosen by the flags supplied (never both):
 *  - **pair** — `--baseline=<path>` AND `--current=<path>` (both required): diff current vs baseline;
 *  - **history** — one or more `--bundle=<path>` (chronological), or `--stdin` (a JSON array of bundles):
 *    diff the LAST bundle against the one before it, plus a trend over the whole list.
 *
 * No input path is ever echoed.
 */

import type { ReleaseAuditFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseAuditArgs {
  /** Which input mode was selected. */
  mode: "pair" | "history";
  /** Output format (default `json`). */
  format: ReleaseAuditFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present in pair mode: the baseline `pdfxyz.release-ci-bundle/1` bundle to compare against. */
  baselinePath?: string;
  /** Present in pair mode: the current `pdfxyz.release-ci-bundle/1` bundle to audit. */
  currentPath?: string;
  /** Present in history mode (from `--bundle`): the chronological bundle list (newest last). */
  bundlePaths?: string[];
  /** True in history mode when the bundle list is read as a JSON array from stdin. */
  stdin: boolean;
  /** `--allow-warn-regression`: report warn-level regressions but do not let them drive a non-pass verdict. */
  allowWarnRegression: boolean;
  /** `--max-new-warnings=N`: tolerate up to N new advisory signals before `warnings-increased` fires. */
  maxNewWarnings: number;
  /** `--fail-on-unknown`: escalate a certification-loss drift (a worsening whose endpoint is `unknown`) to blocking. */
  failOnUnknown: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseAuditArgsResult =
  | { ok: true; kind: "run"; args: ReleaseAuditArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseAuditFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--allow-warn-regression", "--fail-on-unknown", "--stdin"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--baseline", "--current", "--bundle", "--max-new-warnings"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_AUDIT_USAGE = `pdf.xyz secure-worker release evidence audit / diff

Compares two (or a history of) content-free \`pdfxyz.release-ci-bundle/1\` bundles — a BASELINE and a
CURRENT — re-validates each bundle against ITSELF, and diffs their bounded postures to answer ONE question
for a CI regression gate / operator handoff: "Did this release's evidence posture REGRESS compared with a
baseline/history, and what is the next safe operator action?"

It is local, offline, and READ-ONLY: it INGESTS bundles \`worker:release-ci-bundle\` already produced; it
RUNS no stage or bundle itself, makes NO network call, reads NO secret/bucket/object, and NEVER deletes,
prunes, uploads, promotes, or mutates anything. It carries no filename, path, object key, bucket, URL, raw
ref, raw label, commit URL, size, digest, or byte. It is content-free audit/diff over evidence — not
signing, auth, cloud validation, storage retention enforcement, or deployment promotion.

Usage:
  pnpm worker:release-audit --baseline=<path> --current=<path> [options]
  pnpm worker:release-audit --bundle=<older> --bundle=<newer> [--bundle=...] [options]
  cat bundles.json | pnpm worker:release-audit --stdin [options]

Inputs (choose ONE mode):
  --baseline=<path>          The baseline \`pdfxyz.release-ci-bundle/1\` bundle (the last accepted release).
  --current=<path>           The current \`pdfxyz.release-ci-bundle/1\` bundle (this release). Pair mode
                             requires BOTH --baseline and --current.
  --bundle=<path>            History mode: repeat for a chronological list (newest LAST). The audit diffs
                             the last bundle against the one before it, plus a trend over the whole list.
  --stdin                    History mode: read a JSON array of bundles from stdin (newest last).

Policy (small bounded knobs):
  --allow-warn-regression    Report warn-level drift but do NOT fail on it (exit 0 instead of 3).
  --max-new-warnings=N       Tolerate up to N new advisory signals before flagging (default 0).
  --fail-on-unknown          Treat a drop to an UNCERTIFIED (unknown) posture as a BLOCKING regression.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never
                             embedded in the output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / release record / SIEM to parse.
  --text                     An operator-friendly audit summary.

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  PASS    — no regression (or only warn-level drift accepted via --allow-warn-regression)
  1  USAGE   — the CLI was misused (a bad flag, missing/duplicated inputs, or an unwritable output)
  2  UNKNOWN — the audit could not be performed (an unreadable bundle, or too little comparable history)
  3  WARN    — a non-blocking regression / advisory drift was detected
  4  FAIL    — a blocking regression, or a recognized-but-self-inconsistent (tampered) bundle`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-audit argv (already sliced past `node script`). Deterministic and side-effect-free: it
 * validates flags, rejects conflicting formats / duplicate single-value flags / unknown options / a
 * missing value, requires exactly one input mode, and never reads the environment or filesystem.
 */
export function parseReleaseAuditArgs(argv: readonly string[]): ParseReleaseAuditArgsResult {
  let format: ReleaseAuditFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let baselinePath: string | undefined;
  let currentPath: string | undefined;
  const bundlePaths: string[] = [];
  let stdin = false;
  let allowWarnRegression = false;
  let maxNewWarnings = 0;
  let failOnUnknown = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--allow-warn-regression") allowWarnRegression = true;
      else if (name === "--fail-on-unknown") failOnUnknown = true;
      else if (name === "--stdin") stdin = true;
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
          if (outputPath !== undefined) return { ok: false, message: "Duplicate --output option." };
          outputPath = value;
          break;
        case "--baseline":
          if (baselinePath !== undefined) return { ok: false, message: "Duplicate --baseline option." };
          baselinePath = value;
          break;
        case "--current":
          if (currentPath !== undefined) return { ok: false, message: "Duplicate --current option." };
          currentPath = value;
          break;
        case "--bundle":
          bundlePaths.push(value);
          break;
        case "--max-new-warnings": {
          const n = Number(value);
          if (!Number.isSafeInteger(n) || n < 0) {
            return { ok: false, message: "--max-new-warnings requires a non-negative integer." };
          }
          maxNewWarnings = n;
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

  const pairish = baselinePath !== undefined || currentPath !== undefined;
  const historyish = bundlePaths.length > 0 || stdin;

  if (pairish && historyish) {
    return {
      ok: false,
      message: "Choose one input mode: pair (--baseline + --current) OR history (--bundle.../--stdin), not both.",
    };
  }
  if (bundlePaths.length > 0 && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --bundle." };
  }

  let mode: "pair" | "history";
  if (pairish) {
    if (baselinePath === undefined || currentPath === undefined) {
      return { ok: false, message: "Pair mode requires BOTH --baseline and --current." };
    }
    mode = "pair";
  } else if (historyish) {
    mode = "history";
  } else {
    return {
      ok: false,
      message: "Supply an input: --baseline + --current, or --bundle... , or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      mode,
      format: format ?? "json",
      pretty,
      stdin,
      allowWarnRegression,
      maxNewWarnings,
      failOnUnknown,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(baselinePath !== undefined ? { baselinePath } : {}),
      ...(currentPath !== undefined ? { currentPath } : {}),
      ...(bundlePaths.length > 0 ? { bundlePaths } : {}),
    },
  };
}
