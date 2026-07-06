/**
 * Pure, node-free **parser** for the release decision closeout governance finalize index trend FINALIZATION CLI
 * (`pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs} with no side effects, environment reads, or I/O,
 * so every branch (each input, the format, the require / policy flags, `--help`, and every malformed case) is unit-tested
 * deterministically. The CLI entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index-trend-finalize.ts`) is the only place that reads
 * the real `argv`, reads the records / stdin, writes the output, and exits.
 *
 * Inputs: a REQUIRED primary receipt via `--receipt=<path>` (alias `--file=<path>`) OR `--stdin` (one JSON receipt
 * document) — exactly one mode; an empty invocation has nothing to finalize and must never be a vacuous finalized. Plus
 * the OPTIONAL source-chain records: `--plan=<path>`, `--trend=<path>`, `--index=<path>`, `--finalization=<path>` (each a
 * file path). No input path is ever echoed.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--receipt` / `--file` was supplied: the ONE primary receipt document to finalize. */
  receiptPath?: string;
  /** True when the primary receipt is read from stdin (one JSON receipt document). */
  stdin: boolean;
  /** Present iff `--plan` was supplied: the related Phase 77 action-plan to cross-check. */
  planPath?: string;
  /** Present iff `--trend` was supplied: the related Phase 76 finalize-index trend to cross-check. */
  trendPath?: string;
  /** Present iff `--index` was supplied: the related Phase 75 finalize-index window to cross-check. */
  indexPath?: string;
  /** Present iff `--finalization` was supplied: the related Phase 74 finalization bundle to cross-check. */
  finalizationPath?: string;
  /** `--require-plan`: a usable plan must be supplied, else the loop is incomplete. */
  requirePlan: boolean;
  /** `--require-trend`: a usable trend must be supplied, else the loop is incomplete. */
  requireTrend: boolean;
  /** `--require-index`: a usable index must be supplied, else the loop is incomplete. */
  requireIndex: boolean;
  /** `--require-finalization`: a usable finalization bundle must be supplied, else the loop is incomplete. */
  requireFinalization: boolean;
  /** `--strict-open`: an open / incomplete-receipt finalization escalates to `finalize-blocked`. */
  strictOpen: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeFormat> = {
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
  "--require-finalization",
]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--receipt",
  "--file",
  "--plan",
  "--trend",
  "--index",
  "--finalization",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_USAGE = `pdf.xyz secure-worker release decision closeout governance finalize index trend FINALIZATION record

Composes the content-free finalize-index-trend follow-up loop — a REQUIRED \`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1\`
primary receipt (Phase 78) plus, optionally, the source-chain records it was built from (the Phase 77 follow-up plan, the
Phase 76 finalize-index trend, the Phase 75 finalize index, and the Phase 74 finalization bundle) — into ONE stable,
content-free FINAL record for a review: the evidence coverage, the primary-receipt summary, a source-chain checklist, a
finalization verdict + bounded reasons, and an ordered next-action list. It re-validates each record against ITSELF,
cross-checks each supplied record against what its downstream record recorded, and answers ONE question for a governance
review: "Given the content-free finalization-index trend follow-up receipt and optional source-chain records, is this
follow-up loop FINALIZED, OPEN, INCOMPLETE, BLOCKED, or untrustworthy (INVALID)?"

It is local, offline, and READ-ONLY: it INGESTS records the finalize-index-trend workers already produced; it RUNS no
gate / index / decision / trend / finalize / plan / governance / closeout / receipt itself, makes NO network call, reads
NO secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, approves, signs, or mutates anything. It carries no
reviewer name/email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, never
echoes an ingested record's own stamp, and accepts NO free-form note or actor name. It is a content-free operational
FINALIZATION record ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a
deployment authorization, a promotion ledger, an incident record, or an audit log.

Usage:
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=<path> [related] [options]
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --file=<path> --plan=<path> --trend=<path> [options]
  cat receipt.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --stdin [related] [options]

Primary receipt (choose ONE mode; REQUIRED):
  --receipt=<path>           A \`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1\` document to finalize. \`--file=<path>\` is an alias.
  --stdin                    Read the primary receipt from stdin (one JSON object). Cannot combine with --receipt / --file.

Source-chain records (each OPTIONAL; supply what you have — the more of the chain, the stronger the coherence check):
  --plan=<path>              A \`pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1\` (cross-checked against what the receipt recorded).
  --trend=<path>             A \`pdfxyz.release-decision-closeout-governance-finalize-index-trend/1\` (cross-checked against what the plan / receipt recorded).
  --index=<path>             A \`pdfxyz.release-decision-closeout-governance-finalize-index/1\` (cross-checked against the trend's newest-window posture).
  --finalization=<path>      A \`pdfxyz.release-decision-closeout-governance-finalize/1\` (cross-checked against the index's newest finalization posture).

Policy (small bounded knobs):
  --require-plan             Require a usable plan; else the loop is INCOMPLETE (exit 2).
  --require-trend            Require a usable trend; else the loop is INCOMPLETE (exit 2).
  --require-index            Require a usable index; else the loop is INCOMPLETE (exit 2).
  --require-finalization     Require a usable finalization bundle; else the loop is INCOMPLETE (exit 2).
  --strict-open              Escalate an open finalization (an advisory source chain) or an incomplete primary receipt to a
                             blocking hold (exit 4 instead of 3 / 2). Blocking / invalid outcomes are unaffected.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A governance-review-friendly summary (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  FINALIZED  — a usable, completed primary receipt and every supplied source-chain record coherent
  1  USAGE      — the CLI was misused (a bad flag, no primary receipt supplied, or an unwritable output)
  2  INCOMPLETE — an incomplete receipt, a required-but-missing / unreadable record, or an inconclusive source chain
  3  OPEN       — an advisory / open source-chain record
  4  BLOCKED    — a blocked / invalid receipt verdict, a contradictory record, a blocked source chain, or a --strict-open escalation
  4  INVALID    — an unreadable / tampered / wrong-schema primary receipt, or a tampered supplied source-chain record`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-decision-closeout-governance-finalize-index-trend-finalize argv (already sliced past `node script`).
 * Deterministic and side-effect-free: it validates flags, rejects conflicting formats / duplicate single-value flags /
 * unknown options / a missing value, requires exactly one primary receipt input mode, rejects a `--stdin` + `--receipt`
 * combination, and never reads the environment or filesystem.
 */
export function parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgsResult {
  let format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let receiptPath: string | undefined;
  let stdin = false;
  let planPath: string | undefined;
  let trendPath: string | undefined;
  let indexPath: string | undefined;
  let finalizationPath: string | undefined;
  let requirePlan = false;
  let requireTrend = false;
  let requireIndex = false;
  let requireFinalization = false;
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
        case "--require-finalization":
          requireFinalization = true;
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
        case "--finalization":
          if (finalizationPath !== undefined) return { ok: false, message: "Duplicate --finalization option." };
          finalizationPath = value;
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
  // vacuous finalized. (Whether the supplied receipt + records finalize a coherent loop is a RUN concern, resolved by the
  // fold — a run without a usable primary receipt is honestly `finalize-invalid`, never a finalized.)
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
      requireFinalization,
      strictOpen,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(receiptPath !== undefined ? { receiptPath } : {}),
      ...(planPath !== undefined ? { planPath } : {}),
      ...(trendPath !== undefined ? { trendPath } : {}),
      ...(indexPath !== undefined ? { indexPath } : {}),
      ...(finalizationPath !== undefined ? { finalizationPath } : {}),
    },
  };
}
