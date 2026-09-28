import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  DEFAULT_SIGNATURE_WIDTH,
  MAX_SIGNATURE_WIDTH,
  MIN_SIGNATURE_WIDTH,
} from "@/lib/pdf/signature";
import { STAMP_POSITIONS } from "@/lib/pdf/stamp";
import { SUPPORTED_SCRIPTS, UNSUPPORTED_SCRIPTS } from "@/lib/pdf/font-packs";

/*
 * Every behavioral claim below was read from, or probed against, the code:
 *  - runner: src/components/tools/runner/sign-runner.tsx — the "Signature"
 *    section with Draw / Type / Upload (Type is the default), the "Your
 *    signature" text box, Style Script / Print, a preview drawn with the
 *    browser's own serif-italic / sans fonts (not the embedded face), the
 *    Placement section (Position grid, Page, Size, Margin), the "Sign PDF"
 *    button disabled until a signature exists, "PDF signed" result with
 *    "Download signed PDF" and "Start over"; the upload dropzone accepts
 *    image/png and image/jpeg and converts through a canvas, locally.
 *  - signature-pad.tsx: pointer events with touch-none (mouse, pen, finger),
 *    transparent canvas, a "Clear" chip.
 *  - engine: signPdf() in src/lib/pdf/signature.ts draws onto ONE page of the
 *    loaded document and saves it with pdf-lib, which rewrites the whole file.
 *    Probed 2026-09-27 (scratch make.mts / probe.mts, pdf-lib fixture, pypdf
 *    for encryption): the input bytes are NOT a prefix of the output, so an
 *    existing certificate signature's byte range no longer matches (no
 *    signature-validating viewer was run, hence "expect" in the FAQ). Typed
 *    signature on page 2 of a three-page file kept 3 pages, the text field,
 *    /Outlines, title and author, but Producer became pdf-lib's and Creator
 *    "pdf.xyz" (stampProducer + save's updateMetadata), so NOT "only the chosen
 *    page changes". Hebrew AND Arabic typed names refused by name, reason
 *    "written right to left". Permissions-only RC4 encryption (opens with an
 *    empty password) and open-password encryption were BOTH refused at open by
 *    getPageRotations (use-single-pdf) with "Unlock it first".
 *  - Unlock PDF requires a password (unlock-pdf content: "The field cannot be
 *    left empty"), so a permissions-only file needs its owner password.
 *  - drawn signatures: signature-pad exports the WHOLE canvas uncropped, so Size
 *    measures the pad, blank space included.
 *  - placement ignores /Rotate: placeSignatureBox works in the unrotated
 *    media box (unlike stamp.ts placeStamp), so a rotated page moves the
 *    corner and turns the text.
 *  - typed size: fontSizeForWidth clamps the letter size, so a short name
 *    can come out narrower than the Size value.
 *  - fonts: embedDrawingFont uses Times-Italic / Helvetica for WinAnsi text
 *    (nothing downloaded) and ONE upright Noto Regular for anything else,
 *    whatever the style, fetched from fontPackUrl() — /fonts/<version>/<file>
 *    on our own origin; the URL carries no typed text.
 *  - encrypted input: loadPdf() refuses with "Unlock it first", at file open.
 *  - size cap: the sign runner's own gate, read through toolFileCeilingMb.
 */
const signTool = getToolBySlug("sign-pdf");
const ceilingMb = signTool ? toolFileCeilingMb(signTool) : null;
if (ceilingMb === null) {
  throw new Error("sign-pdf content states a file ceiling it cannot find");
}

const anchorCount = STAMP_POSITIONS.length;
const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;

const list = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(items);

/** Scripts a typed name can be written in beyond Latin, from the shipped packs. */
const otherScripts = list(SUPPORTED_SCRIPTS.filter((s) => s !== "Latin"));

/** Scripts refused because the layout runs left to right — named by the refusal data. */
const rtlScripts = list(
  UNSUPPORTED_SCRIPTS.filter((s) => /right to left/.test(s.reason)).map(
    (s) => s.name,
  ),
);

const content: ToolContent = {
  slug: "sign-pdf",

  seoTitle: "Sign PDF Online: Draw, Type or Add a Signature",

  metaDescription:
    "Sign a PDF in your browser: draw or type your signature, or add an image of it, then pin it to a page's corner, edge or center. Nothing is uploaded to pdf.xyz.",

  intro: [
    `Sign PDF puts your signature on a document you already have, such as an offer letter, a lease or a consent form. Draw it with a mouse, pen or fingertip, type your name in the Script (serif italic) or Print style, or pick a PNG or JPEG of the signature you already use under Upload; the image is read on your device. Then pick the page and one of ${anchorCount} anchor points (corners, edge midpoints or center) and tune Size and Margin until it sits on the line.`,
    `Everything runs online in this browser tab: the PDF, up to ${ceilingMb} MB, and your signature are processed on your device, and neither is uploaded. Ink is added to the chosen page only; the other pages, fillable fields, bookmarks, title and author carry over, while the file's Producer and Creator entries are rewritten. A name with letters beyond the Western European alphabet (a Polish Ł counts) is drawn in a Noto font the browser fetches from pdf.xyz by file name, a request that carries none of your text.`,
    "The result is a visual electronic signature: no certificate, no PKI, no tamper evidence. The FAQ below says what that means if someone asks how you signed.",
  ],

  useCases: [
    {
      title: "An emailed contract with one signature line",
      body: "Set Page to the one with the line, pick a bottom corner, and raise Margin until the signature clears the footer. No printer or scanner needed.",
    },
    {
      title: "Reusing the signature you keep on file",
      body: "Under Upload, choose a PNG of your scanned signature with a transparent background, and the page shows through around the ink instead of a rectangle of paper.",
    },
    {
      title: "A form that also needs your signature",
      body: "Fill the fields in Fill Forms with Flatten after filling unticked, then sign that copy here. The fields stay editable, so a typo does not mean starting over.",
    },
    {
      title: "A name that is not written in Latin letters",
      body: `Type mode draws names in ${otherScripts} as well as Latin. Those scripts all use one upright Noto face whichever style you pick, because Script and Print only change Western European lettering. ${rtlScripts} are stopped with an explanation instead of being drawn backwards, since every line is laid out left to right.`,
    },
  ],

  steps: [
    {
      title: "Open the document",
      body: "Drop one PDF in the box or browse for it; each run signs a single file. A password-protected PDF is refused as soon as it is read, before any signing controls appear.",
    },
    {
      title: "Create the signature",
      body: "The Signature section opens on Type: write your name in the Your signature box and pick Script or Print. The preview uses your browser's fonts, so it only approximates the final lettering. Draw gives a pad with a Clear chip, and the third tab takes a PNG or JPEG of your signature from your device.",
    },
    {
      title: "Place it",
      body: `Under Placement, click one of the ${anchorCount} squares in the Position grid, set Page, then drag Size (${MIN_SIGNATURE_WIDTH}–${MAX_SIGNATURE_WIDTH} pt wide, starting at ${DEFAULT_SIGNATURE_WIDTH}) and Margin, the gap from the page edges.`,
    },
    {
      title: "Sign and save",
      body: "Sign PDF stays disabled until a signature exists. The PDF signed panel then names the signed page and the new file size, and Download signed PDF saves it with -signed added to your file name.",
    },
  ],

  faqs: [
    {
      q: "Is the document I sign uploaded to pdf.xyz?",
      a: "No. Reading the PDF, preparing your signature and writing the signed copy all happen in this browser tab, and neither the document nor the signature is sent to pdf.xyz. The only things signing itself downloads are code and fonts: the tool, its PDF library, and, only for a name that needs one, a Noto font file.",
    },
    {
      q: "Can I drag the signature to an exact spot?",
      a: `No. It snaps to one of ${anchorCount} anchor points, Margin pushes it in from the edges, and Size sets its width with the height in proportion; a short typed name stops growing at the largest letter size the tool draws, and a drawn signature is sized as the whole pad, blank space included, so the ink itself comes out narrower. Lines near an edge or corner are easy to reach, one mid-page may not be. Placement also ignores a page's rotation flag, so on a page displayed turned the signature can land in another corner and run sideways or upside down.`,
    },
    {
      q: "Can I sign several pages, or add initials and a date?",
      a: "Each run signs one page. To add another, download the signed PDF, press Start over, open that copy and sign the next page. Type mode is not limited to a name, so initials or a date go on the same way, one pass each.",
    },
    {
      q: "Why is there a box around my signature image?",
      a: "A JPEG cannot be transparent, so the paper around your ink, white or the grey of a scan, lands on the page with it. A PNG avoids that only if its background really is transparent; a signature drawn on the pad always is, because the pad exports ink with nothing behind it.",
    },
    {
      q: "Can I sign a password-protected or already certified PDF?",
      a: `Any encryption blocks signing, whether it guards opening the file or only printing and copying. Unlock PDF can remove it if you know a password: the open password, or the owner password for a file that opens freely but is restricted. Unlike signing, Unlock PDF does not run in your browser: the file is uploaded over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, the unlocked copy's link expires after ${linkMinutes} minutes, and the stored copy is erased by a daily storage rule after that. A PDF that already carries a certificate signature can be signed here, but the whole file is rewritten rather than appended to, so the byte range that certificate covers no longer lines up with the file; expect a viewer that checks signatures to flag it.`,
    },
  ],

  relatedGuides: ["how-to-sign-a-pdf", "how-to-fill-out-a-pdf-form"],
};

export default content;
