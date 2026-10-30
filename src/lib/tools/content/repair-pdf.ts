import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { MAX_TOOL_NOTES } from "@/lib/jobs/tool-notes";
import { MAX_DIAGNOSTIC_LINES } from "@/lib/workers/native-diagnostics";
import { repairedOutputName } from "@/lib/workers/processor/pdf-structure";
import { DEFAULT_INTAKE_POLICY } from "@/lib/uploads/intake";
import { DEFAULT_SOUNDNESS_POLICY } from "@/lib/workers/soundness/policy";

/*
 * Behaviour claims below were read from the code on 2026-09-27:
 *  - panel: src/components/tools/pdf-structure-worker-panel.tsx — one PDF via a
 *    compact drop zone that reads "Add a PDF, or browse" (runner-kit Dropzone
 *    appends "browse"; only files[0] is kept), a "Repair on the worker" button
 *    whose busy label is jobBusyLabel(job.phase, "Repairing on the worker…")
 *    — "Uploading your file…", "Waiting for the worker…", the working label,
 *    "Downloading the result…" — then "Your repaired PDF is ready." and a
 *    "Download <name>" button. No options, no password field. (Until
 *    2026-10-07 the step said the button read the working label throughout.)
 *    When no worker is ready, no uploader is shown at all.
 *  - busy state: the button stays busy until runSecurityJob RETURNS, which is
 *    after the output bytes are fetched, on a failed job, or when the poller
 *    gives up. So the step does not say "until the job succeeds or fails":
 *    the page can stop waiting first. When it does, useWorkerJob keeps the
 *    job as stillRunning and WorkerJobStatus (worker-job.tsx) shows "The
 *    worker is still on this job" with Keep waiting (polls the SAME job, no
 *    new upload) and Cancel the job; while busy, a Cancel button sits under
 *    the run button. Until 2026-10-08 the step said the page "says the job
 *    may still finish", the poller's own sentence from before useWorkerJob
 *    (busy-label-claims.test.ts held it on a ratchet until then).
 *  - download: pdf-security-client.ts runSecurityJob fetches the output bytes
 *    into the page BEFORE the result card appears; the Download button saves
 *    those bytes (downloadBytes), it does not follow the stored link.
 *  - failures and retries: qpdf's exit 2 — qpdf refusing the DOCUMENT — is
 *    probed once with `--requires-password` while the file is on disk and
 *    thrown as a QpdfRefusedError ("password_protected" | "unrecoverable");
 *    engine.ts turns it into `password_protected` / `unreadable` with
 *    REFUSAL_MESSAGES.repair, and processor/pdf-structure.ts makes both
 *    NON-retryable, so the job ends at once with that sentence (the panel
 *    links Unlock PDF for the first). Every other qpdf failure (timeout, an
 *    exit other than 0/2/3, a spawn or IO error, empty/oversized output,
 *    output failing `looksLikePdf`) is `failed`, a RETRYABLE internal_error.
 *    The executor requeues retryable errors until maxAttempts (no number
 *    stated: the executor default and the daemon's configured value differ).
 *    A headerless input is non-retryable (`invalid_pdf`, or the soundness
 *    gate's `malformed_pdf`). Until 2026-10-07 this bullet and the page said
 *    every qpdf error exit was retried, which was true before exit 2 was
 *    typed (pdf-structure.refusal.test.ts tells that history).
 *  - warnings: src/components/tools/repair-warnings.tsx renders from
 *    job.results.repair. native.ts treats qpdf exit 3 as success and keeps
 *    its stderr through sanitizeNativeDiagnostics (repeats collapsed, at most
 *    MAX_DIAGNOSTIC_LINES kept, path-bearing lines withheld, one trailing
 *    "N further message(s) not shown." line). The job record then re-bounds
 *    the list through boundToolNotes (MAX_TOOL_NOTES), which can withhold the
 *    worker's own trailing count line and replace it with a smaller one — so
 *    the copy says a closing line NOTES that more were held back and never
 *    that the held-back messages are counted. The figure shown is the smaller
 *    of the two bounds, because the reader gets the composition.
 *  - empty stderr: engine.ts sets recoveredWithWarnings from warnings.length,
 *    so exit 3 with EMPTY stderr shows no notice. The copy therefore says "no
 *    warning text came back from qpdf", not "qpdf reported no warnings" (exit
 *    3 itself is a warning status) and never "nothing was wrong".
 *  - engine: src/lib/workers/pdf-structure/{engine,native}.ts — qpdf plain
 *    rewrite (`qpdf in.pdf out.pdf`), a per-run timeout
 *    (PDFXYZ_PDF_STRUCTURE_TIMEOUT_MS; no number stated here because it is
 *    env-configurable). INPUT floor `looksRepairable`: a `%PDF-` header in a
 *    literal 1 KiB window plus a 32-byte minimum. The worker soundness gate
 *    (default requireHeader ON, requireEof OFF, headerScanBytes env-tunable)
 *    refuses a headerless PDF even earlier. No byte window is stated in the
 *    copy: two independent windows exist and only one is a constant.
 *  - truncated input: the "no end-of-file marker is still attempted" claim
 *    holds only while PDFXYZ_UPLOAD_REQUIRE_PDF_EOF and
 *    PDFXYZ_WORKER_SOUNDNESS_REQUIRE_PDF_EOF are off. The DEFAULTS are checked
 *    below and this module refuses to load if either default turns on.
 *    Production's env cannot be checked from here; if either is set on the
 *    worker or web tier, the intro, the truncated-download use case and the
 *    first FAQ become false and must change.
 *  - NOT run on a real damaged file: the proof harness sends an intact PDF.
 *    qpdf's recovery behaviour (xref reconstruction, password handling) is
 *    qpdf's documented behaviour, attributed to qpdf, and hedged.
 *  - output name: processor/pdf-structure.ts `repairedOutputName`.
 *  - size cap: the worker-tier ceiling, read through toolFileCeilingMb (the
 *    native qpdf config's own 200 MB default is higher, so it never binds).
 *  - retention: src/app/privacy/page.tsx (input deleted when the job ends,
 *    success or failure; a retried job keeps it for the retry; link stops
 *    after the output TTL; stored copy erased by a daily rule).
 */
const repairTool = getToolBySlug("repair-pdf");
const CEILING_MB = repairTool ? toolFileCeilingMb(repairTool) : null;
if (CEILING_MB === null) {
  throw new Error("repair-pdf content states a file ceiling it cannot find");
}
if (
  DEFAULT_INTAKE_POLICY.requirePdfEof ||
  DEFAULT_SOUNDNESS_POLICY.requireEof
) {
  throw new Error(
    "repair-pdf content says a file with no %%EOF still reaches qpdf, but a default now requires %%EOF",
  );
}
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;
const WARNING_LINES = Math.min(MAX_DIAGNOSTIC_LINES, MAX_TOOL_NOTES);
const EXAMPLE_OUTPUT = repairedOutputName("invoice.pdf");

const content: ToolContent = {
  slug: "repair-pdf",

  seoTitle: "Repair PDF — Try to Fix a Corrupted or Damaged PDF",

  metaDescription:
    "Upload a PDF that won't open and qpdf tries to rebuild its broken cross-reference table from the objects left, then lists any warnings it gave.",

  intro: [
    `Repair PDF passes a file that refuses to open, or opens with an error, through qpdf's parser and writer and hands back the rewritten copy. A "corrupted" PDF can still hold its pages while having lost the map to them: the cross-reference table that records where each object sits is damaged, or the file is cut off before its trailer. qpdf's documented behaviour when that table is broken is to rebuild it by scanning the file for the objects that remain.`,
    `The only structural check before qpdf runs is for a PDF header near the start of the file, so qpdf will still try a download that stopped partway and lost its end-of-file marker. If qpdf refuses the file outright, the job ends at once without a retry and says why: the PDF is password-protected and needs Unlock PDF first, or it could not be rebuilt into a PDF. If qpdf does not finish inside our server's time limit, or what it writes lacks a PDF header or an end-of-file marker, the run is retried, and if it keeps failing the job fails with no file. When qpdf recovers the document with warnings, they are shown next to the result.`,
    `This runs on a server. Your PDF, up to ${CEILING_MB} MB, is uploaded over TLS to pdf.xyz's secure server, and the uploaded copy is deleted once the job is over. The repaired file's download link expires after ${LINK_MINUTES} minutes; the stored bytes linger until the next pass of a once-a-day storage rule wipes them.`,
  ],

  useCases: [
    {
      title: "An attachment your viewer calls damaged",
      body: "A file clipped in transit, or saved by a program that crashed mid-write, can have a cross-reference table that no longer matches its contents. If the objects themselves are intact, a rebuilt table may be all it needs to open again.",
    },
    {
      title: "A download that stopped early",
      body: "An interrupted transfer leaves a PDF without its tail, end-of-file marker included. That marker is not required here, so the file still reaches qpdf; what qpdf can salvage is bounded by the bytes that made it across.",
    },
    {
      title: "A file that opens in one app but not another",
      body: "Forgiving readers quietly patch structural errors that stricter viewers, printers and upload portals reject. A freshly written structure gives those stricter programs less to object to.",
    },
    {
      title: "Finding out what was wrong",
      body: "When qpdf recovers a file with warnings, the result carries its own words about what it had to reconstruct, which tells you where to look when you compare the copy with what you expected.",
    },
  ],

  steps: [
    {
      title: "Add the damaged PDF",
      body: `Drop one PDF onto the box reading "Add a PDF, or browse", or click it and choose the file; up to ${CEILING_MB} MB, and there are no settings to choose. The box takes a file at once; nothing is sent until the status badge at the top of the panel reads Secure server and you press Repair on our secure server.`,
    },
    {
      title: "Press Repair on our secure server",
      body: "The file uploads and qpdf rewrites it. The button shows where the job is: Uploading your file…, then Waiting for our server… while it is queued, Repairing on our secure server… while qpdf runs, and Downloading the result… as the repaired copy is fetched into the page. A Cancel button under it stops the job while it runs. It stays busy until that copy is in the page, the job fails, or the browser stops waiting; then a note says our server is still on the job and offers Keep waiting, which picks up the same job rather than uploading the file again or starting a new one, or Cancel the job.",
    },
    {
      title: "Read the warnings, if any",
      body: `If qpdf recovered the file with warnings, a notice headed This PDF was damaged and has been rebuilt sits above the download button with qpdf's messages: each repeated message once, no more than ${WARNING_LINES} of them, lines that would expose a server file path left out, and a final line noting that further messages were not shown whenever any were held back. No notice means no warning text came back from qpdf; it does not mean the file is guaranteed intact.`,
    },
    {
      title: "Save the repaired copy",
      body: `The button labelled Download followed by the file name saves the bytes the page already fetched, so saving does not depend on the link; invoice.pdf comes back as ${EXAMPLE_OUTPUT}. Our server's link to the stored copy expires after ${LINK_MINUTES} minutes.`,
    },
  ],

  faqs: [
    {
      q: "Can every corrupted PDF be repaired?",
      a: "No. qpdf can reconstruct a damaged or missing cross-reference table when the objects are still in the file, but it cannot bring back bytes that are not there. If qpdf refuses the file, the job stops straight away without a retry, saying either that the file could not be rebuilt into a PDF or that it is password-protected and needs Unlock PDF first. A run that goes past our server's time limit, or writes something without a PDF header and end-of-file marker, is tried again and then fails the job with no file produced.",
    },
    {
      q: "Why was my file refused before the repair started?",
      a: "Our server looks for the PDF header (%PDF-) near the start of the file. Without it the file is probably not a PDF at all, such as a renamed image or an HTML error page saved with a .pdf name, or it has lost its beginning, so no repair is attempted and the job is not retried.",
    },
    {
      q: "What do the warnings after a repair mean?",
      a: "They are qpdf's own messages from rebuilding the file, for example that the cross-reference table was damaged or an object was not where the file said. The repair still produced a PDF, but check those parts against the original.",
    },
    {
      q: "Does repairing change how my pages look?",
      a: "qpdf rewrites the file's structure without re-rendering pages, so nothing is turned into an image and selectable text stays selectable. It does not redraw or guess at content that was itself damaged, such as a corrupted image stream, and an object it could not find stays missing.",
    },
    {
      q: "Can I repair a password-protected PDF?",
      a: "Not one that asks for a password before it opens: there is no password field on this page, and qpdf cannot read such a file without one. If you have the password, take the file through Unlock PDF and repair the copy it gives back, bearing in mind that a badly damaged file may not get through Unlock PDF either.",
    },
    {
      q: "Where does my file go, and for how long?",
      a: `Over TLS to pdf.xyz's secure server. The uploaded file is removed once the job reaches its end, whether the repair worked or not; if a failed attempt is being retried, it is kept for that retry. The repaired copy's link works for ${LINK_MINUTES} minutes and then returns an error, and a daily storage rule afterwards removes the stored file.`,
    },
  ],

  // No guide in src/lib/guides/catalog.ts lists repair-pdf among its tools.
  relatedGuides: [],
};

export default content;
