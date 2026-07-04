#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence operator report — the offline, content-free, read-only report CLI.
 *
 * `pnpm worker:release-report` ingests whichever of the content-free release-evidence composites a release job
 * already produced — a `pdfxyz.release-ci-bundle/1` (this release's evidence coherence, `--bundle`) and/or a
 * `pdfxyz.release-audit/1` (regression versus a baseline, `--audit`) — RE-VALIDATES each against ITSELF
 * (re-deriving its Phase 50/51 rollup, so a hand-flipped verdict is caught as a tamper), and emits ONE stable
 * operator report: the evidence coverage, per-source summaries, a final recommendation + bounded rationale, an
 * archive checklist, and an ordered next-action checklist — so a CI summary / deployment review / incident
 * handoff can FAIL CLOSED when the release cannot be certified promote-ready.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-report/`;
 * this file only reads argv, reads the documents / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and
 * is invoked only as `pnpm worker:release-report`).
 *
 * Honesty & privacy:
 *  - It is local content-free REPORTING over evidence, NOT signing, auth, cloud validation, storage retention
 *    ENFORCEMENT, deployment APPROVAL, or deployment PROMOTION: it makes NO network call, reads NO secret/
 *    bucket/object, RUNS no stage / bundle / audit itself, and NEVER deletes, prunes, uploads, promotes,
 *    approves, or mutates anything. Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested document is reduced to bounded enums, small
 *    counts, and booleans by the trust boundary, and no input file path is ever embedded in the output or
 *    printed on an error.
 *  - It fails CLOSED: a `promote-ready` requires a usable bundle that itself PASSED; an unreadable /
 *    indeterminate document, or an audit-only run with no usable bundle, is `needs-evidence` (exit 2); a
 *    tampered document / failed bundle / blocking regression is `hold-fail` (exit 4); an advisory concern is
 *    `hold-warning` (exit 3); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as the CI-summary / handoff step
 * AFTER `worker:release-ci-bundle` (and, optionally, `worker:release-audit`):
 *   pnpm worker:release-report --bundle=release-ci-bundle.json --audit=release-audit.json --text \
 *     >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_REPORT_EXIT,
  RELEASE_REPORT_USAGE,
  parseReleaseReportArgs,
  runReleaseReport,
  type ReleaseReportProvider,
} from "@/lib/workers/release-report";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file / the stdin payload; content-free composites are tiny. */
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MiB

/** Read a file's text, bounding its size first. Throws on any failure (caught by the runner). */
function readBounded(path: string): string {
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return readFileSync(path, "utf8");
}

/** Read the whole stdin payload (an input value of `-`), bounded. Throws on any failure. */
function readStdin(): string {
  const text = readFileSync(0, "utf8");
  if (text.length > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return text;
}

const provider: ReleaseReportProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseReportArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_REPORT_USAGE}\n`);
    return RELEASE_REPORT_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_REPORT_USAGE}\n`);
    return RELEASE_REPORT_EXIT.PROMOTE_READY;
  }

  const { output, exitCode } = await runReleaseReport(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release report output.\n\n${RELEASE_REPORT_USAGE}\n`);
      return RELEASE_REPORT_EXIT.USAGE;
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
    // could not compose the report → NEEDS-EVIDENCE (insufficient), never a false promote.
    process.exit(RELEASE_REPORT_EXIT.NEEDS_EVIDENCE);
  });
