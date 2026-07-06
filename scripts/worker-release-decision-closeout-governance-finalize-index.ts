#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout governance finalize index — the offline, content-free, read-only
 * index CLI.
 *
 * `pnpm worker:release-decision-closeout-governance-finalize-index` ingests a bounded history of content-free
 * `pdfxyz.release-decision-closeout-governance-finalize/1` finalization bundles a release pipeline already produced (a
 * sprint / quarter of finalized closeout-governance chains), RE-VALIDATES each record against ITSELF (re-deriving its
 * Phase 74 finalization rollup from its own recorded primary-receipt source facets + related-record signals + policy, so
 * a hand-flipped finalization verdict / exit / rollup is caught as a tamper), and emits ONE stable finalization-index
 * summary: the finalization-verdict distribution, a bounded summary of the newest usable finalization, a per-record
 * posture sequence, a final index verdict + bounded reasons, and an ordered next-action checklist — so a finalization
 * review can FAIL CLOSED when the history is untrustworthy / blocked / inconclusive or a bundle cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-governance-finalize-index/`; this file only reads argv, reads the bundle
 * files / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is invoked
 * only as `pnpm worker:release-decision-closeout-governance-finalize-index`).
 *
 * Honesty & privacy:
 *  - It is a local content-free finalization-history INDEX SUMMARY over finalization bundles, NOT a legal audit log, a
 *    compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / receipt /
 *    closeout / governance / finalize itself, and NEVER signs, approves, publishes, promotes, deploys, notifies,
 *    deletes, prunes, uploads, or mutates anything. Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested bundle is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes an ingested bundle's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: a tampered or unreadable bundle is `index-invalid` (exit 4, never a vacuous pass); a blocked
 *    latest / any blocked bundle, or a `--strict-open` escalation, is `index-blocked` (exit 4); an incomplete latest /
 *    breach, a require-latest miss, or zero usable bundles is `index-incomplete` (exit 2); an open latest / breach is
 *    `index-open` (exit 3); a coherent history is `indexed` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand REVIEW over the
 * archived per-release finalization bundles (oldest first, newest last):
 *   pnpm worker:release-decision-closeout-governance-finalize-index --file=f1.json --file=f2.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_USAGE,
  parseReleaseDecisionCloseoutGovernanceFinalizeIndexArgs,
  runReleaseDecisionCloseoutGovernanceFinalizeIndex,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexProvider,
} from "@/lib/workers/release-decision-closeout-governance-finalize-index";
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

const provider: ReleaseDecisionCloseoutGovernanceFinalizeIndexProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT.INDEXED;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutGovernanceFinalizeIndex(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout governance finalize index output.\n\n${RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT.USAGE;
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
    // not compose the index → INVALID (the input can't be trusted), never a false "indexed history".
    process.exit(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_EXIT.INVALID);
  });
