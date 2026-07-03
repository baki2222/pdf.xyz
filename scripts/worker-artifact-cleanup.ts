/**
 * pdf.xyz storage-artifact cleanup verifier / dry-run sweeper — the out-of-band CLI entry
 * point (Phase 42).
 *
 * It evaluates a bounded, OFFLINE, content-free inventory of storage-artifact object
 * metadata (an operator's projection of a bucket listing) and reports which PRESENT
 * objects are expired/stale/orphaned/tombstoned, plus an optional dry-run cleanup plan. It
 * reads NO real bucket, contacts NO cloud API, and NEVER deletes anything — production
 * object deletion stays operator-owned and out-of-band. It is the sweeper LENS of the
 * Phase 42 cleanup subsystem; the absence-proving VERIFIER lens is `pnpm worker:cleanup-check`.
 *
 * It is a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/artifacts/cleanup/`: it only reads argv/stdin/file and the clock, calls
 * the pure orchestrator, writes the output, and exits. It never imports the web app, so
 * importing the app never runs a sweep.
 *
 * Honesty & privacy: it logs ONLY the content-free report/receipt (bounded verdict,
 * category/severity counts, coarse buckets, the stable policy id) — never a filename,
 * object key, bucket, signed URL, path, raw instant, size, id, or byte. On ANY read/parse
 * failure it emits a fixed, content-free reason and exits 1, never echoing the OS error or
 * the file path.
 *
 *   pnpm worker:artifact-cleanup --stdin --text            # human-readable summary
 *   pnpm worker:artifact-cleanup --file=inventory.json --json --plan
 *
 * Exit codes: 0 no cleanup/drift · 1 usage/input error · 2 unknown/not enough evidence ·
 * 3 cleanup recommended/drift · 4 invalid/breached policy.
 */

import {
  parseArtifactCleanupArgs,
  ARTIFACT_CLEANUP_USAGE,
  runArtifactCleanup,
  ARTIFACT_CLEANUP_EXIT_INPUT_ERROR,
} from "@/lib/workers/artifacts/cleanup";
import { readFileSync, statSync } from "node:fs";

/** Hard cap on the inventory document a read will accept (a projected inventory is small). */
const MAX_INPUT_BYTES = 1_048_576; // 1 MiB — mirrors the parser's own char cap.

/**
 * Read the raw inventory text from the chosen source, bounded. Throws a fixed-message
 * Error on any failure (too large, unreadable) — the caller maps it to exit 1 WITHOUT
 * echoing the OS error or the path, which could carry a filename.
 */
function readInput(source: "stdin" | "file", filePath: string | undefined): string {
  if (source === "file") {
    if (filePath === undefined) throw new Error("input-error");
    if (statSync(filePath).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
    return readFileSync(filePath, "utf8");
  }
  // stdin: read fd 0 to EOF, then bound the size defensively.
  const text = readFileSync(0, "utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_INPUT_BYTES) {
    throw new Error("input-too-large");
  }
  return text;
}

function main(): number {
  const parsed = parseArtifactCleanupArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${ARTIFACT_CLEANUP_USAGE}`);
    return ARTIFACT_CLEANUP_EXIT_INPUT_ERROR;
  }
  if (parsed.kind === "help") {
    process.stdout.write(ARTIFACT_CLEANUP_USAGE);
    return 0;
  }

  const args = parsed.args;
  const nowMs = args.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();

  let text: string;
  try {
    text = readInput(args.source, args.filePath);
  } catch {
    // Content-free: a fixed reason, never the OS error or the path.
    const format = args.format;
    if (format === "text") {
      process.stdout.write(
        "pdf.xyz storage-artifact cleanup verifier (dry-run)\n  error                  inventory input could not be read\n",
      );
    } else {
      process.stdout.write(
        `${JSON.stringify(
          {
            tool: "worker-artifact-cleanup",
            dryRun: true,
            generatedAt,
            error: { reason: "input-unreadable" },
          },
          null,
          2,
        )}\n`,
      );
    }
    return ARTIFACT_CLEANUP_EXIT_INPUT_ERROR;
  }

  const result = runArtifactCleanup(text, args, nowMs, generatedAt);
  process.stdout.write(result.output);
  return result.exitCode;
}

try {
  process.exit(main());
} catch {
  // Never print the raw error — it could carry a message we must not log.
  process.stdout.write(
    `${JSON.stringify({ tool: "worker-artifact-cleanup", error: { reason: "internal-error" } })}\n`,
  );
  process.exit(ARTIFACT_CLEANUP_EXIT_INPUT_ERROR);
}
