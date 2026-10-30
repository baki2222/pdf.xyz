import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/*
 * Every behavioral claim below was read from the code:
 *  - runner: src/components/tools/runner/fill-forms-runner.tsx — dropzone
 *    ("Drop your PDF here, or browse", runner-kit Dropzone), "Reading form
 *    fields…", the "Form fields" list (field.name — the AcroForm name, not a
 *    printed label — plus widget label, "N fillable · M unsupported", required
 *    "*", "Read-only" badge), per-type controls (text/textarea with a counter
 *    and an HTML maxLength when the field has a max length, editable dropdown
 *    = type-or-choose, multi-select = checkboxes, "Clear selection" on radio
 *    groups), unsupported fields in a separate note, not the list, the
 *    "Flatten after filling" checkbox (off by default), "Fill form" /
 *    "Filling…", the "Form filled" result ("N fields filled", plus
 *    "flattened to static content" only when result.flattened), "Download
 *    filled PDF", the "couldn't be applied" note (a COUNT, no field names),
 *    and the two empty states ("No form fields detected" when hasFields is
 *    false / "No fillable form fields here" when every field is unsupported);
 *  - initialValues sends EVERY editable fillable field, pre-loaded or not, so
 *    appliedCount counts unchanged fields too, and every one is re-set;
 *  - engine: src/lib/pdf/forms.ts — fills EXISTING AcroForm fields only, push
 *    buttons and signature fields are "unsupported" and untouched by filling,
 *    read-only fields are never written, flatten is best-effort and falls back
 *    to the filled, still-interactive copy with flattened:false; the document
 *    is loaded and saved in place (not rebuilt);
 *  - flatten: pdf-lib 1.17.1 PDFForm.flatten() walks every field and calls
 *    findWidgetAppearanceRef, which THROWS when a widget has no /AP /N ref.
 *    PDFButton regenerates a missing appearance first; PDFSignature's
 *    needsAppearancesUpdate() is always false, so it never does. Probed
 *    2026-09-27 through applyFormValues on a generated form (text field +
 *    /FT /Sig widget): WITHOUT /AP → flattened:false, both fields still
 *    present; WITH an /AP stream → flattened:true, zero fields left. So a
 *    signature field is baked in only when it carries an appearance, and an
 *    unsigned one without it makes the whole flatten fall back;
 *  - XFA: pdf-lib 1.17.1 PDFDocument.getForm() calls form.deleteXFA() when the
 *    AcroForm carries an /XFA entry, so a hybrid form loses its XFA layer in
 *    the saved copy and its AcroForm fields are what get filled. A form with
 *    no AcroForm fields at all lands on "No form fields detected" (hasFields
 *    false) — stated as that conditional, not as a claim about how common
 *    pure-XFA forms are;
 *  - alphabet: assertFormFieldTextDrawable (src/lib/pdf/unicode-font.ts) runs
 *    over EVERY string value sent, including values pre-loaded from the form,
 *    when "Fill form" is pressed; it refuses characters outside WinAnsi
 *    (src/lib/pdf/winansi.ts), names only the first few and counts the rest
 *    (showCharacters — its cut-off is a bare literal, so no number is stated),
 *    with no substitution;
 *  - Sign PDF (src/lib/pdf/signature.ts, sign-runner.tsx): Draw / Type /
 *    Upload; "Placement" = a Position grid (StampPosition), Page, Size and
 *    Margin — it does not target a form's signature field; the runner's own
 *    notice says it is a visual signature, not a certificate one; a typed
 *    signature goes through embedDrawingFont, whose SUPPORTED_SCRIPTS include
 *    Cyrillic, Greek, Bengali and Han, and whose UNSUPPORTED_SCRIPTS include
 *    Arabic;
 *  - encrypted input: a file that needs a password to open is refused (the
 *    probe's "password-protected" sentence). One that opens without a
 *    password (owner/permissions only) OPENS since 2026-10-29: the runner
 *    passes `openProtected`, the file is decrypted in the browser
 *    (src/lib/pdf/security), its fields are filled only if /P grants it
 *    (bit 9 or 6), flatten is off, and the copy is the original plus an
 *    incremental update under the author's own encryption — /Encrypt, /ID,
 *    O/U untouched (protected-pdf.test.ts reads it back with pdf.js). The
 *    owner password, typed in the page, unlocks everything and the copy is
 *    then unencrypted. Unlock PDF is processing "server" in the catalogue
 *    and needs a password (src/lib/jobs/pdf-security.ts);
 *  - download name: filledFormsOutputName → outputName(name, "filled");
 *  - size cap: the fill-forms runner's gate, read via toolFileCeilingMb.
 *
 * Earlier probe (2026-09-27, generated hybrid form: text field with a
 * 5-character limit, dropdown, push button, one bookmark, an /XFA entry)
 * through applyFormValues: "éñüß" applied; "Привет" and "ł" refused; ten
 * Cyrillic letters named eight "(and 2 more)"; over-length text "invalid";
 * pages and /Outlines kept; /XFA gone; flatten left zero fields, button
 * included. A generated form, not a real government one.
 */
const fillFormsTool = getToolBySlug("fill-forms");
const ceilingMb = fillFormsTool ? toolFileCeilingMb(fillFormsTool) : null;
if (ceilingMb === null) {
  throw new Error("fill-forms content states a file ceiling it cannot find");
}
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;

const content: ToolContent = {
  slug: "fill-forms",

  seoTitle: "Fill PDF Forms Online — Fillable Fields, No Upload",

  metaDescription:
    "Type into a PDF's fillable fields, tick checkboxes, pick radio and dropdown options, then download it editable or flattened. Your browser does the filling.",

  intro: [
    "Fill Forms completes the interactive fields a PDF already has: the text boxes, checkboxes, radio groups, dropdowns and list boxes the form's author built in. Each fillable field gets a matching control: a dropdown offers its own options, and a text field with a character limit counts against it and stops at it. Values the form already holds are pre-loaded, so it works as well for correcting a half-finished form as for a blank one.",
    `Forms collect names, addresses and account details, so where the typing happens matters: this PDF is opened, filled and saved again online by your own browser, with no upload and no copy sent to pdf.xyz. Your answers go into the original document rather than a rebuilt copy, so its pages and bookmarks are kept. The size ceiling for one form is ${ceilingMb} MB.`,
    "Three limits first. It never adds fields, so a flat or scanned page has nothing to fill. Push buttons and signature fields are shown in a separate note and never filled; flattening bakes a push button into the page, but an unsigned signature field with no drawn appearance makes flattening fail for the whole form. And fields accept only the standard PDF fonts' Western alphabet, so Cyrillic, Greek, Arabic, Bengali or Chinese text, and letters such as Polish ł or Czech č, are refused rather than saved as question marks.",
  ],

  useCases: [
    {
      title: "Official forms published as fillable PDFs",
      body: "Where a tax office, benefits agency or licensing body publishes a PDF with real form fields, complete it on screen instead of printing it and writing by hand. If the page says No form fields detected, that particular PDF has no fields this tool can reach.",
    },
    {
      title: "Correcting a form someone already started",
      body: "Answers already in the file appear in the controls, so you can fix one wrong date or missed checkbox; every other editable field is written back with the value it already had.",
    },
    {
      title: "Locking answers before you send",
      body: "Tick Flatten after filling so the recipient cannot clear or overwrite a field in their viewer. Confirm the result says flattened to static content before sending; without those words, the copy still has live fields.",
    },
    {
      title: "Fill first, sign second",
      body: "Complete the fields here, then open the download in Sign PDF to add a drawn, typed or uploaded signature. Sign PDF places it by a position grid, page, size and margin rather than inside the form's own signature box, and it is a visual mark, not a certificate-based signature.",
    },
  ],

  steps: [
    {
      title: "Open the form",
      body: "Put the form in the Drop your PDF here area by dragging it there or clicking browse. While Reading form fields… is showing, your browser is collecting every field the file defines.",
    },
    {
      title: "Fill in the Form fields list",
      body: "Each field is listed under the name stored in the PDF, which need not match the label printed beside the box, with its type and an asterisk if required. Type into text fields, tick checkboxes, and choose from radio groups, dropdowns and lists. Read-only fields show their value but stay unchanged.",
    },
    {
      title: "Decide whether to flatten",
      body: "Flatten after filling is off by default, keeping the download editable. Tick it once the answers are final.",
    },
    {
      title: "Fill form and download",
      body: "Press Fill form. The Form filled summary counts every editable field written, including ones you left as they were, and adds flattened to static content only when flattening worked. Download filled PDF saves a copy named after your original, with -filled before .pdf.",
    },
  ],

  faqs: [
    {
      q: "Why does it say “No form fields detected”?",
      a: "The PDF has no interactive AcroForm fields: either its lines and boxes are only printed on the page, as on a scan, or its fields exist only in an XFA layer. This tool never creates fields. Create Fillable Forms (in beta) adds fields at positions you choose, and Sign PDF places a signature on a flat page. A PDF whose only fields are push buttons or signature fields gets a different notice, No fillable form fields here.",
    },
    {
      q: "Can I type accented letters or other alphabets into the fields?",
      a: "Western accented letters such as é, ñ, ü and ß work. Cyrillic, Greek, Arabic, Bengali, Chinese and other characters outside the standard PDF fonts' alphabet are refused when you press Fill form, with a message listing them, and nothing becomes a question mark. The check also covers text the form already held in an editable field, so clear or replace such a value to continue. For a signature, Sign PDF's Type option embeds a font for Cyrillic, Greek, Bengali and Chinese names, though not Arabic.",
    },
    {
      q: "Does it work with XFA or Adobe LiveCycle forms?",
      a: "Not with the XFA layer itself; only standard AcroForm fields are read. If a PDF carries both an XFA layer and ordinary fields, the ordinary fields are filled and the XFA layer is dropped from the saved copy.",
    },
    {
      q: "What does Flatten after filling change, and can it be undone?",
      a: 'It turns the filled fields into fixed page content, so nothing is left to edit and the form cannot be restored from that copy; keep your original. Push buttons are baked in too. If flattening fails, as it does when an unsigned signature field has no drawn appearance, you get the filled copy with every field still live, and the summary leaves out "flattened to static content".',
    },
    {
      q: "Some values “couldn't be applied” — what happened?",
      a: "Every value is checked again as it is written. Because the text boxes stop at a field's character limit, this usually comes from what the file already held: a stored answer longer than the limit, or a stored choice that is not among the field's options. Those fields keep their previous value, the rest are still filled, and the note gives a count rather than naming them.",
    },
    {
      q: "Does the form leave my computer, and what about a locked PDF?",
      a: `No. Your browser reads the PDF, up to ${ceilingMb} MB, writes the answers and builds the download itself. A PDF that needs a password to open is refused, with a message saying so. One that opens without a password but whose author restricted it opens here with the author's rules in force: if they allow filling in the form you can fill it, flattening stays off, and the copy keeps the author's encryption, restrictions and owner password. Typing the owner password into the page unlocks everything for that file, checked in your browser and not sent anywhere, and the copy is then saved without encryption. Removing a password you know from a file outright takes Unlock PDF, which runs server-side rather than here: it sends the file over TLS to pdf.xyz's secure server, deletes the input once the job finishes, and keeps the download link alive for ${LINK_MINUTES} minutes.`,
    },
  ],

  relatedGuides: [
    "how-to-fill-out-a-pdf-form",
    "how-to-create-a-fillable-pdf-form",
    "how-to-sign-a-pdf",
  ],
};

export default content;
