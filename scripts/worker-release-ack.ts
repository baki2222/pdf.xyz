#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence handoff acknowledgement receipt — the offline, content-free, read-only CLI.
 *
 * `pnpm worker:release-ack` ingests a content-free `pdfxyz.release-publish-pack/1` (the Phase 57 publish / handoff
 * pack a release pipeline already produced), RE-VALIDATES it against ITSELF (so a hand-flipped verdict / disclosure is
 * caught as a tamper), applies a bounded acknowledgement DECISION the operator supplies (`--decision=…`, plus optional
 * bounded reviewer / note classes), and emits ONE stable `pdfxyz.release-ack/1` receipt: an acknowledgement verdict, a
 * bounded source summary (the pack's own verdict / disclosure / source counts), the recorded decision + reviewer class
 * + note class, and a next-action checklist — so a handoff record captures that a pack was reviewed / received and what
 * bounded outcome was chosen, and FAILS CLOSED when the pack cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-ack/`; this file
 * only reads argv, reads the pack / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is
 * invoked only as `pnpm worker:release-ack`).
 *
 * Honesty & privacy:
 *  - It is a local content-free acknowledgement RECEIPT, NOT an external signature, an approval, an identity
 *    attestation, legal / compliance sign-off, or a release promotion: it makes NO network call, reads NO
 *    secret/bucket/object, and NEVER signs, approves, publishes, promotes, notifies, deletes, or mutates anything. The
 *    reviewer is a bounded CLASS (a role), never an identity. Its explicit caveats say so.
 *  - Its output is content-free by construction: the ingested pack is reduced to bounded enums, small counts, and
 *    booleans by the trust boundary; it never echoes the pack's own stamp, and no input file path is ever embedded in
 *    the output or printed on an error.
 *  - It fails CLOSED: a missing / unreadable / tampered pack is `invalid` (exit 4, never a vacuous pass); a rejected /
 *    needs-changes decision or a blocked pack is `rejected` (exit 4); a deferred decision or an incomplete pack is
 *    `deferred` (exit 2); a follow-up is `acknowledged-with-followup` (exit 3); a clean accept over a share-safe pack
 *    is `acknowledged` (exit 0); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a handoff record over a publish pack:
 *   pnpm worker:release-ack --publish-pack=publish-pack.json --decision=accepted \
 *     --reviewer=internal-approver --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_ACK_EXIT,
  RELEASE_ACK_USAGE,
  parseReleaseAckArgs,
  runReleaseAck,
  type ReleaseAckProvider,
} from "@/lib/workers/release-ack";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on the ingested file / the stdin payload; content-free documents are tiny. */
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

const provider: ReleaseAckProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseAckArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_ACK_USAGE}\n`);
    return RELEASE_ACK_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_ACK_USAGE}\n`);
    return RELEASE_ACK_EXIT.ACKNOWLEDGED;
  }

  const { output, exitCode } = await runReleaseAck(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release acknowledgement output.\n\n${RELEASE_ACK_USAGE}\n`);
      return RELEASE_ACK_EXIT.USAGE;
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
    // not compose the receipt → INVALID (the input can't be trusted), never a false acknowledgement.
    process.exit(RELEASE_ACK_EXIT.INVALID);
  });
