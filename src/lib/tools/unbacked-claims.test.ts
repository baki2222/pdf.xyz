// @vitest-environment node
/**
 * Five sentences the site shipped that nothing in the product backs.
 *
 *  1. A QUANTITY THE CATALOGUE OWNS, UNDERSTATED. The FAQ said "a handful of
 *     heavy or AI-powered tools use encrypted, auto-deleting workers" and the
 *     homepage's security band "the few heavy or AI tasks that need a server".
 *     On 2026-10-09 the catalogue said 20 of 50 tools upload (16 worker, 4
 *     AI) and a 21st can (Compress's optional worker step): two in five is
 *     not a handful.
 *     The quantifier is a number, and it was the wrong one.
 *     EXIT CONDITION, a property the test computes rather than a promise: the
 *     rule lifts by itself when the tools that can upload are a handful —
 *     at most one in ten of the catalogue.
 *
 *  2. A RANKING NOTHING MEASURES. The hero labelled six tools "Popular right
 *     now". They are an editorial list (`getPopularTools`, a flag in the
 *     catalogue); no surface reads usage, so "right now" claimed a live
 *     measurement that does not exist.
 *     EXIT CONDITION: a list may say so on the day it is ordered by measured
 *     use, shown by a test that reorders it when the measurement changes.
 *
 *  3. WHERE THE AI MODEL RUNS. "AI tools run on secure infrastructure" (FAQ,
 *     security band) and "Runs on secure infrastructure under provider
 *     agreements" (AI band) read as if the model ran on pdf.xyz's own
 *     servers. It runs at a third-party provider, which receives the PDF's
 *     text under terms that prohibit training on it — the sentence
 *     `processing.ts` already says, and the one these now say.
 *     EXIT CONDITION: the model itself runs on infrastructure pdf.xyz
 *     operates.
 *
 *  4. DOCUMENTS THAT ARE NOT THERE. Three panels sent the reader to "our
 *     worker architecture and security docs". No such page is published;
 *     the words were plain text, not even a link. They now link the privacy
 *     policy's section on files, which says what those sentences promised.
 *     EXIT CONDITION: the sentence is a link to a published page of docs.
 *
 *  5. A START OVER THAT RELOADS THE PAGE. Compare PDF's How it works said
 *     "Start over reloads the page, which clears both slots for a new pair".
 *     It was true while the result panel's reset was
 *     `window.location.reload()`; on 2026-10-09 the reset began clearing the
 *     result and both slots in place, and the fix made the sentence on its
 *     own page false — served as HowTo JSON-LD as well as visible copy. The
 *     quoted-label guard could not see it (no curly quotes), so only this
 *     corpus does.
 *     EXIT CONDITION: pressing Start over reloads the page. That is the
 *     property `start-over.test.ts` (its Reloads control) and
 *     `compare-pdf-runner.test.tsx` (driven through the runner, URL
 *     unchanged) now hold false, so this rule has no automatic exit: a
 *     change that brings a reload back inverts those two and lifts this in
 *     the same commit.
 *
 * THE CORPUS is every file the copy walk reaches (`copyFiles()`), comments
 * removed and JSX flattened to the text a reader sees — so a phrase broken by
 * a `<span>` or a `{" "}` is still one phrase. Each rule's shipped sentences
 * are its positive control, in both directions: every shipped sentence is
 * caught, and every pattern catches one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";
import { tools } from "./catalog";
import { processingSplit } from "./processing-split";

const ROOT = process.cwd();

interface Rule {
  name: string;
  patterns: readonly RegExp[];
  /** Verbatim, as shipped before 2026-10-09. */
  shipped: readonly string[];
}

/** At most one tool in ten: what "a handful" of a catalogue can honestly mean. */
const HANDFUL = 0.1;

const RULES: readonly Rule[] = [
  {
    name: "a quantifier that understates the tools that upload",
    patterns: [
      /\b(?:a\s+handful(?:\s+of)?|(?:the|a)\s+few|a\s+couple\s+of)(?:\s+[\w-]+){0,4}?\s+(?:tools?|tasks?|jobs?)\b/i,
    ],
    shipped: [
      "A handful of heavy or AI-powered tools use encrypted, auto-deleting workers — and each tool clearly labels where it runs.",
      "The few heavy or AI tasks that need a server use TLS in transit and encrypted, isolated workers.",
    ],
  },
  {
    name: "a ranking by use nothing measures",
    patterns: [
      /\b(?:popular|trending)\s+(?:right\s+)?(?:now|today|this\s+week)\b|\btrending\b/i,
    ],
    shipped: ["Popular right now"],
  },
  {
    name: "the AI model placed on infrastructure pdf.xyz runs",
    patterns: [
      /\b(?:runs?|running|hosted|processed)\s+on\s+secure\s+infrastructure\b/i,
    ],
    shipped: [
      "Never. AI tools run on secure infrastructure and your document content is never used to train any model.",
      "AI tools run on secure infrastructure and your content is never used to train any model.",
      "Runs on secure infrastructure under provider agreements that prohibit training on your content",
    ],
  },
  {
    name: "a pointer to documents that are not published",
    patterns: [/\b(?:our|the)(?:\s+[\w-]+){0,5}?\s+docs\b/i],
    shipped: [
      "No account required. When this ships, files are encrypted in transit and at rest, processed on a separate processing server, and deleted automatically — see our worker architecture and security docs.",
      "It's enabled per deployment — see our worker architecture and security docs.",
      "See the worker architecture and security docs for how uploads, scanning, isolation, and auto-delete work.",
    ],
  },
  {
    name: "a Start over that reloads the page",
    // Either verb, any tense, with the label quoted or not, up to a clause
    // away: "Start over reloads", "“Start over” refreshes the page",
    // "Start over, which reloads". Bounded by the sentence.
    patterns: [
      /\bstart\s+over\b[^.]{0,40}?\b(?:re-?load(?:s|ed|ing)?|refresh(?:es|ed|ing)?)\b/i,
    ],
    shipped: [
      "Download comparison report saves the whole report as a text file named after both PDFs, for example draft-vs-final-comparison.txt. Start over reloads the page, which clears both slots for a new pair.",
    ],
  },
];

/** Source as a reader sees it: no comments, no tags, no `{" "}`, one line. */
function readerText(source: string): string {
  return flattenForPhraseSearch(withoutComments(source))
    .replace(/\{\s*(["'`])\s*\1\s*\}/g, " ")
    .replace(/<\/?[A-Za-z][^<>]*>/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ");
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

function findings(rule: Rule): string[] {
  return copyFiles().flatMap((file) => {
    const text = readerText(readFileSync(file, "utf8"));
    return rule.patterns.flatMap((p) =>
      [...text.matchAll(new RegExp(p.source, `${p.flags}g`))].map(
        (m) => `${rel(file)}: …${m[0]}…`,
      ),
    );
  });
}

describe("each rule's corpus, both ways", () => {
  it.each(RULES.map((r) => [r.name, r] as const))("%s", (_, rule) => {
    // Every shipped sentence is caught…
    expect(
      rule.shipped.filter((s) => !rule.patterns.some((p) => p.test(s))),
    ).toEqual([]);
    // …and every pattern catches one, or it is decoration.
    expect(
      rule.patterns.filter((p) => !rule.shipped.some((s) => p.test(s))),
    ).toEqual([]);
  });

  it('the reader-text flattening sees through a <span> and a {" "}', () => {
    const jsx = `see our{" "}
      <span className="text-muted">worker architecture</span> and security
      docs.`;
    expect(readerText(jsx)).toContain(
      "see our worker architecture and security docs.",
    );
  });

  it("health check: the walk reaches the copy, the hero and the panels", () => {
    const files = copyFiles().map(rel);
    expect(files.length).toBeGreaterThanOrEqual(120);
    for (const f of [
      "src/lib/faq.ts",
      "src/components/sections/hero.tsx",
      "src/components/tools/ocr-worker-panel.tsx",
      "src/app/status/page.tsx",
      // Rule 5's sentence lived in a tool page's content file.
      "src/lib/tools/content/compare-pdf.ts",
    ])
      expect(files).toContain(f);
  });
});

describe("no copy states what the product cannot back", () => {
  it("the share of tools that can upload is computed, not assumed", () => {
    const split = processingSplit();
    const uploading = split.browserFirst.length + split.workerOnly.length;
    expect(uploading).toBeGreaterThan(0);
    expect(uploading).toBeLessThan(tools.length);
  });

  it.each(RULES.map((r) => [r.name, r] as const))("%s", (_, rule) => {
    if (rule === RULES[0]) {
      const split = processingSplit();
      const share =
        (split.browserFirst.length + split.workerOnly.length) / tools.length;
      // The exit condition, evaluated: at a handful, the quantifier is true.
      if (share <= HANDFUL) return;
    }
    expect(findings(rule)).toEqual([]);
  });
});
