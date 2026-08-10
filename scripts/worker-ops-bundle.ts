/**
 * pdf.xyz secure-worker operations evidence bundle — the incident-handoff aggregator CLI.
 *
 * `pnpm worker:ops-bundle` composes an operator's OWN content-free tool summaries — the
 * `pdfxyz.ops-check/1` result (readiness, liveness, subsystems, SLOs, cleanup-evidence, and
 * lifecycle-verification posture) and, optionally, the `pdfxyz.cleanup-pipeline/1` summary — into
 * ONE stable, bounded artifact for a support ticket, an incident handoff, a CI artifact, or a
 * scheduled monitor attachment. It is deliberately a thin shell over unit-tested, node-free modules
 * under `src/lib/workers/ops-bundle/`; this file only reads argv, reads stdin/files, writes the
 * output, and exits.
 *
 * Like the daemon and ops-check, it is NEVER imported by the web app (it lives outside `src/` and
 * is invoked only as `pnpm worker:ops-bundle`).
 *
 * Honesty & privacy:
 *  - It is an AGGREGATOR, not a new proof. It makes NO network call, reads NO provider export,
 *    secret, or bucket, and deletes nothing. Its explicit caveats say so.
 *  - Its output is content-free by construction: bounded enums, booleans, small counts, and prose
 *    authored by this layer — never a filename, key, endpoint, value, host, env-var name, or
 *    secret, even when it composes an operator-supplied summary. The trust boundary drops anything
 *    that is not a bounded token.
 *  - It exits with the documented ladder (0 ok / 2 unknown / 3 warn / 4 critical) for the composite
 *    posture and a distinct 1 for usage/config errors (bad flag, unreadable/malformed REQUIRED
 *    input), so a misconfigured aggregation is never mistaken for a healthy or unhealthy stack.
 *
 * Run it in worker infrastructure alongside (never inside) the web app, e.g.:
 *   pnpm worker:ops-check --runtime --json | pnpm worker:ops-bundle           # one-line handoff
 *   pnpm worker:ops-bundle --ops-check=ops.json --pipeline=pipeline.json --text
 *   pnpm worker:ops-bundle --ops-check=ops.json --json > bundle.json          # a CI artifact
 */

import {
  OPS_BUNDLE_EXIT,
  OPS_BUNDLE_USAGE,
  parseOpsBundleArgs,
  runOpsBundle,
  type OpsBundleProvider,
} from "@/lib/workers/ops-bundle";
import { readFileSync, statSync, writeFileSync } from "node:fs";

/** Hard cap on each ingested summary; a content-free tool summary is tiny. */
const MAX_INPUT_BYTES = 1_048_576; // 1 MiB

/** Read the raw text for the ops-check result (`stdin`/`file`), bounding the size. Throws on failure. */
async function readOpsCheck(
  source: "stdin" | "file",
  filePath: string | undefined,
): Promise<string> {
  if (source === "file") {
    // The path is the operator's own file reference; it is never logged. Bound the size first.
    const path = filePath ?? "";
    if (statSync(path).size > MAX_INPUT_BYTES)
      throw new Error("input-too-large");
    return readFileSync(path, "utf8");
  }
  // stdin (fd 0): read to EOF (a pipe from worker:ops-check), then bound the size.
  const buf = readFileSync(0);
  if (buf.length > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return buf.toString("utf8");
}

/** Read the raw text for an optional pipeline summary file, bounding the size. Throws on failure. */
async function readPipeline(filePath: string): Promise<string> {
  if (statSync(filePath).size > MAX_INPUT_BYTES)
    throw new Error("input-too-large");
  return readFileSync(filePath, "utf8");
}

const provider: OpsBundleProvider = {
  readOpsCheck,
  readPipeline,
  now: () => new Date().toISOString(),
};

async function main(): Promise<number> {
  const parsed = parseOpsBundleArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${OPS_BUNDLE_USAGE}\n`);
    return OPS_BUNDLE_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${OPS_BUNDLE_USAGE}\n`);
    return OPS_BUNDLE_EXIT.OK;
  }

  const { output, exitCode } = await runOpsBundle(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write ops bundle output.\n\n${OPS_BUNDLE_USAGE}\n`,
      );
      return OPS_BUNDLE_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine internal
    // fault means we could not assemble the bundle → UNKNOWN.
    process.exit(OPS_BUNDLE_EXIT.UNKNOWN);
  });
