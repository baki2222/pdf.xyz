/**
 * The node-free **orchestrator** for the release decision closeout governance index trend action plan CLI (Phase 72).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-governance-action-plan.ts`) is a thin shell: it resolves argv, reads the
 * trend file / stdin, writes the output, and exits. That keeps every branch — each input mode, the ingest failure modes,
 * the trend self-validation, the fold, and both output formats — unit-testable without a runtime, a filesystem, or a
 * subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestGovernanceTrend}): a trend file that cannot be read or
 * parsed becomes an UNRECOGNIZED trend (⇒ a `block-release` plan, `reject-input`, path never echoed); a recognized-but-
 * self-inconsistent trend is a tamper (⇒ a `block-release` plan); a `trend-blocked` trend is `block-release`; a
 * `trend-incomplete` trend is `investigate`; a `trend-watch` trend is a follow-up `monitor`; a `trend-stable` trend is a
 * clear plan. A run NEVER throws on an operational/input problem — those become a structured result + exit code; only a
 * genuine internal fault propagates, to be caught by the entry's top-level handler and mapped to BLOCK.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / governance / closeout itself, and
 * deletes / uploads / promotes / mutates nothing: it ingests ONE trend
 * `worker:release-decision-closeout-governance-index-trend` already produced and translates its bounded, already
 * content-free verdict into an operator follow-up plan.
 */

import { buildGovernanceActionPlanResult } from "./build";
import { UNRECOGNIZED_TREND, ingestGovernanceTrend, type IngestedGovernanceTrend } from "./ingest";
import { recordReleaseDecisionCloseoutGovernanceActionPlan } from "./metrics";
import { renderReleaseDecisionCloseoutGovernanceActionPlan } from "./render";
import {
  releaseDecisionCloseoutGovernanceActionPlanExitCode,
  type ReleaseDecisionCloseoutGovernanceActionPlanPolicy,
  type ReleaseDecisionCloseoutGovernanceActionPlanResult,
} from "./types";
import type { ReleaseDecisionCloseoutGovernanceActionPlanArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read the trend file's text; its throw is caught → an `unreadable` trend (never echoed). Called once,
 *                  only in `--trend` / `--file` mode;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an `unreadable` trend.
 *                  Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutGovernanceActionPlanProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutGovernanceActionPlanRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutGovernanceActionPlanResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(
  args: ReleaseDecisionCloseoutGovernanceActionPlanArgs,
): ReleaseDecisionCloseoutGovernanceActionPlanPolicy {
  return { strictWatch: args.strictWatch };
}

/**
 * Parse one trend payload into a root value, then reduce it through the trust boundary. A blank / unparseable payload
 * yields the UNRECOGNIZED trend (⇒ a `block-release` / `reject-input` plan) — it never throws and never echoes the path.
 */
function ingestPayload(text: string): IngestedGovernanceTrend {
  if (text.trim() === "") return UNRECOGNIZED_TREND;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_TREND;
  }
  return ingestGovernanceTrend(root);
}

/**
 * Read + ingest the ONE trend, from either a `--trend` / `--file` file or a `--stdin` payload. A missing / unreadable
 * input yields the UNRECOGNIZED trend (⇒ a `block-release` plan) — never a throw and never a fabricated plan.
 */
async function ingestOne(
  args: ReleaseDecisionCloseoutGovernanceActionPlanArgs,
  provider: ReleaseDecisionCloseoutGovernanceActionPlanProvider,
): Promise<IngestedGovernanceTrend> {
  let text: string;
  try {
    text = args.stdin ? await provider.readStdin() : await provider.readFile(args.trendPath ?? "");
  } catch {
    return UNRECOGNIZED_TREND;
  }
  return ingestPayload(text);
}

/**
 * Run the release-decision-closeout-governance-action-plan CLI for validated `args` using the injected `provider`. Never
 * throws on input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutGovernanceActionPlan(
  args: ReleaseDecisionCloseoutGovernanceActionPlanArgs,
  provider: ReleaseDecisionCloseoutGovernanceActionPlanProvider,
): Promise<ReleaseDecisionCloseoutGovernanceActionPlanRun> {
  const ingested = await ingestOne(args, provider);
  const result = buildGovernanceActionPlanResult(provider.now(), ingested, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutGovernanceActionPlan(result.governanceActionPlan.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutGovernanceActionPlanExitCode(result),
    output: renderReleaseDecisionCloseoutGovernanceActionPlan(result, args.format, args.pretty),
    result,
  };
}
