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
 */
import JSZip from "jszip";
import { readAnswerFromPackage } from "@/lib/workers/chat-with-pdf-conversation";

/** The memo's heading, drawn above its sentences. */
export const PROOF_MEMO_TITLE = "Kestrel Bridge inspection memo";

/**
 * The memo, one sentence per drawn line. Each is short enough to fit the
 * page's width on one line, so an extractor returns it whole.
 */
export const PROOF_MEMO_SENTENCES: readonly string[] = [
  "The Kestrel Bridge carries the coast road over the Varrow River.",
  "Engineer Ingrid Halvorsen inspected the bridge on 14 March.",
  "She found corrosion on four of the twelve steel cables that hold the main span.",
  "Two of those cables have lost more than a tenth of their strength.",
  "The repair will replace all four cables and will take nine weeks.",
  "It is expected to cost 2,480,000 euros, paid from the regional roads fund.",
  "Trucks over seven tonnes may not cross the bridge while the work goes on.",
  "Cars and bicycles may still cross, but only in one lane at a time.",
  "A ferry from Ostby harbour will carry trucks across the river instead.",
  "The city council must approve the budget before the end of April.",
  "If the work is delayed past June, the bridge will close to all traffic.",
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
 * What the memo's body says, as the starts of words, for a brief summary that
 * names nobody: corroded cables, a repair, trucks sent to a ferry. The memo is
 * about little else, so such a summary is expected to say one of them — an
 * expectation, not a fact the test can hold; what it holds is that each is in
 * the body and not the title, and each is said by some right summary.
 */
export const PROOF_MEMO_BODY_STEMS = [
  "cable",
  "corros",
  "repair",
  "truck",
  "ferry",
] as const;

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
 * say about delivery: a guess of the right team, naming its channel alone,
 * passes. A right answer is evidence the turns reached the model, not proof.
 * The manifest's `contextTurns`, checked too, cannot narrow it: the engine
 * counts the turns in the OPTIONS it was given (`options.context.length`), not
 * the turns that went into the provider's prompt, so a worker that dropped
 * them in between reports 2 all the same. `ai-proof-content.test.ts` holds
 * both halves: the package of a model sent no turns that lists the channels
 * fails, and one that guesses right passes.
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

/** Text as WORDS: `normalizeProse`, punctuation (hyphens too) as spaces. */
function words(text: string): string {
  return ` ${normalizeProse(text)
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

/** Marker words of every language but Spanish. */
function otherMarkers(counts: Record<MarkedLanguage, number>): number {
  return MARKED_LANGUAGES.filter((l) => l !== "spanish").reduce(
    (sum, l) => sum + counts[l],
    0,
  );
}

/**
 * Spanish, and neither English nor a neighbour: at least
 * {@link SPANISH_MARKERS_AT_LEAST} Spanish marker words, and the other five
 * languages' together at most a quarter as many — room for a name or a stray
 * word, not for prose in another language.
 */
export function readsAsSpanish(text: string): boolean {
  const counts = languageMarkers(text);
  return (
    counts.spanish >= SPANISH_MARKERS_AT_LEAST &&
    otherMarkers(counts) * 4 <= counts.spanish
  );
}

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

/** What only the memo's body says that `text` says too: names, then stems ("cable…"). */
export function memoBodyMarksIn(text: string): string[] {
  return [
    ...bodyNamesIn(text),
    ...PROOF_MEMO_BODY_STEMS.filter((stem) => mentionsStem(text, stem)).map(
      (stem) => `${stem}…`,
    ),
  ];
}

/** Everything the summary check counts as said by the body, as it lists it. */
const BODY_MARKS: readonly string[] = [
  ...PROOF_MEMO_BODY_NAMES,
  ...PROOF_MEMO_BODY_STEMS.map((stem) => `${stem}…`),
];

/**
 * A summary OF THE MEMO: summary.txt is not empty, is not the memo echoed
 * back, names the memo's subject ({@link PROOF_MEMO_SUBJECT}) AND something
 * only its body says ({@link memoBodyMarksIn}). The subject alone is what a
 * summary of the title, or of a kestrel, says too.
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
      detail: `summary.txt (${summary.length} chars) names ${subject.join(" and ")} but nothing only the memo's body says (${BODY_MARKS.join(", ")}) — a summary of its title, or of anything else called that, says as much`,
    };
  return {
    ok: true,
    detail: `${summary.length}-char summary naming ${subject.join(" and ")}, and ${body.join(", ")} from the body; ${carried} of ${PROOF_MEMO_SENTENCES.length} memo sentences verbatim`,
  };
}

/**
 * A translation OF THE MEMO INTO SPANISH: translation.txt is not empty, is
 * not the memo echoed back, is the language the manifest says was asked for
 * and reads as Spanish — not as the memo's English, nor as Italian,
 * Portuguese, Catalan or French ({@link LANGUAGE_MARKERS}) — and keeps at
 * least one of the names only the memo's body carries
 * ({@link PROOF_MEMO_BODY_NAMES}), so a translation of its title alone, or of
 * some other document, does not pass.
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
 * that — see {@link CHAT_PROOF_FOLLOW_UP} for how far.
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
