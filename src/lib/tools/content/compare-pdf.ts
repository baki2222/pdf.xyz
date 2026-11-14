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
 * HISTORY, kept: the list just below is what was checked on 2026-09-27,
 * when the comparison listed every line a whole line at a time. AMENDED
 * 2026-11-14 (audit compare-pdf#4) under it.
 *
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
 * `numPages`; no OCR). The page count on each file card came from pdf-lib,
 * whose `load` throws on ANY /Encrypt dictionary — so a permissions-only PDF
 * that opens without a password was refused too, with "This PDF is
 * password-protected". AMENDED 2026-11-08 (audit compare-pdf#5): the card's
 * count is pdf.js's (`countPagesWithPdfjs`) now, so such a file is compared; one that
 * needs a password is still refused (compare-restricted.test.tsx).
 * AMENDED 2026-11-14 (audit compare-pdf#4): the result lists only the
 * changes, each hunk headed with its page in both files ("Page 2 → page 3";
 * `@@ Page 2 -> page 3 @@` in the .txt) with two lines of context, and the
 * differing words inside a changed line are marked (`<del>`/`<ins>`, and a
 * `~ ` line in the report); a line too long for the word bounds is marked
 * whole and counted. Two options, both off by default, set aside letter
 * case and page headers and numbers. Checked by running the composed
 * `compareExtractedPdfText` on real PDFs (runner/compare/engine.test.ts,
 * report.test.ts) and the page's claims against it
 * (claims-vs-capability.test.ts, "Compare PDF names the page").
 * (A note on the Size delta tile stood here until 2026-11-14, saying it
 * printed no minus sign. It was false since the tile moved to
 * `formatSignedBytes`, and is deleted rather than rewritten because a test
 * pins the behaviour: compare-pdf-runner.test.tsx, "Compare PDF runner —
 * size delta", and utils.test.ts, "formatSignedBytes".)
 */
const content: ToolContent = {
  slug: "compare-pdf",

  seoTitle: "Compare PDF Files — Text Diff in Your Browser",

  metaDescription:
    "Compare two PDFs line by line: see added and removed text, page count and size changes, and save a plain-text diff report. Both files stay in your browser.",

  intro: [
    `Compare PDF reads the selectable text of two versions of a document and lists only what changed, grouped by page: each change is headed with the page it sits on in both files and shown with two unchanged lines around it. Lines only in the second file are marked with a plus, lines only in the first with a minus, and above the changes the report gives both page counts, both sizes in bytes and the number of changed lines. When every line agrees, the result is headed Selectable text matches.`,
    `The comparison runs inside your browser tab, where pdf.js reads the text of both files, and neither PDF is uploaded. Whichever PDF you add first is the baseline, so add the older version first: the page and byte differences are counted from it to the second one. It compares exactly two files, and a file over ${CEILING_MB} MB is turned away before it is opened.`,
    `This is a text comparison, not a visual one: a moved image or a changed colour will not appear, and a new font or margin shows up only where it makes the text wrap differently. Each change names its page in both files, and inside a changed line the words that differ are marked. Runs of spaces and tabs count as one space, indentation and blank lines are ignored, and a line that only moved to another page is not a change. A scan with no text layer has nothing to compare until it has been through OCR.`,
  ],

  useCases: [
    {
      title: "Check what the other side edited in a contract",
      body: "When a revised agreement comes back with no tracked changes, compare it against the version you sent. Each altered line appears twice, once removed and once added, with the words that differ marked; a clause that gained words may re-wrap, so later lines in that paragraph can show as changed too.",
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
      body: 'Drop the files onto the box that reads "Drop two PDFs here, or", or click browse. The first file added fills the PDF 1 slot and becomes the baseline; if you pick both at once, check that the first card (on the left, or on top on a narrow screen) holds the original. If it does not, press Swap PDF 1 and PDF 2. Compare PDF takes exactly two files: one added while both slots are taken or loading is listed as skipped, never swapped in.',
    },
    {
      title: "Check the Files to compare list",
      body: "Each card shows the file name, page count and size, and the counter reads 2/2 selected. The X on a card removes that file; remove PDF 1 and the other file moves into its slot.",
    },
    {
      title: "Press Compare PDFs",
      body: "It stays disabled until both slots are filled. Tiles for Pages, Size delta and Changed lines sit above the list of changes, each headed with its page in both files. Two buttons step from one change to the next, and two boxes set letter case or page headers and numbers aside.",
    },
    {
      title: "Download the report",
      body: "Download comparison report saves a text file listing only the changes, with their page numbers, named after both PDFs, for example draft-vs-final-comparison.txt. Its Bytes line gives both exact sizes and a signed difference. Start over clears the result and both slots for a new pair, without leaving the page.",
    },
  ],

  faqs: [
    {
      q: "Does Compare PDF show which page a change is on?",
      a: "Yes. Each change is headed with the page it sits on in each file, for example Page 2 → page 3 when a page was inserted before it, and the downloaded report heads it the same way: @@ Page 2 -> page 3 @@. Unchanged lines around a change are indented two spaces, lines only in the second PDF start with +, and lines only in the first start with -. It does not draw highlights on the pages themselves yet: the result is a list of changed lines, not marked-up pages.",
    },
    {
      q: "What happens when only one word on a line changed?",
      a: "The old line is listed as removed and the new one as added, and the changed words are marked within the line: crossed out in the old one, underlined in the new one, and in the report as [-old-] and {+new+} on a line starting with ~. A very long line is marked whole, and the report says how many were. When the wording is identical but the text wraps differently, for example after a font or margin change, the lines no longer match and are listed too.",
    },
    {
      q: "What do Ignore case and Ignore page headers and numbers do?",
      a: "Both are off unless you tick them, and either can be changed after a comparison without reading the files again. Ignore case compares Total and TOTAL as the same line. Ignore page headers and numbers leaves page numbers such as Page 3 of 40, and lines repeated at the top or bottom of most pages such as a company name, out of both files. Either can turn Differences found into Selectable text matches; the result then says what it ignored, and so does the report.",
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
      a: "A PDF that needs a password to open is refused as it is added, listed under Some files were skipped with a note to unlock it first. A PDF that opens without a password but whose author restricted it is compared like any other, because Compare PDF only reads the text and writes nothing back to either file. A third PDF is skipped too, because the tool takes exactly two; remove a loaded file first.",
    },
  ],

  relatedGuides: [],
};

export default content;
