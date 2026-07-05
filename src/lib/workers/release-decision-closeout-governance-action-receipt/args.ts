/**
 * Pure, node-free **parser** for the release decision closeout governance action-plan execution receipt CLI
 * (`pnpm worker:release-decision-closeout-governance-action-receipt`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionCloseoutGovernanceActionReceiptArgs} with no side effects, environment reads, or I/O, so every
 * branch (each input, the format, the acknowledgement flags, `--help`, and every malformed case) is unit-tested
 * deterministically. The CLI entry (`scripts/worker-release-decision-closeout-governance-action-receipt.ts`) is the only
 * place that reads the real `argv`, reads the plan / stdin, writes the output, and exits.
 *
 * Inputs (choose ONE mode): a single `--plan=<path>` (alias `--file=<path>`), OR `--stdin` (one JSON plan document).
 * Exactly one input is required — an empty invocation has no plan to receipt and must never be a vacuous completed
 * receipt. No input path is ever echoed. The acknowledgement flags are BOOLEANS ONLY; the CLI accepts no free-form note
 * or actor name — extra details belong out-of-band, not in this content-free receipt.
 */

import type { ReleaseDecisionCloseoutGovernanceActionReceiptFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutGovernanceActionReceiptArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutGovernanceActionReceiptFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--plan` / `--file` was supplied: the ONE plan document to receipt. */
  planPath?: string;
  /** True when the plan is read from stdin (one JSON plan document). */
  stdin: boolean;
  /** `--ack-plan`: the operator confirms the plan was reviewed. */
  ackPlan: boolean;
  /** `--ack-executed`: the required next-action checklist was executed / worked. */
  ackExecuted: boolean;
  /** `--ack-monitor`: the monitor follow-up was acknowledged (for a monitor-class plan). */
  ackMonitor: boolean;
  /** `--ack-investigation`: the investigation was acknowledged (for an investigate-class plan). */
  ackInvestigation: boolean;
  /** `--ack-block`: the operator confirms the release remains BLOCKED, not promoted (for a block-class plan). */
  ackBlock: boolean;
  /** `--strict-open`: an open monitor follow-up escalates to `blocked`. */
  strictOpen: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutGovernanceActionReceiptArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionCloseoutGovernanceActionReceiptArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionCloseoutGovernanceActionReceiptFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set([
  "--pretty",
  "--stdin",
  "--strict-open",
  "--ack-plan",
  "--ack-executed",
  "--ack-monitor",
  "--ack-investigation",
  "--ack-block",
]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--plan", "--file"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_USAGE = `pdf.xyz secure-worker release decision closeout governance action-plan execution receipt

Ingests ONE content-free \`pdfxyz.release-decision-closeout-governance-action-plan/1\` follow-up plan (Phase 72) plus
bounded operator acknowledgement flags and records whether the plan's required follow-ups were acknowledged / executed
sufficiently to close it out — ONE stable, content-free \`pdfxyz.release-decision-closeout-governance-action-receipt/1\`
receipt: a receipt verdict, the resolved plan class, a bounded acknowledgement checklist, a bounded rationale, and a
content-free receipt. It re-validates the plan against ITSELF and answers ONE question for a governance review: "Given
this content-free governance follow-up plan and the operator's bounded acknowledgements, were the plan's required
follow-ups closed out?"

It is local, offline, and READ-ONLY: it INGESTS a plan \`worker:release-decision-closeout-governance-action-plan\` already
produced; it RUNS no gate / index / decision / trend / plan / governance / closeout itself, makes NO network call, reads
NO secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, approves, signs, or mutates anything. It carries
no reviewer name/email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or byte,
never echoes the ingested plan's own stamp, and accepts NO free-form note or actor name. It is a content-free operational
execution receipt ONLY — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a
deployment authorization, a promotion ledger, an incident record, or an audit log.

Usage:
  pnpm worker:release-decision-closeout-governance-action-receipt --plan=<path> [acknowledgements] [options]
  pnpm worker:release-decision-closeout-governance-action-receipt --file=<path> [acknowledgements] [options]
  cat plan.json | pnpm worker:release-decision-closeout-governance-action-receipt --stdin [acknowledgements] [options]

Inputs (choose ONE mode):
  --plan=<path>              A \`pdfxyz.release-decision-closeout-governance-action-plan/1\` document to receipt. \`--file=<path>\` is an alias.
  --stdin                    Read the plan document from stdin (one JSON object). Cannot combine with --plan / --file.

Acknowledgements (bounded booleans; supply the ones an operator ACTUALLY performed — never a note or an actor name):
  --ack-plan                 The operator confirms the plan was reviewed. Required for every plan class.
  --ack-executed             The required next-action checklist was executed / worked. Required for investigate /
                             monitor / block plans.
  --ack-monitor              The monitor follow-up was acknowledged. Required for a monitor-class plan.
  --ack-investigation        The investigation was acknowledged. Required for an investigate-class plan.
  --ack-block                Confirms the release remains BLOCKED (not promoted). Required for a block-class plan;
                             supplying it for any other class is a contradiction (fails closed).

Policy:
  --strict-open              Escalate an open monitor follow-up (a monitor plan whose monitor / executed ack is absent)
                             to a hard block — a \`closed-out or blocked\` gate for a high-assurance review.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A review-friendly receipt (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  COMPLETED     — the plan is usable and its class's required acknowledgements are all present
  1  USAGE         — the CLI was misused (a bad flag, no plan supplied, or an unwritable output)
  2  INCOMPLETE    — a missing required acknowledgement for a clear / investigate / held-block plan (a coverage gap)
  3  FOLLOWUP-OPEN — a monitor plan reviewed but its follow-up still open / not fully executed
  4  BLOCKED       — a missing / unreadable / tampered plan, a block plan not acknowledged as blocked, a --strict-open
                     escalation, or a contradictory acknowledgement`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-decision-closeout-governance-action-receipt argv (already sliced past `node script`). Deterministic
 * and side-effect-free: it validates flags, rejects conflicting formats / duplicate `--output` / duplicate plan / unknown
 * options / a missing value, requires exactly one input mode, rejects a `--stdin` + `--plan` combination, and never reads
 * the environment or filesystem.
 */
export function parseReleaseDecisionCloseoutGovernanceActionReceiptArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutGovernanceActionReceiptArgsResult {
  let format: ReleaseDecisionCloseoutGovernanceActionReceiptFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let planPath: string | undefined;
  let stdin = false;
  let ackPlan = false;
  let ackExecuted = false;
  let ackMonitor = false;
  let ackInvestigation = false;
  let ackBlock = false;
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
        case "--ack-plan":
          ackPlan = true;
          break;
        case "--ack-executed":
          ackExecuted = true;
          break;
        case "--ack-monitor":
          ackMonitor = true;
          break;
        case "--ack-investigation":
          ackInvestigation = true;
          break;
        case "--ack-block":
          ackBlock = true;
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
        case "--plan":
        case "--file":
          if (planPath !== undefined) {
            return { ok: false, message: "Supply exactly one plan: --plan / --file may be given only once." };
          }
          planPath = value;
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

  if (planPath !== undefined && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --plan / --file." };
  }
  // Exactly one input mode is required — an empty invocation has no plan to receipt and must never be a vacuous
  // completed receipt. (Whether the supplied plan closes out is a RUN concern, resolved by the fold.)
  if (planPath === undefined && !stdin) {
    return {
      ok: false,
      message: "Supply exactly one plan: --plan=<path>, --file=<path>, or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      ackPlan,
      ackExecuted,
      ackMonitor,
      ackInvestigation,
      ackBlock,
      strictOpen,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(planPath !== undefined ? { planPath } : {}),
    },
  };
}
