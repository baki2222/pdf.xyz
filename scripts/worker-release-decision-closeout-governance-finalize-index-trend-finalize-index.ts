#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout governance finalize index trend finalize INDEX — the offline,
 * content-free, read-only finalization-history index CLI.
 *
 * `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index` ingests a bounded history of
 * content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` FINALIZATION records (Phase
 * 79 output — supplied oldest → newest as `--file=` paths or a `--stdin` JSON array / NDJSON stream), RE-VALIDATES each
 * against ITSELF (reconstructing its bounded finalization rollup from the primary-receipt source facets + per-kind
 * related-record signals + policy it recorded, and re-running the SAME tested Phase 79 fold — so a hand-flipped
 * finalization verdict / exit / rollup, or a flipped cross-check / posture signal, is caught as a tamper), and folds the
 * recent finalization postures into ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1`
 * result: a finalization-verdict distribution, a bounded summary of the newest usable finalization, a per-record posture
 * sequence, a final index verdict + bounded reasons, and an ordered next-action checklist — so a governance review can
 * FAIL CLOSED when the recent history cannot be trusted or is inconclusive.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-governance-finalize-index-trend-finalize-index/`; this file only reads
 * argv, reads the record files / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index`).
 *
 * Honesty & privacy:
 *  - It is a content-free finalization-history INDEX SUMMARY ONLY, NOT a legal / compliance sign-off, an external
 *    approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an
 *    audit log: it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / plan /
 *    receipt / closeout / governance / finalize itself, and NEVER signs, approves, publishes, promotes, deploys,
 *    notifies, deletes, prunes, uploads, or mutates anything. It accepts NO free-form note or actor name — only bounded
 *    record inputs and policy flags. Its explicit caveats say so.
 *  - Its output is content-free by construction: every ingested record is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes an ingested record's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: a tampered / unreadable record in the history is `index-invalid` (exit 4, the TOP precedence,
 *    never a vacuous indexed); a `finalize-blocked` latest / any blocked record, or a `--strict-open` escalation, is
 *    `index-blocked` (exit 4); a `finalize-incomplete` latest / threshold breach, a `--require-latest-finalized` miss, or
 *    zero usable records is `index-incomplete` (exit 2); a `finalize-open` latest / threshold breach is `index-open`
 *    (exit 3); a coherent all-finalized history is `indexed` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE REVIEW
 * over the archived finalization records:
 *   pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index --file=fin-1.json --file=fin-2.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_USAGE,
  parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs,
  runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndex,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexProvider,
} from "@/lib/workers/release-decision-closeout-governance-finalize-index-trend-finalize-index";
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

const provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(
      `${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_USAGE}\n`,
    );
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_EXIT.INDEXED;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndex(
    parsed.args,
    provider,
  );
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout governance finalize index trend finalize index output.\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_EXIT.USAGE;
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
    // compose the index → INVALID (the history can't be trusted), never a false "indexed".
    process.exit(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_EXIT.INVALID);
  });
