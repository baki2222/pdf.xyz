import type { ToolContent } from "./types";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  MAX_PDF_PASSWORD_BYTES,
  PDF_ENCRYPTION_LEVELS,
  unlockedOutputName,
} from "@/lib/jobs/pdf-security";

/*
 * Every behavioural claim below was read from the code on 2026-09-27:
 *  - panel: src/components/tools/pdf-security-worker-panel.tsx (mode "unlock")
 *    — one PDF through a drop zone titled "Add a locked PDF, or" (followed by
 *    the browse control; the step quoted "Add a password-protected PDF, or
 *    browse", which the panel never rendered, until 2026-10-07),
 *    a masked "Current password" field with a Show/Hide password toggle and
 *    the hint "Enter the password that currently opens this PDF.", a
 *    "Too long: n/127 bytes." warning past MAX_PDF_PASSWORD_BYTES, the
 *    "Unlock PDF" button (busy label `jobBusyLabel(job.phase,
 *    COPY[mode].running)`: Uploading your file…, Waiting for the worker…,
 *    Unlocking on the worker… while qpdf runs, Downloading the result…;
 *    disabled until a file AND a non-empty password are present), then
 *    "Your PDF is unlocked and ready." and "Download <name>". When no worker
 *    is available the panel shows no uploader and no password field at all.
 *    The Remove control is a <button>, not a link; the run button blocks via
 *    aria-disabled (WorkerRunButton) and shows a spinner for the entire
 *    runSecurityJob call (upload, poll, download), its label following the
 *    phase. The badge reads "Secure
 *    worker" in production ("Local-dev worker" locally).
 *  - options: src/lib/jobs/pdf-security.ts parseUnlockPdfOptions — password
 *    required, non-empty, no control characters, at most
 *    MAX_PDF_PASSWORD_BYTES UTF-8 bytes. Output name: unlockedOutputName →
 *    "<name>-unlocked.pdf".
 *  - engine: src/lib/workers/pdf-security/engine.ts runUnlock — refuses a PDF
 *    that is not encrypted ("This PDF isn't password-protected, so there's
 *    nothing to unlock."), reports a wrong password as "The password is
 *    incorrect, or this PDF cannot be unlocked with it." (non-retryable), and
 *    re-checks the output: a result that is still encrypted fails instead of
 *    being delivered. native.ts runs `qpdf --password=… --decrypt` with the
 *    password passed through an at-file in a per-job temp directory that is
 *    removed on every exit path, never on the command line. That qpdf accepts
 *    the OWNER password as well as the user password for --decrypt is qpdf's
 *    documented behaviour; no pdf.xyz test runs an owner-only file through
 *    runUnlock. No guessing, no recovery. SUPERSEDED, history kept: "qpdf's
 *    exit 2 is read as 'wrong password', so the same message also covers a
 *    file qpdf cannot decrypt with that password for another reason". Exit 2
 *    now triggers a second check with the same password
 *    (`--requires-password`): 0 means wrong-password (OWNER_PASSWORD_REQUIRED
 *    for a file that opens freely), 2 means unreadable (UNREADABLE_MESSAGE),
 *    anything else throws (FAILED_MESSAGE). A file qpdf cannot open at all is
 *    already caught by `requiresPassword` before the decrypt.
 *  - the password also travels in the job request's options, which the Redis
 *    queue keeps in a TTL'd spec record (src/lib/workers/queue/redis.ts) that
 *    the FINALIZE script deletes when the job reaches a terminal state
 *    (redis-scripts.ts; complete, terminal fail, cancel, expire and the
 *    broker's dead-letter path all run FINALIZE). A retryable failure REQUEUES
 *    and keeps the spec, and a job never finalized keeps it until
 *    jobTtlSeconds, which is env-configured with no exported owner — so no
 *    figure is given. The queue's REST base URL may be http: or https:, so
 *    TLS is claimed only for the upload, not for the queue hop. So this page
 *    promises no storage-free password; it states the deletion. NOTE: the privacy page says
 *    the password "sits in that job record for the same ~24 hours"; the code
 *    deletes it at the terminal state, so this page states the shorter,
 *    code-true lifetime and the privacy page is the more cautious surface.
 *  - qpdf exits 2 for ANY error, not only a wrong password, which is why the
 *    decrypt's exit 2 is followed by the second check above. On the decrypt,
 *    exit 3 (warnings, output written) is accepted and the output re-checked;
 *    every other non-zero code throws → FAILED_MESSAGE (retryable).
 *  - the Download button saves bytes the browser already fetched from the
 *    worker (pdf-security-client.ts runSecurityJob → downloadBytes); the
 *    output TTL is the worker-side link, not the button.
 *  - protect-pdf refuses an already-encrypted input with "Unlock it first, then
 *    protect it again." (same engine), and loadPdf() in src/lib/pdf/engine.ts —
 *    used by page numbers, crop, flatten and the other in-browser editors —
 *    refuses encrypted files with "Unlock it first, then try again."
 *  - size cap: the worker-tier ceiling, read through toolFileCeilingMb.
 *  - retention: src/app/privacy/page.tsx (input deleted when the job ends, link
 *    stops after the output TTL, stored copy erased by a daily storage rule).
 */
const unlockTool = getToolBySlug("unlock-pdf");
if (
  !unlockTool ||
  capabilityForMode(unlockTool.processing) !== "secure-worker"
) {
  throw new Error(
    "unlock-pdf content says the file is uploaded to our server, but the tool is not server-side",
  );
}
const ceilingMb = toolFileCeilingMb(unlockTool);
if (ceilingMb === null) {
  throw new Error("unlock-pdf content states a file ceiling it cannot find");
}

const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;
const exampleOutput = unlockedOutputName("statement.pdf");
// The strengths Protect PDF offers, read from the list its chips render.
if (PDF_ENCRYPTION_LEVELS.length === 0) {
  throw new Error(
    "unlock-pdf content names Protect PDF strengths it cannot find",
  );
}
const protectStrengths = PDF_ENCRYPTION_LEVELS.map((l) => l.label).join(" or ");

const content: ToolContent = {
  slug: "unlock-pdf",

  seoTitle: "Unlock PDF — Remove a Known Password from a PDF",

  metaDescription:
    "Remove the password from a PDF you can already open: type it once, qpdf decrypts the file, and you download an unlocked copy. It won't crack unknown passwords.",

  intro: [
    "Unlock PDF takes an encrypted PDF plus the password that opens it and gives you back the same document with the encryption removed, so it opens without a prompt and other tools can work on it. It is for files you are entitled to open and whose password is known to you, such as a statement or a contract a colleague locked before emailing it. It is not a password cracker: if the password you type does not open the file, the job stops and says so.",
    `The decryption is done by qpdf, which rewrites the file without its security settings rather than printing the pages to images, so any text the original had stays selectable and searchable. Before anything is delivered our server checks the result again, and a copy that still reports encryption counts as a failure, not a download.`,
    `This tool runs on a server: your PDF, up to ${ceilingMb} MB, is uploaded over TLS to pdf.xyz's secure server, and the password rides along in the job request, where it waits in the job queue until the job finishes. The input is deleted when the job finishes, the download link stops working after ${linkMinutes} minutes, and the stored copy is erased by a daily storage rule after that.`,
  ],

  useCases: [
    {
      title: "Statements and payslips that ask for a password every time",
      body: "Banks and payroll systems often lock each PDF with a date of birth or account digits. Unlock it once and the copy you keep opens without the code.",
    },
    {
      title: "Changing or replacing a password",
      body: `Protect PDF will not re-encrypt a file that is already locked; it asks you to unlock it first. Remove the old password here, then protect the unlocked copy with a new password and your choice of ${protectStrengths}.`,
    },
    {
      title: "Getting a locked file into the other pdf.xyz tools",
      body: "The in-browser editors, such as Add Page Numbers, Crop PDF and Flatten PDF, stop on an encrypted file with a request to unlock it first. Download the unlocked copy here, then add that file to the editor you wanted.",
    },
    {
      title: "A file that opens but will not let you print or edit",
      body: "Some PDFs need no password to view yet still block printing or copying, because an owner password sets those permissions. qpdf, the engine behind this tool, accepts the owner password for decryption, so typing it here drops the restrictions along with the encryption.",
    },
  ],

  steps: [
    {
      title: "Add the locked PDF",
      body: `Drop one PDF onto the area that reads "Add a locked PDF, or browse"; clicking that area opens a file picker instead. It holds a single file of up to ${ceilingMb} MB, and the Remove button next to the file name clears it so you can pick another. Nothing is sent until you press Unlock PDF, which works once the badge reads Secure server; if no server is available, the panel explains why under that button.`,
    },
    {
      title: "Type the current password",
      body: `Put the password that opens the file into the Current password field; for a file that views without a prompt but is restricted, use its owner password. Dots hide what you type until you press the Show password eye icon at the end of the field. The limit is ${MAX_PDF_PASSWORD_BYTES} bytes, not characters, so accented or non-Latin letters use it up faster; past it, the hint reads "Too long: n/${MAX_PDF_PASSWORD_BYTES} bytes."`,
    },
    {
      title: "Select Unlock PDF",
      body: "Nothing happens when you press it without a file, without a password, or with a password over the limit. Otherwise it shows a spinner for the whole run, and its label follows the job: Uploading your file…, Waiting for our server…, Unlocking on our secure server… while qpdf decrypts, then Downloading the result… as the unlocked copy comes back to your browser.",
    },
    {
      title: "Download the unlocked copy",
      body: `When "Your PDF is unlocked and ready." appears, the file has already been fetched to your browser, and the button beneath it, labelled Download ${exampleOutput} for a file called statement.pdf, saves it. Our server's own link to that output expires after ${linkMinutes} minutes.`,
    },
  ],

  faqs: [
    {
      q: "Can Unlock PDF remove a password I have forgotten?",
      a: "No. The tool only decrypts a file with a password that the file itself accepts. It does not guess, test lists of passwords or bypass encryption, so a lost password cannot be recovered here. Ask whoever sent the file for the password or an unlocked copy.",
    },
    {
      q: "Which password do I need to enter?",
      a: "The decryption is done by qpdf, which accepts either of a PDF's two passwords: the user password asked for when the file is opened, or the owner password that governs printing and editing. Because Unlock PDF stays inactive while Current password is blank, a PDF with no open password but locked-down permissions can only be unlocked here with its owner password.",
    },
    {
      q: "Why did I get 'The password is incorrect, or this PDF cannot be unlocked with it'?",
      a: "qpdf could not decrypt the file with that password, and a second check with the same password confirmed the file needs a different one. Usually that is a typo, so reveal the field and check capitals, spaces and keyboard layout. Other problems get their own messages: a damaged file, or encryption qpdf cannot open, is reported as such; a PDF that opens without a password but locks printing or editing says it needs its owner password; one with no encryption says there is nothing to unlock; input that is not a PDF could not be read as one; and any other engine failure says the file could not be processed and that no output was produced.",
    },
    {
      q: "Is my file and password uploaded?",
      a: `Yes. Decryption needs the native qpdf engine, so the PDF is uploaded over TLS to pdf.xyz's secure server and the password is sent in the job request. The password is kept in the queue's record of the job while it waits and runs, including any automatic retry; that record is deleted when the job finishes, and one for a job that never finishes expires on the queue's own timer. qpdf receives it from a one-line-per-argument file in a scratch folder rather than on the process command line, and the folder is deleted when that qpdf call returns. The input PDF is deleted when the job finishes, the download link expires after ${linkMinutes} minutes, and the stored copy is erased by a daily storage rule after that.`,
    },
    {
      q: "Does unlocking change anything else in the document?",
      a: `The only intended change is the missing encryption; nothing is re-rendered, so no page is flattened into a picture. Two visible differences remain: the saved copy is renamed from the original (statement.pdf comes back as ${exampleOutput}), and because qpdf writes the file out afresh, its byte size will not necessarily match the original.`,
    },
    {
      q: "How large a PDF can I unlock?",
      a: `Up to ${ceilingMb} MB, one file per job.`,
    },
  ],

  relatedGuides: ["how-to-password-protect-a-pdf"],
};

export default content;
