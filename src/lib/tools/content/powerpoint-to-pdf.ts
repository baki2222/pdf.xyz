import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import {
  DOCUMENT_WORDS,
  POWERPOINT_TO_PDF_TOOL,
} from "@/lib/workers/office-conversion/engine";
import { resolveNativeOfficeConversionConfig } from "@/lib/workers/office-conversion/native-config";
import { officePdfOutputName } from "@/lib/workers/processor/office-conversion";

/**
 * The deck ceiling: the smaller of what `/api/uploads` accepts and what the
 * LibreOffice step refuses above (`runOfficeToPdf` → `too_large`, and again
 * inside the native runner). The converter's cap is the smaller, so it is the
 * ceiling — and ONE figure, the one the panel's Limit row, the derived FAQ
 * and the pick refusal (`fileOverCeilingMessage`, through `pickRefusal` on
 * the panel's Dropzone) state too: `toolFileCeilingMb` is that figure. Until 2026-09-27 this page quoted the upload gate beside the cap
 * as "the upload limit", while the derived answer said "Up to 100 MB".
 *
 * The other limits are the config resolver's defaults (empty environment). A
 * deployment can override them with PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES,
 * _MAX_OUTPUT_BYTES and _TIMEOUT_MS; the deploy files in the repo set none of
 * them (`file-ceilings.test.ts` fails on the input cap if one does), but the
 * production worker's environment was not checked. The OUTPUT cap is named but
 * not given a figure: it equals the upload gate today, and a second size on
 * this page would read as a second, false ceiling.
 */
const CEILING_MB = toolFileCeilingMb(getToolBySlug("powerpoint-to-pdf")!);
if (CEILING_MB === null)
  throw new Error("powerpoint-to-pdf content states a ceiling it cannot find");
const OFFICE_DEFAULTS = resolveNativeOfficeConversionConfig({});
const TIMEOUT_SECONDS = Math.round(OFFICE_DEFAULTS.timeoutMs / 1000);

const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;
/** Where PowerPoint removes a password: the words the engine's refusal uses. */
const PROTECT = DOCUMENT_WORDS[POWERPOINT_TO_PDF_TOOL];

const EXAMPLE_IN = "Quarterly review.pptx";
const EXAMPLE_OUT = officePdfOutputName(EXAMPLE_IN);

/*
 * Behaviour claims below were read from the code on 2026-09-27:
 *   - accepted extensions: pptx, ppt only (`EXTENSIONS` in
 *     office-conversion/engine.ts; the per-tool upload validator uses the
 *     catalogue's `accept`, so another type is refused at /api/uploads, and a
 *     type with no MIME entry at all, such as .odp or .key, is refused in the
 *     browser by `declaredContentTypeFor` before /api/uploads is called);
 *   - exactly one input per job (`requireSingleInput`), and the panel's
 *     Dropzone is `multiple={false}`; the job is created with `options: {}`,
 *     so the page offers no settings at all;
 *   - output name = `officePdfOutputName`, interpolated below;
 *   - the engine is `soffice --headless --convert-to pdf` with no export
 *     filter options, so LibreOffice's default PDF export settings apply;
 *   - failures, RE-READ 2026-10-07 (office-conversion/engine.ts and
 *     processor/office-conversion.ts `jobError`): a LibreOffice run that
 *     cannot load the deck or writes no usable PDF is `unreadable`, a timeout
 *     is `timeout`, an oversize input or output is `too_large`, and each maps
 *     to a NON-retryable job error. Only a fault that is not a
 *     `LibreOfficeRunError` (kind `failed`) is retried. Until then this page
 *     said every failure was retried, true of the engine before the change
 *     that made document failures final;
 *   - a password-protected .pptx is caught by `isEncryptedOoxml` before
 *     soffice runs, with a message naming PowerPoint's Protect Presentation
 *     command (`DOCUMENT_WORDS`, interpolated). A locked legacy .ppt cannot be
 *     recognised that way; what this worker's LibreOffice does with one was
 *     not observed, so the copy promises the named message for .pptx only;
 *   - an over-ceiling deck is refused WHEN PICKED (`pickRefusal`), before it
 *     is read or uploaded; the engine's `too_large` is a backstop this page
 *     cannot reach;
 *   - the button's busy label is `jobBusyLabel(phase, "Converting PDF…")`, so
 *     it follows the job (busy-label-claims.test.ts);
 *   - "is a PDF" is `looksLikePdf`: a `%PDF` header in the first 1 KiB and
 *     `%%EOF` in the last 2 KiB, nothing deeper, so the copy says exactly that;
 *   - relatedGuides is empty on purpose: no guide in src/lib/guides/catalog.ts
 *     lists powerpoint-to-pdf among its tools;
 *   - the browser client downloads the artifact bytes BEFORE showing "Your PDF
 *     is ready.", and the Download button saves those in-memory bytes
 *     (`downloadBytes(outcome.output, …)`), so it does not depend on the
 *     stored link staying alive;
 *   - the client polls for one conversion timeout plus a margin
 *     (OFFICE_TO_PDF_JOB_POLL) and then shows `WorkerJobStatus`'s "still on
 *     this job" note with Keep waiting and Cancel the job; no job id.
 * Claims that depend on LibreOffice's DEFAULT export behaviour (notes pages
 * and hidden slides not exported, page size = slide size, text kept as text)
 * are NOT proven by a real job on this worker yet.
 */
const content: ToolContent = {
  slug: "powerpoint-to-pdf",

  seoTitle: "PowerPoint to PDF: Convert PPTX and PPT Slides",

  metaDescription: `Turn a PPTX or PPT deck into a PDF with one slide per page, rendered by LibreOffice. Your upload is deleted after the job; the link expires in ${LINK_MINUTES} min.`,

  intro: [
    `PowerPoint to PDF takes one presentation, a modern .pptx or a legacy .ppt from PowerPoint 97–2003, and returns a PDF with one slide per page. Each page keeps the slide's shape, so a widescreen deck is not squeezed onto A4 or Letter. Text typed into text boxes stays searchable, copyable text; words inside a picture stay a picture.`,
    `Conversion does not happen in your browser. The deck is uploaded over TLS to pdf.xyz's secure worker, and LibreOffice exports it there with its default PDF settings, because this page sends the converter no options of its own. The uploaded presentation is deleted when the job finishes, the download link expires after ${LINK_MINUTES} minutes, and the stored copy is erased by a daily storage rule after that. The converter takes decks of up to ${CEILING_MB} MB.`,
    `Animations do not carry over, so bullet points that appeared one click at a time all show together. LibreOffice's default export leaves speaker notes and hidden slides out. Because LibreOffice rather than Microsoft PowerPoint does the drawing, missing fonts are substituted and elaborate effects can shift slightly, so skim the result before you send it.`,
  ],

  useCases: [
    {
      title: "Send a deck to someone without PowerPoint",
      body: "A client reading on a phone or a colleague on a Chromebook can open a PDF in whatever viewer they already have, with the visible slides in the order you set.",
    },
    {
      title: "Hand in slides where a portal wants PDF",
      body: "When a conference, course or grant site asks for slides as a PDF, convert the deck here, even on a machine with no PowerPoint to export from.",
    },
    {
      title: "Turn archived .ppt files into PDFs",
      body: "Decks saved in the pre-2007 binary .ppt format are accepted alongside .pptx, so an old presentation becomes a file that opens without any office suite installed.",
    },
    {
      title: "Build one handout from several decks",
      body: "This tool converts one presentation per job. Convert each deck in turn, then combine the resulting PDFs with Merge PDF to hand out a single file for a whole workshop.",
    },
  ],

  steps: [
    {
      title: "Add your presentation",
      body: 'Drop one .pptx or .ppt file on the box that reads "Add your document, or browse", or click browse to pick it. You get that box only when the status badge next to "LibreOffice renderer" says "Secure worker"; any other badge comes with a note on the state of the converter instead.',
    },
    {
      title: "Check the file you picked",
      body: "The file name appears above the button. Choose Remove if you picked the wrong deck and add another; only one presentation goes into each conversion, and there are no settings to set.",
    },
    {
      title: "Click Convert to PDF",
      body: 'The button follows the round trip: "Uploading your file…" while the deck goes to the secure worker, "Waiting for the worker…" while the job is queued, "Converting PDF…" during the LibreOffice export, and "Downloading the result…" while the finished PDF comes back into this tab.',
    },
    {
      title: "Download the PDF",
      body: `When "Your PDF is ready." appears, click the Download button, which carries the file's name: ${EXAMPLE_IN} comes back as ${EXAMPLE_OUT}. The PDF has already been fetched to this page by then, so save it before you close or reload the page.`,
    },
  ],

  faqs: [
    {
      q: "Are my speaker notes included in the PDF?",
      a: "No, and this page has no option to add them. LibreOffice's default export, which is what runs here, writes the slides only, one per page. Notes pages and slides you have marked as hidden in PowerPoint are not exported, so unhide any slide you want in the PDF before converting.",
    },
    {
      q: "Why do some slides look different in the PDF?",
      a: "The result is usually close to PowerPoint, but not pixel for pixel. LibreOffice does the rendering, and a font the converter lacks is swapped for a substitute, which can move line breaks or overflow a text box. Complex effects and some SmartArt may also be drawn differently.",
    },
    {
      q: "Can I convert Google Slides, Keynote or ODP presentations?",
      a: "Not directly. Only .pptx and .ppt files are accepted, and any other type is refused before anything is uploaded. From Google Slides, download the deck as a Microsoft PowerPoint file first; from Keynote, export it to PowerPoint, then convert that file here.",
    },
    {
      q: "What happens to my presentation after I convert it?",
      a: `It is kept in the secure worker's storage while the job runs, including any automatic retry, and deleted when the job finishes, whether it succeeded or failed. The finished PDF's download link expires after ${LINK_MINUTES} minutes; a daily storage rule erases the stored copy after that.`,
    },
    {
      q: "How large a presentation can I convert?",
      a: `Up to ${CEILING_MB} MB. A bigger deck is turned away as soon as you pick it, before anything is uploaded, with a message that states the ${CEILING_MB} MB limit. Decks that big are usually carrying photos or embedded video; PowerPoint's Compress Pictures command can shrink the images before you try again.`,
    },
    {
      q: "Why did my conversion fail?",
      a: `A password-protected deck cannot be converted, because there is no field on this page to type the password into. A locked .pptx is recognised before LibreOffice runs, and the job stops with a message telling you to remove the password in ${PROTECT.app} (${PROTECT.protect}); save an unprotected copy and convert that. A file too damaged for LibreOffice to open also fails, as does one it cannot finish within ${TIMEOUT_SECONDS} seconds or whose PDF comes out larger than the worker's output limit. None of those is retried, because the same file would fail the same way again. If the page stops waiting before the worker finishes, it shows Keep waiting, which goes back to the same job instead of starting a new one. The worker also rejects any output missing the %PDF header or the closing %%EOF marker, so a broken export never comes back as a download.`,
    },
  ],

  relatedGuides: [],
};

export default content;
