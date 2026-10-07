import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { MAX_REQUEST_SIGNERS } from "@/lib/jobs/request-signatures";

/*
 * Every behavioral claim below was read from the code on 2026-09-27:
 *  - panel: src/components/tools/request-signatures-worker-panel.tsx — the
 *    builder only renders when canRunRequestSignatures(status) is true
 *    (storage + queue ready and a drainable daemon); otherwise the status
 *    detail and a "Notify me when this ships" button (notify-me.tsx: posts
 *    the slug to /api/interest, collects no address, so it cannot notify
 *    anyone). A single-PDF dropzone reading "Add your PDF,
 *    or browse" with a "Remove" link; the "Signers" list with "Full name" /
 *    email inputs, "Add signer" (capped at MAX_REQUEST_SIGNERS) and a trash
 *    button per row; "Signing order" select ("Sequential — one at a time" /
 *    "Parallel — everyone at once"); a "Signature page" number input — once
 *    the picked PDF has been read in the browser (readPdfFrames, nothing
 *    uploaded; "Reading…" beside the file name meanwhile) it is labelled
 *    "Signature page (of N)", clamped to 1..N by clampSignaturePage and set
 *    to the LAST page; "Request title (optional)"; the checkbox "Add a date
 *    field next to each signature" (ticked by default); with a complete
 *    signer row and an unlocked read PDF, SignaturePagePreview draws the
 *    page in its displayed orientation with each planned field on it; the
 *    "Prepare signature request" button, disabled unless canRun (a file, a
 *    usable signer row, not reading, not encrypted), whose busy label is
 *    jobBusyLabel(job.phase, "Preparing request…") — the upload, queued and
 *    download stages have their own labels; then "Download <filename>".
 *    (Until 2026-10-07 this said the page input had no upper bound and the
 *    button read "Preparing request…" throughout.)
 *  - download: runSecurityJob (src/lib/workers/pdf-security-client.ts) fetches
 *    the artifact bytes BEFORE the result card renders; the Download button
 *    calls downloadBytes on bytes already in the page. No link is shown, so the
 *    output TTL does not bound the button — closing the tab does.
 *  - rows: cleanSigners keeps a row only when it has a name AND an email that
 *    matches EMAIL_SHAPE; other rows are dropped without a message.
 *  - layout: buildFields() puts one signature box per signer at x 8%, 40% of
 *    the page wide, rows starting 6% above the bottom edge and stacking up
 *    (signer 1 lowest), row height min(11%, 60% / signers) — constant for a
 *    short list, shrinking once the list is long; the optional date box sits at
 *    x 56%. There is no drag or manual placement. native.ts resolves fractions
 *    against the page's VISIBLE frame (visiblePageFrame: the CropBox turned by
 *    /Rotate) and maps each box back through placeVisibleRect, turned to read
 *    upright (native.integration.test.ts reads it through pdfjs). Until
 *    2026-10-07 this bullet said it ignored /Rotate and the CropBox.
 *  - engine: src/lib/workers/request-signatures/{engine,native}.ts — every box
 *    is a plain AcroForm TEXT field named Signer<N>-Signature-<k> /
 *    Signer<N>-Date-<k>; existing pages and fields are kept. A field on a page
 *    the PDF does not have fails as invalid_request naming both numbers; an
 *    unreadable or encrypted PDF fails as invalid_request in the loader's own
 *    words (AMENDED 2026-10-06: this said the engine's catch swallowed them
 *    into "could not be prepared"; engine.ts keeps the loader's message since
 *    the wave1 merge, and native.integration.test.ts runs it). In the browser
 *    an encrypted PDF never gets that far: the panel stops it when it is
 *    picked, in the words of the pdf.js probe's verdict
 *    (request-signatures-worker-panel.test.tsx). AMENDED 2026-10-08: that held
 *    only for classic-xref files. When the page tree sits in an encrypted
 *    object stream (PDF 1.5+, how Acrobat and Word save), readPdfFrames
 *    returns null, the pick showed nothing and stayed runnable, and the file
 *    was uploaded and refused by the worker. The panel now asks pdf.js
 *    (classifyPdfAccess) about any pick pdf-lib cannot read, and blocks one
 *    whose trailer names /Encrypt even when pdf.js cannot decrypt it; the
 *    panel test runs object-stream fixtures of each lock. A file with no %PDF- envelope never reaches the engine:
 *    the executor's soundness gate (src/lib/workers/soundness, wired by
 *    daemon/runtime.ts) fails it with UNSOUND_INPUT_ERROR. Output is a ZIP: prepared.pdf, manifest.json (status
 *    always "prepared", SHA-256 of the uploaded file, signers with a 32-hex
 *    reference token derived from the hash + order + email, fields, routing,
 *    delivery "not_delivered"), audit-trail.json (documentSha256 + one
 *    "request.prepared" event), README.txt ("Routing: <mode>", "Signers (in
 *    order)"). The panel never sends `deliver`, and native.ts wires no
 *    provider, so nothing is emailed and routing is recorded, not enforced.
 *  - output name: signatureRequestOutputName → "<stem>-signature-request.zip".
 *  - retention: src/app/privacy/page.tsx (input deleted when the job ends,
 *    link stops after the output TTL, stored copy erased by a daily rule).
 *  - size cap: worker tier, read through toolFileCeilingMb.
 *
 * Probed 2026-09-27 (tsx, generated 2-page PDF, native deps): the ZIP held the
 * four files above; inspectFormFields saw four "text" fields named as stated;
 * applyFormValues filled Signer1-Signature-1 / Signer1-Date-1 and, with
 * flatten, left ZERO fields — signer 2's empty boxes were baked away too. Page
 * 5 of 2 returned the invalid_request message; an encrypted stub returned the
 * generic "could not be prepared" message (since superseded, see above).
 */
const requestTool = getToolBySlug("request-signatures");
const ceilingMb = requestTool ? toolFileCeilingMb(requestTool) : null;
if (ceilingMb === null) {
  throw new Error(
    "request-signatures content states a file ceiling it cannot find",
  );
}

const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;
const maxSigners = MAX_REQUEST_SIGNERS;

const content: ToolContent = {
  slug: "request-signatures",

  seoTitle: "Request Signatures — Prepare a PDF for Signers",

  metaDescription: `Add a named signature box, and optionally a date box, for each of up to ${maxSigners} signers on one PDF. You get a ZIP with the file and a manifest; no email is sent.`,

  intro: [
    `Request Signatures gets a PDF ready for other people to sign. You list up to ${maxSigners} signers by name and email, pick the page for the signature block, and say whether they sign one after another or all at once. The worker stacks one fillable signature box per signer near the bottom of that page, each with a date box beside it unless you untick that option.`,
    `What you download is a ZIP, not a signed document. Inside are prepared.pdf with the new fields, manifest.json recording every signer, field and the chosen order, audit-trail.json with the original file's SHA-256 fingerprint and one "request.prepared" event, and a README.txt. Nobody is emailed and the order is recorded, not enforced: you send prepared.pdf yourself, and each signer types into their own boxes.`,
    `The fields are added by pdf.xyz's secure worker, not in your browser, so your PDF (a single upload, capped at ${ceilingMb} MB) and the signer names and addresses are sent over TLS to that worker. It deletes the PDF you uploaded once the job ends. The ZIP, which carries those names and addresses, can be fetched for ${linkMinutes} minutes before the link to it is refused, and a daily storage rule later erases the stored ZIP.`,
  ],

  useCases: [
    {
      title: "A contract two parties sign one after the other",
      body: "Leave Signing order on Sequential and point Signature page at the closing page. README.txt lists signers in the order entered, so whoever forwards the file knows who goes first.",
    },
    {
      title: "A resolution or consent form many people sign",
      body: `Add up to ${maxSigners} signers and choose Parallel. Rows keep one height for a short list and shrink once more names are added, so the whole block still fits on the chosen page.`,
    },
    {
      title: "A flat PDF that has nowhere to type",
      body: "An exported or scanned agreement with no form fields gains named boxes, so a signer can type a name and date instead of printing and scanning.",
    },
    {
      title: "Recording which version went out",
      body: "manifest.json and README.txt both carry the SHA-256 of the file you uploaded. Hash your original later and compare, to confirm it is the document the request was prepared from; prepared.pdf itself will not match, because the boxes changed it.",
    },
  ],

  steps: [
    {
      title: "Add your PDF",
      body: `The form shows only when the status check finds the worker's storage, queue and daemon ready. If it finds them not ready, you see the reason plus a button labelled "Notify me when this ships", which records only the tool's name and asks for no contact details; if the check does not answer at all, a Check again button retries it. Then drag a single PDF, no larger than ${ceilingMb} MB, onto the dashed area headed "Add your PDF, or" and ending in a browse link, or click that link; Remove drops the chosen file.`,
    },
    {
      title: "List the signers",
      body: `Under Signers, enter a Full name and email address for each person. Add signer adds a row, up to ${maxSigners}, and the bin icon removes one while more than one row remains. A row missing its name or a valid-looking email is left out of the package without a warning.`,
    },
    {
      title: "Set the order and the page",
      body: 'Choose "Sequential — one at a time" or "Parallel — everyone at once" under Signing order, enter the Signature page number, and fill Request title (optional) if the README and manifest should name the agreement. Untick "Add a date field next to each signature" for signature boxes only.',
    },
    {
      title: "Prepare and download",
      body: 'Press Prepare signature request. It stays disabled until a PDF and one complete signer row exist, while the PDF is still being read ("Reading…" beside its name), and for an encrypted PDF. Once pressed, its label follows the job: "Uploading your file…", then "Waiting for the worker…" while it is queued, "Preparing request…" while the worker adds the fields, and "Downloading the result…" as the package comes back. The Download button for the file ending in -signature-request.zip then saves a copy the page already holds; there is no link to come back to, so keep the tab open until the ZIP is saved.',
    },
  ],

  faqs: [
    {
      q: "Does pdf.xyz send the document to my signers?",
      a: "No. There is no email, reminder or status tracking. The names and addresses you type are copied into manifest.json and README.txt; unzip the package and send prepared.pdf however you normally would.",
    },
    {
      q: "Does this create a certified or digital signature?",
      a: "No. Each box is an ordinary text form field that the signer types into. There is no certificate, identity check or tamper seal, and the package is always marked as prepared, never as signed.",
    },
    {
      q: "How do signers fill in their boxes?",
      a: "Fields are named after their owner, such as Signer1-Signature-1 and Signer1-Date-1; the date box is blank text, not a date stamp. Fill Forms on pdf.xyz types into them in the browser without uploading, but refuses letters outside the standard PDF fonts' Western European set, and its Flatten after filling option bakes every field into the page, so a signer who ticks it also wipes out the still-empty boxes of every other signer.",
    },
    {
      q: "Can I drag the boxes somewhere else?",
      a: "No. They are placed automatically near the left edge, just above the bottom of the chosen page as it is displayed, so any rotation or crop the page carries is taken into account. Signer 1 is lowest, and the block climbs higher with each extra signer. Once a signer row is complete, the panel previews that page with each signer's boxes drawn where they will land. The boxes are outlines laid over whatever is printed there, so pick a page with blank space at the foot.",
    },
    {
      q: "What does Sequential change?",
      a: 'It is recorded in manifest.json and printed as "Routing: sequential" in the README. pdf.xyz does not route the file, so the order holds only if you pass it from one signer to the next yourself.',
    },
    {
      q: "Why was my request refused?",
      a: `Once your PDF has been read, the Signature page box shows its page count, accepts only pages the PDF has and starts on the last one; if a page past the end still reaches the worker, the error names both your page and the PDF's page count. An encrypted PDF is stopped as soon as you add it, before anything is uploaded, with a message that says which lock it has, or, when the check cannot tell, asks for whichever password applies: one that needs a password to open is called password-protected, and one that opens without a password but carries its author's editing restrictions is told so, since fields cannot be added to either, and Prepare signature request stays disabled. A damaged PDF is refused by the worker as a file that couldn't be read as a PDF. Bytes without a PDF header never reach this step; a basic soundness check rejects them first. For a locked file, remove the lock with Unlock PDF (a separate upload to the same worker), using the password that opens it or, for a restricted file, its owner (permissions) password, and prepare the unlocked copy.`,
    },
  ],

  relatedGuides: ["how-to-sign-a-pdf", "how-to-fill-out-a-pdf-form"],
};

export default content;
