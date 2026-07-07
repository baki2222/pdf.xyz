/**
 * The node-free **orchestrator** for the release decision closeout governance finalize index trend finalize index trend closeout index trend action-plan execution
 * receipt CLI (Phase 78).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt.ts`) is a thin shell: it
 * resolves argv, reads the plan file / stdin, writes the output, and exits. That keeps every branch — each input mode,
 * the ingest failure modes, the plan self-validation, the acknowledgement fold, and both output formats — unit-testable
 * without a runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan}): a plan file that
 * cannot be read or parsed becomes an UNRECOGNIZED plan (⇒ an `invalid` receipt — nothing trustworthy to receipt, path
 * never echoed); a recognized-but-self-inconsistent plan is a tamper (⇒ an `invalid` receipt); a usable plan resolves
 * against the acknowledgements its class requires. A run NEVER throws on an operational/input problem — those become a
 * structured result + exit code; only a genuine internal fault propagates, to be caught by the entry's top-level handler
 * and mapped to INVALID.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / finalize / plan / governance /
 * closeout itself, and deletes / uploads / promotes / mutates nothing: it ingests ONE plan
 * `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan` already produced plus bounded operator
 * acknowledgement flags and records whether the plan's required acknowledgements were supplied.
 */

import { buildFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptResult } from "./build";
import {
  UNRECOGNIZED_PLAN,
  ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan,
  type IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan,
} from "./ingest";
import { recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt } from "./metrics";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt } from "./render";
import {
  releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptExitCode,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptResult,
} from "./types";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read the plan file's text; its throw is caught → an `unreadable` plan (never echoed). Called once,
 *                  only in `--plan` / `--file` mode;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an `unreadable` plan.
 *                  Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptArgs,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptPolicy {
  return {
    strictOpen: args.strictOpen,
    ack: {
      plan: args.ackPlan,
      clear: args.ackClear,
      monitor: args.ackMonitor,
      investigation: args.ackInvestigation,
      block: args.ackBlock,
    },
  };
}

/**
 * Parse one plan payload into a root value, then reduce it through the trust boundary. A blank / unparseable payload
 * yields the UNRECOGNIZED plan (⇒ an `invalid` receipt) — it never throws and never echoes the path.
 */
function ingestPayload(text: string): IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan {
  if (text.trim() === "") return UNRECOGNIZED_PLAN;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_PLAN;
  }
  return ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan(root);
}

/**
 * Read + ingest the ONE plan, from either a `--plan` / `--file` file or a `--stdin` payload. A missing / unreadable
 * input yields the UNRECOGNIZED plan (⇒ an `invalid` receipt) — never a throw and never a fabricated receipt.
 */
async function ingestOne(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptProvider,
): Promise<IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan> {
  let text: string;
  try {
    text = args.stdin ? await provider.readStdin() : await provider.readFile(args.planPath ?? "");
  } catch {
    return UNRECOGNIZED_PLAN;
  }
  return ingestPayload(text);
}

/**
 * Run the release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt CLI for validated `args` using the
 * injected `provider`. Never throws on input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptProvider,
): Promise<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptRun> {
  const ingested = await ingestOne(args, provider);
  const result = buildFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptResult(provider.now(), ingested, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt(result.actionReceipt.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceiptExitCode(result),
    output: renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionReceipt(result, args.format, args.pretty),
    result,
  };
}
