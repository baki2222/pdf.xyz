// @vitest-environment node
/**
 * Seven sentences the site shipped that nothing in the product backs.
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
 *  6. SETTINGS YOU CAN CHANGE ONLY BY STARTING OVER. Page numbers said "Start
 *     over clears the loaded file, so changing a setting afterwards means
 *     picking the original again", and Watermark PDF "There is no preview,
 *     so to change the settings press Start over and choose the file
 *     again". Both were true until the result panel gained "Back to adjust"
 *     (WP-08), which returns to the settings with the same file loaded —
 *     and both were served as HowTo / FAQPage JSON-LD as well as visible
 *     copy. No curly quotes, so only this corpus sees them (addendum WP-08
 *     #8).
 *     NO EXIT CONDITION: every tool's content is read for this rule.
 *     There was one — a tool whose runner passed `NO_ADJUST` had its whole
 *     content file lifted, and so did a tool with no in-browser runner. The
 *     marker is a MECHANISM; the property it was standing for is "no control
 *     in the result returns to the settings with the same file", and the
 *     first runner it lifted, PDF to Image, has exactly such a control
 *     ("Change resolution" returns to the chips with the same file), so on
 *     day one it licensed the false sentence on PDF to JPG and PDF to PNG.
 *     Nor does a worker panel lose its file when it shows a result. Both
 *     lifts licensed no shipped sentence (measured: the corpus is green with
 *     neither), so both went — CLAUDE.md rule 2, a guard that can license a
 *     defect is worse than none (WP-08 review, 2026-10-10). If a tool ever
 *     needs the sentence, key its exit on that property, measured from its
 *     result — never on a marker.
 *
 *  7. A PROVIDER'S TRAINING, PROMISED ABSOLUTELY. /privacy's file-handling
 *     list ended "Nothing here is used to train any model — not ours, and
 *     not a provider's." The first half is pdf.xyz's to promise; the second
 *     is not. A third-party provider receives the text, and what stops it
 *     training is its terms plus three switches in our account (verified
 *     off 2026-08-10) — which the same page's section 3 says, hedge
 *     included ("We cannot control what a provider does beyond that"); the
 *     FAQ, the homepage and every AI tool's page give the terms form. One
 *     page made two claims. It now says pdf.xyz trains no models and points
 *     to section 3 for the provider.
 *     NO EXIT CONDITION while a third party receives the text: no test in
 *     this repository can see a provider's conduct or an account switch, so
 *     the strongest true sentence is the terms one.
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
  {
    name: "settings that can be changed only by starting over",
    // "changing a setting … means picking", "to change the settings press
    // Start over", and the label-first order: "Start over … choose the file
    // again". Bounded by the sentence.
    patterns: [
      /\bchang(?:e|ing)\s+(?:a|the|any)\s+settings?\b[^.]{0,60}?\b(?:start\s+over|pick(?:s|ing)?|choos(?:e|es|ing))\b/i,
      /\bstart\s+over\b[^.]{0,80}?\b(?:pick(?:s|ing)?|choos(?:e|es|ing)|load(?:s|ing)?)\s+(?:the\s+)?(?:original|file|pdf)\s+again\b/i,
    ],
    shipped: [
      "Start over clears the loaded file, so changing a setting afterwards means picking the original again.",
      "There is no preview, so to change the settings press Start over and choose the file again.",
    ],
  },
  {
    name: "a provider's training ruled out absolutely",
    // "not ours, and not a provider's" / "nor any provider's", and the
    // absolute form the homepage card once used: "never used to train any
    // model". Bounded by the sentence. A promise about pdf.xyz's OWN use
    // ("does not permit us … to train a machine-learning model") is not this.
    patterns: [
      /\bnot\s+ours\b[^.]{0,20}?\b(?:not|nor)\s+(?:a|the|any)\s+(?:AI\s+)?provider'?s\b/i,
      /\b(?:nothing|never)\b[^.]{0,30}?\bused\s+to\s+train\s+any\s+(?:AI\s+)?models?\b/i,
    ],
    shipped: [
      "Nothing here is used to train any model — not ours, and not a provider's.",
      "AI tools run on secure infrastructure and your content is never used to train any model.",
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

/** What `rule` catches in one file's source, as a reader sees it. */
function matches(rule: Rule, file: string, source: string): string[] {
  const text = readerText(source);
  return rule.patterns.flatMap((p) =>
    [...text.matchAll(new RegExp(p.source, `${p.flags}g`))].map(
      (m) => `${rel(file)}: …${m[0]}…`,
    ),
  );
}

/**
 * Every finding of `rule` across the copy walk. `read` is the source of each
 * file — the disk, unless a control plants a sentence in one: the control
 * then runs through the whole detector, walk included, not a part of it.
 */
function findings(
  rule: Rule,
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
): string[] {
  return copyFiles().flatMap((file) => matches(rule, file, read(file)));
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
      // …and rule 6's two.
      "src/lib/tools/content/page-numbers.ts",
      "src/lib/tools/content/watermark-pdf.ts",
    ])
      expect(files).toContain(f);
  });

  it("rule 6 has no exit: every tool's content is read, NO_ADJUST and worker tools alike", () => {
    const rule = RULES.find((r) => r.name.startsWith("settings that"))!;
    // PDF to JPG's runner passes NO_ADJUST and still returns to its
    // resolution chips with the same file; OCR PDF is a worker panel, which
    // keeps its file beside its result. Neither may say otherwise — so the
    // shipped sentence planted in either file is a finding, through the
    // whole detector (the walk, the reader, the patterns).
    for (const f of [
      "src/lib/tools/content/pdf-to-jpg.ts",
      "src/lib/tools/content/ocr-pdf.ts",
    ]) {
      expect(copyFiles().map(rel)).toContain(f);
      for (const sentence of rule.shipped) {
        const planted = findings(rule, (file) => {
          const source = readFileSync(file, "utf8");
          return rel(file) === f
            ? `${source}\nexport const X = "${sentence}";`
            : source;
        });
        expect(
          planted.filter((x) => x.startsWith(`${f}:`)),
          f,
        ).not.toEqual([]);
      }
    }
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
