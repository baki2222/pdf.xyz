import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { webOptimizedOutputName } from "@/lib/workers/processor/pdf-structure";

/*
 * Every behavioral claim below was read from the code on 2026-09-27:
 *  - panel: src/components/tools/pdf-structure-worker-panel.tsx — the live
 *    worker check ("Secure worker" / "Not enabled" badge, no uploader and a
 *    count-only "Notify me when this ships" button while unavailable), the compact dropzone "Add a PDF, or
 *    browse", one file only, the "Optimize on the worker" button, and
 *    "Download <name>" on success. There is no options control and no
 *    password field.
 *  - engine: src/lib/workers/pdf-structure/native.ts runs `qpdf --linearize`
 *    and nothing else; engine.ts refuses input that fails looksLikePdf (no
 *    `%PDF-` header in the first 1 KiB or no `%%EOF` in the last 2 KiB), and
 *    holds the output to the same check. qpdf exit 3 ("warnings, output
 *    written") is ACCEPTED for linearize too, so damage inside a file that
 *    passes looksLikePdf is silently worked around, and the processor attaches
 *    qpdf warnings only for repair-pdf. Any other exit, a timeout, or output
 *    failing the check → the job fails with no output.
 *  - download: runSecurityJob fetches the output into the page as soon as the
 *    job completes; "Download <name>" saves those in-memory bytes. The outputTtlMinutes
 *    figure is the worker link, not the button.
 *  - NOT probed with a real job: qpdf-level behaviour (what is preserved, size
 *    change, password-protected input, signatures, Acrobat display).
 *  - output name: the example is RENDERED through webOptimizedOutputName(),
 *    so a changed suffix changes this page with it.
 *  - output check: looksLikePdf looks for `%PDF-` in the first 1 KiB and
 *    `%%EOF` in the last 2 KiB, so the copy says "near", never "starts with".
 *  - a missing header is also refused by Repair PDF (looksRepairable needs the
 *    header), so the FAQ sends only the missing-EOF case there.
 *  - the upload's declared type comes from the file's extension
 *    (declaredContentTypeFor); a name not ending in .pdf never gets a slot.
 *  - the drop box shows whenever canRunPdfStructure is true; the badge then
 *    reads "Secure worker" in production and "Local-dev worker" locally, so
 *    the step names the check, not one badge label.
 *  - the proof harness (scripts/worker-prove-tools.ts) checks only that the
 *    output is a PDF, not that it is linearized; the verification FAQ is
 *    written as a check for the reader to run, not as a result we observed.
 *  - the size cap is the worker-tier ceiling, read via toolFileCeilingMb.
 *  - retention: DEFAULT_RETENTION + the daily storage rule named on /privacy.
 */
const optimizeTool = getToolBySlug("optimize-web");
const ceilingMb = optimizeTool ? toolFileCeilingMb(optimizeTool) : null;
if (ceilingMb === null) {
  throw new Error("optimize-web content states a file ceiling it cannot find");
}
const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;
const exampleInput = "catalogue.pdf";
const exampleOutput = webOptimizedOutputName(exampleInput);

const content: ToolContent = {
  slug: "optimize-web",

  seoTitle: "Optimize for Web — Linearize PDF for Fast Web View",

  metaDescription:
    "Linearize a PDF with qpdf so a browser can show page one while the rest is still downloading. The worker deletes your upload once the job ends.",

  intro: [
    "Optimize for Web rewrites a PDF in linearized form, the layout Acrobat calls Fast Web View. An ordinary PDF keeps its object index at the end, so a viewer opening it from a link must fetch the tail before drawing anything. A linearized file puts what page one needs at the front, plus a hint table, so a viewer that requests byte ranges can show the first page while the rest arrives and fetch other pages as they are opened.",
    "The work is done by qpdf with its --linearize option and nothing else. qpdf changes the order and layout of the stored objects, not what they draw: no page is re-rendered and no image is downsampled, though by default qpdf may losslessly re-compress streams as it writes them. It is not a size reducer; for a smaller file, use Compress PDF.",
    `qpdf is a native program, so linearizing cannot happen in your browser: the PDF, at most ${ceilingMb} MB and one per job, is uploaded over TLS to pdf.xyz's secure worker. Your original is removed from the worker as soon as the job is over, successful or not. The linearized result stays fetchable for ${linkMinutes} minutes; after that its link is dead, and a storage rule on a daily cycle deletes what remains.`,
  ],

  useCases: [
    {
      title: "Manuals and catalogues linked from a website",
      body: "A long manual served from your own site can show its cover quickly instead of making the visitor wait for the whole file, as long as the server answers byte-range requests.",
    },
    {
      title: "Reports hosted in a document portal or intranet",
      body: "Annual reports and policy handbooks are read a few pages at a time; linearized, an in-browser viewer can fetch just the pages a reader opens.",
    },
    {
      title: "Meeting a Fast Web View requirement",
      body: "When a publishing checklist or a client asks for Fast Web View, this produces a qpdf-linearized file you can verify yourself (see the questions below).",
    },
    {
      title: "The final step after compressing or editing",
      body: "Shrink the file with Compress PDF or finish your page edits first, then linearize last. A later rewrite by another editor generally throws the linearized layout away again.",
    },
  ],

  steps: [
    {
      title: "Wait for the worker check",
      body: "On load the panel asks the worker status endpoint whether a worker is ready to accept jobs, and shows the answer in a badge, which reads “Secure worker” on the live site. Until that answer is yes, no drop box is shown; the panel offers “Notify me when this ships” instead, and pressing that only adds one to a count of requests for this tool.",
    },
    {
      title: "Add one PDF",
      body: `Drop the PDF on the dashed zone marked “Add a PDF, or browse”, or click that zone to open a file picker. It takes a single document; drop several and all but the first are ignored. The chosen name then replaces the zone, with “Remove” beside it to start over. The upload is requested with the file's size and a type read from its name, so a file over ${ceilingMb} MB, or one whose name does not end in .pdf, is turned away before any of its bytes are sent.`,
    },
    {
      title: "Click “Optimize on the worker”",
      body: "There are no options to set. The button reads “Optimizing on the worker…” while the file uploads and qpdf linearizes it; before the result is accepted, the worker checks it is not empty and has a PDF header near its start and an end-of-file marker near its end.",
    },
    {
      title: "Download the result",
      body: `When the job completes, the page fetches the result straight away, and a button reading “Download” plus the new name saves it; ${exampleInput}, for example, comes back as ${exampleOutput}. The page keeps no link to the worker's copy, which stops being served after ${linkMinutes} minutes anyway, so if you reload before saving, run the job again.`,
    },
  ],

  faqs: [
    {
      q: "What does it mean to linearize a PDF?",
      a: "It reorders the objects inside the file so the first page and a hint table come first, letting a viewer that requests parts of a file render page one early and fetch other pages on demand. What the pages show does not change.",
    },
    {
      q: "Will optimizing for web make my PDF smaller?",
      a: "Not reliably. qpdf drops objects nothing refers to, which can trim a heavily edited file, but the hint table it adds costs bytes, so the size can move either way. To cut the size, run Compress PDF first, then linearize its output here.",
    },
    {
      q: "Does a linearized PDF load faster everywhere?",
      a: "No. It helps when a viewer that requests byte ranges opens the PDF from a server that honours them. An email attachment is downloaded whole before it opens, and a file on your disk can already be read in any order, so neither gains anything.",
    },
    {
      q: "How can I check that the result is linearized?",
      a: "In Adobe Acrobat or Reader, open File › Properties and look for “Fast Web View: Yes”. From a command line, `qpdf --check-linearization yourfile.pdf` reports whether the linearization data is valid.",
    },
    {
      q: "Why was my PDF refused or why did the job fail?",
      a: "Before qpdf runs, the file must have a PDF header (%PDF-) near its start and an end-of-file marker (%%EOF) near its end; otherwise it is refused as not readable as a PDF. A missing end marker is what a cut-off download loses, and Repair PDF accepts such files, so try it there first. A missing header usually means the file is not a PDF at all, and Repair PDF refuses that too. Deeper damage in a file that has both markers is not refused: if qpdf can work around it the job succeeds, but this page does not show qpdf's warnings, while Repair PDF does. Encrypted files that ask for a password before opening fail, because this tool hands qpdf no password and has no field for one; take the password off with Unlock PDF first. A qpdf error, a timeout, or output missing either marker ends in a failed job with no download, never a half-written file.",
    },
    {
      q: "Is it safe to linearize a digitally signed PDF?",
      a: "No. Linearizing rewrites the whole file, so the byte ranges a certificate-based digital signature covers no longer match and the signature will stop validating. If a document needs both, linearize the unsigned version and sign it last. Signing tools usually append the signature as an update at the end of the file, after which a viewer may no longer report it as linearized, so run the check above on the signed copy.",
    },
  ],

  relatedGuides: ["how-to-compress-a-pdf"],
};

export default content;
