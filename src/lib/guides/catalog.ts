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
import { forgottenPasswordAnswer } from "@/lib/tools/tool-facts";
import { STAMP_POSITIONS } from "@/lib/pdf/stamp";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { MAX_IMAGE_MB } from "@/lib/tools/limits";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { OCR_LANGUAGES, MAX_OCR_LANGUAGES } from "@/lib/jobs/ocr";
import { AI_ALLOWANCE_FACT } from "@/lib/jobs/ai-allowance";
import type { Guide } from "./types";

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
      "What makes this approach different is where the work happens. Merge PDF runs entirely in your browser using WebAssembly and browser APIs, so your files stay on your device from start to finish — there is no server step in the middle. There is also no account: open the page, add your files, and merge.",
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
          "Merge PDF is an in-browser tool. The processing runs on your own device using WebAssembly and browser APIs, and your files stay there from start to finish — they are never sent to a server as part of the merge. That also means there is no account: the browser you already have does the work.",
          "One honest nuance: the tool is not fully offline. The page and its processing engine load over the network, and the engine is fetched the first time you use the tool. After that, the merge itself runs entirely on your device, and a dropped connection does not interrupt work already in progress.",
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
          "No. Merge PDF runs entirely in your browser with WebAssembly and browser APIs, and your files stay on your device from start to finish.",
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
        answer:
          "Not fully. The page and its processing engine load over the network, and the engine is fetched the first time you use the tool. From there, the merge runs entirely on your device, and a dropped connection does not interrupt work already in progress.",
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
      "To split a PDF into separate files, open the Split PDF tool, pick your document, and choose how to divide it: custom page ranges, every N pages, or one file per page. The split runs immediately and the resulting PDFs download together as a ZIP.",
      "What sets this approach apart is where the work happens. Split PDF runs entirely in your browser using WebAssembly and browser APIs, so the file stays on your device from start to finish — nothing is sent anywhere to be processed. There is no account to create and nothing to install; you pick a file, split it, and save the results.",
      "This guide walks through each split mode, what the output looks like, and the limits worth knowing before you start — including when a neighboring tool like Extract Pages is the better fit for the job.",
    ],
    steps: [
      "Open the Split PDF tool.",
      "Pick the PDF you want to split — it stays on your device the whole time.",
      "Choose a split mode: custom page ranges, every N pages, or one file per page.",
      "Define the split: for ranges, list the page spans that should become separate files; for the every-N-pages rule, set how many pages each piece should hold. One file per page splits at every page boundary — each page of the document becomes its own PDF.",
      "Run the split — the processing happens in your browser, not on a server.",
      "Download the resulting files as a ZIP. Each piece inside is a complete, standard PDF.",
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
          "Every piece the split produces is a complete, standard PDF that opens in any reader — no special format, no wrapper. The results download together as a single ZIP, so a split that produces many pieces still arrives as one download instead of a scatter of separate saves. Unzip it and each range, interval, or page is there as its own file. If you later need some pieces back together as one document, the Merge PDF tool combines PDFs into one, in any order — also in your browser.",
        ],
      },
      {
        id: "where-the-split-runs",
        heading: "Where the split happens",
        body: [
          "Split PDF is an in-browser tool. The processing runs entirely on your device using WebAssembly and browser APIs, and the file never leaves it — there is no server step in the path from picking a file to saving the ZIP. That also means no account: nothing about the flow requires identifying yourself.",
          "One honest nuance about working offline: the page and its processing engine load over the network, and the engine is fetched the first time you use the tool. After that, the split itself runs entirely on your device, and a dropped connection does not interrupt work in progress.",
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
          "No. The tool runs entirely in your browser with WebAssembly and browser APIs — the file stays on your device from start to finish, and the split output is produced and saved locally.",
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("split-pdf")} MB per file. The cap applies to the input PDF you pick.`,
      },
      {
        question: "Can I split a PDF so every page becomes its own file?",
        answer:
          "Yes. Choose the one-file-per-page mode and each page of the document becomes its own PDF. The results download together as a ZIP so you get everything in one save.",
      },
      {
        question: "Does Split PDF work offline?",
        answer:
          "Not fully. The page and its processing engine load over the network, with the engine fetched when you first use the tool. After that, the split runs entirely on your device, and a dropped connection does not interrupt work in progress.",
      },
      {
        question: "What if I only need a few specific pages?",
        answer:
          "Use Extract Pages instead: pick pages by clicking thumbnails or typing a range like 1-3, 5, and export them as one brand-new PDF. It runs in your browser too, so that file also stays on your device. Split PDF is for dividing the whole document into multiple output files.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-17",
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
        id: "when-compression-is-not-the-job",
        heading: "When compression is not the job",
        body: [
          `${nameOf("optimize-web")} is often mistaken for compression, and it is not: it linearizes the file so a viewer that loads a PDF in pieces can show the first page while the rest downloads. The file does not get smaller — it can come out slightly larger — so use it when the goal is a faster first page on the web, not a lighter file.`,
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
        answer:
          "Not for the analysis or the lossless repack — both run in your browser, and on that path the file stays on your device. The optional deep image compression step is the exception: there, your PDF is uploaded to a secure, auto-deleting worker, and the page checks a worker is available before anything leaves your device.",
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
      "To convert a PDF into an editable Word document, open the PDF to Word tool, upload your PDF, and download the result as a DOCX file. The DOCX holds the PDF's selectable text as editable paragraphs, so you edit the words instead of retyping them — the formatting is not rebuilt.",
      `PDF to Word is a server tool: your PDF travels over an encrypted connection to an encrypted, isolated worker, and the worker deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      `There is no account to create. Pick a PDF up to ${ceilingMb("pdf-to-word")} MB, let the worker convert it, and save the DOCX before the link expires.`,
    ],
    steps: [
      "Open the PDF to Word tool.",
      `Upload the PDF you want to convert — it travels over an encrypted connection, and files up to ${ceilingMb("pdf-to-word")} MB are accepted.`,
      "Start the conversion.",
      "Wait while the secure worker converts the PDF into a Word document. The worker deletes the input when the job finishes.",
      `Download the DOCX. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
      "Open the downloaded DOCX in Word and start editing.",
    ],
    sections: [
      {
        id: "what-you-get",
        heading: "What to expect from the converted document",
        body: [
          "The output is a DOCX file, the standard editable Word format. It holds the PDF's selectable text, one Word paragraph for each line of the original, and that text is live: rewrite a sentence, fix a date, or reuse a passage directly in Word.",
          "What does not come across is the look. Images, fonts, tables and multi-column layout are not recreated, and a paragraph that wrapped across several lines in the PDF arrives as several short paragraphs. Expect to restyle the document; the conversion saves you the retyping, not the formatting.",
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
          "If you want the same text as a plain .txt file rather than a DOCX, PDF to Text pulls it out right in your browser. And when the editing is done, Word to PDF converts your finished document back in the other direction.",
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
        answer:
          "No — it carries over the text, not the look. Each line of selectable text becomes a paragraph in Word; images, fonts, tables and multi-column layout are not recreated. If your PDF is a scanned image rather than typed text, run it through OCR PDF first so there is recognized text to convert.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-convert-jpg-to-pdf",
    title: "How to convert JPG to PDF",
    description:
      "Combine JPG photos into one PDF right in your browser — your files never leave your device. One photo per US Letter page, no account needed.",
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
      "To turn JPG photos into a single PDF, open the JPG to PDF tool on pdf.xyz, pick your images, and run the conversion right in your browser. The tool combines your JPGs into one tidy PDF, one photo per page, in the order you set.",
      "What sets this converter apart is where the work happens: entirely in your own browser. It is built on WebAssembly and browser APIs, so your photos stay on your device from the moment you pick them to the moment you save the finished PDF — and no account is needed.",
      `Each image can be up to ${MAX_IMAGE_MB} MB, and the output is one PDF assembled on your device. That makes the tool a natural fit for photographed receipts, scanned pages saved as JPGs, or any batch of pictures that belongs together in a single file.`,
    ],
    steps: [
      "Open the JPG to PDF tool.",
      "Pick the JPG or JPEG photos you want in the PDF — they stay on your device the whole time.",
      "Put the photos in order with each one's move buttons — the first photo becomes page one.",
      "Run the conversion — it happens in your browser, not on a server.",
      "Save the finished PDF to your device.",
    ],
    sections: [
      {
        id: "page-layout",
        heading: "How each photo is placed on the page",
        body: [
          "Every photo gets its own US Letter page in portrait orientation, centered with a half-inch white margin. A photo larger than that space is scaled down to fit, keeping its proportions; a smaller one is not enlarged, so it sits at its own size in the middle of the page.",
          "The page size, orientation and margin are fixed — there is no setting to change them — so a stack of mismatched photos still comes out as one consistent document. A landscape photo is shrunk to the width of the portrait page, leaving white space above and below it. Photos are placed as their pixels are stored, so a phone photo that relies on a rotation tag to display upright may come out sideways; Rotate PDF can turn those pages afterward.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Your photos never leave your device",
        body: [
          "JPG to PDF is an in-browser tool. The conversion runs on your own machine using WebAssembly and browser APIs, and your files stay on your device from start to finish — there is no server step in the path, and no account is needed.",
          "One honest caveat about working offline: the page and its processing engine load over the network, and the engine is fetched the first time you use the tool. After that, the assembly itself runs entirely on your device, so a dropped connection does not interrupt work already in progress.",
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
          "No. The tool runs entirely in your browser using WebAssembly and browser APIs, so your files stay on your device from start to finish.",
      },
      {
        question: "Can I combine multiple JPG photos into one PDF?",
        answer:
          "Yes — that is exactly what the tool does. It assembles your JPG images into a single PDF, one image per US Letter page, in the order you set.",
      },
      {
        question: "Does JPG to PDF have page size or margin settings?",
        answer:
          "No. Every image goes on a US Letter portrait page with a half-inch margin, scaled down to fit if it is larger than that space.",
      },
      {
        question: "How large can my JPG files be?",
        answer: `Up to ${MAX_IMAGE_MB} MB per file. The images are combined into one PDF right on your device.`,
      },
      {
        question: "Does JPG to PDF work offline?",
        answer:
          "Not fully. The page and its processing engine load over the network, with the engine fetched the first time you use the tool. After that, the conversion itself runs on your device, and a dropped connection does not interrupt work in progress.",
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
      "The difference is where the work happens. This is a client-side tool: it builds the form in your browser with WebAssembly and browser APIs, so the document stays on your device from the moment you pick it to the moment you save the finished file. There is no account to create — open the page and start placing fields.",
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
          "Create Fillable Forms is a client-side tool. The processing runs in your browser using WebAssembly and browser APIs, not on a server — the PDF you pick stays on your device from start to finish. That is also why no account is required: there is nothing to set up before you start placing fields.",
          "One honest note about connectivity: the page and its processing engine arrive over the network, and the engine is fetched the first time you use the tool. From there, the work itself happens on your device, so a connection that drops mid-build does not interrupt work already in progress.",
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
          "No. Create Fillable Forms runs entirely in your browser with WebAssembly and browser APIs — the file stays on your device from start to finish. There is also no account to create.",
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
        answer:
          "Not fully. The page and its processing engine load over the network, with the engine fetched the first time you use the tool. After that, the processing itself runs on your device, and a dropped connection does not interrupt work already in progress.",
      },
      {
        question: "How do people fill out the form I made?",
        answer:
          "The result is a standard fillable AcroForm PDF. Anyone can complete it with the Fill Forms tool, which fills a PDF's existing fields — text, checkboxes, radio buttons, dropdowns, and lists — right in the browser and saves the completed copy as a PDF.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-17",
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
      "What sets this approach apart is where the work happens: on your own device. Fill Forms is an in-browser tool — it runs entirely in your browser using WebAssembly and browser APIs, so the form you picked and everything you type into it stays on your device from start to finish. That matters for forms in particular, because forms are where names, addresses, and other personal details go. There is nothing to install and no account to create — the tool runs in your web browser.",
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
          "Fill Forms is an in-browser tool. It runs entirely on your device using WebAssembly and browser APIs, and your PDF stays on your device from start to finish. The finished form does not pass through a server on its way back to you — you save the completed file straight to your device.",
          "The page and its processing engine do load over the network, and the engine is fetched the first time you use the tool, so the very first run needs a connection. After that, the filling itself runs entirely on your device, and a dropped connection does not interrupt a run that is already underway. No account is needed at any point.",
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
          "No. Fill Forms runs entirely in your browser with WebAssembly and browser APIs, and the file stays on your device from start to finish.",
      },
      {
        question: "Can I fill out a PDF form offline?",
        answer:
          "Not fully. The page and its processing engine load over the network, and the engine is fetched the first time you use the tool. After that, the filling itself runs entirely on your device, and a dropped connection does not interrupt a run that is already underway.",
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
    updated: "2026-09-17",
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
      "What sets this approach apart is where the work happens. Sign PDF runs entirely in your browser using WebAssembly and browser APIs, so the PDF and the signature you create stay on your device from start to finish. No account is needed — open the page, make your mark, and export.",
      "You also get more range than a single scribble box. There are five ways to make a signature — draw it, type it, pick an image, use a script font, or choose a print-and-scan style — so the result can be as personal or as formal as the document calls for.",
    ],
    steps: [
      "Open the Sign PDF tool.",
      "Pick the PDF you need to sign — the file stays on your device the entire time.",
      "Create your signature: draw it, type it, or pick a signature image you already have.",
      "For a different look, use the script font style or the print-and-scan style instead.",
      "Place the signature exactly where the document needs it — the tool is built for precise placement.",
      "Export your signed PDF and save it to your device.",
    ],
    sections: [
      {
        id: "five-ways-to-make-a-signature",
        heading: "Five ways to make a signature",
        body: [
          "Sign PDF offers five ways to make a signature: draw it, type it, pick an image, use a script font, or go with a print-and-scan style. Drawing produces a mark that looks like your handwriting and suits documents where a personal touch matters. Typing is the fastest option, and the script font gives a typed name a handwritten look without any drawing at all. If you already keep a scanned signature as an image file, pick that image and reuse the mark you have always used. The print-and-scan style rounds out the five.",
          "Whichever you choose, the rest works the same way: position the signature precisely on the page, then export.",
        ],
      },
      {
        id: "your-file-stays-on-your-device",
        heading: "Your file stays on your device",
        body: [
          "Sign PDF is an in-browser tool. It runs entirely in your browser with WebAssembly and browser APIs, which means the contract, lease, or offer letter you open never leaves your device — the file stays local from the moment you pick it to the moment you export. For the kind of paperwork that usually carries a signature, that is the difference that matters most.",
          "One honest nuance about connectivity: the page and its processing engine load over the network, and the engine is fetched the first time you use the tool. After that, the processing itself runs on your device, and a dropped connection does not interrupt work in progress.",
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
          "Sign PDF covers self-signing: you create and place your own signature on a document you already have. When the signature you need is someone else's, use Request Signatures instead. It prepares a copy of the PDF with a fillable signature field for each signer, plus a manifest and an audit trail. pdf.xyz does not email it or track who has signed: you send it and gather the signed copies yourself.",
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
          "No. Sign PDF runs entirely in your browser with WebAssembly and browser APIs, so the file stays on your device from start to finish.",
      },
      {
        question: "Does Sign PDF work offline?",
        answer:
          "Not fully. The page and its processing engine load over the network, and the engine is fetched the first time you use the tool. After that, the processing runs entirely on your device, and a dropped connection does not interrupt work in progress.",
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("sign-pdf")} MB per file.`,
      },
      {
        question: "Can I collect signatures from other people?",
        answer:
          "Not automatically. Sign PDF handles your own signature. Request Signatures prepares a PDF with a signature field for each person, which you then send to them yourself; pdf.xyz does not deliver, track, or certify the signatures.",
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
      "Password-protect a PDF with real AES encryption. Your file goes to an encrypted, auto-deleting worker, and no account is needed.",
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
        // One sentence for both places that say it (tool-facts owns it).
        answer: forgottenPasswordAnswer(),
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
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
      `Translate PDF is one of the AI tools, so the work does not happen in your browser: your PDF uploads over an encrypted connection to an encrypted, isolated worker, and inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. No account is needed at any point.`,
      "Know what you are getting before you start: a text translation, not a page-by-page rebuild. The output is the document's words in the new language, packaged as Markdown and plain text rather than a re-laid-out PDF. That focus on the text is also what lets long documents be handled sensibly — split at page boundaries, translated in ordered passes, and reassembled rather than refused.",
    ],
    steps: [
      "Open the Translate PDF tool.",
      "Pick the PDF you want translated. The tool reads selectable text, so if your document is a scan, run it through OCR PDF first.",
      "Upload your PDF — it travels over an encrypted connection to the secure worker that runs the job.",
      "Choose your options, including the language you want the text translated into.",
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
          `Two limits can still show up in the output, and both announce themselves. A single page holding more text than one pass can carry cannot be translated at all — it is skipped, and the result says so in place, right where that page was. And the amount translated in a day is bounded by the free allowance. ${AI_ALLOWANCE_FACT} A document longer than the allowance covers is translated as far as the allowance reaches, with the rest marked in place and the reason named — nothing stops silently. Files themselves are capped at ${ceilingMb("translate-pdf")} MB.`,
        ],
      },
      {
        id: "where-your-file-goes",
        heading: "Where your file goes",
        body: [
          `Translate PDF is one of the AI tools, so processing does not run in your browser. Your PDF uploads over an encrypted connection to an encrypted, isolated worker, which is where the AI reads the text and writes the translation. Inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
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
        answer: `Yes, with no account. ${AI_ALLOWANCE_FACT} If a document needs more than the allowance has left, it is translated as far as the allowance reaches, and the untranslated remainder is marked in place with the reason named.`,
      },
      {
        question: "What happens to my PDF after it is translated?",
        answer: `The file is processed on an encrypted, isolated worker, and inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
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
    updated: "2026-09-17",
  },
  {
    slug: "how-to-add-text-to-a-pdf",
    title: "How to add text to a PDF",
    description:
      "Add new text, images, boxes and lines to a PDF in your browser, placed by page and position. To change the existing text, convert the PDF to Word first.",
    tools: ["edit-pdf", "pdf-to-word", "redact-pdf"],
    keywords: [
      "how to add text to a pdf",
      "add text to pdf",
      "edit pdf",
      "insert image in pdf",
      "type on a pdf",
    ],
    intro: [
      `To add text to a PDF, open ${nameOf("edit-pdf")}, pick your file, add a text element with the page and position it belongs on, and export a copy with the text drawn in. It runs in your browser, so the file stays on your device.`,
      `One thing to know before you start: ${nameOf("edit-pdf")} adds new content on top of the page. It does not edit, reflow or delete the text already in the PDF. If the job is changing existing wording, ${nameOf("pdf-to-word")} converts the PDF's selectable text into an editable Word document instead — one paragraph per line, without the original layout.`,
    ],
    steps: [
      `Open the ${nameOf("edit-pdf")} tool and pick your PDF — it stays on your device.`,
      "Add a text element, type the text, and choose its color and font size.",
      "Set the page, then the X and Y position in PDF points, measured from the bottom-left corner of the page.",
      "Add images, boxes or lines the same way if you need them.",
      "Apply the edits — your additions are drawn into the pages.",
      "Download the edited copy.",
    ],
    sections: [
      {
        id: "what-you-can-add",
        heading: "What you can add",
        body: [
          "Four kinds of new content: text, PNG and JPG images, boxes — filled or outlined — and lines, with an optional arrowhead. Each one is drawn into the page's own content when you apply the edits, and the original pages, their count and their sizes are kept as they were.",
          "Nothing is turned into a picture along the way, so the text that was already in the PDF stays selectable and searchable after you add to it.",
        ],
      },
      {
        id: "placing-by-position",
        heading: "Placing things by position",
        body: [
          "There is no click-to-place canvas and no drag handles: every element is placed by numbers — the page it goes on, and an X and Y position in PDF points measured from the bottom-left corner. The page preview shows where your edits land before you apply them, so you can nudge the numbers until they sit where you want.",
        ],
      },
      {
        id: "changing-or-removing-existing-text",
        heading: "Changing or removing text that is already there",
        body: [
          `To rework the wording itself, convert the file with ${nameOf("pdf-to-word")}: it exports the PDF's selectable text as an editable Word document, one paragraph per line. Images, fonts, tables and page layout are not recreated, so it suits documents where the words matter more than the look.`,
          `A filled box drawn over existing content hides it, but the text underneath is still in the file and can be copied out. When content must actually be gone, use ${nameOf("redact-pdf")}: it covers the areas you choose with solid boxes, then rebuilds each page as a flattened image so the text and vectors underneath are removed rather than hidden.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I change the text that is already in my PDF?",
        answer: `Not with ${nameOf("edit-pdf")} — it adds new content on top and keeps the existing text exactly as it was. To rework the existing text, convert the file with ${nameOf("pdf-to-word")}. To remove content for good, use ${nameOf("redact-pdf")}.`,
      },
      {
        question: "Can I add an image or a logo to a PDF?",
        answer:
          "Yes. PNG and JPG images are placed by page and position, just like text.",
      },
      {
        question: "Does my PDF leave my device?",
        answer: `No. ${nameOf("edit-pdf")} runs entirely in your browser, and the file stays on your device from start to finish.`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("edit-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
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
      "Remove the password from a PDF you can open: type the password that works and download an unprotected copy. Runs on an encrypted, auto-deleting worker.",
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
    updated: "2026-09-27",
  },
];
