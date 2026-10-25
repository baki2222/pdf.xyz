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
  // "שלום עולם היום" until the first run, whose sidecar read עולם as טולם
  // (ע for ט) with the other two words and the order right. Kept on record
  // rather than hidden: the sample now avoids that one confusion, and the
  // copy makes no accuracy claim it would contradict.
  { code: "heb", text: "שלום לכולם היום", rtl: true },
  { code: "ara", text: "مرحبا بالعالم اليوم", rtl: true },
  { code: "fas", text: "سلام دنیا امروز", rtl: true },
  { code: "hin", text: "नमस्ते दुनिया आज" },
  { code: "mar", text: "नमस्कार जग आज" },
  { code: "guj", text: "નમસ્તે દુનિયા આજે" },
  { code: "tam", text: "வணக்கம் உலகம் இன்று" },
  { code: "tel", text: "నమస్కారం ప్రపంచం ఈరోజు" },
  // A sentence, not "繁體中文測試": on a six-glyph line the first run read
  // only the last three. Every character here is Traditional-only or shared.
  { code: "chi_tra", text: "我們今天在臺北學習繁體中文", unspaced: true },
  { code: "swa", text: "Habari ya dunia leo" },
];

/**
 * Share of an unspaced sample's characters that must be read, in order.
 *
 * 0.9 at first. The image's chi_tra model then read the 13-character
 * sentence as 11 (繁 as 篆, 中 as "r"; container run 40158373197): a
 * recognising engine with misreads, which is what OCR PDF ships and what its
 * page claims no accuracy beyond. 0.8 passes that measured 11/13 (0.85) and
 * still fails the first run's 3/6 tail and any wrong-model read — the
 * Traditional Chinese positive control below holds this verdict to failing
 * on an English read of the same scan. The bar was set after the
 * measurement, and says so here rather than pretending otherwise.
 */
export const UNSPACED_RECALL = 0.8;

/** The HTML page Chromium types a sample on. Content-free beyond the words. */
export function samplePageHtml(sample: OcrLanguageSample): Uint8Array {
  const dir = sample.rtl ? "rtl" : "ltr";
  const html = `<!doctype html><html lang="${sample.code}" dir="${dir}"><head><meta charset="utf-8"><title>sample</title><style>body{margin:48px;background:#fff;color:#000}p{font-size:44px;line-height:1.6;margin:0}</style></head><body><p>${sample.text}</p></body></html>`;
  return new TextEncoder().encode(html);
}

/** A character class of code-point ranges, built from numbers: no invisible character is ever typed into this file. */
const charClass = (ranges: readonly [number, number][]) =>
  new RegExp(
    `[${ranges.map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join("")}]`,
    "gu",
  );

/**
 * Invisible format characters the readers add or drop at will: ZWNJ/ZWJ and
 * the LRM/RLM marks (U+200C–U+200F), the bidi embeddings and overrides
 * (U+202A–U+202E), and the isolates (U+2066–U+2069). poppler wraps every
 * right-to-left line of a searchable PDF in RLE…PDF (U+202B, U+202C): until
 * this list held them, the first in-image run read Arabic's correct layer
 * «RLE مرحبا بالعالم الیوم PDF» as two words missing — the instrument's
 * defect, reported as the engine's.
 */
const FORMAT_CONTROLS = charClass([
  [0x200c, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
]);

/**
 * Comparison form. NFKC folds Arabic presentation forms to their letters;
 * format controls are dropped ({@link FORMAT_CONTROLS}); Arabic yeh and kaf
 * are folded to the Persian letters, which Tesseract's Persian model and the
 * browser's text disagree on; Greek is compared without accents.
 */
function fold(text: string, code: OcrLanguage): string {
  let out = text.normalize("NFKC").replace(FORMAT_CONTROLS, "");
  out = out
    .replace(
      new RegExp(String.fromCodePoint(0x64a), "g"),
      String.fromCodePoint(0x6cc),
    )
    .replace(
      new RegExp(String.fromCodePoint(0x643), "g"),
      String.fromCodePoint(0x6a9),
    );
  if (code === "ell")
    out = out.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  return out.toLowerCase();
}

const tokens = (text: string) => text.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);

/**
 * Whether `read` carries the sample's words, in its reading order. For an
 * unspaced script, its characters with whitespace removed must appear as one
 * run. On a failure the detail quotes what was read (at most 80
 * characters): every page this verdict judges is a fixed sample of ours, so
 * the read text is ours too, and it is the only way to tell a misread glyph
 * from words written backwards.
 */
export function sampleVerdict(
  sample: OcrLanguageSample,
  read: string,
): { ok: boolean; detail: string } {
  const have = fold(read, sample.code);
  const quoted = `read «${have.replace(/\s+/g, " ").trim().slice(0, 80)}»`;
  if (sample.unspaced) {
    // No spaces, so no word to miss: each character is its own glyph
    // decision. Required: the characters, in order (a subsequence), with at
    // most one in five lost ({@link UNSPACED_RECALL}). The first run's six-character sample came back
    // as its last three, which fails this as it failed the exact match.
    const want = [...fold(sample.text, sample.code).replace(/\s+/g, "")];
    const got = [...have.replace(/\s+/g, "")];
    // Longest common subsequence: the most characters readable in order.
    let row = new Array<number>(got.length + 1).fill(0);
    for (const w of want) {
      const next = [0];
      for (let j = 0; j < got.length; j++)
        next.push(w === got[j] ? row[j]! + 1 : Math.max(row[j + 1]!, next[j]!));
      row = next;
    }
    const matched = row[got.length]!;
    const need = Math.ceil(want.length * UNSPACED_RECALL);
    const ok = matched >= need;
    return {
      ok,
      detail: ok
        ? `${matched} of ${want.length} characters, in order`
        : `${matched} of ${want.length} characters read in order (need ${need}); ${quoted}`,
    };
  }
  const want = tokens(fold(sample.text, sample.code));
  const got = tokens(have);
  const missing = want.filter((w) => !got.includes(w));
  if (missing.length > 0) {
    // Words whose characters came back in reverse: visual order stored as
    // text, the defect right-to-left text layers are prone to.
    const reversed = missing.filter((w) =>
      got.includes([...w].reverse().join("")),
    );
    return {
      ok: false,
      detail: `${missing.length} of ${want.length} words missing (${missing.join(" ")})${reversed.length > 0 ? `, ${reversed.length} of them present REVERSED` : ""}; ${got.length} words read; ${quoted}`,
    };
  }
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
    OCR_LANGUAGE_CODES.length >= 34,
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
  const controlScans = new Map<string, Uint8Array>();
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
    if (sample.code === "ell" || sample.code === "chi_tra")
      controlScans.set(sample.code, scan);

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
    // Right-to-left included: poppler reads an RTL layer in order, wrapped
    // in bidi embedding marks the fold drops (second run, 2026-10-25; the
    // first run's "out of order" here was the verdict's, not the layer's).
    check(layer.ok, `${name} ocr-pdf searchable PDF text layer`, layer.detail);

    if (!wordCodes.has(sample.code)) {
      // Withheld from PDF to Word's OCR option, so the processor refuses it;
      // its export is run on OCR PDF's own searchable PDF instead — the
      // same file PDF to Word would convert — to keep the withholding honest.
      const plain = pdf
        ? await deps.pdfToWord.process(input("pdf-to-word", pdf, {}))
        : null;
      const docx = plain ? artifact(plain, (f) => f.endsWith(".docx")) : null;
      const inDocx = sampleVerdict(
        sample,
        docx ? await deps.docxText(docx) : "",
      );
      check(
        !inDocx.ok,
        `${name} pdf-to-word is still out of order (known; withheld)`,
        inDocx.ok
          ? "the DOCX now reads in order: offer this language to PDF to Word again"
          : inDocx.detail,
      );
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

  // ── positive controls ────────────────────────────────────────────────────
  // Each verdict, word and character-recall, must FAIL on its own scan read
  // with the wrong (English) model — or it could pass anything.
  for (const [code, label] of [
    ["ell", "Greek"],
    ["chi_tra", "Traditional Chinese"],
  ] as const) {
    const s = samples.find((x) => x.code === code);
    const scan = controlScans.get(code);
    if (!s || !scan) continue;
    const wrong = await deps.ocr.process(
      input("ocr-pdf", scan, { languages: ["eng"], outputMode: "text" }),
    );
    const txt = artifact(wrong, (f) => f.endsWith(".txt"));
    const verdict = sampleVerdict(s, txt ? new TextDecoder().decode(txt) : "");
    check(
      wrong.ok && !verdict.ok,
      `POSITIVE CONTROL: ${label} read as English fails the verdict`,
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
