#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout governance index trend — the offline, content-free, read-only trend
 * CLI.
 *
 * `pnpm worker:release-decision-closeout-governance-index-trend` ingests a bounded history of content-free
 * `pdfxyz.release-decision-closeout-governance-index/1` windows a release pipeline already produced (a quarter / year of
 * weekly, monthly, or quarterly governance-index summaries), RE-VALIDATES each window against ITSELF (re-deriving its
 * Phase 70 index verdict from its own recorded ledger AND re-checking those counts against the window's own per-record
 * sequence, so a hand-flipped index is caught as a tamper), and emits ONE stable trend summary: the per-window
 * index-verdict distribution, the aggregate governance distribution, a per-window posture sequence, an arc direction +
 * trend class, a final trend verdict + bounded reasons, and an ordered next-action checklist — so a release-governance
 * review can FAIL CLOSED when the history is blocked / inconclusive or a window cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-governance-index-trend/`; this file only reads argv, reads the window files
 * / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout-governance-index-trend`).
 *
 * Honesty & privacy:
 *  - It is a local content-free governance-index TREND SUMMARY over governance-index windows, NOT a legal audit log, a
 *    compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / receipt
 *    / closeout / governance itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes,
 *    uploads, or mutates anything. Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested window is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes an ingested window's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: a tampered window, a blocked latest / threshold breach, or a `--strict-watch` escalation is
 *    `trend-blocked` (exit 4, never a vacuous pass); an open latest / breach or a degrading arc is `trend-watch` (exit
 *    3); an unreadable window, an incomplete latest / breach, or zero usable windows is `trend-incomplete` (exit 2); a
 *    coherent history is `trend-stable` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE review
 * over the archived per-review-period governance-index windows (oldest first, newest last):
 *   pnpm worker:release-decision-closeout-governance-index-trend --file=indexes/q1.json --file=indexes/q2.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_USAGE,
  parseReleaseDecisionCloseoutGovernanceIndexTrendArgs,
  runReleaseDecisionCloseoutGovernanceIndexTrend,
  type ReleaseDecisionCloseoutGovernanceIndexTrendProvider,
} from "@/lib/workers/release-decision-closeout-governance-index-trend";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file / the stdin payload; content-free windows are tiny. */
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

const provider: ReleaseDecisionCloseoutGovernanceIndexTrendProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutGovernanceIndexTrendArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT.STABLE;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutGovernanceIndexTrend(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout governance index trend output.\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT.USAGE;
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
    // compose the trend → BLOCKED (the input can't be trusted), never a false "stable history".
    process.exit(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT.BLOCKED);
  });
