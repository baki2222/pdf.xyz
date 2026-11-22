import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { FONT_PACKS, UNSUPPORTED_SCRIPTS } from "@/lib/pdf/font-packs";

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
 *    filled PDF", the "couldn't be applied" note (SUPERSEDED 2026-11-22, audit
 *    fill-forms#8: it was a COUNT with no field names; now a list, each
 *    field by name with the engine's reason), the empty-required warning
 *    (role alert, names each field, "Fill anyway"),
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
 *  - alphabet: SUPERSEDED 2026-11-22 (audit fill-forms#6), history kept below.
 *    applyFormValues now splits the values sent: a field whose text is inside
 *    WinAnsi is drawn with the form's Helvetica (and asserted so); a field
 *    whose text is not gets a face from embedDrawingFont, its /DA pointed at
 *    that face and the face listed in /DR. A value no shipped face can draw
 *    (right to left, no face, two faces in one field) is "invalid" for THAT
 *    field with the font module's message, and the rest are still filled
 *    (forms-unicode.test.ts renders the saved file). What was true before:
 *    assertFormFieldTextDrawable (src/lib/pdf/unicode-font.ts) ran
 *    over every string value sent when "Fill form" is pressed. Since audit #15
 *    (2026-11-06) the runner sends only values the person CHANGED
 *    (changedValues in fill-forms-runner.tsx) and the engine saves with
 *    updateFieldAppearances: false, so a pre-loaded value is neither checked
 *    nor redrawn: it stays as it came. It refuses characters outside WinAnsi
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

const listFormat = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});
/** The scripts a field can now carry beyond Latin, from the shipped faces. */
const FIELD_SCRIPTS = listFormat.format([
  ...new Set(
    FONT_PACKS.filter((pack) => pack.role === "script")
      .flatMap((pack) => pack.label.split(/, | and /))
      .filter((name) => name !== "Latin"),
  ),
]);
/** Scripts still refused because lines are set left to right. */
const FIELD_RTL_REFUSED = listFormat.format(
  UNSUPPORTED_SCRIPTS.filter((s) => /right to left/.test(s.reason)).map(
    (s) => s.name,
  ),
);

const content: ToolContent = {
  slug: "fill-forms",

  seoTitle: "Fill PDF Forms Online — Fillable Fields, No Upload",

  metaDescription:
    "Type into a PDF's fillable fields, tick checkboxes, pick radio and dropdown options, then download it editable or flattened. Your browser does the filling.",

  intro: [
    "Fill Forms completes the interactive fields a PDF already has: the text boxes, checkboxes, radio groups, dropdowns and list boxes the form's author built in. Each fillable field gets a matching control: a dropdown offers its own options, and a text field with a character limit counts against it and stops at it. Values the form already holds are pre-loaded, so it works as well for correcting a half-finished form as for a blank one.",
    `Forms collect names, addresses and account details, so where the typing happens matters: this PDF is opened, filled and saved again online by your own browser, with no upload and no copy sent to pdf.xyz. Your answers go into the original document rather than a rebuilt copy, so its pages and bookmarks are kept. The size ceiling for one form is ${ceilingMb} MB.`,
    `Three limits first. It never adds fields, so a flat or scanned page has nothing to fill. Push buttons and signature fields are shown in a separate note and never filled; flattening bakes a push button into the page, but an unsigned signature field with no drawn appearance makes flattening fail for the whole form. And right-to-left text such as ${FIELD_RTL_REFUSED} is refused for its field rather than saved with the letters reversed; the other fields are still filled.`,
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
      body: "Each field is listed under the name stored in the PDF, which need not match the label printed beside the box, with its type and an asterisk if required. If you press Fill form with a required field empty, the page names each one first, and Fill anyway goes ahead. Type into text fields, tick checkboxes, and choose from radio groups, dropdowns and lists. Read-only fields show their value but stay unchanged.",
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
      a: `Yes. Western accented letters such as é, ñ, ü and ß use the form's own font. Other Latin letters such as Polish ł or Czech č, and ${FIELD_SCRIPTS} text, are drawn with a matching Noto font that your browser downloads from pdf.xyz the first time, and the font is saved inside the PDF so the answer shows in any reader. ${FIELD_RTL_REFUSED} are refused, because lines are set left to right, and so is a script with no shipped font or one field that mixes two downloaded fonts, such as Bengali with Chinese; that field is listed with the reason and left as it was, and nothing becomes a question mark. The saved font holds only the letters you typed, so if you later change that answer in another PDF reader, it may need its own font for new letters. Only the answers you change are checked and redrawn, and text the form already held is left exactly as it was.`,
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
      a: "Every value is checked again as it is written. Because the text boxes stop at a field's character limit, this usually comes from what the file already held: a stored answer longer than the limit, or a stored choice that is not among the field's options. Those fields keep their previous value and the rest are still filled. The note lists each one by its field name, with the reason, such as a choice that is not an option or text in a script that cannot be drawn.",
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
