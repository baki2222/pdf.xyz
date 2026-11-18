// @native-canvas
// @vitest-environment node
/**
 * What Create Fillable Forms says about Find fields (backlog #17, slice S2,
 * 2026-11-18): it suggests, a person checks, nothing is added until it is
 * added. The finder misses fields and can suggest a wrong one (S1's "Known
 * misses"), so no sentence may imply it is complete or automatic, and every
 * sentence that says something was found or suggested must also tell the
 * reader to check, review or add it.
 *
 * THE CORPUS is `src/tests/create-forms-copy-corpus.ts` — the same
 * discovered set create-forms-placement-copy.test.ts reads (content,
 * catalogue row, FAQ and facts, guides listing the tool, every
 * create-forms* runner module incl. the Find fields chunk, and any other
 * tool's sentence naming Find fields) — PLUS what only exists at run time:
 * the Find fields summary, rendered by `summarize` for every page outcome
 * and count, singular and plural, and the panel's own sentences.
 *
 * Four properties, each run both ways (house rules 1 and 2):
 *  1. no over-claim: each banned shape catches one of {@link OVERCLAIMS},
 *     each over-claim is caught, and nothing served is;
 *  2. find/suggest/detect is never said without check/review/add;
 *  3. the shapes it says it looks for are DETECTION_RULES[].plain, no more
 *     and no fewer, in every sentence that lists them;
 *  4. "a scanned page is not searched" is bound to BEHAVIOUR: the real
 *     reader on the image-only case (O1) proposes nothing. The day it
 *     proposes something, the sentence must go.
 */
import { describe, expect, it } from "vitest";
import { DETECTION_RULES, emptyCounts } from "@/lib/pdf/form-detect";
import type { DetectReport, PageOutcome } from "@/lib/pdf/form-detect-read";
import {
  FIND_FIELDS_SENTENCE,
  invalidLine,
  summarize,
} from "@/components/tools/runner/create-forms-detect";
import { proposalLabel } from "@/components/tools/runner/create-forms-preview";
import {
  createFormsCorpus,
  sentences,
  type Said,
} from "@/tests/create-forms-copy-corpus";
import { DETECT_CASES, runCase } from "@/tests/form-detect-fixtures";

/* ------------------------------------------------------------------ *
 *  The corpus: discovered, plus what the panel renders
 * ------------------------------------------------------------------ */

const P = (page: number) => ({
  key: `${page}`,
  page,
  x: 72,
  y: 600,
  width: 200,
  height: 16,
  type: "text" as const,
  label: "Name",
  rule: "labelled-rule" as const,
});

/** A report with every outcome and every count, at `n` of each. */
function everything(n: 1 | 2): DetectReport {
  const pages: PageOutcome[] = [];
  let page = 0;
  const each = (make: (page: number) => PageOutcome) => {
    for (let i = 0; i < n; i++) pages.push(make(++page));
  };
  each((p) => ({ page: p, outcome: "found", proposals: [P(p)] }));
  each((p) => ({ page: p, outcome: "no-candidates" }));
  each((p) => ({ page: p, outcome: "nothing-drawn" }));
  each((p) => ({ page: p, outcome: "no-text-layer" }));
  each((p) => ({ page: p, outcome: "turned-content" }));
  each((p) => ({ page: p, outcome: "unread", reason: "x" }));
  each((p) => ({ page: p, outcome: "skipped", reason: "too-complex" }));
  each((p) => ({ page: p, outcome: "skipped", reason: "page-cap" }));
  return {
    pages,
    counts: {
      ...emptyCounts(),
      signatureLines: n,
      alreadyFields: n,
      rotatedText: n,
      capped: n,
    },
    excluded: [],
  };
}

/**
 * Every outcome kind the reader's union has: a Record over the union, so the
 * compiler refuses this file the day the union gains a kind it lacks.
 */
const ALL_OUTCOMES: Record<PageOutcome["outcome"], true> = {
  found: true,
  "no-candidates": true,
  "nothing-drawn": true,
  "no-text-layer": true,
  "turned-content": true,
  unread: true,
  skipped: true,
};
const OUTCOMES = Object.keys(ALL_OUTCOMES);

function rendered(): Said[] {
  const out: Said[] = [];
  const add = (source: string, text: string) => {
    for (const s of sentences(text)) out.push({ source, text: s });
  };
  for (const n of [1, 2] as const)
    for (const line of summarize(everything(n))) add("summary", line.text);
  add(
    "summary",
    summarize({
      pages: [{ page: 1, outcome: "no-candidates" }],
      counts: emptyCounts(),
      excluded: [],
    })[0]!.text,
  );
  add("summary", invalidLine(1));
  add("summary", invalidLine(2));
  add("panel", FIND_FIELDS_SENTENCE);
  add("preview", proposalLabel({ ...P(1), kind: "Text field" }));
  return out;
}

/** Source files read whole (a banned shape in a comment counts too). */
const corpus = () => [...createFormsCorpus(), ...rendered()];
/** Source files read for what they can show (rule 2 judges claims, not code). */
const shown = () => [...createFormsCorpus({ source: "shown" }), ...rendered()];

/* ------------------------------------------------------------------ *
 *  1. Over-claims
 * ------------------------------------------------------------------ */

/** Shapes of a claim the finder cannot keep. */
const BANNED: Record<string, RegExp> = {
  everyField:
    /\b(?:detects?|finds?|found|recogni[sz]es?|picks? up)\b[^.:;]*\b(?:every|all)(?: the| your)? (?:form )?fields?\b/i,
  automatic: /\bautomatic(?:ally)?\b/i,
  ai: /\bAI\b|\bartificial intelligence\b|\bmachine learning\b/,
  instantly: /\binstant(?:ly)?\b/i,
  anyForm: /\bany (?:pdf |kind of )?form\b/i,
  recognizes: /\brecogni[sz](?:e|es|ed|ing)\b/i,
};

/**
 * Over-claims a page about a field finder writes (house examples, never
 * shipped here): each must be caught, and each shape must catch one.
 */
const OVERCLAIMS = [
  "Find fields detects every field on the page.",
  "It finds all the fields in your PDF.",
  "The builder automatically creates fields from your PDF.",
  "AI finds the blanks for you.",
  "Fields are found instantly.",
  "Works on any form.",
  "It recognizes checkboxes and text boxes.",
];

const banned = (s: string) =>
  Object.entries(BANNED)
    .filter(([, re]) => re.test(s))
    .map(([name]) => name);

/* ------------------------------------------------------------------ *
 *  2. Found, so check
 * ------------------------------------------------------------------ */

const FINDS = /\b(?:find|finds|finding|found|suggest\w*|detect\w*)\b/i;
const CHECKS = /\b(?:check\w*|review\w*|add|adds|added|adding)\b/i;

/**
 * Served sentences that name finding and are not claims about the finder,
 * each still served and each matched by FINDS (so the list cannot rot).
 */
const NOT_A_CLAIM = [
  // FAQ questions: the answer under each says check and add.
  "Can it find the fields for me?",
  "Why did it find nothing?",
  // The control's own name, on its button.
  "Find fields",
];

const unchecked = (s: string) =>
  FINDS.test(s) && !CHECKS.test(s) && !NOT_A_CLAIM.includes(s);

/* ------------------------------------------------------------------ *
 *  3. What it looks for
 * ------------------------------------------------------------------ */

const LISTS = /\blooks for (.+?), and suggests\b/;
const listed = (s: string): string[] | null => {
  const m = LISTS.exec(s);
  return m ? m[1]!.split(/, | and /).map((x) => x.trim()) : null;
};
const PLAIN = DETECTION_RULES.map((r) => r.plain);

/* ------------------------------------------------------------------ *
 *  4. Scans
 * ------------------------------------------------------------------ */

const SAYS_SCANS_SKIPPED = /\bscan\w*\b[^.]*\bnot searched\b/i;
const IMAGE_ONLY = DETECT_CASES.find((c) => c.id === "O1")!;

/** Whether the scan sentence agrees with what the reader did. */
const scanClaimHolds = (served: boolean, proposed: number) =>
  served === (proposed === 0);

describe("Find fields copy: nothing it says over-claims", () => {
  it("each banned shape catches an over-claim, and each over-claim is caught", () => {
    for (const s of OVERCLAIMS) expect(banned(s), s).not.toEqual([]);
    for (const name of Object.keys(BANNED))
      expect(
        OVERCLAIMS.some((s) => banned(s).includes(name)),
        `${name} catches an over-claim`,
      ).toBe(true);
  });

  it("nothing served or rendered matches one", () => {
    const said = corpus();
    // Health: the discovered set and the rendered summary are both here.
    const sources = new Set(said.map((s) => s.source));
    for (const s of [
      "content",
      "catalog",
      "faq",
      "create-forms-runner.tsx",
      "create-forms-preview.tsx",
      "create-forms-detect.tsx",
      "summary",
      "panel",
      "faq fill-forms",
    ])
      expect(sources.has(s), `source ${s}`).toBe(true);
    expect(said.length).toBeGreaterThan(200);
    expect(said.filter((s) => banned(s.text).length > 0)).toEqual([]);
  });
});

describe("Find fields copy: every sentence that says found or suggested says check or add", () => {
  it("positive control: a bare claim is caught and a checked one is not", () => {
    expect(unchecked("Find fields finds the fields on your form.")).toBe(true);
    expect(unchecked("Found 3 possible fields.")).toBe(true);
    expect(
      unchecked("Found 3 possible fields: check each one before you add it."),
    ).toBe(false);
  });

  it("every exemption is served and names finding", () => {
    const said = shown().map((s) => s.text);
    for (const s of NOT_A_CLAIM) {
      expect(FINDS.test(s), s).toBe(true);
      expect(said, `exemption still served: ${s}`).toContain(s);
    }
  });

  it("nothing served or rendered breaks it", () => {
    const said = shown();
    // Health: the rule has something to judge, in every kind of source.
    const judged = said.filter((s) => FINDS.test(s.text));
    expect(judged.length).toBeGreaterThan(20);
    for (const source of [
      "content",
      "faq",
      "summary",
      "create-forms-detect.tsx",
    ])
      expect(
        judged.some((s) => s.source === source),
        `judged in ${source}`,
      ).toBe(true);
    expect(said.filter((s) => unchecked(s.text))).toEqual([]);
  });
});

describe("Find fields copy: the shapes it looks for are DETECTION_RULES, both ways", () => {
  it("the listing parses, and a missing or extra shape is told apart", () => {
    expect(listed(FIND_FIELDS_SENTENCE)).toEqual(PLAIN);
    const short = `Find fields looks for ${PLAIN.slice(1).join(", ")}, and suggests a field.`;
    expect(new Set(listed(short))).not.toEqual(new Set(PLAIN));
    const extra = `Find fields looks for ${[...PLAIN, "signature lines"].join(", ")}, and suggests a field.`;
    expect(new Set(listed(extra))).not.toEqual(new Set(PLAIN));
  });

  it("every sentence that lists them lists exactly DETECTION_RULES[].plain", () => {
    const all = shown().flatMap((s) => {
      const items = listed(s.text);
      return items ? [{ ...s, items }] : [];
    });
    // A listing built at run time ("N" in the source) is judged as the
    // panel renders it; it is the chunk's, and only the chunk's.
    const derived = all.filter((l) => l.items.join() === "N");
    expect(derived.map((l) => l.source)).toEqual(["create-forms-detect.tsx"]);
    const lists = all.filter((l) => !derived.includes(l));
    // Health: the tool page and the panel both say it.
    expect(lists.some((l) => l.source === "content")).toBe(true);
    expect(lists.some((l) => l.source === "panel")).toBe(true);
    for (const l of lists)
      expect(new Set(l.items), `${l.source}: ${l.text}`).toEqual(
        new Set(PLAIN),
      );
  });
});

describe("Find fields copy: 'scanned pages are not searched' is true of the reader", () => {
  it("the real reader on an image-only page proposes nothing, and the sentence is served exactly then", async () => {
    expect(IMAGE_ONLY.note).toMatch(/image-only/);
    const run = await runCase(IMAGE_ONLY);
    const page1 = run.report.pages[0]!;
    expect(page1.outcome).toBe("no-text-layer");
    const served = corpus().some((s) => SAYS_SCANS_SKIPPED.test(s.text));
    expect(served).toBe(true);
    expect(scanClaimHolds(served, run.proposals.length)).toBe(true);
    // The summary for that very run says so.
    expect(summarize(run.report).map((l) => l.text)).toContain(
      "Page 1 looks like a scan, so it was not searched.",
    );
  });

  it("positive control: a reader that proposed on a scan would fail the binding", () => {
    expect(scanClaimHolds(true, 1)).toBe(false);
    expect(scanClaimHolds(false, 0)).toBe(false);
  });

  it("the summary's outcomes are the reader's whole union", () => {
    const seen = new Set(everything(1).pages.map((p) => p.outcome));
    expect([...seen].sort()).toEqual([...OUTCOMES].sort());
  });
});
