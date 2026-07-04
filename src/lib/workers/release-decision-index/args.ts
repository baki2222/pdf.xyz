/**
 * Pure, node-free **parser** for the release decision ledger index CLI (`pnpm worker:release-decision-index`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionIndexArgs} with no side effects, environment reads, or I/O, so every branch (each input,
 * the format, the policy knobs, `--help`, and every malformed case) is unit-tested deterministically. The CLI
 * entry (`scripts/worker-release-decision-index.ts`) is the only place that reads the real `argv`, reads the
 * records / stdin, writes the output, and exits.
 *
 * Inputs (choose ONE mode): one or more `--file=<path>` / `--decision=<path>` (a bounded batch, oldest first /
 * newest LAST), OR `--stdin` (a JSON array of records, an NDJSON stream, or a single record, newest last). At least
 * one record is required — an empty invocation has nothing to index and must never be a vacuous stable index. No
 * input path is ever echoed.
 */

import type { ReleaseDecisionIndexFormat } from "./render";
import { DEFAULT_MAX_RECORDS } from "./types";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionIndexArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionIndexFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--file` / `--decision` was supplied: the batch list (oldest first, newest last). */
  recordPaths?: string[];
  /** True when the record batch is read from stdin (a JSON array / NDJSON / single record). */
  stdin: boolean;
  /** `--max-records=N`: consider only the newest N records (default {@link DEFAULT_MAX_RECORDS}). */
  maxRecords: number;
  /** `--strict`: any advisory / insufficiency / rejection / invalid input escalates the index to `blocked`. */
  strict: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionIndexArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionIndexArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionIndexFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--strict"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--file", "--decision", "--max-records"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_INDEX_USAGE = `pdf.xyz secure-worker release decision ledger index

Indexes a bounded batch of content-free \`pdfxyz.release-decision/1\` decision records (a sprint / month of release
decisions) into ONE stable, content-free ledger index summary — the decision distribution, per-source posture
counts, a per-record posture sequence, an index verdict + bounded reasons, and an ordered next-action checklist. It
re-validates each record against ITSELF and answers ONE question for an audit / review: "Over the batch of release
decisions, what did they decide, is anything blocking / inconclusive / untrustworthy, and what follow-up is warranted?"

It is local, offline, and READ-ONLY: it INGESTS records \`worker:release-decision\` already produced; it RUNS no
gate / bundle / audit / report / decision itself, makes NO network call, reads NO secret/bucket/object, and NEVER
deletes, prunes, uploads, promotes, approves, signs, or mutates anything. It carries no reviewer name/email,
filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, and never echoes an
ingested record's own stamp. It is a content-free ledger INDEX SUMMARY over decision records — NOT a legal audit
log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger.

Usage:
  pnpm worker:release-decision-index --file=<older> --file=<newer> [--file=...] [options]
  pnpm worker:release-decision-index --decision=<path> [--decision=...] [options]
  cat decisions.json | pnpm worker:release-decision-index --stdin [options]

Inputs (choose ONE mode; supply records oldest first, newest LAST):
  --file=<path>              A \`pdfxyz.release-decision/1\` record. Repeat for a bounded batch (newest last).
                             \`--decision=<path>\` is an accepted alias.
  --stdin                    Read the batch from stdin: a JSON array of records, an NDJSON stream (one record per
                             line), or a single record. Cannot combine with --file / --decision.

Policy (small bounded knobs):
  --max-records=N            Consider only the newest N records (default ${DEFAULT_MAX_RECORDS}). Older records are
                             dropped from the window (the count dropped is surfaced, never silent).
  --strict                   Escalate any advisory (proceed-with-followup / hold) or insufficiency to a blocked
                             index — a hard \`clean proceed or block\` gate for a high-assurance review.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in
                             the output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / review record / SIEM to parse.
  --text                     A review-friendly ledger index summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  STABLE       — a clean batch (every usable record a clean proceed, no tampered / unreadable record)
  1  USAGE        — the CLI was misused (a bad flag, no record supplied, or an unwritable output)
  2  INSUFFICIENT — the batch was inconclusive (zero usable records, or an insufficient decision)
  3  WATCH        — an advisory batch (a proceed-with-followup / hold decision present)
  4  BLOCKED      — a blocking decision (a reject / invalid decision, or a strict violation)
  4  INVALID      — an untrustworthy input (an unreadable / tampered record)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/** Parse a positive integer flag value (≥ 1), or return an error message. A zero window would index nothing. */
function positiveInt(name: string, value: string): { ok: true; n: number } | { ok: false; message: string } {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    return { ok: false, message: `${name} requires a positive integer (at least 1).` };
  }
  return { ok: true, n };
}

/**
 * Parse the release-decision-index argv (already sliced past `node script`). Deterministic and side-effect-free: it
 * validates flags, rejects conflicting formats / duplicate `--output` / unknown options / a missing value, requires
 * exactly one input mode, rejects a `--stdin` + `--file` combination, and never reads the environment or filesystem.
 */
export function parseReleaseDecisionIndexArgs(
  argv: readonly string[],
): ParseReleaseDecisionIndexArgsResult {
  let format: ReleaseDecisionIndexFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  const recordPaths: string[] = [];
  let stdin = false;
  let maxRecords = DEFAULT_MAX_RECORDS;
  let strict = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--stdin") stdin = true;
      else if (name === "--strict") strict = true;
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
        case "--decision":
          recordPaths.push(value);
          break;
        case "--max-records": {
          const parsed = positiveInt("--max-records", value);
          if (!parsed.ok) return parsed;
          maxRecords = parsed.n;
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

  if (recordPaths.length > 0 && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --file / --decision." };
  }
  // At least one record input is required — an empty invocation has nothing to index and must never be a vacuous
  // stable index. (Whether the supplied records index clean is a RUN concern, resolved by the fold.)
  if (recordPaths.length === 0 && !stdin) {
    return {
      ok: false,
      message: "Supply at least one record: --file=<path> (repeatable), --decision=<path>, or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      maxRecords,
      strict,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(recordPaths.length > 0 ? { recordPaths } : {}),
    },
  };
}
