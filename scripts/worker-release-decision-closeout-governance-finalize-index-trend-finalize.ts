#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout governance finalize index trend FINALIZATION record — the offline,
 * content-free, read-only finalization CLI.
 *
 * `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize` composes the content-free
 * finalize-index-trend follow-up loop — a REQUIRED
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` primary receipt (Phase 78) plus,
 * optionally, the source-chain records it was built from (the Phase 77 follow-up plan, the Phase 76 finalize-index trend,
 * the Phase 75 finalize index, and the Phase 74 finalization bundle) — into ONE stable, content-free FINAL record. It
 * RE-VALIDATES each supplied record against ITSELF (reconstructing its bounded decision from the facts it recorded and
 * re-running the SAME tested reducer that phase used — the Phase 78 `computeReceipt` for the primary receipt, the Phase
 * 74–77 boundaries for the source-chain records, so a hand-flipped verdict / ack coverage / exit code is caught as a
 * tamper), CROSS-CHECKS each supplied record against what its downstream record recorded (a swapped / edited record is a
 * contradiction), folds every supplied source-chain record's own bounded posture, and emits ONE
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` result: a finalization verdict + bounded
 * reasons, a per-source posture, a source-chain checklist, and an ordered next-action list — so a governance review can
 * FAIL CLOSED when the loop cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-governance-finalize-index-trend-finalize/`; this file only reads argv, reads
 * the record files / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize`).
 *
 * Honesty & privacy:
 *  - It is a content-free operational FINALIZATION record ONLY, NOT a legal / compliance sign-off, an external approval /
 *    signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / finalize / plan /
 *    governance / closeout / receipt itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes,
 *    prunes, uploads, or mutates anything. It accepts NO free-form note or actor name — only bounded record inputs and
 *    policy flags. Its explicit caveats say so.
 *  - Its output is content-free by construction: every ingested record is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes an ingested record's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: an unreadable / tampered / wrong-schema primary receipt, or a tampered supplied source, is
 *    `finalize-invalid` (exit 4, never a vacuous finalized); a `blocked` / `invalid` receipt verdict, a contradictory
 *    record, a blocked source chain, or a `--strict-open` escalation is `finalize-blocked` (exit 4); an incomplete
 *    receipt, a required-but-missing / unreadable record, or an inconclusive source chain is `finalize-incomplete` (exit
 *    2); an advisory source chain is `finalize-open` (exit 3); a usable, completed receipt with every supplied record
 *    coherent is `finalized` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE step
 * over the archived finalize-index-trend follow-up loop:
 *   pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize --receipt=receipt.json --plan=plan.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_USAGE,
  parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs,
  runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeProvider,
} from "@/lib/workers/release-decision-closeout-governance-finalize-index-trend-finalize";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file / the stdin payload; a content-free record is tiny. */
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

const provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(
      `${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_USAGE}\n`,
    );
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT.FINALIZED;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalize(
    parsed.args,
    provider,
  );
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout governance finalize index trend finalize output.\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT.USAGE;
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
    // compose the record → INVALID (the loop can't be trusted), never a false "finalized".
    process.exit(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT.INVALID);
  });
