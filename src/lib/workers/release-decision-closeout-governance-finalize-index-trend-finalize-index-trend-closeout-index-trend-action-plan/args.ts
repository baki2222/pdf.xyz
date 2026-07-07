/**
 * Pure, node-free **parser** for the release decision closeout governance finalize index trend finalize index trend closeout index trend action plan CLI
 * (`pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan`).
 *
 * Like the rest of the release-evidence parsers, it maps `process.argv` to a validated
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgs} with no side effects, environment reads, or
 * I/O, so every branch (each input, the format, the policy knobs, `--help`, and every malformed case) is unit-tested
 * deterministically. The CLI entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan.ts`) is the only place that
 * reads the real `argv`, reads the trend / stdin, writes the output, and exits.
 *
 * Inputs (choose ONE mode): a single `--trend=<path>` (alias `--file=<path>`), OR `--stdin` (one JSON trend document).
 * Exactly one input is required — an empty invocation has nothing to plan over and must never be a vacuous clear plan. No
 * input path is ever echoed.
 */

import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanFormat } from "./render";

/** The validated arguments the CLI hands to the runner. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgs {
  /** Output format (default `json`). */
  format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanFormat;
  /** Pretty JSON output. Defaults true; explicit so tests can pin behavior. */
  pretty: boolean;
  /** Present iff `--output` was supplied: where the Node entry writes the rendered output. */
  outputPath?: string;
  /** Present iff `--trend` / `--file` was supplied: the ONE trend document to plan over. */
  trendPath?: string;
  /** True when the trend is read from stdin (one JSON trend document). */
  stdin: boolean;
  /** `--strict-watch`: a `monitor` plan (a watch / degrading trend) escalates to `block-release`. */
  strictWatch: boolean;
  /** `--require-clean`: every non-`clear` plan escalates to `block-release`. */
  requireClean: boolean;
}

/** Outcome of parsing argv: run with args, show help, or a usage error. */
export type ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgsResult =
  | { ok: true; kind: "run"; args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgs }
  | { ok: true; kind: "help" }
  | { ok: false; message: string };

/** Format selector flags (mutually exclusive; default `json`). */
const FORMAT_FLAGS: Record<string, ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanFormat> = {
  "--json": "json",
  "--text": "text",
};

/** Boolean flags (no value). */
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--strict-watch", "--require-clean"]);

/** The value flags (each takes a value from `--flag=value` or the next argv token). */
const VALUE_FLAGS = new Set(["--output", "--trend", "--file"]);

/** Human-readable usage, printed on `--help` or a parse error. */
export const RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_PLAN_USAGE = `pdf.xyz secure-worker release decision closeout governance finalize index trend finalize index trend closeout index trend action plan

Ingests ONE content-free \`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/1\` summary (Phase 86) and
translates its bounded verdict into ONE stable, content-free
\`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/1\` operator follow-up plan — a plan verdict
+ urgency + action class, the surfaced source trend verdict / class / arc / latest closeout-index posture, an ordered
next-action checklist, and a bounded receipt. It re-validates the trend against ITSELF and answers ONE question for a
governance review: "Given this content-free closeout-index trend, what bounded follow-up plan should an operator run
next, and with what urgency?"

It is local, offline, and READ-ONLY: it INGESTS a trend \`worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend\`
already produced; it RUNS no gate / index / decision / trend / closeout / governance / finalize itself, makes NO network
call, reads NO secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, approves, signs, or mutates anything.
It carries no reviewer name/email, filename, path, object key, bucket, URL, raw ref, raw label, raw note, size, digest, or
byte, and never echoes the ingested trend's own stamp. It is a content-free operational follow-up plan ONLY — NOT a legal
/ compliance sign-off, an external approval / signature, an identity proof, a deployment authorization, a promotion
ledger, an incident record, or an audit log.

Usage:
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --trend=<path> [options]
  pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --file=<path> [options]
  cat trend.json | pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan --stdin [options]

Inputs (choose ONE mode):
  --trend=<path>             A \`pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/1\` document to plan over.
                             \`--file=<path>\` is an alias.
  --stdin                    Read the trend document from stdin (one JSON object). Cannot combine with --trend / --file.

Policy (small bounded knobs):
  --strict-watch             Escalate a \`monitor\` plan (a watch / degrading trend) to block release — a hard
                             \`consistently closed or block\` gate for a high-assurance review. Never fabricates approval
                             for a stable / improving trend.
  --require-clean            Require an improving / stable trend: escalate EVERY non-clear plan (monitor / investigate) to
                             block release. Never weakens the invalid precedence of an untrustworthy input.

Output:
  --output=<path>            Write the rendered output to a file instead of stdout. The path is never embedded in the
                             output or printed on errors.
  --pretty                   Pretty-print JSON (default for JSON output; accepted for explicitness).

Format (choose at most one; default: --json):
  --json                     Stable JSON, suitable for a CI artifact / governance record / SIEM to parse.
  --text                     A review-friendly plan (CI-summary ready).

  -h, --help                 Show this help.

Exit codes (higher = worse; 1 is a distinct "the CLI was misused" band):
  0  CLEAR        — a clear plan (a coherent stable / improving closeout-index history)
  1  USAGE        — the CLI was misused (a bad flag, no trend supplied, or an unwritable output)
  2  INVESTIGATE  — an investigate plan (an insufficient, inconclusive trend)
  3  MONITOR      — a monitor plan requiring follow-up (a watch / degrading trend)
  4  BLOCK        — a block-release plan (a blocked / invalid-history trend, or a --strict-watch / --require-clean
                    escalation), or an invalid plan (an unreadable / tampered trend input)`;

/** Split `--flag=value` into a name and an optional inline value. */
function toFlag(token: string): { name: string; inlineValue?: string } {
  const eq = token.indexOf("=");
  return eq === -1 ? { name: token } : { name: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

/**
 * Parse the release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan argv (already sliced past `node
 * script`). Deterministic and side-effect-free: it validates flags, rejects conflicting formats / duplicate `--output` /
 * duplicate trend / unknown options / a missing value, requires exactly one input mode, rejects a `--stdin` + `--trend`
 * combination, and never reads the environment or filesystem.
 */
export function parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgs(
  argv: readonly string[],
): ParseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgsResult {
  let format: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanFormat | undefined;
  let pretty = true;
  let outputPath: string | undefined;
  let trendPath: string | undefined;
  let stdin = false;
  let strictWatch = false;
  let requireClean = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    const { name, inlineValue } = toFlag(token);

    if (name === "-h" || name === "--help") return { ok: true, kind: "help" };

    if (BOOL_FLAGS.has(name)) {
      if (name === "--pretty") pretty = true;
      else if (name === "--stdin") stdin = true;
      else if (name === "--strict-watch") strictWatch = true;
      else if (name === "--require-clean") requireClean = true;
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
        case "--trend":
        case "--file":
          if (trendPath !== undefined) {
            return {
              ok: false,
              message: "Supply exactly one trend: --trend / --file may be given only once.",
            };
          }
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

  if (trendPath !== undefined && stdin) {
    return { ok: false, message: "--stdin cannot be combined with --trend / --file." };
  }
  // Exactly one input mode is required — an empty invocation has nothing to plan over and must never be a vacuous clear
  // plan. (Whether the supplied trend plans clean is a RUN concern, resolved by the fold.)
  if (trendPath === undefined && !stdin) {
    return {
      ok: false,
      message: "Supply exactly one trend: --trend=<path>, --file=<path>, or --stdin.",
    };
  }

  return {
    ok: true,
    kind: "run",
    args: {
      format: format ?? "json",
      pretty,
      stdin,
      strictWatch,
      requireClean,
      ...(outputPath !== undefined ? { outputPath } : {}),
      ...(trendPath !== undefined ? { trendPath } : {}),
    },
  };
}
