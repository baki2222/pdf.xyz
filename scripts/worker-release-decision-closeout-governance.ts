#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout governance bundle — the offline, content-free, read-only governance
 * CLI.
 *
 * `pnpm worker:release-decision-closeout-governance` ingests a REQUIRED content-free
 * `pdfxyz.release-decision-closeout-action-receipt/1` primary receipt plus, optionally, the related closeout-chain records
 * it was built from (a `pdfxyz.release-decision-closeout-action-plan/1`, a `pdfxyz.release-decision-closeout-index-trend/1`,
 * a `pdfxyz.release-decision-closeout-index/1`, and a `pdfxyz.release-decision-closeout/1`), RE-VALIDATES each against
 * ITSELF (reconstructing its bounded decision and re-running the SAME tested reducer that phase used, so a hand-flipped
 * verdict is caught as a tamper), CROSS-CHECKS the supplied plan / trend against what the receipt recorded, and emits ONE
 * stable bundle: a governance verdict + a per-source posture, a related-record checklist, an archive checklist, a bounded
 * follow-up assignment list, and a content-free receipt — so a release-governance review can FAIL CLOSED when the primary
 * receipt cannot be trusted or a supplied record contradicts / blocks the chain.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-governance/`; this file only reads argv, reads the record files / stdin,
 * writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout-governance`).
 *
 * Honesty & privacy:
 *  - It is a content-free operational governance bundle ONLY, NOT a legal / compliance sign-off, an external approval /
 *    signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / closeout /
 *    receipt itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or
 *    mutates anything. It accepts NO free-form note or actor name — only bounded record inputs and policy flags. Its
 *    explicit caveats say so.
 *  - Its output is content-free by construction: each ingested record is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes an ingested record's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: a tampered / blocked primary receipt, a contradictory / tampered related record, a blocked source
 *    chain, or a `--strict-open` escalation is `governance-blocked` (exit 4); a missing / unreadable / incomplete primary
 *    receipt, a required-but-missing record, or an inconclusive source chain is `governance-incomplete` (exit 2); a
 *    followup-open receipt or an advisory source chain is `governance-open` (exit 3); a usable completed receipt with a
 *    coherent chain is `closed` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE step
 * over the archived closeout chain:
 *   pnpm worker:release-decision-closeout-governance --receipt=receipt.json --plan=plan.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_USAGE,
  parseReleaseDecisionCloseoutGovernanceArgs,
  runReleaseDecisionCloseoutGovernance,
  type ReleaseDecisionCloseoutGovernanceProvider,
} from "@/lib/workers/release-decision-closeout-governance";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on the ingested file / the stdin payload; a content-free record is tiny. */
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

const provider: ReleaseDecisionCloseoutGovernanceProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutGovernanceArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT.CLOSED;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutGovernance(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout governance output.\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT.USAGE;
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
    // compose the bundle → BLOCKED (the input can't be trusted), never a false "closed".
    process.exit(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT.BLOCKED);
  });
