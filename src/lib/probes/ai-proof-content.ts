/**
 * The documents the production proofs of the AI tools upload, as text, and
 * what each proof accepts back as PROOF — one definition the fixtures draw
 * (`@/tests/ai-proof-fixtures`) and the checks below read.
 *
 * ── THE MEMO (summarize-pdf, translate-pdf) ─────────────────────────────────
 *
 * Until 2026-10-09 both proofs uploaded the harness's three-line `textPdf`
 * ("pdf.xyz deployment proof …"). Nothing in it is distinctive, and it has no
 * page without text, so the proof could not tell the declared text pages from
 * the page count (`./ai-proof-declaration`): both were 1.
 *
 * So the memo is a short, ordinary document about something specific, with
 * names its BODY carries and its title does not, followed by a BLANK page.
 * The names are in it so a correct summary or translation has something it
 * must carry; the blank page is there so a declaration of the page count
 * instead of the pages WITH TEXT is a different number.
 *
 * ── WHAT A PASS USED TO MEAN (2026-10-09) ───────────────────────────────────
 *
 * summarize-pdf and translate-pdf passed on "a ZIP came back"; chat-with-pdf
 * checked turn COUNTS. A package holding an empty file, the document echoed
 * back, a summary of some other document or an English "translation" was a
 * pass, and the ledger recorded the tool as proven. Each check below names
 * what such a package gets wrong. Each asks for what a correct answer carries
 * in every wording the tests render it in: names that survive paraphrase and
 * translation, and the stems of what the memo is about, not a phrase; an echo
 * is MORE THAN HALF the source's sentences verbatim, which no brief summary,
 * no translation and no one-sentence answer contains; "the target language"
 * is a count of marker words, not a parse.
 *
 * The first version of these checks had three holes of its own, each found by
 * a package built by hand to pass them (review, 2026-10-09): the summary check
 * took the memo's TITLE word "Kestrel" — also a bird — as proof, so a summary
 * of the title or of the bird passed; "Spanish" was counted in words Spanish
 * shares with Italian, Portuguese, Catalan and French, so all four, packaged
 * as Spanish, passed; and the chat follow-up's notes named ONE channel, so a
 * model sent no prior turns still answered it. Each wrong package is now a
 * control in `ai-proof-content.test.ts`.
 *
 * The second version had holes too (re-review, 2026-10-09): the summary
 * check's body words — cable, corrosion, repair, truck — are what any bridge
 * report says, so a refusal that had seen only the title passed, and so did
 * a summary of another bridge; "Spanish" let other languages' markers reach a
 * quarter of its own, so one sentence left in English, or the memo's last
 * lines in a neighbour, passed; and the follow-up's docblock still called a
 * right answer evidence the turns reached the model, when a worker that sends
 * only the user's turns can pass (and with a reading model does). Those
 * packages are controls too.
 *
 * The third version swung the other way, and had holes besides (re-review 3,
 * 2026-10-09): narrowed to the fewest body specifics, the summary check
 * REFUSED correct summaries that rounded the cost, wrote "tons" or named no
 * person — so its marks are wider now, each a specific of the body the title
 * does not imply; and the translation check passed a Spanish summary as the
 * translation, the translation with its middle dropped, and Galician or German
 * lines, which no marker set counts — so it gained two bounds independent of
 * the marker count: the translation's length against the memo's, and a
 * per-line check.
 */
import JSZip from "jszip";
import { readAnswerFromPackage } from "@/lib/workers/chat-with-pdf-conversation";

/** The memo's heading, drawn above its sentences. */
export const PROOF_MEMO_TITLE = "Kestrel Bridge inspection memo";

/** A count the memo states in words: "nine weeks". */
interface MemoCount {
  readonly count: number;
  readonly unit: string;
  /** Other spellings of the unit a summary may write: "ton" for "tonne". */
  readonly alsoSpelled?: readonly string[];
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
] as const;

function numberWord(count: number): string {
  const word = NUMBER_WORDS[count];
  if (word === undefined) throw new Error(`no number word for ${count}`);
  return word;
}

/** When the bridge was inspected. */
const INSPECTED_ON = { day: 14, month: "March" } as const;
/** How many cables hold the main span, and how the memo says it. */
const CABLES: MemoCount = { count: 12, unit: "cable" };
const CABLES_SAID = `${numberWord(CABLES.count)} steel ${CABLES.unit}s`;
/** How much strength the two worst cables have lost, at least. */
const STRENGTH_LOST = { fraction: "tenth", percent: 10 } as const;
/** How long the repair takes. */
const REPAIR_TIME: MemoCount = { count: 9, unit: "week" };
/** The weight over which trucks may not cross while it goes on. */
const TRUCK_LIMIT: MemoCount = {
  count: 7,
  unit: "tonne",
  alsoSpelled: ["ton"],
};
/** How many lanes cars and bicycles may use meanwhile. */
const OPEN_LANES: MemoCount = { count: 1, unit: "lane" };
/** What the repair costs, in euros. */
const REPAIR_COST_EUROS = 2_480_000;
/** Who must approve the budget, by when, and when the bridge closes. */
const APPROVED_BY = "council";
const BUDGET_DUE = "April";
const CLOSES_AFTER = "June";

const spelledOut = ({ count, unit }: MemoCount) =>
  `${numberWord(count)} ${unit}${count === 1 ? "" : "s"}`;
/** The start every spelling of a count's unit shares: "ton" of tonne and ton. */
const unitStem = ({ unit, alsoSpelled = [] }: MemoCount) =>
  [unit, ...alsoSpelled].reduce((stem, spelling) => {
    let k = 0;
    while (k < stem.length && stem[k] === spelling[k]) k += 1;
    return stem.slice(0, k);
  });
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");

/**
 * The memo, one sentence per drawn line. Each is short enough to fit the
 * page's width on one line, so an extractor returns it whole. Its figures
 * are drawn from the values above, which {@link PROOF_MEMO_FIGURES} reads.
 */
export const PROOF_MEMO_SENTENCES: readonly string[] = [
  "The Kestrel Bridge carries the coast road over the Varrow River.",
  `Engineer Ingrid Halvorsen inspected the bridge on ${INSPECTED_ON.day} ${INSPECTED_ON.month}.`,
  `She found corrosion on four of the ${CABLES_SAID} that hold the main span.`,
  `Two of those cables have lost more than a ${STRENGTH_LOST.fraction} of their strength.`,
  `The repair will replace all four cables and will take ${spelledOut(REPAIR_TIME)}.`,
  `It is expected to cost ${grouped(REPAIR_COST_EUROS)} euros, paid from the regional roads fund.`,
  `Trucks over ${spelledOut(TRUCK_LIMIT)} may not cross the bridge while the work goes on.`,
  `Cars and bicycles may still cross, but only in ${spelledOut(OPEN_LANES)} at a time.`,
  "A ferry from Ostby harbour will carry trucks across the river instead.",
  `The city ${APPROVED_BY} must approve the budget before the end of ${BUDGET_DUE}.`,
  `If the work is delayed past ${CLOSES_AFTER}, the bridge will close to all traffic.`,
  "Halvorsen also recommends replacing the other eight cables within five years.",
  "The next full inspection of the Kestrel Bridge is due in two years.",
];

/** Pages the memo PDF has: the memo, then one blank page. */
export const PROOF_MEMO_PAGES = 2;

/**
 * What the memo is ABOUT, as its title says it, matched as the start of a
 * word ("bridges", "Kestrel's"). Never proof on its own: the title carries
 * both words, so a summary of the title alone names them, and "kestrel" is an
 * English word — a falcon — so a sentence about the bird names it too. Until
 * 2026-10-09 one of Kestrel, Halvorsen and Varrow was enough to pass the
 * summary check, and a summary of the title or of the bird passed on
 * "Kestrel" (review, 2026-10-09).
 */
export const PROOF_MEMO_SUBJECT = ["Kestrel", "bridge"] as const;

/**
 * Names only the memo's BODY carries: none is in its title, and none is an
 * English word. A translation keeps them, as translations keep names — and
 * "Kestrel" is not among them, because a translator may render a bird's name
 * ("Puente Cernícalo"). The test holds each to the body and not the title.
 */
export const PROOF_MEMO_BODY_NAMES = ["Halvorsen", "Varrow", "Ostby"] as const;

/**
 * The months the memo's body names, as whole words: when it was inspected,
 * when the budget is due, when the bridge closes. None is in the title, and
 * no refusal or other report the test builds names one. Matched case-blind,
 * so the verb "march" counts as the month.
 */
export const PROOF_MEMO_BODY_MONTHS: readonly string[] = [
  INSPECTED_ON.month,
  BUDGET_DUE,
  CLOSES_AFTER,
];

/**
 * Words of the memo's body, as the starts of words, that its title does not
 * imply: trucks sent to a ferry, and the council that must approve the money.
 *
 * WAS cable, corros, repair, truck and ferry — what the body is ABOUT, which
 * is what ANY bridge inspection says. With the subject's "bridge" those
 * passed the summarize prompt's own refusal ("The provided text contains
 * only the title … It gives no details of the inspection's findings, repairs
 * or costs"), "This memo records an inspection of the Kestrel Bridge and the
 * repairs it recommends", and a summary of another bridge's corroded cables
 * (re-review, 2026-10-09). A word the title makes likely, or that another
 * report of the same kind says, is not proof the body was read. Then it was
 * ferry ALONE, and a faithful summary that named no person, said "diverted"
 * and rounded every figure was refused (re-review 3): "council" joined it.
 */
export const PROOF_MEMO_BODY_STEMS: readonly string[] = ["ferry", APPROVED_BY];

/**
 * The memo's FIGURES, each with the forms a summary may write it in, matched
 * as the starts of words once punctuation is a space (and "%" or "per cent"
 * is "percent"): "nine weeks", "nine-week" and "9 weeks"; "seven tonnes",
 * "7 tons" and "7-ton" all start with "7 ton" or "seven ton", the start
 * tonne and ton share; "one lane", "1 lane" and "a single lane"; "a tenth",
 * "one tenth", "10%" and "10 per cent"; "2,480,000", "2.480.000", "2 480
 * 000", "2.48 million" and "€2.48m" all start with "2 48" — one form, since a
 * second that the first already catches would be decoration. Derived from
 * the values the sentences are drawn from, so a figure changed in the memo
 * changes here.
 *
 * The cables are the one count whose word stands alone: a summary puts words
 * between it and its unit ("twelve main cables", "twelve steel cables"), and
 * "twelve" is in no title, refusal or other report the test builds. Its digit
 * form keeps the unit, because "12" alone starts "12,480,000".
 *
 * STATED LIMITS. "2 48" is the start of "€2.48bn" too — a figure a thousand
 * times the memo's — so a summary that gets the cost's scale wrong passes on
 * it; and "12 main cables" and "ten percent" are not forms here. The test
 * pins each.
 */
export const PROOF_MEMO_FIGURES: readonly {
  readonly label: string;
  readonly forms: readonly string[];
}[] = [
  ...[REPAIR_TIME, TRUCK_LIMIT, OPEN_LANES].map((figure) => ({
    label: spelledOut(figure),
    forms: [
      `${numberWord(figure.count)} ${unitStem(figure)}`,
      `${figure.count} ${unitStem(figure)}`,
      ...(figure.count === 1 ? [`single ${unitStem(figure)}`] : []),
    ],
  })),
  {
    label: CABLES_SAID,
    forms: [numberWord(CABLES.count), `${CABLES.count} ${unitStem(CABLES)}`],
  },
  {
    label: `more than a ${STRENGTH_LOST.fraction}`,
    forms: [
      `a ${STRENGTH_LOST.fraction}`,
      `one ${STRENGTH_LOST.fraction}`,
      `${STRENGTH_LOST.percent} percent`,
    ],
  },
  {
    label: `${grouped(REPAIR_COST_EUROS)} euros`,
    forms: [String(REPAIR_COST_EUROS / 1_000_000)],
  },
];

/** The language the translate proof asks for. */
export const PROOF_TRANSLATION_TARGET = "es";

// ── the chat document ──────────────────────────────────────────────────────

/**
 * Two facts the chat proof asks about, planted among the notes. Neither word
 * appears anywhere else in the document, so an answer naming it read it there.
 */
export const CHAT_PROOF_FACTS = {
  team: "Ostrander",
  channel: "heron-pager",
} as const;

/**
 * The other teams the notes name, each maintaining another part of the secure
 * worker and taking its pages on its own channel. They are what leaves the
 * follow-up's "that team" open without the opening exchange: until
 * 2026-10-09 the notes named ONE team and ONE channel, so a model sent no
 * prior turns still answered "heron-pager" — there was nothing else to say —
 * and the check's docblock said a right answer had used both turns (review,
 * 2026-10-09). The test derives every team and channel from the notes and
 * holds them to these.
 */
export const CHAT_PROOF_DECOYS = [
  { team: "Brenner", part: "scanning pool", channel: "kite-desk" },
  { team: "Calloway", part: "upload gateway", channel: "wren-relay" },
  { team: "Dunmore", part: "release pipeline", channel: "lark-watch" },
] as const;

const teamLines = (team: string, maintains: string, channel: string) => [
  `The ${maintains} is maintained by the ${team} team.`,
  `The ${team} team takes its pages on the ${channel} channel.`,
];

/** The asked-about team second: neither the first nor the last the notes name. */
const CHAT_FACT_LINES = [
  ...teamLines(
    CHAT_PROOF_DECOYS[0].team,
    `secure worker's ${CHAT_PROOF_DECOYS[0].part}`,
    CHAT_PROOF_DECOYS[0].channel,
  ),
  ...teamLines(
    CHAT_PROOF_FACTS.team,
    "secure worker fleet",
    CHAT_PROOF_FACTS.channel,
  ),
  ...CHAT_PROOF_DECOYS.slice(1).flatMap((d) =>
    teamLines(d.team, `secure worker's ${d.part}`, d.channel),
  ),
];

/** Where the facts sit: page 2, from its line 5 — well inside what one question reads. */
const CHAT_FACT_PAGE = 1;
const CHAT_FACT_LINE = 4;

const CHAT_TOPICS = [
  "retention",
  "encryption",
  "signed uploads",
  "queue draining",
  "artifact expiry",
  "malware scanning",
  "structural preflight",
  "sandbox isolation",
  "egress policy",
  "language packs",
  "confidence scoring",
  "prompt caching",
];

/**
 * The chat document: six pages of platform notes, 34 lines each, with the
 * fact lines in place of some of page 2's. Distinct, factual sentences
 * rather than one repeated line — a provider may collapse trivially
 * repetitive text. Long on purpose; see `chatProofPdf` for why.
 */
export const CHAT_PROOF_PAGES: readonly {
  readonly heading: string;
  readonly lines: readonly string[];
}[] = Array.from({ length: 6 }, (_, p) => ({
  heading: `pdf.xyz platform notes — section ${p + 1}`,
  lines: Array.from({ length: 34 }, (_, line) => {
    const fact = p === CHAT_FACT_PAGE ? line - CHAT_FACT_LINE : -1;
    if (fact >= 0 && fact < CHAT_FACT_LINES.length)
      return CHAT_FACT_LINES[fact]!;
    const topic = CHAT_TOPICS[(p * 34 + line) % CHAT_TOPICS.length];
    return (
      `Section ${p + 1} paragraph ${line + 1} records how ${topic} behaves on the ` +
      `secure worker, and why it is reported rather than assumed.`
    );
  }),
}));

/**
 * The opening question: one the notes answer, and only with the planted team
 * — named alone, since the follow-up's context is this answer, and an answer
 * naming the other teams too would leave "that team" open even with it. A
 * correct one-sentence answer has no reason to name them: each maintains a
 * part the question does not ask about.
 */
export const CHAT_PROOF_OPENING = {
  question:
    "According to these notes, which team maintains the secure worker fleet? Answer in one sentence.",
  mustMention: CHAT_PROOF_FACTS.team,
  mustNotMention: CHAT_PROOF_DECOYS.map((d) => d.team),
} as const;

/**
 * The follow-up. "That team" is one of several the notes name, each with its
 * own channel, so the notes alone do not settle which — the opening exchange
 * does. A model sent no prior turns therefore names every channel, asks which
 * team is meant, or guesses; the check fails the first (another team's
 * channel is named), the second (heron-pager is not) and a guess of any of
 * the other teams.
 *
 * What it does NOT rule out — and this is the whole of what the content can
 * say about delivery:
 *  - a worker that forwards only the USER's turns and drops the assistant's
 *    can pass (and with a reading model does). The opening question asks
 *    which team maintains the secure worker fleet, and the notes give one
 *    team for that, so the follow-up is answerable from the user's own
 *    earlier turn and the notes without the opening answer ever reaching the
 *    model. (Until 2026-10-09, re-review 3, this said it "passes, every
 *    time" — true only of a model that reads its request; one that guesses
 *    or asks can fail it);
 *  - a worker that drops every prior turn passes when its model guesses the
 *    right team, naming its channel alone.
 * So a right answer is NOT evidence that the opening answer reached the
 * model, and not proof that any prior turn did. (Until 2026-10-09 this said
 * a right answer was "evidence the turns reached the model".) What fails is
 * a worker that drops every prior turn with a model that lists the channels,
 * asks, or guesses another team. The manifest's `contextTurns`, checked too,
 * cannot narrow it: the engine counts the turns in the OPTIONS it was given
 * (`options.context.length`), not the turns that went into the provider's
 * prompt, so a worker that dropped them in between reports 2 all the same.
 * `ai-proof-content.test.ts` holds every part: the package of a model sent no
 * turns that lists the channels fails, one that guesses right passes, and one
 * sent only the user's turns passes.
 */
export const CHAT_PROOF_FOLLOW_UP = {
  question: "Which channel does that team take its pages on?",
  mustMention: CHAT_PROOF_FACTS.channel,
  mustNotMention: CHAT_PROOF_DECOYS.map((d) => d.channel),
} as const;

// ── the checks ─────────────────────────────────────────────────────────────

export interface ContentVerdict {
  ok: boolean;
  detail: string;
}

/** Text as the checks compare it: NFKC, lower case, whitespace collapsed. */
export function normalizeProse(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Text as WORDS: `normalizeProse`, punctuation (hyphens too) as spaces — and
 * "%" and "per cent" as the word "percent", so "10%" is a figure's form and
 * not the start of "100".
 */
function words(text: string): string {
  return ` ${normalizeProse(text)
    .replace(/%/g, " percent ")
    .replace(/\bper cent\b/g, "percent")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/** Does `text` say `term` as a whole word (or words), whatever its case and punctuation? */
export function mentions(text: string, term: string): boolean {
  const wanted = words(term).trim();
  return wanted.length > 0 && words(text).includes(` ${wanted} `);
}

/** Does a word of `text` START with `stem` ("cable" in "cables")? */
export function mentionsStem(text: string, stem: string): boolean {
  const wanted = words(stem).trim();
  return wanted.length > 0 && words(text).includes(` ${wanted}`);
}

/** How many of `sentences` `text` carries verbatim. */
export function sentencesCarried(
  text: string,
  sentences: readonly string[],
): number {
  const haystack = normalizeProse(text);
  return sentences.filter((s) => haystack.includes(normalizeProse(s))).length;
}

/** An ECHO: more than half of the source's sentences, verbatim. */
export function echoes(text: string, sentences: readonly string[]): boolean {
  return sentencesCarried(text, sentences) * 2 > sentences.length;
}

/** The languages the translate check counts the marker words of. */
export const MARKED_LANGUAGES = [
  "spanish",
  "english",
  "italian",
  "portuguese",
  "french",
  "catalan",
] as const;
export type MarkedLanguage = (typeof MARKED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Readonly<Record<MarkedLanguage, string>> = {
  spanish: "Spanish",
  english: "English",
  italian: "Italian",
  portuguese: "Portuguese",
  french: "French",
  catalan: "Catalan",
};

/**
 * Words that mark a text as one language — and, the point of the Spanish
 * set, as Spanish and not one of its neighbours.
 *
 * WAS two sets, English and Spanish, and most of the Spanish one (la, del,
 * un, una, se, su, que, por, para, sobre, durante, antes, desde, al, cada)
 * is everyday Italian, Portuguese, Catalan or French too: it measured "not
 * English". Italian, Portuguese, Catalan and French renderings of the memo,
 * packaged as Spanish, all passed as "a Spanish translation" (review,
 * 2026-10-09) — so an engine whose code table sent "es" to the wrong
 * language, or a model that drifted into one, would have been recorded as
 * proven. The docblock here said "None is a word in the other language";
 * that held against English, the one wrong language the corpus tried.
 *
 * Now the Spanish markers are Spanish function words the four neighbours'
 * prose does not use; French "y" ("il y a") is the one common exception, and
 * a French text still fails on its own markers. Each other set holds words
 * that are not Spanish — left out on purpose are the ones a correct Spanish
 * text uses too: Portuguese o, dos (Spanish "or", "two"), French le, les, une
 * ("him", "them", "joins"), Catalan es, les, va ("is", "them", "goes"). That
 * much is a claim about languages that no test can make; what
 * `ai-proof-content.test.ts` holds is narrower and checkable: against the
 * memo rendered in all six languages (`@/tests/ai-proof-memo-renderings`),
 * every marker occurs in a rendering of its own language, no Spanish marker
 * occurs in any other's, no other language's marker occurs in a Spanish one —
 * and each of those left-out words is in a Spanish rendering, so a set that
 * took one in fails there.
 *
 * Portuguese gained mais, sua, além, daqui and desses (re-review,
 * 2026-10-09): with one stray marker allowed ({@link OTHER_MARKERS_AT_MOST}),
 * the memo's last two lines in Portuguese carried one — "também" — and
 * passed. "mais" is French too, and counts for both.
 */
export const LANGUAGE_MARKERS: Readonly<
  Record<MarkedLanguage, ReadonlySet<string>>
> = {
  spanish: new Set([
    "y",
    "los",
    "las",
    "sus",
    "pero",
    "mientras",
    "otros",
    "también",
    "aún",
    "unos",
    "hasta",
  ]),
  english: new Set([
    "the",
    "and",
    "of",
    "to",
    "is",
    "are",
    "will",
    "for",
    "that",
    "by",
    "on",
    "was",
    "be",
    "before",
    "may",
    "must",
    "only",
    "its",
    "it",
    "from",
    "over",
    "while",
    "but",
    "at",
    "within",
    "their",
  ]),
  italian: new Set([
    "il",
    "che",
    "della",
    "dei",
    "gli",
    "anche",
    "è",
    "tutti",
    "tutto",
    "sarà",
  ]),
  portuguese: new Set([
    "do",
    "não",
    "em",
    "uma",
    "com",
    "também",
    "ela",
    "vai",
    "ainda",
    "mais",
    "sua",
    "além",
    "daqui",
    "desses",
  ]),
  french: new Set([
    "et",
    "du",
    "est",
    "ne",
    "pas",
    "qui",
    "sont",
    "aussi",
    "dans",
    "leur",
    "mais",
  ]),
  catalan: new Set(["els", "dels", "amb", "i", "més", "seva", "també"]),
};

/** Marker words of each language in `text`. */
export function languageMarkers(text: string): Record<MarkedLanguage, number> {
  const counts = Object.fromEntries(
    MARKED_LANGUAGES.map((language) => [language, 0]),
  ) as Record<MarkedLanguage, number>;
  for (const word of words(text).trim().split(" "))
    for (const language of MARKED_LANGUAGES)
      if (LANGUAGE_MARKERS[language].has(word)) counts[language] += 1;
  return counts;
}

/**
 * Fewest Spanish marker words a translation of the memo reads as Spanish
 * with. A full translation carries far more — the test holds each Spanish
 * rendering of the memo to at least twice this, so a model's wording has room.
 */
export const SPANISH_MARKERS_AT_LEAST = 5;

/**
 * Most marker words of ALL the other languages together that a Spanish
 * translation may carry: one stray word, not a sentence. A correct Spanish
 * rendering of the memo carries none (the test holds every one to that).
 *
 * WAS "at most a quarter as many as the Spanish markers" — room that grew
 * with the text: one sentence left in English passed at 6 of the memo's 13
 * positions, and the last 4 lines in Portuguese or Catalan, or the last 2 in
 * Italian, passed as Spanish (re-review, 2026-10-09). Every sentence of the
 * memo's English carries at least two English markers, so one left untranslated
 * now fails wherever it sits.
 */
export const OTHER_MARKERS_AT_MOST = 1;

/** Marker words of every language but Spanish. */
function otherMarkers(counts: Record<MarkedLanguage, number>): number {
  return MARKED_LANGUAGES.filter((l) => l !== "spanish").reduce(
    (sum, l) => sum + counts[l],
    0,
  );
}

/**
 * Reads as Spanish by COUNT: at least {@link SPANISH_MARKERS_AT_LEAST} Spanish
 * marker words, and at most {@link OTHER_MARKERS_AT_MOST} of the other five
 * counted languages' together.
 *
 * What a count cannot see — and this docblock said "neither English nor a
 * neighbour" until the third review showed it false: a language no marker set
 * counts passes in ANY amount while the Spanish markers hold (the memo's last
 * six lines in Galician, Spanish's nearest neighbour, passed; so did a German
 * sentence); and a line of a counted language that carries at most one
 * marker passes too (the title left in English, the memo's last sentence in
 * Italian, Portuguese or Catalan). The test pins both. Those lines are what
 * {@link linesNotInSpanish} is for.
 */
export function readsAsSpanish(text: string): boolean {
  const counts = languageMarkers(text);
  return (
    counts.spanish >= SPANISH_MARKERS_AT_LEAST &&
    otherMarkers(counts) <= OTHER_MARKERS_AT_MOST
  );
}

/**
 * Words that mark a LINE as Spanish against the languages the whole-text count
 * cannot see — English, German, Galician: Spanish's articles and function
 * words that none of the three writes ("más" is Galician "máis", "le" is
 * "lle", "ya" is "xa"). "pero" is left out, because Galician writes it too;
 * "el", "la", "del", "una" and "su" are in, though Italian, Catalan or French
 * write them, because those languages are the count's to refuse. Held, in
 * `ai-proof-content.test.ts`, to occur in a Spanish rendering each, in no
 * English, German or Galician rendering, and to mark every line of every
 * Spanish rendering.
 */
export const SPANISH_LINE_MARKERS: ReadonlySet<string> = new Set([
  "el",
  "la",
  "los",
  "las",
  "del",
  "al",
  "una",
  "unos",
  "su",
  "sus",
  "y",
  "lo",
  "le",
  "les",
  "ellos",
  "esos",
  "más",
  "ya",
  "mientras",
  "también",
  "aún",
  "hasta",
  "otros",
]);

/** A line shorter than this many words is not checked: a figure, a label. */
export const LINE_CHECK_WORDS_AT_LEAST = 4;

/**
 * The lines of `text` — a line, or a sentence within one, since a model may
 * run the memo together — of at least {@link LINE_CHECK_WORDS_AT_LEAST} words
 * that carry no {@link SPANISH_LINE_MARKERS} word and none of the memo's body
 * names, as 1-based positions. Each is a line in some other language.
 *
 * Independent of the marker count, which sums the whole text: this asks the
 * question of every line. What it does NOT see, each pinned by the test: a
 * line that carries a body name ("Halvorsen tamén recomenda…" in Galician, a
 * German line naming Ostby); a line of a counted neighbour that writes "la",
 * "el" or "del" (Italian, Catalan, French — the count's to refuse, and it lets
 * one line through); a line under four words; and the TITLE — a first line
 * with no full stop — because a Spanish heading drops its articles
 * ("Informe de inspección: puente Kestrel"), so the title left in English
 * passes. And what it gets WRONG, pinned too: a Spanish sentence with none of
 * these words ("Se prevé un coste de 2.480.000 euros, pagados con fondos
 * regionales de carreteras.") is refused as another language. Every sentence
 * of every Spanish rendering here carries one; a model's may not.
 */
export function linesNotInSpanish(text: string): number[] {
  const lines = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.flatMap((line, i) => {
    if (i === 0 && !/[.!?]$/.test(line)) return [];
    const said = words(line).trim().split(" ");
    if (said.length < LINE_CHECK_WORDS_AT_LEAST) return [];
    if (said.some((w) => SPANISH_LINE_MARKERS.has(w))) return [];
    if (PROOF_MEMO_BODY_NAMES.some((name) => mentions(line, name))) return [];
    return [i + 1];
  });
}

/** The memo's length, as the checks compare lengths: title and sentences. */
const MEMO_CHARACTERS = normalizeProse(
  [PROOF_MEMO_TITLE, ...PROOF_MEMO_SENTENCES].join("\n"),
).length;

/** How long `text` is against the memo, as a ratio of `normalizeProse` lengths. */
export function lengthAgainstMemo(text: string): number {
  return normalizeProse(text).length / MEMO_CHARACTERS;
}

/**
 * The margin below the most concise correct translation the floor allows: a
 * sixth of the memo's length.
 */
export const TRANSLATION_LENGTH_MARGIN = 0.15;

/**
 * Shortest a translation of the memo may be, against the memo's own length:
 * the most concise correct Spanish rendering's ratio (0.958) less
 * {@link TRANSLATION_LENGTH_MARGIN}, rounded down. DERIVED in
 * `ai-proof-content.test.ts` from every Spanish rendering: add a more concise
 * correct one to the corpus and that test fails until this follows it.
 *
 * Until 2026-10-09 (re-review 3) nothing bounded how much of the memo
 * arrived: a Spanish summary (0.26) and the translation with its middle six
 * sentences dropped (0.63) passed. STATED LIMITS, both pinned by the test: a
 * length cannot see WHICH part is missing, and a translator who writes long
 * has room — the Spain rendering with any three sentences that name no one
 * dropped still passes (the whole-names rule catches a drop of a named
 * line); and a correct translation terser than 0.8 of the memo — a sixth
 * terser than the most concise one here — is refused.
 */
export const TRANSLATION_LENGTH_AT_LEAST = 0.8;

/**
 * The marker words of the other languages in `text`, most first — "21
 * Italian, 1 French" — and, when one outnumbers the Spanish, which language
 * the text reads as.
 */
export function otherLanguagesIn(counts: Record<MarkedLanguage, number>): {
  readonly breakdown: string;
  readonly readsAs: MarkedLanguage | null;
} {
  const others = MARKED_LANGUAGES.filter(
    (l) => l !== "spanish" && counts[l] > 0,
  ).sort((a, b) => counts[b] - counts[a]);
  const top = others[0];
  return {
    breakdown:
      others.length > 0
        ? others.map((l) => `${counts[l]} ${LANGUAGE_NAMES[l]}`).join(", ")
        : "none of another language",
    readsAs: top !== undefined && counts[top] > counts.spanish ? top : null,
  };
}

async function readZip(bytes: Uint8Array): Promise<JSZip | null> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    return null;
  }
}

async function readText(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  return file ? file.async("string") : null;
}

async function readJson(zip: JSZip, name: string): Promise<unknown> {
  const text = await readText(zip, name);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The memo's body names `text` keeps. */
const bodyNamesIn = (text: string) =>
  PROOF_MEMO_BODY_NAMES.filter((name) => mentions(text, name));

/**
 * What only the memo's body says that `text` says too: names, months, then
 * stems ("ferry…"), then figures ("nine weeks").
 */
export function memoBodyMarksIn(text: string): string[] {
  return [
    ...bodyNamesIn(text),
    ...PROOF_MEMO_BODY_MONTHS.filter((month) => mentions(text, month)),
    ...PROOF_MEMO_BODY_STEMS.filter((stem) => mentionsStem(text, stem)).map(
      (stem) => `${stem}…`,
    ),
    ...PROOF_MEMO_FIGURES.filter((figure) =>
      figure.forms.some((form) => mentionsStem(text, form)),
    ).map((figure) => figure.label),
  ];
}

/** Everything the summary check counts as said by the body, as it lists it. */
export const PROOF_MEMO_BODY_MARKS: readonly string[] = [
  ...PROOF_MEMO_BODY_NAMES,
  ...PROOF_MEMO_BODY_MONTHS,
  ...PROOF_MEMO_BODY_STEMS.map((stem) => `${stem}…`),
  ...PROOF_MEMO_FIGURES.map((figure) => figure.label),
];

/**
 * A summary OF THE MEMO: summary.txt is not empty, is not the memo echoed
 * back, names the memo's subject ({@link PROOF_MEMO_SUBJECT}) AND something
 * only its body says ({@link memoBodyMarksIn}): a name, a month, the ferry,
 * the council, or one of its figures. The subject alone is what a summary of
 * the title, or of a kestrel, says too; the subject with cables, corrosion,
 * repairs and trucks is what a refusal, a one-line description or another
 * bridge's report says.
 *
 * What it does NOT rule out: a summary that is wrong about the memo but
 * carries one of those marks — "Halvorsen found the Kestrel Bridge sound"
 * passes. It asks whether the body reached the summary, not whether the
 * summary is true to it. And a month, the council or one lane is weaker
 * evidence than a name: a summary of ANOTHER bridge whose budget is due in
 * April passes (the test pins it) — the price of not refusing a faithful
 * summary that names no one and rounds every figure.
 */
export async function verifySummaryProof(
  bytes: Uint8Array,
): Promise<ContentVerdict> {
  const zip = await readZip(bytes);
  if (!zip) return { ok: false, detail: "the artifact is not a readable ZIP" };
  const summary = (await readText(zip, "summary.txt"))?.trim() ?? null;
  if (summary === null)
    return { ok: false, detail: "the package has no summary.txt" };
  if (summary.length === 0)
    return { ok: false, detail: "summary.txt is empty" };
  const carried = sentencesCarried(summary, PROOF_MEMO_SENTENCES);
  if (echoes(summary, PROOF_MEMO_SENTENCES))
    return {
      ok: false,
      detail: `summary.txt is the memo echoed back: ${carried} of its ${PROOF_MEMO_SENTENCES.length} sentences verbatim`,
    };
  const subject = PROOF_MEMO_SUBJECT.filter((s) => mentionsStem(summary, s));
  if (subject.length === 0)
    return {
      ok: false,
      detail: `summary.txt (${summary.length} chars) names neither ${PROOF_MEMO_SUBJECT.join(" nor ")} — it is not about the memo's subject`,
    };
  const body = memoBodyMarksIn(summary);
  if (body.length === 0)
    return {
      ok: false,
      detail: `summary.txt (${summary.length} chars) names ${subject.join(" and ")} but nothing only the memo's body says (${PROOF_MEMO_BODY_MARKS.join(", ")}) — a summary of its title, or of anything else called that, says as much`,
    };
  return {
    ok: true,
    detail: `${summary.length}-char summary naming ${subject.join(" and ")}, and ${body.join(", ")} from the body; ${carried} of ${PROOF_MEMO_SENTENCES.length} memo sentences verbatim`,
  };
}

/**
 * A translation OF THE MEMO INTO SPANISH: translation.txt is not empty, is
 * not the memo echoed back, is the language the manifest says was asked for,
 * reads as Spanish by count ({@link readsAsSpanish}) and LINE BY LINE
 * ({@link linesNotInSpanish}), keeps EVERY name only the memo's body carries
 * ({@link PROOF_MEMO_BODY_NAMES}) — so a translation of its title alone, of
 * some other document, or one cut off before the ferry from Ostby does not
 * pass (until 2026-10-09 one name was enough) — and is at least
 * {@link TRANSLATION_LENGTH_AT_LEAST} of the memo's length, so a summary of
 * it, or the translation with its middle dropped, does not pass either.
 *
 * Each bound's own limits are in its docblock, and pinned by the test.
 */
export async function verifyTranslationProof(
  bytes: Uint8Array,
): Promise<ContentVerdict> {
  const zip = await readZip(bytes);
  if (!zip) return { ok: false, detail: "the artifact is not a readable ZIP" };
  const translation = (await readText(zip, "translation.txt"))?.trim() ?? null;
  if (translation === null)
    return { ok: false, detail: "the package has no translation.txt" };
  if (translation.length === 0)
    return { ok: false, detail: "translation.txt is empty" };
  const manifest = (await readJson(zip, "manifest.json")) as {
    options?: { targetLanguage?: unknown };
  } | null;
  const target = manifest?.options?.targetLanguage;
  if (target !== PROOF_TRANSLATION_TARGET)
    return {
      ok: false,
      detail: `manifest.json says the target was ${JSON.stringify(target)}, not "${PROOF_TRANSLATION_TARGET}"`,
    };
  const carried = sentencesCarried(translation, PROOF_MEMO_SENTENCES);
  if (echoes(translation, PROOF_MEMO_SENTENCES))
    return {
      ok: false,
      detail: `translation.txt is the memo echoed back: ${carried} of its ${PROOF_MEMO_SENTENCES.length} sentences verbatim`,
    };
  const markers = languageMarkers(translation);
  const others = otherLanguagesIn(markers);
  if (!readsAsSpanish(translation))
    return {
      ok: false,
      detail:
        `translation.txt does not read as Spanish: ${markers.spanish} Spanish marker words against ${others.breakdown}` +
        (others.readsAs
          ? ` — it reads as ${LANGUAGE_NAMES[others.readsAs]}`
          : ""),
    };
  const named = bodyNamesIn(translation);
  if (named.length === 0)
    return {
      ok: false,
      detail: `translation.txt keeps none of ${PROOF_MEMO_BODY_NAMES.join(", ")} — it is not a translation of the memo's body`,
    };
  const dropped = PROOF_MEMO_BODY_NAMES.filter((n) => !named.includes(n));
  if (dropped.length > 0)
    return {
      ok: false,
      detail: `translation.txt keeps ${named.join(", ")} but not ${dropped.join(", ")} — a translation cut short, or of part of the memo`,
    };
  // After the names: a text that is not the memo's is told so, not that a
  // line of it is in another language.
  const unmarked = linesNotInSpanish(translation);
  if (unmarked.length > 0)
    return {
      ok: false,
      detail: `translation.txt has ${unmarked.length} line(s) of ${LINE_CHECK_WORDS_AT_LEAST}+ words with no Spanish word and none of ${PROOF_MEMO_BODY_NAMES.join(", ")} (line ${unmarked.join(", ")}) — a line left in another language`,
    };
  const length = lengthAgainstMemo(translation);
  if (length < TRANSLATION_LENGTH_AT_LEAST)
    return {
      ok: false,
      detail: `translation.txt is ${length.toFixed(2)} of the memo's length, under ${TRANSLATION_LENGTH_AT_LEAST} — a summary of the memo, or a translation of part of it`,
    };
  return {
    ok: true,
    detail: `${translation.length}-char Spanish translation (${markers.spanish} Spanish marker words against ${others.breakdown}) keeping ${named.join(", ")}`,
  };
}

/**
 * The slice of `chat-with-pdf`'s `manifest.json` the chat proof reads.
 * Counts only — the harness never prints the answer text.
 */
interface ChatProofManifest {
  contextTurns?: number;
  usage?: { input?: number; output?: number; cachedInput?: number };
}

/** Report token accounting without ever printing text. */
function usageNote(m: ChatProofManifest): string {
  if (!m.usage) return "usage not reported";
  const cached = m.usage.cachedInput;
  return (
    `input=${m.usage.input ?? "?"} output=${m.usage.output ?? "?"} ` +
    `cachedInput=${cached ?? 0}${cached ? "" : " (no cache read)"}`
  );
}

const CHAT_LINES = CHAT_PROOF_PAGES.flatMap((page) => page.lines);

/**
 * An answer to THIS question, from the notes: the browser's own reader
 * (`readAnswerFromPackage`) finds a non-empty answer to the question that was
 * asked; it is not the notes echoed back; it names the fact the question is
 * about and nothing the notes give for another team (`mustNotMention`); and
 * the worker's engine was given `contextTurns` prior turns.
 *
 * `contextTurns` is the engine's count of the turns in its OPTIONS, not of
 * what reached the provider; for the follow-up only the answer speaks to
 * that, and it cannot show the opening answer arrived — see
 * {@link CHAT_PROOF_FOLLOW_UP}.
 */
export async function verifyChatProof(
  bytes: Uint8Array,
  expected: {
    readonly question: string;
    readonly mustMention: string;
    readonly mustNotMention: readonly string[];
    readonly contextTurns: number;
  },
): Promise<ContentVerdict> {
  const zip = await readZip(bytes);
  if (!zip) return { ok: false, detail: "the artifact is not a readable ZIP" };
  const manifest = (await readJson(
    zip,
    "manifest.json",
  )) as ChatProofManifest | null;
  if (!manifest)
    return { ok: false, detail: "the package has no readable manifest.json" };
  const turns = manifest.contextTurns ?? -1;
  if (turns !== expected.contextTurns)
    return {
      ok: false,
      detail:
        expected.contextTurns > 0
          ? `the worker reported contextTurns=${turns}, wanted ${expected.contextTurns} — prior turns did not reach its engine`
          : `the worker reported contextTurns=${turns}, wanted ${expected.contextTurns}`,
    };
  const answer = await readAnswerFromPackage(bytes, expected.question);
  if (answer === null)
    return {
      ok: false,
      detail:
        "answer.txt holds no answer to the question asked, read as the browser reads it",
    };
  const carried = sentencesCarried(answer, CHAT_LINES);
  if (echoes(answer, CHAT_LINES))
    return {
      ok: false,
      detail: `the answer is the notes echoed back: ${carried} of ${CHAT_LINES.length} lines verbatim`,
    };
  const elsewhere = expected.mustNotMention.filter((term) =>
    mentions(answer, term),
  );
  if (elsewhere.length > 0)
    return {
      ok: false,
      detail: `the ${answer.length}-char answer names ${elsewhere.map((t) => `"${t}"`).join(", ")}, which the notes give for another team than the one asked about`,
    };
  if (!mentions(answer, expected.mustMention))
    return {
      ok: false,
      detail: `the ${answer.length}-char answer does not name "${expected.mustMention}", which the notes give as the answer`,
    };
  return {
    ok: true,
    detail: `contextTurns=${turns}, the ${answer.length}-char answer names "${expected.mustMention}" and no other team's, ${usageNote(manifest)}`,
  };
}
