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
 *    button (busy label jobBusyLabel(phase, "Exporting PPTX…"): "Uploading
 *    your file…", "Waiting for the worker…", "Exporting PPTX…", "Downloading
 *    the result…"; until 2026-10-07 the step said "Exporting PPTX…" covered
 *    the upload and the fetch-back), "Your PPTX file is ready." and a
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
 *    no `-upw`. A PDF that needs a password to open is refused by poppler,
 *    the runner throws PdfTextOpenError("needs-password"), and engine.ts
 *    classifyFailure returns `password_protected` ("This PDF is
 *    password-protected. Unlock it with Unlock PDF…", non-retryable); the
 *    panel links Unlock PDF by error code. Until 2026-10-07 this docblock and
 *    the FAQ said it failed as the generic `failed` kind and never mentioned
 *    a password;
 *  - src/lib/workers/processor/pdf-office-export.ts — exactly one input,
 *    output named after the upload's (sanitised, possibly truncated) stem
 *    with a .pptx extension;
 *  - PDF to Text (the recommended workaround) runs in the browser (runner
 *    "pdf-to-text", in-browser tier) and separates pages only by one blank
 *    line with no markers, so the copy does NOT promise page-by-page pasting
 *    from it.
 *
 * ── DOES IT OPEN IN POWERPOINT? What the copy may say, and why ──────────────
 *
 * HISTORY (kept). Measured 2026-09-27, not inferred, twice independently: the
 * engine's output of that day (runPdfOfficeExport + parseLayoutText, 3-page
 * and 1-page documents, then a 3-page document whose middle page is empty)
 * was opened through PowerPoint's COM `Presentations.Open` (PowerPoint 16.0,
 * Windows desktop) and refused with "The file or directory is corrupted and
 * unreadable" (0x80070570), while a deck PowerPoint saved itself reopened in
 * the same run. That pptx() wrote no slideMaster, slideLayout or theme parts,
 * no <p:sldSz>/<p:notesSz>, and empty nvSpPr/nvGrpSpPr. From then until
 * 2026-10-09 this page said PowerPoint refuses the file, in six places (the
 * meta description, intro[1], both of the first two use cases, step 4 and the
 * first FAQ answer), and that was true of every worker image production ran.
 *
 * WHAT CHANGED. 8920ee1b (reached main with #167) packs through
 * pptx-package.ts, which writes ppt/slideMasters/slideMaster1.xml,
 * ppt/slideLayouts/slideLayout1.xml, ppt/theme/theme1.xml and <p:sldSz>; since
 * a85ba73e the engine also runs pptx-inspect.ts over its own package and
 * refuses to deliver one that fails. On 2026-10-09 `pnpm prove:pptx-opens`
 * ran a real job through the worker's processor (a generated 3-page PDF, the
 * middle page blank; the extractor on that Windows host was Xpdf 4.00's
 * pdftotext, not the worker's poppler) and PowerPoint 16.0 build 20430 opened
 * the 14,253-byte result through COM with 3 slides and 1 master, and read
 * every page's text back. In the same run a deck PowerPoint saved reopened
 * and the pre-2026-09-27 package was refused (0x80070570). Measured on
 * 9f2a2efb by its author, reproduced on it by the reviewer, and run once more
 * on it before this copy was rewritten, with the same figures each time.
 *
 * WHY THE COPY SAYS NEITHER "refuses" NOR "opens". `publish.yml` deploys both
 * tiers from main on every push, so the six "refuses" sentences would turn
 * false with the first successful publish that carries 8920ee1b. "Opens"
 * would claim more than was measured: COM is not a double-click, and
 * scripts/prove-pptx-opens.ts records damaged files that "opened" through COM
 * with no alert, so it cannot see a silent repair or a repair prompt. The copy
 * states the COM measurement, dated, says the double-click has not been
 * checked, and names the apps nobody tried (PowerPoint for Mac and the web,
 * Google Slides, Keynote, LibreOffice Impress) rather than implying they work
 * or fail.
 *
 * WHICH IMAGE IT IS TRUE OF. The measurement is of the engine on main. An
 * image older than 8920ee1b still serves the package PowerPoint refused, and
 * merging is not shipping: production's last successful publish before this
 * rewrite was #165's, and #167's failed on 2026-10-09. The live answer is the
 * heartbeat's `pptxPresentationChain` (absent or false on an older image), and
 * a static string cannot read it, so the copy adjudicates nothing in either
 * direction. capability-hedges.test.ts holds every sentence about this
 * capability to "no deferral", with the six old sentences as its fixtures.
 *
 * EXIT CONDITION for an "opens in PowerPoint" claim — the PROPERTY, not the
 * mechanism: a file a user DOWNLOADS FROM PRODUCTION opens on a double-click
 * in PowerPoint for Windows with no repair prompt. That is the owner's check,
 * made in PowerPoint's own window. None of these licenses the claim: a slide
 * master in the package, the inspector passing, `pptxPresentationChain: true`
 * on the production heartbeat, a COM `Presentations.Open` succeeding on a real
 * job. Three of the four have already happened, and the fourth arrives with
 * the first successful publish that carries the probe, which is exactly why
 * none of them can be the exit. Until the owner has made that check, the copy
 * keeps to the dated measurement.
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
    "Export a PDF's selectable text to a .pptx: one slide per page, each holding that page's lines as plain paragraphs. Images, fonts and layout are not kept.",

  intro: [
    "PDF to PowerPoint reads the words you can select in a PDF and packs them into a .pptx file, page by page: the first page's text goes on slide one, the second page's on slide two, and so on. Each slide holds a single text box, with one paragraph for every line of text found on that page. Pictures, charts, logos, colours, fonts, sizes and the position of each block stay behind, and a sentence the PDF wrapped over two lines arrives as two paragraphs.",
    "What has been tested is narrow, so here it is in full. On 9 October 2026, a .pptx built by this tool's export code from a three-page test PDF was opened through the automation interface of PowerPoint for Windows, which found one slide per page and read every page's text back. Whether a downloaded file opens on a double-click without PowerPoint offering to repair it has not been checked, and PowerPoint for Mac and the web, Google Slides, Keynote and LibreOffice Impress have not been tried. If all you need is the words, PDF to Text copies them out in your browser, and nothing is uploaded.",
    `A PDF made only of scanned images holds pictures of lettering rather than characters, so the export stops and points you to OCR as the first step. The reading is done by poppler's pdftotext on a server, not inside your browser: your PDF (one per run, ${CEILING_MB} MB at most) is uploaded over TLS to pdf.xyz's secure worker, where your input is deleted as each job finishes. The worker keeps the .pptx available for ${OUTPUT_TTL} minutes; after that its link fails, and a daily storage rule erases the stored copy.`,
  ],

  useCases: [
    {
      title: "Recover a deck when only the PDF survived",
      body: "Each page's wording comes back on a slide of its own, in page order, as plain paragraphs in a single text box, so none of it has to be retyped. The look stays behind: rebuild the layout, pictures and styling yourself, with the PDF open beside you for reference.",
    },
    {
      title: "Turn a report into talking points",
      body: "Because one page becomes one slide, a report's page order becomes a talk's running order, and each slide starts out holding every line its page did. What remains is cutting those lines down to what you will actually say.",
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
      body: "The button follows the job: it reads Uploading your file… while your PDF goes over TLS to pdf.xyz's worker, Waiting for the worker… while the job is queued, Exporting PPTX… while the slides are assembled, and Downloading the result… while the finished file comes back to this tab. Once that job is over, the worker erases the PDF you sent it.",
    },
    {
      title: "Save the .pptx",
      body: `"Your PPTX file is ready." appears with a Download button labelled with the output's name: your PDF's name, ending in .pptx. The page has already pulled the file into the tab, so that button saves it from there; the worker's own copy becomes unreachable after ${OUTPUT_TTL} minutes.`,
    },
  ],

  faqs: [
    {
      q: "Will the .pptx open in PowerPoint?",
      a: "Only one route has been checked. On 9 October 2026, PowerPoint 16.0 for Windows opened a .pptx this tool made from a three-page test PDF through its automation interface, counted three slides and read each page's text back. That interface cannot show a repair prompt, and a download has not been opened with a double-click, so pdf.xyz does not promise that PowerPoint opens it without asking to repair it. No other presentation app has been tried.",
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
      a: "Not if the PDF asks for a password when you open it. The worker is given no password, so the job stops with a message saying the PDF is password-protected, and the page links you to Unlock PDF. If you know the password, remove it there (Unlock PDF cannot recover a password you lack), then convert the unlocked copy here.",
    },
    {
      q: "Is my PDF kept after the conversion?",
      a: `No. The worker reads its text, builds the .pptx and deletes the uploaded PDF once the job ends. The .pptx can be fetched from the worker for ${OUTPUT_TTL} minutes. Beyond that the link no longer works, and a daily storage rule erases whatever copy is still stored. No account is involved.`,
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
