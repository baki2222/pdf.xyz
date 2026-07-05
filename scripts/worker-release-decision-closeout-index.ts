#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision closeout index — the offline, content-free, read-only index CLI.
 *
 * `pnpm worker:release-decision-closeout-index` ingests a bounded history of content-free
 * `pdfxyz.release-decision-closeout/1` closeout records a release pipeline already produced (a sprint / quarter of
 * release closeouts), RE-VALIDATES each record against ITSELF (re-deriving its Phase 64 closeout rollup from its own
 * recorded receipt-source + related-record signals + policy, so a hand-flipped closeout verdict / exit / rollup is
 * caught as a tamper), and emits ONE stable closeout-index summary: the closeout-verdict distribution, the latest /
 * oldest closeout verdict, a per-record posture sequence, a final index verdict + bounded reasons, and an ordered
 * next-action checklist — so a release-closeout review can FAIL CLOSED when the history is blocked / inconclusive or a
 * closeout cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-decision-closeout-index/`; this file only reads argv, reads the closeout files / stdin,
 * writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is
 * invoked only as `pnpm worker:release-decision-closeout-index`).
 *
 * Honesty & privacy:
 *  - It is a local content-free closeout-ledger INDEX SUMMARY over closeout records, NOT a legal audit log, a
 *    compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / receipt
 *    / closeout itself, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or
 *    mutates anything. Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested closeout is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes an ingested closeout's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: a tampered closeout, a blocked latest / threshold breach, or a `--strict-open` escalation is
 *    `index-blocked` (exit 4, never a vacuous pass); an unreadable closeout, an incomplete latest / breach, or zero
 *    usable closeouts is `index-incomplete` (exit 2); an open latest / breach is `index-open` (exit 3); a coherent
 *    history is `indexed` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand REVIEW over the
 * archived per-release closeout records (oldest first, newest last):
 *   pnpm worker:release-decision-closeout-index --file=closeouts/c1.json --file=closeouts/c2.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_CLOSEOUT_INDEX_EXIT,
  RELEASE_DECISION_CLOSEOUT_INDEX_USAGE,
  parseReleaseDecisionCloseoutIndexArgs,
  runReleaseDecisionCloseoutIndex,
  type ReleaseDecisionCloseoutIndexProvider,
} from "@/lib/workers/release-decision-closeout-index";
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

const provider: ReleaseDecisionCloseoutIndexProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionCloseoutIndexArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_CLOSEOUT_INDEX_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_CLOSEOUT_INDEX_USAGE}\n`);
    return RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.INDEXED;
  }

  const { output, exitCode } = await runReleaseDecisionCloseoutIndex(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision closeout index output.\n\n${RELEASE_DECISION_CLOSEOUT_INDEX_USAGE}\n`,
      );
      return RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.USAGE;
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
    // not compose the index → BLOCKED (the input can't be trusted), never a false "indexed history".
    process.exit(RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.BLOCKED);
  });
