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
 * Then an INDEPENDENT reader decodes the bytes, because Chromium printing a
 * page proves nothing about the script on it:
 *   (a) `pdffonts`: every font embedded, no Type 3, and a Noto face for the
 *       sample's script;
 *   (b) `pdftotext`: every code point of the sample is read back;
 *   (c) `pdftoppm`, when present: dark pixels inside the body box;
 *   (d) Arabic only, `pdftotext -bbox`: the first logical word sits to the
 *       RIGHT of the last — the line really was laid out right to left.
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
import { nativePdfProbeReaders, type PdfProbeReaders } from "./pdf-readers";
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
  "no_pdf" | "fonts" | "text" | "raster" | "direction" | "threw";

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
}

const normalisedName = (name: string) =>
  name
    .replace(/^[A-Z]{6}\+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** (a) Every face embedded, none Type 3, and a Noto face for the script. */
export function fontsCarryScript(
  rows: readonly { name: string; type: string; embedded: boolean }[],
  script: WorkerScript,
): boolean {
  if (rows.length === 0) return false;
  if (rows.some((r) => !r.embedded || /type\s*3/i.test(r.type))) return false;
  const token = scriptFaceToken(script);
  return rows.some((r) => {
    const n = normalisedName(r.name);
    return n.includes("noto") && n.includes(token);
  });
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
 * A word is found by its logical text OR that text's code-point reversal:
 * real `pdftotext -bbox` (poppler) returns each Arabic word's code points in
 * VISUAL order — measured 2026-11-15 in the live worker image, "النص" came
 * back as its reversal. Matching only the logical text found neither word and
 * proved Arabic false on every run. Code-point reversal is exact for the
 * probe's sample (`office-conversion/fonts` Arabic, "النص العربي"): it has no
 * combining marks, so visual order is a clean reversal. The direction itself
 * is still decided by xMin alone, so a left-to-right placement fails whichever
 * order its characters come in.
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
    return words.find((w) => {
      const t = w.text.normalize("NFC");
      return t === nfc || t === reversed;
    });
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
  sample: string,
  deps: TranslatePdfProbeDeps,
  render: TranslatePdfDeps["render"],
  readers: PdfProbeReaders,
): Promise<{ ok: boolean; failed?: ProbeCheck; pdfBytes?: number }> {
  const provider: AiProvider = {
    id: "anthropic",
    model: "capability-probe",
    async complete() {
      return {
        ok: true,
        text: `${sample}\n\n${sample}`,
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
  const script = LANGUAGE_SCRIPT[language];
  const pdfBytes = pdf.bytes.byteLength;
  if (!fontsCarryScript(await readers.fonts(pdf.bytes), script))
    return { ok: false, failed: "fonts", pdfBytes };
  if (!textCarriesSample(await readers.text(pdf.bytes), sample))
    return { ok: false, failed: "text", pdfBytes };
  if (readers.raster && !rasterHasInk(await readers.raster(pdf.bytes, 36)))
    return { ok: false, failed: "raster", pdfBytes };
  if (
    language === "ar" &&
    !laidOutRightToLeft(await readers.words(pdf.bytes), sample)
  )
    return { ok: false, failed: "direction", pdfBytes };
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
