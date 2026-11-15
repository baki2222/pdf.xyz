/**
 * Measure, in the worker image, which code points share each Kangxi
 * radical's glyph in every CJK face fontconfig offers — the facts the
 * ToUnicode rewrite (`src/lib/workers/translate/radical-equivalents.ts`)
 * is derived from:
 *
 *   docker run --rm --network none -v <tree>:/app-x:ro -v <out>:/out -w /app-x \
 *     --entrypoint npx ghcr.io/baki2222/pdfxyz-worker:latest \
 *     tsx scripts/measure-cjk-radical-glyphs.ts /out/radical-glyph-facts.json \
 *     "--source=<image name and digest, date>"
 *
 * With `--check`, the path is READ instead and the run exits 1 when the
 * image's faces no longer give the vendored facts (the proof script runs the
 * same comparison through `measureRadicalGlyphFacts`).
 *
 * The face set is DERIVED, never typed (`cjk-font-files.ts`): the union of `fc-list :lang=zh`,
 * `:lang=ja` and `:lang=ko` — fontconfig's own coverage, the resolution
 * Chromium prints with. A file fontkit cannot open is FATAL, not skipped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { expandFacts } from "@/lib/workers/translate/radical-equivalents";
import {
  compactFacts,
  diffRadicalGlyphFacts,
  measureRadicalGlyphFacts,
} from "@/lib/workers/translate/radical-glyph-measure";
import { cjkFontFiles } from "./cjk-font-files";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const file = args.find((a) => !a.startsWith("--"));
  const source =
    args.find((a) => a.startsWith("--source="))?.slice("--source=".length) ??
    "unrecorded";
  if (!file) {
    console.log("usage: measure-cjk-radical-glyphs.ts [--check] <facts.json>");
    return 2;
  }
  const measured = await measureRadicalGlyphFacts(cjkFontFiles());
  console.log(
    `faces: ${Object.keys(measured.faces).length} (${Object.keys(measured.faces).join(", ")})`,
  );
  if (!check) {
    writeFileSync(
      file,
      `${JSON.stringify(compactFacts(measured, source), null, 2)}\n`,
    );
    console.log(`wrote ${file}`);
    return 0;
  }
  const diff = diffRadicalGlyphFacts(
    expandFacts(JSON.parse(readFileSync(file, "utf8"))),
    measured,
  );
  for (const line of diff) console.log(`  differs: ${line}`);
  console.log(diff.length === 0 ? "facts: SAME" : "facts: DIFFER");
  return diff.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`threw: ${error instanceof Error ? error.message : "unknown"}`);
    process.exit(1);
  },
);
