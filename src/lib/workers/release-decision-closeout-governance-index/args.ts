/**
 * Pure, node-free **parser** for the release decision closeout governance index CLI
 * (`pnpm worker:release-decision-closeout-governance-index`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionCloseoutGovernanceIndexArgs} with no side effects, environment reads, or I/O, so every branch
 * (each input, the format, the window / threshold policy knobs, `--help`, and every malformed case) is unit-tested
 * deterministically. The CLI entry (`scripts/worker-release-decision-closeout-governance-index.ts`) is the only place
 * that reads the real `argv`, reads the bundles / stdin, writes the output, and exits.
 *
 * Inputs (choose ONE mode): one or more `--file=<path>` / `--governance=<path>` (a bounded history, oldest first /
 * newest LAST), OR `--stdin` (a JSON array of governance bundles, an NDJSON stream, or a single bundle, newest last). At
 * least one bundle is required — an empty invocation has nothing to index and must never be a vacuous `indexed`. No
 * input path is ever echoed.
 */

import type { ReleaseDecisionCloseoutGovernanceIndexFormat } from "./render";
import { DEFAULT_MAX_GOVERNANCE } from "./types";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutGovernanceIndexArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutGovernanceIndexFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--file` / `--governance` was supplied: the history list (oldest first, newest last). */
  governancePaths?: string[];
  /** True when the governance history is read from stdin (a JSON array / NDJSON / single bundle). */
  stdin: boolean;
  /** `--max-governance=N`: consider only the newest N bundles (default {@link DEFAULT_MAX_GOVERNANCE}). */
  maxGovernance: number;
  /** `--max-open=N`: tolerate up to N `governance-open` bundles in the window before the open threshold fires (0). */
  maxOpen: number;
  /** `--max-incomplete=N`: tolerate up to N `governance-incomplete` bundles before the incomplete threshold fires (0). */
  maxIncomplete: number;
  /** `--max-blocked=N`: tolerate up to N `governance-blocked` bundles before the blocked threshold fires (0). */
  maxBlocked: number;
  /** `--strict-open`: an open index escalates to `index-blocked`. */
  strictOpen: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutGovernanceIndexArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionCloseoutGovernanceIndexArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionCloseoutGovernanceIndexFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--strict-open"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--file",
  "--governance",
  "--max-governance",
  "--max-open",
  "--max-incomplete",
  "--max-blocked",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_USAGE = `pdf.xyz secure-worker release decision closeout governance index

Indexes a bounded history of content-free \`pdfxyz.release-decision-closeout-governance/1\` governance bundles (a sprint /
quarter of release-governance bundles) into ONE stable, content-free governance-index summary — the governance-verdict
distribution, the latest / oldest governance verdict, a per-record posture sequence, an index verdict + bounded reasons,
and an ordered next-action checklist. It re-validates each bundle against ITSELF and answers ONE question for a
governance review: "Across the recent release closeout governance bundles, is the latest governance state consistently
closed, or is the latest / recent history open, incomplete, or blocked?"

It is local, offline, and READ-ONLY: it INGESTS bundles \`worker:release-decision-closeout-governance\` already produced;
it RUNS no gate / index / decision / trend / plan / receipt / closeout / governance itself, makes NO network call, reads
NO secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, approves, signs, or mutates anything. It carries
no reviewer name/email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, and
never echoes an ingested bundle's own stamp. It is a content-free governance-history INDEX SUMMARY over governance
bundles — NOT a legal audit log, a compliance attestation, an external approval / signature, an identity proof, or a
deployment / promotion ledger.

Usage:
  pnpm worker:release-decision-closeout-governance-index --file=<older> --file=<newer> [--file=...] [options]
  pnpm worker:release-decision-closeout-governance-index --governance=<path> [--governance=...] [options]
  cat governance.json | pnpm worker:release-decision-closeout-governance-index --stdin [options]

Inputs (choose ONE mode; supply bundles oldest first, newest LAST):
  --file=<path>              A \`pdfxyz.release-decision-closeout-governance/1\` bundle. Repeat for a bounded history
                             (newest last). \`--governance=<path>\` is an accepted alias.
  --stdin                    Read the history from stdin: a JSON array of bundles, an NDJSON stream (one bundle per
                             line), or a single bundle. Cannot combine with --file / --governance.

Policy (small bounded knobs):
  --max-governance=N         Consider only the newest N bundles (default ${DEFAULT_MAX_GOVERNANCE}). Older bundles are
                             dropped from the window (the count dropped is surfaced, never silent).
  --max-open=N               Tolerate up to N \`governance-open\` bundles in the window before the open threshold
                             escalates the index (default 0 — any open bundle escalates).
  --max-incomplete=N         Tolerate up to N \`governance-incomplete\` bundles before the incomplete threshold escalates
                             the index (default 0).
  --max-blocked=N            Tolerate up to N \`governance-blocked\` bundles before the blocked threshold escalates the
                             index (default 0). The latest bundle is never tolerated by a threshold.
  --strict-open              Escalate an open index (a governance-open latest or an open-threshold breach) to a hard
                             block — a \`consistently closed or blocked\` gate for a high-assurance review.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / review record / SIEM to parse.
  --text                     A review-friendly governance-index summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  INDEXED     — a coherent history (the latest bundle closed and the history within thresholds)
  1  USAGE       — the CLI was misused (a bad flag, no bundle supplied, or an unwritable output)
  2  INCOMPLETE  — a coverage gap (zero usable bundles, an unreadable bundle, an incomplete latest / breach)
  3  OPEN        — an open posture (a governance-open latest, or an open-threshold breach)
  4  BLOCKED     — a blocking / untrustworthy history (a tampered bundle, a blocked latest / breach, or a
                   --strict-open escalation)`;

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

/** Parse a non-negative integer flag value (≥ 0), or return an error message. A threshold of 0 tolerates nothing. */
function nonNegInt(name: string, value: string): { ok: true; n: number } | { ok: false; message: string } {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    return { ok: false, message: `${name} requires a non-negative integer (0 or more).` };
  }
  return { ok: true, n };
}

/**
 * Parse the release-decision-closeout-governance-index argv (already sliced past `node script`). Deterministic and
 * side-effect-free: it validates flags, rejects conflicting formats / duplicate `--output` / unknown options / a
 * missing value, requires exactly one input mode, rejects a `--stdin` + `--file` combination, and never reads the
 * environment or filesystem.
 */
export function parseReleaseDecisionCloseoutGovernanceIndexArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutGovernanceIndexArgsResult {
  let format: ReleaseDecisionCloseoutGovernanceIndexFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  const governancePaths: string[] = [];
  let stdin = false;
  let maxGovernance = DEFAULT_MAX_GOVERNANCE;
  let maxOpen = 0;
  let maxIncomplete = 0;
  let maxBlocked = 0;
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
        case "--governance":
          governancePaths.push(value);
          break;
        case "--max-governance": {
          const parsed = positiveInt("--max-governance", value);
          if (!parsed.ok) return parsed;
          maxGovernance = parsed.n;
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

  if (governancePaths.length > 0 && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --file / --governance." };
  }
  // At least one governance input is required — an empty invocation has nothing to index and must never be a vacuous
  // indexed. (Whether the supplied bundles index clean is a RUN concern, resolved by the fold.)
  if (governancePaths.length === 0 && !stdin) {
    return {
      ok: false,
      message: "Supply at least one governance bundle: --file=<path> (repeatable), --governance=<path>, or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      maxGovernance,
      maxOpen,
      maxIncomplete,
      maxBlocked,
      strictOpen,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(governancePaths.length > 0 ? { governancePaths } : {}),
    },
  };
}
