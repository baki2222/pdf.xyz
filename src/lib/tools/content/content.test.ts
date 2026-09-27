// @vitest-environment node
/**
 * The tool-page content corpus: complete, within its budgets, and UNIQUE.
 *
 * The audit this corpus answers (2026-09-27) found fifty tool pages that were
 * one template with the name swapped in — sibling pages sharing up to 70% of
 * their text, titles that did not contain "PDF". The content files fix the
 * words; this file keeps them fixed, and it asks every question of a set it
 * DERIVES rather than types:
 *
 *  - the slugs come from the catalogue (`getAllToolSlugs`), so a new tool with
 *    no content fails here by name;
 *  - the files come from the directory AND from the index's import list, so a
 *    file nobody imports, or an import of a slug the catalogue does not have,
 *    fails too — both directions of the corpus rule.
 *
 * Every predicate is a function with a positive control below it: a check that
 * returns nothing on a broken input reports the strongest possible pass.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAllToolSlugs, getToolBySlug } from "@/lib/tools";
import {
  modeHasBrowserPath,
  modeUploadsFiles,
} from "@/lib/tools/processing-split";
import { getAllGuideSlugs } from "@/lib/guides";
import { getToolContent, toolContent, type ToolContent } from "./index";

const DIR = path.join(process.cwd(), "src", "lib", "tools", "content");
const NOT_CONTENT = new Set(["types.ts", "index.ts"]);

/* ------------------------------------------------------------------ *
 *  The predicates (exercised by the corpus AND by the controls)
 * ------------------------------------------------------------------ */

export const BUDGET = {
  seoTitleMax: 50,
  metaMin: 120,
  metaMax: 160,
  steps: [3, 5],
  faqs: [4, 6],
  maxPairOverlap: 0.25,
} as const;

/** Everything wrong with one tool's content, as readable sentences. */
function contentProblems(
  c: ToolContent,
  guideSlugs: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  if (c.seoTitle.length > BUDGET.seoTitleMax)
    problems.push(
      `seoTitle is ${c.seoTitle.length} chars (max ${BUDGET.seoTitleMax})`,
    );
  if (/pdf\.xyz/i.test(c.seoTitle))
    problems.push("seoTitle carries the site name; the layout appends it");
  const m = c.metaDescription.length;
  if (m < BUDGET.metaMin || m > BUDGET.metaMax)
    problems.push(
      `metaDescription is ${m} chars (want ${BUDGET.metaMin}-${BUDGET.metaMax})`,
    );
  const [sMin, sMax] = BUDGET.steps;
  if (c.steps.length < sMin || c.steps.length > sMax)
    problems.push(`${c.steps.length} steps (want ${sMin}-${sMax})`);
  const [fMin, fMax] = BUDGET.faqs;
  if (c.faqs.length < fMin || c.faqs.length > fMax)
    problems.push(`${c.faqs.length} FAQs (want ${fMin}-${fMax})`);
  if (c.intro.length === 0) problems.push("no intro paragraphs");
  for (const g of c.relatedGuides)
    if (!guideSlugs.has(g))
      problems.push(`relatedGuides names "${g}", no such guide`);
  if (new Set(c.relatedGuides).size !== c.relatedGuides.length)
    problems.push("relatedGuides repeats a slug");
  const questions = c.faqs.map((f) => f.q);
  if (new Set(questions).size !== questions.length)
    problems.push("two FAQs ask the same question");
  return problems;
}

/** The prose a reader of the page meets from this file. */
export function proseOf(c: ToolContent): string {
  return [
    ...c.intro,
    ...c.useCases.flatMap((u) => [u.title, u.body]),
    ...c.steps.flatMap((s) => [s.title, s.body]),
    ...c.faqs.flatMap((f) => [f.q, f.a]),
  ].join(" ");
}

/** Lower-cased word 5-grams. */
export function shingles(text: string, n = 5): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++)
    out.add(words.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

interface Pair {
  a: string;
  b: string;
  overlap: number;
}

/** Every pair, worst first. */
function pairOverlaps(entries: readonly ToolContent[]): Pair[] {
  const sets = entries.map((c) => [c.slug, shingles(proseOf(c))] as const);
  const pairs: Pair[] = [];
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const [a, sa] = sets[i]!;
      const [b, sb] = sets[j]!;
      pairs.push({ a, b, overlap: jaccard(sa, sb) });
    }
  return pairs.sort((x, y) => y.overlap - x.overlap);
}

/** The `./slug` modules the index imports — what the page actually consumes. */
function indexImports(): string[] {
  const source = readFileSync(path.join(DIR, "index.ts"), "utf8");
  return [...source.matchAll(/^import \w+ from "\.\/([^"]+)";$/gm)].map(
    (m) => m[1]!,
  );
}

function contentFiles(): string[] {
  return readdirSync(DIR)
    .filter(
      (f) => f.endsWith(".ts") && !f.includes(".test.") && !NOT_CONTENT.has(f),
    )
    .map((f) => f.replace(/\.ts$/, ""));
}

/* ------------------------------------------------------------------ *
 *  The corpus
 * ------------------------------------------------------------------ */

const catalogue = getAllToolSlugs();
const guideSlugs = new Set(getAllGuideSlugs());
const entries = Object.values(toolContent);

describe("every tool has content, and every content file is a tool", () => {
  it("the corpus is the size of the catalogue (health check)", () => {
    // `[] ⊆ X` is vacuously true: a map that quietly emptied would pass every
    // per-entry assertion below. The catalogue is the independent bound.
    expect(catalogue.length).toBeGreaterThanOrEqual(50);
    expect(entries.length).toBe(catalogue.length);
    expect(contentFiles().length).toBe(catalogue.length);
    expect(indexImports().length).toBe(catalogue.length);
  });

  it("no catalogued tool lacks content", () => {
    const missing = catalogue.filter((slug) => !getToolContent(slug));
    expect(
      missing,
      `tools with no content file: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("no content file names a slug the catalogue does not have", () => {
    const known = new Set(catalogue);
    const stray = [
      ...contentFiles(),
      ...indexImports(),
      ...entries.map((c) => c.slug),
    ].filter((slug) => !known.has(slug));
    expect(
      stray,
      `content for tools that do not exist: ${stray.join(", ")}`,
    ).toEqual([]);
  });

  it("each file's slug is its filename, and the index imports every file", () => {
    for (const file of contentFiles()) {
      const source = readFileSync(path.join(DIR, `${file}.ts`), "utf8");
      expect(source, `${file}.ts must declare slug "${file}"`).toContain(
        `slug: "${file}"`,
      );
    }
    expect([...indexImports()].sort()).toEqual([...contentFiles()].sort());
  });

  it("an unknown slug has no content (the lookup is not a prototype walk)", () => {
    expect(getToolContent("constructor")).toBeUndefined();
    expect(getToolContent("does-not-exist")).toBeUndefined();
  });
});

describe("every tool's content is inside its budgets", () => {
  it.each(catalogue)("%s", (slug) => {
    const c = getToolContent(slug);
    expect(c).toBeDefined();
    expect(contentProblems(c!, guideSlugs)).toEqual([]);
  });

  it("positive control: each budget fires on a real file pushed past it", () => {
    const base = getToolContent("merge-pdf")!;
    expect(contentProblems(base, guideSlugs)).toEqual([]);
    const broken: ToolContent = {
      ...base,
      seoTitle: "x".repeat(BUDGET.seoTitleMax + 1),
      metaDescription: "too short",
      steps: base.steps.slice(0, 2),
      faqs: [...base.faqs, ...base.faqs].slice(0, 7),
      relatedGuides: ["how-to-do-nothing"],
    };
    const problems = contentProblems(broken, guideSlugs).join("\n");
    expect(problems).toMatch(/seoTitle is 51 chars/);
    expect(problems).toMatch(/metaDescription is 9 chars/);
    expect(problems).toMatch(/2 steps/);
    expect(problems).toMatch(/7 FAQs/);
    expect(problems).toMatch(/no such guide/);
    expect(problems).toMatch(/same question/);
    expect(
      contentProblems(
        { ...base, metaDescription: "y".repeat(BUDGET.metaMax + 1) },
        guideSlugs,
      ),
    ).toEqual([`metaDescription is 161 chars (want 120-160)`]);
    expect(guideSlugs.size).toBeGreaterThan(0);
  });
});

describe("no two tool pages say the same thing", () => {
  it("every pair's 5-word-shingle overlap is below the ceiling", () => {
    const pairs = pairOverlaps(entries);
    // Health check: 50 tools give 1,225 pairs; a collapsed corpus gives few.
    expect(pairs.length).toBe((entries.length * (entries.length - 1)) / 2);
    const worst = pairs[0]!;
    // Printed on every run, green or red: the margin is the useful number.
    console.info(
      `worst pair: ${worst.a} / ${worst.b} — Jaccard ${worst.overlap.toFixed(3)} (ceiling ${BUDGET.maxPairOverlap})`,
    );
    const over = pairs.filter((p) => p.overlap >= BUDGET.maxPairOverlap);
    expect(
      over.map((p) => `${p.a} / ${p.b}: ${p.overlap.toFixed(3)}`),
      "these pages share too much of their text",
    ).toEqual([]);
  });

  it("every file has enough prose for the measure to mean something", () => {
    // A page with 20 shingles overlaps nothing and says nothing.
    for (const c of entries)
      expect(shingles(proseOf(c)).size, c.slug).toBeGreaterThan(300);
  });

  it("positive control: a templated sibling is caught", () => {
    // The defect this corpus replaced: one page, the name swapped.
    const merge = getToolContent("merge-pdf")!;
    const text = proseOf(merge);
    const clone = text
      .replaceAll("Merge PDF", "Split PDF")
      .replaceAll("merge", "split");
    const pair = jaccard(shingles(text), shingles(clone));
    expect(pair).toBeGreaterThanOrEqual(BUDGET.maxPairOverlap);
    // ...and half a page copied is caught too, not only a full clone.
    const half =
      proseOf(getToolContent("split-pdf")!) +
      " " +
      text.slice(0, text.length / 2);
    expect(jaccard(shingles(text), shingles(half))).toBeGreaterThanOrEqual(
      BUDGET.maxPairOverlap,
    );
    // Negative control on the instrument: identical text is 1, disjoint is 0.
    expect(jaccard(shingles(text), shingles(text))).toBe(1);
    expect(jaccard(shingles("a b c d e f"), shingles("g h i j k l"))).toBe(0);
  });
});

/*
 * The title and description are the two strings a searcher reads BEFORE the
 * page — in the result itself — and they carry the strongest claim on it:
 * "No Upload". Asked of the catalogue's processing mode through the one
 * definition (`processing-split.ts`), never typed per tool, so a tool moved to
 * the worker turns its own title red.
 */
const NO_UPLOAD =
  /\b(?:no upload|not uploaded|nothing (?:is )?uploaded|never uploaded|without uploading)\b/i;
const RUNS_LOCALLY =
  /\b(?:in your browser|in-browser|on your device|browser tab)\b/i;

function locationProblems(
  c: Pick<ToolContent, "seoTitle" | "metaDescription">,
  mode: Parameters<typeof modeUploadsFiles>[0],
): string[] {
  const out: string[] = [];
  for (const [field, text] of [
    ["seoTitle", c.seoTitle],
    ["metaDescription", c.metaDescription],
  ] as const) {
    if (NO_UPLOAD.test(text) && modeUploadsFiles(mode))
      out.push(`${field} says nothing is uploaded, but "${mode}" uploads`);
    if (RUNS_LOCALLY.test(text) && !modeHasBrowserPath(mode))
      out.push(
        `${field} says it runs locally, but "${mode}" has no browser path`,
      );
  }
  return out;
}

describe("the search result's location claim is the tool's mode", () => {
  it.each(catalogue)("%s", (slug) => {
    const tool = getToolBySlug(slug)!;
    expect(locationProblems(getToolContent(slug)!, tool.processing)).toEqual(
      [],
    );
  });

  it("health check: the claim is actually made, so the rule is exercised", () => {
    const claiming = entries.filter(
      (c) => NO_UPLOAD.test(c.seoTitle) || NO_UPLOAD.test(c.metaDescription),
    );
    expect(claiming.length).toBeGreaterThanOrEqual(10);
  });

  it("positive control: Split PDF's own title, on a worker tool, is caught", () => {
    // The title the split writer asked to be the control: true in client
    // mode, false the moment the tool uploads.
    const split = getToolContent("split-pdf")!;
    expect(locationProblems(split, "client")).toEqual([]);
    expect(locationProblems(split, "server").join("\n")).toMatch(
      /seoTitle says nothing is uploaded/,
    );
    expect(locationProblems(split, "server").join("\n")).toMatch(
      /runs locally/,
    );
    // Hybrid tools may say "in your browser" (they have that path) but not
    // "no upload" (they have the other one too).
    expect(
      locationProblems(
        {
          seoTitle: "Compress PDF in Your Browser",
          metaDescription: "No upload.",
        },
        "hybrid",
      ),
    ).toEqual([
      'metaDescription says nothing is uploaded, but "hybrid" uploads',
    ]);
  });
});
