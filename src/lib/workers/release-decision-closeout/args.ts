/**
 * Pure, node-free **parser** for the release decision closeout bundle CLI (`pnpm worker:release-decision-closeout`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated {@link ReleaseDecisionCloseoutArgs}
 * with no side effects, environment reads, or I/O, so every branch (each input, the related-record paths, the require
 * flags, the format, `--help`, and every malformed case) is unit-tested deterministically. The CLI entry
 * (`scripts/worker-release-decision-closeout.ts`) is the only place that reads the real `argv`, reads the files / stdin,
 * writes the output, and exits.
 *
 * Primary input (choose ONE mode): a single `--receipt=<path>` (alias `--file=<path>`), OR `--stdin` (one JSON receipt
 * document). Exactly one primary input is required — an empty invocation has no receipt to close out and must never be a
 * vacuous `closed` closeout. Optional related records (`--plan` / `--trend` / `--decision` / `--index`) are separate
 * files, each supplied at most once and each `--require-<kind>`-able. No input path is ever echoed.
 */

import type { ReleaseDecisionCloseoutFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--receipt` / `--file` was supplied: the ONE primary receipt document to close out. */
  receiptPath?: string;
  /** True when the primary receipt is read from stdin (one JSON receipt document). */
  stdin: boolean;
  /** Present iff `--plan` was supplied: the optional `pdfxyz.release-decision-action-plan/1` cross-check record. */
  planPath?: string;
  /** Present iff `--trend` was supplied: the optional `pdfxyz.release-decision-trend/1` cross-check record. */
  trendPath?: string;
  /** Present iff `--decision` was supplied: the optional `pdfxyz.release-decision/1` decision-ledger record. */
  decisionPath?: string;
  /** Present iff `--index` was supplied: the optional `pdfxyz.release-decision-index/1` decision-index record. */
  indexPath?: string;
  /** `--require-plan`: the plan cross-check record is REQUIRED (absent / unusable ⇒ incomplete). */
  requirePlan: boolean;
  /** `--require-trend`: the trend cross-check record is REQUIRED. */
  requireTrend: boolean;
  /** `--require-decision`: the decision-ledger record is REQUIRED. */
  requireDecision: boolean;
  /** `--require-index`: the decision-index record is REQUIRED. */
  requireIndex: boolean;
  /** `--strict-open`: an open closeout escalates to `closeout-blocked`. */
  strictOpen: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionCloseoutArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionCloseoutFormat> = {
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
  "--require-decision",
  "--require-index",
]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set([
  "--output",
  "--receipt",
  "--file",
  "--plan",
  "--trend",
  "--decision",
  "--index",
]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_USAGE = `pdf.xyz secure-worker release decision closeout bundle

Composes the release DECISION governance chain into ONE bounded closeout record. It ingests ONE content-free
\`pdfxyz.release-decision-action-receipt/1\` execution receipt (Phase 63; REQUIRED) plus OPTIONAL related records already
on hand — the \`pdfxyz.release-decision-action-plan/1\` plan the receipt receipted, the \`pdfxyz.release-decision-trend/1\`
trend the plan folded, and the \`pdfxyz.release-decision/1\` / \`pdfxyz.release-decision-index/1\` ledger records upstream —
re-validates the primary receipt against ITSELF, cross-checks the supplied related records against what the receipt
recorded, and emits ONE stable, content-free \`pdfxyz.release-decision-closeout/1\` record: a closeout verdict, the
primary receipt's state + verdict, a bounded related-record checklist, a bounded rationale, and a content-free receipt.
It answers ONE question for a governance review: "Is this release decision governance chain CLOSED OUT, still OPEN,
INCOMPLETE, or BLOCKED?"

It is local, offline, and READ-ONLY: it INGESTS records the release-decision workers already produced; it RUNS no gate /
index / decision / trend / plan / receipt itself, makes NO network call, reads NO secret/bucket/object, and NEVER
deletes, prunes, uploads, promotes, approves, signs, or mutates anything. It carries no reviewer name/email, filename,
path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte, never echoes any ingested record's
own stamp, and accepts NO free-form note or actor name. It is a content-free operational closeout SUMMARY ONLY — NOT a
legal / compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a
promotion ledger, an incident record, or an audit log.

Usage:
  pnpm worker:release-decision-closeout --receipt=<path> [related records] [options]
  pnpm worker:release-decision-closeout --file=<path> [related records] [options]
  cat receipt.json | pnpm worker:release-decision-closeout --stdin [related records] [options]

Primary receipt (choose ONE mode):
  --receipt=<path>           A \`pdfxyz.release-decision-action-receipt/1\` document to close out. \`--file=<path>\` is an alias.
  --stdin                    Read the primary receipt document from stdin. Cannot combine with --receipt / --file.

Related records (OPTIONAL; supply the SAME records this receipt's chain was built from — never a newer / different one):
  --plan=<path>              The \`pdfxyz.release-decision-action-plan/1\` plan the receipt receipted (a cross-check).
  --trend=<path>             The \`pdfxyz.release-decision-trend/1\` trend the plan folded (a cross-check).
  --decision=<path>          A \`pdfxyz.release-decision/1\` decision-ledger record upstream (a source-chain posture).
  --index=<path>             A \`pdfxyz.release-decision-index/1\` decision-index record upstream (a source-chain posture).

Require (make a related record MANDATORY; an absent / unusable required record is incomplete, never closed):
  --require-plan             Require the plan cross-check record.
  --require-trend            Require the trend cross-check record.
  --require-decision         Require the decision-ledger record.
  --require-index            Require the decision-index record.

Policy:
  --strict-open              Escalate an open closeout (a followup-open receipt or an advisory decision / index record)
                             to a hard block — a \`closed or blocked\` gate for a high-assurance review.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A review-friendly closeout (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  CLOSED     — the primary receipt completed and the supplied related records are coherent
  1  USAGE      — the CLI was misused (a bad flag, no receipt supplied, or an unwritable output)
  2  INCOMPLETE — a missing / unusable primary receipt, or a missing required related record (a coverage gap)
  3  OPEN       — a followup-open receipt, or an advisory decision / index record
  4  BLOCKED    — a tampered / blocked receipt, a contradictory / tampered related record, a blocked source chain, or a
                  --strict-open escalation`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-decision-closeout argv (already sliced past `node script`). Deterministic and side-effect-free: it
 * validates flags, rejects conflicting formats / duplicate `--output` / duplicate paths / unknown options / a missing
 * value, requires exactly one primary input mode, rejects a `--stdin` + `--receipt` combination, and never reads the
 * environment or filesystem.
 */
export function parseReleaseDecisionCloseoutArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutArgsResult {
  let format: ReleaseDecisionCloseoutFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let receiptPath: string | undefined;
  let stdin = false;
  let planPath: string | undefined;
  let trendPath: string | undefined;
  let decisionPath: string | undefined;
  let indexPath: string | undefined;
  let requirePlan = false;
  let requireTrend = false;
  let requireDecision = false;
  let requireIndex = false;
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
        case "--require-decision":
          requireDecision = true;
          break;
        case "--require-index":
          requireIndex = true;
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
            return {
              ok: false,
              message: "Supply exactly one primary receipt: --receipt / --file may be given only once.",
            };
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
        case "--decision":
          if (decisionPath !== undefined) return { ok: false, message: "Duplicate --decision option." };
          decisionPath = value;
          break;
        case "--index":
          if (indexPath !== undefined) return { ok: false, message: "Duplicate --index option." };
          indexPath = value;
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
  // vacuous closed closeout. (Whether the receipt closes out is a RUN concern, resolved by the fold.)
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
      requireDecision,
      requireIndex,
      strictOpen,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(receiptPath !== undefined ? { receiptPath } : {}),
      ...(planPath !== undefined ? { planPath } : {}),
      ...(trendPath !== undefined ? { trendPath } : {}),
      ...(decisionPath !== undefined ? { decisionPath } : {}),
      ...(indexPath !== undefined ? { indexPath } : {}),
    },
  };
}
