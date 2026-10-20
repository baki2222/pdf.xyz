/**
 * The guides catalogue — every how-to article, as data.
 *
 * House rules for this file, enforced by the walls it is registered into
 * (copy-surface, the numbers census, legal-pages' overclaim scan,
 * capability-hedges, and its own catalog.test.ts):
 *
 *  - No hand-written figures. Every number with a unit is interpolated from
 *    the constant that governs the behavior, so the prose cannot go stale
 *    under a changed cap. No trailing unit comments either — only full-line
 *    comments are stripped by the copy walls.
 *  - Claims are grounded in the tools catalogue and tool-facts. Each guide
 *    was drafted from those sources and adversarially verified against them
 *    (two lenses per draft, plus a re-check after revision) before assembly.
 *  - Steps tell the truth about where the primary tool runs: in-browser
 *    guides never say upload; worker-backed guides always do.
 */
import { getToolBySlug } from "@/lib/tools";
import { STAMP_POSITIONS } from "@/lib/pdf/stamp";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { MAX_IMAGE_MB, MAX_SOURCE_MB } from "@/lib/tools/limits";
import {
  IMAGE_PAGE_MARGIN_PT,
  US_LETTER_LABEL,
  inches,
} from "@/lib/pdf/page-geometry";
import { HYBRID_WORKER_STEP } from "@/lib/tools/processing";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { OCR_LANGUAGES, MAX_OCR_LANGUAGES } from "@/lib/jobs/ocr";
import { aiAllowanceFactFor } from "@/lib/jobs/ai-allowance";
import {
  EVERY_OTHER_PAGE_EXAMPLE,
  MARKDOWN_SYNTAX_FACT,
  PDF_TO_WORD_KEEPS,
  pageToolKeeps,
  pageToolKeepsAnswer,
  REDACT_MECHANISM,
  REDACT_OUTPUT_FACT,
  REDACT_PRESET_CHOICES,
  REDACT_RECOVERY_ANSWER,
  REDACT_SEARCH_ANSWER,
  REPAIR_TAKES,
  REPAIR_WARNINGS_ANSWER,
  TEXT_PAGE_FACT,
  TRANSLATE_LANGUAGES_ANSWER,
  countWord,
  forgottenPasswordAnswer,
  offlineAnswer,
} from "@/lib/tools/tool-facts";
import { TRANSLATE_LANGUAGES } from "@/lib/jobs/translate-pdf";
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_RESOLUTION_ID,
  RASTER_MAX_DEVICE_PX,
  RASTER_PREVIEW_LIMIT,
  RASTER_RESOLUTION_CHOICES,
  RASTER_RESOLUTIONS,
  pageImageName,
  resolutionById,
  type RasterResolution,
} from "@/lib/pdf/pdf-to-image";
import { MAX_EDIT_IMAGE_BYTES } from "@/lib/pdf/edit";
import {
  SIGNATURE_SOURCES,
  SIGNATURE_STYLE_LABEL,
  SIGNATURE_STYLES,
} from "@/lib/pdf/offered-kinds";
import type { Guide } from "./types";

/**
 * Sign PDF's counts, from the lists the runner offers. The guide used to say
 * "five ways to make a signature", counting the typed signature once per font
 * style and naming a "print-and-scan style" the runner does not have.
 */
const signatureWays = countWord(SIGNATURE_SOURCES.length);

/** The raster preset selected when PDF to JPG / PNG opens, by its label. */
const DEFAULT_RESOLUTION_LABEL = resolutionById(DEFAULT_RESOLUTION_ID).label;
const signatureStyles = SIGNATURE_STYLES.map((s) =>
  SIGNATURE_STYLE_LABEL[s].toLowerCase(),
);

/**
 * The per-file cap a guide states, read from the SAME source the tool's own
 * page answers "How large can my file be?" from. A guide never types the
 * number; it names the tool, and the figure follows the constant.
 */
function ceilingMb(slug: string): number {
  const tool = getToolBySlug(slug);
  const mb = tool ? toolFileCeilingMb(tool) : null;
  if (mb === null) {
    throw new Error(
      `a guide states a per-file cap for "${slug}", which has no file ceiling`,
    );
  }
  return mb;
}

/**
 * A tool's CURRENT catalogue name. A guide that names a neighbour by a typed
 * string went stale the day three tools were renamed; this one cannot.
 */
function nameOf(slug: string): string {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`a guide names unknown tool "${slug}"`);
  return tool.name;
}

/**
 * A render-resolution preset a guide describes, by id — read from the list the
 * PDF-to-image runner offers. Throws rather than falling back: a guide that
 * describes "Print" must not silently describe the default instead.
 */
function rasterPreset(id: string): RasterResolution {
  const preset = RASTER_RESOLUTIONS.find((r) => r.id === id);
  if (!preset) {
    throw new Error(
      `a guide describes raster preset "${id}", which is not offered`,
    );
  }
  return preset;
}

const presetText = (r: RasterResolution) => `${r.label} (${r.dpi} DPI)`;

/** Edit PDF's per-image cap, in MB — the same arithmetic its image picker shows. */
const EDIT_IMAGE_MB = Math.round(MAX_EDIT_IMAGE_BYTES / (1024 * 1024));

export const guides: Guide[] = [
  {
    slug: "how-to-merge-pdf-files",
    title: "How to merge PDF files",
    description:
      "Combine two or more PDFs into one file, right in your browser. Drag to set the order, then merge — your files stay on your device. No account needed.",
    tools: ["merge-pdf", "split-pdf", "organize-pages"],
    keywords: [
      "how to merge pdf files",
      "merge pdf",
      "combine pdf files into one",
      "join pdfs",
      "merge pdf in browser",
    ],
    intro: [
      "To merge PDF files, open the Merge PDF tool, add two or more PDFs, and drag them into the order you want. The tool combines them into a single PDF that you save straight to your device.",
      "What makes this approach different is where the work happens. Merge PDF runs entirely in your browser, so your files stay on your device from start to finish — there is no server step in the middle. There is also no account: open the page, add your files, and merge.",
      "The combined PDF follows your list from top to bottom, so a stack of scans, chapters, or exhibits comes out exactly as you arranged it. If you later need the reverse operation, Split PDF breaks one document into separate files by page range, fixed intervals, or one file per page, and Organize Pages rearranges pages inside a single document.",
    ],
    steps: [
      "Open the Merge PDF tool.",
      "Add two or more PDF files — they stay on your device the entire time.",
      "Drag files into the order you want; the combined PDF follows your list from top to bottom.",
      "Use each row's move buttons to shift a file up or down instead of dragging.",
      "Double-check the order — the file at the top of the list becomes the opening pages of the result.",
      "Merge, then save the combined PDF to your device.",
    ],
    sections: [
      {
        id: "get-the-order-right",
        heading: "Get the order right before you merge",
        body: [
          "The merged document is built from your list, top to bottom: the first file in the list becomes the first pages of the output, and every file after it is appended in sequence. Drag files into position to set that order, or use the move buttons on each row if you prefer clicking to dragging.",
          "It is worth a final glance at the list before you merge. Reordering happens before the merge runs, so arranging the list correctly the first time saves you a second pass. If you want finer control after the fact, Organize Pages lets you reorder, rotate, duplicate, and delete pages on a visual page board.",
        ],
      },
      {
        id: "where-the-merge-runs",
        heading: "Where the merge actually runs",
        body: [
          "Merge PDF is an in-browser tool. The processing runs on your own device, and your files stay there from start to finish — they are never sent to a server as part of the merge. That also means there is no account: the browser you already have does the work.",
          `One honest nuance: the tool is not fully offline. ${offlineAnswer("merge-pdf")}`,
        ],
      },
      {
        id: "formats-and-limits",
        heading: "Inputs, output, and limits",
        body: [
          `Merge PDF accepts PDF files and produces a single PDF. Each file you add can be up to ${ceilingMb("merge-pdf")} MB, and you need at least two files for a merge to make sense — the tool is built around combining several documents into one.`,
          "If the combined document ends up heavier than you would like, Compress PDF can follow up: its lossless structural repack always runs in your browser, with deep image compression available as an optional, clearly labeled secure-worker step.",
        ],
      },
    ],
    faq: [
      {
        question: "Do my files get sent to a server when I merge PDFs?",
        answer:
          "No. Merge PDF runs entirely in your browser, and your files stay on your device from start to finish.",
      },
      {
        question: "How large can each PDF file be?",
        answer: `Each PDF you add can be up to ${ceilingMb("merge-pdf")} MB.`,
      },
      {
        question: "Can I merge PDF files without an account?",
        answer:
          "Yes. No account is required — open the tool, add two or more PDFs, set the order, and merge.",
      },
      {
        question: "Does merging PDFs work offline?",
        answer: `Not fully. ${offlineAnswer("merge-pdf")}`,
      },
      {
        question: "How do I control the page order in the combined PDF?",
        answer:
          "The output follows your file list from top to bottom. Drag files into position before merging, or use each row's move buttons. To rearrange pages inside the result afterward, Organize Pages handles reordering, rotating, duplicating, and deleting pages on a visual page board.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-split-a-pdf",
    title: "How to split a PDF into separate files",
    description:
      "Split a PDF by page range, fixed intervals, or one file per page — right in your browser, so the file never leaves your device. No account needed.",
    tools: ["split-pdf", "extract-pages", "merge-pdf"],
    keywords: [
      "how to split a pdf",
      "split pdf into separate files",
      "extract a page range from a pdf",
      "split pdf every n pages",
      "separate pdf pages",
    ],
    intro: [
      "To split a PDF into separate files, open the Split PDF tool, pick your document, and choose how to divide it: custom page ranges, every N pages, or one file per page. The split runs immediately; a single piece saves as a PDF, and several pieces download together as one ZIP.",
      "What sets this approach apart is where the work happens. Split PDF runs entirely in your browser, so the file stays on your device from start to finish — nothing is sent anywhere to be processed. There is no account to create and nothing to install; you pick a file, split it, and save the results.",
      "This guide walks through each split mode, what the output looks like, and the limits worth knowing before you start — including when a neighboring tool like Extract Pages is the better fit for the job.",
    ],
    steps: [
      "Open the Split PDF tool.",
      "Pick the PDF you want to split — it stays on your device the whole time.",
      "Choose a split mode: custom page ranges, every N pages, or one file per page.",
      "Define the split: for ranges, list the page spans that should become separate files; for the every-N-pages rule, set how many pages each piece should hold. One file per page splits at every page boundary — each page of the document becomes its own PDF.",
      "Run the split — the processing happens in your browser, not on a server.",
      "Download the result. When there is more than one piece they arrive together as a ZIP, and a single piece saves as a plain PDF. Every piece is a complete, standard PDF.",
    ],
    sections: [
      {
        id: "choose-a-split-mode",
        heading: "Choose the right split mode",
        body: [
          "Split PDF offers three ways to divide a document, and picking the right one saves rework. Custom page ranges fit documents with a known structure: give each chapter, exhibit, or section its own range and each becomes its own file. The every-N-pages rule fits uniform documents — batch scans, multi-page statements, anything that repeats at a fixed length — because you set the interval once and the tool cuts at every boundary. One file per page is the blunt instrument: every single page becomes its own PDF, useful when each page must stand alone.",
          "If what you actually want is a handful of specific pages combined into one new document — rather than the whole file divided into pieces — the Extract Pages tool is the closer fit. It lets you pick pages by clicking thumbnails or typing a range like 1-3, 5, then exports them as a brand-new PDF, also right in your browser.",
        ],
      },
      {
        id: "what-you-get",
        heading: "What the output looks like",
        body: [
          "Every piece the split produces is a complete, standard PDF that opens in any reader — no special format, no wrapper. When the split produces more than one piece, the results download together as a single ZIP, so they arrive as one download instead of a scatter of separate saves; unzip it and each range, interval, or page is there as its own file. A split that produces only one piece saves it as a plain PDF, with no archive around it. If you later need some pieces back together as one document, the Merge PDF tool combines PDFs into one, in any order — also in your browser.",
        ],
      },
      {
        id: "where-the-split-runs",
        heading: "Where the split happens",
        body: [
          "Split PDF is an in-browser tool. The processing runs entirely on your device, and the file never leaves it — there is no server step in the path from picking a file to saving the result. That also means no account: nothing about the flow requires identifying yourself.",
          `One honest nuance: the tool is not fully offline. ${offlineAnswer("split-pdf")}`,
        ],
      },
      {
        id: "limits-to-know",
        heading: "Limits to know",
        body: [
          `The tool accepts PDF input up to ${ceilingMb("split-pdf")} MB per file. Because the work happens on your device, that ceiling is the main constraint to plan around — there is no queue and no transfer to wait on. The cap applies to the input PDF you pick: a file over it is refused before any work starts, so an over-cap document cannot be split here. If you control the source, export a smaller PDF from the original application and split that.`,
        ],
      },
    ],
    faq: [
      {
        question: "Does Split PDF send my file to a server?",
        answer:
          "No. The tool runs entirely in your browser — the file stays on your device from start to finish, and the split output is produced and saved locally.",
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("split-pdf")} MB per file. The cap applies to the input PDF you pick.`,
      },
      {
        question: "Can I split a PDF so every page becomes its own file?",
        answer:
          "Yes. Choose the one-file-per-page mode and each page of the document becomes its own PDF. When the document has more than one page, the results download together as a ZIP so you get everything in one save.",
      },
      {
        question: "Does Split PDF work offline?",
        answer: `Not fully. ${offlineAnswer("split-pdf")}`,
      },
      {
        question: "What if I only need a few specific pages?",
        answer:
          "Use Extract Pages instead: pick pages by clicking thumbnails or typing a range like 1-3, 5, and export them as one brand-new PDF. It runs in your browser too, so that file also stays on your device. Split PDF is for dividing the whole document into multiple output files.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-compress-a-pdf",
    title: "How to compress a PDF",
    description:
      "Compress a PDF with a lossless repack that runs in your browser, or send image-heavy files through deep image compression on a secure, auto-deleting worker.",
    tools: ["compress-pdf", "optimize-web"],
    keywords: [
      "compress pdf",
      "reduce pdf file size",
      "shrink pdf online",
      "make a pdf smaller",
      "compress pdf without losing quality",
      "pdf size reducer",
    ],
    intro: [
      "To compress a PDF, open the Compress PDF tool, add your file, and download the lossless-optimized copy it produces right in your browser. Alongside that copy, the tool shows you a size breakdown so you can see exactly what is inflating the file — before you decide whether the optional deep image compression step is worth it.",
      "What sets this approach apart is that it keeps two very different kinds of compression explicitly separate. The analysis and the lossless repack run entirely in your browser, so on that path your PDF stays on your device from start to finish. Deep image compression — the step that downsamples images in image-heavy files — is optional and clearly labeled, and it runs on a secure, auto-deleting worker. The page checks that a worker is available before anything leaves your device.",
      "There is no account to create: add a PDF, read the breakdown, and save the result.",
    ],
    steps: [
      "Open the Compress PDF tool.",
      "Add your PDF. The analysis runs privately, right in your browser — the file stays on your device while it is inspected.",
      "Review the size breakdown to see exactly what is inflating your PDF.",
      "Download the lossless-optimized copy. The repack runs entirely in your browser, and because it is lossless, the document's content is left as it was.",
      "For image-heavy files, choose the deep image compression step. It is optional and clearly labeled: your PDF is uploaded to a secure, auto-deleting worker that downsamples the images.",
      "Before anything leaves your device, the page checks that a worker is available — the deep step starts only after that check passes.",
      `Download the compressed result. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
    ],
    sections: [
      {
        id: "lossless-repack-vs-deep-compression",
        heading: "Lossless repack vs. deep image compression",
        body: [
          "The lossless structural repack always runs in your browser. It rewrites the file's internal structure without touching the content, so it is the safe default: run it on any PDF, and if the result is small enough, you are done. The breakdown comes first, so you can see what is inflating the PDF before deciding whether the lossless pass alone will get you where you need to be.",
          "Deep image compression is the second path, and it exists for image-heavy files. It needs a native engine, so it runs as an optional, clearly labeled secure-worker step rather than in the browser: your PDF is uploaded to the worker, images are downsampled, and you download a smaller PDF. Nothing routes you there silently — you choose the step yourself, and the page confirms a worker is available before anything leaves your device.",
        ],
      },
      {
        id: "where-your-file-is-processed",
        heading: "Where your file is processed",
        body: [
          `Compress PDF is a hybrid tool, and the two paths have different privacy stories — both stated plainly. The size analysis and the lossless repack happen on your device: for that path, your PDF never leaves your browser. The optional deep image compression step is different: there, your file is uploaded to a secure worker, and inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
          "Because the availability check runs first, nothing is sent to a worker that is not there to receive it.",
        ],
      },
      {
        id: "when-compression-is-not-the-job",
        heading: "When compression is not the job",
        body: [
          `${nameOf("optimize-web")} is often mistaken for compression, and it is not: it linearizes the file so a viewer that loads a PDF in pieces can show the first page while the rest downloads. It is not meant to reduce size: the whole file is rewritten, so its size can change in either direction. Use it when the goal is a faster first page on the web, and ${nameOf("compress-pdf")} when the goal is a lighter file.`,
          `${nameOf("grayscale-pdf")} converts a PDF to black and white for printing, right in your browser. Every page becomes a grayscale image, so text is no longer selectable or searchable — a trade worth knowing before you reach for it to save space.`,
        ],
      },
      {
        id: "output-and-limits",
        heading: "What you get, and the limits",
        body: [
          `Both paths produce a PDF. The lossless copy is a repack of the same content; the deep path returns a PDF whose images have been downsampled to save space. The size breakdown you reviewed at the start is your guide: it shows exactly what is inflating the file, so you can judge whether the in-browser pass is enough or the file is image-heavy enough to justify the deep step. The per-file cap is ${ceilingMb("compress-pdf")} MB.`,
        ],
      },
    ],
    faq: [
      {
        question: "Does compressing a PDF reduce its quality?",
        answer:
          "Not on the default path. The lossless repack restructures the file without altering its content — that is what lossless means here. Deep image compression does change images: it downsamples them to save more space, which is why it is a separate, clearly labeled optional step rather than part of the default pass.",
      },
      {
        question: "Is my PDF uploaded when I compress it?",
        // The worker sentence is the tool page's own (HYBRID_WORKER_STEP): the
        // page and this guide answer the same question, so they share the words.
        answer: `Not for the analysis or the lossless repack — both run in your browser, and on that path the file stays on your device. The exception is deep image compression. ${HYBRID_WORKER_STEP}`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("compress-pdf")} MB per file.`,
      },
      {
        question: "What happens to my file after deep image compression runs?",
        answer: `The job runs on a secure worker, and inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "Will a smaller PDF also open faster on a website?",
        answer:
          "Size is only part of it. If the PDF will be read in a browser, run Optimize for Web on the compressed copy: it linearizes the file with qpdf on a secure worker, so the first page can render while the rest still downloads, and the input is deleted after the job. Linearizing reorders the file for streaming; it is not a compression step.",
      },
      {
        question: "Do I need an account to compress a PDF?",
        answer:
          "No account is needed. Open the tool, add your PDF, review the breakdown, and save the result.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-10",
  },
  {
    slug: "how-to-convert-pdf-to-word",
    title: "How to convert a PDF to an editable Word document",
    description:
      "Convert a PDF into an editable Word (DOCX) file on a secure worker that deletes the input when the job finishes. No account needed.",
    tools: ["pdf-to-word", "ocr-pdf", "word-to-pdf"],
    keywords: [
      "convert pdf to word",
      "pdf to word converter",
      "pdf to docx",
      "pdf to editable word document",
      "how to convert pdf to word",
      "turn a pdf into word",
    ],
    intro: [
      "To convert a PDF into an editable Word document, open the PDF to Word tool, upload your PDF, and download the result as a DOCX file. The conversion carries the PDF's selectable text into Word as plain paragraphs in reading order, so you edit the words instead of retyping them — the formatting is not rebuilt.",
      `PDF to Word is a server tool: your PDF travels over an encrypted connection to a secure worker, and the worker deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      `There is no account to create. Pick a PDF up to ${ceilingMb("pdf-to-word")} MB, let the worker convert it, and save the DOCX before the link expires.`,
    ],
    steps: [
      "Open the PDF to Word tool.",
      `Upload the PDF you want to convert — it travels over an encrypted connection, and files up to ${ceilingMb("pdf-to-word")} MB are accepted.`,
      "Start the conversion.",
      "Wait while the secure worker converts the PDF into a Word document. The worker deletes the input when the job finishes.",
      `Download the DOCX. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
      "Open the downloaded DOCX in Word and format the text the way you need it — the words arrive as plain paragraphs, in reading order.",
    ],
    sections: [
      {
        id: "what-you-get",
        heading: "What to expect from the converted document",
        body: [
          `The output is a DOCX file, the standard editable Word format. ${PDF_TO_WORD_KEEPS}`,
          "Headings, lists and tables arrive as plain lines of text with no styles, so expect to restyle the document: the conversion saves you the retyping, not the formatting.",
          "That makes PDF to Word the right tool when you need the words back to rework them — rewrite a paragraph, fix a date, reuse a section — and the wrong one when the look of the page is what matters. For that, keep the PDF itself.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Where the conversion runs",
        body: [
          `PDF to Word runs on a secure worker, not in your browser. Your file is uploaded over an encrypted connection, the worker processes it, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
          "You do not need an account to run the conversion — open the page, pick the file, and download the result.",
        ],
      },
      {
        id: "limits",
        heading: "Size limit and link expiry",
        body: [
          `Two limits matter here. Each PDF can be up to ${ceilingMb("pdf-to-word")} MB per file.`,
          `The other limit is time. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule, so treat the download as part of the job: save the DOCX as soon as the conversion finishes rather than leaving the tab open for later.`,
        ],
      },
      {
        id: "scanned-pdfs",
        heading: "Scanned PDFs and neighboring tools",
        body: [
          "The tools listed beside PDF to Word cover the jobs next door. If your PDF is a scan — photographed or scanned pages rather than typed text — run it through the OCR PDF tool first, which recognizes the text in scanned pages so there is real text to carry into Word.",
          "If you want the same text as a plain .txt file rather than a DOCX, PDF to Text pulls it out right in your browser. And when the editing is done, Word to PDF converts your finished document back in the other direction.",
        ],
      },
    ],
    faq: [
      {
        question: "Does PDF to Word upload my file?",
        answer:
          "Yes. PDF to Word is a server tool: your PDF is uploaded over an encrypted connection and processed on a secure worker. The worker deletes the input when the job finishes.",
      },
      {
        question: "What happens to my PDF after the conversion runs?",
        answer: `The file is processed on a secure worker, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("pdf-to-word")} MB per file.`,
      },
      {
        question: "Do I need an account to convert a PDF to Word?",
        answer:
          "No account is needed. Open the PDF to Word tool, upload the PDF, and download the DOCX — that is the whole flow.",
      },
      {
        question: "Will the Word document look like my original PDF?",
        answer: `No. It holds the PDF's words and pictures, not its design. ${PDF_TO_WORD_KEEPS} If your PDF is a scanned image rather than typed text, use the OCR PDF tool first so there is recognized text to convert.`,
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-17",
  },
  {
    slug: "how-to-convert-jpg-to-pdf",
    title: "How to convert JPG to PDF",
    description:
      "Combine JPG photos into one PDF right in your browser — your files never leave your device. One photo per US Letter page, in the order you set.",
    tools: ["jpg-to-pdf", "png-to-pdf", "pdf-to-jpg"],
    keywords: [
      "jpg to pdf",
      "convert jpg to pdf",
      "jpeg to pdf",
      "combine photos into one pdf",
      "image to pdf converter",
      "turn pictures into pdf",
    ],
    intro: [
      "To turn JPG photos into a single PDF, open the JPG to PDF tool on pdf.xyz, pick your images, put them in order, and create the PDF right in your browser. Each photo becomes one page of the finished file.",
      "What sets this converter apart is where the work happens: entirely in your own browser. Nothing is sent to a server, so your photos stay on your device from the moment you pick them to the moment you save the finished PDF — and no account is needed.",
      `Each image can be up to ${MAX_IMAGE_MB} MB, and the output is one PDF assembled on your device. That makes the tool a natural fit for photographed receipts, scanned pages saved as JPGs, or any batch of pictures that belongs together in a single file.`,
    ],
    steps: [
      "Open the JPG to PDF tool.",
      "Pick the JPG or JPEG photos you want in the PDF — they stay on your device the whole time.",
      "Put them in page order with each photo's Move up and Move down buttons.",
      "Create the PDF — it is assembled in your browser, not on a server.",
      "Save the finished PDF to your device.",
    ],
    sections: [
      {
        id: "what-each-page-looks-like",
        heading: "What each page looks like",
        body: [
          // This section used to be "Page size, orientation, and margins" —
          // three settings the tool has never had. The page is fixed, and
          // these sentences are built from the constants the engine draws with.
          `Every photo goes on its own ${US_LETTER_LABEL} portrait page, centred with a ${inches(IMAGE_PAGE_MARGIN_PT)} in margin of white around it. A photo larger than that space is scaled down to fit, keeping its proportions; a smaller one is placed at its own size and never enlarged.`,
          "There is no page-size, orientation or margin setting: the page is the same for every photo, which keeps a stack of mismatched pictures reading as one document. Photos are placed as their pixels are stored, so a phone photo that relies on a rotation tag to display upright may come out sideways; Rotate PDF can turn those pages afterward, in your browser too.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Your photos never leave your device",
        body: [
          "JPG to PDF is an in-browser tool. The conversion runs on your own machine, and your files stay on your device from start to finish — there is no server step in the path, and no account is needed.",
          `One honest caveat: the tool is not fully offline. ${offlineAnswer("jpg-to-pdf")}`,
        ],
      },
      {
        id: "limits-and-related-tools",
        heading: "Limits, formats, and where to go next",
        body: [
          `The tool accepts JPG and JPEG files and produces a PDF. Each image can be up to ${MAX_IMAGE_MB} MB, and everything you add is assembled into one PDF on your device.`,
          "If your images are PNGs — transparent ones included — use the PNG to PDF tool, which also builds a single PDF right in your browser. Going the other direction, PDF to JPG turns PDF pages back into images. And once you have several PDFs, Merge PDF combines them into one.",
        ],
      },
    ],
    faq: [
      {
        question: "Does my photo leave my device when I convert JPG to PDF?",
        answer:
          "No. The tool runs entirely in your browser, so your files stay on your device from start to finish.",
      },
      {
        question: "Can I combine multiple JPG photos into one PDF?",
        answer:
          "Yes — that is exactly what the tool does. Each photo becomes one page of a single PDF, in the order you set with the Move up and Move down buttons.",
      },
      {
        question: "Does JPG to PDF have page size or margin settings?",
        answer: `No. Every image goes on a ${US_LETTER_LABEL} portrait page with a ${inches(IMAGE_PAGE_MARGIN_PT)} in margin, scaled down to fit if it is larger than that space.`,
      },
      {
        question: "How large can my JPG files be?",
        answer: `Up to ${MAX_IMAGE_MB} MB per file. The images are combined into one PDF right on your device.`,
      },
      {
        question: "Does JPG to PDF work offline?",
        answer: `Not fully. ${offlineAnswer("jpg-to-pdf")}`,
      },
      {
        question: "Can I convert PNG images with this tool?",
        answer:
          "This tool accepts JPG and JPEG files. For PNGs — including transparent ones — use the PNG to PDF tool, which assembles a single PDF in your browser the same way.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    // ONE guide for the intent, from two lanes: L07 wrote this slug for the
    // top query ("pdf to jpg"), L04 wrote how-to-convert-pdf-to-jpg-or-png for
    // the same two tools. Folded here: L04's interpolated presets, pixel cap,
    // preview limit and file names; L07's per-preset advice, JPEG quality and
    // the embedded-images section. L07's offline paragraph said "a dropped
    // connection does not interrupt work already in progress" — false for a
    // renderer that fetches image decoders and character maps mid-run — so
    // the offline answer is the tool page's own.
    slug: "how-to-convert-pdf-to-jpg",
    title: "How to convert a PDF to JPG or PNG images",
    description:
      "Turn every page of a PDF into a JPG or PNG image right in your browser — your file never leaves your device. Pick a resolution; several pages arrive as one ZIP.",
    tools: ["pdf-to-jpg", "pdf-to-png", "extract-images"],
    keywords: [
      "pdf to jpg",
      "convert pdf to jpg",
      "pdf to jpeg",
      "pdf to png",
      "pdf to image",
      "save pdf pages as images",
    ],
    intro: [
      "To convert a PDF to JPG, open the PDF to JPG tool — or PDF to PNG for lossless images — add your PDF, choose a resolution, and render. Every page becomes its own image, drawn right in your browser. A one-page PDF downloads as a single image; a document with more than one page arrives as one ZIP with an image for each page.",
      "The rendering happens on your own device. The tool draws each page with pdf.js, a PDF renderer bundled with the site, and encodes it in the browser, so your PDF stays on your device from start to finish. There is no account to create.",
      `That makes it a quick way to share a page in a chat or on a slide, to drop a page into a document that only takes images, or to show a PDF on a device with no viewer. Each PDF can be up to ${ceilingMb("pdf-to-jpg")} MB.`,
    ],
    steps: [
      "Open the PDF to JPG tool, or PDF to PNG for lossless images.",
      "Add your PDF. It is read in your browser, and the file stays on your device.",
      `Choose a resolution: ${RASTER_RESOLUTION_CHOICES}. ${DEFAULT_RESOLUTION_LABEL} is selected to start.`,
      "Render the pages. A progress count shows each page as it is drawn.",
      `Download the result: a single page saves as one image, and several pages save as one ZIP with an image for each page. Each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from its preview.`,
    ],
    sections: [
      {
        id: "choosing-a-resolution",
        heading: "Choosing a resolution",
        body: [
          `DPI is how many image pixels each inch of the page becomes. ${presetText(rasterPreset("screen"))} is enough for a page read on a monitor or in a chat. ${presetText(rasterPreset("high"))} is a sharper all-rounder. ${presetText(rasterPreset("print"))} is for printing, or for zooming in on small text. Every step up draws more pixels per page, so the images get larger and take longer to render.`,
          `Neither side of a rendered page may exceed ${RASTER_MAX_DEVICE_PX.toLocaleString("en-US")} pixels, which keeps the memory a page needs in check. A very large page, such as a poster or an engineering drawing, is rendered below the preset rather than failing.`,
        ],
      },
      {
        id: "jpg-or-png",
        heading: "JPG or PNG?",
        body: [
          `JPG files are smaller and suit photographs and scanned pages; each page is encoded at a fixed JPEG quality of ${Math.round(DEFAULT_JPEG_QUALITY * 100)}%. PNG is lossless — every pixel is kept exactly — which suits text, line art and screenshots, at the cost of larger files.`,
          "Both are rendered on a white background, so any transparent area of a page comes out white.",
        ],
      },
      {
        id: "what-you-download",
        heading: "What you download",
        body: [
          `A one-page PDF downloads as a single image named after your file. With more than one page, every page goes into one ZIP, named in reading order with zero-padded page numbers — ${pageImageName("report.pdf", 2, 12, "png")} — so the images sort correctly in any file browser. The first ${RASTER_PREVIEW_LIMIT} pages also get a preview with their own download button.`,
        ],
      },
      {
        id: "pages-or-embedded-images",
        heading: "Page images, or the images inside the PDF?",
        body: [
          "PDF to JPG draws each whole page — text, drawings, and pictures together — as one image, the way a screen shows it. If you want the photos embedded in the PDF at their original resolution instead of pictures of whole pages, use Extract Images: it saves embedded JPEGs as they are, rebuilds RGB and grayscale images as PNGs, and skips formats it cannot read.",
          "If an image inside the PDF cannot be decoded, the page is still rendered, and the result tells you how many images could not be decoded rather than handing back a page with a silent gap.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Your PDF never leaves your device",
        body: [
          "PDF to JPG is an in-browser tool. The PDF is read, drawn, and encoded on your own machine, and the images are saved straight from the browser — there is no server step in the path, and no account is needed.",
          `One honest caveat about working offline: ${offlineAnswer("pdf-to-jpg")}`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent anywhere when I convert it to JPG?",
        answer:
          "No. The pages are drawn and encoded in your browser, so the file stays on your device from start to finish.",
      },
      {
        question: "Why did I get a ZIP file?",
        answer:
          "Because the PDF has more than one page. Each page becomes its own image, named with its page number so the files sort in reading order, and when there is more than one page the images are bundled into one ZIP so they download together. A one-page PDF downloads as a single image.",
      },
      {
        question: "Can I convert just one page?",
        answer: `Every page is rendered, and each of the first ${RASTER_PREVIEW_LIMIT} gets its own download button, so you can save only the page you need. For a page past those, use Extract Pages first to make a one-page PDF — it runs in your browser too — and convert that.`,
      },
      {
        question: "How do I get PNG images instead?",
        answer:
          "Use PDF to PNG. It renders pages the same way, at the same resolutions, but saves lossless PNGs — usually larger files, with no JPEG compression around sharp text.",
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("pdf-to-jpg")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-rotate-a-pdf",
    title: "How to rotate pages in a PDF",
    description:
      "Rotate every page of a PDF, or only the pages you pick — left, right, or upside down — right in your browser, so the file stays on your device.",
    tools: ["rotate-pdf", "organize-pages", "crop-pdf"],
    keywords: [
      "rotate pdf",
      "rotate pdf pages",
      "turn pdf pages",
      "fix a sideways pdf",
      "rotate one page in a pdf",
      "landscape pdf",
    ],
    intro: [
      "To rotate a PDF, open the Rotate PDF tool, add your file, turn the pages that need it, and download the result. You can turn every page at once or only the ones you select, and each page's thumbnail shows its new orientation before anything is applied.",
      "Rotate PDF runs entirely in your browser, so your PDF stays on your device and no account is needed. The rotation is written into each page as a setting rather than redrawn, so text stays selectable and images keep their quality.",
      `It is the quick fix for a scan that came out sideways, a landscape table stuck in a portrait report, or a page someone photographed upside down. Each PDF can be up to ${ceilingMb("rotate-pdf")} MB.`,
    ],
    steps: [
      "Open the Rotate PDF tool.",
      "Add your PDF. It opens in your browser, and the file stays on your device.",
      "Choose the pages to turn. Every page starts selected; click Clear, then click pages to pick them, Shift-click to take a range, or use Invert.",
      "Turn them with Left, Right, or 180°, or use the arrows on one page's thumbnail to turn just that page.",
      "Check the thumbnails. Reset puts every page back the way it was.",
      "Apply the rotation and download the rotated PDF.",
    ],
    sections: [
      {
        id: "every-page-or-some",
        heading: "Turning every page, or only some",
        body: [
          "Every page starts selected, so one click on Left, Right, or 180° turns the whole document — the usual fix for a scan that came out sideways. To turn only some pages, clear the selection and pick the ones you want: click a page to select it, Shift-click another to select everything in between, or Invert to swap what is selected. With nothing selected at all, a turn applies to every page.",
          "For a single odd page, skip the selection and use the arrows on that page's thumbnail. Pages that were already rotated in the original start from their current angle, so a turn adds to what is there, and Apply stays unavailable until at least one page differs from the original.",
        ],
      },
      {
        id: "what-rotating-changes",
        heading: "What rotating changes, and what it leaves alone",
        body: [
          "A PDF stores each page's rotation as a setting, and this tool changes that setting instead of redrawing the page. Text stays selectable and searchable, images keep their original quality, and no page is turned into a picture.",
          "If you also need to reorder, duplicate, or delete pages, use Organize Pages, which does all of that and rotation in one pass on a visual page board, in your browser too. If a page is the right way up but carries too much margin, Crop PDF trims it.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Your PDF never leaves your device",
        body: [
          "Rotate PDF is an in-browser tool. The file is opened, turned, and saved on your own machine — there is no server step in the path, and no account is needed.",
          `One honest caveat about working offline: ${offlineAnswer("rotate-pdf")}`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I rotate just one page of a PDF?",
        answer:
          "Yes. Use the arrows on that page's thumbnail, or select only that page and use Left, Right, or 180°. The other pages stay as they were.",
      },
      {
        question: "Does rotating a PDF reduce its quality?",
        answer:
          "No. The tool changes each page's rotation setting instead of redrawing the page, so text stays selectable and images keep their quality.",
      },
      {
        question: "Does my PDF leave my device when I rotate it?",
        answer:
          "No. Rotate PDF runs entirely in your browser, so the file stays on your device from start to finish.",
      },
      {
        question: "Can I rotate and reorder pages at the same time?",
        answer:
          "Use Organize Pages for that. It reorders, rotates, duplicates, and deletes pages in one pass, and it runs in your browser too.",
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("rotate-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-add-text-to-a-pdf",
    title: "How to add text, images, and shapes to a PDF",
    description:
      "Add text, images, boxes, and lines to a PDF right in your browser, so the file stays on your device — and what Edit PDF can and cannot change.",
    tools: ["edit-pdf", "annotate-pdf", "redact-pdf"],
    keywords: [
      "edit pdf",
      "add text to pdf",
      "type on a pdf",
      "insert image in pdf",
      "add a logo to a pdf",
      "draw a box on a pdf",
    ],
    intro: [
      "To add text to a PDF, open the Edit PDF tool, add your file, choose Text, type what you want, set the page and position, and add it to the page. Boxes, lines, arrows, and PNG or JPG images go on the same way. When everything is placed, apply the edits and download the new PDF.",
      "Edit PDF runs entirely in your browser, so your PDF stays on your device and no account is needed. New content is drawn onto the page as real text, shapes, and images, and the original pages are kept as they are rather than turned into pictures, so their own text stays selectable.",
      `One thing to know before you start: Edit PDF adds new content on top of the page. It does not change, move, restyle, or delete the text that is already in the file. Each PDF can be up to ${ceilingMb("edit-pdf")} MB.`,
    ],
    steps: [
      "Open the Edit PDF tool.",
      "Add your PDF. It opens in your browser, and the file stays on your device.",
      "Choose what to add: Text, Box, Line, or Image.",
      "Set the page, then the position in points measured from the bottom-left corner of that page. The tool shows the page's size so you know how much room there is.",
      "Fill in the details: the words, size, and color for text; filled or outline for a box; an arrowhead for a line; a PNG or JPG file for an image. Then click Add to page.",
      "Add anything else you need, check the schematic page preview, then apply the edits and download the edited PDF.",
    ],
    sections: [
      {
        id: "placing-content",
        heading: "Placing text, boxes, lines, and images",
        body: [
          "Every item is placed by numbers rather than dragged. Positions are in PDF points, counted from the bottom-left corner of the page, and the tool shows the size of the page you are working on. For text, the position is where the first line sits, and further lines flow downward from there. Give text a wrap width to break long lines automatically; without one, a line breaks only where you start a new line yourself.",
          `Boxes can be filled, with an adjustable opacity, or drawn as an outline. Lines can end in an arrowhead. Images must be PNG or JPG files of up to ${EDIT_IMAGE_MB} MB each; they start at a size that keeps their proportions, and you can set the width, height, and opacity yourself.`,
          "Everything you add appears in a list and on a schematic preview of its page, and you can remove any item before you apply. Each item carries its own page number, so one pass can add content to as many pages as you like.",
        ],
      },
      {
        id: "what-it-changes",
        heading: "What Edit PDF changes, and what it leaves alone",
        body: [
          "Edit PDF adds; it does not rewrite. The text, images, and drawings already in your PDF stay exactly where they are, and the tool cannot retype a word, change a font, move a paragraph, or delete anything that was already there. The pages are kept, not redrawn, so the original text stays selectable just as it was.",
          "When you apply your edits, the new content is written into the page itself. In the downloaded file it is part of the page, not a comment or a separate object that someone can move or delete in their PDF viewer.",
          "On the uncommon page that is stored with a rotation setting, positions are measured on the page as stored, before that rotation, so new content follows the page's content rather than the way your viewer turns it.",
        ],
      },
      {
        // From L05's guide for the same intent (folded in here): the tool for
        // the job this one cannot do.
        id: "changing-existing-text",
        heading: "Changing the text that is already there",
        body: [
          `To rework the wording itself, convert the file with ${nameOf("pdf-to-word")}: it exports the PDF's selectable text as an editable Word document, as plain paragraphs in reading order, with each picture between them. Fonts, tables and page layout are not recreated, so it suits documents where the words matter more than the look.`,
        ],
      },
      {
        id: "covering-versus-removing",
        heading: "Covering something is not the same as removing it",
        body: [
          "A filled box can cover a word, a number, or an old date, and the printed page will look clean. But whatever is underneath is still in the file: it can still be selected and copied, and anyone who removes the box in another editor sees it again.",
          "When information must actually be gone, use Redact PDF instead. It covers the areas you choose and then rebuilds every page as a flattened image, so the text and drawings underneath are removed rather than hidden. The trade-off is that no text in the redacted copy can be selected any more.",
          "For review marks rather than new content — highlights, outlines, notes, and arrows — use Annotate PDF. It runs in your browser too and flattens its markups into the page in the same way.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Your PDF never leaves your device",
        body: [
          "Edit PDF is an in-browser tool. The PDF and any images you insert are read, edited, and saved on your own machine — there is no server step in the path, and no account is needed.",
          "Text in English and the other Western European languages uses a font built into the engine. For any other script — Greek, Cyrillic, Bengali, Chinese, and the rest — the tool downloads a matching font the first time it is needed. If your text has characters none of its fonts can draw, or mixes scripts that no single one of its fonts covers, it tells you before changing anything rather than leaving blanks in the page.",
          `One honest caveat about working offline: ${offlineAnswer("edit-pdf")} The font download carries none of your document; it is the same file for everyone.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I change the existing text in my PDF?",
        answer: `No. ${nameOf("edit-pdf")} adds new text, images, boxes, and lines, but it cannot retype, restyle, move, or delete text that is already in the file. To rework the existing text, convert the file with ${nameOf("pdf-to-word")}. You can draw a filled box over something to hide it; if the information must really be gone, use ${nameOf("redact-pdf")}.`,
      },
      {
        question: "Can I add an image or a logo to a PDF?",
        answer: `Yes. Choose Image, pick a PNG or JPG of up to ${EDIT_IMAGE_MB} MB, then set its page, position, size, and opacity. It starts at a size that keeps the image's proportions.`,
      },
      {
        question: "Can I add content to more than one page?",
        answer:
          "Yes. Each item you add has its own page number, so you can place items on as many pages as you like and apply them all in one pass.",
      },
      {
        question: "Does my PDF leave my device when I edit it?",
        answer:
          "No. Edit PDF runs entirely in your browser, so the PDF and any images you add stay on your device from start to finish.",
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("edit-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-17",
  },
  {
    slug: "how-to-create-a-fillable-pdf-form",
    title: "How to create a fillable PDF form",
    description:
      "Turn a PDF into a fillable AcroForm with text fields, checkboxes, dropdowns, radio groups, and lists — built right in your browser, no account needed.",
    tools: ["create-forms", "fill-forms", "sign-pdf"],
    keywords: [
      "create fillable PDF form",
      "make a PDF fillable",
      "PDF form creator",
      "add form fields to PDF",
      "fillable form maker",
      "AcroForm builder",
    ],
    intro: [
      "To create a fillable PDF form, open the Create Fillable Forms tool, place fields on the pages where answers belong, and save the result. You get a reusable fillable AcroForm PDF — real form fields that anyone can complete on a screen instead of printing and writing.",
      "The difference is where the work happens. This is a client-side tool: it builds the form in your browser, so the document stays on your device from the moment you pick it to the moment you save the finished file. There is no account to create — open the page and start placing fields.",
      "The output is built to be reused. Because the fields are genuine AcroForm fields, the same PDF can be sent out and completed again and again, and it pairs naturally with the Fill Forms tool for the people on the receiving end.",
    ],
    steps: [
      "Open the Create Fillable Forms tool and pick the PDF you want to make fillable — it stays on your device.",
      "Choose the field type you need: text, checkbox, dropdown, radio, or list — the five field types the builder supports.",
      "Place the field by position on the page, right where the answer belongs — a text field over a blank answer line, a checkbox beside each item.",
      "Repeat for every answer the form collects, mixing field types as the document calls for: radio groups where exactly one choice applies, dropdowns and lists where the answers are known in advance.",
      "Run the tool in your browser to build the fields into the PDF as a real AcroForm.",
      "Save the finished fillable PDF to your device — it is ready to send out and reuse.",
    ],
    sections: [
      {
        id: "choose-the-right-field-type",
        heading: "Choose the right field type",
        body: [
          "The builder supports five field types: text, checkbox, dropdown, radio, and list. Text fields take free-form answers — names, dates, addresses, comments. Checkboxes suit independent yes-or-no items, where any number of them can be checked at once. A radio group is for a question with exactly one acceptable answer out of several: place the group where the question is answered, and it keeps the choice to a single answer.",
          "Reach for a dropdown or a list when the acceptable answers are known in advance — departments, countries, product names — so the person completing the form picks from your set instead of typing. Matching the field type to the question is most of the work of a good form: it makes the answers cleaner and the form faster to complete.",
        ],
      },
      {
        id: "where-the-work-happens",
        heading: "Where the work happens",
        body: [
          "Create Fillable Forms is a client-side tool. The processing runs in your browser, not on a server — the PDF you pick stays on your device from start to finish. That is also why no account is required: there is nothing to set up before you start placing fields.",
          `One honest note: the tool is not fully offline. ${offlineAnswer("create-forms")}`,
        ],
      },
      {
        id: "output-and-limits",
        heading: "What you get, and the limits",
        body: [
          "The tool accepts a PDF and produces a PDF — specifically a reusable, fillable AcroForm document. The tool is in beta — the five field types above are the supported set. Because the fields are genuine form fields rather than flat marks on the page, one saved copy can be distributed and completed over and over, with each person entering their own answers.",
          `Each PDF can be up to ${ceilingMb("create-forms")} MB. When it is time to complete the form, the Fill Forms tool handles the other half of the job: it fills a PDF's existing AcroForm fields — text, checkboxes, radio buttons, dropdowns, and lists — right in the browser. And when a form needs a signature to finish it, the Sign PDF tool adds one.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent to a server when I create a fillable form?",
        answer:
          "No. Create Fillable Forms runs entirely in your browser — the file stays on your device from start to finish. There is also no account to create.",
      },
      {
        question: "What kinds of form fields can I add to a PDF?",
        answer:
          "Five field types: text, checkbox, dropdown, radio, and list. Fields are placed by position, so each one sits exactly where its answer belongs on the page.",
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("create-forms")} MB per file.`,
      },
      {
        question: "Can I create a fillable PDF offline?",
        answer: `Not fully. ${offlineAnswer("create-forms")}`,
      },
      {
        question: "How do people fill out the form I made?",
        answer:
          "The result is a standard fillable AcroForm PDF. Anyone can complete it with the Fill Forms tool, which fills a PDF's existing fields — text, checkboxes, radio buttons, dropdowns, and lists — right in the browser and saves the completed copy as a PDF.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-fill-out-a-pdf-form",
    title: "How to fill out a PDF form",
    description:
      "Fill out a PDF form's text fields, checkboxes, and dropdowns right in your browser — the file stays on your device, and no account is needed.",
    tools: ["fill-forms", "create-forms", "sign-pdf"],
    keywords: [
      "fill out a pdf form",
      "pdf form filler",
      "how to fill in a pdf form",
      "type into a pdf form",
      "complete a pdf form online",
      "fill a pdf form in your browser",
    ],
    intro: [
      "To fill out a PDF form, open the Fill Forms tool in your web browser, pick the PDF, and work straight through its fields — text boxes, checkboxes, radio buttons, dropdowns, and lists. When you run the tool, your answers are written into the PDF and the completed file saves back to your device.",
      "What sets this approach apart is where the work happens: on your own device. Fill Forms is an in-browser tool — it runs entirely in your browser, so the form you picked and everything you type into it stays on your device from start to finish. That matters for forms in particular, because forms are where names, addresses, and other personal details go. There is nothing to install and no account to create — the tool runs in your web browser.",
      "Fill Forms completes the interactive fields the PDF already contains — its AcroForm fields. The steps below walk through filling a form from start to finish, then cover which field kinds the tool fills, what to do when a PDF has no fields at all, and how signing and locking the finished form fit in.",
    ],
    steps: [
      "Open the Fill Forms tool.",
      "Pick the PDF form from your device. It stays there — the tool runs in your browser, and the file never leaves your device.",
      "Type your answers into the form's text fields.",
      "Set the choice fields: check the checkboxes that apply, pick one option in each radio group, and choose values from any dropdowns and lists.",
      "Run the tool in your browser to write your answers into the PDF.",
      "Save the completed PDF to your device.",
    ],
    sections: [
      {
        id: "which-fields-it-fills",
        heading: "Which fields Fill Forms can fill",
        body: [
          "Fill Forms completes a PDF's existing AcroForm fields — the interactive fields the document's author built in. Five kinds are covered: text fields for typed answers, checkboxes, radio buttons for pick-one groups, dropdowns, and list fields. If the form has all of these, you can complete the whole thing in one pass and save a single finished PDF.",
          "If the PDF opens with no interactive fields at all, there is nothing for Fill Forms to complete. In that case, start with Create Fillable Forms (currently in beta): it adds text fields, checkboxes, dropdowns, radio groups, and lists by position, turning the flat PDF into a reusable fillable AcroForm — then bring the result back here and fill it.",
        ],
      },
      {
        id: "where-the-work-happens",
        heading: "Where the work happens",
        body: [
          "Fill Forms is an in-browser tool. It runs entirely on your device, and your PDF stays on your device from start to finish. The finished form does not pass through a server on its way back to you — you save the completed file straight to your device.",
          `The tool is not fully offline. ${offlineAnswer("fill-forms")} No account is needed at any point.`,
        ],
      },
      {
        id: "sign-and-lock-after-filling",
        heading: "Signing and locking the finished form",
        body: [
          "Many forms want a signature once the blanks are done. The Sign PDF tool creates one by drawing, typing, or picking a signature image, and lets you place it precisely on the page — so the natural order is fill first, then add the signature to the completed file.",
          "When the answers are final, Flatten PDF locks the fillable fields into the page itself so their values can no longer be edited, while other annotations and layers are kept as-is. That is the right last step before sending a form whose field values you do not want edited. Sign PDF and Flatten PDF both take a PDF and return a PDF, and both run in the browser the same way Fill Forms does.",
        ],
      },
      {
        id: "limits-and-output",
        heading: "Limits and what you get back",
        body: [
          `Fill Forms takes a PDF and outputs a PDF, up to ${ceilingMb("fill-forms")} MB per file. The output is your original document with the field values you entered written into it.`,
          "The tool fills the fields the document already has; it does not add new ones — that is Create Fillable Forms' job — and it does not edit the page content around the fields. Keeping those jobs separate is what lets each one run entirely on your device.",
        ],
      },
    ],
    faq: [
      {
        question: "Does my PDF leave my device when I fill out a form?",
        answer:
          "No. Fill Forms runs entirely in your browser, and the file stays on your device from start to finish.",
      },
      {
        question: "Can I fill out a PDF form offline?",
        answer: `Not fully. ${offlineAnswer("fill-forms")}`,
      },
      {
        question: "How large can the PDF form be?",
        answer: `Up to ${ceilingMb("fill-forms")} MB per file.`,
      },
      {
        question: "What if my PDF has no fillable fields?",
        answer:
          "Fill Forms completes existing AcroForm fields only, so a PDF without any has nothing to fill. Open Create Fillable Forms (currently in beta) first — it adds text fields, checkboxes, dropdowns, radio groups, and lists by position to build a fillable AcroForm PDF — then fill the result with this tool.",
      },
      {
        question: "Do I need an account to fill out a PDF form?",
        answer:
          "No account is needed. Open the tool, pick your PDF, fill the fields, and save the completed file back to your device.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-sign-a-pdf",
    title: "How to sign a PDF",
    description:
      "Sign a PDF by drawing, typing, or picking a signature image — right in your browser, so the file never leaves your device. No account needed.",
    tools: ["sign-pdf", "request-signatures", "fill-forms"],
    keywords: [
      "how to sign a pdf",
      "add signature to pdf",
      "electronic signature pdf",
      "draw signature on pdf",
      "esign pdf",
      "sign pdf without account",
    ],
    intro: [
      "To add a signature to a PDF, open the Sign PDF tool, create your signature by drawing it, typing it, or picking a signature image, and place it exactly where the document needs it. Export the result and you have a signed PDF ready to send.",
      "What sets this approach apart is where the work happens. Sign PDF runs entirely in your browser, so the PDF and the signature you create stay on your device from start to finish. No account is needed — open the page, make your mark, and export.",
      `You also get more range than a single scribble box. There are ${signatureWays} ways to make a signature — draw it, type it in a ${signatureStyles.join(" or ")} style, or pick an image of the signature you already use — so the result can be as personal or as formal as the document calls for.`,
    ],
    steps: [
      "Open the Sign PDF tool.",
      "Pick the PDF you need to sign — the file stays on your device the entire time.",
      "Create your signature: draw it, type it, or pick a signature image you already have.",
      `If you type it, pick the look: ${signatureStyles.join(" or ")} style.`,
      "Place the signature exactly where the document needs it — the tool is built for precise placement.",
      "Export your signed PDF and save it to your device.",
    ],
    sections: [
      {
        id: "ways-to-make-a-signature",
        heading: `${signatureWays[0]!.toUpperCase()}${signatureWays.slice(1)} ways to make a signature`,
        body: [
          `Sign PDF offers ${signatureWays} ways to make a signature: draw it, type it, or pick an image. Drawing produces a mark that looks like your handwriting and suits documents where a personal touch matters. Typing is the fastest option, and it comes in ${countWord(SIGNATURE_STYLES.length)} styles — script, which sets a name written in the Western European alphabet in an italic serif face, and print, a plain printed name. A name in any other script is set in the same upright face whichever style you pick. If you already keep a scanned signature as a PNG or JPG image, pick that image and reuse the mark you have always used.`,
          "Whichever you choose, the rest works the same way: position the signature precisely on the page, then export.",
        ],
      },
      {
        id: "your-file-stays-on-your-device",
        heading: "Your file stays on your device",
        body: [
          "Sign PDF is an in-browser tool. It runs entirely in your browser, which means the contract, lease, or offer letter you open never leaves your device — the file stays local from the moment you pick it to the moment you export. For the kind of paperwork that usually carries a signature, that is the difference that matters most.",
          `One honest nuance: the tool is not fully offline. ${offlineAnswer("sign-pdf")}`,
        ],
      },
      {
        id: "output-and-limits",
        heading: "What you get, and the limits",
        body: [
          `The tool accepts PDF input and produces a PDF: your original document with the signature placed where you put it. The per-file ceiling is ${ceilingMb("sign-pdf")} MB.`,
        ],
      },
      {
        id: "when-someone-else-needs-to-sign",
        heading: "When someone else needs to sign",
        body: [
          "Sign PDF covers self-signing: you create and place your own signature on a document you already have. When the signature you need is someone else's, Request Signatures prepares the document for them: it adds a named, fillable field for each signer and packages the PDF with a manifest and an audit trail, for you to send. It does not send the request or collect the signatures itself.",
          "And when the document is a form as much as it is a contract, pair signing with Fill Forms, which completes a PDF's existing AcroForm fields — text, checkboxes, radio buttons, dropdowns, and lists — right in your browser. Fill the fields in Fill Forms and export the completed PDF, then open that file in Sign PDF to add your signature.",
        ],
      },
    ],
    faq: [
      {
        question: "Do I need an account to sign a PDF?",
        answer:
          "No account is needed. Open the Sign PDF tool, create a signature, place it, and export the signed file.",
      },
      {
        question: "Does my PDF leave my device when I sign it?",
        answer:
          "No. Sign PDF runs entirely in your browser, so the file stays on your device from start to finish.",
      },
      {
        question: "Does Sign PDF work offline?",
        answer: `Not fully. ${offlineAnswer("sign-pdf")}`,
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("sign-pdf")} MB per file.`,
      },
      {
        question: "Can I collect signatures from other people?",
        answer:
          "Sign PDF handles your own signature. For signatures from others, Request Signatures prepares the PDF with a named, fillable field for each signer and packages it for you to send — pdf.xyz does not send it to them or collect the signatures.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-make-a-scanned-pdf-searchable",
    title: "How to make a scanned PDF searchable",
    description:
      "OCR a scanned PDF so its text becomes searchable and selectable — processed on an auto-deleting worker, no account needed.",
    tools: ["ocr-pdf", "pdf-to-text", "extract-tables"],
    keywords: [
      "how to make a scanned pdf searchable",
      "ocr pdf online",
      "convert scanned pdf to searchable pdf",
      "copy text from scanned pdf",
      "recognize text in pdf",
    ],
    intro: [
      "To make a scanned PDF searchable, run it through the OCR PDF tool. Optical character recognition reads the page images and adds a searchable, copyable text layer, so the file you download responds to search and lets you select and copy text like any other document.",
      "This tool runs on a secure worker rather than in your browser. Your file uploads over an encrypted connection, the job runs there, and the input is deleted when the job finishes. There is no account step anywhere in the flow — open the page, add the file, download the result.",
      "Scans on paper are not the only input, either. A JPG or PNG — a photo of a contract, a screenshot of a form — goes in the same way and comes out as a searchable PDF or as plain text.",
    ],
    steps: [
      "Open the OCR PDF tool.",
      "Add your scanned PDF, JPG, or PNG — it uploads over an encrypted connection to an isolated worker.",
      `Pick the recognition languages that appear in your document — up to ${MAX_OCR_LANGUAGES} per job. The page's live status shows which language packs the worker reports as installed.`,
      "Start the job. The worker runs optical character recognition, adds the text layer, and deletes the input when the job finishes.",
      `Download the result. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the result promptly.`,
      "Open the downloaded PDF and try a search, or select and copy a passage. Both now work because the text layer is in place.",
    ],
    sections: [
      {
        id: "pick-the-right-languages",
        heading: "Pick the right recognition languages",
        body: [
          `Recognition is language-aware. The tool advertises ${OCR_LANGUAGES.length} recognition languages, and you can select up to ${MAX_OCR_LANGUAGES} of them for a single job — so a document that mixes languages can name up to ${MAX_OCR_LANGUAGES} of the languages it contains in a single job.`,
          "The advertised list and the installed list are treated as two different claims, deliberately. The worker reports which language packs it actually has installed, and the page's live status reflects that report — what you can run is governed by what the worker says is really there, not by a static list.",
        ],
      },
      {
        id: "what-you-get-back",
        heading: "What you get back",
        body: [
          "The tool's outputs are PDF and TXT. The searchable PDF keeps your scanned pages and adds a searchable, copyable text layer, so search, text selection, and copying all start working. The TXT output is the recognized text on its own — the right choice when you want the words and not the page images.",
          "If the goal is text you can reuse elsewhere, the PDF to Text tool is the natural next step once a PDF has a text layer; and for documents built around tables, Extract Tables is the related tool aimed at exactly that.",
        ],
      },
      {
        id: "where-your-file-goes",
        heading: "Where your file goes",
        body: [
          "OCR PDF does its work on a secure worker: your file uploads over an encrypted connection and is processed there. The input is deleted when the job finishes.",
          `The result is held only briefly. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. No account is involved at any point.`,
        ],
      },
      {
        id: "limits-worth-knowing",
        heading: "Limits worth knowing",
        body: [
          `Each file can be up to ${ceilingMb("ocr-pdf")} MB. Accepted inputs are PDF, JPG, and PNG; outputs are PDF and TXT. A single job recognizes up to ${MAX_OCR_LANGUAGES} languages, chosen from the ${OCR_LANGUAGES.length} advertised — with the worker's own live report deciding which packs are installed and ready. And because the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, treat the result as something to save right away rather than a stored copy to come back for.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I OCR a photo or screenshot instead of a PDF?",
        answer:
          "Yes. The tool accepts JPG and PNG alongside PDF, so a photographed page or a screenshot of a document works the same way — and comes back as a searchable PDF or as plain TXT.",
      },
      {
        question: "What happens to my file after OCR runs?",
        answer: `The job runs on a secure worker, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "Which languages can the OCR recognize?",
        answer: `${OCR_LANGUAGES.length} languages are advertised, with up to ${MAX_OCR_LANGUAGES} selectable per job. The worker reports the packs it actually has installed, and the page's live status reflects that report.`,
      },
      {
        question: "How large can my scanned PDF be?",
        answer: `Up to ${ceilingMb("ocr-pdf")} MB per file, whether the input is a PDF, a JPG, or a PNG.`,
      },
      {
        question: "Do I need an account to make a scanned PDF searchable?",
        answer:
          "No account is needed. Open the OCR PDF tool, add your file, run the job, and download the searchable result.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-10",
  },
  {
    slug: "how-to-password-protect-a-pdf",
    title: "How to password-protect a PDF",
    description:
      "Password-protect a PDF with real AES encryption. Your file goes to an auto-deleting worker, and no account is needed.",
    tools: ["protect-pdf", "unlock-pdf", "redact-pdf"],
    keywords: [
      "password protect pdf",
      "encrypt pdf with password",
      "add password to pdf",
      "lock pdf with password",
      "secure pdf online",
    ],
    intro: [
      "To password-protect a PDF, open the Protect PDF tool on pdf.xyz, add your file, and set a password. The tool applies real AES encryption with qpdf, so only people who have the password can open the resulting PDF.",
      `Protect PDF is a server tool: encryption runs on an auto-deleting secure worker rather than in your browser. Your file uploads over an encrypted connection, and the worker deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      "No account is needed — open the tool, pick a file, choose a password, and download the encrypted copy. If you later need to remove the protection from a copy you can open, the Unlock PDF tool reverses the process using the password you know.",
    ],
    steps: [
      "Open the Protect PDF tool.",
      "Add the PDF you want to protect — it uploads over an encrypted connection to the secure worker.",
      "Set the password that will be required to open the document. Anyone without it will not be able to open the protected copy.",
      "Run the tool. The secure worker applies AES encryption with qpdf and deletes the input when the job finishes.",
      `Download the protected PDF. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the file right away.`,
      "Confirm the protection: open the downloaded copy in your PDF viewer and check that it asks for the password before showing the document.",
    ],
    sections: [
      {
        id: "what-the-password-does",
        heading: "What the password actually does",
        body: [
          "Protect PDF adds a password and real AES encryption, applied with qpdf. The document itself is encrypted, which means the password is not a polite request — only people who have it can open the file. You start with a PDF and get back a PDF — one that simply refuses to open without the password.",
          "Because the protection is encryption rather than a setting, it cuts both ways: the file is genuinely locked to anyone without the password, and it is just as locked to you if the password is lost. Read the limits below before you protect the only copy of something important.",
        ],
      },
      {
        id: "where-your-file-is-processed",
        heading: "Where your file is processed",
        body: [
          `Protect PDF runs on the server side, because the encryption uses qpdf on an auto-deleting secure worker. Your PDF travels over an encrypted connection, the isolated worker applies the encryption, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
          "No account is needed at any step. Because the link is deliberately short-lived, download the protected file as soon as the job completes and keep your own copy.",
        ],
      },
      {
        id: "limits-worth-knowing",
        heading: "Limits worth knowing",
        body: [
          `Each file can be up to ${ceilingMb("protect-pdf")} MB. The tool accepts PDF input and produces PDF output — it does not convert other formats.`,
          "The most important limit is the one you set yourself: the password. If it is lost, the Unlock PDF tool cannot help — it removes a password from a PDF you can already open, by entering the password that works, and it cannot recover or bypass a password nobody knows. Choose a password you can retrieve later, and record it somewhere dependable before you share the protected file.",
        ],
      },
      {
        id: "when-a-password-is-not-enough",
        heading: "When a password is not enough",
        body: [
          "A password controls who can open the document; it does not change what is inside it. Once someone opens the file with the password, everything in it is readable.",
          "If specific content needs to be gone from the document itself — ID numbers, names, anything sensitive — use Redact PDF first. It covers the sensitive areas with solid boxes, then rebuilds each page as a flattened image so the text and vectors underneath are removed rather than hidden. Protect the redacted copy with a password afterward, and the two protections stack: the content is gone from the document, and the document only opens for people you gave the password to.",
        ],
      },
    ],
    faq: [
      {
        question: "Does password-protecting a PDF upload my file?",
        answer:
          "Yes. Protect PDF runs on a secure worker rather than in the browser, because the AES encryption is applied with qpdf. The file travels over an encrypted connection, the worker is isolated, and it deletes the input when the job finishes.",
      },
      {
        question: "How long does my protected PDF stay available?",
        answer: `The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. Download the result as soon as the job completes and keep your own copy.`,
      },
      {
        question: "What kind of encryption does Protect PDF use?",
        answer:
          "Real AES encryption, applied with qpdf. The output is an encrypted PDF that only opens for someone who has the password.",
      },
      {
        question: "How large can my file be?",
        answer: `Up to ${ceilingMb("protect-pdf")} MB per file.`,
      },
      {
        question: "What if I forget the password later?",
        // One sentence for both places that say it (tool-facts owns it).
        answer: forgottenPasswordAnswer(),
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-10",
  },
  {
    slug: "how-to-translate-a-pdf",
    title: "How to translate a PDF into another language",
    description:
      "Translate a PDF into another language with AI. Get Markdown and plain text back; the secure worker wipes inputs at job end. No account needed.",
    tools: ["translate-pdf", "ocr-pdf", "summarize-pdf"],
    keywords: [
      "translate pdf",
      "pdf translation",
      "translate pdf to english",
      "ai pdf translator",
      "translate pdf online",
      "translate a pdf document",
    ],
    intro: [
      "To translate a PDF into another language, open the Translate PDF tool on pdf.xyz, pick your file, and choose the language you want. AI translates the PDF's selectable text and returns it as translated Markdown and plain text, ready to download.",
      `Translate PDF is one of the AI tools, so the work does not happen in your browser: your PDF uploads over an encrypted connection to our processing server, which extracts its selectable text and sends that text — not the file — to a third-party AI provider to translate. Inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. No account is needed at any point.`,
      "Know what you are getting before you start: a text translation, not a page-by-page rebuild. The output is the document's words in the new language, packaged as Markdown and plain text rather than a re-laid-out PDF. That focus on the text is also what lets long documents be handled sensibly — split at page boundaries, translated in ordered passes, and reassembled rather than refused.",
    ],
    steps: [
      "Open the Translate PDF tool.",
      "Pick the PDF you want translated. The tool reads selectable text, so if your document is a scan, run it through OCR PDF first.",
      "Upload your PDF — it travels over an encrypted connection to the secure worker that runs the job.",
      `In “Translate into”, pick one of the ${TRANSLATE_LANGUAGES.length} languages offered, and leave “Source language” on “Auto-detect” or set it yourself.`,
      "Start the translation. A long document is not refused: it is split at page boundaries, translated a few pages at a time, and reassembled in order. The worker deletes the input when the job finishes.",
      `Download the result — translated Markdown and plain text, packaged together. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it to your device.`,
    ],
    sections: [
      {
        id: "what-you-get-back",
        heading: "What you get back",
        body: [
          "Translate PDF outputs a Markdown file and a plain-text file, delivered together as a single ZIP. Markdown keeps the translation usable as a document — read it as-is, convert it, or paste it wherever the text needs to go. Plain text is the same words with nothing else attached.",
          "What it does not produce is a re-laid-out PDF. The translation covers the words, not the design: fonts, columns, and positioning from the original are not reconstructed in the new language. If the goal is the same PDF in a different language, plan on taking the translated text into your own layout — this tool's job is getting the words right. If what you need from a long document is the gist rather than a full translation, Summarize PDF works from the same selectable text.",
        ],
      },
      {
        id: "long-documents-and-limits",
        heading: "Long documents, oversized pages, and the allowance",
        body: [
          "Each translation pass carries a bounded amount of selectable text, because translation writes roughly as much as it reads. The exact character figures, and the approximate page ranges they work out to, are stated on the Translate PDF page itself. A longer document is not refused: it is split at page boundaries, translated a few pages at a time, and reassembled in order, so the result reads front to back like the original.",
          `Two limits can still show up in the output, and both announce themselves. A single page holding more text than one pass can carry cannot be translated at all — it is skipped, and the result says so in place, right where that page was. And the amount translated in a day is bounded by the free allowance. ${aiAllowanceFactFor("translate-pdf")} A document longer than the allowance covers is translated as far as the allowance reaches, with the rest marked in place and the reason named — nothing stops silently. Files themselves are capped at ${ceilingMb("translate-pdf")} MB.`,
        ],
      },
      {
        id: "where-your-file-goes",
        heading: "Where your file goes",
        body: [
          `Translate PDF is one of the AI tools, so processing does not run in your browser. Your PDF uploads over an encrypted connection to our processing server. The server extracts the PDF's selectable text and sends that text to a third-party AI provider, which writes the translation — the PDF file itself is not sent to the provider. Inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. Section 3 of our privacy policy covers the provider's side.`,
          "No account is needed for any of this. Open the tool, translate, and download the result.",
        ],
      },
      {
        id: "scanned-pdfs-need-ocr-first",
        heading: "Scanned PDFs need OCR first",
        body: [
          "The tool translates a PDF's selectable text — the kind you can highlight and copy. A scanned document is a picture of text, so there is nothing selectable to translate. Run the scan through OCR PDF first to recognize the text, then bring the result to Translate PDF.",
          `OCR PDF advertises ${OCR_LANGUAGES.length} recognition languages, with up to ${MAX_OCR_LANGUAGES} selectable per job, and its page's live status shows which language packs are actually installed.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I translate a PDF for free?",
        answer: `Yes, with no account. ${aiAllowanceFactFor("translate-pdf")} If a document needs more than the allowance has left, it is translated as far as the allowance reaches, and the untranslated remainder is marked in place with the reason named.`,
      },
      {
        question: "What happens to my PDF after it is translated?",
        answer: `Our processing server extracts its selectable text and sends that text — not the file — to a third-party AI provider for translation. Inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "Which languages can I translate a PDF into?",
        answer: TRANSLATE_LANGUAGES_ANSWER,
      },
      {
        question: "Will the translation look like the original PDF?",
        answer:
          "No. The output is translated Markdown and plain text, not a re-laid-out PDF. The words are translated; the original's design is not rebuilt around them. Take the text into your own document if you need the translation typeset.",
      },
      {
        question: "How much of a PDF can be translated in one run?",
        answer:
          "Each pass carries a bounded amount of selectable text — the exact figures are stated on the Translate PDF page. A longer document is split at page boundaries, translated pass by pass, and reassembled in order. Two things bound how far one run gets. A single page holding more text than a pass can carry cannot be translated at all — it is skipped, and the result notes it in place. And the free daily allowance: the run translates as far as the allowance reaches, with the rest marked in place and the reason named.",
      },
      {
        question: "Can I translate a scanned PDF?",
        answer:
          "Not directly — a scan has no selectable text. Use OCR PDF to recognize the text first, then translate the output.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-10",
  },
  {
    slug: "how-to-delete-pages-from-a-pdf",
    title: "How to delete pages from a PDF",
    description:
      "Remove unwanted pages from a PDF by clicking thumbnails or typing a range — right in your browser, so the file never leaves your device. No account needed.",
    tools: ["remove-pages", "extract-pages", "organize-pages"],
    keywords: [
      "delete pages from pdf",
      "remove pages from pdf",
      "delete a page in a pdf",
      "trim pdf pages",
    ],
    intro: [
      "To delete pages from a PDF, open the Delete Pages tool, pick your file, select the pages you want gone, and download the trimmed copy. Every page appears as a thumbnail, so you can see exactly what you are removing before anything changes.",
      "The work happens in your browser: the PDF stays on your device from start to finish, and there is no account to create. Your original file is never changed — the download is a new PDF without the pages you removed.",
      "This guide covers the ways to select pages, what the trimmed file keeps, and when Extract Pages or Organize Pages is the better fit.",
    ],
    steps: [
      "Open the Delete Pages tool.",
      "Pick the PDF you want to trim — it stays on your device the whole time.",
      "Click each page you want to delete. Hold Shift and click to select a whole run of pages at once.",
      "Or type the pages as a list, such as 1-3, 5, and press Select.",
      "Delete the selected pages. At least one page has to stay, so the tool will not remove every page.",
      "Download the trimmed PDF.",
    ],
    sections: [
      {
        id: "selecting-pages",
        heading: "Three ways to select pages",
        body: [
          "Clicking a thumbnail selects that page, and clicking it again deselects it. Holding Shift while you click selects every page between the one you touched last and this one — the quick way to clear out a run of pages at the end of a scan.",
          `Typing is faster in a long document. Enter single pages and ranges separated by commas — 1-3, 5 selects pages one to three and page five — and press Select. A range can be left open: 10- runs from page ten to the end. To delete every other page, list them: ${EVERY_OTHER_PAGE_EXAMPLE}.`,
          "Select all, Clear and Invert work on the whole selection. Invert flips it — every selected page becomes unselected and every other page becomes selected — which helps when it is easier to pick the pages you want to keep.",
        ],
      },
      {
        id: "what-the-file-keeps",
        heading: "What the trimmed file keeps",
        body: [
          pageToolKeeps("subset"),
          "Your original is never modified. Deleting pages produces a new PDF, and the file you started from stays exactly as it was on your device — so a page removed by mistake is still there to go back to.",
        ],
      },
      {
        id: "related-tools",
        heading: "When another tool fits better",
        body: [
          "If you want to keep a few pages rather than remove a few, Extract Pages is the mirror image: select the pages to keep and export them as a new PDF. Organize Pages lets you delete, reorder, rotate and duplicate pages on one board in a single pass.",
          `Both run in your browser as well. Delete Pages accepts PDFs up to ${ceilingMb("remove-pages")} MB per file.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent to a server when I delete pages?",
        answer:
          "No. Delete Pages runs entirely in your browser, and the file stays on your device from start to finish.",
      },
      {
        question: "Can I get a deleted page back?",
        answer:
          "Yes, from your original: it is never changed. The download is a new PDF, so every page you removed is still in the file on your device.",
      },
      {
        question: "Does the trimmed PDF keep bookmarks and form fields?",
        answer: pageToolKeepsAnswer("subset"),
      },
      {
        question: "How do I delete every other page?",
        answer: `Type the pages as a list — for example ${EVERY_OTHER_PAGE_EXAMPLE} — and press Select; those pages are selected, and Delete removes them.`,
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("remove-pages")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-07",
  },
  {
    slug: "how-to-convert-markdown-to-pdf",
    title: "How to convert Markdown to PDF",
    description:
      "Paste Markdown or pick a .md file and get a typeset PDF — headings, lists, quotes and code — made in your browser, so nothing leaves your device.",
    tools: ["markdown-to-pdf", "text-to-pdf", "pdf-to-markdown"],
    keywords: [
      "markdown to pdf",
      "md to pdf",
      "convert markdown to pdf",
      "readme to pdf",
      "markdown pdf converter",
    ],
    intro: [
      "To turn Markdown into a PDF, open the Markdown to PDF tool, paste your Markdown or pick a .md file, and create the PDF. Headings, lists, quotes and code blocks are typeset into pages right in your browser.",
      "Nothing is sent to a server: the text stays on your device from start to finish, and there is no account to create.",
      "This guide lists the Markdown the tool supports, what the finished page looks like, and when Text to PDF is the simpler choice.",
    ],
    steps: [
      "Open the Markdown to PDF tool.",
      "Paste your Markdown into the editor, or pick a .md file — it stays on your device.",
      "Create the PDF — it is typeset in your browser.",
      "Download the PDF.",
    ],
    sections: [
      {
        id: "supported-markdown",
        heading: "The Markdown it supports",
        body: [
          MARKDOWN_SYNTAX_FACT,
          "Headings run from # to ######, lists can be bulleted or numbered, and code inside triple-backtick fences is set in a fixed-width font with its line breaks kept.",
        ],
      },
      {
        id: "the-page",
        heading: "What the PDF looks like",
        body: [
          `${TEXT_PAGE_FACT} There is no page-size or margin setting.`,
          `Sources can be up to ${MAX_SOURCE_MB} MB. For plain notes without any Markdown, Text to PDF paginates the text as it is; to go the other way, PDF to Markdown turns a PDF's selectable text back into Markdown.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my Markdown sent to a server?",
        answer:
          "No. Markdown to PDF runs entirely in your browser, and the text stays on your device from start to finish.",
      },
      {
        question: "Does it support tables?",
        answer:
          "Yes. A GFM table — a header row, then a divider row of dashes — prints as a grid, keeping each column's alignment and wrapping long cells to fit the page width.",
      },
      {
        question: "Can I choose the page size?",
        answer: `No. ${TEXT_PAGE_FACT}`,
      },
      {
        question: "Does Markdown to PDF work offline?",
        answer: `Not fully. ${offlineAnswer("markdown-to-pdf")}`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-28",
  },
  {
    slug: "how-to-redact-a-pdf",
    title: "How to redact a PDF permanently",
    description:
      "Redact a PDF so the text under each box is gone, not hidden: every page is rebuilt as an image, right in your browser. No account needed.",
    tools: ["redact-pdf", "ocr-pdf", "protect-pdf"],
    keywords: [
      "redact pdf",
      "how to redact a pdf",
      "black out text in pdf",
      "redact text in a pdf",
      "remove sensitive information from pdf",
      "redact pdf in browser",
    ],
    intro: [
      "To redact a PDF, open the Redact PDF tool, add a box over each area that has to go, and download the result. The box is not drawn on top of the text: the page is turned into an image and the box is painted into its pixels, so what was underneath no longer exists in the file.",
      `That is the whole difference between redacting and covering, and it has a cost worth knowing before you start. ${REDACT_OUTPUT_FACT}`,
      "Redact PDF runs in your browser, so the document you are redacting stays on your device. No account is needed.",
    ],
    steps: [
      "Open the Redact PDF tool.",
      "Pick the PDF you need to redact — it stays on your device the entire time.",
      "For each area to remove, enter its “Page” and its position and size in PDF points, measured from the bottom-left corner of the page, then press “Add area”. The preview shows where each box lands.",
      `Choose the “Redaction fill” — “Black” or “White” — and the output quality: ${REDACT_PRESET_CHOICES}.`,
      "Press “Redact PDF” and save the new file to your device. Your original file is not changed.",
    ],
    sections: [
      {
        id: "redacting-is-not-covering",
        heading: "Redacting is not the same as covering",
        body: [
          "A black rectangle drawn over text in a PDF editor hides it from view and nothing more. The text is still in the file, and anyone can select it, copy it or find it with a search — which is how redacted documents leak.",
          `Redact PDF removes it instead. ${REDACT_MECHANISM}`,
        ],
      },
      {
        id: "every-page-becomes-an-image",
        heading: "The trade-off: every page becomes an image",
        body: [
          REDACT_OUTPUT_FACT,
          "If the rest of the document needs to stay searchable, run the redacted file through OCR PDF afterwards. OCR recognizes the text that is still visible on the pages; the text under a box is gone, so there is nothing there for it to find.",
          `Choose the resolution before you run: ${REDACT_PRESET_CHOICES}. A higher resolution keeps small print legible and makes a larger file.`,
        ],
      },
      {
        id: "your-file-stays-on-your-device",
        heading: "Your file stays on your device",
        body: [
          "Redact PDF is an in-browser tool: your browser renders the pages and rebuilds the file, so the document you are redacting never leaves your device. That matters most for exactly the files people redact — contracts, statements and records with personal details in them.",
          `It is not fully offline. ${offlineAnswer("redact-pdf")}`,
        ],
      },
      {
        id: "before-you-share-it",
        heading: "Before you share it",
        body: [
          "Open the downloaded PDF and check that each box sits where you meant it to before you send the file anywhere: a box placed a little off leaves the edge of a word readable.",
          "Redaction removes content; it does not lock the file. If the redacted PDF should also need a password to open, run it through Protect PDF afterwards.",
        ],
      },
    ],
    faq: [
      {
        question: "Can redacted text be recovered?",
        answer: REDACT_RECOVERY_ANSWER,
      },
      {
        question: "Is a redacted PDF still searchable?",
        answer: REDACT_SEARCH_ANSWER,
      },
      {
        question: "Does my PDF leave my device when I redact it?",
        answer:
          "No. Redact PDF runs entirely in your browser, so the file stays on your device from start to finish.",
      },
      {
        question: "Does Redact PDF work offline?",
        answer: `Not fully. ${offlineAnswer("redact-pdf")}`,
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("redact-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-repair-a-damaged-pdf",
    title: "How to repair a damaged or corrupted PDF",
    description:
      "Rebuild a damaged PDF with qpdf on a secure worker that deletes the input when the job finishes, and see what had to be fixed. No account needed.",
    tools: ["repair-pdf", "unlock-pdf", "ocr-pdf"],
    keywords: [
      "repair pdf",
      "fix corrupted pdf",
      "repair damaged pdf",
      "pdf file is damaged",
      "recover a broken pdf",
      "repair pdf online",
    ],
    intro: [
      "To repair a damaged PDF, open the Repair PDF tool, upload the file, and download the rebuilt copy. The worker runs the file through qpdf, which reads what it can of the damaged structure and writes it out as a new, well-formed PDF.",
      `Repair PDF is a server tool: your file travels over an encrypted connection to a secure worker, which deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. No account is needed.`,
    ],
    steps: [
      "Open the Repair PDF tool.",
      `Upload the damaged PDF — it travels over an encrypted connection, and files up to ${ceilingMb("repair-pdf")} MB are accepted. It only has to start like a PDF, so a truncated file is taken in.`,
      "Press “Repair on the worker”. qpdf rewrites the file's structure on the secure worker, which deletes the input when the job finishes.",
      "If the file had to be rebuilt, read the list above the download: it names what was reconstructed.",
      `Download the repaired PDF. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
    ],
    sections: [
      {
        id: "what-it-can-take",
        heading: "Which files Repair PDF can take",
        body: [
          REPAIR_TAKES,
          "How much comes back depends on what survived. The repair rebuilds the file around the content it can still read; it cannot recreate content that is no longer in the file.",
        ],
      },
      {
        id: "reading-the-warnings",
        heading: "Reading the warnings",
        body: [
          REPAIR_WARNINGS_ANSWER,
          "Compare those parts against the original, or against another copy of the document if you have one, before you rely on the repaired file.",
        ],
      },
      {
        id: "where-the-repair-runs",
        heading: "Where the repair runs",
        body: [
          `Repair PDF runs on a secure worker, not in your browser. Your file is uploaded over an encrypted connection, qpdf rebuilds it there, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
        ],
      },
      {
        id: "when-it-is-not-damage",
        heading: "When the problem is not damage",
        body: [
          "A PDF that asks for a password is locked, not broken. If you know the password, Unlock PDF removes it and gives you an unprotected copy; it cannot recover a password you do not know.",
          "A scanned document that opens but has no text you can select is not damaged either — its pages are pictures. OCR PDF recognizes the text in them.",
        ],
      },
    ],
    faq: [
      {
        question: "Which damaged PDFs can be repaired?",
        answer: REPAIR_TAKES,
      },
      {
        question: "What do the warnings after a repair mean?",
        answer: REPAIR_WARNINGS_ANSWER,
      },
      {
        question: "What happens to my PDF after the repair runs?",
        answer: `The file is processed on a secure worker, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("repair-pdf")} MB per file.`,
      },
      {
        question: "Do I need an account to repair a PDF?",
        answer:
          "No account is needed. Open Repair PDF, upload the file, and download the repaired copy.",
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-10",
  },
  {
    slug: "how-to-add-page-numbers-to-a-pdf",
    title: "How to add page numbers to a PDF",
    description: `Add page numbers to a PDF in your browser: pick a format and one of ${STAMP_POSITIONS.length} positions, skip the cover, and choose the first number. No account needed.`,
    tools: ["page-numbers", "header-footer", "merge-pdf"],
    keywords: [
      "how to add page numbers to a pdf",
      "add page numbers to pdf",
      "number pdf pages",
      "pdf page numbering",
      "skip cover page numbering",
    ],
    intro: [
      `To add page numbers to a PDF, open ${nameOf("page-numbers")}, pick your file, choose a number format and a position, and download the numbered copy. The numbers are drawn right in your browser, so the file stays on your device.`,
      "Two settings do most of the work on real documents. Start on page leaves a cover or title page unnumbered, and First number sets the number counting starts from — useful when a document continues from an earlier one.",
    ],
    steps: [
      `Open the ${nameOf("page-numbers")} tool and pick your PDF — it stays on your device.`,
      "Choose a number format preset, or write your own template with {n} for the page number and {total} for the last number.",
      `Pick one of the ${STAMP_POSITIONS.length} positions for the number.`,
      "Set Start on page to skip a cover, and First number to choose where counting starts.",
      "Check the preview beside the format — it shows the label the first numbered page will carry.",
      "Select Add page numbers, then download the numbered PDF.",
    ],
    sections: [
      {
        id: "choosing-a-format",
        heading: "Choosing a format",
        body: [
          "The presets cover the common styles, “Page 1 of N” among them, and the template field takes anything else: {n} becomes the page number and {total} the last number printed, so “{n} / {total}” and “Page {n}” both work.",
        ],
      },
      {
        id: "skipping-the-cover",
        heading: "Skipping the cover and choosing the first number",
        body: [
          "Pages before Start on page get no number at all. First number is the number printed on the first numbered page, and every page after it counts up from there.",
          "{total} follows the same count: it is the last number that will be printed, so a skipped cover is not included in it. With a cover and four pages after it, Start on page 2 and First number 1 turn the default “Page {n} of {total}” into “Page 1 of 4” through “Page 4 of 4”.",
        ],
      },
      {
        id: "position-and-rotated-pages",
        heading: "Position, and pages that are rotated",
        body: [
          `The number can sit in any of ${STAMP_POSITIONS.length} positions: each corner, the middle of each edge, or the center. On a page that carries a rotation, the number still lands in the spot you picked as the page is viewed, and it reads upright.`,
        ],
      },
      {
        id: "before-and-beyond-numbers",
        heading: "Before numbering, and beyond it",
        body: [
          `If the document is still in several files, combine them first with ${nameOf("merge-pdf")}, so the numbering runs across the whole thing instead of restarting in each part.`,
          `If you need more than a number — a title, a date, a confidentiality line — ${nameOf("header-footer")} adds a header and footer with your own text, plus {n}, {total} and {date} fields.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I leave the cover page unnumbered?",
        answer:
          "Yes. Set Start on page to 2 and the cover gets no number; leave First number at 1, and the page after the cover is numbered 1.",
      },
      {
        question: "Can numbering start at a number other than 1?",
        answer:
          "Yes. First number sets it: set it to 5, and the first numbered page shows 5.",
      },
      {
        question: "Does my PDF leave my device?",
        answer: `No. ${nameOf("page-numbers")} runs entirely in your browser, and the file stays on your device from start to finish.`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("page-numbers")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-flatten-a-pdf-form",
    title: "How to flatten a filled PDF form",
    description:
      "Flatten a filled PDF form in your browser, so its answers become part of the page and can't be edited — before you send it, print it or lock it with a password.",
    tools: ["flatten-pdf", "fill-forms", "protect-pdf"],
    keywords: [
      "how to flatten a pdf form",
      "flatten pdf",
      "flatten pdf form",
      "lock pdf form fields",
      "make pdf form not editable",
    ],
    intro: [
      `To flatten a PDF form, open ${nameOf("flatten-pdf")}, pick the filled PDF and select Flatten form fields. Each field's current value is drawn into the page and the field itself is removed, so the answers can no longer be changed in a PDF viewer. It runs in your browser, so the file stays on your device.`,
      `Flattening is the last step of a form's life. Fill it in first — ${nameOf("fill-forms")} completes a PDF's existing form fields in your browser — then flatten the copy you are about to send.`,
    ],
    steps: [
      `Open the ${nameOf("flatten-pdf")} tool and pick your filled PDF — it stays on your device.`,
      "Check that the answers are final — the flattened copy has no fields left to change.",
      "Select Flatten form fields.",
      "Read the result: it says how many form fields were flattened, or that none were found.",
      "Download the flattened PDF, and keep the original if you may need to edit the answers again.",
    ],
    sections: [
      {
        id: "what-gets-flattened",
        heading: "What gets flattened",
        body: [
          "Every fillable form field — text boxes, checkboxes, radio buttons, dropdowns and list boxes — is drawn into the page with its current value and removed as a field. Comments and layers are not form fields, and they are re-saved unchanged.",
          "A PDF with no form fields is re-saved as it is, and the result says no fillable form fields were found — so a file that only looks like a form, such as a scanned paper form, is not changed.",
        ],
      },
      {
        id: "when-flattening-is-refused",
        heading: "When flattening is refused",
        body: [
          "A text field holding characters outside the basic PDF alphabet — Bengali, Chinese or Greek, for example — cannot be flattened yet, because the field is drawn with the form's own font. Instead of producing a page with those characters missing, the tool stops and says which characters it could not draw.",
        ],
      },
      {
        id: "after-flattening",
        heading: "After flattening",
        body: [
          `Flattening stops the answers being edited, but anyone who has the file can still open and read it. If it should only open for certain people, ${nameOf("protect-pdf")} adds a password with AES encryption. That step runs on a secure worker rather than in your browser.`,
        ],
      },
    ],
    faq: [
      {
        question: "Why flatten a filled PDF form?",
        answer:
          "So the answers you send are the answers that are read. A flattened copy has no fields left for anyone to change, and its values are part of the page rather than something a viewer draws on top of it.",
      },
      {
        question: "Can I undo flattening?",
        answer:
          "Not in the flattened copy — its fields are gone. The file you picked is not changed, so keep it if you may need to edit the answers again.",
      },
      {
        question: "What if my PDF has no form fields?",
        answer:
          "Nothing is flattened: the file is re-saved as it is, and the result says no fillable form fields were found.",
      },
      {
        question: "Does my PDF leave my device?",
        answer: `No. ${nameOf("flatten-pdf")} runs entirely in your browser, and the file stays on your device from start to finish.`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("flatten-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-compare-two-pdf-files",
    title: "How to compare two PDF files",
    description:
      "Compare two versions of a PDF in your browser: page count, file size and every added or removed line of text, with a downloadable report. Scans need OCR first.",
    tools: ["compare-pdf", "ocr-pdf", "pdf-to-text"],
    keywords: [
      "how to compare two pdf files",
      "compare pdf",
      "pdf diff",
      "find differences between two pdfs",
      "compare pdf versions",
    ],
    intro: [
      `To compare two PDF files, open ${nameOf("compare-pdf")}, pick the two versions, and select Compare PDFs. You get their page counts, the size difference and every line of text that was added or removed, plus a report you can download. It runs in your browser, so both files stay on your device.`,
      "The comparison reads the text in each PDF, line by line. That makes it good at the question most people are asking — what changed in the wording — and blind to changes that are only visual.",
    ],
    steps: [
      `Open the ${nameOf("compare-pdf")} tool.`,
      "Pick two PDFs — the first is treated as the original, the second as the revised version. Both stay on your device.",
      "Select Compare PDFs.",
      "Read the summary: the page counts, the size difference and the number of changed lines.",
      "Review the lines marked removed (-) and added (+).",
      "Download the comparison report as a .txt file.",
    ],
    sections: [
      {
        id: "what-counts-as-a-change",
        heading: "What counts as a change",
        body: [
          "A line of selectable text that is in one PDF and not the other. Lines only in the first PDF are listed as removed, and lines only in the second as added. Extra spaces inside a line and blank lines are ignored, so reflowed spacing does not flood the report.",
          "Because the first file is the original, the order you pick them in matters: swap them and every addition becomes a removal.",
        ],
      },
      {
        id: "scanned-pdfs",
        heading: "Scanned PDFs need OCR first",
        body: [
          `${nameOf("compare-pdf")} reads the text already embedded in each PDF. A scanned page is a picture with no text in it, so two scans compare as having no selectable text at all. Run each one through ${nameOf("ocr-pdf")} first — it adds a searchable text layer on a secure worker — then compare the results.`,
        ],
      },
      {
        id: "what-it-does-not-compare",
        heading: "What it does not compare",
        body: [
          `Formatting, images, colors and layout are not compared — this is a text comparison, not a visual one. To read one file's text on its own, ${nameOf("pdf-to-text")} extracts it as a plain .txt file.`,
        ],
      },
    ],
    faq: [
      {
        question: "Does the order of the two files matter?",
        answer:
          "Yes. The first file is treated as the original and the second as the revised version: lines only in the first are listed as removed, and lines only in the second as added.",
      },
      {
        question: "Why does it say no selectable text was found?",
        answer: `Both PDFs are most likely scans, which carry pictures of text rather than text. Run them through ${nameOf("ocr-pdf")} first, then compare the results.`,
      },
      {
        question: "Do my files leave my device?",
        answer: `No. ${nameOf("compare-pdf")} runs entirely in your browser, and both files stay on your device from start to finish.`,
      },
      {
        question: "How large can each PDF be?",
        answer: `Up to ${ceilingMb("compare-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-remove-a-password-from-a-pdf",
    title: "How to remove a password from a PDF",
    description:
      "Remove the password from a PDF you can open: type the password that works and download an unprotected copy. Runs on an auto-deleting worker.",
    tools: ["unlock-pdf", "protect-pdf"],
    keywords: [
      "how to remove a password from a pdf",
      "remove password from pdf",
      "unlock pdf",
      "decrypt pdf",
      "remove pdf password",
    ],
    intro: [
      `To remove a password from a PDF, open ${nameOf("unlock-pdf")}, add the protected file, type the password that opens it, and download an unprotected copy. Anyone can then open that copy without a password.`,
      `${nameOf("unlock-pdf")} runs on a secure worker rather than in your browser, because decryption uses the native qpdf engine. Your file uploads over an encrypted connection, and the worker deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      "It is not a password cracker. It needs the password that currently opens the file, and it cannot recover, guess or bypass a password nobody knows.",
    ],
    steps: [
      `Open the ${nameOf("unlock-pdf")} tool.`,
      "Add the password-protected PDF — it uploads over an encrypted connection to the secure worker.",
      "Type the password that currently opens the file.",
      "Run the tool. The secure worker removes the encryption and deletes the input when the job finishes.",
      `Download the unlocked copy. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
      "Open the downloaded copy to confirm it no longer asks for a password.",
    ],
    sections: [
      {
        id: "what-unlocking-does",
        heading: "What unlocking does",
        body: [
          "Unlocking decrypts the file with the password you type and writes a copy with the encryption removed. The pages themselves are not changed: it is the same document, without the lock.",
        ],
      },
      {
        id: "the-password-you-need",
        heading: "You need the password that opens it",
        body: [
          "An empty password is refused before the job starts, and a password that does not open the file ends the job without an output. Nothing is guessed or tried on your behalf.",
        ],
      },
      {
        id: "putting-the-lock-back",
        heading: "Putting a password back",
        body: [
          `If you only needed the lock off to make a change, put it back afterwards: ${nameOf("protect-pdf")} encrypts a PDF with AES so it only opens with a password, and it runs on the same kind of secure worker.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I remove a password I do not know?",
        answer: `No. ${nameOf("unlock-pdf")} needs the password that currently opens the file. It does not guess, recover or bypass passwords.`,
      },
      {
        question: "Is my PDF uploaded when I unlock it?",
        answer:
          "Yes. Unlocking runs on a secure worker rather than in the browser. The file travels over an encrypted connection, and the worker deletes the input when the job finishes.",
      },
      {
        question: "How long is the unlocked copy available?",
        answer: `The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. Download it as soon as the job completes.`,
      },
      {
        question: "How large can my file be?",
        answer: `Up to ${ceilingMb("unlock-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-10",
  },
];
