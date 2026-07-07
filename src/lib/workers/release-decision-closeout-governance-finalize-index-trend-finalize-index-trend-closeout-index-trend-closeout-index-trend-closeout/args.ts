/**
 * Pure, node-free **parser** for the release decision closeout governance finalize index trend finalize index trend
 * closeout bundle CLI
 * (`pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs} with no side effects,
 * environment reads, or I/O, so every branch (each input, the related records, the require flags, the format, `--help`,
 * and every malformed case) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout.ts`) is the
 * only place that reads the real `argv`, reads the receipt / related files / stdin, writes the output, and exits.
 *
 * Inputs (choose ONE primary mode): a single `--receipt=<path>` (alias `--file=<path>`), OR `--stdin` (one JSON receipt
 * document). Exactly one primary input is required — an empty invocation has no receipt to close out and must never be a
 * vacuous closeout. The OPTIONAL related records (`--plan` / `--trend`) and the `--require-*` flags are
 * additive. No input path is ever echoed. The CLI accepts NO free-form note or actor name.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--receipt` / `--file` was supplied: the ONE primary receipt document to close out. */
  receiptPath?: string;
  /** True when the receipt is read from stdin (one JSON receipt document). */
  stdin: boolean;
  /** Present iff `--plan` was supplied: the OPTIONAL action-plan the receipt receipted (a cross-check). */
  planPath?: string;
  /** Present iff `--trend` was supplied: the OPTIONAL trend the plan planned over (a cross-check). */
  trendPath?: string;
  /** `--require-plan`: the plan related record is REQUIRED (its absence is a coverage gap ⇒ incomplete). */
  requirePlan: boolean;
  /** `--require-trend`: the trend related record is REQUIRED. */
  requireTrend: boolean;
  /** `--strict-open`: an open closeout escalates to `blocked`. */
  strictOpen: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgsResult =
  | {
      ok: true;
      kind: "run";
      args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs;
    }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<
  string,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutFormat
> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--strict-open", "--require-plan", "--require-trend"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--receipt", "--file", "--plan", "--trend"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_USAGE = `pdf.xyz secure-worker release decision closeout governance finalize index trend finalize index trend closeout bundle

Ingests ONE content-free \`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1\`
action-plan execution receipt (Phase 93) plus OPTIONAL related records already on hand — the \`…-action-plan/1\` plan the
receipt receipted and the \`…-closeout-index-trend/1\` trend the plan planned over — RE-VALIDATES the primary receipt
against ITSELF, CROSS-CHECKS the supplied related records against what the receipt recorded, and records whether the
closeout-index-trend follow-up loop reads as closed out.
It emits ONE stable, content-free
\`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1\` closeout bundle: a
closeout verdict, a bounded primary-receipt summary, a bounded related-record checklist, a bounded source-chain posture,
a bounded rationale + next actions, and a content-free receipt. It answers ONE question for a governance review: "Is this
closeout-index-trend follow-up loop CLOSED OUT — the action-plan receipt completed and the supplied related records
coherent — or is it still OPEN, INCOMPLETE, BLOCKED, or untrustworthy (INVALID)?"

It is local, offline, and READ-ONLY: it INGESTS records the release-decision workers already produced; it RUNS no gate /
index / decision / trend / plan / receipt / governance / finalize itself, makes NO network call, reads NO secret/bucket/
object, and NEVER archives, deletes, prunes, uploads, promotes, approves, signs, notifies, or mutates anything. It carries
no reviewer name/email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte,
never echoes any ingested record's own stamp, and accepts NO free-form note or actor name. It is a content-free
operational closeout SUMMARY ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity
proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.

Usage:
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout --receipt=<path> [related] [options]
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout --file=<path> [related] [options]
  cat receipt.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout --stdin [related] [options]

Primary input (choose ONE mode):
  --receipt=<path>           A \`…-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1\` document to close out. \`--file=<path>\` is an alias.
  --stdin                    Read the receipt document from stdin (one JSON object). Cannot combine with --receipt / --file.

Related records (OPTIONAL; supply the ones you have — each is re-validated against itself and cross-checked):
  --plan=<path>              The \`…-action-plan/1\` plan the receipt receipted (a cross-check; a mismatch fails closed).
  --trend=<path>             The \`…-closeout-index-trend/1\` trend the plan planned over (a cross-check; a mismatch fails closed).

Require (make a related record MANDATORY for a high-assurance review; its absence ⇒ incomplete):
  --require-plan             The plan related record must be supplied.
  --require-trend            The trend related record must be supplied.

Policy:
  --strict-open              Escalate an OPEN closeout (a followup-open receipt) to a hard block — a \`closed or blocked\`
                             gate for a high-assurance review. It never weakens the invalid / incomplete precedence.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A review-friendly closeout (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  CLOSED     — the receipt is usable and COMPLETED, and every supplied related record is coherent
  1  USAGE      — the CLI was misused (a bad flag, no receipt supplied, or an unwritable output)
  2  INCOMPLETE — an incomplete receipt, or a missing required related record
  3  OPEN       — a followup-open receipt
  4  BLOCKED    — a blocked receipt, or a --strict-open escalation of an open closeout
  4  INVALID    — a missing / unreadable / tampered / wrong-schema receipt, an invalid receipt verdict, or a supplied
                  related record that contradicts the receipt / is tampered / is unreadable (an incoherent chain)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the closeout argv (already sliced past `node script`). Deterministic and side-effect-free: it validates flags,
 * rejects conflicting formats / duplicate `--output` / duplicate receipt / duplicate related records / unknown options /
 * a missing value, requires exactly one primary input mode, rejects a `--stdin` + `--receipt` combination, and never
 * reads the environment or filesystem.
 */
export function parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgsResult {
  let format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let receiptPath: string | undefined;
  let stdin = false;
  let planPath: string | undefined;
  let trendPath: string | undefined;
  let requirePlan = false;
  let requireTrend = false;
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
            return { ok: false, message: "Supply exactly one receipt: --receipt / --file may be given only once." };
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
  // Exactly one primary input mode is required — an empty invocation has no receipt to close out and must never be a
  // vacuous closeout. (Whether the supplied receipt closes out is a RUN concern, resolved by the fold.)
  if (receiptPath === undefined && !stdin) {
    return {
      ok: false,
      message: "Supply exactly one receipt: --receipt=<path>, --file=<path>, or --stdin.",
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
      strictOpen,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(receiptPath !== undefined ? { receiptPath } : {}),
      ...(planPath !== undefined ? { planPath } : {}),
      ...(trendPath !== undefined ? { trendPath } : {}),
    },
  };
}
