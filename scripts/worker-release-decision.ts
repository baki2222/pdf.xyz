#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release decision record ledger — the offline, content-free, read-only CLI.
 *
 * `pnpm worker:release-decision` ingests a content-free `pdfxyz.release-publish-pack/1` (the Phase 57 publish / handoff
 * pack) AND a `pdfxyz.release-ack/1` (the Phase 58 acknowledgement of it) a release pipeline already produced,
 * RE-VALIDATES each against ITSELF (so a hand-flipped verdict / disclosure / decision is caught as a tamper),
 * CROSS-CHECKS that the acknowledgement corresponds to the supplied pack, and emits ONE stable `pdfxyz.release-decision/1`
 * record: a bounded decision (proceed / proceed-with-followup / hold / reject / insufficient / invalid), per-source
 * summaries, a coherence cross-check status, and a next-action checklist — so a release ledger captures what was
 * decided (and why), and FAILS CLOSED when a document cannot be trusted or the pair is incoherent.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-decision/`; this
 * file only reads argv, reads the two documents / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is
 * invoked only as `pnpm worker:release-decision`).
 *
 * Honesty & privacy:
 *  - It is a local content-free decision RECORD, NOT an external signature, an approval, an identity attestation, legal
 *    / compliance sign-off, or an actual deployment / promotion: it makes NO network call, reads NO secret/bucket/object,
 *    and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, or mutates anything. Its explicit
 *    caveats say so.
 *  - Its output is content-free by construction: each ingested document is reduced to bounded enums, small counts, and
 *    booleans by the trust boundaries; it never echoes a document's own stamp, and no input file path is ever embedded
 *    in the output or printed on an error.
 *  - It fails CLOSED: a missing / unreadable / tampered document, or a cross-check mismatch, is `invalid` (exit 4, never
 *    a vacuous pass); a rejected / needs-changes acknowledgement or a blocked pack is `reject` (exit 4); an incomplete
 *    pack or a deferred acknowledgement is `insufficient` (exit 2); a follow-up / needs-review is advisory (exit 3); a
 *    clean share-safe pack + a clean acceptance is `proceed` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a release decision ledger entry:
 *   pnpm worker:release-decision --publish-pack=publish-pack.json --ack=release-ack.json \
 *     --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_DECISION_EXIT,
  RELEASE_DECISION_USAGE,
  parseReleaseDecisionArgs,
  runReleaseDecision,
  type ReleaseDecisionProvider,
} from "@/lib/workers/release-decision";
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

const provider: ReleaseDecisionProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseDecisionArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_DECISION_USAGE}\n`);
    return RELEASE_DECISION_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_DECISION_USAGE}\n`);
    return RELEASE_DECISION_EXIT.PROCEED;
  }

  const { output, exitCode } = await runReleaseDecision(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release decision output.\n\n${RELEASE_DECISION_USAGE}\n`,
      );
      return RELEASE_DECISION_EXIT.USAGE;
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
    // not compose the record → INVALID (the input can't be trusted), never a false proceed.
    process.exit(RELEASE_DECISION_EXIT.INVALID);
  });
