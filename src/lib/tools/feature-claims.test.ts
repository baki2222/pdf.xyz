// @vitest-environment node
/**
 * THE PROPERTY: the site does not sell a workflow feature the workspace does
 * not have.
 *
 * The homepage's workspace section (served on pdf.xyz at the audit) promised
 * "line up steps once and run them as a single pipeline", "save a workflow as
 * a preset you can rerun on the next batch in a click" and "chain tools into
 * repeatable pipelines", under "Build workflows, not one-off tasks" and an
 * arrowed "Example pipeline" strip. The workspace stages files and hands them
 * to ONE tool at a time. There is no chaining, no preset and no rerun.
 *
 * `unshipped-claims.test.ts` could not see this: it reads Markdown only, and
 * it checks the opposite direction (a line calling something unshipped that
 * the code proves exists).
 *
 * EXIT CONDITION (the property, not a mechanism): a pattern lifts only when a
 * user can run an ordered sequence of two or more tools over one batch, or
 * save such a sequence and rerun it on new files. A "preset" or "pipeline"
 * identifier appearing in workspace code does NOT lift it.
 *
 * Corpus in both directions (CLAUDE.md rule 1).
 *
 * This file is the guard the design spec calls `workflow-claims` (WP-02
 * named a new file; main already had this one, on the same section, so the
 * new sentences joined its corpus rather than splitting it in two).
 *
 * THE FINAL NARRATIVE (WP-13). The section now tells a chain (Merge, then
 * Compress, then Page numbers, then Sign, then Download) because WP-08 made
 * every ending a fork: a result offers the next tool with the file carried.
 * Two parts of it are claims about that, and each is held to the property
 * that makes it true, never to the words:
 *
 *  - the stations: each consecutive pair of tools is an edge the result's
 *    "Continue with" row really offers (`continueTargetsFor`), read from the
 *    RENDERED strip, so a station swapped for one that does not follow fails;
 *  - step 3, GATED: "Every PDF made in your browser offers the next tool,
 *    with the file already loaded." It may ship ONLY while every in-browser
 *    tool that makes a PDF has at least one continue target. That is the
 *    property `next-steps.test.ts` proves ("every PDF made in the browser
 *    has somewhere to go"), and it is computed here again over the same
 *    catalogue by the same predicate (`browserPdfDeadEnds`), so this file
 *    goes red on its own the day a dead end appears. EXIT CONDITION, the
 *    property: the gate lifts only when the sentence stops claiming it, not
 *    when a test somewhere else happens to pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import { browserPdfDeadEnds, browserPdfTools } from "@/lib/intent/dead-ends";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";
import { tools } from "./index";

const ROOT = process.cwd();
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

/** The final narrative (WP-13), exactly as the section must render it. */
const NARRATIVE = {
  heading: "One file, many tools, without picking it again.",
  steps: [
    "Drop a file anywhere — the tab reads it, nothing uploads.",
    "Open the tool we suggest, with the reason we suggest it.",
    "Every PDF made in your browser offers the next tool, with the file already loaded.",
  ],
} as const;

/** Workflow-feature claims, as shapes. */
const PATTERNS: readonly RegExp[] = [
  /\b(?:save|saved|store)\w*\s+(?:a\s+|your\s+)?(?:workflow|pipeline|sequence)s?\s+as\s+(?:a\s+)?preset/i,
  /\b(?:chain|line up|string together)\w*\s+(?:tools|steps)\b[^.]{0,80}\b(?:pipelines?|single run|one run)\b/i,
  /\b(?:repeatable|reusable)\s+(?:pipelines?|workflows?)\b/i,
  /\brerun\b[^.]{0,40}\bnext batch\b/i,
  /\bsingle pipeline\b/i,
  /\bbuild workflows\b/i,
  /\bexample pipeline\b/i,
];

/** What shipped (homepage, audit at 67e8d0f). */
const SHIPPED: readonly string[] = [
  "Merge, then compress, then stamp and sign — line up steps once and run them as a single pipeline.",
  "Download instantly, or save a workflow as a preset you can rerun on the next batch in a click.",
  "Most PDF sites make you repeat yourself. pdf.xyz keeps your files in a single workspace so you can chain tools into repeatable pipelines.",
  "Build workflows, not one-off tasks",
  "Example pipeline",
];

/** True sentences that must survive, so this is not a ban on words. */
const MUST_SURVIVE: readonly string[] = [
  "Add page numbers right in your browser — preset or custom number formats, with position, starting value, and typography.",
  "Presets “Page 1 of N”, “1 / N”, “1”, or “– 1 –” — or write your own template using {n} and {total}.",
  "Production pipeline",
  "Most PDF sites make you upload the same file again for every tool. pdf.xyz stages your files once, and the in-browser tools open with them already loaded.",
  // The final narrative (WP-13): true, so no pattern may catch it.
  NARRATIVE.heading,
  ...NARRATIVE.steps,
];

const hits = (text: string) => PATTERNS.filter((p) => p.test(text));

/**
 * GATED claims: a shape that may ship only while `offenders()` is empty.
 * Each pattern must catch its own corpus (rule 1, both directions), and the
 * predicate has a positive control below.
 */
const GATED: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly corpus: readonly string[];
  readonly offenders: () => string[];
}> = [
  {
    pattern:
      /\b(?:every|each|any)\b[^.]{0,60}\boffers?\s+(?:you\s+)?the next tool\b/i,
    corpus: [
      NARRATIVE.steps[2],
      // The spec's wording, which said "every result": broader than the
      // property (a PDF to JPG result offers nothing). Caught all the same.
      "Every result offers the next tool with the file already loaded.",
    ],
    offenders: () => browserPdfDeadEnds(tools),
  },
];

/**
 * Visible text of the rendered HOME PAGE, tags dropped. WAS the workflow
 * section alone (WP-13), which retired on 2026-10-21 with the plain home
 * page; its successor, "How it works", is read as part of the whole page,
 * so a claim moved into any home section is read too.
 */
function sectionText(): string {
  const html = renderToStaticMarkup(createElement(HomePage));
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("workflow-feature claims — the ban list and its corpus", () => {
  it("every shipped sentence is caught", () => {
    for (const s of SHIPPED) expect(hits(s), s).not.toEqual([]);
  });

  it("every pattern catches a shipped sentence", () => {
    for (const p of PATTERNS) {
      expect(
        SHIPPED.some((s) => p.test(s)),
        `${p} catches nothing that shipped`,
      ).toBe(true);
    }
  });

  it("true sentences survive", () => {
    for (const s of MUST_SURVIVE) expect(hits(s), s).toEqual([]);
  });
});

describe("no surface sells chaining, presets or reruns", () => {
  const files = copyFiles();

  it("health: the walk reaches the homepage's steps section", () => {
    // WAS workflow-section.tsx, retired 2026-10-21; How it works is where a
    // workflow claim would now be written.
    expect(files.map(rel)).toContain(
      "src/components/sections/how-it-works.tsx",
    );
  });

  it("finds no claim in the source a visitor reads", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = flattenForPhraseSearch(
        withoutComments(readFileSync(file, "utf8")),
      );
      for (const p of PATTERNS) {
        const m = text.match(p);
        if (m) offenders.push(`${rel(file)}: "${m[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds no claim in the RENDERED home page either", () => {
    const text = sectionText();
    expect(text.length).toBeGreaterThan(2000);
    expect(hits(text)).toEqual([]);
  });
});

/*
 * RETIRED 2026-10-21, history kept. "The final narrative (WP-13)" asserted the
 * home page rendered NARRATIVE's heading and three steps, and "the stations
 * are a chain the product really offers" read the section's five
 * `data-station` items and held each consecutive pair to an edge the
 * result's "Continue with" row offers. Both pinned the workflow section,
 * which the owner's plain redesign removed (its steps are now "How it
 * works", which names no chain). The narrative's sentences stay in
 * MUST_SURVIVE as true sentences no ban pattern may catch; the chain
 * property lives on in `next-steps.test.ts`, whose subject it always was.
 */
describe("the final narrative (WP-13) no longer ships", () => {
  it("the home page renders neither its heading nor its stations", () => {
    const text = sectionText();
    expect(text).not.toContain(NARRATIVE.heading);
    const html = renderToStaticMarkup(createElement(HomePage));
    expect(html).not.toMatch(/data-station=/);
  });
});

describe("gated claims ship only while their property holds", () => {
  it("every gated pattern catches its corpus, and the ban list does not", () => {
    for (const g of GATED) {
      expect(g.corpus.length).toBeGreaterThan(0);
      for (const s of g.corpus) {
        expect(g.pattern.test(s), `${g.pattern} misses "${s}"`).toBe(true);
        expect(hits(s), s).toEqual([]);
      }
    }
  });

  // INVERTED 2026-10-21: "the gated sentence is live, so the gate is
  // exercised". Step 3 left with the workflow section, so no surface ships
  // the gated shape today and the check below reads its surfaces without a
  // match. What keeps that from being a blind pass is that the surfaces are
  // real and the pattern still bites its corpus (the test above).
  it("health: the gate reads real surfaces", () => {
    expect(sectionText().length).toBeGreaterThan(2000);
    expect(copyFiles().length).toBeGreaterThanOrEqual(20);
  });

  it("a gated claim on any visitor surface has its property holding", () => {
    const failing: string[] = [];
    const surfaces = [
      sectionText(),
      ...copyFiles().map((f) =>
        flattenForPhraseSearch(withoutComments(readFileSync(f, "utf8"))),
      ),
    ];
    for (const g of GATED) {
      if (!surfaces.some((t) => g.pattern.test(t))) continue;
      const offenders = g.offenders();
      if (offenders.length > 0)
        failing.push(`${g.pattern}: ${offenders.join(", ")}`);
    }
    expect(failing).toEqual([]);
  });

  it("POSITIVE CONTROL: the step-3 predicate reports a dead end when one exists", () => {
    // Without its finishing steps, a signed PDF has nowhere to go.
    const without = tools.filter(
      (t) => !["flatten-pdf", "protect-pdf", "compress-pdf"].includes(t.slug),
    );
    expect(browserPdfDeadEnds(without)).toContain("sign-pdf");
    // ...and the real catalogue's walk has subjects: a blind filter
    // would report no dead ends too.
    expect(browserPdfTools(tools).length).toBeGreaterThanOrEqual(15);
    expect(browserPdfDeadEnds(tools)).toEqual([]);
  });
});
