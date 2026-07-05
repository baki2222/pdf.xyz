#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout index trend action plan — the offline, content-free, read-only
 * planning CLI.
 *
 * `pnpm worker:release-decision-closeout-action-plan` ingests ONE content-free
 * `pdfxyz.release-decision-closeout-index-trend/1` summary a release pipeline already produced, RE-VALIDATES it against
 * ITSELF (re-deriving its Phase 66 trend verdict from its own recorded window summary and re-checking that summary
 * against the trend's own per-window posture sequence, so a hand-flipped trend verdict is caught as a tamper), and emits
 * ONE stable operator follow-up plan: a plan verdict + urgency + action class, the surfaced source trend verdict / class
 * / arc / latest index posture, an ordered next-action checklist, and a bounded receipt — so a release-governance review
 * can FAIL CLOSED when the trend is blocked / inconclusive or cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-action-plan/`; this file only reads argv, reads the trend file / stdin,
 * writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout-action-plan`).
 *
 * Honesty & privacy:
 *  - It is a content-free operational follow-up plan ONLY, NOT a legal / compliance sign-off, an external approval /
 *    signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / closeout itself,
 *    and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates anything.
 *    Its explicit caveats say so.
 *  - Its output is content-free by construction: the ingested trend is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes the ingested trend's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: an unreadable / tampered trend, or a `trend-blocked` trend, or a `--strict-watch` escalation is
 *    `block-release` (exit 4, never a vacuous pass); a `trend-incomplete` trend is `investigate` (exit 2); a
 *    `trend-watch` trend is a follow-up `monitor` (exit 3); a `trend-stable` trend is a clear plan (exit 0); and a
 *    distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE step
 * over the archived closeout-index trend:
 *   pnpm worker:release-decision-closeout-action-plan --trend=trend.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT,
  RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_USAGE,
  parseReleaseDecisionCloseoutActionPlanArgs,
  runReleaseDecisionCloseoutActionPlan,
  type ReleaseDecisionCloseoutActionPlanProvider,
} from "@/lib/workers/release-decision-closeout-action-plan";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on the ingested file / the stdin payload; a content-free trend is tiny. */
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

const provider: ReleaseDecisionCloseoutActionPlanProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutActionPlanArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT.CLEAR;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutActionPlan(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout action plan output.\n\n${RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT.USAGE;
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
    // compose the plan → BLOCK (the input can't be trusted), never a false "clear plan".
    process.exit(RELEASE_DECISION_CLOSEOUT_ACTION_PLAN_EXIT.BLOCK);
  });
