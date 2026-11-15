import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText, ExtractedTextPage } from "@/lib/pdf/text";
import type { AiProvider } from "@/lib/workers/ai/provider";
import { runChatWithPdf } from "@/lib/workers/chat-with-pdf/engine";
import { readAnswerFromPackage } from "@/lib/workers/chat-with-pdf-conversation";
import {
  citationSegments,
  citedPageIndex,
  citedPagesIn,
  type CitationSegment,
} from "./chat-citations";

/**
 * The citation grammar, both directions (CLAUDE.md rule 1): every marker the
 * product must turn into a page is caught, and every marker it must leave as
 * text is not. `pages` is what the worker counts into manifest.answer.citedPages
 * AND what the chat panel turns into a button, because both read this module.
 */
interface Row {
  marker: string;
  pageCount: number;
  pages: number[];
}

const MUST_CITE: Row[] = [
  { marker: "[p.4]", pageCount: 5, pages: [4] },
  { marker: "[p.3, p.5]", pageCount: 5, pages: [3, 5] },
  { marker: "[p.3, 5]", pageCount: 5, pages: [3, 5] },
  { marker: "[pp. 3-4]", pageCount: 5, pages: [3, 4] },
  { marker: "[pp. 3–4]", pageCount: 5, pages: [3, 4] },
  { marker: "[pp. 3—4]", pageCount: 5, pages: [3, 4] },
  { marker: "[P.2]", pageCount: 5, pages: [2] },
  { marker: "[p.2; p.3]", pageCount: 5, pages: [2, 3] },
  { marker: "[pp. 1-99999]", pageCount: 5, pages: [1, 2, 3, 4, 5] },
  { marker: "[p 4]", pageCount: 5, pages: [4] },
  { marker: "[p.5, p.3, 5]", pageCount: 5, pages: [3, 5] },
  { marker: "[p.2, 9]", pageCount: 3, pages: [2] },
];

const MUST_NOT_CITE: Row[] = [
  { marker: "[1]", pageCount: 5, pages: [] },
  { marker: "[see above]", pageCount: 5, pages: [] },
  { marker: "[Page 3]", pageCount: 5, pages: [] },
  { marker: "[p.]", pageCount: 5, pages: [] },
  { marker: "[p.0]", pageCount: 5, pages: [] },
  { marker: "[p.9]", pageCount: 3, pages: [] },
  { marker: "[pp. 5-3]", pageCount: 5, pages: [] },
  { marker: `[p.1, ${"x".repeat(80)}]`, pageCount: 5, pages: [] },
  { marker: "p.3", pageCount: 5, pages: [] },
  { marker: "(p.3)", pageCount: 5, pages: [] },
];

const CORPUS = [...MUST_CITE, ...MUST_NOT_CITE];

/**
 * Each branch of the grammar, and the row that exercises it. A branch no row
 * exercises could be deleted and nothing here would notice (rule 1, second
 * half); the assertions below check that every named row is in the corpus
 * AND cites, so a renamed or removed row cannot leave a branch silently bare.
 */
const BRANCHES: Record<string, string> = {
  "pp (double p)": "[pp. 3-4]",
  "single p": "[p.4]",
  "upper case": "[P.2]",
  "optional dot absent": "[p 4]",
  "item prefix (p. on a later item)": "[p.3, p.5]",
  "bare later item": "[p.3, 5]",
  "range, hyphen": "[pp. 3-4]",
  "range, en dash": "[pp. 3–4]",
  "range, em dash": "[pp. 3—4]",
  "range clamped to the page count": "[pp. 1-99999]",
  "separator, comma": "[p.3, 5]",
  "separator, semicolon": "[p.2; p.3]",
};

describe("citation grammar — the corpus, both directions", () => {
  it("health check: the corpus is not quietly shrinking", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(12);
    expect(MUST_CITE.length).toBeGreaterThanOrEqual(9);
    expect(MUST_NOT_CITE.length).toBeGreaterThanOrEqual(8);
  });

  it.each(CORPUS)("$marker on $pageCount pages → $pages", (row) => {
    expect(citedPagesIn(`See ${row.marker}.`, row.pageCount)).toEqual(
      row.pages,
    );
  });

  it("every must-cite row cites, every must-not-cite row does not (positive control)", () => {
    for (const row of MUST_CITE) expect(row.pages.length).toBeGreaterThan(0);
    for (const row of MUST_NOT_CITE) expect(row.pages).toEqual([]);
  });

  it.each(Object.entries(BRANCHES))(
    "branch %s is exercised by a citing row",
    (_branch, marker) => {
      const row = MUST_CITE.find((r) => r.marker === marker);
      expect(row, `no corpus row ${marker}`).toBeDefined();
      expect(citedPagesIn(marker, row!.pageCount).length).toBeGreaterThan(0);
    },
  );

  it("segments: a citing bracket is one cite, its text the whole bracket", () => {
    for (const row of CORPUS) {
      const answer = `Rent ${row.marker} due.`;
      const segments = citationSegments(answer, row.pageCount);
      expect(segments.map((s) => s.text).join("")).toBe(answer);
      const cites = segments.filter(
        (s): s is Extract<CitationSegment, { kind: "cite" }> =>
          s.kind === "cite",
      );
      if (row.pages.length === 0) expect(cites).toEqual([]);
      else
        expect(cites).toEqual([
          { kind: "cite", text: row.marker, pages: row.pages },
        ]);
    }
  });

  it("is safe to call twice: the global regex keeps no state between calls", () => {
    const answer = "A [p.1] and B [p.2].";
    expect(citedPagesIn(answer, 3)).toEqual([1, 2]);
    expect(citedPagesIn(answer, 3)).toEqual([1, 2]);
    expect(citationSegments(answer, 3)).toEqual(citationSegments(answer, 3));
  });

  it("citedPageIndex is the one 1-based → 0-based conversion", () => {
    expect(citedPageIndex(1)).toBe(0);
    expect(citedPageIndex(2)).toBe(1);
  });
});

/** Mulberry32: a seeded generator, so a failure names a reproducible string. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  "[",
  "]",
  "[[",
  "]]",
  "p",
  "pp",
  "P.",
  ".",
  " ",
  ",",
  ";",
  "-",
  "–",
  "—",
  "0",
  "1",
  "2",
  "3",
  "7",
  "12",
  "99999",
  "page",
  "পৃ",
  "é",
  "📄",
  "\n",
  "[p.2]",
  "[pp. 1-3]",
  "[p.3, 5]",
  "x",
];

describe("citation grammar — property: segments lose nothing and agree with citedPagesIn", () => {
  it("holds for 600 seeded strings with unbalanced brackets, nesting and unicode", () => {
    const next = rng(20261115);
    let cited = 0;
    for (let n = 0; n < 600; n++) {
      const length = 1 + Math.floor(next() * 24);
      let answer = "";
      for (let i = 0; i < length; i++)
        answer += PIECES[Math.floor(next() * PIECES.length)];
      const pageCount = 1 + Math.floor(next() * 6);
      const segments = citationSegments(answer, pageCount);
      expect(segments.map((s) => s.text).join(""), answer).toBe(answer);
      const union = new Set<number>();
      for (const s of segments) {
        if (s.kind !== "cite") continue;
        expect(s.pages.length).toBeGreaterThan(0);
        expect(s.pages).toEqual([...new Set(s.pages)].sort((a, b) => a - b));
        for (const p of s.pages) union.add(p);
      }
      const unionSorted = [...union].sort((a, b) => a - b);
      expect(unionSorted, answer).toEqual(citedPagesIn(answer, pageCount));
      if (unionSorted.length > 0) cited++;
    }
    // Health check: a generator that never produced a citation would make
    // the agreement above vacuous ([] equals []).
    expect(cited).toBeGreaterThan(100);
  });
});

describe("the composed chain: worker manifest → package answer → segments", () => {
  it("the panel's cite pages are exactly the manifest's citedPages, read from the SAME zip", async () => {
    const texts = ["one", "two", "three", "four", "five"];
    const pages: ExtractedTextPage[] = texts.map((text, i) => ({
      pageNumber: i + 1,
      text,
      characterCount: text.length,
    }));
    const joined = texts.join("\n\n");
    const extracted: ExtractedPdfText = {
      pageCount: texts.length,
      pages,
      text: joined,
      characterCount: joined.length,
      hasText: true,
    };
    const provider: AiProvider = {
      id: "anthropic",
      model: "claude-sonnet-5",
      async complete() {
        return {
          ok: true,
          text: "Rent is due [p.2]; repairs [p.3, 5] and [pp. 1-2].",
          model: "claude-sonnet-5",
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      },
    };
    const question = "When is rent due?";
    const run = await runChatWithPdf(
      new Uint8Array([1, 2, 3]),
      { question },
      {
        extract: vi.fn(async () => extracted),
        provider,
        now: () => "2026-11-15T00:00:00.000Z",
      },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    const answer = await readAnswerFromPackage(run.output, question);
    expect(answer).not.toBeNull();
    const union = new Set<number>();
    for (const s of citationSegments(answer!, extracted.pageCount))
      if (s.kind === "cite") for (const p of s.pages) union.add(p);
    // Positive control: the manifest is not empty, so equality is not [] = [].
    expect(manifest.answer.citedPages).toEqual([1, 2, 3, 5]);
    expect([...union].sort((a, b) => a - b)).toEqual(
      manifest.answer.citedPages,
    );
  });
});
