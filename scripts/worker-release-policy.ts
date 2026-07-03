#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release evidence policy assertions — the offline, content-free, read-only
 * release-policy CLI.
 *
 * `pnpm worker:release-policy` evaluates a small, explicit set of operator policy thresholds against a
 * content-free `pdfxyz.release-index/1` manifest (from `--index=<path>` or stdin), or against an
 * in-process index of one or more `pdfxyz.release-artifact/1` files (`--artifact=<path>`, repeatable,
 * re-verifying each digest via `node:crypto`), and emits a stable policy result: a rollup verdict, the
 * evaluated policy, bounded violation ids with counts + remediation, and an exit code — so a CI
 * pipeline can FAIL CLOSED on a release evidence archive that violates explicit bounded policy.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/release-policy/`; this file only reads argv, reads the index / artifact files /
 * stdin, hashes via `node:crypto` (only in `--artifact` mode), writes the output, and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside
 * `src/` and is invoked only as `pnpm worker:release-policy`).
 *
 * Honesty & privacy:
 *  - It is local bounded policy EVALUATION over content-free evidence, NOT signing, auth, cloud
 *    validation, storage retention ENFORCEMENT, or deployment promotion: it makes NO network call,
 *    reads NO secret/bucket/object, and NEVER deletes, prunes, uploads, promotes, or mutates anything.
 *    Its explicit caveats say so.
 *  - Its output is content-free by construction: the ingested index is reduced to bounded enums, small
 *    counts, and coarse age buckets by the trust boundary, and no input file path is ever embedded in
 *    the output or printed on an error.
 *  - It fails CLOSED: an unreadable / not-a-release-index input is `unknown` (exit 2), an empty archive
 *    is `unknown`, a malformed / inconsistent / tampered index is `fail` (exit 4), a warning-only
 *    concern is `warn` (exit 3), and a distinct 1 is CLI misuse.
 *
 * Run it in worker/CI infrastructure alongside (never inside) the web app, e.g.:
 *   pnpm worker:release-index --artifact=a.json --artifact=b.json > index.json
 *   pnpm worker:release-policy --index=index.json --require-clean --min-artifacts=3 --max-fail=0
 *   pnpm worker:release-policy --artifact=a.json --artifact=b.json --require-clean --max-age-bucket=7-30d
 */

import {
  RELEASE_POLICY_EXIT,
  RELEASE_POLICY_USAGE,
  parseReleasePolicyArgs,
  runReleasePolicy,
  type ReleasePolicyProvider,
} from "@/lib/workers/release-policy";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested file / the whole stdin; a content-free index/artifact is tiny. */
const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MiB

/** Read a file's text, bounding its size first. Throws on any failure (caught by the runner). */
function readBounded(path: string): string {
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return readFileSync(path, "utf8");
}

/**
 * Read the whole of stdin as UTF-8, bounded. Resolves to "" when stdin is an interactive TTY (no pipe)
 * so an operator who forgot `--index` gets an honest "no index" rather than a hang. Only called when
 * NEITHER `--index` nor `--artifact` was supplied.
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

const provider: ReleasePolicyProvider = {
  now: () => new Date().toISOString(),
  hash: (canonical: string) => createHash("sha256").update(canonical, "utf8").digest("hex"),
  readIndex: async (path: string) => readBounded(path),
  readArtifact: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleasePolicyArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_POLICY_USAGE}\n`);
    return RELEASE_POLICY_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_POLICY_USAGE}\n`);
    return RELEASE_POLICY_EXIT.PASS;
  }

  const { output, exitCode } = await runReleasePolicy(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(`Could not write release policy output.\n\n${RELEASE_POLICY_USAGE}\n`);
      return RELEASE_POLICY_EXIT.USAGE;
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
    // means we could not evaluate the policy → UNKNOWN (insufficient), never a false pass.
    process.exit(RELEASE_POLICY_EXIT.UNKNOWN);
  });
