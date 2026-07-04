#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision index trend summary — the offline, content-free, read-only trend CLI.
 *
 * `pnpm worker:release-decision-trend` ingests a bounded history of content-free `pdfxyz.release-decision-index/1`
 * ledger windows a release pipeline already produced (a quarter / year of weekly or monthly decision-index windows),
 * RE-VALIDATES each window against ITSELF (re-deriving its Phase 60 index verdict from its own recorded counts and
 * re-checking those counts against the window's own sequence, so a hand-flipped index is caught as a tamper), and
 * emits ONE stable trend summary: the per-window index-verdict distribution, the aggregate decision distribution, a
 * per-window posture sequence, an arc direction + trend class, a final trend verdict + bounded reasons, and an ordered
 * next-action checklist — so a release-governance review can FAIL CLOSED when the history is blocked / inconclusive or
 * a window cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-decision-trend/`;
 * this file only reads argv, reads the window files / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is
 * invoked only as `pnpm worker:release-decision-trend`).
 *
 * Honesty & privacy:
 *  - It is a local content-free ledger-index TREND SUMMARY over decision-index windows, NOT a legal audit log, a
 *    compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger:
 *    it makes NO network call, reads NO secret/bucket/object, RUNS no gate / index / decision itself, and NEVER signs,
 *    approves, publishes, promotes, deploys, notifies, deletes, prunes, uploads, or mutates anything. Its explicit
 *    caveats say so.
 *  - Its output is content-free by construction: each ingested window is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes an ingested window's own stamp, and no input file path is ever
 *    embedded in the output or printed on an error.
 *  - It fails CLOSED: an unreadable / tampered window is `invalid` (exit 4, never a vacuous pass); a blocked / invalid
 *    window, or a `--strict` violation, is `blocked` (exit 4); zero usable windows or an only-insufficient history is
 *    `insufficient` (exit 2); a watch / degrading history is `watch` / `degrading` (exit 3); a clean history is
 *    `stable` / `improving` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED or on-demand GOVERNANCE
 * review over the archived per-window decision indexes (oldest first, newest last):
 *   pnpm worker:release-decision-trend --file=windows/w1.json --file=windows/w2.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_TREND_EXIT,
  RELEASE_DECISION_TREND_USAGE,
  parseReleaseDecisionTrendArgs,
  runReleaseDecisionTrend,
  type ReleaseDecisionTrendProvider,
} from "@/lib/workers/release-decision-trend";
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

const provider: ReleaseDecisionTrendProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionTrendArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_TREND_USAGE}\n`);
    return RELEASE_DECISION_TREND_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_TREND_USAGE}\n`);
    return RELEASE_DECISION_TREND_EXIT.CLEAR;
  }

  const { output, exitCode } = await runReleaseDecisionTrend(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision trend output.\n\n${RELEASE_DECISION_TREND_USAGE}\n`,
      );
      return RELEASE_DECISION_TREND_EXIT.USAGE;
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
    // not compose the trend → INVALID (the input can't be trusted), never a false "clean history".
    process.exit(RELEASE_DECISION_TREND_EXIT.INVALID);
  });
