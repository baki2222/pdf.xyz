/**
 * pdf.xyz storage-artifact cleanup evidence exporter — the out-of-band operator CLI (Phase 43).
 *
 * `pnpm worker:cleanup-project` projects a RAW provider export — an operator's own out-of-band
 * `aws s3api list-objects-v2` / `head-object` capture, or a normalized dump — into the two
 * bounded, CONTENT-FREE shapes the Phase 42 cleanup tools read: the cleanup-check EVIDENCE the
 * absence-verifier consumes, and the artifact-cleanup INVENTORY the dry-run sweeper consumes.
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/cleanup/project/`; this file only reads argv, reads stdin/files, writes the
 * output, and exits. Like the other worker CLIs it is NEVER imported by the web app (it lives
 * outside `src/` and is invoked only as `pnpm worker:cleanup-project`), so importing the app
 * never projects anything or touches the host.
 *
 * Honesty & privacy:
 *  - It makes NO cloud call and needs NO credentials: the export is produced out-of-band with
 *    the operator's own tooling. It deletes NOTHING — deletion stays operator-owned.
 *  - Its output is content-free by construction: it reads ONLY a bounded allowlist of fields
 *    off each object and DROPS every locator/identifier (object keys, bucket names, signed
 *    URLs, endpoints, regions, account ids, ETags, filenames, arbitrary user-metadata). No
 *    hostile value can survive into the projected document or its embedded receipt.
 *  - It exits with a documented ladder (0 projected / 2 not-enough-metadata / 4 unsafe) for
 *    projection states and a distinct 1 for usage/input errors (bad flag, unreadable/malformed
 *    export), so a misused projector is never mistaken for a clean projection.
 *
 *   pnpm worker:cleanup-project --target=inventory --file=export.json > inventory.json
 *   aws s3api list-objects-v2 --bucket "$B" | pnpm worker:cleanup-project --target=inventory --stdin \
 *     | pnpm worker:artifact-cleanup --stdin --text
 */

import {
  parseProjectArgs,
  PROJECT_USAGE,
  runProject,
  PROJECT_EXIT_INPUT_ERROR,
  PROJECTION_SCHEMA,
} from "@/lib/workers/cleanup/project";
import { readFileSync, statSync } from "node:fs";

/** Hard cap on the export a read will accept (a projected export summary is small). */
const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MiB — mirrors the projector's own char cap.

/**
 * Read the raw export text from the chosen source, bounded. Throws a fixed-message Error on any
 * failure (too large, unreadable) — the caller maps it to exit 1 WITHOUT echoing the OS error
 * or the path, which could carry a filename.
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
  const parsed = parseProjectArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${PROJECT_USAGE}`);
    return PROJECT_EXIT_INPUT_ERROR;
  }
  if (parsed.kind === "help") {
    process.stdout.write(PROJECT_USAGE);
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
    process.stdout.write(
      `${JSON.stringify(
        {
          tool: "worker-cleanup-project",
          schema: PROJECTION_SCHEMA,
          target: args.target,
          generatedAt,
          error: { reason: "input-unreadable" },
        },
        null,
        2,
      )}\n`,
    );
    return PROJECT_EXIT_INPUT_ERROR;
  }

  const result = runProject(text, args, nowMs, generatedAt);
  process.stdout.write(result.output);
  return result.exitCode;
}

try {
  process.exit(main());
} catch {
  // Never print the raw error — it could carry a message we must not log.
  process.stdout.write(
    `${JSON.stringify({ tool: "worker-cleanup-project", error: { reason: "internal-error" } })}\n`,
  );
  process.exit(PROJECT_EXIT_INPUT_ERROR);
}
