#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout action-plan execution receipt — the offline, content-free, read-only
 * receipt CLI.
 *
 * `pnpm worker:release-decision-closeout-action-receipt` ingests ONE content-free
 * `pdfxyz.release-decision-closeout-action-plan/1` follow-up plan a release pipeline already produced plus bounded
 * operator acknowledgement flags, RE-VALIDATES the plan against ITSELF (reconstructing its Phase 67 bounded decision from
 * the source-trend details it recorded and re-running the Phase 67 `computeCloseoutActionPlan` reducer, so a hand-flipped
 * plan verdict / action class / exit code is caught as a tamper), and emits ONE stable receipt: a receipt verdict + the
 * resolved plan class, a bounded acknowledgement checklist, a bounded rationale, and a content-free receipt — so a
 * release-governance review can FAIL CLOSED when the plan cannot be trusted or a required acknowledgement is absent.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-action-receipt/`; this file only reads argv, reads the plan file / stdin,
 * writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout-action-receipt`).
 *
 * Honesty & privacy:
 *  - It is a content-free operational execution receipt ONLY, NOT a legal / compliance sign-off, an external approval /
 *    signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / closeout
 *    itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates
 *    anything. It accepts NO free-form note or actor name — only bounded acknowledgement flags. Its explicit caveats say
 *    so.
 *  - Its output is content-free by construction: the ingested plan is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes the ingested plan's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: a missing / unreadable / tampered plan, an unacknowledged block plan, a contradictory
 *    acknowledgement, or a `--strict-open` escalation is `blocked` (exit 4); a missing required acknowledgement for a
 *    clear / investigate plan is `incomplete` (exit 2); a monitor plan reviewed but its follow-up still open is
 *    `followup-open` (exit 3); a usable plan with its required acknowledgements is `completed` (exit 0); and a distinct 1
 *    is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE step
 * over the archived closeout follow-up plan:
 *   pnpm worker:release-decision-closeout-action-receipt --plan=plan.json --ack-plan --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_USAGE,
  parseReleaseDecisionCloseoutActionReceiptArgs,
  runReleaseDecisionCloseoutActionReceipt,
  type ReleaseDecisionCloseoutActionReceiptProvider,
} from "@/lib/workers/release-decision-closeout-action-receipt";
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

const provider: ReleaseDecisionCloseoutActionReceiptProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutActionReceiptArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT.COMPLETED;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutActionReceipt(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout action receipt output.\n\n${RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT.USAGE;
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
    // compose the receipt → BLOCKED (the input can't be trusted), never a false "completed receipt".
    process.exit(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT.BLOCKED);
  });
