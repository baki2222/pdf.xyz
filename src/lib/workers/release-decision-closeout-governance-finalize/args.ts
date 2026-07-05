/**
 * Pure, node-free **parser** for the release decision closeout governance finalization bundle CLI
 * (`pnpm worker:release-decision-closeout-governance-finalize`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeArgs} with no side effects, environment reads, or I/O, so every branch
 * (each input, the format, the require / policy flags, `--help`, and every malformed case) is unit-tested
 * deterministically. The CLI entry (`scripts/worker-release-decision-closeout-governance-finalize.ts`) is the only place
 * that reads the real `argv`, reads the records / stdin, writes the output, and exits.
 *
 * Inputs: a REQUIRED primary receipt via `--receipt=<path>` (alias `--file=<path>`) OR `--stdin` (one JSON receipt
 * document) — exactly one mode; an empty invocation has nothing to finalize and must never be a vacuous finalized. Plus
 * the OPTIONAL related records: `--plan=<path>`, `--trend=<path>`, `--index=<path>`, `--governance=<path>` (each a file
 * path). No input path is ever echoed.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutGovernanceFinalizeFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--receipt` / `--file` was supplied: the ONE primary receipt document to finalize. */
  receiptPath?: string;
  /** True when the primary receipt is read from stdin (one JSON receipt document). */
  stdin: boolean;
  /** Present iff `--plan` was supplied: the related `pdfxyz.release-decision-closeout-governance-action-plan/1` to cross-check. */
  planPath?: string;
  /** Present iff `--trend` was supplied: the related `pdfxyz.release-decision-closeout-governance-index-trend/1` to cross-check. */
  trendPath?: string;
  /** Present iff `--index` was supplied: the related `pdfxyz.release-decision-closeout-governance-index/1` source-chain posture. */
  indexPath?: string;
  /** Present iff `--governance` was supplied: the related `pdfxyz.release-decision-closeout-governance/1` source-chain posture. */
  governancePath?: string;
  /** `--require-plan`: a usable plan must be supplied, else the chain is incomplete. */
  requirePlan: boolean;
  /** `--require-trend`: a usable trend must be supplied, else the chain is incomplete. */
  requireTrend: boolean;
  /** `--require-index`: a usable index must be supplied, else the chain is incomplete. */
  requireIndex: boolean;
  /** `--require-governance`: a usable governance bundle must be supplied, else the chain is incomplete. */
  requireGovernance: boolean;
  /** `--strict-open`: an open finalization escalates to `finalize-blocked`. */
  strictOpen: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutGovernanceFinalizeArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionCloseoutGovernanceFinalizeArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionCloseoutGovernanceFinalizeFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set([
  "--pretty",
  "--stdin",
  "--strict-open",
  "--require-plan",
  "--require-trend",
  "--require-index",
  "--require-governance",
]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--receipt",
  "--file",
  "--plan",
  "--trend",
  "--index",
  "--governance",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_USAGE = `pdf.xyz secure-worker release decision closeout governance finalization bundle

Composes the content-free release-decision-closeout-governance chain — a REQUIRED \`pdfxyz.release-decision-closeout-governance-action-receipt/1\`
primary receipt plus, optionally, the related records it was built from (the follow-up plan, the governance-index trend,
the governance index, and the governance bundle) — into ONE stable, content-free FINAL governance record for a review: the
evidence coverage, the primary-receipt summary, a related-record checklist, a finalization verdict + bounded reasons, an
archive checklist, and an ordered follow-up assignment list. It re-validates each record against ITSELF, cross-checks the
supplied plan / trend against what the receipt recorded, and answers ONE question for a governance review: "Is this
closeout-governance chain fully FINALIZED, still OPEN, INCOMPLETE, or BLOCKED?"

It is local, offline, and READ-ONLY: it INGESTS records the closeout-governance-chain workers already produced; it RUNS no
gate / index / decision / trend / plan / governance / closeout / receipt itself, makes NO network call, reads NO
secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, approves, signs, or mutates anything. It carries no
reviewer name/email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, never
echoes an ingested record's own stamp, and accepts NO free-form note or actor name. It is a content-free operational
governance FINALIZATION bundle ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity
proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.

Usage:
  pnpm worker:release-decision-closeout-governance-finalize --receipt=<path> [related] [options]
  pnpm worker:release-decision-closeout-governance-finalize --file=<path> --plan=<path> --trend=<path> [options]
  cat receipt.json | pnpm worker:release-decision-closeout-governance-finalize --stdin [related] [options]

Primary receipt (choose ONE mode; REQUIRED):
  --receipt=<path>           A \`pdfxyz.release-decision-closeout-governance-action-receipt/1\` document to finalize. \`--file=<path>\` is an alias.
  --stdin                    Read the primary receipt from stdin (one JSON object). Cannot combine with --receipt / --file.

Related records (each OPTIONAL; supply what you have — the more of the chain, the stronger the coherence check):
  --plan=<path>              A \`pdfxyz.release-decision-closeout-governance-action-plan/1\` (cross-checked against the receipt's plan verdict).
  --trend=<path>             A \`pdfxyz.release-decision-closeout-governance-index-trend/1\` (cross-checked against the receipt's source-trend verdict).
  --index=<path>             A \`pdfxyz.release-decision-closeout-governance-index/1\` (its own bounded posture folds into the chain).
  --governance=<path>        A \`pdfxyz.release-decision-closeout-governance/1\` (its own bounded posture folds into the chain).

Policy (small bounded knobs):
  --require-plan             Require a usable plan; else the chain is INCOMPLETE (exit 2).
  --require-trend            Require a usable trend; else the chain is INCOMPLETE (exit 2).
  --require-index            Require a usable index; else the chain is INCOMPLETE (exit 2).
  --require-governance       Require a usable governance bundle; else the chain is INCOMPLETE (exit 2).
  --strict-open              Escalate an open finalization (a followup-open receipt / advisory source chain) to a blocking
                             hold (exit 4 instead of 3). Blocking / incomplete outcomes are unaffected.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A governance-review-friendly bundle summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  FINALIZED  — a usable, completed primary receipt and every supplied related record coherent
  1  USAGE      — the CLI was misused (a bad flag, no primary receipt supplied, or an unwritable output)
  2  INCOMPLETE — a missing / unreadable / incomplete primary receipt, a required-but-missing record, or an inconclusive source chain
  3  OPEN       — a followup-open receipt, or an advisory / open source-chain record
  4  BLOCKED    — a tampered / blocked receipt, a contradictory / tampered related record, a blocked source chain, or a --strict-open escalation`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-decision-closeout-governance-finalize argv (already sliced past `node script`). Deterministic and
 * side-effect-free: it validates flags, rejects conflicting formats / duplicate single-value flags / unknown options / a
 * missing value, requires exactly one primary receipt input mode, rejects a `--stdin` + `--receipt` combination, and
 * never reads the environment or filesystem.
 */
export function parseReleaseDecisionCloseoutGovernanceFinalizeArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutGovernanceFinalizeArgsResult {
  let format: ReleaseDecisionCloseoutGovernanceFinalizeFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let receiptPath: string | undefined;
  let stdin = false;
  let planPath: string | undefined;
  let trendPath: string | undefined;
  let indexPath: string | undefined;
  let governancePath: string | undefined;
  let requirePlan = false;
  let requireTrend = false;
  let requireIndex = false;
  let requireGovernance = false;
  let strictOpen = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      switch (name) {
        case "--pretty":
          pretty = true;
          break;
        case "--stdin":
          stdin = true;
          break;
        case "--strict-open":
          strictOpen = true;
          break;
        case "--require-plan":
          requirePlan = true;
          break;
        case "--require-trend":
          requireTrend = true;
          break;
        case "--require-index":
          requireIndex = true;
          break;
        case "--require-governance":
          requireGovernance = true;
          break;
      }
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
        case "--receipt":
        case "--file":
          if (receiptPath !== undefined) {
            return { ok: false, message: "Supply exactly one primary receipt: --receipt / --file may be given only once." };
          }
          receiptPath = value;
          break;
        case "--plan":
          if (planPath !== undefined) return { ok: false, message: "Duplicate --plan option." };
          planPath = value;
          break;
        case "--trend":
          if (trendPath !== undefined) return { ok: false, message: "Duplicate --trend option." };
          trendPath = value;
          break;
        case "--index":
          if (indexPath !== undefined) return { ok: false, message: "Duplicate --index option." };
          indexPath = value;
          break;
        case "--governance":
          if (governancePath !== undefined) return { ok: false, message: "Duplicate --governance option." };
          governancePath = value;
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

  if (receiptPath !== undefined && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --receipt / --file." };
  }
  // Exactly one primary input mode is required — an empty invocation has no receipt to finalize and must never be a
  // vacuous finalized. (Whether the supplied receipt + records finalize a coherent chain is a RUN concern, resolved by
  // the fold — a run without a usable primary receipt is honestly `finalize-incomplete`, never a finalized.)
  if (receiptPath === undefined && !stdin) {
    return {
      ok: false,
      message: "Supply exactly one primary receipt: --receipt=<path>, --file=<path>, or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      requirePlan,
      requireTrend,
      requireIndex,
      requireGovernance,
      strictOpen,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(receiptPath !== undefined ? { receiptPath } : {}),
      ...(planPath !== undefined ? { planPath } : {}),
      ...(trendPath !== undefined ? { trendPath } : {}),
      ...(indexPath !== undefined ? { indexPath } : {}),
      ...(governancePath !== undefined ? { governancePath } : {}),
    },
  };
}
