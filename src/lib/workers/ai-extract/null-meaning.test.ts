// @vitest-environment jsdom
// @native-canvas
/**
 * What a null means in AI Data Extraction, said truly wherever it is said —
 * and said in ONE set of words, `@/lib/jobs/ai-extract-null-meaning`.
 *
 * THE DEFECT (2026-10-09). The engine tells the model "When a requested value
 * is not present in the text, use null — never a guess". A single-value field
 * whose text holds several DIFFERENT values has no one right answer, and a
 * model may answer null rather than pick one — the production proof of
 * ai-extract failed exactly that way: one `region` asked of a four-row table.
 * Every surface then told the user that null meant ABSENT: extraction.md
 * showed "_(not found)_", the manifest said "A value of null means the model
 * reported the field as not found", and the panel, the page and its FAQ said
 * the same. A user whose PDF holds four values was told it holds none.
 *
 * THREE ROUNDS OF REWORDING, EACH WITH A HOLE (review, 2026-10-09). The first
 * said several values MAKE a null, and counted a value printed twice as
 * several. The second's guard read "different values" anywhere in the
 * sentence, so the page's own warning licensed any reason beside it. The
 * third's guard read per clause, and still: no shape matched the README's
 * "may not have found one", so dropping its second reason stayed green; the
 * boolean FAQ's "does not answer the question" and an intro rewritten to
 * "missing" passed the same way; and a comma is not a clause boundary, so
 * ", or when it matches more than once" appended after "different values"
 * passed too. Each was a new wording for a guard that banned wordings.
 *
 * THE STRUCTURE NOW. The words are not banned, they are OWNED: every surface
 * renders the module's phrases ({@link PHRASES}, discovered from its exports)
 * and none words a null itself. The main property is read off every surface
 * as served — the page as rendered (text and FAQPage JSON-LD), the package
 * as the real engine builds it (every file), the panel the page dispatches as
 * rendered (its builder in both modes, and its result card after a truncated
 * run) — and it is this: a sentence that speaks of a null
 * ({@link SPEAKS_OF_NULL}) must BE one of the module's phrases, whole. Not
 * contain one: a phrase inside a sentence licenses whatever the author wrote
 * around it, and the first draft of this guard ("take the phrases out; what
 * is left may not speak of a null") passed a cut sentence rewritten around
 * the cell's label. Beside it, each surface must render
 * {@link AI_EXTRACT_NULL_MEANING}, and the instruction is never left to speak
 * alone: the meaning is the very next sentence.
 *
 * TWO BOUNDS ON THE WORDS THEMSELVES. Structure cannot see a wrong module: if
 * the module's own sentence lost its second reason, every surface would render
 * the loss and pass. Two checks on words stand beside it, one per direction:
 *
 *  - A POSITIVE bound ({@link POSITIVE}) holds every module phrase to what it
 *    must SAY, part by part, and every export must have one (the type requires
 *    it, and the test compares it with the discovered exports). The meaning
 *    gives "not found" and several DIFFERENT values as alternatives of one
 *    clause, and hedges them; the cell gives the same two, and its legend
 *    quotes the cell whole; the not-null warning says a value that is not
 *    null may be one of several different values, and how to ask for every
 *    one. This is the bound that sees a reason LOST, in words nobody banned.
 *  - A NEGATIVE bound, the regex ban list ({@link regexBound}), runs over every
 *    phrase and every served sentence: a clause that says ABSENT must also say
 *    "different values"; a reason given for a null that speaks of more than
 *    one value must say they differ IN THAT REASON (split at "or"); and
 *    "several values → null" must be hedged. It sees a wrong reason ADDED
 *    beside the right two (", or when it matches more than once"), which the
 *    positive bound accepts. Its corpora — every false sentence the product
 *    shipped, and every wording a review caught — are positive controls, each
 *    caught by it and by the structure.
 *
 * WAS (921e2416, and its commit message): "So a small regex check (…) runs
 * over every module phrase", offered as what sees a wrong module. A ban list
 * sees only a wrong module worded in its banned words. The fourth review set
 * the meaning to "A null means the requested value is not present in the
 * text the model read." — the engine's own prompt, so a plausible
 * simplification — and every surface rendered it and every check in this
 * file passed; so did "found no value", "does not contain", "is absent",
 * "could not find" and "did not find". The positive bound refuses all six,
 * and the ban list still passes all six (pinned below, so the reason the
 * positive bound exists is a fact).
 *
 * STATED LIMITS. {@link SPEAKS_OF_NULL} is two words, "null" and "not found",
 * and the structure and the ban list read only sentences that say one of
 * them: a sentence that glosses a null in neither ("a field with no value is
 * missing", "comes back empty") is seen by neither. A FAQ question that names
 * null is exempt — it asks, and claims nothing — and the test lists which.
 * The positive bound reads WORDS, in {@link ABSENCE}'s and {@link AMBIGUITY}'s
 * vocabulary: a phrase that holds both reasons and negates them ("A null never
 * means it may not have found one, or that the text may hold several
 * different values") passes it, and the ban list too (pinned below). The
 * other way, a TRUE rewording that words absence in a word {@link ABSENCE}
 * does not know ("it may have found nothing") is refused: add the word to
 * ABSENCE, where the ban list's corpus test then asks for a sentence it
 * catches. The positive bound reads the module's phrases only; served
 * sentences reach it through the structure, which makes each one a phrase.
 */
import JSZip from "jszip";
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  EXTRACTION_FIELD_TYPES,
  type ExtractOptions,
} from "@/lib/jobs/ai-extract";
import { sanitizeJobResults } from "@/lib/jobs/results";
import * as NULL_WORDS from "@/lib/jobs/ai-extract-null-meaning";
import {
  AI_EXTRACT_NOT_NULL_WARNING,
  AI_EXTRACT_NULL_CELL,
  AI_EXTRACT_NULL_INSTRUCTION,
  AI_EXTRACT_NULL_MEANING,
  AI_EXTRACT_NULL_PAST_CUT,
} from "@/lib/jobs/ai-extract-null-meaning";
import { resetTelemetry } from "@/lib/telemetry/track";
import type { AiProvider } from "../ai/provider";
import { runAiExtract } from "./engine";
import { userTruncationNotice } from "../ai/truncation";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";
import {
  catalogTool,
  panelComponent,
  panelDispatchArms,
} from "@/tests/worker-panel-dispatch";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { stubJobNetwork } from "@/tests/stub-job-network";

// ── the one source ──────────────────────────────────────────────────────────

/**
 * Every phrase the module exports, by its export name — DISCOVERED from the
 * exports, not listed, so a phrase added there is one a surface may render,
 * and is held to both word bounds below (the positive one BY NAME, so an
 * export without a bound is red).
 */
const PHRASE_BY_NAME: ReadonlyMap<string, string> = new Map(
  (Object.entries(NULL_WORDS) as [string, unknown][]).filter(
    (e): e is [string, string] => typeof e[1] === "string",
  ),
);
const PHRASES: readonly string[] = [...PHRASE_BY_NAME.values()];

/** Words that speak of a null: the word itself, and the cell's "not found". */
const SPEAKS_OF_NULL = /\bnull\b|\bnot found\b/i;

/**
 * A sentence without the markdown around it: extraction.md wraps its note in
 * `_…_` and quotes the cut with `> **…**`, and the cell is `_(…)_`.
 */
const bare = (sentence: string) => sentence.replace(/^[\s>*_]+|[\s*_]+$/g, "");

const PHRASE_SET: ReadonlySet<string> = new Set(PHRASES.map(bare));

/**
 * A sentence that speaks of a null and is not ONE of the module's phrases —
 * whole. WAS "contains one" (with the phrases taken out, nothing left may
 * speak of a null): the panel's cut sentence rewritten in its own words
 * around the cell's LABEL ("A field shown as not found, or several different
 * values, was judged on those pages only…") passed that way, and so would
 * any claim built around a fragment of the module's (mutation, 2026-10-09).
 */
const ownNullWording = (sentence: string): boolean =>
  SPEAKS_OF_NULL.test(sentence) && !PHRASE_SET.has(bare(sentence));

// ── the negative bound: a regex ban list ────────────────────────────────────

/**
 * Shapes that say a null means the value is ABSENT. Each catches a sentence of
 * a corpus below (rule 1): the shipped ones, and the third round's — "may not
 * have found", "does not answer", "missing" — which no shape caught then.
 */
const ABSENCE: readonly RegExp[] = [
  /\bnot found\b/i,
  /\bcannot find\b/i,
  /\bis silent\b/i,
  /\bmay not have found\b/i,
  /\bdoes not answer\b/i,
  /\bmissing\b/i,
];

/** The other reason a model gives null: DIFFERENT values. */
const AMBIGUITY = /\bdifferent (?:values?|answers?)\b/i;

/** Words for "more than one", whether or not the values differ. */
const PLURAL = /\bmore than (?:one|once)\b|\bseveral\b/i;

/**
 * A null attributed to a field or by a model: "comes back null", "is null",
 * "answers null". Not "answer null rather than guess" — the instruction.
 */
const NULL_PREDICATE = /\b(?:comes? back|is|answers) null\b/i;

/** What makes "several values → null" a possibility, not a rule. */
const HEDGE = /\b(?:can|may)\b/i;

/** A sentence's clauses: at a semicolon, a colon, or ", so". */
const clauses = (sentence: string) => sentence.split(/\s*(?:[;:]|,\s+so\b)\s*/);

/**
 * A clause's REASONS: its alternatives, at "or". WAS read per clause, and a
 * comma is not a clause boundary — ", or when it matches more than once"
 * after "…several different values for it" sat in a clause that said
 * "different values", and passed (re-review 3, 2026-10-09).
 */
const reasons = (clause: string) => clause.split(/,?\s+or\s+/);

/** The sentence speaks of a null at all. */
const aboutNull = (sentence: string) => SPEAKS_OF_NULL.test(sentence);

/**
 * Says null means ABSENT and stops there: some clause says absent without
 * naming different values IN THAT CLAUSE. Per clause, not per reason — the
 * true sentence gives absence as one reason and different values as its
 * sibling. Only about a null: "Values may be missing" is a disclaimer.
 */
const falseMeaning = (sentence: string) =>
  aboutNull(sentence) &&
  clauses(sentence).some(
    (c) => ABSENCE.some((p) => p.test(c)) && !AMBIGUITY.test(c),
  );

/**
 * Says several values MAKE a null, as a rule: it speaks of more than one
 * value, and some clause says null comes back with no hedge in that clause.
 */
const certainNull = (sentence: string) =>
  (PLURAL.test(sentence) || AMBIGUITY.test(sentence)) &&
  clauses(sentence).some((c) => NULL_PREDICATE.test(c) && !HEDGE.test(c));

/**
 * Gives "more than one" as a reason without saying the values differ — in
 * THAT REASON. A value printed twice is one value, which a model returns.
 */
const repeatsAsReason = (sentence: string) =>
  /\bnull\b/i.test(sentence) &&
  clauses(sentence)
    .flatMap(reasons)
    .some((r) => PLURAL.test(r) && !AMBIGUITY.test(r));

/** The regex bound: refused by any of its three checks. */
const regexBound = (sentence: string) =>
  falseMeaning(sentence) || certainNull(sentence) || repeatsAsReason(sentence);

// ── the corpora: every wording that was ever caught ─────────────────────────

/** Every sentence of the false meaning the product shipped (origin/main, 2026-10-09). */
const SHIPPED: readonly string[] = [
  "| po_number | _(not found)_ |",
  "Fields shown as `null` were not found in the pages examined — they may still appear later in the document.",
  "A value of null means the model reported the field as not found; a requested field the model did not return at all is also null in extraction.json, and is listed in manifest.json under extraction.missingKeys.",
  "A field reported as not found was not found in those pages — it may still appear later in the document.",
  "The model's instructions are to use only that text and to answer null for whatever it cannot find.",
  "Because the model is told to use null when the text is silent, a null reads as not found in the pages it saw, which is weaker than a confirmed no.",
  "It shows null values as not found, marks a requested field the model never returned as not returned by the model, and lists any keys you did not ask for in a separate table.",
  "A field reported as not found may still appear further on.",
];

/**
 * Every null-explaining sentence of the FIRST rewording (c46ff2ad, 2026-10-09),
 * as it reached the package, the panel and the page.
 */
const FIRST_REWORDING: readonly string[] = [
  "_(not found, or more than one match)_",
  "A value of null means the model gave no single value for the field: it was not found, or it matched more than once — ask for the field as a list (the array type) to get every value.",
  "A field shown as not found, or more than one match, was judged on the pages examined only — it may still appear later in the document.",
  "The model is told to answer null rather than guess, so a field that matches more than once can come back null.",
  "A field shown as not found, or more than one match, was judged on those pages only — it may still appear later in the document.",
  "The model's instructions are to use only that text and to answer null rather than guess, so a field comes back null when its value is not found, or when it matches more than once; ask for a list to get every value.",
  "Because the model is told to answer null rather than guess, a null means the pages it saw did not settle it: the answer was not found there, or the text said more than one thing.",
  "A field of any other type asks for one value, so where the text holds several it can come back null.",
  "It shows a null value as not found, or more than one match, marks a requested field the model never returned as not returned by the model, and lists any keys you did not ask for in a separate table.",
  "A field shown as not found, or more than one match, was judged only on the text that was read, so it may still appear further on.",
  "A field comes back null when the model found no single answer for it: it is told to answer null rather than guess, so a field is null when its value is not found, or when it matches more than once.",
  "A single-value field asked of a column of figures has a candidate in every row; extraction.md shows it as not found, or more than one match.",
];

/**
 * The first rewording's sentences that said several values MAKE a null — the
 * two the review named on the page, and the two comments that said it first
 * (engine.ts's NULL_VALUE_CELL docblock, this file's own docblock).
 */
const FIRST_REWORDING_CERTAIN: readonly string[] = [
  FIRST_REWORDING[5]!,
  FIRST_REWORDING[10]!,
  'Not "not found": the model is told to answer null rather than guess, so a single-value field whose value appears several times comes back null too — the ai-extract production proof failed exactly that way (one region asked of a four-row table, 2026-10-09).',
  "A single-value field whose value appears SEVERAL times has no one right answer, so the model answers null — the instruction followed (the production proof of ai-extract failed exactly that way: one `region` asked of a four-row table).",
];

/**
 * The third review's wordings (2026-10-09): mutations of the then-live copy
 * that every check here passed, each now caught.
 */
const ROUND_3: readonly { name: string; text: string }[] = [
  {
    name: "README, second reason dropped",
    text: "A value of null means the model gave no single value for the field: it may not have found one.",
  },
  {
    name: "boolean use case, second reason dropped",
    text: "The model is told to answer null rather than guess, so a null can mean the text it read does not answer the question.",
  },
  {
    name: "intro, 'not found' as 'missing' and the second reason dropped",
    text: "The model's instructions are to use only that text and to answer null rather than guess, so a field can come back null when its value is missing; a value that is not null may still be one of several different values, so ask for a list to get every value.",
  },
  {
    name: "intro, ', or when it matches more than once' appended",
    text: "The model's instructions are to use only that text and to answer null rather than guess, so a field can come back null when its value is not found, or when the text holds several different values for it, or when it matches more than once; a value that is not null may still be one of several different values, so ask for a list to get every value.",
  },
  {
    name: "FAQ, ', or when the same value is printed more than once' appended",
    text: "It is told to answer null rather than guess, so a field can come back null when its value is not found, or when the text holds several different values for it, or when the same value is printed more than once; a value that is not null may still be one of several different values.",
  },
  {
    // The review's control for `repeatsAsReason` alone: no "not found" for
    // `falseMeaning` to catch, a hedge for `certainNull` to accept.
    name: "a repeat as the only reason, beside a warning that says 'different values'",
    text: "A field can come back null when the text holds the same value more than once; a value that is not null may still be one of several different values.",
  },
];

// ── the positive bound: what each module phrase must SAY ────────────────────

/** A reason that says the value is ABSENT, in {@link ABSENCE}'s words — not the ambiguity reason. */
const absentReason = (reason: string) =>
  !AMBIGUITY.test(reason) && ABSENCE.some((p) => p.test(reason));

/** A reason given for a null: absent, or several different values. */
const nullReason = (reason: string) =>
  AMBIGUITY.test(reason) || absentReason(reason);

/**
 * Both reasons, as ALTERNATIVES of one clause — split at "or", as
 * {@link reasons} splits — each its own reason. Not anywhere in the sentence:
 * "A null means the model may not have found one, or misread it; a value that
 * is not null may be one of several different values" splits at "or" into an
 * absence and an ambiguity, and still says a null means absent. Not one
 * reason holding both: "it may not have found a single value among several
 * different values" drops the value that is truly not there.
 */
const bothReasonsAsAlternatives = (phrase: string) =>
  clauses(phrase).some((c) => {
    const rs = reasons(c);
    return rs.some((r) => AMBIGUITY.test(r)) && rs.some(absentReason);
  });

/** Every clause that gives a reason for a null hedges it — and there is one. */
const reasonsHedged = (phrase: string) => {
  const giving = clauses(phrase).filter((c) => reasons(c).some(nullReason));
  return giving.length > 0 && giving.every((c) => HEDGE.test(c));
};

/** "null rather than guess", in the engine's words or the module's. */
const NO_GUESS = /\b(?:rather than|instead of|never) (?:a )?guess\b/i;

/** "one of … different values": what a value may be, in {@link AMBIGUITY}'s words. */
const ONE_OF_DIFFERENT = new RegExp(
  `\\bone of\\b[^,;:]*${AMBIGUITY.source}`,
  "i",
);

/**
 * The schema-mode fields the model's reply leaves out: pdf.xyz fills their
 * null. Derived from the request and the reply, not typed; never empty.
 */
const unreturned = (): string[] => {
  const names = SCHEMA_FIELDS.map((f) => f.name).filter(
    (n) => !(n in SCHEMA_REPLY),
  );
  if (names.length === 0) throw new Error("the reply leaves no field out");
  return names;
};

/** The value at a dotted path of a JSON object. */
const valueAt = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (v, key) =>
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[key]
          : undefined,
      value,
    );

/** The cell's label, as extraction.md shows it between `_(` and `)_`. */
const cellLabel = () => AI_EXTRACT_NULL_CELL.replace(/^_\(|\)_$/g, "");

interface PositiveBound {
  /** What the phrase must say, part by part: each must hold. */
  readonly parts: Readonly<Record<string, (phrase: string) => boolean>>;
  /**
   * Part → wrong rewrites that THIS part alone refuses — every other part
   * accepts them — so no part is decoration, and every part has one.
   */
  readonly onlyRefusedBy: Readonly<Record<string, readonly string[]>>;
  /** Further wrong rewrites, refused by any part. */
  readonly alsoRefuses?: readonly string[];
}

/** The parts of `bound` that `phrase` fails, by name. */
const failingParts = (bound: PositiveBound, phrase: string): string[] =>
  Object.entries(bound.parts)
    .filter(([, holds]) => !holds(phrase))
    .map(([part]) => part);

/**
 * The fourth review's rewrites of the meaning (2026-10-09): each a single
 * reason, each rendered by every surface and passed by every check here when
 * the MODULE said it. The first is the engine's own prompt, reworded.
 */
const REVIEW_4_MEANINGS: readonly string[] = [
  "A null means the requested value is not present in the text the model read.",
  "A null means the model found no value for the field.",
  "A null means the text does not contain the field.",
  "A null means the value is absent from the document.",
  "A null means the model could not find one.",
  "A null means the model did not find the value.",
];

/**
 * What every module export must SAY. Typed by the module's exports, so an
 * export without a bound does not compile — and the test compares the keys
 * with the exports DISCOVERED at run time, so it is red too.
 */
const POSITIVE: Readonly<Record<keyof typeof NULL_WORDS, PositiveBound>> = {
  AI_EXTRACT_NULL_MEANING: {
    parts: {
      "gives 'not found' and several different values as alternatives of one clause":
        bothReasonsAsAlternatives,
      "hedges every clause that gives a reason": reasonsHedged,
    },
    onlyRefusedBy: {
      "gives 'not found' and several different values as alternatives of one clause":
        [
          // The second reason dropped.
          "A null means the model gave no single value: it may not have found one.",
          // The first reason dropped.
          "A null means the model gave no single value: the text may hold several different values for the field.",
          // Several values that may not differ: a value printed twice is one.
          "A null means the model gave no single value: it may not have found one, or the text may hold several values for the field.",
          // Both named, in separate clauses: a null still means absent.
          "A null means the model may not have found the value; a field whose text holds several different values may come back as one of them.",
          // Split at "or" into both, ACROSS a clause: read per sentence, passed.
          "A null means the model may not have found one, or misread it; a value that is not null may be one of several different values.",
          // One reason holding both words: the absent value is gone.
          "A null means the model gave no single value: it may not have found a single value among several different values.",
        ],
      "hedges every clause that gives a reason": [
        "A null means the model gave no single value: it was not found, or the text holds several different values for the field.",
      ],
    },
    alsoRefuses: REVIEW_4_MEANINGS,
  },
  AI_EXTRACT_NULL_CELL: {
    parts: {
      "gives 'not found' and several different values as alternatives":
        bothReasonsAsAlternatives,
    },
    onlyRefusedBy: {
      "gives 'not found' and several different values as alternatives": [
        "_(not found)_",
        "_(not found, or more than one match)_",
        "_(not present in the text)_",
      ],
    },
  },
  AI_EXTRACT_NULL_CELL_LEGEND: {
    // ONE part: the legend says what the cell shows, and the cell's bound
    // holds the cell. A second part here ("gives both reasons") was
    // decoration — no legend that quotes the label can lack them — and the
    // "only part" test below said so.
    parts: {
      "quotes the cell's label, whole": (phrase) =>
        cellLabel() !== AI_EXTRACT_NULL_CELL &&
        phrase.includes(`"${cellLabel()}"`),
    },
    onlyRefusedBy: {
      "quotes the cell's label, whole": [
        'In extraction.md a null reads "not found".',
        'In extraction.md a null reads "not found, or several different values for the field".',
      ],
    },
  },
  AI_EXTRACT_NOT_NULL_WARNING: {
    parts: {
      "says a value that is not null may be one of several different values": (
        phrase,
      ) =>
        clauses(phrase).some(
          (c) => /\bnot null\b/i.test(c) && ONE_OF_DIFFERENT.test(c),
        ),
      "hedges every clause about a value that is not null": (phrase) => {
        const about = clauses(phrase).filter((c) => /\bnot null\b/i.test(c));
        return about.length > 0 && about.every((c) => HEDGE.test(c));
      },
      "says how to get every value in both modes: by a field type the schema accepts, or in the prompt":
        (phrase) =>
          /\bin your prompt\b/i.test(phrase) &&
          EXTRACTION_FIELD_TYPES.some((t) =>
            new RegExp(`\\bthe ${t} type\\b`).test(phrase),
          ),
    },
    onlyRefusedBy: {
      "says a value that is not null may be one of several different values": [
        "A value that is not null may still be incomplete, so to get every value, ask for a list: the array type in a field schema, or a list in your prompt.",
        // Several values that may not differ: a value printed twice is one.
        "A value that is not null may still be one of several values, so to get every value, ask for a list: the array type in a field schema, or a list in your prompt.",
        // Different values named, but not as what the value may be one of.
        "A value that is not null may still sit beside several different values, so to get every value, ask for a list: the array type in a field schema, or a list in your prompt.",
      ],
      "hedges every clause about a value that is not null": [
        "A value that is not null is one of several different values, so to get every value, ask for a list: the array type in a field schema, or a list in your prompt.",
      ],
      "says how to get every value in both modes: by a field type the schema accepts, or in the prompt":
        [
          "A value that is not null may still be one of several different values.",
          // A field type the schema does not have.
          "A value that is not null may still be one of several different values, so to get every value, ask for a list: the list type in a field schema, or a list in your prompt.",
          // Schema mode only: a prompt-mode reply has nulls and values too.
          "A value that is not null may still be one of several different values, so to get every value, ask for a list: the array type in a field schema.",
        ],
    },
    // The review's control: false, and in no banned word.
    alsoRefuses: ["A value that is not null is the only value in the text."],
  },
  AI_EXTRACT_NULL_INSTRUCTION: {
    parts: {
      "says null, rather than a guess": (phrase) =>
        /\bnull\b/i.test(phrase) && NO_GUESS.test(phrase),
      "says the model is TOLD, not that it does": (phrase) =>
        /\b(?:is|was) (?:told|instructed)\b/i.test(phrase),
    },
    onlyRefusedBy: {
      "says null, rather than a guess": [
        "The model is told to answer null when a value is not found.",
        "The model is told to leave a field empty rather than guess.",
      ],
      "says the model is TOLD, not that it does": [
        "The model answers null rather than guess.",
      ],
    },
  },
  AI_EXTRACT_UNRETURNED_NULL: {
    parts: {
      "says the field is null in extraction.json, as the package has it": (
        phrase,
      ) =>
        /\bnull in extraction\.json\b/i.test(phrase) &&
        unreturned().every((k) => schemaPackage.extraction[k] === null),
      "names the manifest path that lists it, as the package has it": (
        phrase,
      ) => {
        const path = /\blists it under ([A-Za-z][\w.]*\w)/.exec(phrase)?.[1];
        return (
          path !== undefined &&
          JSON.stringify(valueAt(schemaPackage.manifest, path)) ===
            JSON.stringify(unreturned())
        );
      },
    },
    onlyRefusedBy: {
      "says the field is null in extraction.json, as the package has it": [
        "A requested field the model did not return at all is left out of extraction.json, and manifest.json lists it under extraction.missingKeys.",
      ],
      "names the manifest path that lists it, as the package has it": [
        "A requested field the model did not return at all is null in extraction.json too, and manifest.json lists it under extraction.unreturnedKeys.",
        "A requested field the model did not return at all is null in extraction.json too, and manifest.json lists it.",
      ],
    },
  },
  AI_EXTRACT_NULL_PAST_CUT: {
    parts: {
      "says the null was judged only on the text that was read": (phrase) =>
        /\bonly\b[^,.;]*\bread\b/i.test(phrase),
      "says the value may still appear later": (phrase) =>
        clauses(phrase).some(
          (c) => HEDGE.test(c) && /\blater\b|\bfurther on\b/i.test(c),
        ),
    },
    onlyRefusedBy: {
      "says the null was judged only on the text that was read": [
        "A null means the value may still appear later in the document.",
      ],
      "says the value may still appear later": [
        "A null was judged only on the text that was read.",
        // Certain: the value is not known to be there at all.
        "A null was judged only on the text that was read, so the value appears later in the document.",
        "A null was judged only on the text that was read, so the value may be wrong.",
      ],
    },
    alsoRefuses: [SHIPPED[1]!],
  },
};

/** `phrase` holds every part of the bound for export `name`. */
const positiveBound = (name: keyof typeof NULL_WORDS, phrase: string) =>
  failingParts(POSITIVE[name], phrase).length === 0;

/** Sentences, as a reader meets them: by line, by table cell, by full stop. */
function sentences(text: string): string[] {
  return (
    text
      // After a full stop, whatever follows: "find. pdf.xyz" is two sentences.
      // Markdown emphasis may close a sentence ("…**").
      .split(/\n+|\s\|\s|(?<=[.!?][*_)"”]*)\s+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 0)
  );
}

// ── the package ─────────────────────────────────────────────────────────────

/** Two pages, the second past the read window, so the cut is disclosed. */
const PAGE_1 = "Invoice INV-7 from Acme. Region North 1200. Region South 980.";
const PAGE_2 = "Payment terms: 30 days. Late fee 2%.";
const extract = async (): Promise<ExtractedPdfText> => {
  const text = `${PAGE_1}\n\n${PAGE_2}`;
  return {
    pageCount: 2,
    pages: [
      { pageNumber: 1, text: PAGE_1, characterCount: PAGE_1.length },
      { pageNumber: 2, text: PAGE_2, characterCount: PAGE_2.length },
    ],
    text,
    characterCount: text.length,
    hasText: true,
  };
};

/** A provider that replies `reply`, and keeps every system prompt it is SENT. */
const replying = (reply: unknown, sent: string[]): AiProvider => ({
  id: "openai",
  model: "gpt-test",
  complete: async (request) => {
    sent.push(request.system ?? "");
    return { ok: true, text: JSON.stringify(reply), model: "gpt-test" };
  },
});

/**
 * The schema-mode request, and the model's reply to it: two regions on the
 * page and one asked for, so a model MAY answer null; due_date is left out
 * of the reply, so pdf.xyz fills its null.
 */
const SCHEMA_FIELDS: NonNullable<ExtractOptions["schema"]> = [
  { name: "region", type: "string" },
  { name: "q1", type: "number" },
  { name: "due_date", type: "date" },
];
const SCHEMA_REPLY: Readonly<Record<string, unknown>> = {
  region: null,
  q1: 1200,
};

/** Every string a JSON value holds: its copy. A JSON `null` is data, not words. */
function jsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStrings);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(jsonStrings);
  return [];
}

interface BuiltPackage {
  /** The engine's run, for the job record a panel is handed. */
  readonly output: Uint8Array;
  readonly window: Parameters<typeof sanitizeJobResults>[0];
  /** The sentence the engine discloses the cut with. */
  readonly cutNotice: string;
  /** File name → its sentences (a JSON file's strings). */
  readonly files: Record<string, string[]>;
  readonly md: string;
  readonly extraction: Record<string, unknown>;
  readonly manifest: Record<string, unknown>;
  readonly missingKeys: readonly string[];
  /** Every system prompt the provider was sent, as it was sent. */
  readonly systemPrompts: readonly string[];
}

/** The package the engine builds for `options` from `reply`, read file by file. */
async function buildPackage(
  options: ExtractOptions,
  reply: unknown,
): Promise<BuiltPackage> {
  const systemPrompts: string[] = [];
  const run = await runAiExtract(new Uint8Array([1]), options, {
    extract,
    provider: replying(reply, systemPrompts),
    // Page 1 and a little more: the window ends inside page 2.
    limits: { maxInputChars: PAGE_1.length + 6 },
  });
  if (!run.ok) throw new Error(`engine: ${run.message}`);
  const zip = await JSZip.loadAsync(run.output);
  // Health: the package is the five files a user downloads.
  expect(Object.keys(zip.files).sort()).toEqual([
    "README.txt",
    "extraction.json",
    "extraction.md",
    "manifest.json",
    "model-output.json",
  ]);
  const files: Record<string, string[]> = {};
  const raw: Record<string, string> = {};
  for (const [name, file] of Object.entries(zip.files)) {
    raw[name] = await file.async("string");
    files[name] = name.endsWith(".json")
      ? jsonStrings(JSON.parse(raw[name]!)).flatMap(sentences)
      : sentences(raw[name]!);
  }
  const manifest = JSON.parse(raw["manifest.json"]!) as Record<
    string,
    unknown
  > & { extraction: { missingKeys?: string[] } };
  return {
    output: run.output,
    window: { ai: { truncation: run.meta.window } },
    cutNotice: userTruncationNotice(run.meta.window),
    files,
    md: raw["extraction.md"]!,
    extraction: JSON.parse(raw["extraction.json"]!) as Record<string, unknown>,
    manifest,
    missingKeys: manifest.extraction.missingKeys ?? [],
    systemPrompts,
  };
}

// ── the panel, as rendered ──────────────────────────────────────────────────

/**
 * The panel's text as a reader meets it: each element's own text is a line —
 * so a label is not glued to the sentence after it, as a tag-stripped string
 * glues "Fields to extract" to the hint below it — then split into sentences.
 */
function panelText(container: HTMLElement): string[] {
  const lines: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let parent: Node | null = null;
  let line = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentNode !== parent) {
      lines.push(line);
      line = "";
      parent = node.parentNode;
    }
    line += node.nodeValue ?? "";
  }
  lines.push(line);
  return lines.flatMap(sentences);
}

/**
 * The panel the tool page dispatches for ai-extract, rendered: its builder in
 * schema mode, in prompt mode, and its result card after a run whose job
 * record and package come from the real engine, cut short.
 */
async function renderedPanel(
  built: BuiltPackage,
): Promise<Record<string, string[]>> {
  const arm = panelDispatchArms().find((a) => a.slugs.includes("ai-extract"));
  if (!arm) throw new Error("the tool page dispatches no panel for ai-extract");
  const Panel = await panelComponent(arm);
  const results = sanitizeJobResults(built.window);
  // Health: the job record carries the cut, or no notice can render.
  expect(results?.ai?.truncation.truncated).toBe(true);
  stubJobNetwork(READY_WORKER_STATUS, () => ({
    status: "completed",
    artifact: {
      artifact: {
        artifactId: "a_stub",
        filename: "invoice.extraction.zip",
        contentType: "application/zip",
        bytes: built.output.byteLength,
        url: "/stub/artifacts/a_stub",
        expiresAt: new Date(0).toISOString(),
      },
      bytes: built.output,
    },
    ...(results ? { results } : {}),
  }));
  const { container } = render(
    createElement(Panel, { tool: catalogTool("ai-extract") }),
  );
  await screen.findByRole("textbox", { name: "Field 1 name" });
  const schemaMode = panelText(container);
  fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
  const promptBox = await screen.findByRole("textbox");
  const promptMode = panelText(container);
  fireEvent.change(promptBox, { target: { value: "Extract the region." } });
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("the builder has no file input");
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([1, 2, 3])], "invoice.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  const button = screen.getByRole("button", { name: /extract data/i });
  await waitFor(() =>
    expect(button).not.toHaveAttribute("aria-disabled", "true"),
  );
  fireEvent.click(button);
  // Health: the card shows the cut — the engine's own notice for this
  // window — so the consequence sentence beside it is read.
  expect(built.cutNotice).not.toBe("");
  await screen.findByText(built.cutNotice, undefined, { timeout: 15_000 });
  return {
    "the panel's builder, field schema": schemaMode,
    "the panel's builder, prompt": promptMode,
    "the panel's result card": panelText(container),
  };
}

// ── the surfaces ────────────────────────────────────────────────────────────

let page: RenderedToolPage;
let schemaPackage: BuiltPackage;
let promptPackage: BuiltPackage;
/** Surface → its sentences, every one as a reader receives it. */
let surfaces: Record<string, string[]>;

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
});

beforeAll(async () => {
  schemaPackage = await buildPackage(
    { mode: "schema", schema: SCHEMA_FIELDS },
    SCHEMA_REPLY,
  );
  promptPackage = await buildPackage(
    { mode: "prompt", prompt: "Extract the region and its Q1 figure." },
    { region: null, invoice: "INV-7" },
  );
  page = renderToolPages().get("ai-extract")!;
  const panel = await renderedPanel(schemaPackage);
  vi.unstubAllGlobals();
  surfaces = {
    ...Object.fromEntries(
      Object.entries(schemaPackage.files).map(([name, list]) => [
        `the schema-mode package's ${name}`,
        list,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(promptPackage.files).map(([name, list]) => [
        `the prompt-mode package's ${name}`,
        list,
      ]),
    ),
    // By block, not the space-joined `text`: since WP-10 the builder is in
    // the HTML, and its unpunctuated labels ran into the sentence after them.
    "the rendered page": sentences(page.blockText),
    "the page's FAQPage JSON-LD": page.faq.flatMap((q) => sentences(q.answer)),
    ...panel,
  };
}, 180_000);

/** A FAQ question asks; it claims nothing. These are exempt from the structure. */
const isFaqQuestion = (sentence: string) =>
  page.faq.some((q) => q.question === sentence);

/** Every served sentence that words a null itself, as "surface: sentence". */
const ownWordingOn = (all: Record<string, string[]>) =>
  Object.entries(all).flatMap(([name, list]) =>
    list
      .filter((s) => ownNullWording(s) && !isFaqQuestion(s))
      .map((s) => `${name}: ${s}`),
  );

describe("the instruments", () => {
  it("the module's phrases are found, and each is rendered somewhere — none is decoration", () => {
    // Health: discovered, not typed; a broken import would leave none.
    expect(PHRASES).toContain(AI_EXTRACT_NULL_MEANING);
    expect(PHRASES.length).toBeGreaterThanOrEqual(5);
    const served = new Set(Object.values(surfaces).flat().map(bare));
    expect(PHRASES.filter((p) => !served.has(bare(p)))).toEqual([]);
  });

  it("the sentence splitter keeps a table cell, a markdown note and a FAQ sentence whole", () => {
    expect(
      sentences(
        "| po_number | _(not found, or several different values)_ |\nNext. A null field was not found, or held several different values. It cannot find. pdf.xyz says **so.** Then.",
      ),
    ).toEqual([
      "| po_number",
      "_(not found, or several different values)_",
      "Next.",
      "A null field was not found, or held several different values.",
      "It cannot find.",
      "pdf.xyz says **so.**",
      "Then.",
    ]);
    // Every module phrase survives the splitter whole, or no served sentence
    // could ever BE one.
    for (const phrase of PHRASES)
      expect(sentences(phrase).join(" "), phrase).toBe(phrase);
  });

  it("each surface is read whole, and speaks of null — the structure is not reading silence", () => {
    const sizes = Object.fromEntries(
      Object.entries(surfaces).map(([name, list]) => [name, list.length]),
    );
    // Health, both directions: a reader that lost most of a surface, or
    // split one into fragments, is implausible either way.
    for (const [name, size] of Object.entries(sizes))
      expect(size, name).toBeLessThan(400);
    expect(sizes["the rendered page"]).toBeGreaterThan(60);
    expect(sizes["the page's FAQPage JSON-LD"]).toBeGreaterThan(30);
    expect(sizes["the schema-mode package's README.txt"]).toBeGreaterThan(10);
    expect(sizes["the panel's builder, field schema"]).toBeGreaterThan(10);
    // The data files carry the model's values, and no words about null.
    for (const [name, list] of Object.entries(surfaces).filter(([n]) =>
      /(?:extraction|model-output)\.json$/.test(n),
    ))
      expect(list.filter(aboutNull), name).toEqual([]);
    for (const name of [
      "the schema-mode package's README.txt",
      "the schema-mode package's extraction.md",
      "the schema-mode package's manifest.json",
      "the prompt-mode package's README.txt",
      "the prompt-mode package's extraction.md",
      "the prompt-mode package's manifest.json",
      "the rendered page",
      "the page's FAQPage JSON-LD",
      "the panel's builder, field schema",
      "the panel's builder, prompt",
      "the panel's result card",
    ])
      expect(
        surfaces[name]!.filter(aboutNull).length,
        `${name} says nothing about null`,
      ).toBeGreaterThan(0);
  });
});

describe("one source: every surface words a null only in the module's phrases", () => {
  it("no served sentence speaks of a null in words of its own", () => {
    expect(ownWordingOn(surfaces)).toEqual([]);
  });

  it("the only exemption is a FAQ question, and it is the one the page asks", () => {
    const exempt = Object.values(surfaces)
      .flat()
      .filter((s) => ownNullWording(s) && isFaqQuestion(s));
    expect([...new Set(exempt)]).toEqual(
      page.faq.map((q) => q.question).filter((q) => SPEAKS_OF_NULL.test(q)),
    );
  });

  it("every surface that speaks of null renders the meaning", () => {
    const missing = Object.entries(surfaces)
      .filter(([, list]) => list.some(aboutNull))
      .filter(([, list]) => !list.includes(AI_EXTRACT_NULL_MEANING))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("the instruction never speaks alone: the very next sentence is the meaning", () => {
    const alone = Object.entries(surfaces).flatMap(([name, list]) =>
      list
        .map((s, i) => [s, list[i + 1]] as const)
        .filter(
          ([s, next]) =>
            s.includes(AI_EXTRACT_NULL_INSTRUCTION) &&
            next !== AI_EXTRACT_NULL_MEANING,
        )
        .map(([s]) => `${name}: ${s}`),
    );
    expect(alone).toEqual([]);
    // Health: the instruction IS said, on the page, the package and the panel.
    for (const name of [
      "the rendered page",
      "the schema-mode package's README.txt",
      "the panel's builder, field schema",
    ])
      expect(surfaces[name], name).toContain(AI_EXTRACT_NULL_INSTRUCTION);
  });

  it("the package, the page and the panel warn that a value that is not null may still be one of several", () => {
    for (const name of [
      "the schema-mode package's README.txt",
      "the prompt-mode package's README.txt",
      "the rendered page",
      "the page's FAQPage JSON-LD",
      "the panel's builder, field schema",
      "the panel's builder, prompt",
    ])
      expect(surfaces[name], name).toContain(AI_EXTRACT_NOT_NULL_WARNING);
  });

  it("a cut is followed by what it means for a null — in extraction.md and on the panel's result card", () => {
    // Health: the run WAS cut, so there is a notice to follow.
    expect(schemaPackage.cutNotice).not.toBe("");
    for (const name of [
      "the schema-mode package's extraction.md",
      "the prompt-mode package's extraction.md",
      "the panel's result card",
    ]) {
      const list = surfaces[name]!;
      const at = list.findIndex((s) => s.includes(schemaPackage.cutNotice));
      expect(at, `${name}: the cut notice`).toBeGreaterThanOrEqual(0);
      expect(list[at + 1], name).toBe(AI_EXTRACT_NULL_PAST_CUT);
    }
  });

  it("extraction.md shows every null the model returned as the module's cell, and a field it left out as not returned", () => {
    for (const built of [schemaPackage, promptPackage]) {
      const nulls = Object.entries(built.extraction).filter(
        ([, v]) => v === null,
      );
      // Health: there is a null to show, in each mode.
      expect(nulls.length).toBeGreaterThan(0);
      for (const [key] of nulls) {
        const row = built.md
          .split("\n")
          .find((line) => line.startsWith(`| ${key} |`));
        expect(row, key).toBe(
          built.missingKeys.includes(key)
            ? `| ${key} | _(not returned by the model)_ |`
            : `| ${key} | ${AI_EXTRACT_NULL_CELL} |`,
        );
      }
    }
    // Health: the schema package has one of each.
    expect(schemaPackage.missingKeys).toEqual(["due_date"]);
  });
});

describe("POSITIVE CONTROLS: a paraphrase, a dropped reason and an added reason, made to what is served", () => {
  const MUTATIONS: readonly { name: string; to: string }[] = [
    {
      // TRUE, and the README's own wording until this change — refused for
      // being a second source, which only the structure can see.
      name: "paraphrased",
      to: "A value of null means the model gave no single value for the field: it may not have found one, or the text may hold several different values for it.",
    },
    {
      name: "second reason dropped",
      to: "A null means the model gave no single value: it may not have found one.",
    },
    {
      name: "', or when it matches more than once' appended",
      to: "A null means the model gave no single value: it may not have found one, or the text may hold several different values for the field, or when it matches more than once.",
    },
  ];

  it("in the README as built, each is refused by the structure", () => {
    const readme = schemaPackage.files["README.txt"]!;
    // Health: the mutation starts from the one live sentence.
    expect(readme.filter((s) => s === AI_EXTRACT_NULL_MEANING)).toHaveLength(1);
    for (const { name, to } of MUTATIONS) {
      const mutated = readme.map((s) =>
        s === AI_EXTRACT_NULL_MEANING ? to : s,
      );
      expect(mutated, name).not.toEqual(readme);
      expect(ownWordingOn({ README: readme }), `${name}: before`).toEqual([]);
      expect(ownWordingOn({ README: mutated }), name).toEqual([
        `README: ${to}`,
      ]);
    }
  });

  it("on the page as served, each is refused by the structure — wherever the page says it", () => {
    const at: number[] = [];
    for (
      let i = page.blockText.indexOf(AI_EXTRACT_NULL_MEANING);
      i >= 0;
      i = page.blockText.indexOf(AI_EXTRACT_NULL_MEANING, i + 1)
    )
      at.push(i);
    // Health: the page says it in the boolean use case and the "why null"
    // FAQ. It used to repeat it a third time (and the instruction and the
    // warning beside it) in the read-limit answer and the list use case; the
    // page read as the same paragraph three times, so each section now keeps
    // only the sentence its context needs. Every occurrence is still mutated.
    expect(at.length).toBeGreaterThanOrEqual(2);
    expect(ownWordingOn({ page: sentences(page.blockText) }), "before").toEqual(
      [],
    );
    for (const { name, to } of MUTATIONS)
      for (const i of at) {
        const served =
          page.blockText.slice(0, i) +
          to +
          page.blockText.slice(i + AI_EXTRACT_NULL_MEANING.length);
        // Health: the mutation landed in the served text, read back whole.
        expect(sentences(served), name).toContain(to);
        expect(ownWordingOn({ page: sentences(served) }), name).toEqual([
          `page: ${to}`,
        ]);
      }
  });

  it("when the MODULE says them — what structure cannot see — the word bounds split the work: the positive bound refuses the dropped reason, the ban list the added one", () => {
    // A module whose own sentence went wrong would be rendered everywhere,
    // and the structure would pass it. WAS "only the second bound sees it"
    // (921e2416): the ban list saw this drop because it kept a banned word,
    // "may not have found"; the fourth review's drops kept none.
    const [paraphrased, dropped, added] = MUTATIONS.map((m) => m.to);
    expect(positiveBound("AI_EXTRACT_NULL_MEANING", dropped!)).toBe(false);
    expect(regexBound(dropped!)).toBe(true);
    // An ADDED reason keeps both right ones, so the positive bound accepts it
    // — pinned, so the ban list's share is a fact — and the ban list refuses it.
    expect(positiveBound("AI_EXTRACT_NULL_MEANING", added!)).toBe(true);
    expect(regexBound(added!)).toBe(true);
    // And the paraphrase is TRUE: neither refuses it.
    expect(positiveBound("AI_EXTRACT_NULL_MEANING", paraphrased!)).toBe(true);
    expect(regexBound(paraphrased!)).toBe(false);
  });
});

describe("the positive bound: what each module phrase must SAY", () => {
  it("every export has a bound, and every bound is an export's — compared with the exports discovered at run time", () => {
    // Health: discovered, not typed; a broken import would leave none.
    expect(PHRASE_BY_NAME.size).toBeGreaterThanOrEqual(5);
    expect(Object.keys(POSITIVE).sort()).toEqual(
      [...PHRASE_BY_NAME.keys()].sort(),
    );
  });

  it("every module phrase says what its bound requires", () => {
    expect(
      [...PHRASE_BY_NAME].flatMap(([name, phrase]) =>
        failingParts(POSITIVE[name as keyof typeof NULL_WORDS], phrase).map(
          (part) => `${name}: ${part}`,
        ),
      ),
    ).toEqual([]);
  });

  it("each part of each bound is the ONLY one to refuse a wrong rewrite of its own — none is decoration", () => {
    for (const [name, bound] of Object.entries(POSITIVE)) {
      // Both directions: every part has a control, every control names a part.
      expect(Object.keys(bound.onlyRefusedBy).sort(), name).toEqual(
        Object.keys(bound.parts).sort(),
      );
      for (const [part, rewrites] of Object.entries(bound.onlyRefusedBy)) {
        expect(rewrites.length, `${name}: ${part}`).toBeGreaterThan(0);
        for (const rewrite of rewrites)
          expect(failingParts(bound, rewrite), `${name}: ${rewrite}`).toEqual([
            part,
          ]);
      }
      for (const rewrite of bound.alsoRefuses ?? [])
        expect(failingParts(bound, rewrite), `${name}: ${rewrite}`).not.toEqual(
          [],
        );
    }
  });

  it("POSITIVE CONTROL (re-review 4): the meaning cut to one reason, in words nobody banned, is refused — and the ban list passes every one", () => {
    // Health: the review's six, the engine's own wording first.
    expect(REVIEW_4_MEANINGS).toHaveLength(6);
    expect(
      REVIEW_4_MEANINGS.filter((s) =>
        positiveBound("AI_EXTRACT_NULL_MEANING", s),
      ),
    ).toEqual([]);
    // Pinned: WHY the positive bound exists. If one goes red, the ban list got
    // wider — keep the positive bound, and change the docblock's example.
    expect(REVIEW_4_MEANINGS.filter(regexBound)).toEqual([]);
    // The warning's control too: false, and in no banned word.
    const [warning] = POSITIVE.AI_EXTRACT_NOT_NULL_WARNING.alsoRefuses ?? [];
    expect(warning).toBeDefined();
    expect(positiveBound("AI_EXTRACT_NOT_NULL_WARNING", warning!)).toBe(false);
    expect(regexBound(warning!)).toBe(false);
  });

  it("the instruction is what the engine SENDS: every system prompt the provider received says null, never a guess", () => {
    for (const built of [schemaPackage, promptPackage]) {
      // Health: the provider was called, and kept what it was sent.
      expect(built.systemPrompts.length).toBeGreaterThan(0);
      for (const prompt of built.systemPrompts)
        expect(
          prompt
            .split("\n")
            .some((line) => /\bnull\b/i.test(line) && NO_GUESS.test(line)),
          prompt,
        ).toBe(true);
    }
  });

  it("THE LIMIT the docblock states: a phrase that holds both reasons and negates them passes both word bounds", () => {
    // Pinned so the limit is a fact. If this goes red, a bound got wider —
    // invert it and rewrite the docblock.
    const negated =
      "A null never means it may not have found one, or that the text may hold several different values for the field.";
    expect(positiveBound("AI_EXTRACT_NULL_MEANING", negated)).toBe(true);
    expect(regexBound(negated)).toBe(false);
  });

  it("THE LIMIT the docblock states, the other way: a true rewording that words absence outside ABSENCE is refused", () => {
    // Pinned so the cost is a fact: the bound fails closed on a word it does
    // not know. If this goes green, ABSENCE learned the word — drop the pin.
    const unknownWord =
      "A null means the model gave no single value: it may have found nothing, or the text may hold several different values for the field.";
    expect(regexBound(unknownWord)).toBe(false);
    expect(failingParts(POSITIVE.AI_EXTRACT_NULL_MEANING, unknownWord)).toEqual(
      [
        "gives 'not found' and several different values as alternatives of one clause",
      ],
    );
  });
});

describe("the negative bound: a regex ban list over every phrase and every served sentence", () => {
  it("no module phrase and no served sentence is refused", () => {
    expect(PHRASES.filter(regexBound)).toEqual([]);
    expect(
      Object.entries(surfaces).flatMap(([name, list]) =>
        list.filter(regexBound).map((s) => `${name}: ${s}`),
      ),
    ).toEqual([]);
  });

  it("every sentence that ever shipped wrong, or that a review caught, is refused by the ban list AND the structure; every shape catches one", () => {
    const corpus = [
      ...SHIPPED,
      ...FIRST_REWORDING,
      ...FIRST_REWORDING_CERTAIN,
      ...ROUND_3.map((r) => r.text),
    ];
    expect(corpus.filter((s) => !regexBound(s))).toEqual([]);
    expect(corpus.filter((s) => !ownNullWording(s))).toEqual([]);
    for (const shape of ABSENCE)
      expect(
        corpus.some((s) => falseMeaning(s) && shape.test(s)),
        `${shape} catches no corpus sentence`,
      ).toBe(true);
    for (const shape of [/\bnull\b/i, /\bnot found\b/i])
      expect(
        corpus.some((s) => SPEAKS_OF_NULL.test(s) && shape.test(s)),
        `${shape} catches no corpus sentence`,
      ).toBe(true);
    for (const alternative of ["comes back", "is", "answers"])
      expect(
        corpus.some(
          (s) =>
            certainNull(s) &&
            new RegExp(`\\b${alternative} null\\b`, "i").test(s),
        ),
        `"${alternative} null" catches no corpus sentence`,
      ).toBe(true);
    for (const plural of [/\bmore than (?:one|once)\b/i, /\bseveral\b/i])
      expect(
        corpus.some((s) => repeatsAsReason(s) && plural.test(s)),
        `${plural} catches no corpus sentence`,
      ).toBe(true);
    for (const sentence of FIRST_REWORDING_CERTAIN)
      expect(certainNull(sentence), sentence).toBe(true);
  });

  it("each of its three checks is the ONLY one to refuse some sentence — none rides on another", () => {
    const only = (s: string) =>
      [
        falseMeaning(s) && "absence",
        certainNull(s) && "certain",
        repeatsAsReason(s) && "repeat",
      ].filter(Boolean);
    // The review's control for the repeat check (round 3): no "not found",
    // and a hedge — reverting the check to per-sentence turns this red.
    expect(only(ROUND_3[5]!.text)).toEqual(["repeat"]);
    // The appended reason: "different values" sits in its clause, so only
    // the per-REASON split sees it.
    expect(only(ROUND_3[3]!.text)).toEqual(["repeat"]);
    expect(only(ROUND_3[0]!.text)).toEqual(["absence"]);
    expect(
      only(
        "It is told to answer null rather than guess, so a field is null when its value is not found, or when the text holds several different values for it; a value that is not null may still be one of several different values.",
      ),
    ).toEqual(["certain"]);
    // NEGATIVE CONTROL: the hedged, two-reason sentence is none of these.
    expect(
      only(
        "A field can come back null when its value is not found, or when the text holds several different values for it.",
      ),
    ).toEqual([]);
    // A disclaimer about values is not a claim about null.
    expect(
      only("Values may be missing or incorrect — verify against the original."),
    ).toEqual([]);
  });

  it("THE LIMIT the docblock states: a gloss of a null in neither word is seen by neither the ban list nor the structure", () => {
    // Pinned so the limit is a fact. If this goes red, a bound got wider —
    // invert it and rewrite the docblock.
    const gloss = "A field with no value is missing from the text.";
    expect(ownNullWording(gloss)).toBe(false);
    expect(regexBound(gloss)).toBe(false);
  });

  it("POSITIVE CONTROL: the package as it shipped is refused by the ban list and the structure", () => {
    const shipped = sentences("| region | _(not found)_ |\n| q1 | 1200 |");
    expect(shipped.filter(falseMeaning)).toEqual(["_(not found)_"]);
    expect(shipped.filter(ownNullWording)).toEqual(["_(not found)_"]);
  });
});
