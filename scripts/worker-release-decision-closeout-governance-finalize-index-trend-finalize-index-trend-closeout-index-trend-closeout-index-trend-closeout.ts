#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout governance finalize index trend finalize index trend closeout bundle —
 * the offline, content-free, read-only closeout CLI.
 *
 * `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout` ingests ONE
 * content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1`
 * action-plan execution receipt (Phase 93) a release pipeline already produced, plus OPTIONAL related records already on
 * hand — the `…-action-plan/1` plan and the `…-closeout-index-trend/1` trend — RE-VALIDATES the primary receipt against
 * ITSELF (reconstructing its Phase 93 bounded plan-ingest from the source facets it recorded and re-running the Phase 93
 * `computeReceipt` reducer, so a hand-flipped receipt verdict / ack coverage / exit code is caught as a tamper),
 * CROSS-CHECKS each supplied related record against what the receipt recorded, and emits ONE stable closeout bundle — so a
 * release-governance review can FAIL CLOSED when the follow-up loop cannot be trusted or a required related record is
 * absent.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/`; this file
 * only reads argv, reads the receipt / related files / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout`).
 *
 * Honesty & privacy:
 *  - It is a content-free operational closeout SUMMARY ONLY, NOT a legal / compliance sign-off, an external approval /
 *    signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / receipt /
 *    governance / finalize / closeout itself, and NEVER signs, approves, publishes, promotes, deploys, notifies,
 *    archives, deletes, prunes, uploads, or mutates anything.
 *  - Its output is content-free by construction: every ingested record is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes any record's own stamp, and no input file path is ever embedded in
 *    the output or printed on an error.
 *  - It fails CLOSED: a missing / unreadable / tampered / wrong-schema receipt (or an invalid receipt verdict), or a
 *    supplied related record that contradicts the receipt / is tampered / is unreadable (an incoherent chain), is
 *    `invalid` (exit 4); a blocked receipt or a `--strict-open` escalation of an open closeout is `blocked` (exit 4); a
 *    followup-open receipt is `open` (exit 3); an incomplete receipt or a missing required related record is `incomplete`
 *    (exit 2); a usable, completed receipt with coherent related records is `closed` (exit 0); and a distinct 1 is CLI
 *    misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE step
 * over the archived closeout-index-trend-closeout-index-trend follow-up receipt:
 *   pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout --receipt=receipt.json --plan=plan.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_USAGE,
  parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs,
  runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutProvider,
} from "@/lib/workers/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on any ingested file / the stdin payload; a content-free record is tiny. */
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

const provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutArgs(
    process.argv.slice(2),
  );
  if (!parsed.ok) {
    process.stderr.write(
      `${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_USAGE}\n`,
    );
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(
      `${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_USAGE}\n`,
    );
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.CLOSED;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseout(
    parsed.args,
    provider,
  );
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout governance finalize index trend finalize index trend closeout output.\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.USAGE;
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
    // compose the closeout → INVALID (the input can't be trusted), never a false "closed" closeout.
    process.exit(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_EXIT.INVALID);
  });
