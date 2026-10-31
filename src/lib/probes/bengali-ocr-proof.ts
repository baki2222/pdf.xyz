/**
 * The Bengali (Bangla) OCR quality proof: a page of known Bengali prose, the
 * measure of how much of it came back, and the bars a production run must
 * clear before anything may claim that OCR PDF or PDF to Word reads Bengali.
 *
 * ── WHY (2026-10-31) ────────────────────────────────────────────────────────
 *
 * `ben` has been in the OCR menu since the menu existed, and nothing had ever
 * read a Bengali page back. A completed job is not a correct one: Tesseract
 * given the wrong model returns fluent garbage and the job still completes,
 * so "the job finished" is no evidence that the words came back. The other
 * scripts' samples (`@/lib/workers/ocr-languages-proof`) are three large
 * words each and a word-presence verdict: enough to show a pack is loaded,
 * not how much of a real page a reader gets. A guide that sends Bengali
 * readers to these tools needs the second number, measured on the deployment
 * the reader uses, so this proof measures it.
 *
 * ── WHAT IS MEASURED ────────────────────────────────────────────────────────
 *
 * {@link BENGALI_PROOF_TEXT}: seven sentences written for this proof (no
 * borrowed text), in body-text size, chosen for what Bengali OCR gets wrong —
 * conjuncts (প্র, ক্ষ, ন্ত্র, জ্ঞ, ষ্ট, ঙ্গ, স্প), every dependent vowel sign,
 * chandrabindu, khanda ta, the nukta letters ড় and য়, Bengali digits and the
 * danda. The worker's own Chromium types it (the image's fonts), the proof
 * scans it to pixels, and the job's output is compared with it.
 *
 * {@link bengaliAccuracy} is grapheme-aware: both sides NFC (which also
 * decomposes ড়/য় the same way on both sides), format controls dropped, and
 * compared as extended grapheme clusters — so a misread conjunct costs one
 * edit, not three code points' worth. `chars` ignores whitespace (a line
 * broken differently is not a misread letter); `words` is the same edit
 * distance over words, punctuation removed, so a run of words glued together
 * does show up somewhere.
 *
 * ── THE BARS, SET BEFORE THE FIRST PRODUCTION RUN ──────────────────────────
 *
 * {@link BENGALI_CLEAN_MIN} 0.90 of graphemes on the clean 300 DPI scan: at
 * that rate a reader corrects about one letter cluster in ten, which is still
 * far quicker than retyping a page — below it, the guide's promise ("an
 * editable Word file") would be a promise of retyping. {@link
 * BENGALI_NOISY_MIN} 0.80 on the degraded 200 DPI scan: the guide says
 * accuracy falls with scan quality, and this bar says by how much it may
 * before that sentence is too gentle. {@link WRONG_LANGUAGE_MAX} 0.50 is the
 * positive control: the same clean scan read with English selected must score
 * BELOW it, or the metric cannot see the failure it exists to catch.
 */

/** Seven sentences, one paragraph each, in reading order. Written for this proof. */
export const BENGALI_PROOF_SENTENCES: readonly string[] = [
  "বাংলা পৃথিবীর অন্যতম প্রধান ভাষা। প্রতিদিন কোটি কোটি মানুষ এই ভাষায় কথা বলেন, পড়েন এবং লেখেন।",
  "আমাদের অফিসে প্রতি মাসের শেষে একটি সংক্ষিপ্ত প্রতিবেদন তৈরি করা হয়।",
  "এই প্রতিবেদনে বিক্রয়, খরচ এবং নতুন প্রকল্পের অগ্রগতির বিবরণ থাকে।",
  "স্কুলের ছাত্রছাত্রীরা বিজ্ঞান মেলায় নিজেদের তৈরি যন্ত্র প্রদর্শন করেছে।",
  "হঠাৎ আকাশে মেঘ জমলে চাঁদের আলো ঢেকে যায়, তাই গ্রামের রাস্তায় সবাই সাবধানে চলাফেরা করে।",
  "দয়া করে আবেদনপত্রের সঙ্গে আপনার পরিচয়পত্রের একটি অনুলিপি জমা দিন।",
  "সভাটি ১৫ নভেম্বর বৃহস্পতিবার সকাল ১০টায় শুরু হবে এবং দুপুর ১টায় শেষ হবে।",
];

/** The ground truth: the sentences in reading order. */
export const BENGALI_PROOF_TEXT = BENGALI_PROOF_SENTENCES.join("\n");

/** Grapheme accuracy the clean 300 DPI scan must reach. See the module doc. */
export const BENGALI_CLEAN_MIN = 0.9;
/** Grapheme accuracy the degraded 200 DPI scan must reach. */
export const BENGALI_NOISY_MIN = 0.8;
/** The wrong-language control must score BELOW this. */
export const WRONG_LANGUAGE_MAX = 0.5;

/** Clean scan: 300 DPI, what an office scanner's "document" preset makes. */
export const BENGALI_CLEAN_DPI = 300;
/** Degraded scan: 200 DPI, softened and speckled (see {@link degradeScan}). */
export const BENGALI_NOISY_DPI = 200;

/** Pixels on the long side of an A4 page scanned at `dpi`. */
export const a4LongSide = (dpi: number) => Math.round((842 / 72) * dpi);

/**
 * Format controls readers add or drop at will (ZWNJ/ZWJ, LRM/RLM, bidi
 * embeddings and isolates). Built from code points so no invisible character
 * is ever typed into this file.
 */
const FORMAT_CONTROLS = new RegExp(
  `[${(
    [
      [0x200c, 0x200f],
      [0x202a, 0x202e],
      [0x2066, 0x2069],
      [0xfeff, 0xfeff],
    ] as const
  )
    .map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`)
    .join("")}]`,
  "gu",
);

const segmenter = new Intl.Segmenter("bn", { granularity: "grapheme" });

function normalise(text: string): string {
  return text.normalize("NFC").replace(FORMAT_CONTROLS, "");
}

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

function words(text: string): string[] {
  return text.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
}

/** Levenshtein distance between two sequences. */
export function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next.push(
        Math.min(
          row[j]! + 1,
          next[j - 1]! + 1,
          row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    row = next;
  }
  return row[b.length]!;
}

export interface BengaliAccuracy {
  /** 1 − grapheme edit distance ÷ truth graphemes, whitespace ignored; ≥ 0. */
  chars: number;
  /** 1 − word edit distance ÷ truth words, punctuation removed; ≥ 0. */
  words: number;
  /** Graphemes in the truth (whitespace ignored), so a ratio has its base. */
  truthGraphemes: number;
  /** Graphemes read (whitespace ignored). */
  readGraphemes: number;
}

/** How much of `truth` came back in `read`. See the module doc. */
export function bengaliAccuracy(
  read: string,
  truth: string = BENGALI_PROOF_TEXT,
): BengaliAccuracy {
  const t = normalise(truth);
  const r = normalise(read);
  const tg = graphemes(t.replace(/\s+/g, ""));
  const rg = graphemes(r.replace(/\s+/g, ""));
  const tw = words(t);
  const rw = words(r);
  const ratio = (d: number, n: number) => Math.max(0, 1 - d / n);
  return {
    chars: ratio(editDistance(tg, rg), tg.length),
    words: ratio(editDistance(tw, rw), tw.length),
    truthGraphemes: tg.length,
    readGraphemes: rg.length,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function describe(a: BengaliAccuracy): string {
  return `${pct(a.chars)} of graphemes, ${pct(a.words)} of words (${a.readGraphemes} graphemes read of ${a.truthGraphemes})`;
}

/** A Bengali read must reach `min` of the truth's graphemes. */
export function bengaliVerdict(
  read: string,
  min: number,
): { ok: boolean; detail: string; accuracy: BengaliAccuracy } {
  const accuracy = bengaliAccuracy(read);
  const ok = accuracy.chars >= min;
  return {
    ok,
    accuracy,
    detail: `${describe(accuracy)}; need ${pct(min)}`,
  };
}

/**
 * The positive control: the same scan read with the WRONG language must score
 * below {@link WRONG_LANGUAGE_MAX}. A read that scores well here means the
 * metric, or the language option, is not what it seems.
 */
export function wrongLanguageVerdict(read: string): {
  ok: boolean;
  detail: string;
  accuracy: BengaliAccuracy;
} {
  const accuracy = bengaliAccuracy(read);
  const ok = accuracy.chars < WRONG_LANGUAGE_MAX;
  return {
    ok,
    accuracy,
    detail: `${describe(accuracy)}; a wrong-language read must stay under ${pct(WRONG_LANGUAGE_MAX)}`,
  };
}

/** A small seeded PRNG (mulberry32), so a degraded scan is the same every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A lightly degraded scan, in place on 8-bit grey pixels: a 3×3 blur (a
 * scanner's softness), paper that is not white (ink and paper pulled toward
 * the middle), Gaussian grain (σ 14) and one pixel in 400 a dark speck.
 * Deterministic for a seed. Light on purpose: this is a phone-camera or
 * fax-grade page a reader would still call legible, not a stress test.
 */
export function degradeScan(
  gray: Uint8Array,
  width: number,
  height: number,
  seed = 20261031,
): void {
  const src = gray.slice();
  const rand = prng(seed);
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
          sum += src[yy * width + xx]!;
          n++;
        }
      let v = 28 + (sum / n) * 0.84 + gauss() * 14;
      if (rand() < 0.0025) v = 40 + rand() * 60;
      gray[y * width + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
}
