#!/usr/bin/env tsx
import {
  RELEASE_ARCHIVE_EXIT,
  RELEASE_ARCHIVE_USAGE,
  parseReleaseArchiveArgs,
  runReleaseArchive,
  type ReleaseArchiveProvider,
} from "@/lib/workers/release-archive";
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

const provider: ReleaseArchiveProvider = {
  now: () => new Date().toISOString(),
  readFile: async (path: string) => readBounded(path),
  readStdin: async () => readStdin(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseArchiveArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_ARCHIVE_USAGE}\n`);
    return RELEASE_ARCHIVE_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_ARCHIVE_USAGE}\n`);
    return RELEASE_ARCHIVE_EXIT.ARCHIVABLE;
  }
  const { output, exitCode } = await runReleaseArchive(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      process.stderr.write(`Could not write release archive output.\n\n${RELEASE_ARCHIVE_USAGE}\n`);
      return RELEASE_ARCHIVE_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => process.exit(RELEASE_ARCHIVE_EXIT.INCOMPLETE));
