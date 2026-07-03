#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence CI bundle — the offline, content-free, read-only CI-bundle CLI.
 *
 * `pnpm worker:release-ci-bundle` composes whichever of the content-free release-evidence stage outputs
 * a release job already produced — a `pdfxyz.worker-release-gate/1` report (`--release-gate`), a
 * `pdfxyz.release-artifact/1` file (`--release-artifact`), a `pdfxyz.release-index/1` manifest
 * (`--release-index`), and/or a `pdfxyz.release-policy/1` result (`--release-policy`) — into ONE stable
 * bundle: per-stage summaries, the cross-stage + self-consistency checks, a rollup verdict, which stage
 * outputs to archive, the next safe operator action, and an exit code — so a CI pipeline can FAIL CLOSED
 * on a chain whose stages failed or DISAGREE with each other.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-ci-bundle/`; this file only reads argv, reads the stage files, hashes via
 * `node:crypto` (to re-verify the artifact's integrity digest), writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside
 * `src/` and is invoked only as `pnpm worker:release-ci-bundle`).
 *
 * Honesty & privacy:
 *  - It is local content-free BUNDLING + consistency checking over evidence, NOT signing, auth, cloud
 *    validation, storage retention ENFORCEMENT, or deployment promotion: it makes NO network call, reads
 *    NO secret/bucket/object, RUNS no stage itself, and NEVER deletes, prunes, uploads, promotes, or
 *    mutates anything. Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested stage is reduced to bounded enums, small
 *    counts, and booleans by the trust boundary, and no input file path is ever embedded in the output
 *    or printed on an error.
 *  - It fails CLOSED: an unreadable / indeterminate stage or a decision-less chain is `unknown` (exit 2),
 *    a stage failure or a cross-stage inconsistency / tamper is `fail` (exit 4), an advisory concern is
 *    `warn` (exit 3), and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as the FINAL release step:
 *   pnpm worker:release-gate --json > gate.json || true
 *   pnpm worker:release-artifact --release-gate=gate.json --output=artifact.json --json
 *   pnpm worker:release-index --artifact=artifact.json --output=index.json --json
 *   pnpm worker:release-policy --index=index.json --require-clean --min-artifacts=1 --output=policy.json --json
 *   pnpm worker:release-ci-bundle --release-gate=gate.json --release-artifact=artifact.json \
 *                                 --release-index=index.json --release-policy=policy.json --json
 */

import {
  RELEASE_CI_BUNDLE_EXIT,
  RELEASE_CI_BUNDLE_USAGE,
  parseReleaseCiBundleArgs,
  runReleaseCiBundle,
  type ReleaseCiBundleProvider,
} from "@/lib/workers/release-ci-bundle";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file; a content-free stage output is tiny. */
const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MiB

/** Read a file's text, bounding its size first. Throws on any failure (caught by the runner). */
function readBounded(path: string): string {
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return readFileSync(path, "utf8");
}

const provider: ReleaseCiBundleProvider = {
  now: () => new Date().toISOString(),
  hash: (canonical: string) => createHash("sha256").update(canonical, "utf8").digest("hex"),
  readFile: async (path: string) => readBounded(path),
};

async function main(): Promise<number> {
  const parsed = parseReleaseCiBundleArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_CI_BUNDLE_USAGE}\n`);
    return RELEASE_CI_BUNDLE_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_CI_BUNDLE_USAGE}\n`);
    return RELEASE_CI_BUNDLE_EXIT.PASS;
  }

  const { output, exitCode } = await runReleaseCiBundle(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release CI bundle output.\n\n${RELEASE_CI_BUNDLE_USAGE}\n`);
      return RELEASE_CI_BUNDLE_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine internal fault
    // means we could not compose the bundle → UNKNOWN (insufficient), never a false pass.
    process.exit(RELEASE_CI_BUNDLE_EXIT.UNKNOWN);
  });
