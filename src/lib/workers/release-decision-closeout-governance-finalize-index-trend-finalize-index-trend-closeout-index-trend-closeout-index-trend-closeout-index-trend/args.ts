/**
 * Pure, node-free **parser** for the release decision closeout governance finalize index trend finalize index trend
 * closeout index trend CLI
 * (`pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs} with no side effects,
 * environment reads, or I/O, so every branch (each input, the format, the window / threshold policy knobs, `--help`, and
 * every malformed case) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend.ts`)
 * is the only place that reads the real `argv`, reads the windows / stdin, writes the output, and exits.
 *
 * Inputs (choose ONE mode): one or more `--index=<path>` / `--file=<path>` (a bounded history, oldest first / newest LAST),
 * OR `--stdin` (a JSON array of windows, an NDJSON stream, or a single window, newest last). At least one window is
 * required — an empty invocation has nothing to summarize and must never be a vacuous `stable`. No input path is ever
 * echoed.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendFormat } from "./render";
import { DEFAULT_MAX_INDEXES, MAX_INDEXES } from "./types";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--file` / `--index` was supplied: the history list (oldest first, newest last). */
  indexPaths?: string[];
  /** True when the window history is read from stdin (a JSON array / NDJSON / single window). */
  stdin: boolean;
  /** `--max-indexes=N`: consider only the newest N windows (default {@link DEFAULT_MAX_INDEXES}, hard max {@link MAX_INDEXES}). */
  maxIndexes: number;
  /** `--max-open=N`: tolerate up to N `open` windows in the history before the watch threshold fires (0). */
  maxOpen: number;
  /** `--max-incomplete=N`: tolerate up to N `incomplete` windows before the incomplete threshold fires (0). */
  maxIncomplete: number;
  /** `--max-blocked=N`: tolerate up to N `blocked` + `invalid` windows before the blocked threshold fires (0). */
  maxBlocked: number;
  /** `--strict-open`: a watch / degrading trend escalates to `blocked`. */
  strictOpen: boolean;
  /** `--require-latest-all-closed`: the latest usable window must be `indexed` (a non-indexed latest surfaces a reason). */
  requireLatestAllClosed: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgsResult =
  | {
      ok: true;
      kind: "run";
      args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs;
    }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<
  string,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendFormat
> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--strict-open", "--require-latest-all-closed"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--file",
  "--index",
  "--max-indexes",
  "--max-open",
  "--max-incomplete",
  "--max-blocked",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_USAGE = `pdf.xyz secure-worker release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend closeout index trend

Summarizes a bounded history of content-free \`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1\`
windows (a quarter / year of weekly, monthly, or quarterly closeout-index summaries) into ONE stable, content-free trend
summary — the per-window index-verdict distribution, the aggregate closeout distribution, a per-window posture sequence, an
arc direction + trend class, a trend verdict + bounded reasons, and an ordered next-action list. It re-validates each window
against ITSELF and answers ONE question for a governance review: "Across the recent closeout-index windows, is the release
decision closeout-index posture improving, stable, watch-worthy, degrading, insufficient, blocked, or untrustworthy, and
what follow-up is warranted?"

It is local, offline, and READ-ONLY: it INGESTS windows \`worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index\`
already produced; it RUNS no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself,
makes NO network call, reads NO secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, approves, signs, or
mutates anything. It carries no reviewer name/email, filename, path, object key, bucket, URL, raw ref, raw label, raw note,
size, digest, or byte, and never echoes an ingested window's own stamp. It is a content-free closeout-index TREND SUMMARY
over closeout-index windows — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity
proof, or a deployment / promotion ledger.

Usage:
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend --file=<older> --file=<newer> [--file=...] [options]
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend --index=<path> [--index=...] [options]
  cat windows.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend --stdin [options]

Inputs (choose ONE mode; supply windows oldest first, newest LAST):
  --file=<path>              A \`…-closeout-index/1\` window. Repeat for a bounded history (newest last). \`--index=<path>\`
                             is an accepted alias.
  --stdin                    Read the history from stdin: a JSON array of windows, an NDJSON stream (one window per line),
                             or a single window. Cannot combine with --file / --index.

Policy (small bounded knobs):
  --max-indexes=N            Consider only the newest N windows (default ${DEFAULT_MAX_INDEXES}, hard max ${MAX_INDEXES}).
                             Older windows are dropped from the history (the count dropped is surfaced, never silent).
  --max-open=N              Tolerate up to N \`open\` windows in the history before the watch threshold escalates the
                             trend (default 0 — any open window escalates).
  --max-incomplete=N         Tolerate up to N \`incomplete\` windows before the incomplete threshold escalates the
                             trend (default 0).
  --max-blocked=N            Tolerate up to N \`blocked\` + \`invalid\` windows before the blocked threshold
                             escalates the trend (default 0). The latest window is never tolerated by a threshold.
  --strict-open             Escalate a watch / degrading trend (an open latest, a open-threshold breach, or a
                             degrading arc) to a hard block — a \`consistently closed or blocked\` gate for a high-assurance
                             review.
  --require-latest-all-closed   Require the latest usable window to be \`indexed\`: a non-indexed latest cannot be stable /
                             improving and surfaces a bounded reason.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the output
                             or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A review-friendly trend summary (CI-summary ready).

  -h, --help                 Show this help.

Direction is derived from ORDERED INPUT POSITIONS (oldest first, newest last), never from any ingested timestamp.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  CLEAN        — a coherent history (stable), or a recovering one (improving)
  1  USAGE        — the CLI was misused (a bad flag, no window supplied, or an unwritable output)
  2  INSUFFICIENT — a coverage gap (zero usable windows, an incomplete latest, an incomplete-threshold breach)
  3  WATCH        — an advisory / worsening history (watch: an older open past --max-open under a clean latest; degrading:
                   an open latest or a degrading arc)
  4  BLOCKED      — a blocking / untrustworthy history (blocked: a blocked / invalid window over --max-blocked
                   or as the latest, or a --strict-open escalation; invalid: a tampered / unreadable window)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Parse an integer flag value in `[1, max]`, or return an error message. A zero window would summarize nothing. */
function boundedInt(
  name: string,
  value: string,
  max: number,
): { ok: true; n: number } | { ok: false; message: string } {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    return { ok: false, message: `${name} requires a positive integer (at least 1).` };
  }
  if (n > max) {
    return { ok: false, message: `${name} must be at most ${max} (an unbounded history is not a summary).` };
  }
  return { ok: true, n };
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
 * Parse the release-decision-…-closeout-index-trend argv (already sliced past `node script`). Deterministic and
 * side-effect-free: it validates flags, rejects conflicting formats / duplicate `--output` / unknown options / a missing
 * value, requires exactly one input mode, rejects a `--stdin` + `--file` combination, and never reads the environment or
 * filesystem.
 */
export function parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgsResult {
  let format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  const indexPaths: string[] = [];
  let stdin = false;
  let maxIndexes = DEFAULT_MAX_INDEXES;
  let maxOpen = 0;
  let maxIncomplete = 0;
  let maxBlocked = 0;
  let strictOpen = false;
  let requireLatestAllClosed = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--stdin") stdin = true;
      else if (name === "--strict-open") strictOpen = true;
      else if (name === "--require-latest-all-closed") requireLatestAllClosed = true;
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
        case "--index":
          indexPaths.push(value);
          break;
        case "--max-indexes": {
          const parsed = boundedInt("--max-indexes", value, MAX_INDEXES);
          if (!parsed.ok) return parsed;
          maxIndexes = parsed.n;
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
        case "--max-blocked": {
          const parsed = nonNegInt("--max-blocked", value);
          if (!parsed.ok) return parsed;
          maxBlocked = parsed.n;
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

  if (indexPaths.length > 0 && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --file / --index." };
  }
  // At least one window input is required — an empty invocation has nothing to summarize and must never be a vacuous clean
  // pass. (Whether the supplied windows trend clean is a RUN concern, resolved by the fold.)
  if (indexPaths.length === 0 && !stdin) {
    return {
      ok: false,
      message: "Supply at least one window: --file=<path> (repeatable), --index=<path>, or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      maxIndexes,
      maxOpen,
      maxIncomplete,
      maxBlocked,
      strictOpen,
      requireLatestAllClosed,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(indexPaths.length > 0 ? { indexPaths } : {}),
    },
  };
}
