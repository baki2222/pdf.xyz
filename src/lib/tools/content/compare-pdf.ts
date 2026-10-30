import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";

/**
 * The compare runner's own input gate (`partitionPdfFiles` → MAX_PDF_BYTES),
 * read through the per-runner ceiling map and converted the way
 * `toolFileCeilingMb` converts it, so this page and the refusal message quote
 * one number.
 */
const CEILING_MB = Math.round(RUNNER_FILE_CEILINGS.compare / (1024 * 1024));

/** How long an OCR PDF result link lives on the worker (FAQ on scans). */
const OCR_LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;

/*
 * Behaviour claims below were checked against the code on 2026-09-27
 * (src/lib/pdf/compare-pdf.ts, src/lib/pdf/text.ts, src/lib/pdf/engine.ts,
 * compare-pdf-runner.tsx), and the diff rules by running `diffLines` directly:
 *   - "The fee is 10 USD." vs "The  fee is 12 USD." came back as one removed
 *     and one added line: whole-line granularity, doubled space ignored;
 *   - "   indented\tline" vs "indented line" came back as one unchanged line;
 *   - a blank line between pages vanished from the comparison entirely;
 *   - "alpha beta / gamma" vs "alpha / beta gamma" (same words, re-wrapped)
 *     came back as two removed and two added lines;
 *   - text in one file and none in the other: every line of the first came
 *     back as removed — from `diffLines`, the UNIT. The page runs
 *     `compareExtractedPdfText`, which diffs only when BOTH sides have text:
 *     one-sided text gives the left-no-text / right-no-text verdict, an empty
 *     diff, "Changed lines: not compared" and a report naming the file to OCR.
 *     The scan FAQ described the unit until 2026-10-07; tool-page-content's
 *     compare block now runs the composed function and holds the FAQ to it.
 * Text AND the page counts in the result come from pdf.js (`getTextContent`,
 * `numPages`; no OCR). The page count on each file card comes from pdf-lib,
 * whose `load` throws on ANY /Encrypt dictionary — so a permissions-only PDF
 * that opens without a password is refused too, with "This PDF is
 * password-protected".
 * The Size delta TILE prints `formatBytes(Math.abs(sizeDelta))` with a "+"
 * only when non-negative, so a smaller second file shows no sign there; only
 * the report's `Bytes:` line carries the signed difference. The copy below
 * points at that line and makes no claim about the tile's sign.
 */
const content: ToolContent = {
  slug: "compare-pdf",

  seoTitle: "Compare PDF Files — Text Diff in Your Browser",

  metaDescription:
    "Compare two PDFs line by line: see added and removed text, page count and size changes, and save a plain-text diff report. Both files stay in your browser.",

  intro: [
    `Compare PDF reads the selectable text of two versions of a document and writes one report of what changed. Lines only in the second file are marked with a plus, lines only in the first with a minus, and above that line-by-line diff the report lists both page counts, both sizes in bytes and the number of changed lines. When every line agrees, the result is headed Selectable text matches.`,
    `The comparison runs inside your browser tab, where pdf.js reads the text of both files, and neither PDF is uploaded. Whichever PDF you add first is the baseline, so add the older version first: the page and byte differences are counted from it to the second one. It compares exactly two files, and a file over ${CEILING_MB} MB is turned away before it is opened.`,
    `This is a text comparison, not a visual one: a moved image or a changed colour will not appear, and a new font or margin shows up only where it makes the text wrap differently. Changes are reported a whole line at a time; runs of spaces and tabs count as one space, and indentation, blank lines and page breaks are ignored. A scan with no text layer has nothing to compare until it has been through OCR.`,
  ],

  useCases: [
    {
      title: "Check what the other side edited in a contract",
      body: "When a revised agreement comes back with no tracked changes, compare it against the version you sent. Each altered line appears twice, once removed and once added; a clause that gained words may re-wrap, so later lines in that paragraph can show as changed too.",
    },
    {
      title: "Confirm a re-export kept the wording",
      body: "After regenerating a report from its source, compare old and new. A Selectable text matches heading means every line of selectable text agrees once spacing, indentation and blank lines are set aside. If the sizes still differ, something other than the wording changed, such as spacing, an image, an embedded font or an export setting, and this tool cannot say which.",
    },
    {
      title: "Spot a quietly changed figure",
      body: "A price, date or total that changed in the text layer flags the line it sits on. A number that is part of a picture, such as a chart pasted in as an image, is not text and will not be caught.",
    },
    {
      title: "See whether pages were added or dropped",
      body: "The Pages tile puts the two page counts side by side, first file → second, so an inserted appendix or a missing schedule shows up before you read a single line. It compares totals only: one page added and another removed leaves the counts equal.",
    },
  ],

  steps: [
    {
      title: "Add the two PDFs",
      body: 'Drop the files onto the box that reads "Drop two PDFs here, or", or click browse. The first file added fills the PDF 1 slot and becomes the baseline; if you pick both at once, check that the first card (on the left, or on top on a narrow screen) holds the original.',
    },
    {
      title: "Check the Files to compare list",
      body: "Each card shows the file name, page count and size, and the counter reads 2/2 selected. The X on a card removes that file; remove PDF 1 and the other file moves into its slot.",
    },
    {
      title: "Press Compare PDFs",
      body: "It stays disabled until both slots are filled. Tiles for Pages, Size delta and Changed lines sit above the full report, whose Bytes line gives both exact sizes and a signed difference.",
    },
    {
      title: "Download the report",
      body: "Download comparison report saves the whole report as a text file named after both PDFs, for example draft-vs-final-comparison.txt. Start over clears the result and both slots for a new pair, without leaving the page.",
    },
  ],

  faqs: [
    {
      q: "Does Compare PDF highlight changes on the pages themselves?",
      a: "No. The result is a text report, not marked-up pages: unchanged lines are indented two spaces, lines only in the second PDF start with +, and lines only in the first start with -. It does not name the page a change sits on, so search the PDF for that line's text.",
    },
    {
      q: "Why is a whole line flagged when only one word changed?",
      a: "The comparison works line by line: if any character on a line differs, the old line is listed as removed and the new one as added. The same happens when the wording is identical but the text wraps differently, for example after a font or margin change, because the lines no longer match.",
    },
    {
      q: "What if one of the two PDFs is a scan?",
      a: `This tool reads selectable text only. When one file is a scan with no text layer, it does not list the other file's text as changed: the result is headed with that file's name and "has no selectable text", Changed lines reads Not compared, and the report tells you to run OCR PDF on that file first. Two scans produce a report saying no selectable text was found in either PDF. OCR PDF can add a text layer, but unlike this tool it uploads the scan over TLS to pdf.xyz's secure server, which deletes it when the job finishes; the OCR'd copy's link expires after ${OCR_LINK_MINUTES} minutes and a daily storage rule erases the stored copy after that. Any OCR misreading will then show up here as a difference.`,
    },
    {
      q: "Are my PDFs uploaded to compare them?",
      a: `No. Both files are opened and compared by your browser on your own device. Each PDF can be at most ${CEILING_MB} MB; the size is checked before the file is read, and a larger file is listed under Some files were skipped with the reason.`,
    },
    {
      q: "What if a PDF has a password, or I add a third one?",
      a: "An encrypted PDF is refused as it is added, listed under Some files were skipped with a note to unlock it first. That includes a file that opens freely but restricts printing or editing, since those restrictions are stored as encryption. A third PDF is skipped too, because the tool takes exactly two; remove a loaded file first.",
    },
  ],

  relatedGuides: [],
};

export default content;
