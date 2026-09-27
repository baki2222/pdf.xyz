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
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "@/lib/tools/page-copy";
import {
  modeHasBrowserPath,
  modeUploadsFiles,
} from "@/lib/tools/processing-split";
import type { ProcessingMode, Tool } from "@/lib/tools/types";
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

/*
 * ...and the same claim in the BODY and the FAQ, where the page makes it at
 * length and the FAQPage JSON-LD ships it to a search engine.
 *
 * Added 2026-09-27 after review. The derived `modeFaq` ("Is my file uploaded
 * when I use X?") was TRUE BY CONSTRUCTION, read off the mode; the authored
 * content replaced it with answers nothing tied to the mode. The reviewer put
 * "Your file is never uploaded; it stays on your device." into the intro of
 * `protect-pdf`, a server tool, and the whole suite stayed at its baseline.
 * Every sentence shipped then was true; the property this checks is that a
 * tool which CHANGES mode turns its own body red.
 *
 * Read through `page-copy` (what the page renders), one sentence at a time:
 *
 *  - on a tool with NO browser path, a sentence may not say the work stays
 *    local ("in your browser", "not uploaded", "never leaves") unless it is
 *    negated there ("does not run in your browser");
 *  - on a tool that NEVER uploads, a sentence may not say the file goes to the
 *    worker ("is uploaded", "over TLS", "secure worker");
 *  - either way, a sentence that NAMES another catalogued tool whose mode does
 *    what the sentence says is about that tool: "PDF to Text runs in your
 *    browser" on the PDF to Word page, "Unlock PDF uploads the file" on Merge
 *    PDF's. The named tool must support the claim, so "Unlike Unlock PDF, your
 *    file is never uploaded" on a server page is still red. What this cannot
 *    see is a sentence that names a supporting tool AND makes the claim about
 *    this one ("Like PDF to Text, this never uploads"): the subject is not
 *    parsed, only the names.
 *  - a mode with BOTH paths (`hybrid`, today) is not checked here, since
 *    either sentence can be true of it. Its title and description are (above).
 */
/** Local claims the title check does not need, spelled as the body spells them. */
const STAYS_LOCAL =
  /\b(?:uploads nothing|never leaves|(?:does|do) not leave (?:your|the)|stays? on your (?:own )?device|(?:not|never) sent to pdf\.xyz|no copy sent)\b/i;
const RUNS_LOCALLY_BODY =
  /\b(?:in your browser|in-browser|on your (?:own )?device|by your own browser|browser tab|locally)\b/i;
/** A negation just before a location phrase: "does not run in your browser". */
const NEGATED_BEFORE =
  /\b(?:not|no|cannot|never|neither|none|nothing)\b(?:\s+[\w-]+){0,3}\s+$/i;
/** The work, or the file, leaving the device. Third person: "uploads the PDF",
 * never the reader's "upload a PNG of your signature", which picks a file. */
const GOES_REMOTE =
  /\b(?:secure worker|over TLS|pdf\.xyz's worker|(?:is|are|gets?|be) uploaded|uploads (?:it|your|the|a|each|them)|on (?:a|the) server|server-side)\b/i;

type Claim = "local" | "remote";

/** Matches of `pattern` in `sentence` that no negation just before undoes. */
function affirmed(sentence: string, pattern: RegExp): boolean {
  return [...sentence.matchAll(new RegExp(pattern.source, "gi"))].some(
    (m) => !NEGATED_BEFORE.test(sentence.slice(0, m.index)),
  );
}

/**
 * What one sentence says about where the work happens, if anything. A
 * question asks rather than claims ("Does my PDF get uploaded?"), and its
 * answer is the next sentence, which is read.
 */
function sentenceClaims(sentence: string): Claim[] {
  if (/\?\s*$/.test(sentence)) return [];
  const out: Claim[] = [];
  if (
    NO_UPLOAD.test(sentence) ||
    STAYS_LOCAL.test(sentence) ||
    affirmed(sentence, RUNS_LOCALLY_BODY)
  )
    out.push("local");
  if (affirmed(sentence, GOES_REMOTE)) out.push("remote");
  return out;
}

/** Other catalogued tools a sentence names, whose mode makes `claim` true. */
function namedSupporters(
  sentence: string,
  claim: Claim,
  self: string,
): string[] {
  return catalogueTools
    .filter((t) => t.slug !== self)
    .filter((t) =>
      new RegExp(`(?<![\\w])${escapeRe(t.name)}(?![\\w])`).test(sentence),
    )
    .filter((t) =>
      claim === "local"
        ? modeHasBrowserPath(t.processing)
        : modeUploadsFiles(t.processing),
    )
    .map((t) => t.name);
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The `|`-separated alternatives of a `\b(?:a|b|c)\b` pattern, nesting kept. */
function topLevelAlternatives(pattern: RegExp): string[] {
  const inner = pattern.source.replace(/^\\b\(\?:/, "").replace(/\)\\b$/, "");
  const alts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "\\") {
      current += ch + inner[i + 1];
      i++;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "|" && depth === 0) {
      alts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  alts.push(current);
  return alts;
}

export function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

/** Every string of prose the rendered page carries for this tool. */
function pageProse(tool: Tool): string[] {
  return [
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

interface BodyClaim {
  sentence: string;
  claim: Claim;
  supporters: string[];
}

function bodyClaims(tool: Tool, prose = pageProse(tool)): BodyClaim[] {
  const out: BodyClaim[] = [];
  for (const text of prose)
    for (const sentence of sentencesOf(text))
      for (const claim of sentenceClaims(sentence))
        out.push({
          sentence,
          claim,
          supporters: namedSupporters(sentence, claim, tool.slug),
        });
  return out;
}

function bodyLocationProblems(
  tool: Tool,
  mode: ProcessingMode = tool.processing,
  prose = pageProse(tool),
): string[] {
  if (hasBothPaths(mode)) return [];
  return bodyClaims(tool, prose)
    .filter((c) => c.supporters.length === 0)
    .filter((c) =>
      c.claim === "local" ? !modeHasBrowserPath(mode) : !modeUploadsFiles(mode),
    )
    .map((c) =>
      c.claim === "local"
        ? `says the work stays local, but "${mode}" has no browser path: ${c.sentence}`
        : `says the file is uploaded, but "${mode}" never uploads: ${c.sentence}`,
    );
}

const catalogueTools = catalogue.map((slug) => getToolBySlug(slug)!);
const catalogueModes = [...new Set(catalogueTools.map((t) => t.processing))];

/** A mode with a browser path AND an upload path, where either claim is true. */
function hasBothPaths(mode: ProcessingMode): boolean {
  return modeUploadsFiles(mode) && modeHasBrowserPath(mode);
}

describe("the body's location claims are the tool's mode", () => {
  it.each(catalogue)("%s", (slug) => {
    expect(bodyLocationProblems(getToolBySlug(slug)!)).toEqual([]);
  });

  it("health check: both claims are made, both exemptions are used", () => {
    // `[] ⊆ X`: a claim detector gone blind passes every page above.
    const all = catalogueTools.flatMap((t) =>
      bodyClaims(t).map((c) => ({ ...c, mode: t.processing })),
    );
    const localOnClient = all.filter(
      (c) => c.claim === "local" && !modeUploadsFiles(c.mode),
    );
    const remoteOnServer = all.filter(
      (c) => c.claim === "remote" && modeUploadsFiles(c.mode),
    );
    expect(localOnClient.length).toBeGreaterThanOrEqual(29);
    expect(remoteOnServer.length).toBeGreaterThanOrEqual(20);
    // The named-tool exemption is exercised in BOTH directions today...
    expect(
      all.filter((c) => !modeUploadsFiles(c.mode) && c.claim === "remote")
        .length,
    ).toBeGreaterThanOrEqual(10);
    expect(
      all.filter((c) => !modeHasBrowserPath(c.mode) && c.claim === "local")
        .length,
    ).toBeGreaterThanOrEqual(3);
    // ...and the negation is too: these server pages say where they do NOT run.
    const negated = catalogueTools
      .filter((t) => !modeHasBrowserPath(t.processing))
      .flatMap((t) => pageProse(t).flatMap(sentencesOf))
      .filter(
        (s) =>
          RUNS_LOCALLY_BODY.test(s) && !sentenceClaims(s).includes("local"),
      );
    expect(negated.length).toBeGreaterThanOrEqual(5);
  });

  it("every alternative in the claim patterns catches a sentence that ships", () => {
    // Rule 1, the second direction: a spelling nothing exercises is
    // decoration, and it is where a pattern quietly stops meaning its name.
    // (The first direction is the mode-change control below: every page's
    // own location sentences are caught once its mode is wrong.)
    const shipped = catalogueTools.flatMap((t) => [
      getToolContent(t.slug)!.seoTitle,
      getToolContent(t.slug)!.metaDescription,
      ...pageProse(t).flatMap(sentencesOf),
    ]);
    const patterns = { NO_UPLOAD, STAYS_LOCAL, RUNS_LOCALLY_BODY, GOES_REMOTE };
    let total = 0;
    for (const [name, pattern] of Object.entries(patterns)) {
      const alts = topLevelAlternatives(pattern);
      // Health: the splitter really split (a blind one returns the whole).
      expect(alts.length, `${name} split into alternatives`).toBeGreaterThan(3);
      total += alts.length;
      for (const alt of alts) {
        const one = new RegExp(`\\b(?:${alt})\\b`, "i");
        expect(
          shipped.some((s) => one.test(s)),
          `${name}'s "${alt}" matches no shipped sentence`,
        ).toBe(true);
      }
    }
    expect(total).toBeGreaterThanOrEqual(20);
  });

  it("positive control: the reviewer's mutation on protect-pdf is caught", () => {
    const protect = getToolBySlug("protect-pdf")!;
    expect(protect.processing).toBe("server");
    const mutated = [
      "Your file is never uploaded; it stays on your device.",
      ...pageProse(protect),
    ];
    expect(bodyLocationProblems(protect, protect.processing, mutated)).toEqual([
      'says the work stays local, but "server" has no browser path: Your file is never uploaded; it stays on your device.',
    ]);
    // A named tool that does NOT support the claim is no cover for it.
    expect(
      bodyLocationProblems(protect, "server", [
        "Unlike Unlock PDF, your file is never uploaded.",
      ]),
    ).toHaveLength(1);
    // Negated, it is the true statement it is on a server page.
    expect(
      bodyLocationProblems(protect, "server", [
        "qpdf is a native program, so this tool does not run in your browser.",
      ]),
    ).toEqual([]);
  });

  it("positive control: a tool that changes mode turns its own body red", () => {
    // The property: each page's body is true of ITS mode, and false of the
    // other. Moved to the browser, Protect PDF's page still describes the
    // worker; moved to the worker, Split PDF's still promises the browser.
    const protect = getToolBySlug("protect-pdf")!;
    const split = getToolBySlug("split-pdf")!;
    expect(bodyLocationProblems(protect, "client").length).toBeGreaterThan(0);
    expect(bodyLocationProblems(split, "server").length).toBeGreaterThan(0);
    // Every page with a single-sided mode says enough to be caught if moved.
    for (const t of catalogueTools) {
      if (hasBothPaths(t.processing)) continue;
      // The mode on the other side of BOTH questions, found in the catalogue
      // rather than typed: a tool that never uploads moves to one with no
      // browser path, and the reverse.
      const other = catalogueModes.find(
        (m) =>
          modeUploadsFiles(m) !== modeUploadsFiles(t.processing) &&
          modeHasBrowserPath(m) !== modeHasBrowserPath(t.processing),
      )!;
      expect(
        bodyLocationProblems(t, other).length,
        `${t.slug}'s page would read the same if its tool changed mode`,
      ).toBeGreaterThan(0);
    }
  });
});
