#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout governance finalize index trend action-plan execution receipt — the
 * offline, content-free, read-only receipt CLI.
 *
 * `pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt` ingests ONE content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1` follow-up plan a release pipeline
 * already produced plus bounded operator acknowledgement flags, RE-VALIDATES the plan against ITSELF (reconstructing its
 * Phase 77 bounded decision from the source-trend details it recorded and re-running the Phase 77 `computeActionPlan`
 * reducer, so a hand-flipped plan verdict / action class / exit code is caught as a tamper), and emits ONE stable
 * receipt: a receipt verdict + the resolved plan class, a bounded acknowledgement checklist, a bounded rationale, and a
 * content-free receipt — so a release-governance review can FAIL CLOSED when the plan cannot be trusted or a required
 * acknowledgement is absent.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-governance-finalize-index-trend-action-receipt/`; this file only reads
 * argv, reads the plan file / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt`).
 *
 * Honesty & privacy:
 *  - It is a content-free operational acknowledgement receipt ONLY, NOT a legal / compliance sign-off, an external
 *    approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an
 *    audit log: it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend /
 *    finalize / plan / governance / closeout itself, and NEVER signs, approves, publishes, promotes, deploys, notifies,
 *    deletes, prunes, uploads, or mutates anything. It accepts NO free-form note or actor name — only bounded
 *    acknowledgement flags, and it never claims an action was executed unless `--ack-executed` was supplied. Its
 *    explicit caveats say so.
 *  - Its output is content-free by construction: the ingested plan is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes the ingested plan's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: a missing / unreadable / tampered plan, or a plan whose own verdict is invalid, is `invalid`
 *    (exit 4); a block-release plan, a contradictory acknowledgement, or a `--strict-open` escalation is `blocked`
 *    (exit 4); a missing required acknowledgement for a clear / monitor / investigate plan is `incomplete` (exit 2); a
 *    usable, closeable plan with its required acknowledgements is `completed` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE step
 * over the archived finalize-index-trend follow-up plan:
 *   pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt --plan=plan.json --ack-plan --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_USAGE,
  parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptArgs,
  runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceipt,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptProvider,
} from "@/lib/workers/release-decision-closeout-governance-finalize-index-trend-action-receipt";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on the ingested file / the stdin payload; a content-free plan is tiny. */
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MiB

/** Read a file's text, bounding its size first. Throws on any failure (caught by the runner). */
function readBounded(path: string): string {
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return readFileSync(path, "utf8");
}

/** Read the whole stdin payload (`--stdin` mode), bounded. Throws on any failure. */
function readStdin(): string {
  const text = readFileSync(0, "utf8");
  if (text.length > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return text;
}

const provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(
      `${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_USAGE}\n`,
    );
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.COMPLETED;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceipt(
    parsed.args,
    provider,
  );
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout governance finalize index trend action receipt output.\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine internal fault means we could not
    // compose the receipt → INVALID (the input can't be trusted), never a false "completed receipt".
    process.exit(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT.INVALID);
  });
