// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatPageSpans, pageSpans } from "./page-spans";
import {
  CHAT_RETRIEVAL_MAX_SPANS,
  CHAT_RETRIEVAL_MIN_COVERAGE,
  bm25Scores,
  prefixPagesFor,
  queryCoverage,
  retrieveGrounding,
  selectPages,
  tokenize,
  wordSegmenterAvailable,
  type PageChunk,
  type RetrievedGrounding,
} from "./page-retrieval";

const SEP = "\n\n";

/** A seeded PRNG (mulberry32), so every case is reproducible by its index. */
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

const FILLER =
  "alpha bravo cobalt delta ember fjord granite harbor island juniper kestrel lumen meadow nickel orchard pewter quarry russet saffron timber umber velvet willow xenon yarrow zinc".split(
    " ",
  );

function chunk(pageNumber: number, body: string): PageChunk {
  return { pageNumber, text: `[Page ${pageNumber}]\n${body}` };
}

/** `count` pages of seeded filler, `plants` adding words to given pages. */
function document(
  count: number,
  plants: Record<number, string> = {},
  seed = 1,
  words = 30,
): PageChunk[] {
  const next = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const page = i + 1;
    const body = Array.from(
      { length: words },
      () => FILLER[Math.floor(next() * FILLER.length)]!,
    );
    if (plants[page]) body.splice(words >> 1, 0, plants[page]!);
    return chunk(page, body.join(" "));
  });
}

function joinedLength(chunks: readonly PageChunk[]): number {
  return chunks.map((c) => c.text).join(SEP).length;
}

function markers(text: string): number[] {
  return [...text.matchAll(/\[Page (\d+)\]\n/g)].map((m) => Number(m[1]));
}

function expand(spans: readonly (readonly [number, number])[]): number[] {
  return spans.flatMap(([a, b]) =>
    Array.from({ length: b - a + 1 }, (_, i) => a + i),
  );
}

function withoutSegmenter<T>(run: () => T): T {
  const saved = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
  delete (Intl as { Segmenter?: unknown }).Segmenter;
  try {
    return run();
  } finally {
    if (saved) Object.defineProperty(Intl, "Segmenter", saved);
  }
}

describe("formatPageSpans (the page list's one author)", () => {
  it("merges consecutive page numbers with an en dash", () => {
    expect(formatPageSpans([58, 1, 2, 3, 17, 59, 60, 61, 2])).toEqual({
      spans: [
        [1, 3],
        [17, 17],
        [58, 61],
      ],
      text: "1–3, 17, 58–61",
    });
  });

  it("never merges across a page number that was not sent (a blank page)", () => {
    expect(pageSpans([3, 5])).toEqual([
      [3, 3],
      [5, 5],
    ]);
    expect(formatPageSpans([]).text).toBe("");
  });
});

describe("tokenize and bm25Scores", () => {
  it("has a full-ICU word segmenter here (health check for every test below)", () => {
    expect(wordSegmenterAvailable()).toBe(true);
    expect(tokenize("The Zephyrine CLAUSE")).toEqual([
      "the",
      "zephyrine",
      "clause",
    ]);
  });

  it("weighs a term on more than half the pages at 0, and below half above 0", () => {
    const half = (on: number) =>
      Array.from({ length: 100 }, (_, i) =>
        chunk(i + 1, i < on ? "common words here" : "other words here"),
      );
    const over = bm25Scores(half(51), ["common"]);
    expect([...over.values()].every((score) => score === 0)).toBe(true);
    const under = bm25Scores(half(49), ["common"]);
    expect(under.get(1)).toBeGreaterThan(0);
    expect(under.get(60)).toBe(0);
  });

  it("scores the page body, never the [Page N] marker (brief D4)", () => {
    const chunks = document(30);
    const scores = bm25Scores(
      chunks,
      tokenize("What is the 12-month penalty?"),
    );
    expect(scores.get(12)).toBe(0);
    expect([...scores.values()].every((score) => score === 0)).toBe(true);
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question: "What is the 12-month penalty?",
      seedPages: [],
      maxChars: 1200,
    });
    expect(result.strategy).toBe("prefix");
  });
});

describe("selectPages", () => {
  const maxChars = 2000;

  it("POSITIVE CONTROL: page 60 of 100 is selected for its planted term", () => {
    const chunks = document(100, { 60: "zqprobe" });
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question: "Where is the zqprobe clause?",
      seedPages: [],
      maxChars,
    });
    expect(result.strategy).toBe("relevance");
    if (result.strategy !== "relevance") return;
    expect(result.pages).toContain(60);
    expect(result.grounding).toContain("[Page 60]\n");
    expect(result.grounding).toContain("zqprobe");
    expect(result.grounding.length + result.listLength).toBeLessThanOrEqual(
      maxChars,
    );
  });

  it("NEGATIVE CONTROL: a question with no informative term stays on the prefix", () => {
    const chunks = document(100, { 60: "zqprobe" });
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question: "What is the governing currency?",
      seedPages: [],
      maxChars,
    });
    expect(result).toEqual({
      strategy: "prefix",
      reason: "no-signal",
      grounding: chunks
        .map((c) => c.text)
        .join(SEP)
        .slice(0, maxChars),
    });
  });

  it("stays on the prefix when the only matching page is inside the prefix window", () => {
    const chunks = document(100, { 2: "zqprobe" });
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question: "zqprobe?",
      seedPages: [],
      maxChars,
    });
    expect(result.strategy).toBe("prefix");
    expect(result.strategy === "prefix" && result.reason).toBe("contained");
  });

  it("counts coverage over INFORMATIVE terms only (absent or over-half terms count on neither side)", () => {
    const chunks = document(100, { 60: "zqone zqtwo", 70: "zqone" });
    // "alpha" is filler on most pages (IDF 0); "zqabsent" is on none. Two
    // informative terms remain: zqone and zqtwo.
    const coverage = queryCoverage(
      chunks,
      tokenize("alpha zqabsent zqone zqtwo"),
    );
    expect(coverage.get(60)).toBe(1);
    expect(coverage.get(70)).toBe(1 / 2);
    expect(coverage.get(5)).toBe(0);
  });

  it("stays on the prefix when every match carries too few of the question's words (a paraphrase's false positive)", () => {
    // Review finding: the answer is on page 2 in other words; three of the
    // question's words each recur on ONE later page. Without the gate the
    // selector left the prefix for those pages and could drop the opening
    // page main sends. Each carries 1 of 3 informative terms, ≤ 1/2.
    const chunks = document(100, {
      40: "termination",
      55: "fee",
      70: "cancellation",
    });
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question: "What is the termination fee for cancellation?",
      seedPages: [],
      maxChars,
    });
    expect(result).toEqual({
      strategy: "prefix",
      reason: "low-coverage",
      grounding: chunks
        .map((c) => c.text)
        .join(SEP)
        .slice(0, maxChars),
    });
    expect(CHAT_RETRIEVAL_MIN_COVERAGE).toBe(1 / 2);
    // POSITIVE CONTROL, same document: a page carrying two of the three
    // words is past the gate and is sent.
    const twoOfThree = document(100, {
      40: "termination",
      55: "fee",
      70: "cancellation termination",
    });
    const sent = retrieveGrounding({
      chunks: twoOfThree,
      separator: SEP,
      question: "What is the termination fee for cancellation?",
      seedPages: [],
      maxChars,
    });
    expect(sent.strategy === "relevance" && sent.pages).toContain(70);
    expect(sent.strategy === "relevance" && sent.pages).not.toContain(40);
  });

  it("a cited page needs no coverage: the follow-up seed is still sent", () => {
    const chunks = document(100, {
      40: "termination",
      55: "fee",
      70: "cancellation",
    });
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question: "What is the termination fee for cancellation?",
      seedPages: [80],
      maxChars,
    });
    expect(result.strategy === "relevance" && result.pages).toContain(80);
    expect(result.strategy === "relevance" && result.pages).not.toContain(40);
  });

  it("breaks score ties by the lower page number", () => {
    const pages = Array.from({ length: 100 }, (_, i) =>
      chunk(i + 1, `filler text number ${i % 7} ${"pad ".repeat(40)}`),
    );
    pages[39] = chunk(40, `tie zqtie ${"pad ".repeat(40)}`);
    pages[69] = chunk(70, `tie zqtie ${"pad ".repeat(40)}`);
    const one = pages[39]!.text.length;
    const result = selectPages({
      chunks: pages,
      question: "zqtie",
      seedPages: [],
      prefixPages: prefixPagesFor(pages, SEP, one),
      budget: one,
      separator: SEP,
      anchorShare: 0,
    });
    expect(result).toMatchObject({ strategy: "relevance", pages: [40] });
  });

  it("sends a page the previous answer cited, outside the prefix, with no shared term", () => {
    const chunks = document(80);
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question: "and the penalty?",
      seedPages: [71],
      maxChars,
    });
    expect(result.strategy === "relevance" && result.pages).toContain(71);
  });

  it.each([
    ["Latin", "The Zephyrine clause sets the fee.", "Zephyrine clause?"],
    ["Bengali", "নীলপদ্ম চুক্তির জরিমানা শর্ত", "নীলপদ্ম শর্ত কী?"],
    ["Japanese", "違約金は桜島条項に記載されています。", "桜島条項とは?"],
    ["Thai", "สัญญานี้มีค่าปรับมรกต", "มรกต คืออะไร"],
  ])("retrieves the planted page in %s", (_script, plant, question) => {
    const chunks = document(70, { 55: plant }, 7);
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question,
      seedPages: [],
      maxChars,
    });
    expect(result.strategy === "relevance" && result.pages).toContain(55);
    expect(result.grounding).toContain(plant);
  });

  it("cuts one page, the highest sent, when no candidate fits whole", () => {
    const chunks = document(40);
    chunks[34] = chunk(35, `zqcut ${"long ".repeat(800)}`);
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question: "zqcut",
      seedPages: [],
      maxChars,
    });
    expect(result.strategy).toBe("relevance");
    if (result.strategy !== "relevance") return;
    expect(result.cutPage).toBe(35);
    expect(result.cutPage).toBe(Math.max(...result.pages));
    expect(result.grounding.length + result.listLength).toBeLessThanOrEqual(
      maxChars,
    );
    expect(result.grounding.endsWith(chunks[34]!.text)).toBe(false);
  });

  it("never starts more than CHAT_RETRIEVAL_MAX_SPANS spans", () => {
    const chunks = Array.from({ length: 400 }, (_, i) =>
      chunk(
        i + 1,
        `${i % 2 === 1 && i > 20 ? "zqspan" : "plain"} ${"pad ".repeat(12)}`,
      ),
    );
    // The term is on fewer than half the pages, so every odd page past 20 scores.
    const result = retrieveGrounding({
      chunks,
      separator: SEP,
      question: "zqspan",
      seedPages: [],
      maxChars: 6000,
      // No anchor, so every page sent is a candidate and the cap is the limit.
      anchorShare: 0,
    });
    expect(result.strategy).toBe("relevance");
    if (result.strategy !== "relevance") return;
    // Without the cap there would be more spans than this: every scoring page
    // is its own span and they fit the budget many times over.
    expect(result.spans.length).toBeLessThanOrEqual(CHAT_RETRIEVAL_MAX_SPANS);
    expect(result.spans.length).toBeGreaterThanOrEqual(
      CHAT_RETRIEVAL_MAX_SPANS - 4,
    );
  });

  it("gives prefix when Intl.Segmenter is missing", () => {
    const chunks = document(100, { 60: "zqprobe" });
    const result = withoutSegmenter(() => {
      expect(wordSegmenterAvailable()).toBe(false);
      return retrieveGrounding({
        chunks,
        separator: SEP,
        question: "zqprobe",
        seedPages: [],
        maxChars,
      });
    });
    expect(result.strategy === "prefix" && result.reason).toBe("no-segmenter");
    // And the segmenter is back for every test after this one.
    expect(wordSegmenterAvailable()).toBe(true);
  });
});

describe("BUDGET PROPERTY over generated cases", () => {
  const UNICODE = [
    "চুক্তি",
    "জরিমানা",
    "契約",
    "条項",
    "ค่าปรับ",
    "naïve",
    "ﬁle",
  ];
  const CASES = 600;

  type Case = {
    chunks: PageChunk[];
    question: string;
    lastUserTurn?: string;
    seedPages: number[];
    maxChars: number;
    extra: number;
  };

  function generate(index: number): Case {
    const next = rng(1000 + index);
    const pick = <T>(list: readonly T[]) =>
      list[Math.floor(next() * list.length)]!;
    const count = 4 + Math.floor(next() * 60);
    const chunks: PageChunk[] = [];
    const plantPage = 1 + Math.floor(next() * count);
    for (let page = 1; page <= count; page += 1) {
      if (next() < 0.12 && page !== plantPage) continue; // a blank page
      const words = 3 + Math.floor(next() * 60);
      const body = Array.from({ length: words }, () =>
        next() < 0.1 ? pick(UNICODE) : pick(FILLER),
      );
      if (page === plantPage) body.push(`zqplant${index}`);
      chunks.push(chunk(page, body.join(next() < 0.1 ? "\n" : " ")));
    }
    const kind = Math.floor(next() * 5);
    const question =
      kind === 0 || kind === 1
        ? `Where is zqplant${index}?`
        : kind === 2
          ? "What is the governing currency?"
          : kind === 3
            ? `${pick(FILLER)} ${pick(UNICODE)} ${pick(FILLER)}?`
            : "and the penalty?";
    const seedPages =
      kind === 4
        ? Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
            Math.floor(next() * (count + 3)),
          )
        : [];
    const total = joinedLength(chunks);
    const maxChars = Math.max(1, Math.floor(total * (0.05 + next() * 0.75)));
    return {
      chunks,
      question,
      ...(next() < 0.3 ? { lastUserTurn: `Earlier: ${pick(FILLER)}` } : {}),
      seedPages,
      maxChars,
      extra: Math.floor(next() * 40),
    };
  }

  it("holds sent + L ≤ maxChars, real markers, ≤ 64 spans, and the exact prefix", () => {
    const counts = { whole: 0, prefix: 0, relevance: 0 };
    const failures: string[] = [];
    for (let index = 0; index < CASES; index += 1) {
      const c = generate(index);
      const listLength = (pages: readonly number[]) =>
        formatPageSpans(pages).text.length + c.extra;
      const result: RetrievedGrounding = retrieveGrounding({
        chunks: c.chunks,
        separator: SEP,
        question: c.question,
        ...(c.lastUserTurn !== undefined
          ? { lastUserTurn: c.lastUserTurn }
          : {}),
        seedPages: c.seedPages,
        maxChars: c.maxChars,
        listLength,
      });
      counts[result.strategy] += 1;
      const joined = c.chunks.map((x) => x.text).join(SEP);
      const fail = (why: string) => failures.push(`case ${index}: ${why}`);
      if (result.strategy === "whole") {
        if (result.grounding !== joined) fail("whole is not the joined text");
        continue;
      }
      if (result.strategy === "prefix") {
        if (result.grounding !== joined.slice(0, c.maxChars))
          fail("prefix is not slice(0, maxChars)");
        if (result.reason === "over-budget")
          fail("fell back over budget: the fixed point did not pay for L");
        continue;
      }
      const L = listLength(result.pages);
      if (result.listLength !== L) fail("listLength is not the list's length");
      if (result.grounding.length + L > c.maxChars)
        fail(`sent ${result.grounding.length} + L ${L} > ${c.maxChars}`);
      const sorted = [...new Set(result.pages)].sort((a, b) => a - b);
      if (JSON.stringify(sorted) !== JSON.stringify(result.pages))
        fail("pages not ascending and unique");
      const real = new Set(c.chunks.map((x) => x.pageNumber));
      if (!result.pages.every((p) => real.has(p)))
        fail("a page number that is not a real page");
      if (
        JSON.stringify(markers(result.grounding)) !==
        JSON.stringify(result.pages)
      )
        fail("the [Page N] markers are not the pages sent");
      if (JSON.stringify(expand(result.spans)) !== JSON.stringify(result.pages))
        fail("the expanded spans are not the pages sent");
      if (result.spans.length > CHAT_RETRIEVAL_MAX_SPANS) fail("> 64 spans");
      if (
        result.cutPage !== null &&
        result.cutPage !== Math.max(...result.pages)
      )
        fail("the cut page is not the highest page sent");
      for (const page of result.pages) {
        const text = c.chunks.find((x) => x.pageNumber === page)!.text;
        const sent =
          page === result.cutPage ? text.slice(0, result.cutLength!) : text;
        if (!result.grounding.includes(sent))
          fail(`page ${page} not byte-identical`);
      }
      const prefixPages = prefixPagesFor(c.chunks, SEP, c.maxChars);
      if (result.pages.every((p) => prefixPages.has(p)))
        fail("relevance added no page outside main's prefix");
    }
    console.log("budget property branches:", JSON.stringify(counts));
    // HEALTH: the corpus is big enough and exercises both branches.
    expect(
      counts.whole + counts.prefix + counts.relevance,
    ).toBeGreaterThanOrEqual(500);
    expect(
      counts.relevance / CASES,
      JSON.stringify(counts),
    ).toBeGreaterThanOrEqual(0.3);
    expect(
      counts.prefix / CASES,
      JSON.stringify(counts),
    ).toBeGreaterThanOrEqual(0.3);
    expect(failures.slice(0, 20)).toEqual([]);
  });
});
