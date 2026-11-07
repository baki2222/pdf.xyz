/**
 * What the OCR language picker starts on, said once for every page that
 * describes it.
 *
 * `useOcrLanguageChoice` (components/tools/ocr-language-picker.tsx) starts
 * from `chosen ?? fromBrowser ?? [DEFAULT_OCR_LANGUAGE]`: the browser's
 * languages that the catalogue has, with the default always kept
 * (`ocrLanguagesFromBrowser`), else the default alone. A tool that offers
 * fewer languages (PDF to Word leaves out right-to-left scripts) drops a
 * browser pick it does not offer, and the pick is capped — hence "languages",
 * never "the languages". `ocr-start-copy.test.ts` holds this sentence to the
 * hook, and every guide and tool page that states the start to this sentence.
 *
 * No trailing period, so it can open a clause: "…; deselect any…".
 */
import { DEFAULT_OCR_LANGUAGE, describeOcrLanguage } from "./ocr";

export const OCR_START_SENTENCE = `${describeOcrLanguage(DEFAULT_OCR_LANGUAGE)} is selected when the page opens, with languages your browser is set to where the picker offers them`;
