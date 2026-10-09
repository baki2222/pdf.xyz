/**
 * Write `src/deploy/ssr-baseline.json` from the current build — the record
 * `src/deploy/ssr-content.test.ts` holds every later build to.
 *
 *   pnpm build && pnpm ssr:baseline
 *
 * Regenerating is a DECISION, not a fix: the test fails when a page loses a
 * heading, a structured-data type or an internal link, and running this
 * accepts the loss. Do it only for a removal you meant, and say in the same
 * commit which entries went and why (`git diff src/deploy/ssr-baseline.json`
 * shows them). Additions never need it; the test allows them.
 *
 * The output is formatted with the repo's own Prettier config, so
 * `pnpm format:check` agrees with the file this writes.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";
import { snapshotBuild } from "./ssr-content";

export const BASELINE_FILE = path.join(
  process.cwd(),
  "src",
  "deploy",
  "ssr-baseline.json",
);

export async function writeBaseline(
  nextDir = path.join(process.cwd(), ".next"),
  file = BASELINE_FILE,
): Promise<number> {
  const snapshot = snapshotBuild(nextDir);
  const json = JSON.stringify(
    {
      $comment:
        "Server-rendered content per prerendered page. Written by `pnpm ssr:baseline`; read by src/deploy/ssr-content.test.ts, which fails on any removal. Regenerate only to accept a removal you meant.",
      ...snapshot,
    },
    null,
    2,
  );
  const options = (await resolveConfig(file)) ?? {};
  writeFileSync(file, await format(json, { ...options, filepath: file }));
  return Object.keys(snapshot.pages).length;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  writeBaseline().then(
    (count) => {
      process.stdout.write(
        `ssr:baseline: wrote ${count} pages to ${path.relative(process.cwd(), BASELINE_FILE)}\n`,
      );
    },
    (error: unknown) => {
      process.stderr.write(`ssr:baseline: ${(error as Error).message}\n`);
      process.exit(1);
    },
  );
}
