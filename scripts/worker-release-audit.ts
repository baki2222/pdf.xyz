#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence audit / diff — the offline, content-free, read-only audit CLI.
 *
 * `pnpm worker:release-audit` ingests two (or a history of) content-free `pdfxyz.release-ci-bundle/1`
 * bundles a release job already produced — a BASELINE and a CURRENT — RE-VALIDATES each bundle against
 * ITSELF (re-deriving its Phase 50 rollup, so a hand-flipped bundle verdict is caught as a tamper), DIFFS
 * their bounded postures, and emits ONE stable audit result: per-slot summaries, the regression findings,
 * a rollup verdict, an exit code, and the next safe operator action — so a CI regression gate can FAIL
 * CLOSED when the release evidence posture REGRESSED or a bundle cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-audit/`; this file only reads argv, reads the bundle files / stdin, writes the
 * output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/`
 * and is invoked only as `pnpm worker:release-audit`).
 *
 * Honesty & privacy:
 *  - It is local content-free AUDIT / DIFF over evidence, NOT signing, auth, cloud validation, storage
 *    retention ENFORCEMENT, or deployment promotion: it makes NO network call, reads NO secret/bucket/
 *    object, RUNS no stage or bundle itself, and NEVER deletes, prunes, uploads, promotes, or mutates any
 *    bundle/artifact/index/policy. Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested bundle is reduced to bounded enums, small
 *    counts/deltas, and booleans by the trust boundary, and no input file path is ever embedded in the
 *    output or printed on an error.
 *  - It fails CLOSED: an unreadable bundle or too little comparable history is `unknown` (exit 2); a
 *    blocking regression or a recognized-but-self-inconsistent (tampered) bundle is `fail` (exit 4); a
 *    non-blocking drift is `warn` (exit 3); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as an OPTIONAL regression gate
 * AFTER `worker:release-ci-bundle`, keeping the previous release's bundle as the baseline:
 *   pnpm worker:release-audit --baseline=previous-bundle.json --current=release-ci-bundle.json --json
 */

import {
  RELEASE_AUDIT_EXIT,
  RELEASE_AUDIT_USAGE,
  parseReleaseAuditArgs,
  runReleaseAudit,
  type ReleaseAuditProvider,
} from "@/lib/workers/release-audit";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file / the stdin payload; content-free bundles are tiny. */
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MiB

/** Read a file's text, bounding its size first. Throws on any failure (caught by the runner). */
function readBounded(path: string): string {
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return readFileSync(path, "utf8");
}

/** Read the whole stdin payload (history `--stdin` mode), bounded. Throws on any failure. */
function readStdin(): string {
  const text = readFileSync(0, "utf8");
  if (text.length > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return text;
}

const provider: ReleaseAuditProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseAuditArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_AUDIT_USAGE}\n`);
    return RELEASE_AUDIT_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_AUDIT_USAGE}\n`);
    return RELEASE_AUDIT_EXIT.PASS;
  }

  const { output, exitCode } = await runReleaseAudit(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release audit output.\n\n${RELEASE_AUDIT_USAGE}\n`);
      return RELEASE_AUDIT_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine internal fault means
    // we could not perform the audit → UNKNOWN (insufficient), never a false "no regression".
    process.exit(RELEASE_AUDIT_EXIT.UNKNOWN);
  });
