import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { DEFAULT_OCR_OUTPUT_MODE, OCR_OUTPUT_MODES } from "@/lib/jobs/ocr";
import {
  HEADING_MAX_CHARS,
  HEADING_SIZE_RATIO,
  markdownOutputName,
  PARAGRAPH_GAP_RATIO,
} from "@/lib/pdf/pdf-to-markdown";

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

/** "20%": how much larger than the body a line must be to become a heading. */
const HEADING_PERCENT = Math.round((HEADING_SIZE_RATIO - 1) * 100);

/*
 * Behaviour claims below were checked against src/lib/pdf/pdf-to-markdown.ts,
 * src/lib/pdf/text.ts, src/components/tools/runner/pdf-to-markdown-runner.tsx,
 * single-pdf-runner.tsx / use-single-pdf.ts and runner-kit.tsx (Dropzone
 * "Drop your PDF here, or" + "browse", ResultPanel "Start over").
 *
 * Probes of the shipped chain as it was on 2026-09-27 (pdfjs 6.1.200
 * getTextContent → textItemsToPlainText → joinPageTexts →
 * extractedTextToMarkdown; since then the runner calls extractPdfLines, and
 * the converter builds each page from its lines' geometry):
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
 *    SUPERSEDED (2026-10-06): both probes ran the text-only chain. Since
 *    ed6a206c / e59b2f01 the runner hands the converter each line's geometry,
 *    and blocksFromGeometry splits a paragraph on a step over
 *    PARAGRAPH_GAP_RATIO x the line pitch, on a first-line indent, and on a
 *    jump back up the page; isHeadingLine promotes a short line at least
 *    HEADING_SIZE_RATIO x the body size; listItem keeps the BULLET_GLYPHS.
 *    The page said the opposite of all three until then, and
 *    pdf-to-markdown-copy.test.ts now holds what it serves to the converter.
 * Re-checked 2026-10-06 for the "Is the wording changed" answer, through
 * extractPdfLines → extractedTextToMarkdown on a pdf-lib page: "exam-" +
 * "ple" → "example" and "Jean-" + "Paul" → "Jean-Paul" (joinWrappedLines
 * now repairs line-end hyphens, so the "exam- ple" probes above are
 * history); "# not a heading", "---", "> quoted" and "| pipe" each opened
 * with a backslash; "<div> & &lt; R&D" → "&lt;div> & &amp;lt; R&D". Reading
 * order: the extracted lines are in the order text.ts gives PDF to Text
 * (text-reading-order.test.ts runs every fixture through this converter).
 * Encrypted files (AMENDED 2026-10-06): the runner reads with reader="pdfjs"
 * (single-pdf-reader.test.ts), and pdf.js opens a file that only carries an
 * owner password, so it converts like any other. Only a file that needs a
 * password to open is refused, with PDF_NEEDS_PASSWORD_MESSAGE. Until then
 * this said pdf-lib refused every /Encrypt; encryption-claims.test.ts now
 * holds the page to the runner's reader.
 */
const content: ToolContent = {
  slug: "pdf-to-markdown",

  seoTitle: "PDF to Markdown: Convert PDF to MD in Your Browser",

  metaDescription:
    "Turn a PDF's selectable text into a Markdown .md file with a # title, ## Page headings and list lines kept apart. It runs in your browser, with no upload.",

  intro: [
    `PDF to Markdown writes the text layer of one PDF out as a .md file. The file name, minus its extension, becomes the # title, and in a multi-page PDF each page that yields text gets its own "## Page" heading with its original page number. Within a page, lines that wrap are joined back into sentences, a word hyphenated at a line end is rejoined, and list lines, whether they start with -, *, +, a number or a bullet character such as •, stay on lines of their own as Markdown list items.`,
    `Paragraph breaks are worked out from where the lines sit on the page: a new paragraph starts where the gap between two lines is more than ${PARAGRAPH_GAP_RATIO} times the spacing between the wrapped lines of a paragraph, where a line is indented like the first line of a paragraph, or where the text moves back up the page to a new column without a sentence running on across it. A page with no wrapped line gives no spacing to measure and can arrive as one paragraph, and a page that mixes line spacings may split more often than it should, so check the breaks before you publish.`,
    `The Markdown is built on your own device, in this browser tab, and the PDF is not uploaded to pdf.xyz; each run takes a single file of at most ${MAX_MB} MB. A short line set at least ${HEADING_PERCENT}% larger than the body text becomes a Markdown heading, larger sizes ranking higher. Font weight and style are not read, so nothing becomes bold or italic; table cells run together as plain text; images and the web addresses behind links are dropped. A page with no text layer, such as a scan, adds nothing, and a PDF where no page yields text gets a "No selectable text found" result instead of an empty file.`,
  ],

  useCases: [
    {
      title: "Moving a report into a notes app or wiki",
      body: "Get an exported report into a Markdown notes app, a wiki or a README without deleting every hard line break by hand; check the paragraph breaks and headings it found before you publish.",
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
      body: `Hand over a single PDF through the "Drop your PDF here, or browse" panel, either by dropping the file on it or by clicking it and choosing from your device. A file over ${MAX_MB} MB, an empty file, a file that is not a PDF or cannot be read as one, and a PDF that needs a password to open are each refused with a message; otherwise the file's name, page count and size appear.`,
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
      a: `No page gave up a stored character other than white space, which is typical of a scan, a phone photo, or a file whose lettering was turned into drawn outlines. ${ocrName} can add a text layer: leave its Output on "${ocrSearchableLabel}" and select every language printed on the pages, then convert the PDF it returns here. ${ocrName} runs on pdf.xyz's secure server, so unlike this tool it uploads your file.`,
    },
    {
      q: "Does it keep headings, tables, bold text and links?",
      a: `Headings, partly. Besides the # title made from the file name and, in a multi-page PDF, the ## Page headings, short lines set at least ${HEADING_PERCENT}% larger than the body text become Markdown headings, the larger sizes ranked higher. A heading set less than ${HEADING_PERCENT}% larger, longer than ${HEADING_MAX_CHARS} characters, or ending in a full stop, comma or semicolon stays ordinary text. The table grid, bold and italic, link targets and images are lost; table cells come through as words.`,
    },
    {
      q: "Which bullet styles become Markdown lists?",
      a: 'A line becomes a list item when it opens with -, * or + and a space, with digits followed by "." or ")" and a space, or with a bullet character such as •, ▪, ● or ◦, including the Symbol and Wingdings bullets some PDFs store in place of •. Every unordered marker becomes "- " and numbers are kept. The rule reads characters, not layout. Bullets drawn as small shapes rather than stored as characters leave nothing to read, so those lines can run into the paragraph, while a line such as "2023. Revenue grew" is split out as if it were numbered.',
    },
    {
      q: "Is the wording changed during conversion?",
      a: 'Words are not rewritten, and they come out in reading order where the order the PDF stores them in is out of step with the page: a title or heading stored after the text under it, a running header stored last, and a footer or page number stored first are each moved to where they read, while a page stored a column at a time comes out a column at a time. Runs of spaces shrink to one. A word hyphenated at a line end is rejoined, so "exam-" and "ple" become "example"; a compound broken at its own hyphen, like "well-" and "known", loses the hyphen too, while one followed by a capital or a digit keeps it, as in "Jean-Paul". A paragraph that would otherwise read as Markdown syntax (one to six # signs and a space, a rule such as --- or ***, a code fence, a > quote or a | table row) gets a backslash so a Markdown viewer shows it as typed, and a < or & that would open an HTML tag or entity is escaped; other asterisks, underscores and backticks pass through and may be formatted by a Markdown viewer.',
    },
    {
      q: `How is this different from ${textName}?`,
      a: `Both read the text with the same in-browser extraction. ${textName} writes a .txt file that keeps the PDF's line breaks and adds no markers; PDF to Markdown joins those lines into paragraphs, turns larger type into headings, splits out list lines and adds the title and page headings.`,
    },
    {
      q: "Will it open a PDF that has a password or copy restrictions?",
      a: `Copy or printing restrictions are no obstacle: a PDF that opens without a password is converted like any other file. One that needs a password to open is refused as it opens, with a message saying it is password-protected; ${unlockName} can remove that password if you enter it, but that tool uploads the PDF to pdf.xyz's secure server.`,
    },
  ],

  relatedGuides: [],
};

export default content;
