#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence trend summary — the offline, content-free, read-only trend CLI.
 *
 * `pnpm worker:release-trend` ingests a bounded history of content-free `pdfxyz.release-report/1` operator
 * reports a release pipeline already produced (a week / month of release handoffs), RE-VALIDATES each report
 * against ITSELF (re-deriving its Phase 52 recommendation, so a hand-flipped recommendation is caught as a
 * tamper), and emits ONE stable trend summary: the recommendation distribution, a per-report posture sequence,
 * a final trend verdict + bounded reasons, and an ordered follow-up checklist — so a weekly / monthly
 * governance review can FAIL CLOSED when the recent trend is failing or a report cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-trend/`;
 * this file only reads argv, reads the report files / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and
 * is invoked only as `pnpm worker:release-trend`).
 *
 * Honesty & privacy:
 *  - It is local content-free TREND REPORTING over evidence reports, NOT signing, auth, cloud validation,
 *    storage retention ENFORCEMENT, deployment APPROVAL, or deployment PROMOTION: it makes NO network call,
 *    reads NO secret/bucket/object, RUNS no gate / bundle / audit / report itself, and NEVER deletes, prunes,
 *    uploads, promotes, approves, or mutates anything. Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested report is reduced to bounded enums, small
 *    counts, and booleans by the trust boundary; it never echoes an ingested report's own stamp, and no input
 *    file path is ever embedded in the output or printed on an error.
 *  - It fails CLOSED: an unreadable / empty history, or a needs-evidence newest, is `unknown` (exit 2); a
 *    tampered report, a hold-fail newest / threshold, or a required not-ready tip is `failing` (exit 4); an
 *    advisory trend is `warning` (exit 3); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED governance summary
 * over the archived per-release reports (oldest first, newest last):
 *   pnpm worker:release-trend --report=reports/r1.json --report=reports/r2.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_TREND_EXIT,
  RELEASE_TREND_USAGE,
  parseReleaseTrendArgs,
  runReleaseTrend,
  type ReleaseTrendProvider,
} from "@/lib/workers/release-trend";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file / the stdin payload; content-free reports are tiny. */
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

const provider: ReleaseTrendProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseTrendArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_TREND_USAGE}\n`);
    return RELEASE_TREND_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_TREND_USAGE}\n`);
    return RELEASE_TREND_EXIT.STABLE;
  }

  const { output, exitCode } = await runReleaseTrend(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release trend output.\n\n${RELEASE_TREND_USAGE}\n`);
      return RELEASE_TREND_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine internal fault means we
    // could not summarize the history → UNKNOWN (insufficient), never a false "stable trend".
    process.exit(RELEASE_TREND_EXIT.UNKNOWN);
  });
