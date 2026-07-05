/**
 * The node-free **orchestrator** for the release decision closeout governance action-plan execution receipt CLI
 * (Phase 73).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-governance-action-receipt.ts`) is a thin shell: it resolves argv, reads the
 * plan file / stdin, writes the output, and exits. That keeps every branch — each input mode, the ingest failure modes,
 * the plan self-validation, the acknowledgement fold, and both output formats — unit-testable without a runtime, a
 * filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestGovernancePlan}): a plan file that cannot be read or
 * parsed becomes an UNRECOGNIZED plan (⇒ a `blocked` receipt — nothing trustworthy to receipt, path never echoed); a
 * recognized-but-self-inconsistent plan is a tamper (⇒ a `blocked` receipt); a usable plan resolves against the
 * acknowledgements its class requires. A run NEVER throws on an operational/input problem — those become a structured
 * result + exit code; only a genuine internal fault propagates, to be caught by the entry's top-level handler and mapped
 * to BLOCKED.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / plan / governance / closeout
 * itself, and deletes / uploads / promotes / mutates nothing: it ingests ONE plan
 * `worker:release-decision-closeout-governance-action-plan` already produced plus bounded operator acknowledgement flags
 * and records whether the plan's required follow-ups were acknowledged.
 */

import { buildGovernanceActionReceiptResult } from "./build";
import { UNRECOGNIZED_PLAN, ingestGovernancePlan, type IngestedGovernancePlan } from "./ingest";
import { recordReleaseDecisionCloseoutGovernanceActionReceipt } from "./metrics";
import { renderReleaseDecisionCloseoutGovernanceActionReceipt } from "./render";
import {
  releaseDecisionCloseoutGovernanceActionReceiptExitCode,
  type ReleaseDecisionCloseoutGovernanceActionReceiptPolicy,
  type ReleaseDecisionCloseoutGovernanceActionReceiptResult,
} from "./types";
import type { ReleaseDecisionCloseoutGovernanceActionReceiptArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read the plan file's text; its throw is caught → an `unreadable` plan (never echoed). Called once,
 *                  only in `--plan` / `--file` mode;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an `unreadable` plan.
 *                  Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutGovernanceActionReceiptProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutGovernanceActionReceiptRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutGovernanceActionReceiptResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(
  args: ReleaseDecisionCloseoutGovernanceActionReceiptArgs,
): ReleaseDecisionCloseoutGovernanceActionReceiptPolicy {
  return {
    strictOpen: args.strictOpen,
    ack: {
      plan: args.ackPlan,
      executed: args.ackExecuted,
      monitor: args.ackMonitor,
      investigation: args.ackInvestigation,
      block: args.ackBlock,
    },
  };
}

/**
 * Parse one plan payload into a root value, then reduce it through the trust boundary. A blank / unparseable payload
 * yields the UNRECOGNIZED plan (⇒ a `blocked` receipt) — it never throws and never echoes the path.
 */
function ingestPayload(text: string): IngestedGovernancePlan {
  if (text.trim() === "") return UNRECOGNIZED_PLAN;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_PLAN;
  }
  return ingestGovernancePlan(root);
}

/**
 * Read + ingest the ONE plan, from either a `--plan` / `--file` file or a `--stdin` payload. A missing / unreadable
 * input yields the UNRECOGNIZED plan (⇒ a `blocked` receipt) — never a throw and never a fabricated receipt.
 */
async function ingestOne(
  args: ReleaseDecisionCloseoutGovernanceActionReceiptArgs,
  provider: ReleaseDecisionCloseoutGovernanceActionReceiptProvider,
): Promise<IngestedGovernancePlan> {
  let text: string;
  try {
    text = args.stdin ? await provider.readStdin() : await provider.readFile(args.planPath ?? "");
  } catch {
    return UNRECOGNIZED_PLAN;
  }
  return ingestPayload(text);
}

/**
 * Run the release-decision-closeout-governance-action-receipt CLI for validated `args` using the injected `provider`.
 * Never throws on input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutGovernanceActionReceipt(
  args: ReleaseDecisionCloseoutGovernanceActionReceiptArgs,
  provider: ReleaseDecisionCloseoutGovernanceActionReceiptProvider,
): Promise<ReleaseDecisionCloseoutGovernanceActionReceiptRun> {
  const ingested = await ingestOne(args, provider);
  const result = buildGovernanceActionReceiptResult(provider.now(), ingested, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutGovernanceActionReceipt(result.governanceActionReceipt.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutGovernanceActionReceiptExitCode(result),
    output: renderReleaseDecisionCloseoutGovernanceActionReceipt(result, args.format, args.pretty),
    result,
  };
}
