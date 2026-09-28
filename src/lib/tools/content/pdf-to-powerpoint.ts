import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/pdf-office-export-worker-panel.tsx — the run area
 *    only mounts while the status badge reads "Secure worker" (otherwise it
 *    reads "Not enabled" or "Status unknown" and no drop zone is shown); the
 *    drop zone titled "Add your PDF, or" + runner-kit's "browse" (the whole
 *    box is a <label>, so clicking anywhere opens the picker), single-file
 *    only with a "Remove" button once a file is chosen, the "Export PPTX"
 *    button ("Exporting PPTX…" while busy), "Your PPTX file is ready." and a
 *    button labelled "Download <output filename>". pdf-security-client.ts
 *    step 5 has ALREADY fetched the .pptx bytes before that button appears,
 *    and the button saves them from tab memory, so it keeps working past the
 *    worker link's TTL until the tab is closed. The copy therefore puts the
 *    TTL on the worker's copy, never on the button;
 *  - src/lib/workers/pdf-office-export/engine.ts — pptx(): one slide per
 *    extracted page, one text shape per slide, one paragraph per non-empty
 *    trimmed line; nothing else (no images, fonts, colours or positions) is
 *    written; a PDF with no text in ANY page is refused as `no_text`. That
 *    refusal's wording is PARAPHRASED below, not quoted: the message is an
 *    inline literal nothing here can import, so a verbatim quote would go
 *    stale silently the day it is reworded;
 *  - src/lib/workers/pdf-text/native.ts + parse.ts — `pdftotext -layout` with
 *    padding "keep" (side-by-side columns stay on one line, separated by
 *    spaces), pages split on form feeds with only the trailing empty chunk
 *    dropped, so a page with no text still yields an (empty) slide; run with
 *    no `-upw`, so a PDF that needs a password to open fails as the generic
 *    `failed` kind ("could not be exported"), which never mentions a password;
 *  - src/lib/workers/processor/pdf-office-export.ts — exactly one input,
 *    output named after the upload's (sanitised, possibly truncated) stem
 *    with a .pptx extension;
 *  - PDF to Text (the recommended workaround) runs in the browser (runner
 *    "pdf-to-text", in-browser tier) and separates pages only by one blank
 *    line with no markers, so the copy does NOT promise page-by-page pasting
 *    from it.
 *
 * ⚠️ THE FILE DOES NOT OPEN IN MICROSOFT POWERPOINT, and the copy says so.
 * Measured 2026-09-27, not inferred, twice independently: the real engine's
 * output (runPdfOfficeExport + parseLayoutText, 3-page and 1-page documents,
 * then again with a 3-page document whose middle page is empty) was opened
 * through PowerPoint's COM `Presentations.Open` (PowerPoint 16.0, Windows
 * desktop) and refused with "The file or directory is corrupted and
 * unreadable" (0x80070570). Positive control in the same run: a deck created
 * and saved by PowerPoint itself reopened with its slide count. pptx() writes
 * no slideMaster, slideLayout or theme parts (scripts/worker-prove-tools.ts
 * itself notes "PresentationML needs the whole master/layout/theme chain to
 * open"), no <p:sldSz>/<p:notesSz>, and empty nvSpPr/nvGrpSpPr. WHICH of
 * those PowerPoint objects to was not isolated, so the copy lists the missing
 * parts without claiming any one of them is THE cause. pptx() is unchanged
 * since 2026-07-15 apart from renames, so no worker image built since then
 * differs; a production job's download was not opened.
 *
 * EXIT CONDITION for the "PowerPoint rejects it" sentences — the PROPERTY, not
 * the mechanism: remove them when a file PRODUCED BY THE ENGINE opens in
 * Microsoft PowerPoint. Adding a slideMaster part is the mechanism and does not
 * by itself license the removal; open a real job's output in real PowerPoint.
 * Only the Windows desktop app was tested; PowerPoint for Mac and the web,
 * Google Slides, Keynote and LibreOffice Impress were not, and the copy says
 * that rather than implying they work or fail.
 *
 * The upload ceiling below is WORKER_FILE_CEILING (JOB_LIMITS.maxFileBytes).
 * The extractor has its own env-configurable cap
 * (PDFXYZ_PDF_TEXT_MAX_INPUT_BYTES), which defaults to the same figure but is
 * a second number; if the worker's env lowers it, the stated ceiling overstates.
 * Every number is interpolated from the constant that owns it.
 */

/** The per-file cap a worker-tier upload is refused above, in whole MB. */
const CEILING_MB = Math.round(WORKER_FILE_CEILING / (1024 * 1024));
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;

const content: ToolContent = {
  slug: "pdf-to-powerpoint",

  seoTitle: "PDF to PowerPoint (PPTX): Text Export by Page",

  metaDescription:
    "Export a PDF's selectable text to .pptx, one slide per page. PowerPoint for Windows currently rejects the file as corrupted; read why before you convert.",

  intro: [
    "PDF to PowerPoint reads the words you can select in a PDF and packs them into a .pptx file, page by page: the first page's text goes on slide one, the second page's on slide two, and so on. Each slide holds a single text box, with one paragraph for every line of text found on that page. Pictures, charts, logos, colours, fonts, sizes and the position of each block stay behind, and a sentence the PDF wrapped over two lines arrives as two paragraphs.",
    "Read this before relying on it: the Windows desktop version of Microsoft PowerPoint refuses to open the file this tool currently writes, reporting it as corrupted and unreadable. The package holds the slides and their text but none of the slide master, slide layout and theme parts that a presentation normally contains. PowerPoint for Mac and the web, Google Slides, Keynote and LibreOffice Impress have not been tested, so pdf.xyz cannot tell you whether they accept it. Until that is fixed, PDF to Text is the working route to a PDF's words; it runs in your browser, and nothing is uploaded.",
    `A PDF made only of scanned images holds pictures of lettering rather than characters, so the export stops and points you to OCR as the first step. The reading is done by poppler's pdftotext on a server, not inside your browser: your PDF (one per run, ${CEILING_MB} MB at most) is uploaded over TLS to pdf.xyz's secure worker, where your input is deleted as each job finishes. The worker keeps the .pptx available for ${OUTPUT_TTL} minutes; after that its link fails, and a daily storage rule erases the stored copy.`,
  ],

  useCases: [
    {
      title: "Recover a deck when only the PDF survived",
      body: "The export is built to put each page's wording back on a slide of its own. While PowerPoint refuses that file, take the text from PDF to Text instead and paste it into your template; pages there are divided only by a blank line, so keep the PDF open to see where each one ends.",
    },
    {
      title: "Turn a report into talking points",
      body: "Because one page becomes one slide, a report's page order becomes a talk's running order. Until the .pptx opens, copy the report's words out with PDF to Text and trim them down to what you will actually say.",
    },
    {
      title: "Bring a scanned handout's words out",
      body: "Paper that was scanned has no text for any exporter to read. OCR PDF adds a text layer first; the OCR'd copy then has words that this export, or PDF to Text, can pick up.",
    },
  ],

  steps: [
    {
      title: "Check that the PDF has selectable text",
      body: "Try highlighting a sentence in any PDF viewer. If nothing highlights, the pages are most likely images: run OCR PDF on the file first.",
    },
    {
      title: "Add your PDF",
      body: `The upload box appears only while the panel's status badge reads Secure worker; if it says Not enabled or Status unknown, there is nowhere to add a file yet. Drop one PDF on the box headed "Add your PDF, or browse"; clicking inside the dashed outline brings up the file chooser as well. Anything over ${CEILING_MB} MB is turned away at upload. If you picked the wrong file, press Remove beside its name and the box comes back for another.`,
    },
    {
      title: "Press Export PPTX",
      body: "While the button reads Exporting PPTX…, the page sends your PDF over TLS to pdf.xyz's worker, waits while the slides are assembled, and fetches the finished file back. Once that job is over, the worker erases the PDF you sent it.",
    },
    {
      title: "Save the .pptx",
      body: `"Your PPTX file is ready." appears with a Download button labelled with the output's name: your PDF's name, ending in .pptx. The page has already pulled the file into the tab, so that button saves it from there; the worker's own copy becomes unreachable after ${OUTPUT_TTL} minutes. Remember that PowerPoint will not open it yet.`,
    },
  ],

  faqs: [
    {
      q: "Will the .pptx open in PowerPoint?",
      a: "Not at the moment. Opened in PowerPoint's Windows desktop app, it is refused as corrupted and unreadable; the file lacks the slide master, layouts and theme a presentation normally carries. No other presentation app has been checked. Meanwhile, copy the words out with PDF to Text and paste them onto your slides.",
    },
    {
      q: "Will the design, images and fonts of my PDF be kept?",
      a: "No. Each slide contains the page's text as plain, unstyled paragraphs in one text box, and nothing else: images, charts, colours, fonts and layout are dropped. To keep the look instead, PDF to JPG renders each page as an image in your browser that you can place on a slide, though its text will not be editable.",
    },
    {
      q: "Why was my PDF refused for having no selectable text?",
      a: "It appears when no page carries real text: scans, phone photos saved as PDF, lettering converted to outlines. Run OCR PDF, then convert the result. If only some pages are images, the export goes ahead and those pages, like blank ones, become empty slides.",
    },
    {
      q: "Why is my text broken into short lines, or two columns run together?",
      a: "Every PDF line becomes its own paragraph, so a wrapped sentence splits where the page wrapped it. Side-by-side columns are read across the page and share one line, separated by spaces; tables arrive as rows of text with gaps.",
    },
    {
      q: "Can I convert a password-protected PDF?",
      a: "Not if the PDF asks for a password when you open it: the worker is given no password, so no text can be read and the run fails with a generic could-not-export message; nothing in it points to the password as the reason. If you know it, strip it with Unlock PDF, which cannot recover a password you lack, and convert the unlocked copy here.",
    },
    {
      q: "Is my PDF kept after the conversion?",
      a: `No. The worker reads its text, builds the .pptx and deletes the uploaded PDF once the job ends. The .pptx can be fetched from the worker for ${OUTPUT_TTL} minutes. Beyond that the link no longer works, and a daily storage rule erases whatever copy is still stored. No account is involved.`,
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
