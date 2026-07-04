#!/usr/bin/env tsx
import {
  RELEASE_RESTORE_DRILL_EXIT,
  RELEASE_RESTORE_DRILL_USAGE,
  parseReleaseRestoreDrillArgs,
  runReleaseRestoreDrill,
  type ReleaseRestoreDrillProvider,
} from "@/lib/workers/release-restore-drill";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

function readBounded(path: string): string {
  if (statSync(path).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return readFileSync(path, "utf8");
}

function readStdin(): string {
  const text = readFileSync(0, "utf8");
  if (text.length > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return text;
}

const provider: ReleaseRestoreDrillProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
  hash: (canonical: string) => createHash("sha256").update(canonical, "utf8").digest("hex"),
};

async function main(): Promise<number> {
  const parsed = parseReleaseRestoreDrillArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_RESTORE_DRILL_USAGE}\n`);
    return RELEASE_RESTORE_DRILL_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_RESTORE_DRILL_USAGE}\n`);
    return RELEASE_RESTORE_DRILL_EXIT.VERIFIED;
  }
  const { output, exitCode } = await runReleaseRestoreDrill(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      process.stderr.write(`Could not write release restore drill output.\n\n${RELEASE_RESTORE_DRILL_USAGE}\n`);
      return RELEASE_RESTORE_DRILL_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => process.exit(RELEASE_RESTORE_DRILL_EXIT.INCOMPLETE));
