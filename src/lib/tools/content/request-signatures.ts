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
 *    "Parallel — everyone at once"); a "Signature page" number input starting
 *    at 1 with no upper bound; "Request title (optional)"; the checkbox "Add a
 *    date field next to each signature" (ticked by default); the "Prepare
 *    signature request" button ("Preparing request…" while busy, disabled
 *    until a file and at least one usable signer row exist); then
 *    "Download <filename>".
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
 *    against page.getSize() and ignores /Rotate and the CropBox.
 *  - engine: src/lib/workers/request-signatures/{engine,native}.ts — every box
 *    is a plain AcroForm TEXT field named Signer<N>-Signature-<k> /
 *    Signer<N>-Date-<k>; existing pages and fields are kept. A field on a page
 *    the PDF does not have fails as invalid_request naming both numbers; an
 *    unreadable or encrypted PDF fails as "The PDF could not be prepared for a
 *    signature request." (loadPdf's "Unlock it first" is swallowed by the
 *    engine's catch). A file with no %PDF- envelope never reaches the engine:
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
 * generic "could not be prepared" message.
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
      body: `The form shows only when the status check finds the worker's storage, queue and daemon ready; if not, you see the reason plus a button labelled "Notify me when this ships", which records only the tool's name and asks for no contact details. Then drag a single PDF, no larger than ${ceilingMb} MB, onto the dashed area headed "Add your PDF, or" and ending in a browse link, or click that link; Remove drops the chosen file.`,
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
      body: 'Press Prepare signature request, which stays disabled until a PDF and one complete signer row exist and reads "Preparing request…" while it works. The Download button for the file ending in -signature-request.zip then saves a copy the page already holds; there is no link to come back to, so keep the tab open until the ZIP is saved.',
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
      a: "No. They are placed automatically near the left edge, just above the bottom of the chosen page, signer 1 lowest. The block climbs higher with each extra signer, positions ignore any rotation or crop the page carries, and the boxes sit on top of whatever is printed there, so pick an upright page with blank space at the foot.",
    },
    {
      q: "What does Sequential change?",
      a: 'It is recorded in manifest.json and printed as "Routing: sequential" in the README. pdf.xyz does not route the file, so the order holds only if you pass it from one signer to the next yourself.',
    },
    {
      q: "Why was my request refused?",
      a: `A Signature page past the last page stops the job, and the error names both your page and the PDF's page count. A password-protected or damaged PDF ends with the general "could not be prepared for a signature request" error, which does not say which of the two it was. Bytes without a PDF header never reach this step; a basic soundness check rejects them first. For a locked file, strip the password with Unlock PDF (a separate upload to the same worker) and prepare the unlocked copy.`,
    },
  ],

  relatedGuides: ["how-to-sign-a-pdf", "how-to-fill-out-a-pdf-form"],
};

export default content;
