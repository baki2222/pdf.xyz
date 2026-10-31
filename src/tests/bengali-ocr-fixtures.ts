/**
 * The page the Bengali OCR proof has the worker's Chromium type. Here, beside
 * the other proof fixtures, rather than in `@/lib/probes/bengali-ocr-proof`
 * (which holds the truth, the measure and the bars): it is markup for an
 * engine, not words for a reader.
 */
import { BENGALI_PROOF_SENTENCES } from "@/lib/probes/bengali-ocr-proof";

/**
 * A4 (set by the job's options), body text at 16 CSS px (12 pt), the size of
 * a printed letter or form — not the 44 px display size of the language
 * samples, which flatters any engine. One paragraph per sentence.
 */
export function bengaliProofHtml(): Uint8Array {
  const paragraphs = BENGALI_PROOF_SENTENCES.map((s) => `<p>${s}</p>`).join("");
  const html = `<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>bn</title><style>body{margin:64px;background:#fff;color:#000}p{font-size:16px;line-height:1.7;margin:0 0 14px}</style></head><body>${paragraphs}</body></html>`;
  return new TextEncoder().encode(html);
}
