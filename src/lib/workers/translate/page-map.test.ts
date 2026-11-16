// @vitest-environment node
/**
 * THE REPLY CORPUS for `readPageMarkers`: what a model may send back for a
 * marked chunk, with the verdict each reply must get.
 *
 * Rule 1, both directions. Every entry has an expected verdict, and every
 * injected marker must be caught by one of `PAGE_MARKER_PATTERNS` (no hole);
 * every pattern must be the first to catch some injected marker (no
 * decoration). And every entry asserts P5, no marker reaches a reader: no
 * /pdfxyz/i in the NFKC form of `text`, and `text` holds exactly the reply's
 * ink minus the injected markers (ink = the non-whitespace multiset), so
 * stripping removes the marker and nothing else.
 *
 * Non-ASCII characters are built from code points, never typed.
 */
import { describe, expect, it } from "vitest";
import { PAGE_JOIN } from "@/lib/pdf/text";
import { markerFor } from "./page-markers";
import {
  PAGE_MARKER_PATTERNS,
  markerLineId,
  readPageMarkers,
  type PageMarkerVerdict,
} from "./page-map";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const RLM = cp(0x200f);

const A = "The first page speaks of rivers.";
const B = "The second page speaks of hills.";
const C = "The third page speaks of the sea.";
const D = "A fourth paragraph the model added.";
const M = markerFor;
const J = PAGE_JOIN;

/** Full-width forms: U+FF1C/U+FF1E brackets, U+FF10.. digits, U+FF21.. letters. */
const fwLess = cp(0xff1c);
const fwMore = cp(0xff1e);
const fwDigit = (d: number): string => cp(0xff10 + d);
const fwWord = (word: string): string =>
  Array.from(word)
    .map((c) =>
      c === "_" ? cp(0xff3f) : cp(0xff21 + c.charCodeAt(0) - "A".charCodeAt(0)),
    )
    .join("");

interface Entry {
  readonly name: string;
  readonly pages: readonly number[];
  readonly reply: string;
  /** Every marker string the reply carries, exactly as it is removed. */
  readonly injected: readonly string[];
  readonly verdict: PageMarkerVerdict;
  /** The exact stripped text, where the entry pins it. */
  readonly text?: string;
  /** The pieces, for a verified entry. */
  readonly pieces?: readonly string[];
}

const fullWidthMarker2 = `${fwLess.repeat(3)}PDFXYZ_PAGE_${fwDigit(2)}${fwMore.repeat(3)}`;
const fullWidthInline2 = `${fwLess.repeat(3)}${fwWord("PDFXYZ_PAGE_")}${fwDigit(2)}${fwMore.repeat(3)}`;
const translatedWord = `<<<PDFXYZ_P${cp(0xc1)}GINA_2>>>`;
const arabicIndic2 = `<<<PDFXYZ_PAGE_${cp(0x0662)}>>>`;
const devanagari2 = `<<<PDFXYZ_PAGE_${cp(0x0968)}>>>`;
const cjk2 = `<<<PDFXYZ_PAGE_${cp(0x4e8c)}>>>`;

const CORPUS: readonly Entry[] = [
  {
    name: "exact",
    pages: [1, 2, 3],
    reply: `${A}${J}${M(2)}${J}${B}${J}${M(3)}${J}${C}`,
    injected: [M(2), M(3)],
    verdict: "verified",
    text: [A, B, C].join(J),
    pieces: [A, B, C],
  },
  {
    name: "exact, real page numbers (not indices)",
    pages: [4, 7, 9],
    reply: `${A}${J}${M(7)}${J}${B}${J}${M(9)}${J}${C}`,
    injected: [M(7), M(9)],
    verdict: "verified",
    pieces: [A, B, C],
  },
  {
    name: "exact, three-digit page",
    pages: [99, 100],
    reply: `${A}${J}${M(100)}${J}${B}`,
    injected: [M(100)],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "one marker dropped",
    pages: [1, 2, 3],
    reply: `${A}${J}${B}${J}${M(3)}${J}${C}`,
    injected: [M(3)],
    verdict: "missing",
    text: [A, B, C].join(J),
  },
  {
    name: "all dropped",
    pages: [1, 2, 3],
    reply: `\n${A}${J}${B}\n${C}\n\n`,
    injected: [],
    verdict: "missing",
    text: `${A}${J}${B}\n${C}`,
  },
  {
    name: "duplicated",
    pages: [1, 2, 3],
    reply: `${A}${J}${M(2)}${J}${B}${J}${M(2)}${J}${C}`,
    injected: [M(2), M(2)],
    verdict: "order",
    text: [A, B, C].join(J),
  },
  {
    name: "swapped",
    pages: [1, 2, 3],
    reply: `${A}${J}${M(3)}${J}${B}${J}${M(2)}${J}${C}`,
    injected: [M(3), M(2)],
    verdict: "order",
    text: [A, B, C].join(J),
  },
  {
    name: "an extra page-1 marker",
    pages: [1, 2, 3],
    reply: `${M(1)}${J}${A}${J}${M(2)}${J}${B}${J}${M(3)}${J}${C}`,
    injected: [M(1), M(2), M(3)],
    verdict: "order",
    text: [A, B, C].join(J),
  },
  {
    name: "inline, glued to a sentence",
    pages: [1, 2],
    reply: `${A}${M(2)} ${B}`,
    injected: [M(2)],
    verdict: "missing",
    // Every word on that line survives.
    text: `${A} ${B}`,
  },
  {
    name: "**bold** marker",
    pages: [1, 2],
    reply: `${A}${J}**${M(2)}**${J}${B}`,
    injected: [`**${M(2)}**`],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "`code` marker",
    pages: [1, 2],
    reply: `${A}${J}\`${M(2)}\`${J}${B}`,
    injected: [`\`${M(2)}\``],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "lower case with inner spaces",
    pages: [1, 2],
    reply: `${A}${J}<<< pdfxyz_page_2 >>>${J}${B}`,
    injected: ["<<< pdfxyz_page_2 >>>"],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "full-width brackets and digits (NFKC)",
    pages: [1, 2],
    reply: `${A}${J}${fullWidthMarker2}${J}${B}`,
    injected: [fullWidthMarker2],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "RLM-wrapped",
    pages: [1, 2],
    reply: `${A}${J}${RLM}${M(2)}${RLM}${J}${B}`,
    injected: [`${RLM}${M(2)}${RLM}`],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "translated word, PAGINA (token stripped)",
    pages: [1, 2],
    reply: `${A}${J}${translatedWord}${J}${B}`,
    injected: [translatedWord],
    verdict: "missing",
    text: [A, B].join(J),
  },
  {
    name: "merged pages: a marker followed by nothing",
    pages: [1, 2, 3],
    reply: `${A}${J}${M(2)}${J}${B} ${C}${J}${M(3)}\n`,
    injected: [M(2), M(3)],
    verdict: "empty",
    text: [A, `${B} ${C}`].join(J),
  },
  {
    name: "markers only, no translation (the engine's unanswered)",
    pages: [1, 2, 3],
    reply: `${M(2)}${J}${M(3)}`,
    injected: [M(2), M(3)],
    verdict: "empty",
    text: "",
  },
  {
    name: "complete marker lines plus one extra inline copy",
    pages: [1, 2, 3],
    reply: `${A}${J}${M(2)}${J}${B}${J}${M(3)}${J}${C} ${M(3)} ${D}`,
    injected: [M(2), M(3), M(3)],
    verdict: "order",
    text: [A, B, `${C} ${D}`].join(J),
  },
  {
    name: "heading-wrapped, ## marker",
    pages: [1, 2],
    reply: `${A}${J}## ${M(2)}${J}${B}`,
    injected: [`## ${M(2)}`],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "quote-prefixed, > marker",
    pages: [1, 2],
    reply: `${A}${J}> ${M(2)}${J}${B}`,
    injected: [`> ${M(2)}`],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "bullet-prefixed, - marker",
    pages: [1, 2],
    reply: `${A}${J}- ${M(2)}${J}${B}`,
    injected: [`- ${M(2)}`],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "brackets dropped, bare PDFXYZ_PAGE_2 on its own line",
    pages: [1, 2],
    reply: `${A}${J}PDFXYZ_PAGE_2${J}${B}`,
    injected: ["PDFXYZ_PAGE_2"],
    verdict: "missing",
    text: [A, B].join(J),
  },
  {
    name: "full-width marker glued inline in a sentence",
    pages: [1, 2],
    reply: `${A}${fullWidthInline2} ${B}`,
    injected: [fullWidthInline2],
    verdict: "missing",
    text: `${A} ${B}`,
  },
  {
    name: "Arabic-Indic digit, id 2",
    pages: [1, 2],
    reply: `${A}${J}${arabicIndic2}${J}${B}`,
    injected: [arabicIndic2],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "Devanagari digit, id 2",
    pages: [1, 2],
    reply: `${A}${J}${devanagari2}${J}${B}`,
    injected: [devanagari2],
    verdict: "verified",
    pieces: [A, B],
  },
  {
    name: "CJK numeral is not a digit (stripped)",
    pages: [1, 2],
    reply: `${A}${J}${cjk2}${J}${B}`,
    injected: [cjk2],
    verdict: "missing",
    text: [A, B].join(J),
  },
  {
    name: "marker between single newlines (the one whitespace edit)",
    pages: [1, 2],
    reply: `${A}\n${M(2)}\n${B}`,
    injected: [M(2)],
    verdict: "verified",
    text: [A, B].join(J),
    pieces: [A, B],
  },
  {
    name: "CRLF line endings",
    pages: [1, 2],
    reply: `${A}\r\n\r\n${M(2)}\r\n\r\n${B}`,
    injected: [M(2)],
    verdict: "verified",
    pieces: [A, B],
  },
];

// FATAL: a corpus that quietly shrinks reports the strongest possible pass.
if (CORPUS.length < 21) {
  throw new Error(`the reply corpus holds ${CORPUS.length} entries, below 21`);
}

/** The non-whitespace multiset, as a sorted string. */
const ink = (s: string): string =>
  Array.from(s.replace(/\s+/gu, "")).sort().join("");

function withoutInjected(entry: Entry): string {
  let rest = entry.reply;
  for (const token of entry.injected) {
    const at = rest.indexOf(token);
    if (at < 0)
      throw new Error(`${entry.name}: "${token}" is not in its reply`);
    rest = rest.slice(0, at) + rest.slice(at + token.length);
  }
  return rest;
}

/** The pattern that catches the line holding `token`: the first that matches. */
function catcher(entry: Entry, token: string): string | null {
  const line = entry.reply.split("\n").find((l) => l.includes(token));
  if (line === undefined) return null;
  return PAGE_MARKER_PATTERNS.find((p) => p.matches(line))?.name ?? null;
}

describe("readPageMarkers — the reply corpus", () => {
  it(`health: the corpus holds at least 21 entries and every verdict`, () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(21);
    const verdicts = new Set(CORPUS.map((e) => e.verdict));
    expect([...verdicts].sort()).toEqual(
      ["empty", "missing", "order", "verified"].sort(),
    );
  });

  for (const entry of CORPUS) {
    it(`${entry.name}: ${entry.verdict}`, () => {
      const reading = readPageMarkers(entry.reply, entry.pages);
      expect(reading.verdict, entry.name).toBe(entry.verdict);
      if (entry.text !== undefined) expect(reading.text).toBe(entry.text);
      if (entry.verdict === "verified") {
        expect(reading.pieces?.map((p) => p.page)).toEqual([...entry.pages]);
        if (entry.pieces)
          expect(reading.pieces?.map((p) => p.text)).toEqual([...entry.pieces]);
        expect(reading.text).toBe(reading.pieces!.map((p) => p.text).join(J));
      } else {
        expect(reading.pieces, "pieces only when verified").toBeUndefined();
      }
      // P5: no marker reaches a reader, in the reader's normal form...
      expect(reading.text.normalize("NFKC")).not.toMatch(/pdfxyz/i);
      // ...and stripping removed exactly the marker ink, nothing else.
      expect(ink(reading.text), `${entry.name}: ink`).toBe(
        ink(withoutInjected(entry)),
      );
    });
  }

  it("no hole: every injected marker is caught by a pattern", () => {
    let tokens = 0;
    for (const entry of CORPUS) {
      for (const token of entry.injected) {
        tokens += 1;
        expect(catcher(entry, token), `${entry.name}: "${token}"`).not.toBe(
          null,
        );
      }
    }
    expect(tokens).toBeGreaterThanOrEqual(30);
  });

  it("no decoration: every pattern is the first to catch some injected marker", () => {
    const caught = new Map<string, string[]>();
    for (const entry of CORPUS) {
      for (const token of entry.injected) {
        const name = catcher(entry, token);
        if (name) caught.set(name, [...(caught.get(name) ?? []), entry.name]);
      }
    }
    for (const pattern of PAGE_MARKER_PATTERNS) {
      expect(
        caught.get(pattern.name) ?? [],
        `${pattern.name} catches nothing the patterns before it miss`,
      ).not.toHaveLength(0);
    }
    expect(PAGE_MARKER_PATTERNS.length).toBeGreaterThanOrEqual(2);
  });

  it("a reply with no marker token at all is reply.trim(), byte for byte", () => {
    for (const reply of [
      `  ${A}${J}${B}  \n`,
      `${A}\n\n\n${B}`,
      "",
      `${A}\t${B}\r\n`,
    ]) {
      expect(readPageMarkers(reply, [1, 2]).text).toBe(reply.trim());
    }
  });

  it("markerLineId reads the id by value, and refuses a line that is not a marker", () => {
    expect(markerLineId(M(12))).toBe(12);
    expect(markerLineId(`<<<PDFXYZ_PAGE_${cp(0x0661, 0x0662)}>>>`)).toBe(12);
    expect(markerLineId("<<<PDFXYZ_PAGE_02>>>")).toBe(2);
    expect(markerLineId(`see ${M(2)}`)).toBeNull();
    expect(markerLineId(translatedWord)).toBeNull();
    expect(markerLineId("PDFXYZ_PAGE_2")).toBeNull();
    expect(markerLineId(cjk2)).toBeNull();
  });
});
