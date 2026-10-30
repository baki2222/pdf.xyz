import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeiling } from "@/lib/tools/file-ceilings";
import { formatBytes } from "@/lib/utils";
import {
  HTML_LAYOUT_STEP,
  htmlLayoutAnswer,
} from "@/lib/tools/html-layout-copy";

/**
 * Every claim below was read off the implementation, not the marketing:
 *  - controls and labels: src/components/tools/html-render-worker-panel.tsx
 *    (Dropzone title "Add an HTML file, or" + its "browse" link, accept
 *    .html/.htm, one file, "Remove", "Render PDF", disabled until a file is
 *    chosen, whose busy label is jobBusyLabel(job.phase, "Rendering PDF…")
 *    (worker-job.tsx): "Uploading your file…", "Waiting for the worker…",
 *    "Rendering PDF…" while the job runs, "Downloading the result…"; a
 *    Cancel button under it while busy (WorkerJobStatus). Until 2026-10-07
 *    the step said the button read "Rendering PDF…" for the whole round
 *    trip, which was the panel before useWorkerJob; "Your PDF is ready.", "Download <name>",
 *    ErrorNote showing the run's message, a "Limit" spec row reading
 *    formatBytes(ceiling)/file); since 2026-10-25 a Page layout group (page
 *    size, orientation, margins, screen width, one long page), described
 *    from src/lib/tools/html-layout-copy.ts — until then no layout option existed;
 *  - the render (re-read 2026-10-08): src/lib/workers/html-render/native.ts
 *    drives headless Chromium over a CDP pipe. The upload is never read from
 *    disk by Chromium: it is served as the document at HTML_DOCUMENT_URL
 *    (src/lib/workers/html-render/document-url.ts, an https address on the
 *    reserved .invalid domain) and nothing else is ever served from there, so
 *    relative and root-relative references (style.css, /img/logo.png)
 *    resolve to an address nothing answers, and file: URLs cannot load at
 *    all. Every other request goes through network.ts, which fetches public
 *    http(s) addresses only. Scripts run inside VIRTUAL_TIME_BUDGET_MS of
 *    virtual time, then Page.printToPDF prints with PRINT_TO_PDF_OPTIONS (no
 *    header or footer, backgrounds printed, the CSS @page size preferred).
 *    Until 2026-10-08 this bullet described the file:// CLI render
 *    (--print-to-pdf under --virtual-time-budget, chromiumPdfArgs) that the
 *    CDP renderer replaced in 2026-09;
 *  - refusals: engine.ts / processor/html-render.ts — exactly one input; an
 *    input-size check before Chromium starts (non-retryable), separate from
 *    the upload ceiling — and since wave1 the panel refuses a file over the
 *    stated ceiling when it is picked, before any upload (pickRefusal);
 *    "Chromium could not render this HTML file." for a crash, timeout or bad
 *    output, which is `retryable: true`, so executor/executor.ts requeues it
 *    while attempts remain before the job fails;
 *  - what the VISITOR sees of a slow render: runSecurityJob polls for
 *    DEFAULT_MAX_POLL_ATTEMPTS x DEFAULT_POLL_INTERVAL_MS (~2 min, neither
 *    exported) and then returns {stillRunning, jobId}. This bullet said the
 *    page then showed "Stopped waiting for the worker — the job may still
 *    finish." with the job id, and the FAQ repeated it; since the panel moved
 *    onto useWorkerJob, WorkerJobStatus shows "The worker is still on this
 *    job" with Keep waiting (polls the SAME job, no new upload) and Cancel
 *    the job, keeps the id as data (sessionStorage, so a reload offers Keep
 *    waiting) and never prints it. Chromium's own kill timeout defaults to
 *    the same ~2 min (native-config timeoutMs), so a TIMED-OUT render never
 *    reaches the visitor as the Chromium message; the copy says so instead
 *    of promising that message for timeouts (it did, until this review);
 *  - output name: htmlPdfOutputName strips the last extension and adds .pdf
 *    (not imported: that module pulls pdf-lib in through compression/engine);
 *  - where the file goes: processing "server"; retention from
 *    DEFAULT_RETENTION and the wording of src/app/privacy/page.tsx.
 *
 * Print header and footer: NONE since 2026-09. The renderer now drives
 * Chromium over CDP and prints with `PRINT_TO_PDF_OPTIONS` (native.ts:
 * displayHeaderFooter false), and worker-tool-answers.test.ts holds this
 * page to it. The 2026-09-27 observations below were made on the CLI argv
 * that call replaced; their header/footer findings are history, kept as
 * the record of what this page used to say.
 *
 * Print behaviour (header/footer lines, US Letter default, CSS @page size
 * honoured, `@page { margin: 0 }` leaving no room for the header/footer,
 * @media print applied, a script timer inside the budget firing and one past
 * it not) was observed on 2026-09-27 by running Chrome 154 locally with the
 * exact chromiumPdfArgs flags on scratch files, NOT by a production job. The
 * worker's Chromium build may differ; re-check with a real job.
 * Re-probed by the reviewer the same day, same flags, read with pdftotext
 * -bbox: default 612x792 (letter) with date/time + <title> at the top and
 * the file:// URL + "1/1" at the bottom; `@page { margin: 15mm }` moved the
 * body from x=27.75 to x=42.75 pt (15 mm = 42.5 pt) with the header/footer
 * still printed; `@page { margin: 0 }` left only the body text;
 * `@page { size: A4 landscape }` gave 841.92x594.96; with margin 0 and
 * `body { padding: 20mm }` over two pages, page 1's first line sat at
 * x=56.7/y=68.8 and page 2's at x=56.7/y=-0.2 (side padding repeats, top
 * padding does not) — the basis of the margin-0 trade-off sentence.
 *
 * Deliberately NOT claimed: which scripts and fonts render. Remote
 * (absolute-URL) assets DO load since the CDP renderer (network.ts fetches
 * public addresses, and the panel's pre-upload scan in unbundled-assets.ts
 * treats them as fine), and backgrounds print (printBackground: true); the
 * page claims neither, and says only that a reference resolving beside the
 * upload has nothing to load, which is true of both renderers.
 */

const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;
const INPUT_MINUTES = DEFAULT_RETENTION.inputTtlMinutes;

/**
 * The HTML ceiling: the smaller of what the upload accepts and what the
 * renderer refuses above (`runHtmlToPdf` → `too_large`, and again inside the
 * native runner). The renderer's default cap is the smaller, so it is the
 * ceiling, and it is ONE figure: the panel's Limit row and the derived "How
 * large can my file be?" answer read the same `toolFileCeiling`. Until
 * 2026-09-27 this sentence quoted the Limit row as the upload gate and called
 * the renderer's cap "the real ceiling", while the derived answer below it
 * said "Up to 100 MB per file". Formatted with the formatBytes the Limit row
 * uses, so the two read in one style. A deployment can override the cap with
 * PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES; no deploy file in this repo does
 * (`file-ceilings.test.ts` fails if one does), but production's env was not
 * read.
 */
const CEILING = toolFileCeiling(getToolBySlug("html-to-pdf")!);
const CEILING_TEXT = formatBytes(CEILING.bytes ?? 0);

/** Who refuses above the ceiling, computed rather than assumed. */
const SIZE_SENTENCE =
  CEILING.tier === "worker" && CEILING.engine
    ? `One HTML file of up to ${CEILING_TEXT} per run, the most ${CEILING.engine} is handed: a larger one is refused as soon as you pick it, before anything is uploaded.`
    : `One HTML file of up to ${CEILING_TEXT} is accepted per run.`;

const content: ToolContent = {
  slug: "html-to-pdf",

  seoTitle: "HTML to PDF: Print an HTML File with Chromium",

  metaDescription:
    "Upload one .html or .htm file and headless Chromium prints it to PDF, running its scripts and applying print CSS and @page size. Input deleted after the job.",

  intro: [
    "HTML to PDF takes one .html or .htm file and prints it the way a browser would. Headless Chromium, the open-source engine behind Chrome, lays out the markup with the CSS inside the file, runs its JavaScript within a bounded rendering window, and prints the result. Because it is a print rather than a screenshot, text stays selectable, @media print rules take effect, and a CSS @page rule decides the paper size.",
    `Chromium does not run in your browser, so this is an upload: the file goes over TLS to pdf.xyz's secure server, which deletes it when the job finishes (and within ${INPUT_MINUTES} minutes in any case). The PDF's download link lasts ${LINK_MINUTES} minutes, and a daily storage rule erases the stored copy after that.`,
    "Only the single file you choose is uploaded. A stylesheet, image or font referenced by a path such as css/site.css sits on your computer, not beside the upload, so it has nothing to load. Self-contained HTML works best: CSS in a <style> block, images and fonts embedded as data: URIs. To capture a page that is already online, give its address to Webpage to PDF instead.",
  ],

  useCases: [
    {
      title: "Print an HTML email template or invoice",
      body: "Templates like these tend to keep their styling inline in one file, which is the shape this tool handles best. Embed the logo as a data: URI rather than pointing at an image file, and add @page { size: A4 } when the recipient expects A4 rather than US Letter.",
    },
    {
      title: "Turn a static report into something you can send",
      body: "When a test, coverage or analytics tool offers a single-file HTML report, pick it: its styles and data travel inside the upload. The multi-file kind, a page plus a folder of scripts and images, prints without whatever lives in that folder.",
    },
    {
      title: "Proof a print stylesheet before it ships",
      body: "Open the PDF to see which elements your @media print rules hide, reflow or reveal on paper, straight from the file on your disk with no server to deploy to. Nothing is added in the top and bottom margins: no print date, title or page count appears unless your page draws it.",
    },
    {
      title: "Rescue the text of a saved web page",
      body: "Saving a page as “Webpage, Complete” writes an .html file plus a folder of assets. Only the .html travels here, so text written into the markup survives, while the styling and pictures in that folder do not.",
    },
  ],

  steps: [
    {
      title: "Add your HTML file",
      body: "Drag one .html or .htm file onto the dashed drop zone, or click it to pick one. The name then appears with a Remove button. The drop zone works before the page has heard from our server; the file is sent only when you press Render PDF, and that button stays off until a secure server is ready. When none is, the panel says why and offers a “Notify me when this ships” button.",
    },
    HTML_LAYOUT_STEP,
    {
      title: "Click Render PDF",
      body: "It stays disabled until a file is added. Once clicked, its label follows the job: “Uploading your file…”, then “Waiting for our server…” if the queue is busy, “Rendering PDF…” while Chromium prints, and “Downloading the result…”. A Cancel button below it stops the job at any point.",
    },
    {
      title: "Download the PDF",
      body: "When “Your PDF is ready.” appears, click the button reading Download plus the file name. The PDF is named after your file, ending in .pdf instead of .html or .htm. A failure shows an error note instead.",
    },
  ],

  faqs: [
    {
      q: "Is my HTML file uploaded, and how long is it kept?",
      a: `Yes, over TLS, because Chromium runs on our secure server. The upload is removed when the job ends, success or failure, and within ${INPUT_MINUTES} minutes regardless. The download link works for ${LINK_MINUTES} minutes; a daily storage rule then erases the stored PDF, typically a few hours later.`,
    },
    {
      q: "Why are my images, fonts or stylesheet missing from the PDF?",
      a: 'Usually a relative path. Our server receives your one HTML file and nothing else, so src="images/logo.png", href="style.css" or /img/logo.png point at files it never had. Paste the CSS into a <style> element, embed images and fonts as data: URIs, and render again.',
    },
    {
      q: "Does JavaScript run before the page is printed?",
      a: "Yes, within a fixed budget of rendering time, so a chart or table built by script can appear. Content that waits on a long timer, or on other files the page links to, which our server never receives, may be missing.",
    },
    {
      q: "Can I choose the page size, margins or orientation?",
      // Until 2026-10-25: "There are no layout settings on this page, but
      // the HTML itself can set them …" — true until the Page layout group
      // shipped; see src/lib/tools/html-layout-copy.ts for what the answer is read from.
      a: htmlLayoutAnswer("file"),
    },
    {
      q: "Does the PDF get a date, a title or a file path on every page?",
      a: "No. Our server asks Chromium for the page alone, so no print date, <title>, file location or page count is added at the top or bottom of any page. For page numbers or a running header, add them afterwards with Add Page Numbers or PDF Header & Footer.",
    },
    {
      q: "What happens if the file is too big or will not render?",
      a: `${SIZE_SENTENCE} Images embedded as data: URIs count toward it, and base64 makes each one about a third larger than the image file itself. If Chromium crashes or produces no usable PDF, our server tries again, and when every attempt fails the note says Chromium could not render the file. If the page stops waiting while the render is still going, a note says our server is still on the job and offers Keep waiting, which picks up the same job rather than uploading the file again or starting a new one, or Cancel the job; a finished PDF stays available for ${LINK_MINUTES} minutes.`,
    },
  ],

  relatedGuides: ["how-to-convert-a-webpage-to-pdf"],
};

export default content;
