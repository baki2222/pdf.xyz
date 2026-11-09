/**
 * The deployment proof for OCR inside Translate PDF (audit translate-pdf#3):
 * the page it scans, and the verdict on what comes back.
 *
 * `scripts/worker-prove-tools.ts` (group `translate-ocr`, specs in
 * `@/tests/ai-proof-specs`) types this German page with pdf-lib, rasterises
 * it into a scan with no text layer, and sends that scan to Translate PDF
 * with an OCR request in German, into English. A pass needs BOTH halves of
 * the claim:
 *
 *  - the translation holds the English words for what the page says — a
 *    worker that ignored the request refuses the scan, and one that ran OCR
 *    in the wrong language hands the model gibberish (OCR success is not
 *    correctness);
 *  - the job record says OCR ran (`results.ocr`) — and, for the CONTROL, that
 *    it did not: the same request on the typed page (which has text) must
 *    translate without OCR.
 *
 * The words are plain, concrete nouns a translation cannot avoid: "Hund"
 * has one English rendering a reader would accept, and so do the others.
 */
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import type { JobResults } from "@/lib/jobs/results";

/** What the page says, sentence by sentence. */
export const TRANSLATE_OCR_PROOF_SENTENCES = [
  "Der Hund schläft im Garten.",
  "Die Katze trinkt kalte Milch.",
  "Das Fahrrad vor dem Haus ist rot.",
] as const;

/** English words the translation must contain (case-insensitive, whole words). */
export const TRANSLATE_OCR_PROOF_WORDS = ["dog", "cat", "milk", "red"] as const;

/** What the proof job asks: German in, English out, OCR in German. */
export const TRANSLATE_OCR_PROOF_OPTIONS: Readonly<Record<string, unknown>> = {
  targetLanguage: "en",
  sourceLanguage: "de",
  ocr: true,
  languages: ["deu"],
};

/**
 * The typed page: one A4 page, the sentences in 24 pt through the product's
 * font chooser, so a 300 dpi scan reads cleanly.
 */
export async function translateOcrProofPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, TRANSLATE_OCR_PROOF_SENTENCES);
  const page = doc.addPage([595, 842]);
  TRANSLATE_OCR_PROOF_SENTENCES.forEach((sentence, i) => {
    page.drawText(sentence, { x: 56, y: 760 - i * 48, size: 24, font });
  });
  return doc.save();
}

/**
 * Judge a translation package against the proof page.
 *
 * `ocr` says which run this is: `"ran"` for the scan (OCR must have run),
 * `"skipped"` for the typed control (it must not have).
 */
export async function translateOcrProofVerdict(
  zipBytes: Uint8Array,
  results: JobResults | undefined,
  ocr: "ran" | "skipped",
): Promise<{ ok: boolean; detail: string }> {
  let text: string;
  try {
    const zip = await JSZip.loadAsync(zipBytes);
    const file = zip.file("translation.txt");
    if (!file)
      return { ok: false, detail: "the package has no translation.txt" };
    text = await file.async("string");
  } catch (error) {
    return {
      ok: false,
      detail: `the package could not be opened: ${(error as Error).message}`,
    };
  }
  const missing = TRANSLATE_OCR_PROOF_WORDS.filter(
    (word) => !new RegExp(`\\b${word}\\b`, "i").test(text),
  );
  const ocrRan = results?.ocr !== undefined;
  const ocrRight = ocr === "ran" ? ocrRan : !ocrRan;
  const ok = missing.length === 0 && ocrRight;
  const words =
    missing.length === 0
      ? `all ${TRANSLATE_OCR_PROOF_WORDS.length} expected English words`
      : `missing ${missing.join(", ")}`;
  const ocrSaid = ocrRan ? "OCR ran" : "no OCR ran";
  return {
    ok,
    detail: `${words}; ${ocrSaid} (wanted ${ocr === "ran" ? "OCR" : "no OCR"}); ${text.length} characters translated`,
  };
}
