/**
 * The fonts Office to PDF depends on the worker IMAGE for.
 *
 * LibreOffice draws a document in the fonts the document names. A font the
 * image does not have is replaced by whatever fontconfig finds, and that is the
 * whole fidelity question: a replacement with other metrics rewraps every line
 * and moves every page break, and a script with no font at all comes out as
 * empty boxes. Nothing in the job reports either — the conversion succeeds.
 *
 * Until 2026-09-27 the worker image had none of the fonts below. Debian lists
 * them only as Recommends of `libreoffice`, and the Dockerfile installs with
 * `--no-install-recommends`, while the catalog promised Word files "into
 * pixel-perfect PDF ... preserving layout, fonts, and formatting".
 *
 * This module is the one list three things read, so they cannot drift apart:
 *
 *   - `src/deploy/worker-fonts.test.ts` — the image installs every package
 *     named here, and no font package that nothing here names;
 *   - `src/tests/office-font-fixtures.ts` — the Word to PDF deployment proof
 *     writes a run in every Office font and every script below, and reads the
 *     embedded font names back out of the PDF the live worker returns;
 *   - the OCR language list — every language the product offers maps to a
 *     script here, at compile time, so a new language cannot arrive without
 *     someone saying which font draws it.
 */
import type { OcrLanguage } from "@/lib/jobs/ocr";

/** A Microsoft font Office documents name, and its metric-compatible clone. */
export interface MetricClone {
  /** The family a .docx/.xlsx/.pptx asks for. */
  readonly office: string;
  /**
   * The open family with identical advance widths, so lines break where Office
   * broke them. fontconfig (30-metric-aliases.conf) and LibreOffice's own
   * replacement table both map `office` to it once it is installed.
   */
  readonly clone: string;
  /** The Debian (bookworm) package that ships `clone`. */
  readonly debianPackage: string;
}

/**
 * The Office defaults a real document is most likely to be set in. Calibri
 * and Cambria are Word's body and heading faces from 2007 until Aptos (2023),
 * which has no metric clone and is therefore not here: copy must never promise
 * that every font is replaced by an equivalent with the same metrics.
 */
export const OFFICE_METRIC_CLONES: readonly MetricClone[] = [
  {
    office: "Calibri",
    clone: "Carlito",
    debianPackage: "fonts-crosextra-carlito",
  },
  {
    office: "Cambria",
    clone: "Caladea",
    debianPackage: "fonts-crosextra-caladea",
  },
  {
    office: "Arial",
    clone: "Liberation Sans",
    debianPackage: "fonts-liberation2",
  },
  {
    office: "Times New Roman",
    clone: "Liberation Serif",
    debianPackage: "fonts-liberation2",
  },
  {
    office: "Courier New",
    clone: "Liberation Mono",
    debianPackage: "fonts-liberation2",
  },
];

export type WorkerScript =
  | "Latin"
  | "Cyrillic"
  | "Arabic"
  | "Devanagari"
  | "Bengali"
  | "Thai"
  | "Han"
  | "Kana"
  | "Hangul";

/**
 * The script of every language the product offers OCR in. A `Record` over the
 * `OcrLanguage` union, so the compiler refuses both a missing language and one
 * that is no longer offered. A language the product advertises is a language
 * users upload Word documents in; this is the lower bound of what the worker
 * must be able to DRAW, not only read.
 */
export const OCR_LANGUAGE_SCRIPT: Record<OcrLanguage, WorkerScript> = {
  eng: "Latin",
  spa: "Latin",
  fra: "Latin",
  deu: "Latin",
  ita: "Latin",
  por: "Latin",
  nld: "Latin",
  pol: "Latin",
  swe: "Latin",
  tur: "Latin",
  vie: "Latin",
  ind: "Latin",
  rus: "Cyrillic",
  ukr: "Cyrillic",
  ara: "Arabic",
  hin: "Devanagari",
  ben: "Bengali",
  tha: "Thai",
  chi_sim: "Han",
  jpn: "Kana",
  kor: "Hangul",
};

export interface ScriptFont {
  /** The Debian (bookworm) package whose faces draw this script. */
  readonly debianPackage: string;
  /**
   * A token every face that can draw this script carries in its PostScript
   * name (compared lowercased, without punctuation), so the deployment proof
   * can tell from the PDF that a face for the script was embedded. `null` when
   * a face name cannot say it: the Latin and Cyrillic runs are drawn by the
   * metric clones (checked by name above), and Arabic is also drawn by DejaVu,
   * which fontconfig always brings, so a name would not say which package
   * drew it.
   */
  readonly faceToken: string | null;
  /** Text the proof document writes in this script. */
  readonly sample: string;
  /** The BCP 47 tag Word writes on such a run. */
  readonly lang: string;
  /**
   * Which of Word's three font slots the script is drawn from: `ascii` for
   * Latin and Cyrillic, `eastAsia` for CJK, `cs` (complex script) for the rest.
   */
  readonly slot: "ascii" | "eastAsia" | "cs";
}

export const SCRIPT_FONTS: Record<WorkerScript, ScriptFont> = {
  Latin: {
    debianPackage: "fonts-liberation2",
    faceToken: null,
    sample: "Façade naïve — Việt Nam, İstanbul, Łódź, Ångström",
    lang: "en-US",
    slot: "ascii",
  },
  Cyrillic: {
    debianPackage: "fonts-liberation2",
    faceToken: null,
    sample: "Русский текст, українська мова",
    lang: "ru-RU",
    slot: "ascii",
  },
  Arabic: {
    debianPackage: "fonts-noto-core",
    faceToken: null,
    sample: "النص العربي",
    lang: "ar-SA",
    slot: "cs",
  },
  Devanagari: {
    debianPackage: "fonts-noto-core",
    faceToken: "devanagari",
    sample: "हिन्दी पाठ",
    lang: "hi-IN",
    slot: "cs",
  },
  Bengali: {
    debianPackage: "fonts-noto-core",
    faceToken: "bengali",
    sample: "বাংলা লেখা",
    lang: "bn-BD",
    slot: "cs",
  },
  Thai: {
    debianPackage: "fonts-noto-core",
    faceToken: "thai",
    sample: "ภาษาไทย",
    lang: "th-TH",
    slot: "cs",
  },
  Han: {
    debianPackage: "fonts-noto-cjk",
    faceToken: "cjk",
    sample: "中文文本",
    lang: "zh-CN",
    slot: "eastAsia",
  },
  Kana: {
    debianPackage: "fonts-noto-cjk",
    faceToken: "cjk",
    sample: "ひらがな カタカナ",
    lang: "ja-JP",
    slot: "eastAsia",
  },
  Hangul: {
    debianPackage: "fonts-noto-cjk",
    faceToken: "cjk",
    sample: "한국어 텍스트",
    lang: "ko-KR",
    slot: "eastAsia",
  },
};

/** Every font package the worker image must install, deduplicated, sorted. */
export function requiredWorkerFontPackages(): string[] {
  return [
    ...new Set([
      ...OFFICE_METRIC_CLONES.map((c) => c.debianPackage),
      ...Object.values(SCRIPT_FONTS).map((s) => s.debianPackage),
    ]),
  ].sort();
}
