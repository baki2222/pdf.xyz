#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision ledger index — the offline, content-free, read-only index CLI.
 *
 * `pnpm worker:release-decision-index` ingests a bounded batch of content-free `pdfxyz.release-decision/1` decision
 * records a release pipeline already produced (a sprint / month of release decisions), RE-VALIDATES each record
 * against ITSELF (re-deriving its Phase 59 decision, so a hand-flipped decision is caught as a tamper), and emits
 * ONE stable ledger index summary: the decision distribution, per-source posture counts, a per-record posture
 * sequence, a final index verdict + bounded reasons, and an ordered next-action checklist — so a release-decision
 * review can FAIL CLOSED when the batch is blocked / inconclusive or a record cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-decision-index/`;
 * this file only reads argv, reads the record files / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is
 * invoked only as `pnpm worker:release-decision-index`).
 *
 * Honesty & privacy:
 *  - It is a local content-free ledger INDEX SUMMARY over decision records, NOT a legal audit log, a compliance
 *    attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger: it makes
 *    NO network call, reads NO secret/bucket/object, RUNS no gate / bundle / audit / report / decision itself, and
 *    NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates anything.
 *    Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested record is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes an ingested record's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: an unreadable / tampered record is `invalid` (exit 4, never a vacuous pass); a rejected /
 *    invalid decision, or a `--strict` violation, is `blocked` (exit 4); zero usable records or an insufficient
 *    decision is `insufficient` (exit 2); a follow-up / hold decision is `watch` (exit 3); a clean batch is `stable`
 *    (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand REVIEW over
 * the archived per-release decision records (oldest first, newest last):
 *   pnpm worker:release-decision-index --file=decisions/d1.json --file=decisions/d2.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_INDEX_EXIT,
  RELEASE_DECISION_INDEX_USAGE,
  parseReleaseDecisionIndexArgs,
  runReleaseDecisionIndex,
  type ReleaseDecisionIndexProvider,
} from "@/lib/workers/release-decision-index";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file / the stdin payload; content-free records are tiny. */
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

const provider: ReleaseDecisionIndexProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionIndexArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_INDEX_USAGE}\n`);
    return RELEASE_DECISION_INDEX_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_INDEX_USAGE}\n`);
    return RELEASE_DECISION_INDEX_EXIT.STABLE;
  }

  const { output, exitCode } = await runReleaseDecisionIndex(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision index output.\n\n${RELEASE_DECISION_INDEX_USAGE}\n`,
      );
      return RELEASE_DECISION_INDEX_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine internal fault means we could
    // not compose the index → INVALID (the input can't be trusted), never a false "stable batch".
    process.exit(RELEASE_DECISION_INDEX_EXIT.INVALID);
  });
