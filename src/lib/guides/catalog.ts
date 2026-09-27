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
  PAGE_REBUILD_KEEPS,
  PDF_TO_WORD_KEEPS,
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
  offlineAnswer,
} from "@/lib/tools/tool-facts";
import { TRANSLATE_LANGUAGES } from "@/lib/jobs/translate-pdf";
import {
  DEFAULT_RESOLUTION_ID,
  RASTER_MAX_DEVICE_PX,
  RASTER_PREVIEW_LIMIT,
  RASTER_RESOLUTION_CHOICES,
  RASTER_RESOLUTION_DPIS,
  pageImageName,
  resolutionById,
} from "@/lib/pdf/pdf-to-image";
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
      "Drag pages or files into the order you want; the combined PDF follows your list from top to bottom.",
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
    tools: ["compress-pdf", "optimize-web", "grayscale-pdf"],
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
          `Compress PDF is a hybrid tool, and the two paths have different privacy stories — both stated plainly. The size analysis and the lossless repack happen on your device: for that path, your PDF never leaves your browser. The optional deep image compression step is different: there, your file is uploaded to an encrypted, isolated worker, and inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
          "Because the availability check runs first, nothing is sent to a worker that is not there to receive it.",
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
        answer: `The job runs on an encrypted, isolated worker, and inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "Do I need an account to compress a PDF?",
        answer:
          "No account is needed. Open the tool, add your PDF, review the breakdown, and save the result.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-convert-pdf-to-word",
    title: "How to convert a PDF to an editable Word document",
    description:
      "Convert a PDF into an editable Word (DOCX) file on an encrypted, isolated worker that deletes the input when the job finishes. No account needed.",
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
      "To convert a PDF into an editable Word document, open the PDF to Word tool, upload your PDF, and download the result as a DOCX file. The conversion carries the PDF's selectable text into Word, one paragraph per line, so you edit the words instead of retyping them.",
      `PDF to Word is a server tool: your PDF travels over an encrypted connection to an encrypted, isolated worker, and the worker deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      `There is no account to create. Pick a PDF up to ${ceilingMb("pdf-to-word")} MB, let the worker convert it, and save the DOCX before the link expires.`,
    ],
    steps: [
      "Open the PDF to Word tool.",
      `Upload the PDF you want to convert — it travels over an encrypted connection, and files up to ${ceilingMb("pdf-to-word")} MB are accepted.`,
      "Start the conversion.",
      "Wait while the secure worker converts the PDF into a Word document. The worker deletes the input when the job finishes.",
      `Download the DOCX. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
      "Open the downloaded DOCX in Word and format the text the way you need it — the words arrive as plain paragraphs, one per line of the PDF.",
    ],
    sections: [
      {
        id: "what-you-get",
        heading: "What to expect from the converted document",
        body: [
          `The output is a DOCX file, the standard editable Word format. ${PDF_TO_WORD_KEEPS}`,
          "That makes PDF to Word the right tool when you need the words back to rework them — rewrite a paragraph, fix a date, reuse a section — and the wrong one when the look of the page is what matters. For that, keep the PDF itself.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Where the conversion runs",
        body: [
          `PDF to Word runs on an encrypted, isolated worker, not in your browser. Your file is uploaded over an encrypted connection, the worker processes it, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
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
          "If you only need the words and not the formatting, PDF to Text pulls the plain text out. And when the editing is done, Word to PDF converts your finished document back in the other direction.",
        ],
      },
    ],
    faq: [
      {
        question: "Does PDF to Word upload my file?",
        answer:
          "Yes. PDF to Word is a server tool: your PDF is uploaded over an encrypted connection and processed on an encrypted, isolated worker. The worker deletes the input when the job finishes.",
      },
      {
        question: "What happens to my PDF after the conversion runs?",
        answer: `The file is processed on an encrypted, isolated worker, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
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
        answer: `No. It holds the PDF's words, not its design. ${PDF_TO_WORD_KEEPS} If your PDF is a scanned image rather than typed text, use the OCR PDF tool first so there is recognized text to convert.`,
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-convert-jpg-to-pdf",
    title: "How to convert JPG to PDF",
    description:
      "Combine JPG photos into one PDF right in your browser — your files never leave your device. One photo per page, in the order you set. No account needed.",
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
          "There is no page-size, orientation or margin setting: the page is the same for every photo, which keeps a stack of mismatched pictures reading as one document. If a page needs turning afterwards, Rotate PDF does that in your browser too.",
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
          `Sign PDF offers ${signatureWays} ways to make a signature: draw it, type it, or pick an image. Drawing produces a mark that looks like your handwriting and suits documents where a personal touch matters. Typing is the fastest option, and it comes in ${countWord(SIGNATURE_STYLES.length)} styles — script, which sets your typed name in an italic serif face, and print, a plain printed name. If you already keep a scanned signature as a PNG or JPG image, pick that image and reuse the mark you have always used.`,
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
      "OCR a scanned PDF so its text becomes searchable and selectable — processed on an encrypted, auto-deleting worker, no account needed.",
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
      "This tool runs on a secure worker rather than in your browser. Your file uploads over an encrypted connection, the job runs on an encrypted, isolated worker, and the input is deleted when the job finishes. There is no account step anywhere in the flow — open the page, add the file, download the result.",
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
          "OCR PDF does its work on a secure worker: your file uploads over an encrypted connection and is processed on an encrypted, isolated worker. The input is deleted when the job finishes.",
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
        answer: `The job runs on an encrypted, isolated worker, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
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
    updated: "2026-09-17",
  },
  {
    slug: "how-to-password-protect-a-pdf",
    title: "How to password-protect a PDF",
    description:
      "Password-protect a PDF with real AES encryption (qpdf). Your file goes to an encrypted, auto-deleting worker, and no account is needed.",
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
      `Protect PDF is a server tool: encryption runs on an encrypted, auto-deleting secure worker rather than in your browser. Your file uploads over an encrypted connection, and the worker deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
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
          `Protect PDF runs on the server side, because the encryption uses qpdf on an encrypted, auto-deleting secure worker. Your PDF travels over an encrypted connection, the isolated worker applies the encryption, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
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
          "Yes. Protect PDF runs on a secure worker rather than in the browser, because the AES encryption is applied with qpdf. The file travels over an encrypted connection, the worker is encrypted and isolated, and it deletes the input when the job finishes.",
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
        answer:
          "The password cannot be recovered through pdf.xyz. The Unlock PDF tool removes a password from a PDF you can already open — you enter the password that works and download an unprotected copy — but it cannot recover or bypass a password you do not know. Store the password somewhere dependable before you share the protected file.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-17",
  },
  {
    slug: "how-to-translate-a-pdf",
    title: "How to translate a PDF into another language",
    description:
      "Translate a PDF into another language with AI. Get Markdown and plain text back; the encrypted, isolated worker wipes inputs at job end. No account needed.",
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
    updated: "2026-09-27",
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
          `${PAGE_REBUILD_KEEPS} If you rely on either, keep the original alongside the trimmed copy.`,
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
        answer: `No. ${PAGE_REBUILD_KEEPS}`,
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
    updated: "2026-09-27",
  },
  {
    slug: "how-to-convert-pdf-to-jpg-or-png",
    title: "How to convert PDF pages to JPG or PNG images",
    description: `Turn every page of a PDF into a JPG or PNG image at ${RASTER_RESOLUTION_DPIS} DPI — rendered in your browser, so the file never leaves your device. No account needed.`,
    tools: ["pdf-to-jpg", "pdf-to-png", "extract-images"],
    keywords: [
      "pdf to jpg",
      "pdf to png",
      "convert pdf to image",
      "pdf page to image",
      "pdf to jpg high resolution",
    ],
    intro: [
      "To turn PDF pages into images, open PDF to JPG or PDF to PNG, pick your file, choose a resolution, and render. Every page becomes one image: a one-page PDF gives you a single file, and when there is more than one page they arrive as a ZIP holding every page.",
      "Rendering happens in your browser, so the PDF stays on your device from start to finish, and there is no account to create.",
      "This guide explains the resolutions, the difference between JPG and PNG, what you download, and when Extract Images is the better tool.",
    ],
    steps: [
      "Open PDF to JPG, or PDF to PNG for lossless images.",
      "Pick your PDF — it stays on your device the whole time.",
      `Choose a resolution: ${RASTER_RESOLUTION_CHOICES}.`,
      "Render — every page becomes one image, in your browser.",
      `Download the result. More than one page arrives together as one ZIP, and each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from its preview.`,
    ],
    sections: [
      {
        id: "choosing-a-resolution",
        heading: "Choosing a resolution",
        body: [
          `DPI is how many image pixels each inch of the page becomes. The presets are ${RASTER_RESOLUTION_CHOICES}; ${DEFAULT_RESOLUTION_LABEL} is selected when you open the tool. A higher DPI gives sharper images and larger files — pick it for printing or zooming in, and a lower one for sharing on screen.`,
          `Neither side of a rendered page may exceed ${RASTER_MAX_DEVICE_PX.toLocaleString("en-US")} pixels, which keeps the memory a page needs in check. A very large page, such as a poster or an engineering drawing, is rendered below the preset rather than failing.`,
        ],
      },
      {
        id: "jpg-or-png",
        heading: "JPG or PNG?",
        body: [
          "JPG files are smaller and suit photographs and scanned pages. PNG is lossless — every pixel is kept exactly — which suits text, line art and screenshots, at the cost of larger files.",
          "Both are rendered on a white background, so any transparent areas of a page come out white.",
        ],
      },
      {
        id: "what-you-download",
        heading: "What you download",
        body: [
          `A one-page PDF downloads as a single image named after your file. With more than one page, every page goes into one ZIP, named in reading order with zero-padded page numbers — ${pageImageName("report.pdf", 2, 12, "png")} — so the images sort correctly in any file browser. The first ${RASTER_PREVIEW_LIMIT} pages also get a preview with their own download button.`,
          `If what you want is the pictures embedded inside the PDF rather than images of whole pages, Extract Images pulls them out at their original resolution. PDF to JPG and PDF to PNG accept PDFs up to ${ceilingMb("pdf-to-jpg")} MB per file.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent to a server when I convert it to images?",
        answer:
          "No. The pages are rendered entirely in your browser, and the file stays on your device from start to finish.",
      },
      {
        question: "What resolution should I choose?",
        answer: `The choices are ${RASTER_RESOLUTION_CHOICES}. Choose a higher DPI for printing or zooming in, and a lower one for smaller files.`,
      },
      {
        question: "Can I convert just one page?",
        answer: `Every page is rendered, and the first ${RASTER_PREVIEW_LIMIT} each get their own download button, so you can save only the page you need. When there are more pages than that, the rest are in the ZIP, which holds every page.`,
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("pdf-to-jpg")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
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
          "Not as tables. A table's rows print as plain text, cell dividers included, so reformat a table as a list if its layout matters.",
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
    updated: "2026-09-27",
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
      "Rebuild a damaged PDF with qpdf on an encrypted, isolated worker that deletes the input when the job finishes, and see what had to be fixed. No account needed.",
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
      `Repair PDF is a server tool: your file travels over an encrypted connection to an encrypted, isolated worker, which deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. No account is needed.`,
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
          `Repair PDF runs on an encrypted, isolated worker, not in your browser. Your file is uploaded over an encrypted connection, qpdf rebuilds it there, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
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
        answer: `The file is processed on an encrypted, isolated worker, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
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
    updated: "2026-09-27",
  },
];
