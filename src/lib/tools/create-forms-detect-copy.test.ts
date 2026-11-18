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
 *  4. "a page that is only a picture is not searched" is bound to
 *     BEHAVIOUR, on both sides of its qualifier: the real reader on the
 *     image-only case (O1) proposes nothing, and on a scan WITH a text
 *     layer, as OCR writes one (O9), it searches and proposes. A sentence
 *     that says scans are not searched without the qualifier is false of
 *     O9 and refused (review round 7: the guard bound "a scanned page is
 *     not searched" to O1 alone, the one kind of scan with no text).
 *
 * Review round 7 (2026-11-19) widened 1 and 2: "add" satisfied rule 2, so
 * "It adds the fields it finds to your form" (the OPPOSITE of "nothing is
 * added until you add it") passed; it now counts only when the PERSON adds.
 * And "suggests a field for each one" passed rule 1, which knew every/all
 * but not each.
 */
import { describe, expect, it } from "vitest";
import { DETECTION_RULES, emptyCounts } from "@/lib/pdf/form-detect";
import type { DetectReport, PageOutcome } from "@/lib/pdf/form-detect-read";
import {
  FIND_FIELDS_MISSES,
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
  each((p) => ({ page: p, outcome: "found", proposals: [P(p)], leftOut: 1 }));
  each((p) => ({ page: p, outcome: "capped", leftOut: 1 }));
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
  capped: true,
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
  add("panel", FIND_FIELDS_MISSES);
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
  // "each" since review round 7: "suggests a field for each one" said a
  // field for every shape found, which EXCLUSION_RULES and the Known
  // misses make false.
  everyField:
    /\b(?:detects?|finds?|found|recogni[sz]es?|picks? up|suggest(?:s|ed)?|spots?)\b[^.:;,]*\b(?:every|all|each)(?: the| your)? (?:\w+ ){0,2}(?:fields?|ones?|blanks?|lines?|boxe?s?)\b/i,
  automatic: /\bautomatic(?:ally)?\b/i,
  ai: /\bAI\b|\bartificial intelligence\b|\bmachine learning\b/,
  instantly: /\binstant(?:ly)?\b/i,
  anyForm: /\bany (?:pdf |kind of )?form\b/i,
  recognizes: /\brecogni[sz](?:e|es|ed|ing)\b/i,
  // The finder adding by itself: the opposite of "nothing is added until
  // you add it" (review round 7, each passed every rule before).
  addsForYou:
    /\b(?:it|find fields|the builder|the finder)\s+(?:then\s+|also\s+)?adds\s+(?:the\s+|your\s+)?(?:fields?|them|it|those|what|every|each|all)\b|\b(?:is|are)\s+added\s+for\s+you\b/i,
  turnsInto:
    /\bturns?\s+(?:it|them|each|every|all|the)\b[^.]*?\binto\s+(?:a\s+|fillable\s+)?fields?\b/i,
};

/**
 * Over-claims a page about a field finder writes (house examples, never
 * shipped here): each must be caught, and each shape must catch one. The
 * last five were written into the served intro by review round 7, and
 * every guard passed them.
 */
const OVERCLAIMS = [
  "Find fields detects every field on the page.",
  "It finds all the fields in your PDF.",
  "The builder automatically creates fields from your PDF.",
  "AI finds the blanks for you.",
  "Fields are found instantly.",
  "Works on any form.",
  "It recognizes checkboxes and text boxes.",
  "It looks for blank lines and suggests a field for each one for you to check and add.",
  "It adds the fields it finds to your form.",
  "Press it and the fields it finds are added for you.",
  "It spots each blank line and turns it into a field.",
  "It turns every blank on the page into a field.",
];

const banned = (s: string) =>
  Object.entries(BANNED)
    .filter(([, re]) => re.test(s))
    .map(([name]) => name);

/* ------------------------------------------------------------------ *
 *  2. Found, so check
 * ------------------------------------------------------------------ */

const FINDS =
  /\b(?:find|finds|finding|found|suggest\w*|detect\w*|spot\w*|identif\w*|locate\w*|picks? up)\b/i;
/**
 * Check, review, or the PERSON adding: "add" only as the person's act (an
 * imperative, "you add", "to add", "add ... by hand", the Add buttons).
 * Until review round 7 any "add/adds/added" counted, so a sentence saying
 * the finder adds by itself satisfied the rule that exists to forbid it.
 */
const CHECKS =
  /\b(?:check\w*|review\w*)\b|(?:^|[:;,—(]\s*|\b(?:so|and|or|then|you|you can|to|until you|before you|please|can)\s+)add\b(?!s|ed|ing)|\badd\b[^.]*\bby hand\b|\bAdd field\b|\bAdd all\b|\bpress(?:es|ing)?\s+“?Add\b/i;

/**
 * Served sentences that name finding and are not claims about the finder,
 * each still served and each matched by FINDS (so the list cannot rot).
 */
const NOT_A_CLAIM = [
  // FAQ questions: the answer under each says check and add.
  "Can it find the fields for me?",
  "Why did it find nothing?",
  // The control's own name, on its button, and while its chunk loads.
  "Find fields",
  "Loading Find fields…",
  "Find fields didn't load.",
];

const unchecked = (s: string) =>
  FINDS.test(s) && !CHECKS.test(s) && !NOT_A_CLAIM.includes(s);

/**
 * The sentences the rule judged in round 6 that pass only because of an
 * "add" word: each must still pass, through a PERSON's add (the corpus
 * direction of tightening CHECKS: no true sentence was lost).
 */
const LOOSE_ADD = /\b(?:add|adds|added|adding)\b/i;

/* ------------------------------------------------------------------ *
 *  3. What it looks for
 * ------------------------------------------------------------------ */

const LISTS = /\blooks for (.+?), and suggests\b/;
const listed = (s: string): string[] | null => {
  const m = LISTS.exec(s);
  return m ? m[1]!.split(/, | and /).map((x) => x.trim()) : null;
};
const PLAIN = DETECTION_RULES.map((r) => r.plain);

/**
 * Shape words: a sentence about the finder naming two or more of them is a
 * listing of what it looks for, whatever its grammar ("suggested from its
 * printed lines and boxes"), and must be the derived one (review round 7:
 * only the "looks for ..., and suggests" shape was compared).
 */
const SHAPES = /\b(line|underscore|box|boxe|cell|square)s?\b/gi;
const shapeWords = (s: string) =>
  new Set(
    [...s.matchAll(SHAPES)].map((m) => m[1]!.toLowerCase().replace(/e$/, "")),
  );
const aboutFinder = (s: string) => FINDS.test(s) || /\bFind fields\b/.test(s);
/** A listing that is not the derived one. */
const freeListing = (s: string) =>
  aboutFinder(s) && shapeWords(s).size >= 2 && listed(s) === null;

/* ------------------------------------------------------------------ *
 *  4. Scans
 * ------------------------------------------------------------------ */

/** A sentence saying some scans or pictures are not searched. */
const SAYS_SCANS_SKIPPED =
  /\b(?:scan\w*|picture\w*)\b[^.]*\b(?:not searched|was not searched|were not searched)\b|\b(?:does not|doesn't|never) search\b[^.]*\b(?:scan\w*|picture\w*)\b/i;
/** ...and qualifies it to the pages with no text, which is all it skips. */
const QUALIFIED = /\b(?:only a picture|only pictures|no text)\b/i;
const IMAGE_ONLY = DETECT_CASES.find((c) => c.id === "O1")!;
const OCR_SCAN = DETECT_CASES.find((c) => c.id === "O9")!;

/**
 * Whether the qualified sentence agrees with the reader: a page that is
 * only a picture proposes nothing, and a scan with a text layer is searched.
 */
const scanClaimHolds = (
  served: boolean,
  pictureProposed: number,
  ocrProposed: number,
) => served === (pictureProposed === 0 && ocrProposed > 0);

describe(
  "Find fields copy: nothing it says over-claims",
  { timeout: 30_000 },
  () => {
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
  },
);

describe(
  "Find fields copy: every sentence that says found or suggested says check or add",
  { timeout: 30_000 },
  () => {
    it("positive control: a bare claim is caught and a checked one is not", () => {
      expect(unchecked("Find fields finds the fields on your form.")).toBe(
        true,
      );
      expect(unchecked("Found 3 possible fields.")).toBe(true);
      expect(
        unchecked("Found 3 possible fields: check each one before you add it."),
      ).toBe(false);
      // The finder's own "add" is not the person's (review round 7).
      expect(unchecked("It adds the fields it finds to your form.")).toBe(true);
      expect(unchecked("The fields it finds are added for you.")).toBe(true);
      expect(unchecked("Find fields spots blank lines.")).toBe(true);
      expect(
        unchecked("Find fields suggests fields; add the ones you want."),
      ).toBe(false);
    });

    it("every served sentence that passed on a loose 'add' still passes on the person's add", () => {
      const loose = shown().filter(
        (s) =>
          FINDS.test(s.text) &&
          !/\b(?:check\w*|review\w*)\b/i.test(s.text) &&
          LOOSE_ADD.test(s.text) &&
          !NOT_A_CLAIM.includes(s.text),
      );
      // Health: the tightened rule is exercised on real copy.
      expect(loose.length).toBeGreaterThan(5);
      expect(loose.filter((s) => unchecked(s.text))).toEqual([]);
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
  },
);

describe(
  "Find fields copy: the shapes it looks for are DETECTION_RULES, both ways",
  { timeout: 30_000 },
  () => {
    it("the listing parses, and a missing or extra shape is told apart", () => {
      expect(listed(FIND_FIELDS_SENTENCE)).toEqual(PLAIN);
      const short = `Find fields looks for ${PLAIN.slice(1).join(", ")}, and suggests a field.`;
      expect(new Set(listed(short))).not.toEqual(new Set(PLAIN));
      const extra = `Find fields looks for ${[...PLAIN, "signature lines"].join(", ")}, and suggests a field.`;
      expect(new Set(listed(extra))).not.toEqual(new Set(PLAIN));
    });

    it("positive control: a listing in another grammar is caught", () => {
      expect(
        freeListing(
          "Press Find fields to have fields suggested from the PDF's printed lines and boxes.",
        ),
      ).toBe(true);
      expect(
        freeListing(
          "Blanks that are not lines, underscores or small boxes give it nothing to suggest.",
        ),
      ).toBe(true);
      expect(freeListing(FIND_FIELDS_SENTENCE)).toBe(false);
      expect(freeListing("Add a line under the heading.")).toBe(false);
    });

    it("no sentence about the finder lists shapes except as DETECTION_RULES' listing", () => {
      const said = shown();
      // Health: the listing it does allow is seen by the same predicate.
      expect(
        said.filter((s) => aboutFinder(s.text) && shapeWords(s.text).size >= 2)
          .length,
      ).toBeGreaterThan(1);
      expect(said.filter((s) => freeListing(s.text))).toEqual([]);
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
  },
);

describe(
  "Find fields copy: 'a page that is only a picture is not searched' is true of the reader",
  { timeout: 30_000 },
  () => {
    it("the real reader skips a picture page and searches an OCR'd scan, and the qualified sentence is served exactly then", async () => {
      expect(IMAGE_ONLY.note).toMatch(/image-only/);
      expect(OCR_SCAN.note).toMatch(/text layer/);
      const picture = await runCase(IMAGE_ONLY);
      expect(picture.report.pages[0]!.outcome).toBe("no-text-layer");
      const ocr = await runCase(OCR_SCAN);
      expect(ocr.report.pages[0]!.outcome).toBe("found");
      const said = corpus().filter((s) => SAYS_SCANS_SKIPPED.test(s.text));
      // Health: the intro, the FAQ, the guide and the summary all say it.
      for (const source of ["content", "summary"])
        expect(
          said.some((s) => s.source === source),
          source,
        ).toBe(true);
      expect(said.some((s) => s.source.startsWith("guide "))).toBe(true);
      expect(
        scanClaimHolds(
          said.length > 0,
          picture.proposals.length,
          ocr.proposals.length,
        ),
      ).toBe(true);
      // Every one is qualified to pages with no text.
      expect(said.filter((s) => !QUALIFIED.test(s.text))).toEqual([]);
      // The summary for the picture run says so, and for the OCR run does not.
      expect(summarize(picture.report).map((l) => l.text)).toContain(
        "Page 1 is only a picture, with no text to read, so it was not searched: add its fields by hand.",
      );
      expect(
        summarize(ocr.report).filter((l) => SAYS_SCANS_SKIPPED.test(l.text)),
      ).toEqual([]);
    });

    it("positive control: the binding fails if either side moves, and an unqualified sentence is caught", () => {
      expect(scanClaimHolds(true, 1, 2)).toBe(false);
      expect(scanClaimHolds(true, 0, 0)).toBe(false);
      expect(scanClaimHolds(false, 0, 2)).toBe(false);
      for (const s of [
        "A scanned page, a picture of a form, is not searched.",
        "It does not search a scanned page.",
      ]) {
        expect(SAYS_SCANS_SKIPPED.test(s), s).toBe(true);
        expect(QUALIFIED.test(s), s).toBe(false);
      }
    });

    it("the summary's outcomes are the reader's whole union", () => {
      const seen = new Set(everything(1).pages.map((p) => p.outcome));
      expect([...seen].sort()).toEqual([...OUTCOMES].sort());
    });
  },
);
