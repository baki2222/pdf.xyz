/**
 * pdf.xyz secure-worker storage-artifact cleanup verifier — the out-of-band operator CLI.
 *
 * `pnpm worker:cleanup-check` evaluates CONTENT-FREE cleanup evidence — exported out-of-band from
 * the operator's own object storage — and prints a stable verdict with a documented exit code:
 * whether storage artifacts that should be gone are actually ABSENT (active delete-now and/or the
 * bucket lifecycle backstop) or only retrieval-denied (Phase 41). It is deliberately a thin shell
 * over unit-tested, node-free modules under `src/lib/workers/cleanup/`; this file only reads
 * argv/env, resolves the storage provider, reads stdin/files, writes the output, and exits.
 *
 * Like the ops-check CLI it is NEVER imported by the web app (it lives outside `src/` and is
 * invoked only as `pnpm worker:cleanup-check`), so importing the app never resolves a provider or
 * touches the host. It NEVER calls the cloud: the app cannot observe a bucket, so the evidence is
 * always supplied by the operator (mirroring `--lifecycle-verify`).
 *
 * Honesty & privacy:
 *  - It NEVER fabricates a deletion. A present-but-denied object is reported as cleanup pending;
 *    only a confirmed object absence yields `verified`. A `not-configured` deployment is inert.
 *  - Its output is content-free by construction: bounded enums, small counts, and authored prose
 *    — never a filename, object key, bucket, endpoint, URL, value, host, env-var name, or secret,
 *    even when it ingests an operator-supplied document (every unknown field is dropped).
 *  - It exits with the documented ops ladder (0 verified / 2 unknown/not-configured/unavailable /
 *    3 drift) for verification states and a distinct 1 for usage/config errors (bad flag,
 *    unreadable/malformed input), so a misconfigured check is never mistaken for a clean bucket.
 *
 * Run it in worker/ops infrastructure alongside (never inside) the web app, e.g.:
 *   pnpm worker:cleanup-check                                  # env posture: not-configured / unknown
 *   cat cleanup-evidence.json | pnpm worker:cleanup-check --stdin
 *   pnpm worker:cleanup-check --file=evidence.json --prometheus --grace-hours=48
 */

import {
  CLEANUP_CHECK_USAGE,
  parseCleanupCheckArgs,
  runCleanupCheck,
  type CleanupCheckProvider,
} from "@/lib/workers/cleanup";
import { OPS_CHECK_EXIT } from "@/lib/workers/observability";
import { parseS3Config } from "@/lib/workers/storage/s3-config";
import type { RetrievalStorageProvider } from "@/lib/workers/artifacts/access";
import { readFileSync, statSync } from "node:fs";

/** Hard cap on an ingested document; a content-free cleanup evidence summary is small. */
const MAX_INPUT_BYTES = 1_048_576; // 1 MiB

/**
 * Resolve the bounded storage provider from the environment EXACTLY as the retrieval backend
 * does: `remote-configured` only when S3 is explicitly selected AND fully valid, else
 * `not-configured`. It reads only whether storage is configured — never a secret VALUE.
 */
function resolveProvider(): RetrievalStorageProvider {
  return parseS3Config(process.env).ok ? "remote-configured" : "not-configured";
}

/** Read the raw ingest text for `stdin`/`file`, bounding the size. Throws on any failure. */
async function readInput(
  source: "stdin" | "file",
  filePath: string | undefined,
): Promise<string> {
  if (source === "file") {
    // The path is the operator's own file reference; it is never logged. Bound the size
    // before reading, then read defensively.
    const path = filePath ?? "";
    if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
    return readFileSync(path, "utf8");
  }
  // stdin (fd 0): read to EOF (a monitor pipes the document), then bound the size.
  const buf = readFileSync(0);
  if (buf.length > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return buf.toString("utf8");
}

const provider: CleanupCheckProvider = {
  resolveProvider,
  readInput,
  now: () => Date.now(),
};

async function main(): Promise<number> {
  const parsed = parseCleanupCheckArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${CLEANUP_CHECK_USAGE}\n`);
    return OPS_CHECK_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${CLEANUP_CHECK_USAGE}\n`);
    return OPS_CHECK_EXIT.OK;
  }

  const { output, exitCode } = await runCleanupCheck(parsed.args, provider);
  process.stdout.write(output);
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine internal
    // fault means we could not determine cleanup posture → UNKNOWN.
    process.exit(OPS_CHECK_EXIT.UNKNOWN);
  });
