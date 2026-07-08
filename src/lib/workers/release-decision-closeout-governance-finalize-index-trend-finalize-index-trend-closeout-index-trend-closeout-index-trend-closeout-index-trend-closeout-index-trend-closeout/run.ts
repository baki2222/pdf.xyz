/**
 * The node-free **orchestrator** for the release decision closeout governance finalize index trend finalize index trend
 * closeout bundle CLI (Phase 94).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout.ts`) is a thin
 * shell: it resolves argv, reads the primary receipt file / stdin plus the optional related-record files, writes the
 * output, and exits. That keeps every branch — each input mode, the ingest failure modes, the primary-receipt
 * self-validation, the related-record cross-checks, and both output formats — unit-testable without a runtime, a
 * filesystem, or a subprocess.
 *
 * Honesty flows straight through the trust boundary ({@link ingestReceipt} / {@link ingestRelated}): a receipt file that
 * cannot be read or parsed becomes an UNRECOGNIZED receipt (⇒ an `invalid` closeout — nothing trustworthy to close out,
 * path never echoed); a recognized-but-self-inconsistent receipt is a tamper (⇒ `invalid`); a supplied related record is
 * cross-checked against the receipt, and a contradiction / tamper / unreadable / blocked source chain fails closed. A run
 * NEVER throws on an operational/input problem — those become a structured result + exit code; only a genuine internal
 * fault propagates, to be caught by the entry's top-level handler and mapped to INVALID.
 *
 * It reads NO secret, makes NO network call, runs no gate / index / decision / trend / plan / receipt itself, and
 * archives / deletes / uploads / promotes / mutates nothing: it ingests records the release-decision workers already
 * produced and records whether the follow-up loop reads as closed out.
 */

import { buildCloseoutResult } from "./build";
import {
  UNRECOGNIZED_RECEIPT,
  absentRecord,
  ingestRelated,
  ingestReceipt,
  type IngestedCloseoutReceipt,
  type IngestedRelatedRecord,
} from "./ingest";
import { recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout } from "./metrics";
import { renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout } from "./render";
import {
  releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutExitCode,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult,
} from "./types";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 *  - `now`       — stamp the result (behind a seam so tests are deterministic);
 *  - `readFile`  — read a file's text; its throw is caught → an `unreadable` record (never echoed). Called once per
 *                  supplied file path (the primary receipt in `--receipt` / `--file` mode, and each related record);
 *  - `readStdin` — read the whole stdin payload (`--stdin` mode only); its throw is caught → an `unreadable` receipt.
 *                  Never called unless `--stdin` was supplied.
 */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutProvider {
  now(): string;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult;
}

/** The applied policy knobs, reduced from the validated args. */
function policyOf(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPolicy {
  return {
    strictOpen: args.strictOpen,
    require: {
      plan: args.requirePlan,
      trend: args.requireTrend,
    },
  };
}

/** Parse one payload into a root value; a blank / unparseable payload yields `undefined` (never a throw). */
function parsePayload(text: string): unknown | undefined {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Read + ingest the ONE primary receipt, from either a `--receipt` / `--file` file or a `--stdin` payload. A missing /
 * unreadable input yields the UNRECOGNIZED receipt (⇒ an `invalid` closeout) — never a throw and never a fabricated
 * closeout.
 */
async function ingestReceiptInput(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutProvider,
): Promise<IngestedCloseoutReceipt> {
  let text: string;
  try {
    text = args.stdin ? await provider.readStdin() : await provider.readFile(args.receiptPath ?? "");
  } catch {
    return UNRECOGNIZED_RECEIPT;
  }
  const root = parsePayload(text);
  if (root === undefined) return UNRECOGNIZED_RECEIPT;
  return ingestReceipt(root);
}

/**
 * Read + ingest ONE optional related record of `kind` from `path`. An absent path yields an `absent` record; a missing /
 * unreadable file yields an `unreadable` record — never a throw and never an echoed path.
 */
async function ingestRelatedInput(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind,
  path: string | undefined,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutProvider,
): Promise<IngestedRelatedRecord> {
  if (path === undefined) return absentRecord(kind);
  let text: string;
  try {
    text = await provider.readFile(path);
  } catch {
    return { kind, state: "unreadable", facts: null };
  }
  const root = parsePayload(text);
  if (root === undefined) return { kind, state: "unreadable", facts: null };
  return ingestRelated(kind, root);
}

/**
 * Run the closeout CLI for validated `args` using the injected `provider`. Never throws on input: every operational/input
 * problem is a structured result + exit code.
 */
export async function runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
  args: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs,
  provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutProvider,
): Promise<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRun> {
  const receipt = await ingestReceiptInput(args, provider);
  const records = await Promise.all([
    ingestRelatedInput("plan", args.planPath, provider),
    ingestRelatedInput("trend", args.trendPath, provider),
  ]);
  const result = buildCloseoutResult(provider.now(), receipt, records, policyOf(args));

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(result.coverage.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutExitCode(result),
    output: renderReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
      result,
      args.format,
      args.pretty,
    ),
    result,
  };
}
