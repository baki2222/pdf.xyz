/**
 * `pnpm worker:ocr-languages-proof` — the OCR languages the product offers,
 * asked of the BUILT worker image rather than of the Dockerfile's text.
 *
 * `src/deploy/ocr-languages.test.ts` holds `OCR_LANGUAGES` to the packages the
 * Dockerfile installs. That is a bound on the author's artifact: it cannot see
 * that a Debian package carries the traineddata Tesseract loads under that
 * code, that the image's Chromium can draw the script, or that the words come
 * back in the order a reader reads them. This runs inside the image, on its
 * own engines, and checks three things:
 *
 *   1. PACKS — `tesseract --list-langs` names every code in `OCR_LANGUAGES`
 *      (derived from the list the menu and the job API read, never typed).
 *   2. RECOGNITION — for each sample below, a page of known words in that
 *      script, typed by the image's Chromium (its fonts), made into a SCAN
 *      (pixels only; the scan is checked to carry no text), is run through the
 *      registry's OCR processor — the one `ocr-pdf` jobs reach — and the
 *      words must come back, in reading order, both in the `.txt` sidecar and
 *      in the searchable PDF's text layer as poppler reads it. Right-to-left
 *      scripts are where order goes wrong, so it is order that is checked.
 *   3. PDF TO WORD — the same scan through the registry's PDF to Word
 *      processor with OCR on, for every sample whose language that tool's
 *      OCR option offers: the DOCX must carry the words as text, in order.
 *
 * A POSITIVE CONTROL runs the Greek scan with English selected and requires
 * the Greek words NOT to come back, so the verdict is seen to fail.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine this proof needs
 * is not in the image. Output names languages, counts and verdicts only —
 * never recognised text beyond the fixed sample words, never a path.
 */
import {
  OCR_LANGUAGE_CODES,
  PDF_TO_WORD_OCR_LANGUAGE_CODES,
  type OcrLanguage,
} from "@/lib/jobs/ocr";
import type { Processor, ProcessorResult } from "./processor/types";

/** One page of known words in one script. */
export interface OcrLanguageSample {
  code: OcrLanguage;
  /** The words, in reading order, separated by single spaces. */
  text: string;
  /** Written right to left: the page is laid out `dir="rtl"`. */
  rtl?: boolean;
  /** No spaces between words in this script: compare characters, not words. */
  unspaced?: boolean;
}

/**
 * Every script the 2026-10-25 change added, plus Arabic, Hindi and Russian
 * (offered before, never proven in-image). Common words, set large, so a miss
 * is the engine's and not the fixture's.
 */
export const OCR_LANGUAGE_SAMPLES: readonly OcrLanguageSample[] = [
  { code: "ell", text: "Καλημέρα κόσμε σήμερα" },
  { code: "rus", text: "Привет мир сегодня" },
  { code: "heb", text: "שלום עולם היום", rtl: true },
  { code: "ara", text: "مرحبا بالعالم اليوم", rtl: true },
  { code: "fas", text: "سلام دنیا امروز", rtl: true },
  { code: "hin", text: "नमस्ते दुनिया आज" },
  { code: "mar", text: "नमस्कार जग आज" },
  { code: "guj", text: "નમસ્તે દુનિયા આજે" },
  { code: "pan", text: "ਪੰਜਾਬੀ ਭਾਸ਼ਾ ਅੱਜ" },
  { code: "tam", text: "வணக்கம் உலகம் இன்று" },
  { code: "tel", text: "నమస్కారం ప్రపంచం ఈరోజు" },
  { code: "chi_tra", text: "繁體中文測試", unspaced: true },
  { code: "swa", text: "Habari ya dunia leo" },
];

/** The HTML page Chromium types a sample on. Content-free beyond the words. */
export function samplePageHtml(sample: OcrLanguageSample): Uint8Array {
  const dir = sample.rtl ? "rtl" : "ltr";
  const html = `<!doctype html><html lang="${sample.code}" dir="${dir}"><head><meta charset="utf-8"><title>sample</title><style>body{margin:48px;background:#fff;color:#000}p{font-size:44px;line-height:1.6;margin:0}</style></head><body><p>${sample.text}</p></body></html>`;
  return new TextEncoder().encode(html);
}

/**
 * Comparison form. NFKC folds Arabic presentation forms to their letters;
 * ZWJ/ZWNJ are dropped (Tesseract keeps or drops them at will); Arabic yeh
 * and kaf are folded to the Persian letters, which Tesseract's Persian model
 * and the browser's text disagree on; Greek is compared without accents.
 */
function fold(text: string, code: OcrLanguage): string {
  let out = text.normalize("NFKC").replace(/[‌‍‏‎]/g, "");
  out = out.replace(/ي/g, "ی").replace(/ك/g, "ک");
  if (code === "ell")
    out = out.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  return out.toLowerCase();
}

const tokens = (text: string) => text.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);

/**
 * Whether `read` carries the sample's words, in its reading order. For an
 * unspaced script, its characters with whitespace removed must appear as one
 * run. The detail names what was missing, never the recognised text.
 */
export function sampleVerdict(
  sample: OcrLanguageSample,
  read: string,
): { ok: boolean; detail: string } {
  const have = fold(read, sample.code);
  if (sample.unspaced) {
    const want = fold(sample.text, sample.code).replace(/\s+/g, "");
    const ok = have.replace(/\s+/g, "").includes(want);
    return {
      ok,
      detail: ok
        ? `all ${[...want].length} characters, in order`
        : `the ${[...want].length} characters were not read as one run (${have.length} characters of text)`,
    };
  }
  const want = tokens(fold(sample.text, sample.code));
  const got = tokens(have);
  const missing = want.filter((w) => !got.includes(w));
  if (missing.length > 0)
    return {
      ok: false,
      detail: `${missing.length} of ${want.length} words missing (${missing.join(" ")}); ${got.length} words read`,
    };
  // In order: each word found after the previous one.
  let at = -1;
  for (const w of want) {
    const next = got.indexOf(w, at + 1);
    if (next < 0)
      return {
        ok: false,
        detail: `all ${want.length} words read, but not in reading order`,
      };
    at = next;
  }
  return { ok: true, detail: `all ${want.length} words, in reading order` };
}

/** The output of `tesseract --list-langs`, as language codes. */
export function parseListLangs(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[a-z][a-z0-9_]*$/i.test(l) && l !== "osd");
}

export interface OcrLanguagesProofDeps {
  /** `tesseract --list-langs` (stdout + stderr), or null when it cannot run. */
  listLangs: () => Promise<string | null>;
  /** The image's Chromium, through the HTML to PDF runner; null if absent. */
  renderHtml: ((html: Uint8Array) => Promise<Uint8Array>) | null;
  /** A typed PDF → a scan of its first page (pixels only). */
  scan: (typed: Uint8Array) => Promise<Uint8Array>;
  /** poppler's text of a PDF; null when pdftotext is absent. */
  pdfText: ((pdf: Uint8Array) => Promise<string>) | null;
  /** The registry's OCR processor (what `ocr-pdf` jobs reach). */
  ocr: Processor;
  /** The registry's PDF to Office processor, wired to that OCR processor. */
  pdfToWord: Processor;
  /** A DOCX's paragraphs as Word reads them. */
  docxText: (docx: Uint8Array) => Promise<string>;
  /** Which samples to run; default all. */
  samples?: readonly OcrLanguageSample[];
  log?: (line: string) => void;
}

const PDF = "application/pdf";

function input(tool: string, bytes: Uint8Array, options: object) {
  return {
    tool,
    options: options as Record<string, unknown>,
    inputs: [
      { fileId: "proof", filename: "scan.pdf", contentType: PDF, bytes },
    ],
  };
}

function artifact(
  result: ProcessorResult,
  match: (filename: string, type: string) => boolean,
): Uint8Array | null {
  if (!result.ok) return null;
  return (
    result.artifacts.find((a) => match(a.filename, a.contentType))?.bytes ??
    null
  );
}

export async function runOcrLanguagesProof(
  deps: OcrLanguagesProofDeps,
): Promise<0 | 1 | 2> {
  const log = deps.log ?? ((line: string) => console.log(line));
  let failed = 0;
  const check = (ok: boolean, name: string, detail: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
    if (!ok) failed += 1;
  };

  // ── 1. packs ─────────────────────────────────────────────────────────────
  const listed = await deps.listLangs();
  if (listed === null) {
    log("MISSING tesseract: the language proof cannot run in this image.");
    return 2;
  }
  const installed = new Set(parseListLangs(listed));
  // HEALTH: the parse read a real list, and the declared set is the full one.
  check(
    installed.has("eng") && installed.size >= 2,
    "list-langs parse",
    `${installed.size} languages listed`,
  );
  check(
    OCR_LANGUAGE_CODES.length >= 35,
    "declared set",
    `${OCR_LANGUAGE_CODES.length} languages offered`,
  );
  const missing = OCR_LANGUAGE_CODES.filter((c) => !installed.has(c));
  check(
    missing.length === 0,
    "every offered language is installed",
    missing.length === 0
      ? `${OCR_LANGUAGE_CODES.length} of ${OCR_LANGUAGE_CODES.length}`
      : `missing ${missing.join(", ")}`,
  );

  if (!deps.renderHtml || !deps.pdfText || !deps.ocr.capability().ready) {
    log(
      `MISSING ${!deps.renderHtml ? "Chromium" : !deps.pdfText ? "pdftotext" : "a ready OCR engine"}: the recognition proof cannot run in this image.`,
    );
    return 2;
  }

  // ── 2 + 3. recognition, then PDF to Word ────────────────────────────────
  const samples = deps.samples ?? OCR_LANGUAGE_SAMPLES;
  check(
    samples.length >= 10 &&
      samples.every((s) => OCR_LANGUAGE_CODES.includes(s.code)),
    "sample set",
    `${samples.length} samples, every one an offered language`,
  );
  const wordCodes: ReadonlySet<string> = new Set(
    PDF_TO_WORD_OCR_LANGUAGE_CODES,
  );
  let greekScan: Uint8Array | null = null;
  for (const sample of samples) {
    const name = `${sample.code}${sample.rtl ? " (rtl)" : ""}`;
    let scan: Uint8Array;
    try {
      const typed = await deps.renderHtml(samplePageHtml(sample));
      // The typed page has a text layer and the scan has none, so only OCR
      // can bring the words back. The typed layer is NOT held to the
      // sample's words: Chromium's ToUnicode for shaped scripts (Arabic
      // joining, Indic conjuncts) does not read back as the input — measured
      // 2026-10-25 with pdf.js on 9 of the 13 samples — and a fixture check
      // that fails for the fixture's reason would hide the engine's.
      const typedText = (await deps.pdfText(typed)).trim();
      check(
        typedText.length > 0,
        `${name} typed page has a text layer`,
        `${typedText.length} characters`,
      );
      scan = await deps.scan(typed);
      const leftover = (await deps.pdfText(scan)).trim();
      check(
        leftover.length === 0,
        `${name} scan has no text`,
        `${leftover.length} characters`,
      );
    } catch (error) {
      check(false, `${name} fixture`, (error as Error).message);
      continue;
    }
    if (sample.code === "ell") greekScan = scan;

    const run = await deps.ocr.process(
      input("ocr-pdf", scan, { languages: [sample.code], outputMode: "both" }),
    );
    if (!run.ok) {
      check(
        false,
        `${name} ocr-pdf`,
        `${run.error.code}: ${run.error.message}`,
      );
      continue;
    }
    const txt = artifact(run, (f) => f.endsWith(".txt"));
    const pdf = artifact(run, (_, t) => t === PDF);
    const sidecar = sampleVerdict(
      sample,
      txt ? new TextDecoder().decode(txt) : "",
    );
    check(sidecar.ok, `${name} ocr-pdf text sidecar`, sidecar.detail);
    const layer = sampleVerdict(sample, pdf ? await deps.pdfText(pdf) : "");
    check(layer.ok, `${name} ocr-pdf searchable PDF text layer`, layer.detail);

    if (!wordCodes.has(sample.code)) {
      log(`SKIP ${name} pdf-to-word: not offered by PDF to Word's OCR option`);
      continue;
    }
    const word = await deps.pdfToWord.process(
      input("pdf-to-word", scan, { ocr: true, languages: [sample.code] }),
    );
    if (!word.ok) {
      check(
        false,
        `${name} pdf-to-word (ocr)`,
        `${word.error.code}: ${word.error.message}`,
      );
      continue;
    }
    const docx = artifact(word, (f) => f.endsWith(".docx"));
    const inDocx = sampleVerdict(sample, docx ? await deps.docxText(docx) : "");
    check(inDocx.ok, `${name} pdf-to-word (ocr) DOCX`, inDocx.detail);
  }

  // ── positive control ─────────────────────────────────────────────────────
  const greek = samples.find((s) => s.code === "ell");
  if (greek && greekScan) {
    const wrong = await deps.ocr.process(
      input("ocr-pdf", greekScan, { languages: ["eng"], outputMode: "text" }),
    );
    const txt = artifact(wrong, (f) => f.endsWith(".txt"));
    const verdict = sampleVerdict(
      greek,
      txt ? new TextDecoder().decode(txt) : "",
    );
    check(
      wrong.ok && !verdict.ok,
      "POSITIVE CONTROL: Greek read as English fails the verdict",
      wrong.ok ? verdict.detail : `${wrong.error.code}: ${wrong.error.message}`,
    );
  }

  log(
    failed === 0
      ? "OCR LANGUAGES PROOF: PASS"
      : `OCR LANGUAGES PROOF: ${failed} FAILED`,
  );
  return failed === 0 ? 0 : 1;
}
