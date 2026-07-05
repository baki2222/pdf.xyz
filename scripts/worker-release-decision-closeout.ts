#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout bundle — the offline, content-free, read-only closeout CLI.
 *
 * `pnpm worker:release-decision-closeout` composes the release DECISION governance chain into ONE bounded closeout
 * record. It ingests ONE content-free `pdfxyz.release-decision-action-receipt/1` execution receipt a release pipeline
 * already produced (REQUIRED) plus OPTIONAL related records already on hand (the `pdfxyz.release-decision-action-plan/1`
 * plan, the `pdfxyz.release-decision-trend/1` trend, and the `pdfxyz.release-decision/1` / `pdfxyz.release-decision-index/1`
 * ledger records), RE-VALIDATES the primary receipt against ITSELF (reconstructing its Phase 63 bounded decision from the
 * source facets it recorded and re-running the Phase 63 `computeReceipt` reducer, so a hand-flipped receipt verdict / ack
 * coverage / exit code is caught as a tamper), CROSS-CHECKS each supplied related record against what the receipt
 * recorded, and emits ONE stable `pdfxyz.release-decision-closeout/1` record: a closeout verdict + the primary receipt's
 * state / verdict, a bounded related-record checklist, a bounded rationale, and a content-free receipt — so a
 * release-governance review can FAIL CLOSED when the primary receipt cannot be trusted or a required related record is
 * absent.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-decision-closeout/`;
 * this file only reads argv, reads the receipt / related-record files / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout`).
 *
 * Honesty & privacy:
 *  - It is a content-free operational closeout SUMMARY ONLY, NOT a legal / compliance sign-off, an external approval /
 *    signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / receipt
 *    itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates
 *    anything. It accepts NO free-form note or actor name. Its explicit caveats say so.
 *  - Its output is content-free by construction: every ingested record is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes any ingested record's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: a missing / unreadable primary receipt is `closeout-incomplete` (exit 2, nothing to close out); a
 *    tampered / blocked receipt, a contradictory / tampered related record, a blocked source chain, or a `--strict-open`
 *    escalation is `closeout-blocked` (exit 4); a followup-open receipt or an advisory decision / index record is
 *    `closeout-open` (exit 3); a usable receipt whose verdict is completed with coherent related records is `closed`
 *    (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE step
 * over the archived governance records:
 *   pnpm worker:release-decision-closeout --receipt=receipt.json --plan=plan.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_EXIT,
  RELEASE_DECISION_CLOSEOUT_USAGE,
  parseReleaseDecisionCloseoutArgs,
  runReleaseDecisionCloseout,
  type ReleaseDecisionCloseoutProvider,
} from "@/lib/workers/release-decision-closeout";
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

const provider: ReleaseDecisionCloseoutProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_EXIT.CLOSED;
  }

  const { output, exitCode } = await runReleaseDecisionCloseout(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout output.\n\n${RELEASE_DECISION_CLOSEOUT_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_EXIT.USAGE;
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
    // compose the closeout → BLOCKED (the input can't be trusted), never a false "closed closeout".
    process.exit(RELEASE_DECISION_CLOSEOUT_EXIT.BLOCKED);
  });
