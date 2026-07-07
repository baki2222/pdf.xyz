/**
 * The node-free **orchestrator** for the release decision closeout governance finalize index trend finalize index trend
 * closeout index trend action plan CLI (Phase 87).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan.ts`) is a thin shell: it
 * resolves argv, reads the trend file / stdin, writes the output, and exits. That keeps every branch — each input mode,
 * the ingest failure modes, the trend self-validation, the fold, and both output formats — unit-testable without a
 * runtime, a filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestCloseoutIndexTrend}): a trend file that cannot be read
 * or parsed becomes an UNRECOGNIZED trend (⇒ an `invalid` plan, `reject-input`, path never echoed); a recognized-but-
 * self-inconsistent trend is a tamper (⇒ an `invalid` plan); a `blocked` / `invalid`-history trend is `block-release`; an
 * `insufficient` trend is `investigate`; a `watch` / `degrading` trend is a follow-up `monitor`; a `stable` / `improving`
 * trend is a clear plan. A run NEVER throws on an operational/input problem — those become a structured result + exit
 * code; only a genuine internal fault propagates, to be caught by the entry's top-level handler and mapped to BLOCK.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / closeout itself, and deletes /
 * uploads / promotes / mutates nothing: it ingests ONE trend
 * `worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend` already produced and translates its bounded,
 * already content-free verdict into an operator follow-up plan.
 */

import { buildCloseoutIndexTrendActionPlanResult } from "./build";
import {
  UNRECOGNIZED_TREND,
  ingestCloseoutIndexTrend,
  type IngestedCloseoutIndexTrend,
} from "./ingest";
import { recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan } from "./metrics";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan } from "./render";
import {
  releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanExitCode,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanResult,
} from "./types";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read the trend file's text; its throw is caught → an `unreadable` trend (never echoed). Called once,
 *                  only in `--trend` / `--file` mode;
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an `unreadable` trend.
 *                  Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgs,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanPolicy {
  return { strictWatch: args.strictWatch, requireClean: args.requireClean };
}

/**
 * Parse one trend payload into a root value, then reduce it through the trust boundary. A blank / unparseable payload
 * yields the UNRECOGNIZED trend (⇒ an `invalid` / `reject-input` plan) — it never throws and never echoes the path.
 */
function ingestPayload(text: string): IngestedCloseoutIndexTrend {
  if (text.trim() === "") return UNRECOGNIZED_TREND;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return UNRECOGNIZED_TREND;
  }
  return ingestCloseoutIndexTrend(root);
}

/**
 * Read + ingest the ONE trend, from either a `--trend` / `--file` file or a `--stdin` payload. A missing / unreadable
 * input yields the UNRECOGNIZED trend (⇒ an `invalid` plan) — never a throw and never a fabricated plan.
 */
async function ingestOne(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanProvider,
): Promise<IngestedCloseoutIndexTrend> {
  let text: string;
  try {
    text = args.stdin ? await provider.readStdin() : await provider.readFile(args.trendPath ?? "");
  } catch {
    return UNRECOGNIZED_TREND;
  }
  return ingestPayload(text);
}

/**
 * Run the release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan CLI for validated `args` using the
 * injected `provider`. Never throws on input: every operational/input problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanProvider,
): Promise<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanRun> {
  const ingested = await ingestOne(args, provider);
  const result = buildCloseoutIndexTrendActionPlanResult(provider.now(), ingested, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan(result.actionPlan.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanExitCode(result),
    output: renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlan(result, args.format, args.pretty),
    result,
  };
}
