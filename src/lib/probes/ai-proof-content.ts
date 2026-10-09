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
 * names no other document carries, followed by a BLANK page. The names are in
 * it so a correct summary or translation has something it must carry; the
 * blank page is there so a declaration of the page count instead of the pages
 * WITH TEXT is a different number.
 *
 * ── WHAT A PASS USED TO MEAN (2026-10-09) ───────────────────────────────────
 *
 * summarize-pdf and translate-pdf passed on "a ZIP came back"; chat-with-pdf
 * checked turn COUNTS. A package holding an empty file, the document echoed
 * back, a summary of some other document or an English "translation" was a
 * pass, and the ledger recorded the tool as proven. Each check below names
 * what such a package gets wrong. Each is BOUNDED so a correct answer cannot
 * trip it whatever a model's wording: a name that survives any paraphrase or
 * translation, not a phrase; an echo is MORE THAN HALF the source's sentences
 * verbatim, which no brief summary, no translation and no one-sentence answer
 * contains; "the target language" is a count of function words, not a parse.
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
 * Names the memo carries and no other document does. A summary of it names
 * at least one of them — what it is ABOUT — and a translation keeps them, as
 * translations keep names. Each is held to appear in the memo by its test.
 */
export const PROOF_MEMO_NAMES = ["Kestrel", "Halvorsen", "Varrow"] as const;

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

const CHAT_FACT_LINES = [
  `The secure worker fleet is maintained by the ${CHAT_PROOF_FACTS.team} team.`,
  `The ${CHAT_PROOF_FACTS.team} team takes its pages on the ${CHAT_PROOF_FACTS.channel} channel.`,
];

/** Where the facts sit: page 2, as its lines 5 and 6 — well inside what one question reads. */
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
 * two fact lines in place of two of page 2's. Distinct, factual sentences
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

/** The opening question: one the notes answer, and only with the planted team. */
export const CHAT_PROOF_OPENING = {
  question:
    "According to these notes, which team maintains the secure worker fleet? Answer in one sentence.",
  mustMention: CHAT_PROOF_FACTS.team,
} as const;

/**
 * The follow-up: "that team" means nothing without the opening exchange, and
 * the channel is in the notes — so a right answer used both.
 */
export const CHAT_PROOF_FOLLOW_UP = {
  question: "Which channel does that team take its pages on?",
  mustMention: CHAT_PROOF_FACTS.channel,
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

/**
 * Function words that mark a text as English or Spanish. None is a word in
 * the other language, and none is a name in the memo; each is in the memo's
 * English or in any Spanish rendering of it.
 */
export const ENGLISH_MARKERS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "of",
  "to",
  "is",
  "are",
  "will",
  "with",
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
  "which",
  "while",
  "but",
  "this",
  "at",
  "within",
  "their",
]);
export const SPANISH_MARKERS: ReadonlySet<string> = new Set([
  "el",
  "la",
  "los",
  "las",
  "del",
  "y",
  "que",
  "con",
  "por",
  "para",
  "una",
  "un",
  "se",
  "es",
  "será",
  "al",
  "sus",
  "su",
  "pero",
  "antes",
  "durante",
  "mientras",
  "cada",
  "sobre",
  "desde",
]);

/** Marker words of each language in `text`. */
export function languageMarkers(text: string): {
  english: number;
  spanish: number;
} {
  let english = 0;
  let spanish = 0;
  for (const word of words(text).trim().split(" ")) {
    if (ENGLISH_MARKERS.has(word)) english += 1;
    if (SPANISH_MARKERS.has(word)) spanish += 1;
  }
  return { english, spanish };
}

/**
 * Spanish, not English: enough Spanish function words to be prose, and
 * English ones at most a quarter as many. A correct translation of the memo
 * has dozens of the first and none of the second; the memo has the reverse.
 */
export function readsAsSpanish(text: string): boolean {
  const { english, spanish } = languageMarkers(text);
  return spanish >= 8 && english * 4 <= spanish;
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

const memoNamesIn = (text: string) =>
  PROOF_MEMO_NAMES.filter((name) => mentions(text, name));

/**
 * A summary OF THE MEMO: summary.txt is not empty, is not the memo echoed
 * back, and names what the memo is about.
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
  const named = memoNamesIn(summary);
  if (named.length === 0)
    return {
      ok: false,
      detail: `summary.txt (${summary.length} chars) names none of ${PROOF_MEMO_NAMES.join(", ")} — it is not a summary of the memo`,
    };
  return {
    ok: true,
    detail: `${summary.length}-char summary naming ${named.join(", ")}; ${carried} of ${PROOF_MEMO_SENTENCES.length} memo sentences verbatim`,
  };
}

/**
 * A translation OF THE MEMO INTO SPANISH: translation.txt is not empty, is
 * not the memo echoed back, is the language the manifest says was asked for
 * and reads as it, not as the memo's English, and keeps the memo's names.
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
  if (!readsAsSpanish(translation))
    return {
      ok: false,
      detail: `translation.txt does not read as Spanish: ${markers.spanish} Spanish and ${markers.english} English function words`,
    };
  const named = memoNamesIn(translation);
  if (named.length === 0)
    return {
      ok: false,
      detail: `translation.txt keeps none of ${PROOF_MEMO_NAMES.join(", ")} — it is not a translation of the memo`,
    };
  return {
    ok: true,
    detail: `${translation.length}-char Spanish translation (${markers.spanish} Spanish / ${markers.english} English function words) keeping ${named.join(", ")}`,
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
 * about; and the worker received `contextTurns` prior turns.
 */
export async function verifyChatProof(
  bytes: Uint8Array,
  expected: {
    readonly question: string;
    readonly mustMention: string;
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
          ? `the worker reported contextTurns=${turns}, wanted ${expected.contextTurns} — prior turns did not reach it`
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
  if (!mentions(answer, expected.mustMention))
    return {
      ok: false,
      detail: `the ${answer.length}-char answer does not name "${expected.mustMention}", which the notes give as the answer`,
    };
  return {
    ok: true,
    detail: `contextTurns=${turns}, the ${answer.length}-char answer names "${expected.mustMention}", ${usageNote(manifest)}`,
  };
}
