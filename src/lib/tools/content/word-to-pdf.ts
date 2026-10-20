import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeiling } from "@/lib/tools/file-ceilings";
import { resolveNativeOfficeConversionConfig } from "@/lib/workers/office-conversion/native-config";

/**
 * Facts this copy leans on, each read from the code that makes it true
 * (2026-09-27):
 *
 *  - Engine: `runOfficeToPdf` in src/lib/workers/office-conversion/engine.ts
 *    runs headless LibreOffice (`soffice --convert-to pdf`, native.ts) on the
 *    secure worker, with no export options and no password argument. Accepted
 *    extensions are exactly `docx` and `doc`; anything else is refused as "The
 *    uploaded file type does not match this Office conversion tool." The
 *    client also refuses an extension absent from MIME_BY_FORMAT before
 *    uploading, and the intake refuses a declared type the tool does not
 *    accept (so a .txt is turned away at the upload step).
 *  - One file per job: the panel's Dropzone is `multiple={false}` and the
 *    processor refuses anything but exactly one input.
 *  - Output name: `officePdfOutputName` keeps the sanitised original stem
 *    (truncated past MAX_DISPLAY_FILENAME_LENGTH) and swaps the extension for
 *    .pdf; the panel's button reads "Download <that name>".
 *  - The Download button does NOT fetch the link: `runSecurityJob` has already
 *    downloaded the output bytes into the tab before "Your PDF is ready."
 *    appears, and the button saves those bytes (`downloadBytes`). The link's
 *    lifetime governs the stored copy, not the button.
 *  - UI labels quoted in the steps are from office-conversion-worker-panel.tsx
 *    and runner/runner-kit.tsx: "Add your document, or browse", "Remove" (a button),
 *    "Convert to PDF", its busy label `jobBusyLabel(job.phase, "Converting to
 *    PDF…")` (Uploading your file…, Waiting for the worker…, Converting to
 *    PDF…, Downloading the result…), "Your PDF is ready.", the "Secure
 *    worker" / "Not enabled" / "Status unknown" badge, the "Limit" spec row,
 *    and NotifyMe's "Notify me when this ships" — shown ONLY with "Not
 *    enabled" (phase "ready", worker unable to convert). "Status unknown" is
 *    the failed check (phase "error"), which renders WorkerStatusPending's
 *    "Check again" and no NotifyMe; the FAQ paired "Status unknown" with the
 *    notify button until 2026-10-08 (worker-tool-answers.test.ts bans that
 *    pairing on every served page).
 *
 * SIZE. ONE figure, the tool's ceiling (`toolFileCeiling`): the smaller of the
 * upload gate and the converter's own `maxInputBytes`. The converter's is
 * lower, so it is the ceiling, and the panel's "Limit" row, the derived "How
 * large can my file be?" answer and this copy all state it. Until 2026-09-27
 * this page stated both — "uploads are accepted up to" the gate and "the
 * converter refuses a Word file over" its cap — beside a derived answer of
 * "Up to 100 MB per file", which was false. SUPERSEDED, history kept: "a
 * larger file is still UPLOADED (the intake compares against the gate), then
 * refused before LibreOffice starts". Since 2026-09-27 the same figure is
 * enforced before anything moves: the panel's Dropzone `refuse` runs
 * `pickRefusal` (the file is never read), `runSecurityJob` refuses it again
 * before any request ("Nothing was uploaded."), and the upload route refuses
 * a session over `workerFileCeilingBytes`. The
 * converter figure and the time limit are the config's DEFAULTS; no deploy
 * artifact in this repo overrides either (`file-ceilings.test.ts` fails if one
 * does), but the production worker's env was not read.
 *
 * NOT PROVEN BY A REAL JOB. `worker:prove-tools` checks only that word-to-pdf
 * returns a PDF (`isPdf`), not what is in it, and no LibreOffice was available
 * to run one here. So the claims about selectable text, page setup and font
 * substitution rest on what LibreOffice's PDF export does generally, and are
 * kept to that. Substitute fonts are worded as "may differ" in width, because
 * LibreOffice ships metric-compatible stand-ins for some Office fonts and which
 * of them the image carries is unknown.
 *
 * PASSWORDS. No password reaches soffice. An open-password file either fails to
 * load (no output file, so the runner throws and `runOfficeToPdf` returns
 * "failed") or waits on a prompt until `timeoutMs` kills it; both end in an
 * error, which is all the copy claims. A "failed" run is `retryable: true`, so
 * the error may arrive only after the daemon's retries; no timing is claimed. NOT CLAIMED at all: bookmarks from headings, live hyperlinks,
 * comments, tracked changes, embedded-font handling, which fonts the worker
 * image carries (the Dockerfile installs `libreoffice` with
 * --no-install-recommends and no explicit font packages), or the exact error a
 * password-protected file produces.
 */
const MB = 1024 * 1024;
const officeConfig = resolveNativeOfficeConversionConfig({});
const ceiling = toolFileCeiling(getToolBySlug("word-to-pdf")!);
const ceilingMb = Math.round((ceiling.bytes ?? 0) / MB);
const timeLimitSeconds = Math.round(officeConfig.timeoutMs / 1000);
const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;

/** Who refuses above the ceiling: the converter when its cap is the lower. */
const sizeAnswer =
  ceiling.tier === "worker" && ceiling.engine
    ? `One document per conversion, of up to ${ceilingMb} MB, the most LibreOffice on the worker accepts: a larger Word file is turned away as soon as you pick it, before anything uploads. Word's Compress Pictures can shrink an image-heavy file. For a batch, convert one file, press Remove, and add the next.`
    : `One document per conversion, up to ${ceilingMb} MB. For a batch, convert one file, press Remove, and add the next.`;

const content: ToolContent = {
  slug: "word-to-pdf",

  seoTitle: "Word to PDF Converter: DOCX and DOC to PDF",

  metaDescription: `Make a PDF from a .docx or .doc with LibreOffice on a secure worker. Your Word file is deleted once the job ends; its PDF download expires in ${linkMinutes} minutes.`,

  intro: [
    "Word to PDF takes one .docx or .doc file and hands it to LibreOffice, running headless on pdf.xyz's secure worker. LibreOffice lays out the pages from the page size, margins, headers and footers set in the document itself and exports a PDF named after your file. Typed text comes out as text, so it can be searched, selected and copied; a picture of text, such as a pasted scan, stays a picture.",
    "LibreOffice reads Word's formats, but it is not Microsoft Word, and differences tend to show in fonts and floating objects. A font the worker lacks is replaced by a stand-in whose letter widths may differ, which can move line and page breaks, and text boxes or wrapped images may land slightly elsewhere. Styles, tables and in-line images give it the least to reinterpret.",
    `Nothing is converted on your own computer. Your document goes to pdf.xyz's secure worker over an encrypted (TLS) connection and is deleted there when the job ends. The finished PDF can be fetched for ${linkMinutes} minutes, after which a daily storage rule clears the stored copy. The converter takes Word files of up to ${ceilingMb} MB, one at a time.`,
  ],

  useCases: [
    {
      title: "A CV that looks the same on the recruiter's screen",
      body: "A .docx reflows in another word processor or a phone preview. A PDF fixes the layout, so the reader sees the pages you checked.",
    },
    {
      title: "Portals and offices that take PDF only",
      body: "Application forms, university submissions and supplier portals often refuse Word files. Convert the finished document and upload the PDF they ask for.",
    },
    {
      title: "Reading an old .doc when Word is not installed",
      body: "Legacy .doc files from an archive are opened by LibreOffice's own import filter, so you get a shareable PDF without owning Office.",
    },
    {
      title: "Finishing a round trip through Word",
      body: "Pulled a PDF into Word with PDF to Word to fix a paragraph? Send the edited .docx back through here to get a PDF again.",
    },
  ],

  steps: [
    {
      title: "Add your Word file",
      body: 'Drag a .docx or .doc onto the box that says "Add your document, or browse", or click it to open your file picker. The chosen file\'s name then shows above the button, next to a Remove button for swapping it out.',
    },
    {
      title: "Press Convert to PDF",
      body: 'The document is sent to pdf.xyz\'s secure worker over an encrypted connection. The button reads "Uploading your file…", then "Waiting for the worker…" while the job is queued, "Converting to PDF…" while LibreOffice converts it, and "Downloading the result…" as the finished PDF is fetched back into the tab.',
    },
    {
      title: "Save the PDF",
      body: `By the time "Your PDF is ready." shows, the PDF has already been fetched into this tab, and the Download button, labelled with your file's name ending in .pdf, saves it from there. Save it before you close the tab: this panel shows no link to the stored copy, and that copy expires after ${linkMinutes} minutes regardless.`,
    },
    {
      title: "Check the pages before you send",
      body: "Look for moved page breaks, a changed font or a shifted image. If something drifted, fix it in the Word file, for example by setting a floating image in line with text, and convert again.",
    },
  ],

  faqs: [
    {
      q: "Why might the page breaks differ from what Word shows me?",
      a: "Because LibreOffice, not Microsoft Word, decides where each line and page ends. If the document names a font the worker does not have, a substitute is used, and a slightly wider one can push the last lines of a page onto the next; floating text boxes and wrapped images are placed by LibreOffice's own rules too. Typed text stays selectable either way.",
    },
    {
      q: "What happens to my Word file after it is converted?",
      a: `Your .docx or .doc travels over TLS to pdf.xyz's secure worker, and the worker deletes it once the conversion job is finished. The PDF LibreOffice made sits behind a download link that expires after ${linkMinutes} minutes, and a daily storage rule erases that stored file once the link has lapsed.`,
    },
    {
      q: "Which file types can I convert here?",
      a: "Word's current .docx format and the older .doc format, nothing else. Files ending in .docm, .odt, .rtf, .pages or .txt are turned away rather than guessed at. For plain text, the Text to PDF tool builds a PDF in your browser instead.",
    },
    {
      q: "How big can the document be, and can I convert several at once?",
      a: sizeAnswer,
    },
    {
      q: "Why would a Word file fail to convert?",
      a: `A conversion stops with an error when the file needs a password to open, is too damaged for LibreOffice to open, or takes LibreOffice longer than its ${timeLimitSeconds}-second limit. This page has no password field, so remove the password in Word first (File, Info, Protect Document, Encrypt with Password, then clear it) and convert a saved copy. Each failure shows a message under the Convert to PDF button instead of a Download button.`,
    },
    {
      q: "Why is there no upload area, only a notice?",
      a: 'The panel first checks whether the secure worker can run LibreOffice. You can add a file at once, but nothing is uploaded until a check confirms the worker and you press Convert to PDF. If the badge reads "Not enabled", that button stays off and a "Notify me when this ships" button appears under it. If it reads "Status unknown", the status check did not answer, and a "Check again" button retries it.',
    },
  ],

  relatedGuides: ["how-to-convert-pdf-to-word"],
};

export default content;
