// @vitest-environment node
/**
 * The retrieval eval (brief item 1, test b): a seeded corpus of questions
 * over long documents, each with ONE fact sentence on a known page. A case is
 * recalled when the fact sentence reaches the provider whole, for main (the
 * prefix, `joined.slice(0, maxChars)`) and for retrieval alike.
 *
 * It does three jobs:
 *  - never worse than main, per case on early lexical facts (class A) and in
 *    aggregate everywhere, strictly better on late facts (B) and follow-ups (F);
 *  - class C (an early fact asked in other words) by name: main's prefix
 *    recalls all of it, and retrieval once recalled 5 of 7 (0.71), because a
 *    page sharing ONE word of the paraphrase displaced the opening page that
 *    held the answer. The coverage gate (`CHAT_RETRIEVAL_MIN_COVERAGE`)
 *    closed that. C is held at or above main with its regressions listed by
 *    name, and a second sweep re-derives the gate and shows C falling without
 *    it;
 *  - the D1 sweep, which RE-DERIVES `CHAT_RETRIEVAL_ANCHOR_SHARE` from the
 *    corpus (argmax of overall recall, ties to the larger share) and refuses a
 *    sweep that cannot discriminate between shares;
 *  - a positive control: a selector that always returns main's prefix must
 *    score strictly lower on B, or this corpus cannot tell the two apart.
 *
 * The corpus is the instrument: an empty or shrunken corpus is FATAL, never a
 * vacuous pass (CLAUDE.md rule 4). Class D (late fact, paraphrased) is an
 * HONEST MISS for a lexical retriever and is measured, not asserted.
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_RETRIEVAL_ANCHOR_SHARE,
  CHAT_RETRIEVAL_ANCHOR_SHARES,
  CHAT_RETRIEVAL_MIN_COVERAGE,
  bm25Scores,
  prefixPagesFor,
  queryTermsFor,
  retrieveGrounding,
  type PageChunk,
  type RetrievedGrounding,
} from "./page-retrieval";
import { citedPagesIn } from "@/lib/jobs/chat-citations";

const SEP = "\n\n";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Klass = "A" | "B" | "C" | "D" | "E" | "F" | "G";
const CLASSES: readonly Klass[] = ["A", "B", "C", "D", "E", "F", "G"];
const CLASS_NAMES: Record<Klass, string> = {
  A: "early fact, lexical",
  B: "late fact, lexical",
  C: "early fact, paraphrased",
  D: "late fact, paraphrased (honest miss)",
  E: "distractor-heavy",
  F: "follow-up citing the fact page",
  G: "non-Latin",
};

type EvalCase = {
  name: string;
  klass: Klass;
  chunks: PageChunk[];
  fact: string;
  factPage: number;
  question: string;
  lastUserTurn?: string;
  seedPages: number[];
  maxChars: number;
};

/**
 * Filler: function words on every page (IDF 0 by D4) and synthetic content
 * words, so no query word lands on a page by accident. Every query word that
 * IS meant to land somewhere is planted explicitly below.
 */
const FUNCTION_WORDS = ["the", "of", "and", "to", "in", "a", "for", "on"];
const SYLLABLES = [
  "bra",
  "ke",
  "lo",
  "ten",
  "mur",
  "vi",
  "sa",
  "dor",
  "pel",
  "qui",
  "ran",
  "tu",
  "fo",
  "gle",
  "mi",
  "zar",
  "on",
  "hes",
  "ul",
  "cra",
];
const CONTENT_WORDS = Array.from({ length: 240 }, (_, i) => {
  const s = SYLLABLES;
  return `${s[i % 20]}${s[(i * 7 + 3) % 20]}${s[(i * 13 + 5) % 20]}`;
});

function fillerPage(next: () => number, chars: number): string[] {
  const words: string[] = [];
  let length = 0;
  while (length < chars) {
    const word =
      next() < 0.35
        ? FUNCTION_WORDS[Math.floor(next() * FUNCTION_WORDS.length)]!
        : CONTENT_WORDS[Math.floor(next() * CONTENT_WORDS.length)]!;
    words.push(word);
    length += word.length + 1;
  }
  return words;
}

/** Insert a sentence or word at a seeded position of a page's words. */
function plant(words: string[], next: () => number, text: string): void {
  words.splice(Math.floor(next() * words.length), 0, text);
}

type DocSpec = {
  seed: number;
  pages: number;
  factPage: number;
  fact: string;
  /**
   * Words planted on `count` random non-fact pages each (a count below 1 is
   * a share of the pages), `tf` times per page.
   */
  distractors?: { word: string; count: number; tf?: number }[];
  /** Pages carrying all `words` `tf` times: the high-scoring decoys of E. */
  hot?: { count: number; words: string[]; tf: number };
  blank?: number[];
  filler?: (next: () => number, chars: number) => string[];
};

function buildDocument(spec: DocSpec): PageChunk[] {
  const next = rng(spec.seed);
  const pages: string[][] = [];
  for (let page = 1; page <= spec.pages; page += 1)
    pages.push(
      (spec.filler ?? fillerPage)(next, 1000 + Math.floor(next() * 400)),
    );
  const others = () => {
    let page = spec.factPage;
    while (page === spec.factPage) page = 1 + Math.floor(next() * spec.pages);
    return page;
  };
  for (const { word, count, tf = 1 } of spec.distractors ?? [])
    for (let i = 0; i < (count < 1 ? count * spec.pages : count); i += 1) {
      const words = pages[others() - 1]!;
      for (let k = 0; k < tf; k += 1) plant(words, next, word);
    }
  if (spec.hot)
    for (let i = 0; i < spec.hot.count; i += 1) {
      const words = pages[others() - 1]!;
      for (const word of spec.hot.words)
        for (let k = 0; k < spec.hot.tf; k += 1) plant(words, next, word);
    }
  plant(pages[spec.factPage - 1]!, next, spec.fact);
  // A blank page is never the fact page: the fact must reach some page.
  const blank = (spec.blank ?? []).filter((page) => page !== spec.factPage);
  return pages.flatMap((words, i) =>
    blank.includes(i + 1)
      ? []
      : [{ pageNumber: i + 1, text: `[Page ${i + 1}]\n${words.join(" ")}` }],
  );
}

const CODE_WORDS = [
  "Zephyrine",
  "Halvorsen",
  "Quillfeather",
  "Marrowgate",
  "Tindalux",
  "Brackwater",
  "Corvantis",
  "Elmstrand",
  "Fennimore",
  "Glimmerholt",
];

const PARAPHRASES: { fact: string; question: string; words: string[] }[] = [
  {
    fact: "Ending the agreement before its term costs four thousand euros.",
    question: "What is the termination fee for cancellation?",
    words: ["termination", "fee", "cancellation"],
  },
  {
    fact: "Staff may work from home on two days each week.",
    question: "What is the remote working policy for employees?",
    words: ["remote", "working", "policy", "employees"],
  },
  {
    fact: "Invoices must be settled within thirty days of receipt.",
    question: "When is payment due on a bill?",
    words: ["payment", "due", "bill"],
  },
  {
    fact: "The tenant shall keep the premises in good repair.",
    question: "Who maintains the property condition?",
    words: ["maintains", "property", "condition"],
  },
  {
    fact: "Disputes go before the courts of Lyon.",
    question: "Which jurisdiction governs litigation?",
    words: ["jurisdiction", "governs", "litigation"],
  },
  {
    fact: "Goods travel at the buyer's risk once loaded.",
    question: "When does liability transfer for shipped merchandise?",
    words: ["liability", "transfer", "shipped", "merchandise"],
  },
  {
    fact: "The supplier guarantees parts for three years.",
    question: "What warranty covers components?",
    words: ["warranty", "covers", "components"],
  },
];

const E_TERMS: [string, string, string][] = [
  ["delivery", "penalty", "warehouse"],
  ["storage", "charge", "freezer"],
  ["audit", "fee", "quarterly"],
  ["insurance", "premium", "flood"],
  ["license", "royalty", "streaming"],
  ["shipping", "surcharge", "fuel"],
  ["maintenance", "credit", "elevator"],
  ["training", "cost", "onboarding"],
];

const NON_LATIN: {
  script: string;
  words: string[];
  plant: string;
  fact: (plant: string) => string;
  question: (plant: string) => string;
}[] = [
  {
    script: "Bengali",
    words:
      "এই চুক্তি পক্ষ শর্ত মেয়াদ অর্থ প্রদান সময় নথি অধিকার দায় সেবা পণ্য বাজার হিসাব কর্মী অফিস নিয়ম তথ্য বিভাগ".split(
        " ",
      ),
    plant: "নীলপদ্ম",
    fact: (p) => `${p} ধারা অনুযায়ী জরিমানা পাঁচ হাজার টাকা।`,
    question: (p) => `${p} ধারায় কী বলা আছে?`,
  },
  {
    script: "Japanese",
    words:
      "契約 当事者 条件 期間 金額 支払 時間 書類 権利 責任 業務 製品 市場 会計 社員 事務所 規則 情報 部門 報告".split(
        " ",
      ),
    plant: "桜島",
    fact: (p) => `${p}条項により違約金は五万円とする。`,
    question: (p) => `${p}条項には何が書かれていますか？`,
  },
  {
    script: "Thai",
    words:
      "สัญญา คู่สัญญา เงื่อนไข ระยะเวลา จำนวนเงิน การชำระ เวลา เอกสาร สิทธิ ความรับผิด บริการ สินค้า ตลาด บัญชี พนักงาน สำนักงาน กฎ ข้อมูล แผนก รายงาน".split(
        " ",
      ),
    plant: "มรกต",
    fact: (p) => `ข้อ${p} กำหนดค่าปรับห้าพันบาท`,
    question: (p) => `ข้อ${p} ว่าอย่างไร`,
  },
];

function scriptFiller(words: string[]) {
  return (next: () => number, chars: number) => {
    const out: string[] = [];
    let length = 0;
    while (length < chars) {
      const word = words[Math.floor(next() * words.length)]!;
      out.push(word);
      length += word.length + 1;
    }
    return out;
  };
}

/** The corpus, built from seeds so every case is reproducible by name. */
function buildCorpus(): EvalCase[] {
  const cases: EvalCase[] = [];
  const next = rng(20261116);
  const between = (lo: number, hi: number) =>
    lo + Math.floor(next() * (hi - lo + 1));
  const add = (
    klass: Klass,
    i: number,
    spec: DocSpec,
    question: string,
    extra: Partial<EvalCase> = {},
  ) => {
    cases.push({
      name: `${klass}${i + 1}`,
      klass,
      chunks: buildDocument(spec),
      fact: spec.fact,
      factPage: spec.factPage,
      question,
      seedPages: [],
      maxChars: between(6000, 10000),
      ...extra,
    });
  };

  // A: early fact, lexical. The code word is on the fact page only.
  for (let i = 0; i < 8; i += 1) {
    const code = CODE_WORDS[i % CODE_WORDS.length]!;
    add(
      "A",
      i,
      {
        seed: 100 + i,
        pages: between(40, 80),
        factPage: between(1, 3),
        fact: `The ${code} clause caps liability at ${between(2, 9)} million.`,
        ...(i % 3 === 0 ? { blank: [2] } : {}),
        // "clause" is common in a real contract: on about 30% of the pages
        // in half the cases. The other half match ONLY inside the prefix,
        // which is what the byte-identity check below needs to exercise.
        ...(i % 2 === 0
          ? { distractors: [{ word: "clause", count: 0.3 }] }
          : {}),
      },
      `What does the ${code} clause say?`,
    );
  }
  // B: late fact, lexical.
  for (let i = 0; i < 8; i += 1) {
    const code = CODE_WORDS[(i + 3) % CODE_WORDS.length]!;
    const pages = between(40, 80);
    add(
      "B",
      i,
      {
        seed: 200 + i,
        pages,
        factPage: between(20, pages),
        fact: `The ${code} clause caps liability at ${between(2, 9)} million.`,
        ...(i % 3 === 1 ? { blank: [5, 6, 7] } : {}),
        // "clause" on about 30% of the pages, and the defined term recurs on
        // a few other pages, sometimes more often than on the fact page, as
        // a defined term does in a real contract.
        distractors: [
          { word: "clause", count: 0.3 },
          ...(i % 2 === 0
            ? [{ word: code, count: between(1, 6), tf: between(1, 3) }]
            : []),
        ],
      },
      `What does the ${code} clause say?`,
    );
  }
  // C: early fact, paraphrased: the question's words are on other pages only.
  for (let i = 0; i < 7; i += 1) {
    const p = PARAPHRASES[i % PARAPHRASES.length]!;
    add(
      "C",
      i,
      {
        seed: 300 + i,
        pages: between(40, 80),
        factPage: between(1, 4),
        fact: p.fact,
        distractors: p.words.map((word) => ({ word, count: between(3, 9) })),
      },
      p.question,
    );
  }
  // D: late fact, paraphrased: an honest miss for a lexical retriever.
  for (let i = 0; i < 7; i += 1) {
    const p = PARAPHRASES[(i + 2) % PARAPHRASES.length]!;
    const pages = between(40, 80);
    add(
      "D",
      i,
      {
        seed: 400 + i,
        pages,
        factPage: between(20, pages),
        fact: p.fact,
        distractors: p.words.map((word) => ({ word, count: between(3, 9) })),
      },
      p.question,
    );
  }
  // E: distractor-heavy. The two question terms sit on many pages, a few
  // "hot" pages repeat both, and only the fact page adds the third term.
  for (let i = 0; i < 10; i += 1) {
    const [common, second, rare] = E_TERMS[i % E_TERMS.length]!;
    const pages = between(40, 80);
    const early = i % 3 === 0;
    add(
      "E",
      i,
      {
        seed: 500 + i,
        pages,
        factPage: early ? between(1, 3) : between(20, pages),
        fact: `The ${rare} ${common} ${second} is ${between(2, 9)} percent.`,
        distractors: [
          { word: common, count: Math.floor(pages * 0.4) },
          { word: second, count: Math.floor(pages * 0.3) },
          { word: rare, count: between(0, 2) },
        ],
        hot: { count: between(0, 6), words: [common, second], tf: 3 },
      },
      `What is the ${rare} ${common} ${second}?`,
    );
  }
  // F: follow-up "and the penalty?" after an answer that cited the fact page.
  for (let i = 0; i < 7; i += 1) {
    const pages = between(40, 80);
    const factPage = between(20, pages);
    const mentionsTerm = i % 2 === 0;
    add(
      "F",
      i,
      {
        seed: 600 + i,
        pages,
        factPage,
        fact: mentionsTerm
          ? `Late payment carries a penalty of ${between(2, 9)} percent a month.`
          : `Late payment adds ${between(2, 9)} percent a month to the balance.`,
        distractors: [{ word: "penalty", count: between(2, 8) }],
      },
      "and the penalty?",
      {
        lastUserTurn: "What are the payment terms in the schedule?",
        seedPages: citedPagesIn(
          `The schedule sets the payment terms [p.${factPage}].`,
          pages,
        ),
      },
    );
  }
  // G: non-Latin, a planted word late (and once early) in each script.
  for (let i = 0; i < 9; i += 1) {
    const script = NON_LATIN[i % NON_LATIN.length]!;
    const pages = between(40, 70);
    add(
      "G",
      i,
      {
        seed: 700 + i,
        pages,
        factPage: i < 3 ? between(1, 2) : between(20, pages),
        fact: script.fact(script.plant),
        filler: scriptFiller(script.words),
      },
      script.question(script.plant),
    );
  }
  return cases;
}

const CORPUS = buildCorpus();

function mainGrounding(c: EvalCase): string {
  return c.chunks
    .map((chunk) => chunk.text)
    .join(SEP)
    .slice(0, c.maxChars);
}

function run(
  c: EvalCase,
  options: {
    anchorShare?: number;
    minCoverage?: number;
    select?: typeof prefixOnly;
  } = {},
): RetrievedGrounding {
  return retrieveGrounding({
    chunks: c.chunks,
    separator: SEP,
    question: c.question,
    ...(c.lastUserTurn !== undefined ? { lastUserTurn: c.lastUserTurn } : {}),
    seedPages: c.seedPages,
    maxChars: c.maxChars,
    ...(options.anchorShare !== undefined
      ? { anchorShare: options.anchorShare }
      : {}),
    ...(options.minCoverage !== undefined
      ? { minCoverage: options.minCoverage }
      : {}),
    ...(options.select ? { select: options.select } : {}),
  });
}

/** The positive control's selector: always main's prefix. */
function prefixOnly(): { strategy: "prefix"; reason: "no-signal" } {
  return { strategy: "prefix", reason: "no-signal" };
}

const recalled = (c: EvalCase, grounding: string) => grounding.includes(c.fact);

type Recall = Record<Klass | "all", number>;
function recallOf(hit: (c: EvalCase) => boolean): Recall {
  const out = { all: 0 } as Recall;
  for (const k of CLASSES) {
    const members = CORPUS.filter((c) => c.klass === k);
    out[k] = members.filter(hit).length / members.length;
  }
  out.all = CORPUS.filter(hit).length / CORPUS.length;
  return out;
}

const MAIN = recallOf((c) => recalled(c, mainGrounding(c)));
const RETRIEVAL = recallOf((c) => recalled(c, run(c).grounding));

function table(rows: [string, Recall][]): string {
  const head = ["", ...CLASSES, "all"].map((x) => x.padStart(6)).join("");
  const body = rows.map(
    ([label, r]) =>
      label.padStart(6) +
      [...CLASSES, "all" as const]
        .map((k) => r[k].toFixed(2).padStart(6))
        .join(""),
  );
  return [head, ...body].join("\n");
}

describe("retrieval eval corpus", () => {
  it("HEALTH: is at least 40 cases, every class at least 6 (an empty corpus is fatal)", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(40);
    for (const k of CLASSES)
      expect(
        CORPUS.filter((c) => c.klass === k).length,
        `class ${k} (${CLASS_NAMES[k]})`,
      ).toBeGreaterThanOrEqual(6);
    // Every fact sentence is on exactly the page the case names, once.
    for (const c of CORPUS) {
      const holders = c.chunks.filter((chunk) => chunk.text.includes(c.fact));
      expect(
        holders.map((h) => h.pageNumber),
        c.name,
      ).toEqual([c.factPage]);
    }
    // Every case is over budget: the eval measures a choice, never a fit.
    for (const c of CORPUS)
      expect(
        c.chunks.map((chunk) => chunk.text).join(SEP).length,
        c.name,
      ).toBeGreaterThan(c.maxChars);
  });

  it("HEALTH: class A and C facts are in main's prefix, B, D and F facts are not", () => {
    for (const c of CORPUS) {
      const inPrefix = recalled(c, mainGrounding(c));
      if (c.klass === "A" || c.klass === "C")
        expect(inPrefix, c.name).toBe(true);
      if (c.klass === "B" || c.klass === "D" || c.klass === "F")
        expect(inPrefix, c.name).toBe(false);
    }
  });

  it("is never worse than main on class A, and byte-identical when every matching page is in the prefix", () => {
    const worse: string[] = [];
    const identical: string[] = [];
    for (const c of CORPUS.filter((x) => x.klass === "A")) {
      const result = run(c);
      if (recalled(c, mainGrounding(c)) && !recalled(c, result.grounding))
        worse.push(c.name);
      const prefixPages = prefixPagesFor(c.chunks, SEP, c.maxChars);
      const scores = bm25Scores(
        c.chunks,
        queryTermsFor(c.question, c.lastUserTurn),
      );
      const matching = [...scores].filter(([, s]) => s > 0).map(([p]) => p);
      if (
        matching.every((p) => prefixPages.has(p)) &&
        c.seedPages.every((p) => prefixPages.has(p))
      ) {
        identical.push(c.name);
        expect(result.strategy, c.name).toBe("prefix");
        expect(result.grounding, c.name).toBe(mainGrounding(c));
      }
    }
    expect(worse).toEqual([]);
    // HEALTH: the identity branch ran, or it certified nothing.
    expect(identical.length, identical.join(", ")).toBeGreaterThanOrEqual(3);
  });

  it("recalls at least as much as main on A, C, E, F, G and overall, and strictly more on B and F", () => {
    const regressionsIn = (k: Klass) =>
      CORPUS.filter(
        (c) =>
          c.klass === k &&
          recalled(c, mainGrounding(c)) &&
          !recalled(c, run(c).grounding),
      ).map((c) => c.name);
    const regressions = { C: regressionsIn("C"), E: regressionsIn("E") };
    const report = `\n${table([
      ["main", MAIN],
      ["ret", RETRIEVAL],
    ])}\nC-class regressions: ${regressions.C.join(", ") || "none"}\nE-class regressions: ${regressions.E.join(", ") || "none"}`;
    console.log(report);
    for (const k of ["A", "C", "E", "F", "G", "all"] as const)
      expect(RETRIEVAL[k], `${k}${report}`).toBeGreaterThanOrEqual(MAIN[k]);
    expect(RETRIEVAL.B, `B${report}`).toBeGreaterThan(MAIN.B);
    expect(RETRIEVAL.F, `F${report}`).toBeGreaterThan(MAIN.F);
    expect(regressions, report).toEqual({ C: [], E: [] });
    // HEALTH: main recalls every C case (early facts; the prefix health check
    // above holds it), so "C ≥ main" is the strongest bound there is, and a
    // single C case dropped is red here.
    expect(MAIN.C, report).toBe(1);
  });

  it("POSITIVE CONTROL: a prefix-only selector scores strictly lower on B", () => {
    const control = recallOf((c) =>
      recalled(c, run(c, { select: prefixOnly }).grounding),
    );
    // The control really is main: same grounding, case by case.
    for (const c of CORPUS)
      expect(run(c, { select: prefixOnly }).grounding, c.name).toBe(
        mainGrounding(c),
      );
    expect(control.B).toBeLessThan(RETRIEVAL.B);
  }, 30_000);

  it("D1 SWEEP re-derives CHAT_RETRIEVAL_ANCHOR_SHARE (argmax of overall recall, ties to the larger share)", () => {
    const rows = CHAT_RETRIEVAL_ANCHOR_SHARES.map(
      (share) =>
        [
          share,
          recallOf((c) =>
            recalled(c, run(c, { anchorShare: share }).grounding),
          ),
        ] as const,
    );
    const printed = `\nshare → recall per class\n${table(
      rows.map(([share, r]) => [share.toFixed(3), r]),
    )}`;
    // Printed on every run so the PR can paste it.
    console.log(printed);
    // HEALTH: the sweep must discriminate, or "set by measurement" is false
    // and the tie rule picks 1/2 with no data behind it.
    const distinct = new Set(rows.map(([, r]) => JSON.stringify(r)));
    expect(
      distinct.size,
      `sweep cannot discriminate; strengthen classes A/B${printed}`,
    ).toBeGreaterThan(1);
    let best = rows[0]!;
    for (const row of rows) if (row[1].all >= best[1].all) best = row;
    expect(CHAT_RETRIEVAL_ANCHOR_SHARE, printed).toBe(best[0]);
    // Five full retrievals of the corpus; the time tracks runner speed and
    // shows no trend. CI max 14,434 ms (44891504062, 11-21), 48% of the old
    // 30 s; 14,224 ms over the 21 runs of 11-16..11-18. 60 s is 4.2x, so the
    // headroom reporter warns at 30 s, before any red. Do not cut the grid:
    // the grid is the property.
  }, 60_000);

  it("COVERAGE SWEEP re-derives CHAT_RETRIEVAL_MIN_COVERAGE (the loosest gate with no class below main and the best overall recall)", () => {
    const grid = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1];
    expect(grid).toContain(CHAT_RETRIEVAL_MIN_COVERAGE);
    const rows = grid.map(
      (minCoverage) =>
        [
          minCoverage,
          recallOf((c) => recalled(c, run(c, { minCoverage }).grounding)),
        ] as const,
    );
    const printed = `\nmin coverage → recall per class\n${table([
      ...rows.map(([value, r]) => [value.toFixed(3), r] as [string, Recall]),
      ["main", MAIN],
    ])}`;
    // Printed on every run so the PR can paste it.
    console.log(printed);
    const neverWorse = (r: Recall) =>
      (["A", "C", "E", "F", "G", "all"] as const).every((k) => r[k] >= MAIN[k]);
    const eligible = rows.filter(([, r]) => neverWorse(r));
    expect(
      eligible.length,
      `no gate keeps every class at or above main${printed}`,
    ).toBeGreaterThan(0);
    const best = Math.max(...eligible.map(([, r]) => r.all));
    const loosest = eligible.find(([, r]) => r.all === best)![0];
    expect(CHAT_RETRIEVAL_MIN_COVERAGE, printed).toBe(loosest);
    // POSITIVE CONTROL: with the gate off (0: any matching page qualifies),
    // class C falls below main. The corpus can see the defect the gate closes.
    const off = rows.find(([value]) => value === 0)![1];
    expect(off.C, printed).toBeLessThan(MAIN.C);
    // And the gate is not "always send the prefix": fully shut (1), late
    // lexical facts are lost again.
    const shut = rows.find(([value]) => value === 1)![1];
    expect(shut.B, printed).toBeLessThan(RETRIEVAL.B);
    // Six full retrievals of the corpus; the time tracks runner speed and
    // shows no trend. CI max 18,319 ms (44891504062, 11-21), 61% of the old
    // 30 s; 17,138 ms over the 21 runs of 11-16..11-18. 70 s is 3.8x, so the
    // headroom reporter warns at 35 s, before any red. Do not cut the grid,
    // and do not call selectPages directly: that skips retrieveGrounding.
  }, 70_000);
});
