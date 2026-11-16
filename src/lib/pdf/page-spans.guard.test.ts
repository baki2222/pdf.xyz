/**
 * One author for a page span (review of audit summarize-pdf#5, 2026-11-16).
 *
 * Summarize's panel once carried `spanLabel`, a second "page 4" / "pages
 * 3–7" formatter beside `formatSpans` and `pagesPhrase`, and its refusal
 * before upload wrote its own copy of the worker's out-of-range sentence
 * (always "pages", even for one). Both now come from this leaf.
 *
 * The subjects are DISCOVERED, not named: every module that imports
 * `page-spans` (by alias or relatively) knows the span shape and has the
 * formatter in hand, so none of them may write a range or a page/pages
 * phrase of its own. Office export's coverage predates the leaf and does
 * not import it; it is outside this guard's set, deliberately.
 *
 * Translate's three range writers (typeset's `pageRangeLabel`, assembly's
 * `interruptedNotice`, chunking's `withheldPagesMarker`) were outside it too
 * until audit #29 slice 6, which gave them one author derived from the
 * chosen spans (`src/lib/workers/translate/page-labels.ts`): they now import
 * the leaf and are held to it here. The phrase pattern is CASE-INSENSITIVE
 * since then, because the label shape is capitalised (`Page ${n}` :
 * `Pages ${...}`), and a case-sensitive pattern could not see the shape that
 * module authors or a fourth copy of it. `page-labels.ts` is exempt BY NAME
 * from that one shape, with its reason below; it writes no range of its own.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const LEAF = join("src", "lib", "pdf", "page-spans.ts");

/** Built from code points (house rule): the en dash and its escape. */
const EN = String.fromCharCode(0x2013);
const EN_ESCAPE = `${String.fromCharCode(0x5c)}u2013`;
const D = "$";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name))
      out.push(full);
  }
  return out;
}

const IMPORTS_LEAF =
  /from\s+["'](?:@\/lib\/pdf\/page-spans|(?:\.{1,2}\/)+(?:[\w-]+\/)*page-spans)["']/;

/** `${a}–${b}`: a range written out of two interpolations. */
const RANGE_AUTHOR = new RegExp(
  `\\${D}\\{[^}\`]*\\}(?:${EN}|\\\\u2013)\\${D}\\{`,
);
/**
 * `page ${…}` : `pages ${…}` — a singular/plural phrase of one span, in
 * either case: "Page 4" / "Pages 2, 4" is the heading shape.
 */
const PHRASE_AUTHOR = new RegExp(
  `\`page \\${D}\\{[^}\`]*\\}\`\\s*:\\s*\`pages \\${D}\\{`,
  "i",
);

/**
 * The heading style's one author. "Pages 2, 4" deliberately differs from
 * `pagesPhrase`'s sentence style ("pages 2 and 4"): a heading is a list. It
 * is exempt from the PHRASE shape only, never from the range shape.
 */
const HEADING_AUTHOR = "src/lib/workers/translate/page-labels.ts";

const offends = (path: string, source: string) =>
  RANGE_AUTHOR.test(source) ||
  (path !== HEADING_AUTHOR && PHRASE_AUTHOR.test(source));

const importers = walk(SRC)
  .map((file) => ({
    path: relative(ROOT, file).split(sep).join("/"),
    source: readFileSync(file, "utf8"),
  }))
  .filter((f) => IMPORTS_LEAF.test(f.source));

describe("page spans: one formatter, used by every module that imports it", () => {
  it("health: the importer set is plausible and holds the known consumers", () => {
    const paths = importers.map((f) => f.path);
    expect(paths.length).toBeGreaterThanOrEqual(10);
    expect(paths.length).toBeLessThan(60);
    for (const known of [
      "src/components/tools/summarize-worker-panel.tsx",
      "src/lib/workers/ai/truncation.ts",
      "src/lib/jobs/summarize-pages.ts",
      "src/lib/workers/summarize-measure.ts",
      // The typed-text author both measures share (audit #29 slice 6).
      "src/lib/pdf/typed-page-spans.ts",
      // Translate's label author and the three writers it replaced, and
      // Translate's page sentences (audit #29 slice 6).
      "src/lib/workers/translate/typeset.ts",
      "src/lib/workers/translate/assembly.ts",
      "src/lib/workers/translate/chunking.ts",
      "src/lib/jobs/translate-pages.ts",
      HEADING_AUTHOR,
    ])
      expect(paths).toContain(known);
  });

  it("POSITIVE CONTROL: the leaf itself is the range author the scan sees", () => {
    const leaf = readFileSync(join(ROOT, LEAF), "utf8");
    expect(RANGE_AUTHOR.test(leaf)).toBe(true);
  });

  it("POSITIVE CONTROL: the panel's retired spanLabel is caught by both shapes", () => {
    const retired = [
      "function spanLabel([first, last]: PageSpan): string {",
      `  return first === last ? \`page ${D}{first}\` : \`pages ${D}{first}${EN}${D}{last}\`;`,
      "}",
    ].join("\n");
    expect(RANGE_AUTHOR.test(retired)).toBe(true);
    expect(PHRASE_AUTHOR.test(retired)).toBe(true);
    // And the escaped spelling of the dash.
    expect(RANGE_AUTHOR.test(`\`${D}{a}${EN_ESCAPE}${D}{b}\``)).toBe(true);
  });

  it("POSITIVE CONTROL: the heading author is seen, and only its name exempts it", () => {
    const heading = readFileSync(join(ROOT, HEADING_AUTHOR), "utf8");
    // The scan SEES the capitalised shape the heading author writes…
    expect(PHRASE_AUTHOR.test(heading)).toBe(true);
    expect(offends(HEADING_AUTHOR, heading)).toBe(false);
    // …so a planted copy of it in any other module is caught.
    const planted = [
      "const label = one",
      `  ? \`Page ${D}{clip[0]![0]}\``,
      `  : \`Pages ${D}{formatSpans(clip)}\`;`,
    ].join("\n");
    expect(offends("src/lib/workers/translate/typeset.ts", planted)).toBe(true);
    // And the exemption is the phrase shape only: a range there is caught.
    expect(offends(HEADING_AUTHOR, `\`${D}{a}${EN}${D}{b}\``)).toBe(true);
  });

  it("no importer other than the leaf writes a span of its own", () => {
    const offenders = importers
      .filter((f) => f.path !== LEAF.split(sep).join("/"))
      .filter((f) => offends(f.path, f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
