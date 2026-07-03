#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence index / retention manifest — the offline, content-free,
 * read-only release-history CLI.
 *
 * `pnpm worker:release-index` ingests one or more content-free `pdfxyz.release-artifact/1` files
 * (from `--artifact=<path>`/`--file=<path>`, repeatable, or a JSON array on stdin), RE-VERIFIES each
 * one's integrity digest (recomputing the sha256 over its canonical body via `node:crypto`), and emits
 * a stable INDEX / RETENTION MANIFEST: a rollup verdict, per-verdict + per-digest-status counts, a
 * bounded newest/oldest age span, a retention posture (over-count / over-age / stale), and a bounded
 * per-artifact summary — so a CI archive / release handoff / retention review can track many artifacts
 * over time.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-index/`; this file only reads argv, reads the artifact files / stdin,
 * hashes via `node:crypto`, writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside
 * `src/` and is invoked only as `pnpm worker:release-index`).
 *
 * Honesty & privacy:
 *  - It is local content-free INDEXING + digest verification, NOT storage retention ENFORCEMENT: it
 *    makes NO network call, reads NO secret/bucket/object, and NEVER deletes, prunes, uploads, or
 *    mutates any artifact. Its explicit caveats say so.
 *  - Its output is content-free by construction: every ingested artifact is reduced to bounded enums,
 *    small counts, coarse age buckets, and short hex digest prefixes by the trust boundary, and no
 *    input file path is ever embedded in the output or printed on an error.
 *  - It exits with the documented ladder (0 ok / 2 insufficient / 3 warn / 4 invalid) for the composite
 *    verdict and a distinct 1 for CLI misuse (a bad flag / non-numeric bound / unwritable output).
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, e.g.:
 *   pnpm worker:release-index --artifact=a.json --artifact=b.json --max-artifacts=20 --max-age-days=90
 *   ls release-*.json | xargs -I{} echo --artifact={} | ...                 # or a JSON array on stdin
 */

import {
  RELEASE_INDEX_EXIT,
  RELEASE_INDEX_USAGE,
  parseReleaseIndexArgs,
  runReleaseIndex,
  type ReleaseIndexProvider,
} from "@/lib/workers/release-index";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file / the whole stdin; a content-free artifact is tiny. */
const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MiB

/** Read a file's text, bounding its size first. Throws on any failure (caught by the runner). */
function readBounded(path: string): string {
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return readFileSync(path, "utf8");
}

/**
 * Read the whole of stdin as UTF-8, bounded. Resolves to "" when stdin is an interactive TTY (no pipe)
 * so an operator who forgot `--artifact` gets an honest empty archive rather than a hang. Only called
 * when NO `--artifact`/`--file` flag was supplied.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    let size = 0;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > MAX_INPUT_BYTES) {
        reject(new Error("stdin-too-large"));
        return;
      }
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

const provider: ReleaseIndexProvider = {
  now: () => new Date().toISOString(),
  hash: (canonical: string) => createHash("sha256").update(canonical, "utf8").digest("hex"),
  readArtifact: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseIndexArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_INDEX_USAGE}\n`);
    return RELEASE_INDEX_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_INDEX_USAGE}\n`);
    return RELEASE_INDEX_EXIT.OK;
  }

  const { output, exitCode } = await runReleaseIndex(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release index output.\n\n${RELEASE_INDEX_USAGE}\n`);
      return RELEASE_INDEX_EXIT.USAGE;
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
    // means we could not build the index → INSUFFICIENT.
    process.exit(RELEASE_INDEX_EXIT.INSUFFICIENT);
  });
