/**
 * #28 slice 3 (wraps), INV-0: freeze what slice 2's `flowText` gives on every
 * captured sample, so "absorption off equals slice 2" is compared with a FILE
 * written by slice 2's code, not with the branch's own off path (which a
 * refactor of both paths would keep green).
 *
 * Refuses to run unless the three modules `flowText` is made of are
 * byte-identical (git blob ids) to their versions at the frozen commit:
 * regenerating the file from the branch (mutation M17) is then impossible
 * without editing this script, and the file's header names the commit and
 * the blobs it was made from (a test asserts both).
 *
 *   npx tsx scripts/write-flow-slice2-golden.ts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import * as prettier from "prettier";
import { flowText } from "@/lib/workers/pdf-text/flow";
import { parseBboxFlow } from "@/lib/workers/pdf-text/parse";
import * as legacy from "@/tests/poppler-samples";
import * as image from "@/tests/poppler-samples-image";

/** origin/main when slice 3 was cut: PR #333 merged (slice 2 = PR #321). */
export const FROZEN_COMMIT = "0985432a";
const MODULES = ["flow", "parse", "table-grid"].map(
  (m) => `src/lib/workers/pdf-text/${m}.ts`,
);
const OUT = "src/tests/flow-slice2-golden.json";

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

const blobs: Record<string, string> = {};
for (const path of MODULES) {
  const frozen = git("rev-parse", `${FROZEN_COMMIT}:${path}`);
  const here = git("hash-object", path);
  if (frozen !== here) {
    console.error(
      `${path}: working tree ${here} is not ${FROZEN_COMMIT}'s ${frozen}; the golden file is slice 2's output and can only be written by slice 2's code`,
    );
    process.exit(1);
  }
  blobs[path] = here;
}

const corpus = (
  [
    ["poppler-samples", legacy],
    ["poppler-samples-image", image],
  ] as const
).flatMap(([module, exports]) =>
  Object.entries(exports as Record<string, unknown>)
    .filter(
      (e): e is [string, string] =>
        /_BBOX$/.test(e[0]) && typeof e[1] === "string",
    )
    .map(([name, xhtml]) => ({ module, name, xhtml })),
);

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const samples = corpus.map(({ module, name, xhtml }) => {
  const pages = flowText(parseBboxFlow(xhtml)).pages.map((p) => ({
    pageNumber: p.pageNumber,
    paragraphs: p.paragraphs,
    boxes: p.boxes ?? null,
    pieces: p.pieces ?? null,
    tables: p.tables ?? null,
    tablesAsTabs: p.tablesAsTabs ?? 0,
  }));
  return {
    key: `${module}:${name}`,
    input: sha(xhtml),
    output: sha(JSON.stringify(pages)),
    pages,
  };
});

const file = {
  header: {
    what: "#28 slice 3 (wraps) INV-0: slice 2's flowText over every _BBOX export of src/tests/poppler-samples.ts and src/tests/poppler-samples-image.ts. Do not hand-edit; do not regenerate from a branch that changed flow.ts (the script refuses).",
    commit: FROZEN_COMMIT,
    blobs,
    generator: "npx tsx scripts/write-flow-slice2-golden.ts",
    written: new Date().toISOString(),
    count: samples.length,
  },
  samples,
};
void (async () => {
  const config = (await prettier.resolveConfig(OUT)) ?? {};
  writeFileSync(
    OUT,
    await prettier.format(JSON.stringify(file), { ...config, filepath: OUT }),
  );
})();
console.log(
  `${OUT}: ${samples.length} samples (${corpus.filter((c) => c.module === "poppler-samples").length} + ${corpus.filter((c) => c.module === "poppler-samples-image").length})`,
);
for (const s of samples) console.log(`  ${s.key} ${s.output.slice(0, 12)}`);
