import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { DEFAULT_OCR_OUTPUT_MODE, OCR_OUTPUT_MODES } from "@/lib/jobs/ocr";
import { markdownOutputName } from "@/lib/pdf/pdf-to-markdown";

/**
 * The byte cap this runner's own gate (`useSinglePdf` → `validatePdfFile`,
 * default MAX_PDF_BYTES) refuses above, read through the per-runner ceiling
 * table and stated in whole megabytes like every other tool page.
 */
const MAX_MB = Math.round(
  RUNNER_FILE_CEILINGS["pdf-to-markdown"] / (1024 * 1024),
);

/*
 * Where-the-file-goes claims are pinned to the catalog, not typed: this page
 * says the PDF stays in the browser and that OCR PDF and Unlock PDF upload it.
 * If any of those processing modes changes, importing this file throws rather
 * than shipping a sentence that became false underneath it.
 */
function toolOrThrow(slug: string, processing: "client" | "server") {
  const tool = getToolBySlug(slug);
  if (!tool || tool.processing !== processing) {
    throw new Error(
      `pdf-to-markdown content says ${slug} is "${processing}", but the catalog disagrees`,
    );
  }
  return tool;
}
toolOrThrow("pdf-to-markdown", "client");
const ocrName = toolOrThrow("ocr-pdf", "server").name;
const unlockName = toolOrThrow("unlock-pdf", "server").name;
const textName = toolOrThrow("pdf-to-text", "client").name;

/** The OCR panel's default output choice, by the label it shows. */
const ocrSearchableLabel = OCR_OUTPUT_MODES.find(
  (mode) => mode.id === DEFAULT_OCR_OUTPUT_MODE,
)?.label;
if (!ocrSearchableLabel) {
  throw new Error("pdf-to-markdown content: OCR default output has no label");
}

/** A worked example of the download name, from the runner's own namer. */
const exampleOutput = markdownOutputName("report.pdf");

/*
 * Behaviour claims below were checked against src/lib/pdf/pdf-to-markdown.ts,
 * src/lib/pdf/text.ts, src/components/tools/runner/pdf-to-markdown-runner.tsx,
 * single-pdf-runner.tsx / use-single-pdf.ts and runner-kit.tsx (Dropzone
 * "Drop your PDF here, or" + "browse", ResultPanel "Start over").
 *
 * Probes of the shipped chain (pdfjs 6.1.200 getTextContent →
 * textItemsToPlainText → joinPageTexts → extractedTextToMarkdown):
 *  - 2026-09-27, a two-page PDF drawn with pdf-lib: pdfjs emits ONE line break
 *    for a vertical move, however large, so the gap between paragraphs never
 *    becomes an empty line; title and both paragraphs came out as one Markdown
 *    paragraph. "• bullet one" joined the paragraph; "2023. Revenue grew" was
 *    split out as a list item; "exam-" + "ple" became "exam- ple".
 *  - 2026-09-27 (re-check), an HTML page with h1, two <p>, h2, <ul>, <ol> and a
 *    <br>-broken "exam-/ple", printed to PDF by headless Chrome: identical
 *    result. The h1, both paragraphs, the h2 and both <ul> items ran into ONE
 *    paragraph (Chrome draws the disc bullets as shapes, so no marker survived
 *    at all); "1. Numbered one" and "2. Numbered two" were split out; the text
 *    after the list started a new paragraph only because a list line flushed
 *    it; "exam- ple" again. Do not claim paragraphs are "kept" or "detected".
 * Encrypted files: useSinglePdf loads through pdf-lib's PDFDocument.load, which
 * throws EncryptedPDFError whenever the trailer has /Encrypt (owner-password-
 * only included); engine.ts loadPdf maps that to "This PDF is password-
 * protected. Unlock it first, then try again."
 * Unlock PDF requires a non-empty password (parseUnlockPdfOptions), so a file
 * that opens freely needs its OWNER password there.
 */
const content: ToolContent = {
  slug: "pdf-to-markdown",

  seoTitle: "PDF to Markdown: Convert PDF to MD in Your Browser",

  metaDescription:
    "Turn a PDF's selectable text into a Markdown .md file with a # title, ## Page headings and list lines kept apart. It runs in your browser, with no upload.",

  intro: [
    `PDF to Markdown writes the text layer of one PDF out as a .md file. The file name, minus its extension, becomes the # title, and in a multi-page PDF each page that yields text gets its own "## Page" heading with its original page number. Within a page, line breaks become spaces so that sentences wrapped across lines read as one again, while lines that already look like Markdown list items stay on lines of their own.`,
    `Paragraph breaks are the weak point. A new paragraph starts only where the extracted text holds an empty line or a list line; the white space you see between paragraphs on the page is not measured. In practice, a page often arrives as one long paragraph with its headings run into the sentences around them, ready for you to split where you want.`,
    `The Markdown is built on your own device, in this browser tab, and the PDF is not uploaded to pdf.xyz; each run takes a single file of at most ${MAX_MB} MB. Font size and weight are ignored, so nothing becomes a heading, bold or italic; table cells run together as plain text; images and the web addresses behind links are dropped. A page with no text layer, such as a scan, adds nothing, and a PDF where no page yields text gets a "No selectable text found" result instead of an empty file.`,
  ],

  useCases: [
    {
      title: "Moving a report into a notes app or wiki",
      body: "Get an exported report into a Markdown notes app, a wiki or a README without deleting every hard line break by hand; you will still add some paragraph breaks and headings yourself.",
    },
    {
      title: "Giving a document to a chat assistant",
      body: "Paste the Markdown into an AI chat so the assistant reads text rather than a file; in a multi-page PDF the ## Page headings let you point it at a page by number.",
    },
    {
      title: "Finding out whether a PDF has text at all",
      body: 'A "No selectable text found" result means no page gave up any stored text, so search and copy in a PDF viewer usually find nothing either; the file needs OCR before its words can be read.',
    },
  ],

  steps: [
    {
      title: "Pick the PDF",
      body: `Hand over a single PDF through the "Drop your PDF here, or browse" panel, either by dropping the file on it or by clicking it and choosing from your device. A file over ${MAX_MB} MB, an empty file, a file that is not a PDF or cannot be read as one, and a password-protected PDF are each refused with a message; otherwise the file's name, page count and size appear.`,
    },
    {
      title: "Press Create Markdown",
      body: 'There is nothing to set first. The button reads "Creating Markdown…" while every page\'s text is read and rearranged on your device.',
    },
    {
      title: "Read the result",
      body: 'Under the heading "Markdown created", a summary line gives the number of Markdown characters and the PDF\'s page count, with the Markdown itself below in a box you can scroll and select from.',
    },
    {
      title: "Download MD",
      body: `Download MD saves a UTF-8 .md file named after your PDF with "-markdown" added, so report.pdf becomes ${exampleOutput}. "Start over" brings back the empty drop box for the next document.`,
    },
  ],

  faqs: [
    {
      q: 'Why does it say "No selectable text found"?',
      a: `No page gave up a stored character other than white space, which is typical of a scan, a phone photo, or a file whose lettering was turned into drawn outlines. ${ocrName} can add a text layer: leave its Output on "${ocrSearchableLabel}" and select every language printed on the pages, then convert the PDF it returns here. ${ocrName} runs on pdf.xyz's secure worker, so unlike this tool it uploads your file.`,
    },
    {
      q: "Does it keep headings, tables, bold text and links?",
      a: "Only as words. The only headings in the output are the # title made from the file name and the ## Page headings. Heading levels, the table grid, bold and italic, link targets and images are all lost.",
    },
    {
      q: "Which bullet styles become Markdown lists?",
      a: 'A line stays separate when it opens with -, * or + and a space, or with digits followed by "." or ")" and a space. The rule reads characters, not layout, so bullets typed as • or ▪, or drawn as small shapes rather than stored as characters, merge into the paragraph, while a line such as "2023. Revenue grew" is split out as if it were numbered.',
    },
    {
      q: "Is the wording changed during conversion?",
      a: 'Words are not rewritten; they follow the order stored in the PDF, which on two-column pages is not always reading order. Runs of spaces shrink to one, and a word hyphenated at a line end comes out as "exam- ple". A line opening with one to six # signs and a space, or made of a lone -, * or _, gets a backslash so a Markdown viewer shows it as typed, but other asterisks, underscores and backticks pass through and may be formatted by a Markdown viewer.',
    },
    {
      q: `How is this different from ${textName}?`,
      a: `Both read the text with the same in-browser extraction. ${textName} writes a .txt file that keeps the PDF's line breaks and adds no markers; PDF to Markdown joins those lines into running text, splits out list lines and adds the title and page headings.`,
    },
    {
      q: "Will it open a PDF that has a password or copy restrictions?",
      a: `No. The file is refused as it opens, including a PDF your viewer opens without a password but that restricts printing or copying, because it is still encrypted. ${unlockName} can remove the encryption if you enter a password the file accepts (for a PDF that opens freely, that means its owner password), but that tool uploads the PDF to pdf.xyz's secure worker.`,
    },
  ],

  relatedGuides: [],
};

export default content;
