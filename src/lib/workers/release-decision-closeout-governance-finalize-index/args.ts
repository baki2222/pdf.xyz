/**
 * Pure, node-free **parser** for the release decision closeout governance finalize index CLI
 * (`pnpm worker:release-decision-closeout-governance-finalize-index`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs} with no side effects, environment reads, or I/O, so every
 * branch (each input, the format, the window / threshold policy knobs, `--help`, and every malformed case) is
 * unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index.ts`) is the only place that reads the real
 * `argv`, reads the bundles / stdin, writes the output, and exits.
 *
 * Inputs (choose ONE mode): one or more `--finalization=<path>` / `--file=<path>` (a bounded history, oldest first /
 * newest LAST), OR `--stdin` (a JSON array of finalization bundles, an NDJSON stream, or a single bundle, newest last).
 * At least one bundle is required — an empty invocation has nothing to index and must never be a vacuous `indexed`. No
 * input path is ever echoed.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexFormat } from "./render";
import { DEFAULT_MAX_FINALIZATIONS, MAX_MAX_FINALIZATIONS } from "./types";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--finalization` / `--file` was supplied: the history list (oldest first, newest last). */
  finalizationPaths?: string[];
  /** True when the finalization history is read from stdin (a JSON array / NDJSON / single bundle). */
  stdin: boolean;
  /** `--max-finalizations=N`: consider only the newest N bundles (default {@link DEFAULT_MAX_FINALIZATIONS}). */
  maxFinalizations: number;
  /** `--max-open=N`: tolerate up to N `finalize-open` bundles in the window before the open threshold fires (0). */
  maxOpen: number;
  /** `--max-incomplete=N`: tolerate up to N `finalize-incomplete` bundles before the incomplete threshold fires (0). */
  maxIncomplete: number;
  /** `--require-latest-finalized`: the latest usable bundle must be `finalized`, else the index is incomplete. */
  requireLatestFinalized: boolean;
  /** `--strict-open`: an open index escalates to `index-blocked`. */
  strictOpen: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutGovernanceFinalizeIndexArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionCloseoutGovernanceFinalizeIndexFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--require-latest-finalized", "--strict-open"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--file",
  "--finalization",
  "--max-finalizations",
  "--max-open",
  "--max-incomplete",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_USAGE = `pdf.xyz secure-worker release decision closeout governance finalize index

Indexes a bounded history of content-free \`pdfxyz.release-decision-closeout-governance-finalize/1\` finalization bundles
(a sprint / quarter of finalized closeout-governance chains) into ONE stable, content-free finalization-index summary —
the finalization-verdict distribution, a bounded summary of the newest usable finalization, a per-record posture
sequence, a final index verdict + bounded reasons, and an ordered next-action checklist. It re-validates each bundle
against ITSELF and answers ONE question for a governance review: "Across the recent release closeout governance
finalization bundles, is the latest finalization state consistently finalized, or is the latest / recent history open,
incomplete, blocked, or untrustworthy?"

It is local, offline, and READ-ONLY: it INGESTS bundles \`worker:release-decision-closeout-governance-finalize\` already
produced; it RUNS no gate / index / decision / trend / plan / receipt / closeout / governance / finalize itself, makes NO
network call, reads NO secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, approves, signs, or mutates
anything. It carries no reviewer name/email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size,
digest, or byte, and never echoes an ingested bundle's own stamp. It is a content-free finalization-history INDEX SUMMARY
over finalization bundles — NOT a legal audit log, a compliance attestation, an external approval / signature, an
identity proof, or a deployment / promotion ledger.

Usage:
  pnpm worker:release-decision-closeout-governance-finalize-index --file=<older> --file=<newer> [--file=...] [options]
  pnpm worker:release-decision-closeout-governance-finalize-index --finalization=<path> [--finalization=...] [options]
  cat finalize.json | pnpm worker:release-decision-closeout-governance-finalize-index --stdin [options]

Inputs (choose ONE mode; supply bundles oldest first, newest LAST):
  --finalization=<path>      A \`pdfxyz.release-decision-closeout-governance-finalize/1\` bundle. Repeat for a bounded
                             history (newest last). \`--file=<path>\` is an accepted alias.
  --stdin                    Read the history from stdin: a JSON array of bundles, an NDJSON stream (one bundle per
                             line), or a single bundle. Cannot combine with --finalization / --file.

Policy (small bounded knobs):
  --max-finalizations=N      Consider only the newest N bundles (default ${DEFAULT_MAX_FINALIZATIONS}, hard max
                             ${MAX_MAX_FINALIZATIONS}). Older bundles are dropped from the window (the count dropped is
                             surfaced, never silent).
  --max-open=N               Tolerate up to N \`finalize-open\` bundles in the window before the open threshold escalates
                             the index (default 0 — any open bundle escalates).
  --max-incomplete=N         Tolerate up to N \`finalize-incomplete\` bundles before the incomplete threshold escalates
                             the index (default 0). The latest bundle is never tolerated by a threshold; any blocked
                             bundle always escalates.
  --require-latest-finalized Demand the latest usable bundle be \`finalized\`: if it is not, the index fires
                             \`latest-not-finalized\` and can never be \`indexed\` — it resolves to the latest's own
                             posture (open / incomplete / blocked). A \`latest-finalized or fail\` gate for a review
                             that demands the most recent chain be closed.
  --strict-open              Escalate an open index (a finalize-open bundle in the considered history) to a hard block —
                             a \`consistently finalized or blocked\` gate for a high-assurance review.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / review record / SIEM to parse.
  --text                     A review-friendly finalization-index summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  INDEXED     — a coherent history (the latest bundle finalized and the history within thresholds)
  1  USAGE       — the CLI was misused (a bad flag, no bundle supplied, or an unwritable output)
  2  INCOMPLETE  — a coverage gap (zero usable bundles, an incomplete latest / breach, a require-latest miss)
  3  OPEN        — an open posture (a \`finalize-open\` latest, or an open-threshold breach)
  4  BLOCKED     — a blocking history (a \`finalize-blocked\` latest / any blocked bundle, or a --strict-open escalation)
  4  INVALID     — an untrustworthy history (a tampered or unreadable bundle); a distinct verdict, same exit as BLOCKED`;

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
 * Parse the release-decision-closeout-governance-finalize-index argv (already sliced past `node script`). Deterministic
 * and side-effect-free: it validates flags, rejects conflicting formats / duplicate `--output` / unknown options / a
 * missing value, requires exactly one input mode, rejects a `--stdin` + `--finalization` combination, and never reads
 * the environment or filesystem.
 */
export function parseReleaseDecisionCloseoutGovernanceFinalizeIndexArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutGovernanceFinalizeIndexArgsResult {
  let format: ReleaseDecisionCloseoutGovernanceFinalizeIndexFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  const finalizationPaths: string[] = [];
  let stdin = false;
  let maxFinalizations = DEFAULT_MAX_FINALIZATIONS;
  let maxOpen = 0;
  let maxIncomplete = 0;
  let requireLatestFinalized = false;
  let strictOpen = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--stdin") stdin = true;
      else if (name === "--require-latest-finalized") requireLatestFinalized = true;
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
        case "--finalization":
          finalizationPaths.push(value);
          break;
        case "--max-finalizations": {
          const n = Number(value);
          if (!Number.isSafeInteger(n) || n < 1) {
            return { ok: false, message: "--max-finalizations requires a positive integer (at least 1)." };
          }
          // Hard ceiling: a review history is bounded, never an unbounded list.
          maxFinalizations = Math.min(n, MAX_MAX_FINALIZATIONS);
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

  if (finalizationPaths.length > 0 && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --file / --finalization." };
  }
  // At least one finalization input is required — an empty invocation has nothing to index and must never be a vacuous
  // indexed. (Whether the supplied bundles index clean is a RUN concern, resolved by the fold.)
  if (finalizationPaths.length === 0 && !stdin) {
    return {
      ok: false,
      message:
        "Supply at least one finalization bundle: --file=<path> (repeatable), --finalization=<path>, or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      maxFinalizations,
      maxOpen,
      maxIncomplete,
      requireLatestFinalized,
      strictOpen,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(finalizationPaths.length > 0 ? { finalizationPaths } : {}),
    },
  };
}
