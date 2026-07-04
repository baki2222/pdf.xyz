#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence governance bundle — the offline, content-free, read-only bundle CLI.
 *
 * `pnpm worker:release-governance` ingests a content-free `pdfxyz.release-trend/1` window summary (the PRIMARY
 * governance signal a release pipeline already produced) plus, optionally, the latest `pdfxyz.release-report/1`
 * and/or `pdfxyz.release-audit/1`, RE-VALIDATES each document against ITSELF (re-deriving the trend's Phase 53
 * verdict, the report's Phase 52 recommendation, and the audit's Phase 51 rollup, so a hand-flipped verdict is
 * caught as a tamper), cross-checks the latest report against the trend's own newest report, and emits ONE
 * stable governance bundle: the evidence coverage, per-source summaries, a governance verdict + bounded reasons,
 * an archive checklist, and an ordered follow-up assignment list — so a weekly / monthly governance review can
 * FAIL CLOSED when the window is blocked or a document cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-governance/`;
 * this file only reads argv, reads the documents / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is
 * invoked only as `pnpm worker:release-governance`).
 *
 * Honesty & privacy:
 *  - It is local content-free GOVERNANCE BUNDLING over evidence summaries, NOT signing, auth, cloud validation,
 *    storage retention ENFORCEMENT, deployment APPROVAL, or deployment PROMOTION: it makes NO network call,
 *    reads NO secret/bucket/object, RUNS no gate / bundle / audit / report / trend itself, and NEVER deletes,
 *    prunes, uploads, promotes, approves, or mutates anything. Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested document is reduced to bounded enums, small
 *    counts, and booleans by the trust boundary; it never echoes an ingested document's own stamp, and no input
 *    file path is ever embedded in the output or printed on an error.
 *  - It fails CLOSED: an absent / unreadable / unknown trend, an indeterminate latest, or a required-but-missing
 *    document is `incomplete` (exit 2); a tampered document, a failing trend, a hold-fail report, or a blocking
 *    audit regression is `blocked` (exit 4); an advisory posture is `watch` (exit 3); and a distinct 1 is CLI
 *    misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a SCHEDULED governance-review
 * artifact over the archived trend + latest report / audit:
 *   pnpm worker:release-governance --trend=trend.json --report=latest-report.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_GOVERNANCE_EXIT,
  RELEASE_GOVERNANCE_USAGE,
  parseReleaseGovernanceArgs,
  runReleaseGovernance,
  type ReleaseGovernanceProvider,
} from "@/lib/workers/release-governance";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file / the stdin payload; content-free documents are tiny. */
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MiB

/** Read a file's text, bounding its size first. Throws on any failure (caught by the runner). */
function readBounded(path: string): string {
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return readFileSync(path, "utf8");
}

/** Read the whole stdin payload (only when a `-` input was supplied), bounded. Throws on any failure. */
function readStdin(): string {
  const text = readFileSync(0, "utf8");
  if (text.length > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return text;
}

const provider: ReleaseGovernanceProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseGovernanceArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_GOVERNANCE_USAGE}\n`);
    return RELEASE_GOVERNANCE_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_GOVERNANCE_USAGE}\n`);
    return RELEASE_GOVERNANCE_EXIT.HEALTHY;
  }

  const { output, exitCode } = await runReleaseGovernance(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release governance output.\n\n${RELEASE_GOVERNANCE_USAGE}\n`);
      return RELEASE_GOVERNANCE_EXIT.USAGE;
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
    // could not compose the bundle → INCOMPLETE (insufficient), never a false "healthy window".
    process.exit(RELEASE_GOVERNANCE_EXIT.INCOMPLETE);
  });
