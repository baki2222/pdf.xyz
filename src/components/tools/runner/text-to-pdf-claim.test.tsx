// @vitest-environment jsdom
/**
 * The Text to PDF "Formatted" tile, as a reader receives it, against the bytes
 * that decide which face sets the document.
 *
 * HISTORY. The tile read "Latin and Cyrillic text, arrows and box drawing are
 * set in a monospace face." Only the scripts came from the pack table; "arrows
 * and box drawing" was typed. Geist Mono draws 21 of the 112 arrows (not ⇒ ⇐
 * ⇔) and misses 202 Latin letters Noto Sans draws (the pinyin ǐ ǔ ǒ ǚ), so
 * "Step 1 ⇒ done" still embedded the 5.4 MB proportional Noto Sans JP — the
 * original defect, under copy promising the opposite. The test that "checked"
 * the scripts read the OCR sample sentences, which contain neither.
 *
 * So the sentence is read HERE, rendered, and every category word in it is
 * expanded to the whole category — derived from the Unicode Script property
 * or the Unicode block, never from the font — and each member must route to
 * the monospace pack. A category the face only half-draws cannot be named.
 * The previous sentence is kept below as the positive control: the checker
 * must find ⇒ and ǐ in it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { TextToPdfRunner } from "./text-to-pdf-runner";
import {
  FONT_PACKS,
  MONOSPACE_CLAIMS,
  UNSUPPORTED_SCRIPTS,
  type CodePointRange,
} from "@/lib/pdf/font-packs";
import {
  candidatePacks,
  loadCoverage,
  packCovers,
} from "@/lib/pdf/font-coverage";

afterEach(cleanup);

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

/** The sentence of the rendered tile that makes the monospace promise. */
function renderedMonospaceSentence(): string {
  const { container } = render(
    <AppRouterContext.Provider value={router as never}>
      <TextToPdfRunner />
    </AppRouterContext.Provider>,
  );
  const tiles = [...container.querySelectorAll("p")]
    .map((p) => p.textContent ?? "")
    .filter((text) => /monospace/i.test(text));
  expect(tiles, "no rendered paragraph mentions monospace").toHaveLength(1);
  const sentences = tiles[0]!
    .split(/(?<=\.)\s+/)
    .filter((sentence) => /monospace/i.test(sentence));
  expect(sentences).toHaveLength(1);
  return sentences[0]!;
}

const GRAPHIC = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Category words a reader takes as "all of it", and what "all of it" is.
 *
 * Script names are not typed: they are every script the pack table and the
 * refusal table can name, expanded by the Unicode Script property. Block words
 * are the few non-script categories a typography claim reaches for, each bound
 * to its Unicode block.
 */
function vocabulary(): { word: string; members: (cp: number) => boolean }[] {
  const scriptNames = new Set([
    ...FONT_PACKS.flatMap((pack) => pack.scripts),
    ...UNSUPPORTED_SCRIPTS.map((entry) => entry.name),
  ]);
  const words: { word: string; members: (cp: number) => boolean }[] = [];
  for (const name of scriptNames) {
    let property: RegExp;
    try {
      property = new RegExp(`\\p{Script=${name}}`, "u");
    } catch {
      continue; // "Kanji", "emoji": not a Script value, and matched below by block
    }
    words.push({
      word: name,
      members: (cp) => property.test(String.fromCodePoint(cp)),
    });
  }
  const blocks: [string, CodePointRange][] = [
    ["arrows?", [0x2190, 0x21ff]],
    ["box[- ]drawing", [0x2500, 0x257f]],
    ["block elements?|shading", [0x2580, 0x259f]],
    ["math(?:s|ematical)?|operators?", [0x2200, 0x22ff]],
    ["currency|currencies", [0x20a0, 0x20cf]],
    ["emoji|dingbats?", [0x2700, 0x27bf]],
  ];
  for (const [word, [lo, hi]] of blocks) {
    words.push({ word, members: (cp) => cp >= lo && cp <= hi });
  }
  return words;
}

/**
 * For each category word in `sentence`: the members of that category some
 * shipped face draws, and which of them would NOT be set in the monospace
 * face. Plus every literal non-ASCII character the sentence names.
 */
async function falseMonospaceClaims(
  sentence: string,
): Promise<{ named: string[]; failures: Record<string, string> }> {
  const coverage = await loadCoverage();
  const named: string[] = [];
  const failures: Record<string, string> = {};
  const routesMono = (cp: number) =>
    candidatePacks(coverage, String.fromCodePoint(cp), "mono")[0]?.role ===
    "monospace";
  for (const { word, members } of vocabulary()) {
    if (!new RegExp(`\\b(?:${word})\\b`, "iu").test(sentence)) continue;
    named.push(word);
    const drawable: number[] = [];
    for (let cp = 0x20; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (!members(cp) || !GRAPHIC.test(String.fromCodePoint(cp))) continue;
      if (!FONT_PACKS.some((pack) => packCovers(coverage, pack, cp))) continue;
      drawable.push(cp);
    }
    // A category no face draws at all is a false claim too, not a vacuous one.
    if (drawable.length === 0) {
      failures[word] = "(nothing in it is drawn by any shipped face)";
      continue;
    }
    const missed = drawable.filter((cp) => !routesMono(cp));
    if (missed.length > 0) {
      failures[word] =
        `${missed.length}/${drawable.length}: ` +
        missed.map((cp) => String.fromCodePoint(cp)).join("");
    }
  }
  const literal = [...sentence].filter(
    (ch) => ch.codePointAt(0)! > 0x7f && GRAPHIC.test(ch),
  );
  const missedLiteral = literal.filter((ch) => !routesMono(ch.codePointAt(0)!));
  if (missedLiteral.length > 0) failures["(named)"] = missedLiteral.join("");
  return { named, failures };
}

describe("the Text to PDF monospace tile", () => {
  it("names no category the monospace face only partly draws, and no character it does not", async () => {
    const sentence = renderedMonospaceSentence();
    const { failures } = await falseMonospaceClaims(sentence);
    expect(failures, `the tile says: "${sentence}"`).toEqual({});
  }, 30_000);

  it("shows the reader every claim the pack table makes, and only those", () => {
    // The sentence is built from MONOSPACE_CLAIMS, whose members are proved in
    // font-packs.test.ts and against the saved PDF in text-to-pdf.test.ts.
    // This is the seam: the reader sees exactly the table.
    const sentence = renderedMonospaceSentence();
    expect(MONOSPACE_CLAIMS.length).toBeGreaterThan(0);
    for (const claim of MONOSPACE_CLAIMS) {
      expect(sentence).toContain(claim.label);
    }
    let rest = sentence;
    for (const claim of MONOSPACE_CLAIMS) rest = rest.replace(claim.label, "");
    // What remains is connective text, not another claim.
    expect(rest.replace(/[\s,]+/g, " ").trim()).toBe(
      "text and are set in a monospace face.",
    );
  });

  it("finds ⇒ and ǐ behind the previous sentence (positive control)", async () => {
    const previous =
      "Latin and Cyrillic text, arrows and box drawing are set in a monospace face.";
    const { named, failures } = await falseMonospaceClaims(previous);
    // Health check: the vocabulary reaches the words that sentence used.
    expect(named).toEqual(
      expect.arrayContaining(["Latin", "Cyrillic", "arrows?"]),
    );
    expect(failures["arrows?"]).toContain("⇒");
    expect(failures["Latin"]).toContain("ǐ");
    expect(failures["Cyrillic"]).toBeDefined();
    // And the one category it got right stays right.
    expect(failures["box[- ]drawing"]).toBeUndefined();
  }, 30_000);
});
