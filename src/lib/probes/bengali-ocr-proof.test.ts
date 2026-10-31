import { describe, expect, it } from "vitest";
import {
  BENGALI_CLEAN_MIN,
  BENGALI_NOISY_MIN,
  BENGALI_PROOF_SENTENCES,
  BENGALI_PROOF_TEXT,
  WRONG_LANGUAGE_MAX,
  bengaliAccuracy,
  bengaliVerdict,
  degradeScan,
  editDistance,
  wrongLanguageVerdict,
} from "./bengali-ocr-proof";
import { bengaliProofHtml } from "@/tests/bengali-ocr-fixtures";

describe("bengaliAccuracy", () => {
  it("scores the truth itself 100%, however it is broken into lines", () => {
    const relined = BENGALI_PROOF_SENTENCES.join(" ").replace(/ /g, "\n");
    expect(bengaliAccuracy(relined)).toMatchObject({ chars: 1, words: 1 });
  });

  it("treats the precomposed nukta letters as their NFC decomposition", () => {
    // ড় U+09DC and য় U+09DF are composition exclusions: NFC writes them as
    // the base letter + nukta, which is how a reader may hand them back.
    const precomposed = BENGALI_PROOF_TEXT.normalize("NFC")
      .replace(/ড়/g, "ড়")
      .replace(/য়/g, "য়");
    expect(precomposed).not.toBe(BENGALI_PROOF_TEXT.normalize("NFC"));
    expect(bengaliAccuracy(precomposed).chars).toBe(1);
  });

  it("counts a misread conjunct as ONE grapheme edit, not one per code point", () => {
    const truth = "সংক্ষিপ্ত";
    // ক্ষি (4 code points: ক ্ ষ ি) misread as কি.
    const read = "সংকিপ্ত";
    const a = bengaliAccuracy(read, truth);
    expect(a.truthGraphemes).toBe(3);
    expect(a.chars).toBeCloseTo(2 / 3, 5);
  });

  it("drops zero-width joiners and bidi marks a reader adds", () => {
    const zwj = String.fromCodePoint(0x200d);
    const noisy = [...BENGALI_PROOF_TEXT].join(zwj);
    expect(bengaliAccuracy(noisy).chars).toBe(1);
  });

  // Positive controls: the bars must FAIL the reads they exist to catch.
  it("fails a page with one sentence missing, at the clean bar", () => {
    const short = BENGALI_PROOF_SENTENCES.slice(0, -2).join("\n");
    expect(bengaliVerdict(short, BENGALI_CLEAN_MIN).ok).toBe(false);
  });

  it("fails a page with one vowel sign in eight dropped, at the clean bar", () => {
    let n = 0;
    const read = BENGALI_PROOF_TEXT.replace(/[া-ৌ]/g, (m) =>
      n++ % 2 === 0 ? "" : m,
    );
    const a = bengaliAccuracy(read);
    expect(a.chars).toBeLessThan(BENGALI_CLEAN_MIN);
  });

  it("passes a page with a handful of misreads at the clean bar", () => {
    const read = BENGALI_PROOF_TEXT.replace("সংক্ষিপ্ত", "সংকিপ্ত")
      .replace("১৫", "১৬")
      .replace("।", "|");
    const v = bengaliVerdict(read, BENGALI_CLEAN_MIN);
    expect(v.ok).toBe(true);
    expect(v.accuracy.chars).toBeLessThan(1);
  });

  it("scores Latin garbage (an English-model read of the page) near zero", () => {
    const garbage =
      "CATT Bcd Tate SATIN SHA Ga ACH SICH ATS FCAT ACHA CICA STATS Ofer";
    expect(bengaliAccuracy(garbage).chars).toBeLessThan(0.05);
    expect(wrongLanguageVerdict(garbage).ok).toBe(true);
    // …and the control FAILS a read that is actually Bengali.
    expect(wrongLanguageVerdict(BENGALI_PROOF_TEXT).ok).toBe(false);
  });

  it("scores an empty read 0, never below", () => {
    expect(bengaliAccuracy("")).toMatchObject({ chars: 0, words: 0 });
    expect(bengaliAccuracy("x".repeat(2000)).chars).toBe(0);
  });

  it("orders the bars: control < noisy ≤ clean", () => {
    expect(WRONG_LANGUAGE_MAX).toBeLessThan(BENGALI_NOISY_MIN);
    expect(BENGALI_NOISY_MIN).toBeLessThanOrEqual(BENGALI_CLEAN_MIN);
  });
});

describe("editDistance", () => {
  it("is Levenshtein", () => {
    expect(editDistance([..."kitten"], [..."sitting"])).toBe(3);
    expect(editDistance([], [..."abc"])).toBe(3);
    expect(editDistance([..."abc"], [..."abc"])).toBe(0);
  });
});

describe("the proof page", () => {
  it("carries every sentence, and only Bengali prose, digits and punctuation", () => {
    const html = new TextDecoder().decode(bengaliProofHtml());
    for (const s of BENGALI_PROOF_SENTENCES) expect(html).toContain(s);
    // The truth holds no Latin letter: an English-model read cannot score by
    // sharing an alphabet with it.
    expect(BENGALI_PROOF_TEXT).not.toMatch(/[A-Za-z]/);
    expect(BENGALI_PROOF_TEXT).toMatch(/[০-৯]/);
  });
});

describe("degradeScan", () => {
  it("is deterministic, and changes the pixels", () => {
    const make = () => {
      const g = new Uint8Array(64 * 64).fill(255);
      for (let i = 0; i < 64 * 64; i += 7) g[i] = 0;
      return g;
    };
    const a = make();
    const b = make();
    const original = make();
    degradeScan(a, 64, 64);
    degradeScan(b, 64, 64);
    expect(a).toEqual(b);
    const changed = a.filter((v, i) => v !== original[i]).length;
    expect(changed).toBeGreaterThan(64 * 64 * 0.9);
  });
});
