#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence publish / handoff pack — the offline, content-free, read-only CLI.
 *
 * `pnpm worker:release-publish-pack` ingests a content-free `pdfxyz.release-governance/1` bundle (the PRIMARY
 * summary judgment a release pipeline already produced) plus, optionally, the related `pdfxyz.release-archive/1`,
 * `pdfxyz.release-restore-drill/1`, `pdfxyz.release-report/1`, and/or `pdfxyz.release-trend/1`, RE-VALIDATES each
 * document against ITSELF (reusing the Phase 51–56 boundaries, so a hand-flipped verdict / posture / recommendation
 * is caught as a tamper), and emits ONE stable publish / handoff manifest: the evidence coverage, per-source
 * summaries, a publish verdict, a DISCLOSURE CLASSIFICATION (share-safe / internal-review / blocked), and a handoff
 * checklist — so an operator handing a release-evidence package to an external reviewer / approver / investor /
 * incident responder can FAIL CLOSED when the package is blocked or a document cannot be trusted.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-publish-pack/`;
 * this file only reads argv, reads the documents / stdin, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside `src/` and is
 * invoked only as `pnpm worker:release-publish-pack`).
 *
 * Honesty & privacy:
 *  - It is local content-free HANDOFF PACKAGING over evidence summaries, NOT external publishing, a signature, an
 *    approval, legal / compliance sign-off, release promotion, cloud validation, or deletion: it makes NO network
 *    call, reads NO secret/bucket/object, RUNS no gate / bundle / audit / report / trend / governance / archive /
 *    restore-drill itself, and NEVER publishes, shares, sends, uploads, signs, approves, promotes, deletes, or
 *    mutates anything. Its explicit caveats say so.
 *  - Its output is content-free by construction: each ingested document is reduced to bounded enums, small counts,
 *    and booleans by the trust boundary; it never echoes an ingested document's own stamp, and no input file path
 *    is ever embedded in the output or printed on an error.
 *  - It fails CLOSED: an absent / unreadable / incomplete governance bundle, an indeterminate source, or a
 *    required-but-missing document is `incomplete` (exit 2); a tampered document, a blocked governance, a failed
 *    restore drill, a hold-fail report, or a failing trend is `blocked` (exit 4); an advisory posture is `review`
 *    (exit 3); and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, as a handoff artifact over the archived
 * governance bundle + related records:
 *   pnpm worker:release-publish-pack --governance=governance.json --archive=archive.json \
 *     --restore-drill=drill.json --text >> "$GITHUB_STEP_SUMMARY"
 */

import {
  RELEASE_PUBLISH_PACK_EXIT,
  RELEASE_PUBLISH_PACK_USAGE,
  parseReleasePublishPackArgs,
  runReleasePublishPack,
  type ReleasePublishPackProvider,
} from "@/lib/workers/release-publish-pack";
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

const provider: ReleasePublishPackProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleasePublishPackArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_PUBLISH_PACK_USAGE}\n`);
    return RELEASE_PUBLISH_PACK_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_PUBLISH_PACK_USAGE}\n`);
    return RELEASE_PUBLISH_PACK_EXIT.PUBLISHABLE;
  }

  const { output, exitCode } = await runReleasePublishPack(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release publish pack output.\n\n${RELEASE_PUBLISH_PACK_USAGE}\n`);
      return RELEASE_PUBLISH_PACK_EXIT.USAGE;
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
    // could not compose the pack → INCOMPLETE (insufficient), never a false "share-safe package".
    process.exit(RELEASE_PUBLISH_PACK_EXIT.INCOMPLETE);
  });
