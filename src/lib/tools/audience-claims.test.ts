// @vitest-environment node
/**
 * THE PROPERTY: no surface may assert a quantity about our users, customers,
 * or usage that nothing in this system can measure.
 *
 * Production's last line before the footer said, from 2026-08-01 to
 * 2026-08-16: *"Join thousands who edit, convert, and sign documents without
 * giving up their privacy."* Nothing in this repository counts users — no
 * analytics, no user table, and the one interest counter (`notify-me.tsx`'s
 * `gated_tool_interest`) has no destination configured. "Thousands" was not
 * an exaggeration of a number we hold; it was a number we do not hold at all.
 *
 * WHY THIS FILE EXISTS WHEN THE COPY GUARDS ALREADY DO. Every one of them
 * PASSED on that sentence — `legal-pages`, `allowance-copy`,
 * `marketing-honesty`, `pricing-honesty` all green while it shipped — because
 * their ban lists model privacy, retention, security and allowance claims.
 * Nobody had ever modelled an AUDIENCE-SIZE claim: `thousands` and `trusted
 * by` appear in none of those guards (verified 2026-08-21), and every `join`
 * in them is `.join(` — the array method, not the invitation. That is rule 1
 * with the corpus missing a whole CATEGORY rather than a synonym — a clean
 * result from a list that never knew the shape means "no claim in the words
 * I know", not "no claim".
 *
 * SHAPES, not words. "Thousands" is one spelling; the next writer ships
 * "join the many", "used daily by teams", "a growing community", "hundreds of
 * professionals". The list below is held to a corpus in both directions —
 * every pattern must catch a corpus sentence, every corpus sentence must be
 * caught — and to a set of true sentences that must survive, so the list
 * stays writable and nobody weakens it to ship honest copy.
 *
 * THE SURFACE IS DERIVED, not typed: {@link copyFiles} — the shared
 * visitor-readable walk every honesty guard imports (its own docblock says a
 * new guard imports it rather than copying it). The sentence shipped in
 * `src/components/sections/cta-section.tsx`; an anchor below fails if the
 * walk ever stops covering the scene of this defect.
 *
 * THE EXIT CONDITION names the property, not a mechanism: a pattern leaves
 * this list only when the quantity it bans becomes one this system MEASURES
 * and the surface DERIVES its figure from that counter — the way the tool
 * counts in the replacement sentence derive from the catalogue at render
 * time. It never lifts because someone believes we have users, because an
 * analytics tag was added (a pageview is not a user), or because a counter
 * exists somewhere nothing on the page reads. Believing is not measuring.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(file, "utf8");
const relative = (file: string) =>
  path.relative(ROOT, file).replace(/\\/g, "/");

/**
 * Unmeasured-audience claims, as SHAPES. Each entry names the shape, and says
 * what to do instead — "a word is banned" is not something the next writer
 * can act on.
 */
const AUDIENCE_CLAIMS: { name: string; pattern: RegExp; instead: string }[] = [
  {
    name: "a crowd counted in round numbers",
    // "thousands who edit", "hundreds of professionals". Deliberately NOT
    // bare "hundred(s)": "one file or a hundred" (workflow-section, live) is
    // about the reader's files, and "thousands of pages" would be about their
    // document — the ban is a crowd of PEOPLE this system never counted.
    pattern:
      /\b(?:thousands|millions|hundreds|dozens)\s+(?:of\s+(?:users|customers|people|professionals|teams|businesses|companies|individuals|visitors|subscribers|creators)|who\b)/i,
    instead:
      "state a number the page can derive at render time (tool counts from the catalogue) or state none",
  },
  {
    name: "an invitation to join a crowd",
    // "Join thousands…", "join the many", "join our community". Requires a
    // crowd noun after "join": `.join(", ")` in code and the "join pdf"
    // catalogue keyword stay legal.
    pattern:
      /\bjoin\s+(?:the\s+)?(?:thousands|millions|hundreds|many|others|a\s+(?:growing\s+)?community|our\s+(?:community|users|customers))\b/i,
    instead:
      "invite the reader to use the product, not to stand with an audience nothing counted",
  },
  {
    name: "adoption vouched for by an uncounted crowd",
    // "trusted by millions", "used daily by teams". "used by sortable tiles"
    // (a code comment, and also not a crowd noun) stays legal twice over.
    pattern:
      /\b(?:trusted|loved|used|chosen|preferred|relied\s+(?:up)?on)\s+(?:daily\s+|every\s+day\s+)?by\s+(?:thousands|millions|hundreds|many|teams|professionals|businesses|companies|people|users|customers)\b/i,
    instead:
      "describe what the product does and let the reader judge it; adoption claims need a counter we do not have",
  },
  {
    name: "a crowd asserted as a trend",
    // "a growing community" — no number at all, which is the evasion that
    // walks past every census: growth of a quantity nothing measures.
    pattern:
      /\b(?:a\s+)?growing\s+(?:community|user\s?base|audience|number\s+of\s+(?:users|customers|people))\b/i,
    instead:
      "growth is a derivative of a measurement; without the measurement there is nothing to derive",
  },
];

const offendingClaims = (text: string) =>
  AUDIENCE_CLAIMS.filter(({ pattern }) => pattern.test(text));

/**
 * THE CORPUS, side one: sentences to catch.
 *
 * The first is EXACT — read out of commit ba918e7 (`git show
 * ba918e7:src/components/sections/cta-section.tsx`), not retyped from memory,
 * because an excerpt becomes the fixture and editing it becomes the blind
 * spot. It is HISTORICAL: production carried it 2026-08-01 → 2026-08-16, when
 * a redesign replaced it with counts derived from the catalogue. The rest are
 * the next writer's spellings of the same claim — each exists to exercise a
 * pattern, and is labelled as unshipped.
 */
const SHIPPED_SENTENCE =
  "Join thousands who edit, convert, and sign documents without giving up their privacy.";

const CORPUS = [
  SHIPPED_SENTENCE,
  // Unshipped variants, one clear spelling per shape:
  "Join the many who manage their PDFs here.",
  "Used daily by teams around the world.",
  "A growing community of PDF power users.",
  "Trusted by hundreds of professionals.",
];

/**
 * THE CORPUS, side two: true sentences that must survive. Every one is live
 * copy (or the code-shape the scanner actually sees), sitting one word from a
 * banned shape. A list that rejects these gets weakened by whoever next has
 * to ship an honest sentence.
 */
const TRUE_SENTENCES = [
  // The replacement for the shipped sentence: quantities the page derives
  // from the catalogue at render time — measured, so stateable.
  "Edit, convert, and sign documents without giving up your privacy: 50 tools, 41 of them running in-browser, and no sign-up to start.",
  // Live workflow copy: "a hundred" is the reader's files, not our audience.
  "Drag in one file or a hundred. They stage in your browser — nothing uploads until a tool needs it.",
  // The code shapes the flattened scan actually walks past:
  '` To stay within the request limits, ${notes.join(", and ")}.`',
  'keywords: ["merge pdf", "combine pdf", "join pdf", "concatenate pdf"],',
  "Accessible name override (used by sortable tiles to announce position).",
  // The allowance sentence — the product's highest-traffic quantity claim.
  "3 free AI runs a day for your connection — the allowance resets daily.",
];

describe("the corpus holds in both directions", () => {
  it("is not vacuously small on either side", () => {
    // `[] ⊆ X` is vacuously true: an emptied corpus would report the
    // strongest possible pass on everything below.
    expect(CORPUS.length).toBeGreaterThanOrEqual(5);
    expect(TRUE_SENTENCES.length).toBeGreaterThanOrEqual(5);
    expect(AUDIENCE_CLAIMS.length).toBeGreaterThanOrEqual(4);
  });

  it("catches every corpus sentence, the shipped one by name", () => {
    const missed = CORPUS.filter((s) => offendingClaims(s).length === 0);
    expect(
      missed,
      "no pattern catches these audience-size claims — the hole a synonym " +
        "walks through",
    ).toEqual([]);
    // The anchor, asserted separately so it cannot dissolve into the list:
    // the sentence production actually carried.
    expect(offendingClaims(SHIPPED_SENTENCE).length).toBeGreaterThanOrEqual(1);
  });

  it("exercises every pattern, so none is decoration", () => {
    const unexercised = AUDIENCE_CLAIMS.filter(
      ({ pattern }) => !CORPUS.some((s) => pattern.test(s)),
    ).map(({ name }) => name);
    expect(
      unexercised,
      "no corpus sentence exercises these patterns — add the example that " +
        "motivated each, or drop it",
    ).toEqual([]);
  });

  it("leaves the true sentences alone, so the list stays writable", () => {
    const falsePositives = TRUE_SENTENCES.flatMap((s) =>
      offendingClaims(s).map(({ name }) => `${name} rejected: ${s}`),
    );
    expect(falsePositives, falsePositives.join("\n")).toEqual([]);
  });
});

describe("the surface set is alive", () => {
  const files = copyFiles();

  it("is implausibly-small-proof", () => {
    // The walk covers four roots plus three listed files — 120+ files today.
    // A walk that shrank below this is broken, not strict.
    expect(files.length).toBeGreaterThanOrEqual(100);
  });

  it("covers the scene of the shipped defect", () => {
    // The sentence lived in cta-section.tsx. A surface that cannot see the
    // file this guard exists because of is the wrong surface, whatever else
    // it covers.
    expect(files.map(relative)).toContain(
      "src/components/sections/cta-section.tsx",
    );
  });
});

describe("no live surface asserts an unmeasured audience", () => {
  it("finds no audience-size claim in any visitor-readable file", () => {
    const offenders = copyFiles().flatMap((file) => {
      const prose = flattenForPhraseSearch(withoutComments(read(file)));
      return offendingClaims(prose).map(
        ({ name, instead }) => `${relative(file)}: ${name} — ${instead}`,
      );
    });
    expect(
      offenders,
      "these files assert a quantity about our users or usage that nothing " +
        `in this system can measure:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("controls", () => {
  it("positive control: the composed chain catches the shipped sentence in real source", () => {
    // Not the bare sentence — the sentence as a FILE would carry it, JSX
    // punctuation and all, through the same pipeline the live scan uses. If
    // the stripper or the flattener ever eat the prose itself, this stops
    // matching and "no offenders" stops meaning anything.
    const source =
      `<p className="max-w-xl">\n` +
      `  ${SHIPPED_SENTENCE.slice(0, 40)}\n` +
      `  ${SHIPPED_SENTENCE.slice(40)}\n` +
      `</p>`;
    const prose = flattenForPhraseSearch(withoutComments(source));
    expect(offendingClaims(prose).length).toBeGreaterThanOrEqual(1);
  });

  it("wrap control: an escaped line break inside the match site misses raw and is caught flattened", () => {
    // The third evasion from the phrase-wrap lesson: on disk `\n` is a
    // backslash and an `n`, which no `\s+` can cross. Both halves pinned —
    // without the "before", a fix can appear to work on a mechanism it never
    // touched.
    const raw = String.raw`const CLAIM = "Used daily\n  by teams around the world.";`;
    expect(
      offendingClaims(withoutComments(raw)).length,
      "the un-flattened source was expected to MISS — if it matches, this " +
        "control no longer demonstrates the wrap hole",
    ).toBe(0);
    expect(
      offendingClaims(flattenForPhraseSearch(withoutComments(raw))).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("health check: comment stripping does not hide a claim in rendered prose", () => {
    // The scanner strips comments so the epitaph in cta-section.tsx (which
    // quotes the dead sentence) cannot cry wolf. This pins the other
    // direction: prose OUTSIDE the comment still matches after stripping.
    const source =
      `{/* "Join thousands who…" died here 2026-08-16 */}\n` +
      `<p>Trusted by hundreds of professionals.</p>`;
    const prose = flattenForPhraseSearch(withoutComments(source));
    expect(offendingClaims(prose).length).toBeGreaterThanOrEqual(1);
    // And the comment alone, stripped, matches nothing.
    const commentOnly = flattenForPhraseSearch(
      withoutComments(`{/* "Join thousands who…" died here */}`),
    );
    expect(offendingClaims(commentOnly).length).toBe(0);
  });
});
