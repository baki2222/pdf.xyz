/**
 * Regenerate the vendored table in
 * `src/lib/workers/translate/radical-equivalents.ts` from Unicode's
 * `EquivalentUnifiedIdeograph.txt`:
 *
 *   pnpm exec tsx scripts/generate-radical-equivalents.ts <path/to/EquivalentUnifiedIdeograph-NN.txt>
 *
 * The Kangxi Radicals rows (U+2F00–U+2FD5) fill the `GENERATED` block and
 * the CJK Radicals Supplement rows (U+2E80–U+2EF3) the `GENERATED
 * SUPPLEMENT` block. Neither table decides a rewrite (the measured per-face
 * facts do); both are the tests' second bound — see the module's docblock. The file is read from disk, never fetched:
 * the table is vendored so the worker never needs a network to print a PDF.
 * The block between the GENERATED markers is replaced in place; everything
 * else in the module is left as it is.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const source = process.argv[2];
if (!source) {
  console.error(
    "usage: generate-radical-equivalents.ts <EquivalentUnifiedIdeograph.txt>",
  );
  process.exit(2);
}
const text = readFileSync(source, "utf8");
const version = /EquivalentUnifiedIdeograph-([\d.]+)\.txt/.exec(text)?.[1];
const date = /^#\s*Date:\s*(\S+)/m.exec(text)?.[1];
if (!version || !date)
  throw new Error("no version or date header in the source");

const kangxi = (cp: number) => cp >= 0x2f00 && cp <= 0x2fd5;
const supplement = (cp: number) => cp >= 0x2e80 && cp <= 0x2ef3;
const rows: [number, number][] = [];
const supplementRows: [number, number][] = [];
for (const line of text.split(/\r?\n/)) {
  const m =
    /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*([0-9A-F]{4,6})/.exec(line);
  if (!m) continue;
  const lo = parseInt(m[1]!, 16);
  const hi = m[2] ? parseInt(m[2], 16) : lo;
  const to = parseInt(m[3]!, 16);
  for (let cp = lo; cp <= hi; cp++) {
    if (kangxi(cp)) rows.push([cp, to]);
    if (supplement(cp)) supplementRows.push([cp, to]);
  }
}
const hex = (n: number) => n.toString(16).toUpperCase();
const lines = (list: [number, number][]) =>
  list.map(([k, v]) => `  0x${hex(k)}, 0x${hex(v)},`).join("\n");
const target = path.join(
  import.meta.dirname,
  "../src/lib/workers/translate/radical-equivalents.ts",
);
const current = readFileSync(target, "utf8");
const next = current
  .replace(
    /(\/\/ BEGIN GENERATED \([^\n]*\n)[\s\S]*?([ \t]*\/\/ END GENERATED\n)/,
    `$1  // EquivalentUnifiedIdeograph-${version}.txt, ${date}: ${rows.length} rows\n${lines(rows)}\n$2`,
  )
  .replace(
    /(\/\/ BEGIN GENERATED SUPPLEMENT[^\n]*\n)[\s\S]*?([ \t]*\/\/ END GENERATED SUPPLEMENT)/,
    `$1  // EquivalentUnifiedIdeograph-${version}.txt, ${date}: ${supplementRows.length} rows\n${lines(supplementRows)}\n$2`,
  );
if (next === current) console.log("unchanged");
writeFileSync(target, next);
console.log(
  `${rows.length} Kangxi and ${supplementRows.length} Supplement rows from ${version} (${date})`,
);
