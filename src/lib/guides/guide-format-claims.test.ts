// @vitest-environment node
/**
 * WHAT A GUIDE SAYS A TOOL TAKES IS WHAT THE TOOL TAKES.
 *
 * PR #236 widened JPG to PDF and PNG to PDF to PNG, WebP, GIF and BMP. The
 * catalogue's `accept` moved, the tool FAQs moved, and
 * `image-to-pdf-accept.test.ts` holds `accept` to the real gate — but the JPG
 * to PDF GUIDE kept saying "The tool accepts JPG and JPEG files" and sent PNG
 * users to another tool ("For PNGs … use the PNG to PDF tool"), and every
 * test stayed green until a human read it (PR #241). Guide prose about which
 * FILES go in was held to nothing.
 *
 * ── THE PROSE SIDE: discovered, after evaluation ────────────────────────────
 *
 * Every string anywhere in every `Guide` value (walked, not listed by field),
 * after the catalogue's templates run, split into sentences. Tool NAMES are
 * masked first, longest first — "JPG to PDF" names a tool, not a format — and
 * each masked name is kept as the tool it names, for attribution.
 *
 * A FORMAT is a word in a vocabulary DERIVED, never typed: the union of every
 * tool's `accept` labels and `UNSUPPORTED_FORMATS` (the formats the site says
 * no tool opens). It must be written as a format is written in prose — not
 * all lower-case ("JPG", "WebP", "Markdown"), or as an extension (".docx") —
 * so the English "doc" and "md" in a keyword list are not claims. A plural
 * ("PNGs") is its format. Formats joined by commas, "and", "or", articles and
 * file nouns ("JPG and JPEG files, and PNG") form one LIST.
 *
 * A list is a CLAIM when it stands in one of these shapes. The shapes were
 * worked out against the 39 guides that existed on 2026-10-31, and EVERY
 * trigger word and every rule must catch at least one real sentence (CLAUDE.md
 * rule 1, both directions — a trigger nothing exercises is decoration):
 *
 *  - `takes`:    an accept verb, up to three words, then the list ("accepts
 *                JPG and JPEG files", "Accepted inputs are PDF, JPG, and PNG",
 *                "takes an Excel workbook or a CSV file").
 *  - `pick`:     an imperative that hands the tool a file, up to three
 *                LOWER-CASE words, then the list ("Pick the JPG or JPEG
 *                photos", "drop one .html or .htm file"). A capital-led word
 *                ends it: after a pick verb that is a control ("choose One PDF
 *                per image (ZIP)", "choose Searchable PDF"), not a file.
 *  - `subject`:  the list, up to three words, then a passive accept ("WebP,
 *                GIF, and BMP files are taken").
 *  - `refused`:  the list, up to three words, then a refusal ("HEIC, TIFF,
 *                and AVIF images are not taken", "such as .odt, .rtf or
 *                .pages, are turned away").
 *  - `alongside`: "alongside" then the list — the tool takes those too.
 *  - `redirect`: a sentence that OPENS on the formats — "For [a] LIST" or
 *                "If your NOUN is/are [a] LIST" — and then names ANOTHER tool
 *                ("For an HTML file on your computer …, HTML to PDF renders
 *                it"). It sends the reader elsewhere for those formats: the
 *                named tool must take them, and the tool the guide teaches
 *                must NOT (its `accept`) — the #236 "For PNGs … use the PNG
 *                to PDF tool" shape. "If your PDF is a scan" is a condition
 *                on a PDF, not a format sent elsewhere, so it is not one.
 *
 * A claim is about the tool named nearest before its trigger in the sentence,
 * else the guide's primary tool (`tools[0]`).
 *
 * The corpus is the live guides PLUS `SHIPPED_DEFECTS`: the format claims
 * that shipped and went false, verbatim. Every one must fail today, and a
 * trigger may be exercised by one of them when no live guide still says it
 * that way (the "If your …" redirect is only in the history now).
 *
 * ── THE TOOL SIDE: derived ──────────────────────────────────────────────────
 *
 * A tool has one or more INPUTS: its catalogue `accept` (the "In:" row, which
 * `image-to-pdf-accept.test.ts`, `formats.test.ts` and `mime-by-format.test.ts`
 * hold to the real gates), and every literal `accept="…"` file picker in the
 * modules its page panel loads (`ownPanelModules` → value-import closure) —
 * the image a watermark or an edit stamps, which is not the document the tool
 * takes. Each picker entry is read through `formatOf`, the one function that
 * decides what a file is. `image/*` (the camera) names no format and is
 * dropped. The closure is a module graph and over-approximates (CLAUDE.md
 * rule 4): a picker in a module loaded but never rendered counts — permissive.
 *
 * ── THE VERDICT ─────────────────────────────────────────────────────────────
 *
 *  - Every format a takes/pick/subject/alongside claim names is in one input.
 *  - A list of TWO OR MORE words is an enumeration — it says what goes in —
 *    so its formats must EQUAL one input's, not a subset: "accepts JPG and
 *    JPEG files" names one format of JPG to PDF's five. Unless the list is
 *    ADDITIVE: followed by "too" / "as well" / "alongside", which says there
 *    is more.
 *  - A refused format is in no input.
 *  - A redirect's formats are in the named tool's inputs and in none of the
 *    primary's.
 *
 * WHAT THIS DOES NOT SEE, said plainly: a claim in a shape not listed above
 * (the corpus print, `GUIDE_FORMAT_CLAIMS_PRINT=1`, shows what is and is not
 * extracted); a single format said to be the ONLY one ("accepts only JPG" —
 * no guide says "only", so no rule may claim to catch it); a format named in
 * words rather than its label ("an Excel workbook"). The floors below are what
 * say the extractor still sees the corpus.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { guides } from "./catalog";
import type { Guide } from "./types";
import {
  UNSUPPORTED_FORMATS,
  formatOf,
  type FileFormat,
} from "@/lib/intent/formats";
import { normalizeFormatLabel } from "@/lib/jobs/mime-by-format";
import { tools } from "@/lib/tools";
import {
  ownPanelModules,
  parsedSource,
  rel,
  valueClosure,
} from "@/tests/tool-panel-modules";

/* ------------------------------------------------------------------ *
 *  The vocabulary
 * ------------------------------------------------------------------ */

/** Upper-case spelling → canonical format (JPEG → JPG, HTM → HTML). */
const VOCABULARY: ReadonlyMap<string, string> = new Map(
  [...tools.flatMap((t) => t.accept), ...UNSUPPORTED_FORMATS].map((label) => [
    label.toUpperCase(),
    normalizeFormatLabel(label),
  ]),
);

/* ------------------------------------------------------------------ *
 *  The tool side
 * ------------------------------------------------------------------ */

interface Input {
  /** Where it was read: `accept` or `file:line`. */
  from: string;
  formats: ReadonlySet<string>;
}

const canon = (labels: readonly string[]): Set<string> =>
  new Set(labels.map(normalizeFormatLabel));

/** One literal `accept="…"` value as formats, or null if any entry is not one. */
function pickerFormats(value: string): Set<string> | null {
  const out = new Set<string>();
  for (const entry of value.split(",").map((s) => s.trim())) {
    if (!entry) continue;
    const verdict: FileFormat | null = entry.startsWith(".")
      ? formatOf({ name: `a${entry}` }).format
      : formatOf({ name: "a", type: entry }).format;
    if (verdict === null) return null;
    out.add(verdict);
  }
  return out.size > 0 ? out : null;
}

const { bySlug } = ownPanelModules();

/** Every literal file picker in the modules `slug`'s panel loads. */
function pickersOf(slug: string): Input[] {
  const panel = bySlug.get(slug);
  if (!panel) return [];
  const out: Input[] = [];
  for (const file of valueClosure(panel.file)) {
    if (!file.endsWith(".tsx")) continue;
    const sf = parsedSource(file);
    const visit = (n: ts.Node): void => {
      if (
        ts.isJsxAttribute(n) &&
        n.name.getText(sf) === "accept" &&
        n.initializer &&
        ts.isStringLiteral(n.initializer)
      ) {
        const formats = pickerFormats(n.initializer.text);
        if (formats) {
          const line =
            sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          out.push({ from: `${rel(file)}:${line}`, formats });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

type InputsOf = (slug: string) => readonly Input[];

const inputsCache = new Map<string, Input[]>();
/** The real inputs: `accept`, then each picker that is not the same set. */
const realInputsOf: InputsOf = (slug) => {
  let hit = inputsCache.get(slug);
  if (!hit) {
    const tool = tools.find((t) => t.slug === slug);
    if (!tool) throw new Error(`no tool "${slug}"`);
    hit = [{ from: "accept", formats: canon(tool.accept) }];
    // A panel several pages mount carries each page's document picker: the
    // HTML file box in html-render-worker-panel.tsx renders on HTML to PDF
    // only (`mode === "html"`), never on Webpage to PDF. A picker that is
    // exactly a SIBLING's `accept` is that sibling's document, not a second
    // input here — counting it would let "Webpage to PDF takes .html" pass
    // (CLAUDE.md rule 4: widening the set is a defect too).
    const siblings = (bySlug.get(slug)?.slugs ?? [])
      .filter((s) => s !== slug)
      .map((s) => canon(tools.find((t) => t.slug === s)!.accept));
    for (const p of pickersOf(slug))
      if (
        !hit.some((i) => sameSet(i.formats, p.formats)) &&
        !siblings.some((a) => sameSet(a, p.formats))
      )
        hit.push(p);
    inputsCache.set(slug, hit);
  }
  return hit;
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));
const subset = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  [...a].every((x) => b.has(x));

/* ------------------------------------------------------------------ *
 *  The prose side
 * ------------------------------------------------------------------ */

interface ProseString {
  at: string;
  text: string;
}

/** Every string in a guide value, wherever it sits. */
function proseStrings(guide: Guide): ProseString[] {
  const out: ProseString[] = [];
  const walk = (value: unknown, at: string): void => {
    if (typeof value === "string") out.push({ at, text: value });
    else if (Array.isArray(value))
      value.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value))
        walk(v, at ? `${at}.${k}` : k);
  };
  walk(guide, "");
  return out;
}

const sentencesOf = (text: string): string[] =>
  text.split(/(?<=[.!?])\s+(?=[\p{Lu}“"])/u);

type Token =
  | { kind: "word"; text: string; dotted: boolean }
  | { kind: "tool"; slug: string }
  | { kind: "punct"; text: string };

/** Tool names, longest first, so "PDF to Word" wins over a shorter name. */
const TOOL_NAMES = [...tools]
  .map((t) => ({ name: t.name, slug: t.slug }))
  .sort((a, b) => b.name.length - a.name.length);

function tokenize(sentence: string): Token[] {
  // Mask tool names with a private-use marker carrying the tool's index.
  let masked = sentence;
  TOOL_NAMES.forEach(({ name }, i) => {
    masked = masked.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "gu"),
      ` \u{E000}${i}\u{E001} `,
    );
  });
  const out: Token[] = [];
  const re =
    /\u{E000}(\d+)\u{E001}|(\.?)([\p{L}\p{N}][\p{L}\p{N}'’-]*)|([^\s\p{L}\p{N}])/gu;
  for (const m of masked.matchAll(re)) {
    if (m[1] !== undefined)
      out.push({ kind: "tool", slug: TOOL_NAMES[Number(m[1])]!.slug });
    else if (m[3] !== undefined) {
      // A sentence-final "." before a word cannot occur; a "." glued to a
      // word is an extension (".docx").
      if (m[2]) out.push({ kind: "punct", text: "." });
      out.push({ kind: "word", text: m[3], dotted: m[2] === "." });
    } else out.push({ kind: "punct", text: m[4]! });
  }
  // An extension's "." was pushed as punctuation AND flagged on the word;
  // drop the punctuation copy so ".docx or .doc" stays one list.
  return out.filter(
    (t, i) =>
      !(
        t.kind === "punct" &&
        t.text === "." &&
        out[i + 1]?.kind === "word" &&
        (out[i + 1] as { dotted: boolean }).dotted
      ),
  );
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The canonical format a token names, or null. */
function formatOf_(t: Token | undefined): string | null {
  if (!t || t.kind !== "word") return null;
  // Written as a format is written: not all lower-case, or as an extension.
  if (!t.dotted && t.text === t.text.toLowerCase()) return null;
  const upper = t.text.toUpperCase();
  const hit = VOCABULARY.get(upper);
  if (hit) return hit;
  // A plural: "PNGs", "JPEGs".
  if (/s$/.test(t.text) && !/S$/.test(t.text))
    return VOCABULARY.get(upper.slice(0, -1)) ?? null;
  return null;
}

const lower = (t: Token | undefined): string =>
  t?.kind === "word" ? t.text.toLowerCase() : "";

/** Words that may sit between two formats of one list. */
const LIST_GLUE = new Set([",", "and", "or", "a", "an", "the"]);
/** File nouns: "JPG and JPEG files, and PNG". */
const FILE_NOUNS = new Set([
  "file",
  "files",
  "image",
  "images",
  "photo",
  "photos",
  "picture",
  "pictures",
]);

interface List {
  start: number;
  /** Index after the last format. */
  end: number;
  /** The words as written. */
  words: string[];
  formats: Set<string>;
}

/** The list that starts at `i` (a format token), or null. */
function listAt(tokens: Token[], i: number): List | null {
  const first = formatOf_(tokens[i]);
  if (!first) return null;
  const words = [(tokens[i] as { text: string }).text];
  const formats = new Set([first]);
  let end = i + 1;
  for (;;) {
    let j = end;
    let joined = false;
    while (
      j < end + 3 &&
      (LIST_GLUE.has(punctOrLower(tokens[j])) ||
        FILE_NOUNS.has(lower(tokens[j])))
    ) {
      const g = punctOrLower(tokens[j]);
      if (g === "," || g === "and" || g === "or") joined = true;
      j++;
    }
    const next = formatOf_(tokens[j]);
    if (!joined || !next) break;
    words.push((tokens[j] as { text: string }).text);
    formats.add(next);
    end = j + 1;
  }
  return { start: i, end, words, formats };
}

const punctOrLower = (t: Token | undefined): string =>
  t?.kind === "punct" ? t.text : lower(t);

/* ------------------------------------------------------------------ *
 *  The claim shapes
 * ------------------------------------------------------------------ */

/** Accept verbs, each a word sequence ending at the list's window. */
const TAKES = [
  ["accepts"],
  ["takes"],
  ["inputs", "are"],
  ["input", "is"],
] as const;
/** Imperatives that hand the tool a file. */
const PICKS = ["pick", "add", "drop", "drag", "choose", "upload"] as const;
/** Passive accepts after the list. */
const SUBJECT = [["are", "taken"]] as const;
/** Refusals after the list. */
const REFUSED = [
  ["are", "not", "taken"],
  ["are", "turned", "away"],
] as const;
/** Markers that say the list is not everything. */
const ADDITIVE = [["too"], ["as", "well"], ["alongside"]] as const;
const REDIRECT_OPENERS = ["for", "if your"] as const;
const ARTICLES = new Set(["a", "an", "the"]);

type Rule = "takes" | "pick" | "subject" | "refused" | "alongside" | "redirect";

interface Claim {
  rule: Rule;
  /** The trigger word(s) that made it a claim. */
  trigger: string;
  list: List;
  additive: string | null;
  /** The tool it is about. */
  tool: string;
  /** For a redirect: the tool the reader is sent AWAY from. */
  from?: string;
}

const seqAt = (tokens: Token[], i: number, seq: readonly string[]): boolean =>
  seq.every((w, k) => punctOrLower(tokens[i + k]) === w);

/** The tool named nearest before `i`, else the guide's primary. */
function toolBefore(tokens: Token[], i: number, primary: string): string {
  for (let k = i; k >= 0; k--) {
    const t = tokens[k]!;
    if (t.kind === "tool") return t.slug;
  }
  return primary;
}

/** After `list`, the additive marker that follows it (past file nouns). */
function additiveAfter(tokens: Token[], list: List): string | null {
  let j = list.end;
  while (FILE_NOUNS.has(lower(tokens[j]))) j++;
  // "are taken alongside": the passive sits between.
  for (const seq of SUBJECT) if (seqAt(tokens, j, seq)) j += seq.length;
  for (const seq of ADDITIVE) if (seqAt(tokens, j, seq)) return seq.join(" ");
  return null;
}

function claimsIn(sentence: string, primary: string): Claim[] {
  const tokens = tokenize(sentence);
  const out: Claim[] = [];
  const taken = new Set<number>();
  let insideUntil = 0;
  const push = (
    rule: Rule,
    trigger: string,
    list: List,
    at: number,
    extra?: Partial<Claim>,
  ) => {
    if (taken.has(list.start)) return;
    taken.add(list.start);
    out.push({
      rule,
      trigger,
      list,
      additive: additiveAfter(tokens, list),
      tool: toolBefore(tokens, at, primary),
      ...extra,
    });
  };
  /** The first list within `window` tokens after `j`, words only between. */
  const listWithin = (
    j: number,
    window: number,
    lowerOnly: boolean,
  ): List | null => {
    for (let k = j; k <= j + window; k++) {
      const list = listAt(tokens, k);
      if (list) return list;
      const t = tokens[k];
      if (!t || t.kind !== "word") return null;
      if (lowerOnly && /^\p{Lu}/u.test(t.text)) return null;
    }
    return null;
  };

  for (let i = 0; i < tokens.length; i++) {
    for (const seq of TAKES)
      if (seqAt(tokens, i, seq)) {
        const list = listWithin(i + seq.length, 3, false);
        if (list) push("takes", seq.join(" "), list, i);
      }
    for (const verb of PICKS)
      if (lower(tokens[i]) === verb) {
        const list = listWithin(i + 1, 3, true);
        if (list) push("pick", verb, list, i);
      }
    if (lower(tokens[i]) === "alongside") {
      const list = listAt(tokens, i + 1);
      // What follows "alongside" is in addition, by the word itself.
      if (list)
        push("alongside", "alongside", list, i, { additive: "alongside" });
    }
    // A list is read once, from its first format: "TIFF, and AVIF" inside
    // "HEIC, TIFF, and AVIF" is not a second list.
    const list = i >= insideUntil ? listAt(tokens, i) : null;
    if (list) {
      insideUntil = list.end;
      // The list, up to three words (or a comma), then a passive: "such as
      // .odt, .rtf or .pages, are turned away".
      for (let j = list.end; j <= list.end + 3; j++) {
        for (const seq of REFUSED)
          if (seqAt(tokens, j, seq)) push("refused", seq.join(" "), list, i);
        for (const seq of SUBJECT)
          if (seqAt(tokens, j, seq)) push("subject", seq.join(" "), list, i);
        const t = tokens[j];
        if (t?.kind === "punct" && t.text !== ",") break;
      }
    }
  }

  // A redirect: the sentence OPENS on the formats, then names another tool.
  //   "For" [article] LIST …            "For PNGs — … — use the PNG to PDF tool"
  //   "If your" NOUN "is"|"are" LIST …  "If your images are PNGs — … — use …"
  // The list must be what the opener is ABOUT: "If your PDF is a scan" is a
  // condition on a PDF (run OCR first), and "For plain notes without any
  // Markdown" is about notes — neither sends a FORMAT elsewhere.
  let at: number | null = null;
  let opener = "";
  if (lower(tokens[0]) === "for") {
    opener = "for";
    at = ARTICLES.has(lower(tokens[1])) ? 2 : 1;
  } else if (
    lower(tokens[0]) === "if" &&
    lower(tokens[1]) === "your" &&
    tokens[2]?.kind === "word" &&
    (lower(tokens[3]) === "is" || lower(tokens[3]) === "are")
  ) {
    opener = "if your";
    at = ARTICLES.has(lower(tokens[4])) ? 5 : 4;
  }
  const list = at === null ? null : listAt(tokens, at);
  if (list && !taken.has(list.start)) {
    const named = tokens
      .slice(list.end)
      .find((t) => t.kind === "tool" && t.slug !== primary);
    if (named?.kind === "tool") {
      taken.add(list.start);
      out.push({
        rule: "redirect",
        trigger: opener,
        list,
        additive: null,
        tool: named.slug,
        from: primary,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  The verdict
 * ------------------------------------------------------------------ */

interface Finding {
  guide: string;
  at: string;
  claim: Claim;
  sentence: string;
  problem: string | null;
}

function verdict(claim: Claim, inputsOf: InputsOf): string | null {
  const names = [...claim.list.formats].join(", ");
  const inputs = inputsOf(claim.tool);
  const show = (xs: readonly Input[]) =>
    xs.map((i) => `${i.from}={${[...i.formats].join(",")}}`).join(" | ");
  if (claim.rule === "refused") {
    const taken = [...claim.list.formats].filter((f) =>
      inputs.some((i) => i.formats.has(f)),
    );
    return taken.length
      ? `${claim.tool} is said to refuse ${taken.join(", ")}, which it takes (${show(inputs)})`
      : null;
  }
  if (claim.rule === "redirect") {
    if (!inputs.some((i) => subset(claim.list.formats, i.formats)))
      return `the reader is sent to ${claim.tool} for ${names}, which it does not take (${show(inputs)})`;
    // The FROM side is the document the guide's tool takes — its `accept`,
    // not a picker: a redirect sends the reader away for the file itself.
    // (Webpage to PDF's panel also renders HTML to PDF's file picker; that
    // is the shared module, not a second input of the page.)
    const own = inputsOf(claim.from!).filter((i) => i.from === "accept");
    const alsoOwn = [...claim.list.formats].filter((f) =>
      own.some((i) => i.formats.has(f)),
    );
    return alsoOwn.length
      ? `the reader is sent from ${claim.from} to ${claim.tool} for ${alsoOwn.join(", ")}, which ${claim.from} takes itself (${show(own)})`
      : null;
  }
  if (!inputs.some((i) => subset(claim.list.formats, i.formats)))
    return `${claim.tool} is said to take ${names}, outside every input (${show(inputs)})`;
  const enumeration = claim.list.words.length >= 2 && !claim.additive;
  if (
    enumeration &&
    !inputs.some((i) => sameSet(claim.list.formats, i.formats))
  )
    return `"${claim.list.words.join(" / ")}" reads as the whole list, but ${claim.tool} takes more (${show(inputs)})`;
  return null;
}

function audit(list: readonly Guide[], inputsOf: InputsOf = realInputsOf) {
  const findings: Finding[] = [];
  let sentencesWithFormats = 0;
  const byRule = new Map<string, number>();
  const byTrigger = new Map<string, number>();
  const byAdditive = new Map<string, number>();
  for (const guide of list) {
    const primary = guide.tools[0]!;
    for (const { at, text } of proseStrings(guide)) {
      for (const sentence of sentencesOf(text)) {
        const tokens = tokenize(sentence);
        if (tokens.some((t) => formatOf_(t))) sentencesWithFormats++;
        for (const claim of claimsIn(sentence, primary)) {
          byRule.set(claim.rule, (byRule.get(claim.rule) ?? 0) + 1);
          const tk = `${claim.rule}:${claim.trigger}`;
          byTrigger.set(tk, (byTrigger.get(tk) ?? 0) + 1);
          if (claim.additive)
            byAdditive.set(
              claim.additive,
              (byAdditive.get(claim.additive) ?? 0) + 1,
            );
          findings.push({
            guide: guide.slug,
            at,
            claim,
            sentence,
            problem: verdict(claim, inputsOf),
          });
        }
      }
    }
  }
  return {
    findings,
    problems: findings.filter((f) => f.problem),
    sentencesWithFormats,
    byRule,
    byTrigger,
    byAdditive,
  };
}

const show = (f: Finding) =>
  `${f.guide} ${f.at} [${f.claim.rule}:${f.claim.trigger}${f.claim.additive ? `+${f.claim.additive}` : ""}] ${f.claim.tool} {${f.claim.list.words.join(" ")}}${f.problem ? `\n    ✗ ${f.problem}` : ""}\n    “${f.sentence}”`;

/* ------------------------------------------------------------------ *
 *  The guard
 * ------------------------------------------------------------------ */

/** A guide made of the given sentences, on `slug`'s guide. */
function only(slug: string, steps: string[]): Guide {
  const guide = guides.find((g) => g.slug === slug)!;
  return {
    ...guide,
    title: "",
    description: "",
    keywords: [],
    steps,
    intro: [],
    sections: [],
    faq: [],
  };
}

/**
 * Sentences the product SHIPPED with a format claim that had gone false,
 * verbatim, with where they shipped. They are corpus as much as the live
 * guides are (CLAUDE.md rule 1: "every sentence the product has shipped"):
 * every one must be caught, and a trigger may be exercised by one of these
 * when no live guide still says it that way.
 */
const SHIPPED_DEFECTS: readonly {
  guide: string;
  sentence: string;
  shipped: string;
}[] = [
  {
    guide: "how-to-convert-jpg-to-pdf",
    sentence: "The tool accepts JPG and JPEG files and produces a PDF.",
    shipped: "506e8d0d, sections; false from #236 until #241",
  },
  {
    guide: "how-to-convert-jpg-to-pdf",
    sentence: "This tool accepts JPG and JPEG files.",
    shipped: "506e8d0d, faq; false from #236 until #241",
  },
  {
    guide: "how-to-convert-jpg-to-pdf",
    sentence:
      "For PNGs — including transparent ones — use the PNG to PDF tool, which assembles a single PDF in your browser the same way.",
    shipped: "506e8d0d, faq; false from #236 until #241",
  },
  {
    guide: "how-to-convert-jpg-to-pdf",
    sentence:
      "If your images are PNGs — transparent ones included — use the PNG to PDF tool, which also builds a single PDF right in your browser.",
    shipped: "506e8d0d, sections; false from #236, still live on b20c4d7c",
  },
  {
    guide: "how-to-convert-jpg-to-pdf",
    sentence:
      "Pick the JPG or JPEG photos you want in the PDF — they stay on your device the whole time.",
    shipped: "506e8d0d, steps; false from #236, still live on b20c4d7c",
  },
];

const defectGuides = (): Guide[] =>
  SHIPPED_DEFECTS.map((d) => only(d.guide, [d.sentence]));

describe("what a guide says a tool takes is what the tool takes", () => {
  const result = audit(guides);
  const shipped = audit(defectGuides());

  it("health: the corpus is plausibly large, and every rule, trigger and marker catches a real sentence", () => {
    // Recorded 2026-10-31 on 39 guides (see the PR for the full print).
    const counts = (m: Map<string, number>) =>
      [...m].map(([r, n]) => `${r}=${n}`).join(", ");
    console.log(
      [
        `guide-format-claims: ${result.findings.length} claims in ${result.sentencesWithFormats} sentences naming a format, across ${guides.length} guides (+${shipped.findings.length} from ${SHIPPED_DEFECTS.length} shipped defects)`,
        `  by rule: ${counts(result.byRule)}`,
        `  by trigger: ${counts(result.byTrigger)}`,
        `  additive: ${counts(result.byAdditive)}`,
        `  shipped defects by trigger: ${counts(shipped.byTrigger)}`,
      ].join("\n"),
    );
    if (process.env.GUIDE_FORMAT_CLAIMS_PRINT)
      console.log(result.findings.map(show).join("\n"));
    expect(guides.length).toBeGreaterThanOrEqual(39);
    expect(
      result.sentencesWithFormats,
      "implausibly few sentences name a format — is the vocabulary or the tokenizer broken?",
    ).toBeGreaterThanOrEqual(150);
    expect(
      result.findings.length,
      "implausibly few claims extracted — is the extractor broken?",
    ).toBeGreaterThanOrEqual(40);
    // Rule 1, the second direction: nothing here is decoration.
    const rules: Rule[] = [
      "takes",
      "pick",
      "subject",
      "refused",
      "alongside",
      "redirect",
    ];
    const hits = (m: (r: typeof result) => Map<string, number>, k: string) =>
      (m(result).get(k) ?? 0) + (m(shipped).get(k) ?? 0);
    for (const rule of rules)
      expect(
        hits((r) => r.byRule, rule),
        `rule ${rule}`,
      ).toBeGreaterThan(0);
    const triggers = [
      ...TAKES.map((s) => `takes:${s.join(" ")}`),
      ...PICKS.map((v) => `pick:${v}`),
      ...SUBJECT.map((s) => `subject:${s.join(" ")}`),
      ...REFUSED.map((s) => `refused:${s.join(" ")}`),
      "alongside:alongside",
      ...REDIRECT_OPENERS.map((o) => `redirect:${o}`),
    ];
    expect(
      triggers.filter((t) => hits((r) => r.byTrigger, t) === 0),
      "triggers no real sentence exercises",
    ).toEqual([]);
    expect(
      ADDITIVE.map((s) => s.join(" ")).filter(
        (m) => hits((r) => r.byAdditive, m) === 0,
      ),
      "additive markers no real sentence exercises",
    ).toEqual([]);
  });

  it("health: the vocabulary is derived and both sides of the gate are in it", () => {
    for (const f of ["JPG", "JPEG", "PNG", "WEBP", "DOCX", "HTM", "HEIC"])
      expect(VOCABULARY.has(f), f).toBe(true);
    expect(VOCABULARY.get("JPEG")).toBe("JPG");
    expect(VOCABULARY.size).toBeGreaterThanOrEqual(25);
  });

  it("health: picker inputs are read from the panels, not typed", () => {
    // The watermark image, the editor's image stamp — inputs that are not
    // the document. If these vanish the reader cannot see a picker at all.
    for (const slug of ["watermark-pdf", "edit-pdf"]) {
      const pickers = realInputsOf(slug).filter((i) => i.from !== "accept");
      expect(
        pickers.map((p) => [...p.formats].sort().join(",")),
        slug,
      ).toContain("JPG,PNG");
    }
    // And a tool whose only picker is its accept adds nothing.
    expect(realInputsOf("jpg-to-pdf").map((i) => i.from)).toEqual(["accept"]);
    // Nor does a sibling's document picker in a shared panel — while the
    // raw walk DOES see it (so the rule above is what removes it).
    expect(pickersOf("webpage-to-pdf").length).toBeGreaterThan(0);
    expect(realInputsOf("webpage-to-pdf").map((i) => i.from)).toEqual([
      "accept",
    ]);
  });

  it("every format claim in every guide matches what its tool takes", () => {
    expect(result.problems.map(show)).toEqual([]);
  });

  it("positive control: every shipped defect fails against today's inputs", () => {
    expect(shipped.problems.map((p) => p.sentence)).toEqual(
      SHIPPED_DEFECTS.map((d) => d.sentence),
    );
    // The brief's sentence: the tool named, not "the tool".
    expect(
      audit([
        only("how-to-convert-jpg-to-pdf", [
          "JPG to PDF accepts JPG and JPEG files.",
        ]),
      ]).problems.map((p) => p.problem),
    ).toEqual([
      expect.stringContaining('"JPG / JPEG" reads as the whole list'),
    ]);
  });

  it("positive control: the shipped FIX fails against the accept #236 replaced", () => {
    // The other direction of the same relationship: today's prose, the old
    // accept. The guard reads `accept`, not the words.
    const oldAccept: InputsOf = (slug) =>
      slug === "jpg-to-pdf"
        ? [{ from: "accept", formats: canon(["JPG", "JPEG"]) }]
        : realInputsOf(slug);
    const jpg = guides.find((g) => g.slug === "how-to-convert-jpg-to-pdf")!;
    expect(audit([jpg]).problems).toEqual([]);
    expect(audit([jpg], oldAccept).problems.length).toBeGreaterThan(0);
  });

  it("positive control: each verdict fires", () => {
    const p = (slug: string, s: string) =>
      audit([only(slug, [s])]).problems.map((f) => f.claim.rule);
    // A format outside every input.
    expect(
      p("how-to-convert-word-to-pdf", "Word to PDF takes .docx and .odt."),
    ).toEqual(["takes"]);
    // A refused format the tool takes.
    expect(
      p(
        "how-to-convert-webp-gif-or-bmp-to-pdf",
        "PNG, HEIC and AVIF images are not taken.",
      ),
    ).toEqual(["refused"]);
    // An enumeration narrower than the input, after a pick verb.
    expect(
      p("how-to-convert-jpg-to-pdf", "Pick the JPG or PNG photos you want."),
    ).toEqual(["pick"]);
    // A sibling's picker in the shared panel is not this page's input.
    expect(
      p("how-to-convert-a-webpage-to-pdf", "Webpage to PDF takes .html files."),
    ).toEqual(["takes"]);
    // A redirect to a tool that does not take the format.
    expect(
      p(
        "how-to-convert-a-webpage-to-pdf",
        "For an HTML file, use Word to PDF.",
      ),
    ).toEqual(["redirect"]);
  });

  it("negative control: true sentences pass, through the same audit", () => {
    const { problems, findings } = audit([
      only("how-to-convert-jpg-to-pdf", [
        "The tool accepts JPG and JPEG files, and PNG, WebP, GIF, and BMP images as well, and produces a PDF.",
        "JPG to PDF takes PNG images too.",
        "Under Output, keep One PDF, or choose One PDF per image (ZIP) to get several PDFs.",
        "HEIC, TIFF, and AVIF images are not taken.",
      ]),
      only("how-to-add-a-watermark-to-a-pdf", [
        "A picture mark takes a PNG or a JPEG, such as your logo.",
      ]),
    ]);
    expect(problems.map(show)).toEqual([]);
    // Extracted, not skipped: a pass must be a pass, not a blind spot. The
    // "choose One PDF" sentence is a control, so it yields nothing.
    expect(findings.map((f) => f.claim.rule)).toEqual([
      "takes",
      "takes",
      "refused",
      "takes",
    ]);
  });
});

describe("the tokenizer and the list, on sentences the guides shipped", () => {
  const lists = (s: string) =>
    claimsIn(s, "jpg-to-pdf").map((c) => [
      c.rule,
      c.tool,
      c.list.words.join(" "),
    ]);
  it("masks tool names and reads extensions and plurals", () => {
    expect(lists("Word to PDF takes .docx and .doc.")).toEqual([
      ["takes", "word-to-pdf", "docx doc"],
    ]);
    expect(
      lists(
        "Excel to PDF takes Excel workbooks and CSV files, and PowerPoint to PDF takes .pptx and .ppt.",
      ),
    ).toEqual([
      ["takes", "excel-to-pdf", "CSV"],
      ["takes", "powerpoint-to-pdf", "pptx ppt"],
    ]);
    expect(lists("For PNGs, use the PNG to PDF tool.")).toEqual([
      ["redirect", "png-to-pdf", "PNGs"],
    ]);
    // Lower-case words are English, not formats: keyword lists say nothing.
    expect(lists("pick a doc to pdf")).toEqual([]);
  });
});
