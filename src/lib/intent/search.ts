/**
 * Ranked search over anything with a name: what a query MEANS, not only the
 * letters it shares with a title.
 *
 * Pure, and the documents are an argument — so no page pays for the
 * catalogue because it can search. `toolDocs(tools)` turns the catalogue
 * into documents; `@/lib/tools/search-tools` indexes them once for the
 * `/tools` explorer and the 404's "Did you mean".
 *
 * THE ALGORITHM, in order:
 *
 *  - Tokenise: NFKD with accents stripped, lower case, split on anything not
 *    a letter or digit; a slash-joined pair ("PDF/A") is also kept whole
 *    ("pdfa"), and plurals fold on both sides ("pdfs" meets "pdf").
 *    Stopwords (a, the, to, for, from, of, with, file, online, free…) do not
 *    have to match, but still count for an exact name and set direction ("to").
 *    A multi-word synonym ("remove password", "black and white") collapses to
 *    its group's head word first.
 *  - Match: every remaining token must match some field of a document, by the
 *    best of — the word itself (1.0); a word of the same synonym group (0.9);
 *    a word it begins (0.8), unless the token is under 3 letters and not the
 *    last, or names a file format, so "webp" never reaches "webpage" and
 *    "doc" never reaches "docx"; one edit away (0.6), for tokens and words of
 *    5 letters or more, counting a swap of two letters as one edit ("mrege").
 *  - Score: each token scores its best field — name 10, aliases (the tasks
 *    people name a tool by) 8, keywords 5, formats 4 (the format itself
 *    only), tagline 3, description 1 — times the match quality. Bonuses: the
 *    tokens in the name's own order +6; each word after the query's "to" that
 *    matches a word after the name's "to" +6, when the words before both
 *    "to"s agree (which tells "pdf to word" from "word to pdf", and keeps
 *    "scanned to text" from PDF to Text); the query being, word for word, one
 *    of the document's keywords or aliases +30 (so that phrase names its
 *    tool) or its whole name +40.
 *  - Mode: "all" when some document matches every token. Otherwise
 *    "closest": documents matching ANY token, most tokens first — but only
 *    on evidence: a token that matches half the index or more ("pdf") is no
 *    evidence on its own. Nothing left is "empty".
 *  - A token that names a format nothing here opens (HEIC, WebP, ZIP…) is
 *    reported as `unsupported`, so the caller can answer it.
 */
import { SYNONYM_GROUPS, TASKS, type Task } from "@/lib/tools/intents";
import {
  UNSUPPORTED_FORMATS,
  formatForToken,
  type UnsupportedFormat,
} from "./formats";

export type DocKind = "tool" | "task" | "guide" | "page" | "action";

/** Anything the search can rank. Only `kind`, `id` and `name` are required. */
export interface SearchDoc {
  readonly kind: DocKind;
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly keywords?: readonly string[];
  readonly formats?: readonly string[];
  readonly tagline?: string;
  readonly description?: string;
}

/** Field weights: a hit in the name outranks one buried in the description. */
const FIELD_WEIGHTS = {
  name: 10,
  aliases: 8,
  keywords: 5,
  formats: 4,
  tagline: 3,
  description: 1,
} as const;
type Field = keyof typeof FIELD_WEIGHTS;
const FIELDS = Object.keys(FIELD_WEIGHTS) as Field[];

const QUALITY = { exact: 1, synonym: 0.9, prefix: 0.8, fuzzy: 0.6 } as const;

const BONUS = {
  inOrder: 6,
  direction: 6,
  phrase: 30,
  exactName: 40,
} as const;

/** A token matching this share of the index or more is no evidence alone. */
const COMMON_SHARE = 0.5;

/**
 * Words that need not match. "to" is one, but it still sets direction, and
 * every stopword counts toward an exact name ("Chat with PDF").
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "my",
  "into",
  "for",
  "from",
  "of",
  "with",
  "file",
  "online",
  "free",
]);

/**
 * Fold a plural so "pdfs" meets "pdf" — applied to the query AND the
 * documents alike, since folding one side misses every word stored plural.
 * Not to short words ("has") or "-ss" words, so "compress" stays "compress".
 */
function foldPlural(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;
}

/**
 * The words of `text`, as the search compares them. A slash-joined pair is
 * ALSO kept whole, so "pdf/a" and "pdfa" find PDF to PDF/A instead of every
 * tool with "pdf" in it.
 */
export function wordsOf(text: string): string[] {
  const lower = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
  const joined = [...lower.matchAll(/[a-z0-9]+(?:\/[a-z0-9]+)+/g)].map(
    (match) => match[0].replace(/\//g, ""),
  );
  return [...lower.split(/[^a-z0-9]+/), ...joined]
    .filter(Boolean)
    .map(foldPlural);
}

/**
 * Optimal string alignment distance, capped: returns `cap + 1` as soon as the
 * distance must exceed `cap`. A swap of two adjacent letters is one edit.
 */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2]! + 1);
      }
      row.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > cap) return cap + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length]!;
}

interface Synonyms {
  /** Single-word synonyms: word → the other single words of its groups. */
  readonly peers: ReadonlyMap<string, ReadonlySet<string>>;
  /** Multi-word synonyms, longest first, each with its group's head word. */
  readonly phrases: readonly { words: readonly string[]; head: string }[];
}

function buildSynonyms(groups: readonly (readonly string[])[]): Synonyms {
  const peers = new Map<string, Set<string>>();
  const phrases: { words: string[]; head: string }[] = [];
  for (const group of groups) {
    const head = wordsOf(group[0] ?? "")[0];
    if (!head) continue;
    const singles: string[] = [];
    for (const term of group) {
      const words = wordsOf(term).filter((w) => !STOPWORDS.has(w));
      if (words.length === 1) singles.push(words[0]!);
      else if (words.length > 1) phrases.push({ words, head });
    }
    for (const word of singles) {
      const set = peers.get(word) ?? new Set<string>();
      for (const other of singles) if (other !== word) set.add(other);
      peers.set(word, set);
    }
  }
  phrases.sort((a, b) => b.words.length - a.words.length);
  return { peers, phrases };
}

/** Collapse multi-word synonyms in a token list to their head words. */
function collapsePhrases(words: readonly string[], synonyms: Synonyms) {
  const out: string[] = [];
  for (let i = 0; i < words.length;) {
    const phrase = synonyms.phrases.find((p) =>
      p.words.every((w, k) => words[i + k] === w),
    );
    if (phrase) {
      out.push(phrase.head);
      i += phrase.words.length;
    } else {
      out.push(words[i]!);
      i += 1;
    }
  }
  return out;
}

/** The comparable spelling of a format word: "jpeg" and "jpg" are one. */
function formatWord(word: string): string {
  return formatForToken(word)?.toLowerCase() ?? word;
}

interface Entry<D> {
  readonly doc: D;
  readonly order: number;
  readonly name: readonly string[];
  readonly exactName: string;
  readonly phrases: ReadonlySet<string>;
}

interface Posting {
  readonly entry: number;
  readonly field: Field;
}

export interface SearchIndex<D extends SearchDoc = SearchDoc> {
  readonly entries: readonly Entry<D>[];
  /** Every distinct word of every field, with where it occurs. */
  readonly vocabulary: ReadonlyMap<string, readonly Posting[]>;
  readonly synonyms: Synonyms;
}

export interface IndexOptions {
  /** Synonym groups; defaults to the catalogue's own. */
  readonly synonyms?: readonly (readonly string[])[];
}

function fieldText(doc: SearchDoc, field: Field): string[] {
  switch (field) {
    case "name":
      return wordsOf(doc.name);
    case "aliases":
      return (doc.aliases ?? []).flatMap(wordsOf);
    case "keywords":
      return (doc.keywords ?? []).flatMap(wordsOf);
    case "formats":
      return (doc.formats ?? []).map((label) =>
        formatWord(label.toLowerCase().replace(/[^a-z0-9]/g, "")),
      );
    case "tagline":
      return wordsOf(doc.tagline ?? "");
    case "description":
      return wordsOf(doc.description ?? "");
  }
}

/** Index `docs` once; search it many times. */
export function buildIndex<D extends SearchDoc>(
  docs: readonly D[],
  options: IndexOptions = {},
): SearchIndex<D> {
  const vocabulary = new Map<string, Posting[]>();
  const entries = docs.map((doc, order): Entry<D> => {
    for (const field of FIELDS) {
      for (const word of new Set(fieldText(doc, field))) {
        const postings = vocabulary.get(word) ?? [];
        postings.push({ entry: order, field });
        vocabulary.set(word, postings);
      }
    }
    const name = wordsOf(doc.name);
    return {
      doc,
      order,
      name,
      exactName: name.join(" "),
      phrases: new Set(
        [...(doc.keywords ?? []), ...(doc.aliases ?? [])].map((phrase) =>
          wordsOf(phrase).join(" "),
        ),
      ),
    };
  });
  return {
    entries,
    vocabulary,
    synonyms: buildSynonyms(options.synonyms ?? SYNONYM_GROUPS),
  };
}

export type SearchMode = "all" | "closest" | "empty";

export interface SearchResult<D> {
  /** Best first. */
  readonly results: readonly D[];
  /** "all": every token matched; "closest": some did; "empty": none did. */
  readonly mode: SearchMode;
  /** A format the query names that no tool opens, for the caller to answer. */
  readonly unsupported: UnsupportedFormat | null;
}

export interface SearchOptions {
  readonly kinds?: readonly DocKind[];
  readonly limit?: number;
}

/** How well `token` matches each word of the vocabulary that it matches. */
function tokenMatches(
  index: SearchIndex<SearchDoc>,
  token: string,
  isLast: boolean,
): { general: Map<string, number>; format: Map<string, number> } {
  const peers = index.synonyms.peers.get(token);
  const isFormat = formatForToken(token) !== null;
  const prefixOk = !isFormat && (token.length >= 3 || isLast);
  const fuzzyOk = !isFormat && token.length >= 5;
  const asFormat = formatWord(token);
  const general = new Map<string, number>();
  const format = new Map<string, number>();
  for (const word of index.vocabulary.keys()) {
    let q = 0;
    if (word === token) q = QUALITY.exact;
    else if (peers?.has(word)) q = QUALITY.synonym;
    else if (prefixOk && word.startsWith(token)) q = QUALITY.prefix;
    else if (fuzzyOk && word.length >= 5 && editDistance(token, word, 1) <= 1) {
      q = QUALITY.fuzzy;
    }
    if (q > 0) general.set(word, q);
    if (word === asFormat) format.set(word, QUALITY.exact);
  }
  return { general, format };
}

/** Search `index` for `query`. Pure; the index is never mutated. */
export function search<D extends SearchDoc>(
  index: SearchIndex<D>,
  query: string,
  options: SearchOptions = {},
): SearchResult<D> {
  const kinds = options.kinds ? new Set(options.kinds) : null;
  const pool = index.entries.filter(
    (entry) => !kinds || kinds.has(entry.doc.kind),
  );
  const limit = (list: D[]) =>
    options.limit === undefined ? list : list.slice(0, options.limit);

  const all = wordsOf(query);
  if (all.length === 0) {
    return query.trim()
      ? { results: [], mode: "empty", unsupported: null }
      : {
          results: limit(pool.map((entry) => entry.doc)),
          mode: "all",
          unsupported: null,
        };
  }
  const meaningful = all.filter((word) => !STOPWORDS.has(word));
  const typed = meaningful.length > 0 ? meaningful : all;
  const unsupported =
    (typed
      .map(formatForToken)
      .find((format) =>
        (UNSUPPORTED_FORMATS as readonly string[]).includes(format ?? ""),
      ) as UnsupportedFormat | undefined) ?? null;
  const tokens = [...new Set(collapsePhrases(typed, index.synonyms))];
  const lastToken = tokens[tokens.length - 1];

  // Best weighted quality per (entry, token), read through the postings.
  const matches = tokens.map((token) =>
    tokenMatches(index, token, token === lastToken),
  );
  const best = new Map<number, number[]>();
  matches.forEach(({ general, format }, t) => {
    const visit = (word: string, q: number, formatsOnly: boolean) => {
      for (const posting of index.vocabulary.get(word) ?? []) {
        if ((posting.field === "formats") !== formatsOnly) continue;
        const scores = best.get(posting.entry) ?? tokens.map(() => 0);
        scores[t] = Math.max(scores[t]!, FIELD_WEIGHTS[posting.field] * q);
        best.set(posting.entry, scores);
      }
    };
    for (const [word, q] of general) visit(word, q, false);
    for (const [word, q] of format) visit(word, q, true);
  });

  const inPool = new Set(pool.map((entry) => entry.order));
  const quality = (t: number, word: string) =>
    matches[t]!.general.get(word) ?? 0;
  const exact = all.join(" ");
  const queryTo = all.indexOf("to");
  const side = (words: readonly string[]) => {
    const collapsed = collapsePhrases(
      words.filter((w) => !STOPWORDS.has(w)),
      index.synonyms,
    );
    return tokens
      .map((token, t) => ({ token, t }))
      .filter(({ token }) => collapsed.includes(token));
  };
  const sources = queryTo === -1 ? [] : side(all.slice(0, queryTo));
  const targets = queryTo === -1 ? [] : side(all.slice(queryTo + 1));

  const scored: { entry: Entry<D>; score: number; matched: number }[] = [];
  for (const [order, scores] of best) {
    if (!inPool.has(order)) continue;
    const entry = index.entries[order]!;
    let score = scores.reduce((sum, s) => sum + s, 0);
    const matched = scores.filter((s) => s > 0).length;
    // In-order bonus: each token's first name position after the last one's.
    if (tokens.length > 1) {
      let cursor = -1;
      const inOrder = tokens.every((_, t) => {
        const at = entry.name.findIndex(
          (word, i) => i > cursor && quality(t, word) > 0,
        );
        cursor = at;
        return at !== -1;
      });
      if (inOrder) score += BONUS.inOrder;
    }
    // Direction bonus: "images to pdf" names a TARGET — but only for a name
    // whose own source agrees with the query's, so "scanned to text" is not
    // sent to PDF to Text (whose source is a PDF with text in it already).
    const nameTo = entry.name.indexOf("to");
    if (nameTo !== -1) {
      const nameSource = entry.name.slice(0, nameTo);
      const nameTarget = entry.name.slice(nameTo + 1);
      const aligned = sources.every(({ t }) =>
        nameSource.some((word) => quality(t, word) > 0),
      );
      for (const { t } of aligned ? targets : []) {
        if (nameTarget.some((word) => quality(t, word) > 0)) {
          score += BONUS.direction;
        }
      }
    }
    if (entry.phrases.has(exact)) score += BONUS.phrase;
    if (entry.exactName === exact) score += BONUS.exactName;
    scored.push({ entry, score, matched });
  }

  const rank = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    b.matched - a.matched || b.score - a.score || a.entry.order - b.entry.order;

  const complete = scored.filter((s) => s.matched === tokens.length);
  if (complete.length > 0) {
    return {
      results: limit(complete.sort(rank).map((s) => s.entry.doc)),
      mode: "all",
      unsupported,
    };
  }

  // Closest: only on evidence. A token that matches half the pool or more
  // ("pdf") does not qualify a document on its own.
  const share = tokens.map(
    (_, t) =>
      scored.filter((s) => best.get(s.entry.order)![t]! > 0).length /
      Math.max(1, pool.length),
  );
  const evidenced = scored.filter((s) =>
    best
      .get(s.entry.order)!
      .some((value, t) => value > 0 && share[t]! < COMMON_SHARE),
  );
  return evidenced.length > 0
    ? {
        results: limit(evidenced.sort(rank).map((s) => s.entry.doc)),
        mode: "closest",
        unsupported,
      }
    : { results: [], mode: "empty", unsupported };
}

/**
 * The documents whose name, alias or keyword words are within two edits of a
 * query word — for an empty result, "did you mean". Only words of 4 letters
 * or more are compared, so a stray "zzzz" finds nothing rather than a guess.
 */
export function nearest<D extends SearchDoc>(
  index: SearchIndex<D>,
  query: string,
  limit = 3,
): D[] {
  const tokens = wordsOf(query).filter(
    (word) => !STOPWORDS.has(word) && word.length >= 4,
  );
  const distance = new Map<number, number>();
  for (const [word, postings] of index.vocabulary) {
    if (word.length < 4) continue;
    for (const token of tokens) {
      const d = editDistance(token, word, 2);
      if (d > 2 || d * 2 >= token.length) continue;
      for (const { entry, field } of postings) {
        if (field !== "name" && field !== "aliases" && field !== "keywords") {
          continue;
        }
        distance.set(entry, Math.min(distance.get(entry) ?? d, d));
      }
    }
  }
  return [...distance]
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([entry]) => index.entries[entry]!.doc);
}

/** The catalogue fields a tool document is built from. */
export interface SearchableTool {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly accept: readonly string[];
  readonly outputs: readonly string[];
}

export interface ToolDoc<T extends SearchableTool> extends SearchDoc {
  readonly kind: "tool";
  readonly tool: T;
}

/**
 * The catalogue as documents. Each tool's aliases are the tasks people name
 * it by ("Make a PDF smaller"), so what the site says a tool does is also
 * what finds it.
 */
export function toolDocs<T extends SearchableTool>(
  tools: readonly T[],
  tasks: readonly Task[] = TASKS,
): ToolDoc<T>[] {
  return tools.map((tool) => ({
    kind: "tool",
    id: tool.slug,
    name: tool.name,
    aliases: tasks
      .filter((task) => task.slug === tool.slug)
      .map((t) => t.label),
    keywords: tool.keywords,
    formats: [...tool.accept, ...tool.outputs],
    tagline: tool.tagline,
    description: tool.description,
    tool,
  }));
}
