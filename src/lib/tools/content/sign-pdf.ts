import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { SUPPORTED_SCRIPTS, UNSUPPORTED_SCRIPTS } from "@/lib/pdf/font-packs";
import { MAX_SAVED_SIGNATURES } from "@/lib/pdf/editor/saved-signatures";

/*
 * Every behavioral claim below was read from, or probed against, the code.
 *
 * SINCE 2026-10-24 Sign PDF mounts the shared WYSIWYG editor
 * (`sign-runner.tsx` → `editor/editor-session.tsx`), opened on its Sign tool
 * with the signature panel showing and a "Place signature" first step. Until
 * then it was a form of its own — nine anchor points, Size and Margin
 * sliders, one signature on one page per run — and this page described that
 * form; every such sentence was rewritten with it.
 *
 *  - panel: editor/signature-panel.tsx — Draw / Type / Upload
 *    (SIGNATURE_SOURCES), opening on Type; Type has "Your name" and Style Script /
 *    Print; Upload shows "Remove paper background", ticked, only for a file
 *    with no transparency (`isOpaque`); "Save for next time" (opt-in) and the
 *    "Saved on this device" list with a delete button each; "Use signature".
 *  - drawn: signature-pad.tsx crops each drawing to its ink
 *    (signatureFromPixels, removeBackground false).
 *  - uploaded: decodeImageFile -> signatureFromPixels ->
 *    prepareSignatureBitmap crops to the ink and keys out the paper of an
 *    opaque source unless unticked; a keyed result is a PNG with alpha.
 *  - typed: placed as TEXT (`typedSignatureObject`): Script in Times Italic,
 *    Print in Helvetica, for Western European letters; any other script in
 *    one upright Noto face whichever style (`faceFor` asks for "sans");
 *    right-to-left scripts are refused by `embedDrawingFont` at Apply.
 *    `sign-style-copy.test.ts` reads the faces back out of the export.
 *  - placing: a click places it centred on the point; a picture resizes from
 *    its corners keeping its proportions, a typed one is a text box (its
 *    Size in the properties). Every further click places another copy, on
 *    any page. Rotated and cropped pages: the displayed frame
 *    (`editor-export.test.ts`).
 *  - saved: `editor/saved-signatures.ts` — localStorage only, opt-in, at
 *    most MAX_SAVED_SIGNATURES, try/catch around every access.
 *  - export: `exportEditedPdf` rewrites the whole file with pdf-lib
 *    (`stampProducer` sets Producer/Creator), so an existing certificate
 *    signature's byte range no longer matches; encrypted input is refused at
 *    open ("Unlock it first").
 *  - result: "PDF signed", "Download signed PDF", `signatureOutputName`.
 */
const signTool = getToolBySlug("sign-pdf");
const ceilingMb = signTool ? toolFileCeilingMb(signTool) : null;
if (ceilingMb === null) {
  throw new Error("sign-pdf content states a file ceiling it cannot find");
}

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
    "Sign a PDF in your browser: draw or type your signature, or add an image of it, then click on the page to place it. Nothing is uploaded to pdf.xyz.",

  intro: [
    `Sign PDF puts your signature on a document you already have, such as an offer letter, a lease or a consent form. Draw it with a mouse, pen or fingertip, type your name in the Script (serif italic) or Print style, or pick a PNG or JPEG of the signature you already use under Upload; the image is read on your device. Then click on the page where it goes, drag it onto the line and resize it, and click again wherever else it is needed.`,
    `Everything runs online in this browser tab: the PDF, up to ${ceilingMb} MB, and your signature are processed on your device, and neither is uploaded. The pages, fillable fields, bookmarks, title and author carry over, while the file's Producer and Creator entries are rewritten. A name with letters beyond the Western European alphabet (a Polish Ł counts) is drawn in a Noto font the browser fetches from pdf.xyz by file name, a request that carries none of your text.`,
    "The result is a visual electronic signature: no certificate, no PKI, no tamper evidence. The FAQ below says what that means if someone asks how you signed.",
  ],

  useCases: [
    {
      title: "An emailed contract with one signature line",
      body: "Make your signature, click on the line, then drag and resize it until it sits there. No printer or scanner needed.",
    },
    {
      title: "Reusing the signature you keep on file",
      body: "Under Upload, choose the PNG or JPEG scan or photo of the signature you already use. It is cropped to the ink and, with Remove paper background left ticked, the paper around it is made transparent, so the page shows through around your signature instead of a rectangle of paper; a PNG that already has a transparent background goes on as it is.",
    },
    {
      title: "Initials on every page",
      body: "Type your initials, then click on each page that needs them: every click places another copy, and they are all written in one pass.",
    },
    {
      title: "A name that is not written in Latin letters",
      body: `Type mode draws names in ${otherScripts} as well as Latin. Those scripts all use one upright Noto face whichever style you pick, because Script and Print only change Western European lettering. ${rtlScripts} are stopped with an explanation instead of being drawn backwards, since every line is laid out left to right.`,
    },
  ],

  steps: [
    {
      title: "Open the document",
      body: "Drop one PDF in the box or browse for it; each run signs a single file. A password-protected PDF is refused as soon as it is read. The pages then appear with the signature panel open above them.",
    },
    {
      title: "Create the signature",
      body: "The panel opens on Type: write your name under Your name and pick Script or Print; the preview uses your browser's fonts, so it only approximates the final lettering. Draw gives a pad with a Clear chip, and the third tab takes a PNG or JPEG from your device. Tick Save for next time to keep it in this browser for later, then press Use signature.",
    },
    {
      title: "Place it",
      body: "Click on the page where it goes. Drag it to move it and drag a corner to resize it; a picture keeps its proportions. Click Sign again to place another copy, on this page or any other.",
    },
    {
      title: "Sign and save",
      body: "Apply & download writes every signature into the PDF and downloads it. The PDF signed panel then gives the file size, and Download signed PDF saves it again, with -signed added to your file name.",
    },
  ],

  faqs: [
    {
      q: "Is the document I sign uploaded to pdf.xyz?",
      a: "No. Reading the PDF, preparing your signature and writing the signed copy all happen in this browser tab, and neither the document nor the signature is sent to pdf.xyz. The only things signing itself downloads are code and fonts: the tool, its PDF library, and, only for a name that needs one, a Noto font file.",
    },
    {
      q: "Where does a saved signature go?",
      a: `Only into this browser's own storage on this device, and only when you tick Save for next time. It is never uploaded. The signature panel lists up to ${MAX_SAVED_SIGNATURES} saved signatures, each with a button to use it and one to delete it; clearing this site's data in your browser removes them too.`,
    },
    {
      q: "Will there be a box around my signature image?",
      a: "Not by default. A photo or scan of your signature, JPEG or PNG, is cropped to the ink, and Remove paper background, ticked by default for any image with no transparency, makes the white or grey paper around it transparent, so only the ink lands on the page. Untick it to keep the paper as photographed, and it lands as a box around the ink. A PNG that already has a transparent background, and a signature drawn on the pad, need no cleanup: both are only ink, cropped the same way. Keying works best with dark ink on light paper; if it cannot find any ink, the tool says so instead of placing a blank image.",
    },
    {
      q: "Does it work on a rotated or cropped page?",
      a: "Yes. Each page is shown the way a PDF viewer shows it, after any rotation setting and with only its visible area, and the signature lands exactly where you placed it, reading upright.",
    },
    {
      q: "Can I sign a password-protected or already certified PDF?",
      a: `Any encryption blocks signing, whether it guards opening the file or only printing and copying. Unlock PDF can remove it if you know a password: the open password, or the owner password for a file that opens freely but is restricted. Unlike signing, Unlock PDF does not run in your browser: the file is uploaded over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, the unlocked copy's link expires after ${linkMinutes} minutes, and the stored copy is erased by a daily storage rule after that. A PDF that already carries a certificate signature can be signed here, but the whole file is rewritten rather than appended to, so the byte range that certificate covers no longer lines up with the file; expect a viewer that checks signatures to flag it.`,
    },
  ],

  relatedGuides: ["how-to-sign-a-pdf", "how-to-fill-out-a-pdf-form"],
};

export default content;
