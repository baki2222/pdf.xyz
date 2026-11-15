/**
 * Which target languages can THIS worker image print as a reflowed PDF?
 *
 * Published on the heartbeat as `translatePdfLanguages` and read by the
 * engine before every render (`translateDeps(env).pdf.languages`), from ONE
 * memo: the proof below runs once per process, and both readers see the same
 * settled value — null while it runs, so no job is printed on a guess.
 *
 * ── IT RUNS THE COMPOSED CHAIN, AND JUDGES THE OUTPUT ───────────────────────
 *
 * One `translate-pdf` job per language through `runThroughExecutorOrder`
 * (soundness → processor → manifest gate), with the REAL Chromium and the
 * REAL `pdftotext` read-back the jobs use, and stubs for the extractor and
 * the model (no network, no spend). NOT `proveThroughExecutorOrder`: that
 * returns `artifacts[0]` — the ZIP — and would never see the PDF. The PDF is
 * picked from `result.artifacts` by its content type; a job that delivered no
 * PDF fails its language.
 *
 * Then INDEPENDENT readers decode the bytes, because Chromium printing a
 * page proves nothing about the script on it. Each language is judged by its
 * sample plus its {@link PROBE_EXTRA} ({@link probeJudgedText}):
 *   (a) `pdffonts`: every font embedded AND carrying a ToUnicode map (no
 *       ToUnicode, no copy or search in any viewer), whatever the script; a
 *       Type 3 font only for Han, Kana and Hangul; otherwise a non-Type 3 row
 *       with a Noto face for the script ({@link fontsCarryScript});
 *   (glyphs) Han/Kana/Hangul with Type 3 fonts only: every drawn glyph a
 *       vector outline that is not its font's .notdef box, every judged code
 *       point mapped by ToUnicode to a drawn glyph, distinct code points drawn
 *       by distinct glyphs, and the descriptor names the target's regional
 *       Noto CJK face ({@link glyphsCarrySample});
 *   (b) `pdftotext`: every code point of the sample is read back;
 *   (c) `pdftoppm`, when present: dark pixels inside the body box;
 *   (d) Arabic only, `pdftotext -bbox`: the first logical word sits to the
 *       RIGHT of the last — the line really was laid out right to left;
 *   (e) `viewer_text`, Han/Kana/Hangul only: every judged code point is in
 *       the text pdf.js extracts — the reader that IGNORES ActualText. Poppler
 *       honours it, so (b) cannot see a ToUnicode entry naming the wrong code
 *       point (a Kangxi radical for 文); pdf.js can. No pdf.js → FAIL.
 *
 * WHY TYPE 3 IS ACCEPTED FOR CJK (2026-11-15): Skia's "[pdf] Give up on
 * embedding CFF" means Noto CJK — CFF-only in Debian bookworm — is printed by
 * this image's Chromium 156 as Type 3 fonts. The old rule ("no Type 3, a face
 * name with noto+cjk") stood for a property with a mechanism that could never
 * pass here. (glyphs) and (e) judge the property itself: every glyph the
 * reader sees is a resolution-independent outline, is not a .notdef box, and
 * maps back to its own code point in a viewer that reads only ToUnicode.
 *
 * ── HEALTH ──────────────────────────────────────────────────────────────────
 *
 * The sample corpus must be exactly `TRANSLATE_LANGUAGES` (21) — FATAL
 * otherwise, because a corpus that quietly shrinks reports the strongest
 * possible pass over less of the world. At least one job must have been
 * attempted. Both throw; the memo turns a throw into "no language proven".
 */
import { PDFDocument } from "pdf-lib";
import {
  TRANSLATE_LANGUAGES,
  type TranslateLanguage,
} from "@/lib/jobs/translate-pdf";
import { runThroughExecutorOrder } from "../capability-chain";
import { ProcessorRegistry } from "../processor/registry";
import { createTranslateProcessor } from "../processor/translate";
import type { AiProvider } from "../ai/provider";
import { SCRIPT_FONTS, type WorkerScript } from "../office-conversion/fonts";
import type { TranslatePdfDeps } from "./engine";
import {
  charProcDraws,
  nativePdfProbeReaders,
  type PdfProbeReaders,
  type Type3Font,
} from "./pdf-readers";
import { nativeTranslatePdfRender } from "./native";
import { memoTranslatePdfLanguages } from "./pdf-languages";
import { TEXT_PAGE_MARGIN_PT, US_LETTER_PT } from "@/lib/pdf/page-geometry";

/** The script each target language is written in. */
export const LANGUAGE_SCRIPT: Record<TranslateLanguage, WorkerScript> = {
  en: "Latin",
  es: "Latin",
  fr: "Latin",
  de: "Latin",
  it: "Latin",
  pt: "Latin",
  nl: "Latin",
  ru: "Cyrillic",
  uk: "Cyrillic",
  pl: "Latin",
  sv: "Latin",
  tr: "Latin",
  ar: "Arabic",
  hi: "Devanagari",
  zh: "Han",
  ja: "Kana",
  ko: "Hangul",
  vi: "Latin",
  id: "Latin",
  th: "Thai",
  bn: "Bengali",
};

/** What each probe job's model "returns": its script's sample (`office-conversion/fonts`). */
export const LANGUAGE_SAMPLES: Record<TranslateLanguage, string> =
  Object.fromEntries(
    TRANSLATE_LANGUAGES.map((l) => [
      l,
      SCRIPT_FONTS[LANGUAGE_SCRIPT[l]].sample,
    ]),
  ) as Record<TranslateLanguage, string>;

/**
 * A token the embedded face's name must carry, lowercased with punctuation
 * removed. Latin and Cyrillic are drawn by Noto Sans itself; the rest by the
 * script's own Noto face (CJK faces carry "cjk").
 */
export function scriptFaceToken(script: WorkerScript): string {
  switch (script) {
    case "Latin":
    case "Cyrillic":
    case "Greek":
      return "notosans";
    case "Arabic":
      return "arabic";
    case "Hebrew":
      return "hebrew";
    default:
      return SCRIPT_FONTS[script].faceToken ?? script.toLowerCase();
  }
}

export class TranslatePdfProbeCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslatePdfProbeCorpusError";
  }
}

export type ProbeCheck =
  | "no_pdf"
  | "fonts"
  | "glyphs"
  | "text"
  | "raster"
  | "direction"
  | "viewer_text"
  | "threw";

/** The scripts whose Noto faces this image's Chromium prints as Type 3. */
export const TYPE3_SCRIPTS: ReadonlySet<WorkerScript> = new Set<WorkerScript>([
  "Han",
  "Kana",
  "Hangul",
]);

/**
 * The region of the Noto CJK face `typeset.ts` puts FIRST for each CJK
 * script's target (zh → SC, ja → JP, ko → KR). Measured 2026-11-15 in the
 * live image: the Type 3 FontDescriptor names it, e.g. ja's
 * `/FontName /CAAAAA+NotoSansCJKjp-Regular`, `/FontFamily (Noto Sans CJK JP)`.
 * So (glyphs) proves the JP face drew Japanese, the reason typeset orders it.
 */
export const CJK_REGION_TOKEN: Partial<Record<WorkerScript, string>> = {
  Han: "sc",
  Kana: "jp",
  Hangul: "kr",
};

/**
 * Translate-only text added to the probe's judged sample, for the targets the
 * ToUnicode rewrite (`radical-equivalents.ts`) affects. `ja`'s script sample
 * is kana only, so without this the ja probe would never exercise Han. 日, 文,
 * 一 and 人 are each drawn with a glyph Noto CJK shares with a Kangxi radical.
 *
 * Deliberately NOT in `SCRIPT_FONTS.sample` (the Office proof reads it) nor
 * in {@link LANGUAGE_SAMPLES} (`pdf-measure.ts` builds the delivery-size
 * corpus from it, so editing it would move every bytes/pages/ms figure).
 */
export const PROBE_EXTRA: Partial<Record<TranslateLanguage, string>> = {
  ja: "日本語の文章",
  zh: "一个人",
};

/** The string the probe JUDGES a language by: its sample plus its extra. */
export function probeJudgedText(
  language: TranslateLanguage,
  sample: string,
): string {
  const extra = PROBE_EXTRA[language];
  return extra ? `${sample} ${extra}` : sample;
}

/**
 * What the probe's stub model returns. CJK targets also get a heading line,
 * so the BOLD CJK Type 3 fonts headings use are drawn — and judged by
 * (glyphs), which holds every drawn glyph, not only the sample's — as well as
 * the regular ones body text uses. Every other target's text is unchanged.
 */
export function probeModelText(
  language: TranslateLanguage,
  judged: string,
): string {
  return TYPE3_SCRIPTS.has(LANGUAGE_SCRIPT[language])
    ? `## ${judged}\n\n${judged}\n\n${judged}`
    : `${judged}\n\n${judged}`;
}

export interface LanguageProbe {
  language: TranslateLanguage;
  ok: boolean;
  /** The first check that failed. */
  failed?: ProbeCheck;
  ms: number;
  pdfBytes?: number;
}

export interface TranslatePdfProbe {
  passing: TranslateLanguage[];
  results: LanguageProbe[];
  totalMs: number;
}

export interface TranslatePdfProbeDeps {
  /** The renderer the jobs use (`nativeTranslatePdfRender`), or absent. */
  render: TranslatePdfDeps["render"] | undefined;
  /** The independent readers, or null when this host lacks poppler. */
  readers: PdfProbeReaders | null;
  env?: Record<string, string | undefined>;
  /** Defaults to {@link LANGUAGE_SAMPLES}. Must cover all 21 languages. */
  samples?: Record<string, string>;
  /** Run only these jobs (the corpus check still covers all 21). */
  only?: readonly TranslateLanguage[];
  now?: () => number;
  /** Sees each delivered probe PDF before it is judged (fixture capture). */
  onPdf?: (language: TranslateLanguage, bytes: Uint8Array) => void;
}

const normalisedName = (name: string) =>
  name
    .replace(/^[A-Z]{6}\+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const isType3 = (r: { type: string }) => /type\s*3/i.test(r.type);

/**
 * (a) Every face embedded and carrying ToUnicode, whatever the script. Then
 * a Type 3 face is accepted only for Han, Kana and Hangul — and there its
 * identity is left to (glyphs), which reads the descriptor; otherwise some
 * non-Type 3 Noto face for the script.
 *
 * `unicode` is required for EVERY script since 2026-11-15. Before requiring
 * it, the pdffonts rows of all 21 probe PDFs were printed from the live
 * image: every row of every language said `uni yes`.
 */
export function fontsCarryScript(
  rows: readonly {
    name: string;
    type: string;
    embedded: boolean;
    unicode: boolean;
  }[],
  script: WorkerScript,
): boolean {
  if (rows.length === 0) return false;
  if (rows.some((r) => !r.embedded || !r.unicode)) return false;
  if (rows.some(isType3)) return TYPE3_SCRIPTS.has(script);
  const token = scriptFaceToken(script);
  return rows.some((r) => {
    const n = normalisedName(r.name);
    return n.includes("noto") && n.includes(token);
  });
}

const judgedCodePoints = (sample: string) =>
  [...new Set(sample.normalize("NFC"))].filter((ch) => !/\s|\p{Cf}/u.test(ch));

/**
 * (glyphs) The Type 3 glyphs carry the sample — Han, Kana and Hangul only:
 *  - every Type 3 font has ToUnicode and a .notdef CharProc. A font whose
 *    .notdef was not found FAILS: comparing against nothing is vacuously
 *    "not a box" (Skia splits fonts by glyph-ID range; that every range font
 *    carries its own `g0` is measured on the fixtures, not assumed);
 *  - every glyph any page DRAWS is vector-only, constructs a path, and is not
 *    byte-equal to its font's .notdef CharProc — a tofu box fails, in either
 *    weight (the probe's heading draws the bold fonts);
 *  - every font that draws a glyph is the target's regional Noto CJK face by
 *    its descriptor's /FontName ({@link CJK_REGION_TOKEN});
 *  - every judged code point maps through ToUnicode to a drawn glyph, and
 *    distinct code points are drawn by distinct CharProcs: tofu boxes are
 *    identical, real glyphs are not.
 */
export function glyphsCarrySample(
  fonts: readonly Type3Font[],
  sample: string,
  script: WorkerScript,
): boolean {
  if (!TYPE3_SCRIPTS.has(script)) return false;
  const region = CJK_REGION_TOKEN[script];
  if (!region || fonts.length === 0) return false;
  const byCodePoint = new Map<string, Set<string>>();
  for (const font of fonts) {
    if (!font.hasToUnicode || font.notdef === null) return false;
    if (font.used.length === 0) continue;
    const face = normalisedName(font.descriptorName ?? "");
    if (!face.includes("noto") || !face.includes(`cjk${region}`)) return false;
    for (const g of font.used) {
      if (!g.vectorOnly || !charProcDraws(g.content)) return false;
      if (g.content === font.notdef) return false;
      if (g.unicode === null) continue;
      const ch = g.unicode.normalize("NFC");
      const set = byCodePoint.get(ch) ?? new Set<string>();
      set.add(g.content);
      byCodePoint.set(ch, set);
    }
  }
  const owner = new Map<string, string>();
  for (const ch of judgedCodePoints(sample)) {
    const contents = byCodePoint.get(ch);
    if (!contents || contents.size === 0) return false;
    for (const content of contents) {
      const prior = owner.get(content);
      if (prior !== undefined && prior !== ch) return false;
      owner.set(content, ch);
    }
  }
  return true;
}

/** (b) Every non-whitespace code point of the sample is in the read-back. */
export function textCarriesSample(read: string, sample: string): boolean {
  const have = new Set(read.normalize("NFC"));
  for (const ch of sample.normalize("NFC")) {
    if (/\s|\p{Cf}/u.test(ch)) continue;
    if (!have.has(ch)) return false;
  }
  return true;
}

/** (c) Dark pixels inside the page's body box (inside the margins). */
export function rasterHasInk(raster: {
  width: number;
  height: number;
  pixels: Uint8Array;
}): boolean {
  const mx = Math.floor(
    (raster.width * TEXT_PAGE_MARGIN_PT) / US_LETTER_PT.width,
  );
  const my = Math.floor(
    (raster.height * TEXT_PAGE_MARGIN_PT) / US_LETTER_PT.height,
  );
  for (let y = my; y < raster.height - my; y++)
    for (let x = mx; x < raster.width - mx; x++)
      if (raster.pixels[y * raster.width + x]! < 128) return true;
  return false;
}

/**
 * (d) The sample's first logical word sits right of its last one.
 *
 * A word is found ONLY by its logical text's code-point reversal: real
 * `pdftotext -bbox` (poppler) returns each Arabic word's code points in
 * VISUAL order, the order the shaped glyphs are drawn — measured 2026-11-15 in
 * the live worker image, "النص" came back as "صنلا". Matching the logical text
 * found neither word and proved Arabic false on every run.
 *
 * Logical order is deliberately NOT accepted (review, 2026-11-15): a word read
 * back in logical order means its letters were drawn left to right — no bidi
 * inside the word, so the reader sees each word's letters reversed — and the
 * xMin test alone cannot see that. Accepting only the visual form pins letter
 * order inside the word as well as word order on the line, and a future
 * renderer that changes what poppler reads back fails CLOSED (the ZIP alone),
 * never open. Code-point reversal is exact for the probe's sample
 * (`office-conversion/fonts` Arabic, "النص العربي"): it has no combining
 * marks, so visual order is a clean reversal.
 */
export function laidOutRightToLeft(
  words: readonly { text: string; xMin: number }[],
  sample: string,
): boolean {
  const logical = sample.split(/\s+/).filter(Boolean);
  if (logical.length < 2) return false;
  const find = (word: string) => {
    const nfc = word.normalize("NFC");
    const reversed = [...nfc].reverse().join("");
    return words.find((w) => w.text.normalize("NFC") === reversed);
  };
  const first = find(logical[0]!);
  const last = find(logical[logical.length - 1]!);
  return !!first && !!last && first.xMin > last.xMin;
}

let inputPdf: Promise<Uint8Array> | null = null;
/** A real, sound one-page PDF: the soundness gate opens the probe's input. */
function probeInput(): Promise<Uint8Array> {
  inputPdf ??= (async () => {
    const doc = await PDFDocument.create();
    doc.addPage([US_LETTER_PT.width, US_LETTER_PT.height]);
    return doc.save();
  })();
  return inputPdf;
}

const PROBE_SOURCE = "Translate PDF capability probe source text.";

async function probeOne(
  language: TranslateLanguage,
  scriptSample: string,
  deps: TranslatePdfProbeDeps,
  render: TranslatePdfDeps["render"],
  readers: PdfProbeReaders,
): Promise<{ ok: boolean; failed?: ProbeCheck; pdfBytes?: number }> {
  const sample = probeJudgedText(language, scriptSample);
  const modelText = probeModelText(language, sample);
  const provider: AiProvider = {
    id: "anthropic",
    model: "capability-probe",
    async complete() {
      return {
        ok: true,
        text: modelText,
        model: "capability-probe",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
  const registry = new ProcessorRegistry().register(
    createTranslateProcessor({
      extract: async () => ({
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            text: PROBE_SOURCE,
            characterCount: PROBE_SOURCE.length,
          },
        ],
        text: PROBE_SOURCE,
        characterCount: PROBE_SOURCE.length,
        hasText: true,
      }),
      provider,
      now: () => "1970-01-01T00:00:00.000Z",
      // Every language is offered to the renderer here: this IS the proof.
      pdf: { render, languages: () => new Set(TRANSLATE_LANGUAGES) },
    }),
  );
  const outcome = await runThroughExecutorOrder({
    tool: "translate-pdf",
    input: {
      bytes: await probeInput(),
      filename: "probe.pdf",
      contentType: "application/pdf",
    },
    options: {
      targetLanguage: language,
      sourceLanguage: language === "en" ? "fr" : "en",
    },
    registry,
    ...(deps.env ? { env: deps.env } : {}),
  });
  if (outcome.stage !== "delivered") return { ok: false, failed: "no_pdf" };
  const pdf = outcome.result.artifacts.find(
    (a) => a.contentType === "application/pdf",
  );
  if (!pdf) return { ok: false, failed: "no_pdf" };
  deps.onPdf?.(language, pdf.bytes);
  const script = LANGUAGE_SCRIPT[language];
  const pdfBytes = pdf.bytes.byteLength;
  const rows = await readers.fonts(pdf.bytes);
  if (!fontsCarryScript(rows, script))
    return { ok: false, failed: "fonts", pdfBytes };
  if (
    rows.some(isType3) &&
    !glyphsCarrySample(await readers.type3(pdf.bytes), sample, script)
  )
    return { ok: false, failed: "glyphs", pdfBytes };
  if (!textCarriesSample(await readers.text(pdf.bytes), sample))
    return { ok: false, failed: "text", pdfBytes };
  if (readers.raster && !rasterHasInk(await readers.raster(pdf.bytes, 36)))
    return { ok: false, failed: "raster", pdfBytes };
  if (
    language === "ar" &&
    !laidOutRightToLeft(await readers.words(pdf.bytes), sample)
  )
    return { ok: false, failed: "direction", pdfBytes };
  // (e) is scoped to CJK because this slice makes CJK pass it (2026-11-15).
  // Bengali is KNOWN to fail it — pdf.js drops ে (U+09C7) from the Bengali
  // CID TrueType face — a separate, pre-existing follow-up.
  if (TYPE3_SCRIPTS.has(script)) {
    if (!readers.viewerText)
      return { ok: false, failed: "viewer_text", pdfBytes };
    if (!textCarriesSample(await readers.viewerText(pdf.bytes), sample))
      return { ok: false, failed: "viewer_text", pdfBytes };
  }
  return { ok: true, pdfBytes };
}

/** Every language's verdict, with timings: the proof script prints this. */
export async function probeTranslatePdfLanguages(
  deps: TranslatePdfProbeDeps,
): Promise<TranslatePdfProbe> {
  const now = deps.now ?? Date.now;
  const samples = deps.samples ?? LANGUAGE_SAMPLES;
  const keys = Object.keys(samples).sort();
  const corpus = [...TRANSLATE_LANGUAGES].sort();
  if (
    keys.length !== corpus.length ||
    keys.some((k, i) => k !== corpus[i]) ||
    corpus.length !== 21
  )
    throw new TranslatePdfProbeCorpusError(
      `the sample corpus has ${keys.length} languages, not the ${corpus.length} Translate offers`,
    );
  const started = now();
  const results: LanguageProbe[] = [];
  const render = deps.render;
  const readers = deps.readers;
  const jobs = deps.only ?? TRANSLATE_LANGUAGES;
  if (render && readers) {
    for (const language of jobs) {
      const t0 = now();
      try {
        const r = await probeOne(
          language,
          samples[language]!,
          deps,
          render,
          readers,
        );
        results.push({ language, ...r, ms: now() - t0 });
      } catch {
        results.push({ language, ok: false, failed: "threw", ms: now() - t0 });
      }
    }
  }
  if (render && readers && results.length === 0)
    throw new TranslatePdfProbeCorpusError("no probe job was attempted");
  return {
    passing: results
      .filter((r) => r.ok)
      .map((r) => r.language)
      .sort(),
    results,
    totalMs: now() - started,
  };
}

/** The passing languages, sorted. */
export async function provesTranslatePdfLanguages(
  deps: TranslatePdfProbeDeps,
): Promise<TranslateLanguage[]> {
  return (await probeTranslatePdfLanguages(deps)).passing;
}

/**
 * THE memo the heartbeat publishes and the engine reads (`./pdf-languages`):
 * the proof runs once per process, on the image's own Chromium and poppler.
 */
export function translatePdfLanguages(
  env: Record<string, string | undefined> = process.env,
): Promise<TranslateLanguage[]> {
  return memoTranslatePdfLanguages(() =>
    provesTranslatePdfLanguages({
      render: nativeTranslatePdfRender(env),
      readers: nativePdfProbeReaders(),
      env,
    }),
  );
}
