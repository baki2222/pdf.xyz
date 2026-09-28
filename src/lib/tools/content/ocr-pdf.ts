import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  DEFAULT_OCR_LANGUAGE,
  MAX_OCR_LANGUAGES,
  OCR_LANGUAGES,
  OCR_MIN_WORDS_FOR_CONFIDENCE_ADVICE,
  OCR_OUTPUT_MODES,
  describeOcrLanguage,
  type OcrLanguage,
  type OcrOutputMode,
} from "@/lib/jobs/ocr";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/ocr-worker-panel.tsx — control labels ("Languages",
 *    "Output", "Skip pages that already have text", the "Add a scan to OCR"
 *    drop zone, "Run OCR on the worker"), English preselected, the per-job
 *    language cap, the "Recognition summary", one file per run;
 *  - src/lib/workers/ocr-native.ts — PDFs go to OCRmyPDF (text layer added to
 *    the existing pages, `--skip-text` only when ticked, no `--deskew` or
 *    `--rotate-pages`), JPG/PNG go to Tesseract (no OSD either); outputs are
 *    named `<name>-ocr.pdf` and `<name>.txt`; a confidence figure exists for
 *    image inputs only (tsvOut is null for OCRmyPDF). The inline comment near
 *    the meta build in that file still says meanConfidence is always null —
 *    that comment is stale; the code (readConfidence over the TSV) and
 *    OcrResultMeta's own docblock agree with the FAQ below;
 *  - src/lib/jobs/ocr.ts — the language list, the cap, the output modes;
 *  - src/lib/workers/processor/ocr.ts — a selected language with no installed
 *    pack is refused by name before the runner is called (nativeOcrDeps always
 *    supplies installedLanguages when OCR is enabled, so the check runs);
 *  - the language chips are toggle buttons (aria-pressed), not checkboxes, so
 *    the copy says "select" for them and "tick" only for the skip-text box;
 *    the run area renders only once /api/worker/status reports OCR available;
 *  - src/lib/workers/ocr-native-config.ts — the engine subprocess has a hard
 *    timeout (env-tunable, so no figure is stated here);
 *  - src/lib/workers/pdf-office-export/engine.ts — PDF to Word writes the
 *    extracted text as paragraphs, which is all the OCR FAQ promises of it.
 * The "${LANGUAGE_COUNT} languages" figure has two bounds besides the list:
 * src/deploy/ocr-languages.test.ts fails CI when the Dockerfile stops installing
 * a pack for any OCR_LANGUAGES code, and on 2026-09-27 production
 * /api/worker/status listed every code as installed on the running worker. The
 * worker image is built by hand, so the first bound does not prove the second;
 * if they ever diverge, the job still refuses the missing language by name.
 * The panel does NOT narrow its picker to the installed list, so no sentence
 * here claims the page reflects it.
 * Not claimed, because it is OCRmyPDF's behaviour rather than this repo's: what
 * an unticked skip-text run does with a PDF that already has text.
 * Every number is interpolated from the constant that owns it.
 */

/** The per-file cap a worker-tier upload is refused above, in whole MB. */
const CEILING_MB = Math.round(WORKER_FILE_CEILING / (1024 * 1024));
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
const LANGUAGE_COUNT = OCR_LANGUAGES.length;

/** Typed as OcrLanguage, so removing one of these from the list fails the build. */
const NON_LATIN_EXAMPLES: readonly OcrLanguage[] = [
  "ben",
  "ara",
  "chi_sim",
  "hin",
];
const NON_LATIN = new Intl.ListFormat("en", { type: "conjunction" }).format(
  NON_LATIN_EXAMPLES.map(describeOcrLanguage),
);
const SHORT_NON_LATIN = NON_LATIN_EXAMPLES.slice(0, 2)
  .map(describeOcrLanguage)
  .join(" and ");
const DEFAULT_LANGUAGE = describeOcrLanguage(DEFAULT_OCR_LANGUAGE);

/** The output chip labels exactly as the panel renders them. */
function modeLabel(id: OcrOutputMode): string {
  const mode = OCR_OUTPUT_MODES.find((entry) => entry.id === id);
  if (!mode) throw new Error(`ocr-pdf content names unknown output mode ${id}`);
  return mode.label;
}
const PDF_MODE = modeLabel("searchable-pdf");
const TEXT_MODE = modeLabel("text");
const BOTH_MODE = modeLabel("both");

const content: ToolContent = {
  slug: "ocr-pdf",

  seoTitle: "OCR PDF Online: Make Scanned PDFs Searchable",

  metaDescription: `OCR a scanned PDF, JPG or PNG in ${LANGUAGE_COUNT} languages including ${SHORT_NON_LATIN}. Download a searchable PDF, a plain TXT file, or both. No account.`,

  intro: [
    `A scanner or phone camera saves each page as a picture, so Ctrl+F finds nothing and no sentence can be copied out. OCR PDF reads the lettering and returns it as real text. For a PDF, your pages stay as they are and an invisible text layer is laid underneath, so the document looks the same but becomes searchable and selectable. Send a JPG or PNG instead, such as a photographed receipt or a screenshot of a form, and any PDF you ask for comes back as a single page holding that image with the recognised words beneath it.`,
    `Recognition needs a native OCR engine, so this online tool does not run in your browser. Your file is uploaded over TLS to pdf.xyz's secure worker, which runs OCRmyPDF on PDFs and Tesseract on images. The input is deleted when the job finishes, the download link expires after ${OUTPUT_TTL} minutes, and a daily storage rule then erases the stored result. One scan goes in per run, at most ${CEILING_MB} MB.`,
    `Of every choice on the page, the language is the one most likely to spoil a result. ${LANGUAGE_COUNT} are on offer, with ${NON_LATIN} among them, and a single job can combine up to ${MAX_OCR_LANGUAGES}. Picking the wrong one does not produce an error: the engine matches shapes against the alphabet it was given and returns fluent-looking nonsense.`,
  ],

  useCases: [
    {
      title: "Search an archive of scanned letters",
      body: "Old correspondence, deeds or minutes digitised as images become findable by name, date or phrase with a PDF viewer's search once each file carries a text layer. The tool takes one file per run, so work through a folder in turn.",
    },
    {
      title: "Copy a paragraph out of a photographed page",
      body: `Choose ${TEXT_MODE} and you get only the recognised words in a .txt file, ready to paste into an email or document without retyping from the photo.`,
    },
    {
      title: "Read a mixed-language document",
      body: `A form printed in ${describeOcrLanguage("ben")} with English headings, or an ${describeOcrLanguage("ara")} contract with French clauses, needs every language on the page selected. Up to ${MAX_OCR_LANGUAGES} can be selected for one run.`,
    },
    {
      title: "Finish a PDF that is only partly scanned",
      body: "When typed pages and scanned pages sit in the same file, tick Skip pages that already have text so the typed pages are left untouched and only the image pages are recognised. A scanned page that already carries any text, such as a digitally added stamp or header, counts as typed and is skipped too.",
    },
  ],

  steps: [
    {
      title: "Select the languages printed on the page",
      body: `Under Languages, ${DEFAULT_LANGUAGE} is selected to start with. Add every language the document actually uses, up to ${MAX_OCR_LANGUAGES}; to swap one out once you are at the limit, deselect a language first.`,
    },
    {
      title: "Choose what you want back",
      body: `Under Output, pick ${PDF_MODE}, ${TEXT_MODE} (a .txt file), or ${BOTH_MODE}. Tick Skip pages that already have text if part of the PDF was typed rather than scanned.`,
    },
    {
      title: "Add the scan and run it",
      body: `Drop one PDF, JPG or PNG into the Add a scan to OCR area and press Run OCR on the worker. That area appears only after the page confirms the OCR worker is available, and your file is sent only when you press the button.`,
    },
    {
      title: "Download and check the result",
      body: `Each file appears as a download button named after your original, with -ocr added to the PDF, above a Recognition summary of what was produced. Save each file within ${OUTPUT_TTL} minutes of the job finishing, because its link expires then.`,
    },
  ],

  faqs: [
    {
      q: "Why does my OCR output look like gibberish?",
      a: `Usually the selected language does not match the page. ${describeOcrLanguage("ben")} read as English comes back as Latin characters that look plausible and mean nothing, with no error. The file stays loaded after a run, so change the language selection and press Run OCR on the worker again. Blurry, skewed or low-resolution scans cause the same symptom, and neither engine is told to straighten or auto-rotate pages, so turn a sideways PDF page upright with Rotate PDF before recognising it.`,
    },
    {
      q: "Does OCR change how my PDF looks?",
      a: `The ${PDF_MODE} output keeps your pages and adds hidden text underneath them, so it looks like the scan you uploaded. The words are not made editable on the page. To rewrite them, run the OCR'd file through PDF to Word, which turns its new text layer into plain paragraphs in a DOCX.`,
    },
    {
      q: "Can I OCR a photo or screenshot?",
      a: `Yes, JPG and PNG are accepted. Images are read by Tesseract, whose per-word scores give the Recognition summary a Confidence row, plus a low-confidence warning when at least ${OCR_MIN_WORDS_FOR_CONFIDENCE_ADVICE} words were recognised and their scores come out poor. PDFs go through OCRmyPDF, which reports no confidence, so that row is absent for them.`,
    },
    {
      q: "Which languages are supported, and can I mix them?",
      a: `The menu lists ${LANGUAGE_COUNT}, from English and Spanish to ${NON_LATIN}, and one job can combine up to ${MAX_OCR_LANGUAGES}. If the worker ever lacks the recognition pack for a language you selected, the job stops before recognition starts and the error names that language, instead of blaming your file.`,
    },
    {
      q: "What happens to my file on the worker?",
      a: `It is uploaded over TLS, recognised on pdf.xyz's secure worker, and the input is deleted when the job ends. You have ${OUTPUT_TTL} minutes to download the result before its link expires, and a daily storage rule clears the stored output after that. The tool never asks you to create an account.`,
    },
    {
      q: "How big a scan can I process, and how many at once?",
      a: `One file per run, up to ${CEILING_MB} MB. For the next document, press Remove beside the current file name, add the new scan and run again: your languages and output choice stay as you left them until you reload the page. Size is not the only limit, since every page takes recognition time and a job has a time limit on the worker, so cut a very long scan into parts with Split PDF first.`,
    },
  ],

  relatedGuides: [
    "how-to-make-a-scanned-pdf-searchable",
    "how-to-convert-pdf-to-word",
    "how-to-translate-a-pdf",
  ],
};

export default content;
