import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  MAX_FIELD_LABEL_CHARS,
  MAX_REQUEST_FIELDS,
  MAX_REQUEST_MESSAGE_CHARS,
  MAX_REQUEST_SIGNERS,
  MAX_SIGNER_EMAIL_CHARS,
  MAX_SIGNER_NAME_CHARS,
} from "@/lib/jobs/request-signatures";

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
 *    to the LAST page; "Request title (optional)"; "Message to signers
 *    (optional)", a textarea capped at MAX_REQUEST_MESSAGE_CHARS with the
 *    hint that it goes into README.txt and manifest.json, nobody is emailed
 *    and line breaks become spaces; the checkbox "Add a date field next to
 *    each signature" (ticked by default). Signature page and the checkbox set
 *    the STARTING layout only: once the reader moves or adds a box both are
 *    replaced by a line saying they no longer apply and a Start over button.
 *    With a complete signer row and an unlocked read PDF the placement editor
 *    (request-field-editor.tsx, loaded with the PDF read) draws the page in
 *    its displayed orientation with every box on it, and lists every box with
 *    its signer, page, a Label input (MAX_FIELD_LABEL_CHARS), Show and
 *    Remove; the
 *    "Prepare signature request" button, disabled unless canRun (a file, a
 *    usable signer row, not reading, not encrypted, and no layout or size
 *    problem — see layout below), whose busy label is
 *    jobBusyLabel(job.phase, "Preparing request…") — the upload, queued and
 *    download stages have their own labels; then "Download <filename>".
 *    (Until 2026-10-07 this said the page input had no upper bound and the
 *    button read "Preparing request…" throughout.)
 *  - download: runSecurityJob (src/lib/workers/pdf-security-client.ts) fetches
 *    the artifact bytes BEFORE the result card renders; the Download button
 *    calls downloadBytes on bytes already in the page. No link is shown, so the
 *    output TTL does not bound the button — closing the tab does.
 *  - rows: CHANGED 2026-11-06 (audit #18). Until then cleanSigners dropped any
 *    row without a name AND an EMAIL_SHAPE email, without a message. Now each
 *    non-blank row is checked by signerRowProblem (the worker's own signer
 *    parse): an invalid row shows its reason once left, sets aria-invalid,
 *    and blocks Prepare; a wholly blank row is ignored. Name, email and title
 *    inputs carry the worker's maxLength (MAX_SIGNER_NAME_CHARS,
 *    MAX_SIGNER_EMAIL_CHARS, MAX_REQUEST_TITLE_CHARS).
 *  - layout: CHANGED 2026-11-17 (audit #21). The starting layout is still
 *    signatureBlockFields(): one signature box per signer at x 8%, 40% of the
 *    page wide, rows starting 6% above the bottom edge and stacking up
 *    (signer 1 lowest), row height min(11%, 60% / signers); the optional date
 *    box sits at x 56%. Until the reader touches it the request carries exactly
 *    that. Then the placement editor edits it: drag a box to move it, drag its
 *    corner to resize it, arrow keys 1 pt (Shift 10 pt), Delete removes, one
 *    Undo for Remove and Start over; Add a box adds a Signature, Initials, Date,
 *    Name (a text box labelled "Name") or Text box for the chosen signer on the
 *    page shown, up to MAX_REQUEST_FIELDS; the box list moves a box to another
 *    page or gives it to another signer; "Repeat a box on other pages"
 *    (2026-11-22, audit request-signatures#3) copies one box onto All pages,
 *    All but the last page, or Some pages (a From/To range) in one press,
 *    each copy its own box for the same signer (repeatField; the worker names
 *    each its own field, Signer<N>-Initials-<k>). There is no company-stamp
 *    box type: the worker accepts signature, initials, date and text only.
 *    Boxes are owned by a signer row's
 *    stable id: a box whose row is blank, or a signer left with no box, blocks
 *    Prepare in words. Geometry is @/lib/signatures/request-layout (min 24 x 12
 *    pt, clamped to the page, 4 decimals). A label goes to manifest.json, to
 *    README.txt under its signer ("     <name> label: <label>") and, since
 *    2026-11-17, into the PDF as the field's /TU (UTF-16BE text string, on the
 *    field and its widget, because pdf.js reads only the widget); the field
 *    name is still Signer<N>-<Type>-<k>. Until 2026-11-17 this said "A label
 *    goes to manifest.json only". Since 2026-11-18 the FAQ states the tooltip
 *    plainly ("Each label is also the tooltip of its box in prepared.pdf, ...")
 *    because the worker proves the /TU at start-up and reports it on its
 *    heartbeat as `requestSignatureLabels`
 *    (src/lib/workers/request-signatures/labels-capability.ts;
 *    claims-vs-capability.test.ts licenses the plain sentence only while the
 *    heartbeat can report that key, and capability-hedges.test.ts refuses a
 *    conditional one). Until 2026-11-18 the answer said instead: "If
 *    README.txt lists your labels under each signer, prepared.pdf carries
 *    them too, as each box's tooltip, which many PDF viewers, Firefox among
 *    them, show when you point at the box." It conditioned the tooltip on the
 *    README list because both tiers restart at once and an older worker
 *    writes neither, and no worker could say which it was. The message,
 *    title and labels have C0 controls turned into spaces by the client's
 *    options builder (requestSignaturesJobOptions), and the panel measures that
 *    exact object against JOB_LIMITS.maxOptionsBytes (8 KB) and blocks Prepare
 *    over it. Until 2026-11-17 this bullet said "There is no drag or manual
 *    placement." native.ts resolves fractions against the page's VISIBLE
 *    frame (visiblePageFrame: the CropBox turned by /Rotate) and maps each box
 *    back through placeVisibleRect, turned to read upright
 *    (native.integration.test.ts reads it through pdfjs, for the starting
 *    layout and for boxes the editor makes). Until 2026-10-07 this bullet said
 *    it ignored /Rotate and the CropBox.
 *  - engine: src/lib/workers/request-signatures/{engine,native}.ts — every box
 *    is a plain AcroForm TEXT field named Signer<N>-Signature-<k> /
 *    Signer<N>-Initials-<k> / Signer<N>-Date-<k> / Signer<N>-Text-<k>;
 *    existing pages and fields are kept. A field on a page
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

  metaDescription: `Place signature, initials, date and text boxes for up to ${maxSigners} signers on any page of a PDF. You get a ZIP with the file and a manifest; no email is sent.`,

  intro: [
    `Request Signatures gets a PDF ready for other people to sign. You list up to ${maxSigners} signers by name and email and say whether they sign one after another or all at once. Each signer starts with a signature box near the foot of the page you pick, with a date box beside it unless you untick that option. You can then drag any box to another spot, resize it, move it to another page or remove it, and add more boxes for a signature, initials, a date, a name or other text, up to ${MAX_REQUEST_FIELDS} in all.`,
    `What you download is a ZIP, not a signed document. Inside are prepared.pdf with the new fields, manifest.json recording every signer, field and the chosen order, audit-trail.json with the original file's SHA-256 fingerprint and one "request.prepared" event, and a README.txt. Nobody is emailed and the order is recorded, not enforced: you send prepared.pdf yourself, and each signer types into their own boxes.`,
    `The fields are added by pdf.xyz's secure server, not in your browser, so your PDF (a single upload, capped at ${ceilingMb} MB) and the signer names and addresses are sent over TLS to that server. It deletes the PDF you uploaded once the job ends. The ZIP, which carries those names and addresses, can be fetched for ${linkMinutes} minutes before the link to it is refused, and a daily storage rule later erases the stored ZIP.`,
  ],

  useCases: [
    {
      title: "A contract two parties sign one after the other",
      body: "Leave Signing order on Sequential and point Signature page at the closing page. README.txt lists signers in the order entered, so whoever forwards the file knows who goes first.",
    },
    {
      title: "A resolution or consent form many people sign",
      body: `Add up to ${maxSigners} signers and choose Parallel. The starting block keeps one row height for a short list and shrinks as more names are added, so it fits on the chosen page; drag boxes apart, or move some to another page, if you want more room.`,
    },
    {
      title: "Initials on every page",
      body: `Pick a signer under Add a box and press Initials, then under Repeat a box on other pages choose that box and All but the last page, and press Repeat: each page of a lease gets its own initials box, and the signature box stays on the last page. A request holds up to ${MAX_REQUEST_FIELDS} boxes in all, every signer's counted, so a long lease with several signers can run out: Repeat stops at the limit, so check that the later pages got their box. Previous page and Next page turn the preview.`,
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
      body: `The form is there from the start, and its Prepare button works only when the status check finds our server's storage, queue and daemon ready. If it finds them not ready, you see a one-line note (a Why? button under it gives the reason), Try again, and a button labelled "Notify me when this ships", which records only the tool's name and asks for no contact details; if the check does not answer at all, a Check again button retries it. Then drag a single PDF, no larger than ${ceilingMb} MB, onto the dashed area headed "Add your PDF, or" and ending in a browse link, or click that link; Remove drops the chosen file.`,
    },
    {
      title: "List the signers",
      body: `Under Signers, enter a Full name and email address for each person. Add signer adds a row, up to ${maxSigners}, and the bin icon removes one while more than one row remains. A row with anything in it needs both a name, up to ${MAX_SIGNER_NAME_CHARS} characters, and a valid-looking email, up to ${MAX_SIGNER_EMAIL_CHARS}: until it has them, the row says what is missing once you leave it and Prepare signature request stays disabled, so no signer is left out of the package. A row left wholly empty is ignored.`,
    },
    {
      title: "Set the order and place the boxes",
      body: 'Choose "Sequential — one at a time" or "Parallel — everyone at once" under Signing order. Signature page and "Add a date field next to each signature" set where the boxes start. On the preview, drag a box to move it or drag its corner to resize it, or select it and use the arrow keys (hold Shift for bigger steps) and Delete. Under Add a box, pick the signer and press Signature, Initials, Date, Name or Text to add one to the page shown. To put the same box on many pages, use Repeat a box on other pages. Fill Request title (optional) and Message to signers (optional) if the README and manifest should carry them.',
    },
    {
      title: "Prepare and download",
      body: 'Press Prepare signature request. It stays disabled until a PDF and one complete signer row exist, while any row is incomplete, while the PDF is still being read ("Reading…" beside its name), for an encrypted PDF, while a box belongs to a signer row that is empty or a signer has no box, and while the request is too long to send; the reason is shown above it. Once pressed, its label follows the job: "Uploading your file…", then "Waiting for our server…" while it is queued, "Preparing request…" while our server adds the fields, and "Downloading the result…" as the package comes back. The Download button for the file ending in -signature-request.zip then saves a copy the page already holds; there is no link to come back to, so keep the tab open until the ZIP is saved.',
    },
  ],

  faqs: [
    {
      q: "Does pdf.xyz send the document to my signers?",
      a: `No. There is no email, reminder or status tracking. The names and addresses you type, and Message to signers if you write one (up to ${MAX_REQUEST_MESSAGE_CHARS.toLocaleString("en-US")} characters; line breaks become spaces), are copied into manifest.json and README.txt; unzip the package and send prepared.pdf however you normally would.`,
    },
    {
      q: "Does this create a certified or digital signature?",
      a: "No. Each box is an ordinary text form field that the signer types into. There is no certificate, identity check or tamper seal, and the package is always marked as prepared, never as signed.",
    },
    {
      q: "How do signers fill in their boxes?",
      a: `Fields are named after their owner and type, such as Signer1-Signature-1, Signer1-Initials-1, Signer1-Date-1 and Signer1-Text-1, and the names stay that way. A label you give a box, up to ${MAX_FIELD_LABEL_CHARS} characters, is recorded in manifest.json. Each label is also the tooltip of its box in prepared.pdf, which many PDF viewers show when you point at the box. The date box is blank text, not a date stamp. Fill Forms on pdf.xyz types into them in the browser without uploading, but refuses letters outside the standard PDF fonts' Western European set, and its Flatten after filling option bakes every field into the page, so a signer who ticks it also wipes out the still-empty boxes of every other signer.`,
    },
    {
      q: "Can I move the boxes or add more?",
      a: `Yes. Drag a box on the preview, or select it and use the arrow keys, to move it; drag its corner to resize it; press Delete to remove it. Add a box adds a signature, initials, date, name or text box for the signer you pick, on the page shown, up to ${MAX_REQUEST_FIELDS} boxes in one request. Positions are measured on the page as it is displayed, so any rotation or crop the page carries is taken into account. The boxes are outlines laid over whatever is printed there, so put them on blank space.`,
    },
    {
      q: "What does Sequential change?",
      a: 'It is recorded in manifest.json and printed as "Routing: sequential" in the README. pdf.xyz does not route the file, so the order holds only if you pass it from one signer to the next yourself.',
    },
    {
      q: "Why was my request refused?",
      a: `Once your PDF has been read, the Signature page box shows its page count, accepts only pages the PDF has and starts on the last one; if a page past the end still reaches our server, the error names both your page and the PDF's page count. An encrypted PDF is stopped as soon as you add it, before anything is uploaded, with a message that says which lock it has, or, when the check cannot tell, asks for whichever password applies: one that needs a password to open is called password-protected, and one that opens without a password but carries its author's editing restrictions is told so, since fields cannot be added to either, and Prepare signature request stays disabled. A damaged PDF is refused by our server as a file that couldn't be read as a PDF. Bytes without a PDF header never reach this step; a basic soundness check rejects them first. For a locked file, remove the lock with Unlock PDF (a separate upload to the same server), using the password that opens it or, for a restricted file, its owner (permissions) password, and prepare the unlocked copy.`,
    },
  ],

  relatedGuides: ["how-to-sign-a-pdf", "how-to-fill-out-a-pdf-form"],
};

export default content;
