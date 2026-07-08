/**
 * Pure, node-free **parser** for the release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend closeout index trend
 * closeout INDEX CLI
 * (`pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs} with no side effects,
 * environment reads, or I/O, so every branch (each input, the format, the window / threshold policy knobs, `--help`, and
 * every malformed case) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index.ts`) is
 * the only place that reads the real `argv`, reads the records / stdin, writes the output, and exits.
 *
 * Inputs (choose ONE mode): one or more `--closeout=<path>` / `--file=<path>` (a bounded history, oldest first / newest
 * LAST), OR `--stdin` (a JSON array of closeout records, an NDJSON stream, or a single record, newest last). At least one
 * record is required — an empty invocation has nothing to index and must never be a vacuous `all-closed`. No input path is
 * ever echoed.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexFormat } from "./render";
import { DEFAULT_MAX_CLOSEOUTS, MAX_MAX_CLOSEOUTS } from "./types";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--closeout` / `--file` was supplied: the history list (oldest first, newest last). */
  closeoutPaths?: string[];
  /** True when the closeout history is read from stdin (a JSON array / NDJSON / single record). */
  stdin: boolean;
  /** `--max-closeouts=N`: consider only the newest N records (default {@link DEFAULT_MAX_CLOSEOUTS}). */
  maxCloseouts: number;
  /** `--max-open=N`: tolerate up to N `open` records in the window before the open threshold fires (0). */
  maxOpen: number;
  /** `--max-incomplete=N`: tolerate up to N `incomplete` records before the incomplete threshold fires (0). */
  maxIncomplete: number;
  /** `--strict-open`: any open / incomplete index escalates to `blocked`. */
  strictOpen: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--strict-open"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--file",
  "--closeout",
  "--max-closeouts",
  "--max-open",
  "--max-incomplete",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_USAGE = `pdf.xyz secure-worker release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend closeout index trend closeout index

Indexes a bounded history of content-free \`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/1\`
closeout records (a sprint / quarter of finalization-index-trend follow-up loops) into ONE stable, content-free
closeout-index summary — the closeout-verdict distribution, a bounded summary of the newest usable closeout, a per-record
posture sequence, a final index verdict + bounded reasons, and an ordered next-action checklist. It re-validates each
record against ITSELF and answers ONE question for a governance review: "Across the recent finalization-index-trend
follow-up-loop closeout records, is the latest loop consistently closed, or is the latest / recent history open,
incomplete, blocked, or untrustworthy?"

It is local, offline, and READ-ONLY: it INGESTS records \`worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout\`
already produced; it RUNS no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself,
makes NO network call, reads NO secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, approves, signs, or
mutates anything. It carries no reviewer name/email, filename, path, object key, bucket, URL, raw ref, raw label, raw
note, size, digest, or byte, and never echoes an ingested record's own stamp. It is a content-free closeout-history INDEX
SUMMARY over closeout records — NOT a legal audit log, a compliance attestation, an external approval / signature, an
identity proof, or a deployment / promotion ledger.

Usage:
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index --file=<older> --file=<newer> [--file=...] [options]
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index --closeout=<path> [--closeout=...] [options]
  cat closeouts.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index --stdin [options]

Inputs (choose ONE mode; supply records oldest first, newest LAST):
  --closeout=<path>          A \`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/1\`
                             record. Repeat for a bounded history (newest last). \`--file=<path>\` is an accepted alias.
  --stdin                    Read the history from stdin: a JSON array of records, an NDJSON stream (one record per
                             line), or a single record. Cannot combine with --closeout / --file.

Policy (small bounded knobs):
  --max-closeouts=N          Consider only the newest N records (default ${DEFAULT_MAX_CLOSEOUTS}, hard max
                             ${MAX_MAX_CLOSEOUTS}). Older records are dropped from the window (the count dropped is
                             surfaced, never silent).
  --max-open=N               Tolerate up to N \`open\` records in the window before the open threshold escalates the index
                             (default 0 — any open record escalates).
  --max-incomplete=N         Tolerate up to N \`incomplete\` records before the incomplete threshold escalates the index
                             (default 0). The latest record is never tolerated by a threshold; any blocked record, any
                             \`invalid\`-posture record, and any tampered / unreadable record always escalates.
  --strict-open              Escalate an open OR incomplete index (an open / incomplete closeout record in the considered
                             history) to a hard block — a \`consistently closed or blocked\` gate for a high-assurance review.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / review record / SIEM to parse.
  --text                     A review-friendly closeout-index summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  ALL-CLOSED  — a coherent history (the latest record closed and the history within thresholds)
  1  USAGE       — the CLI was misused (a bad flag, no record supplied, or an unwritable output)
  2  INCOMPLETE  — a coverage gap (an \`incomplete\` latest, or an older incomplete-threshold breach)
  3  OPEN        — an open posture (an \`open\` latest, or an older open-threshold breach)
  4  BLOCKED     — a blocking history (a \`blocked\` latest / any blocked record, or a --strict-open escalation)
  4  INVALID     — an untrustworthy history (a tampered / unreadable record, an \`invalid\`-posture record, or zero usable records); a distinct verdict, same exit as BLOCKED`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Parse a non-negative integer flag value (≥ 0), or return an error message. A threshold of 0 tolerates nothing. */
function nonNegInt(name: string, value: string): { ok: true; n: number } | { ok: false; message: string } {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    return { ok: false, message: `${name} requires a non-negative integer (0 or more).` };
  }
  return { ok: true, n };
}

/**
 * Parse the release-decision-closeout-…-closeout-index argv (already sliced past `node script`). Deterministic and
 * side-effect-free: it validates flags, rejects conflicting formats / duplicate `--output` / unknown options / a missing
 * value, requires exactly one input mode, rejects a `--stdin` + `--closeout` combination, and never reads the
 * environment or filesystem.
 */
export function parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgsResult {
  let format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  const closeoutPaths: string[] = [];
  let stdin = false;
  let maxCloseouts = DEFAULT_MAX_CLOSEOUTS;
  let maxOpen = 0;
  let maxIncomplete = 0;
  let strictOpen = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--stdin") stdin = true;
      else if (name === "--strict-open") strictOpen = true;
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
        case "--file":
        case "--closeout":
          closeoutPaths.push(value);
          break;
        case "--max-closeouts": {
          const n = Number(value);
          if (!Number.isSafeInteger(n) || n < 1) {
            return { ok: false, message: "--max-closeouts requires a positive integer (at least 1)." };
          }
          // Hard ceiling: a review history is bounded, never an unbounded list.
          maxCloseouts = Math.min(n, MAX_MAX_CLOSEOUTS);
          break;
        }
        case "--max-open": {
          const parsed = nonNegInt("--max-open", value);
          if (!parsed.ok) return parsed;
          maxOpen = parsed.n;
          break;
        }
        case "--max-incomplete": {
          const parsed = nonNegInt("--max-incomplete", value);
          if (!parsed.ok) return parsed;
          maxIncomplete = parsed.n;
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

  if (closeoutPaths.length > 0 && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --file / --closeout." };
  }
  // At least one closeout input is required — an empty invocation has nothing to index and must never be a vacuous
  // all-closed. (Whether the supplied records index clean is a RUN concern, resolved by the fold.)
  if (closeoutPaths.length === 0 && !stdin) {
    return {
      ok: false,
      message: "Supply at least one closeout record: --file=<path> (repeatable), --closeout=<path>, or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      maxCloseouts,
      maxOpen,
      maxIncomplete,
      strictOpen,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(closeoutPaths.length > 0 ? { closeoutPaths } : {}),
    },
  };
}
