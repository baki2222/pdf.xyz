import type { ToolContent } from "./types";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/**
 * The size the merge runner refuses above. `MergeRunner.addFiles` calls
 * `partitionPdfFiles(files)` with its default budget, which is MAX_PDF_BYTES
 * (and RUNNER_FILE_CEILINGS.merge is the same constant) — so this is the gate's
 * own number, not a copy of it.
 */
const maxMb = Math.round(MAX_PDF_BYTES / (1024 * 1024));

/**
 * Unlock PDF is a secure-worker tool, so the one FAQ that sends a reader there
 * states the worker's retention from the constant that governs it.
 */
const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;

/*
 * What a merge keeps and drops was checked against the real engine
 * (`mergePdfs` in src/lib/pdf/engine.ts) on 2026-09-27, not assumed: a source
 * with a title, author, one outline item, a text field and a URI link, plus a
 * rotated landscape page, merged with a second file. Output: page sizes and
 * the 90° rotation kept; the Link annotation and the field's Widget kept on
 * the page; no /Outlines, no /AcroForm (0 form fields), no title or author.
 * SUPERSEDED 2026-10-06 (kept as history): the page assembler (page-copy.ts, merge
 *    state) now publishes EVERY source's form in one /AcroForm, renaming a
 *    root field an earlier file already uses (`name_2`), and writes every
 *    source's bookmarks one file after another; title, author, page labels
 *    and /Lang are still not carried. Probed through mergePdfs on
 *    makeStructuredPdf(3) twice: 2 outline items, fields customer.name and
 *    customer_2.name, no title. tool-page-substance.test.ts holds the page;
 * A file whose trailer carries /Encrypt is refused by `getPageCount` with
 * "This PDF is password-protected. Unlock it first, then try again."
 *
 * Re-checked independently the same day by the review pass: a real
 * owner-password-only file (pypdf, RC4-128, empty user password, opens
 * without a prompt) was refused by `getPageCount` with that same message, and
 * an embedded image stream's bytes and /Filter were identical before and after
 * `mergePdfs` — the "not re-encoded" FAQ rests on that. The merged file was
 * SMALLER than its inputs (pdf-lib drops unreferenced objects and packs object
 * streams), so the copy must not say the file is left the same size.
 * Unlock PDF rejects an empty password (parseUnlockPdfOptions), so a
 * permissions-only file needs its owner password there. That qpdf's
 * `--decrypt` accepts the owner password is qpdf's documented behaviour; no
 * pdf.xyz test runs an owner-only file through runUnlock.
 *
 * Third pass, 2026-09-27, through the real `mergePdfs`/`getPageCount`: all of
 * the above reproduced (DCTDecode image stream: same length, same /Filter,
 * same content hash). It also found that Compress PDF's lossless pass
 * (`optimizeLossless` in src/lib/pdf/analyze.ts, a pdf-lib re-save with object
 * streams) gains nothing on a merge output — 2,512 bytes in, 2,516 out —
 * because `mergePdfs` already saves the same way. So the size FAQ must not
 * offer that pass as the remedy for a large merge; only the deep, uploading
 * step can shrink images. Removing a row drops that file's bytes from state
 * (`removeAt`), so memory is freed by remove as well as by "Start over".
 *
 * ADDED 2026-10-25 (merge-contents.ts; merge-contents-split-text.test.ts
 * reads the merged file back): "Add a contents page" puts pages in FRONT of
 * the merged pages, headed "Contents", one line per file — its name without
 * the extension, dot leaders, and the merged file's page number it starts
 * on (contents pages counted) — and each line is a Link whose /Dest is that
 * page. It follows the list order and each file's Pages selection; bookmarks
 * point at page objects, so they still open the right page. A long list runs
 * onto more contents pages. A name in another script is drawn in a
 * downloaded face (embedDrawingFont); one no shipped face can draw is
 * written with "?" for the characters it cannot draw.
 */
const content: ToolContent = {
  slug: "merge-pdf",

  seoTitle: "Merge PDF Files Online — Combine in Your Browser",

  metaDescription:
    "Combine two or more PDFs into one file in the order you choose. Drag rows or use the arrow buttons, then merge in your browser. Your files are not uploaded.",

  intro: [
    "Merge PDF joins documents end to end: the pages of the first file in your list, then the pages of the next, down to the bottom. By default every page of every file goes in; type a range such as 1-3, 5 in a file's Pages box to take only those pages, which keep their own order. Each row gives the file's page count and size next to a thumbnail of its first page (a plain file icon stands in if that page can't be drawn), and a running total of files and pages heads the list, so you know how long the result will be before you merge. It all happens online in your browser: the PDFs you add are read on your device, not uploaded to pdf.xyz.",
    "Pages are copied with their content, dimensions and rotation intact, so a landscape spreadsheet printout stays landscape next to portrait letters, and links to web addresses on a page still point where they did. Each file's bookmarks follow one another in the merged bookmarks panel (a bookmark to a page you left out is dropped), and ticking “Add a bookmark for each file” also writes one bookmark per file, named after it and opening its first page, with that file's own bookmarks beneath it. Form fields stay fillable with what was typed in them; when two files use the same field name, the later one is renamed so their answers stay separate. The title and author, page labels and language each describe one file, so none of them is copied into the merged PDF.",
    `Each file can be up to ${maxMb} MB, and the merge button stays disabled until at least two files are in the list. The tool sets no count limit of its own, but every file you add is held in your browser's memory until you remove its row, press “Start over” or leave the page, so the practical ceiling is your device's memory. If one file in a batch is password-protected, only that file is refused, by name, and the others remain in the list.`,
  ],

  useCases: [
    {
      title: "One attachment for an application portal",
      body: "Job and university portals often accept just one file. Stack the cover letter, CV, transcripts and certificates in the order a reviewer should read them and submit a single PDF.",
    },
    {
      title: "Scans that came out one page per file",
      body: "Phone scanner apps often save each capture as its own PDF. Add them all at once, confirm the order from the thumbnails, and get one multi-page document back.",
    },
    {
      title: "A year of statements for your accountant",
      body: "Monthly bank statements, invoices or payslips become one file in date order. The file count and page total above the list make a missing month easy to spot before you merge.",
    },
    {
      title: "A report with its appendices attached",
      body: "Put the main report first and the exhibits after it. An A4 memo, a letter-size form and a landscape chart each keep their own page size in the result.",
    },
  ],

  steps: [
    {
      title: "Add your PDFs",
      body: "Drop files onto the box, or click browse and select several at once. Each readable file becomes a row; any file that fails is listed under “couldn't be added” with the reason.",
    },
    {
      title: "Put them in order",
      body: "Drag a row, or press its up and down arrow buttons, which also work from the keyboard, or sort the whole list by Name A–Z, Name Z–A or As added. The top row supplies the opening pages; the X button removes a file.",
    },
    {
      title: "Pick pages and bookmarks (optional)",
      body: "Leave a file's Pages box empty to take all of it, or type pages such as 1-3, 5 to take only those. Tick “Add a bookmark for each file” for a bookmark per file in the result, and “Add a contents page” for a first page that lists every file with the page it starts on.",
    },
    {
      title: "Add anything you missed",
      body: "The “Add more PDFs” area under the list accepts extra files by drop or click, and each one lands at the bottom, ready to be moved.",
    },
    {
      title: "Merge and download",
      body: "Press the Merge button, whose label counts your files, then “Download merged PDF”. The download is named after whichever PDF is at the top, so march-report.pdf there gives march-report-merged.pdf, and “Start over” clears the list for a new batch.",
    },
  ],

  faqs: [
    {
      q: "Why was one of my PDFs refused?",
      a: "A warning box lists each file that couldn't be added and why: not a PDF, empty, over the size limit, unreadable, or password-protected. Encrypted files are refused even when they open without a password and only restrict editing or printing. Accepted files stay in the list while you fix the one that failed.",
    },
    {
      q: "How do I merge a PDF that has a password?",
      a: `Remove the protection, then add the unlocked copy. Unlock PDF strips it when you supply a password it accepts: the one that opens the file or, for a PDF that opens without one yet blocks printing or editing, the owner password; an empty password field is not accepted. Unlike Merge, Unlock does not run in your browser. Unlock PDF uploads the locked PDF over TLS to pdf.xyz's secure server, which deletes that input when the job finishes; the link to the unlocked copy expires after ${linkMinutes} minutes, and a daily storage rule then erases our server's stored copy. If your own PDF app can save an unprotected copy, that keeps the file on your device.`,
    },
    {
      q: "Can I merge only some pages of a file, or reorder single pages?",
      a: "Yes to the first: type the pages you want in that file's Pages box, such as 1-3, 5 or 10-, and only those are merged; an empty box takes every page, and the page total above the list counts your selection. The chosen pages keep the file's own order, so typing 5, 1 still gives page 1 before page 5. To rearrange, rotate, duplicate or delete individual pages after merging, open the combined file in Organize Pages.",
    },
    {
      q: "Can the merged PDF start with a table of contents?",
      a: "Yes: tick “Add a contents page”. The merged PDF then opens with a page headed Contents that lists each file by name, without its .pdf ending, with the page it starts on, and clicking a line jumps to that page. The page numbers count the contents page itself, so they match what your PDF reader shows, and they follow the order of the list and the pages you picked for each file. A long list continues onto more contents pages. Bookmarks still open the right pages.",
    },
    {
      q: "Will merging change the quality or size of my pages?",
      a: "Text, fonts and images are copied as they are, not re-encoded, so nothing gets blurrier. Images are not downsampled either, so a merge of large scans stays large. If the result is too big to email, Compress PDF's in-browser lossless pass will find almost nothing left to remove, since the merge already packs the file the same way. The step that can shrink scans is Compress PDF's optional deep image compression, which uploads the merged file to pdf.xyz's secure server.",
    },
  ],

  relatedGuides: ["how-to-merge-pdf-files", "how-to-split-a-pdf"],
};

export default content;
