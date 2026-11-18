import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { EDITOR_FIELD_LABEL } from "@/lib/pdf/editor/model";
import { EDITOR_FORMS_GROUP } from "@/lib/pdf/offered-kinds";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { RADIO_STACK_GAP } from "@/lib/pdf/create-forms";
import { rasterScaleForDpi } from "@/lib/pdf/pdf-to-image";
import { DETECTION_RULES } from "@/lib/pdf/form-detect";

/*
 * Every behavioral claim below was read from the code on 2026-09-27:
 *  - runner: src/components/tools/runner/create-forms-runner.tsx — the dropzone
 *    ("Drop your PDF here, or" + browse, from runner-kit), "Reading the PDF…",
 *    CoordinateHelp (page 1's size only, plus the count of fields the PDF
 *    already has), one default Text card, the type switch (Text / Checkbox /
 *    Dropdown / Radio / List), "Field name", the "Placement" row whose hint is
 *    the card's OWN page size (pageHint), Page / X / Y / Width / Height (Button W
 *    / Button H for radio) — NumberField rounds every value and clamps Page to
 *    1..pageCount, X/Y to >= 0 and sizes to >= 1, so the card's "out of range"
 *    hint and the size > 0 errors are unreachable from the UI and are not
 *    claimed below; "Default text (optional)", "Max length (optional)",
 *    "Multiple lines", "Checked by default", "Allow custom typing", "Allow
 *    multiple selections", "Options — one per line", "Default selection
 *    (optional)", "Add field", "Remove", "Create form" (disabled while
 *    validateFormFields reports anything), and the result panel's "Download
 *    form PDF" and "Start over" (runner-kit ResultPanel resetLabel);
 *  - engine: src/lib/pdf/create-forms.ts — fieldBoxes stacks radio buttons
 *    downward by height + RADIO_STACK_GAP; validateFormFields checks names
 *    (blank, duplicate, reserved by existing fields), page range, positive
 *    size, every box on the page, >= 2 radio options, blank/duplicate options
 *    and defaults that are not an option. assertFormFieldTextDrawable runs only
 *    inside createFormFields, i.e. AFTER "Create form" is pressed, so a
 *    non-WinAnsi character does not disable the button — it is refused then.
 *    It covers only DRAWN text: text defaults and dropdown/list options. Since
 *    audit #39 (2026-11-06) names and radio options are not checked (UTF-16
 *    /T and /Opt; a radio draws no text), and Dropdown has no "Allow multiple
 *    selections" (viewers ignore MultiSelect on a combo box) — List keeps it;
 *  - XFA: pdf-lib's PDFDocument.getForm() calls deleteXFA() when present, and
 *    both readFormContext and createFormFields call getForm();
 *  - loadPdf (src/lib/pdf/engine.ts) refuses encrypted input;
 *  - download name: createdFormOutputName → outputName(name, "form"), which
 *    strips / \ ? % * : | " < > from the base name;
 *  - nothing is SENT on the runner path (no upload, no analytics in the
 *    runner, runner-kit, single-pdf-runner or use-single-pdf). Since the page
 *    preview (2026-11-17) pdf.js may DOWNLOAD an image decoder or a character
 *    map from our origin to draw a page; the offline answer names both
 *    (`RUNNER_MID_RUN_FETCHES`, held to the call graph by offline-answer.test.ts).
 *
 * The page preview, read from the code on 2026-11-17 (backlog #17):
 * create-forms-preview.tsx draws the selected card's page (rendered as
 * displayed, so after any rotation and crop) with every field on that page
 * drawn from its card's numbers through the engine's own `fieldBoxes` (a
 * radio group as its whole downward stack). A click on the page sets the
 * selected field's X and Y to its bottom-left corner there, a box can be
 * dragged, and a selected box moves 1 pt per arrow key, 10 pt with Shift;
 * each writes whole points back to the card (`placeAt`, which keeps every
 * box on the page). Width and height are typed only. The preview chunk loads
 * with the PDF read; if it fails, the cards still work (the runner says so).
 *
 * Find fields, read from the code on 2026-11-18 (backlog #17, slice S2):
 * the "Find fields" button beside "Add field" fetches its own chunk
 * (create-forms-detect.tsx) on the press, never before, and reads the PDF
 * in the browser with pdf.js (form-detect-read.ts). It looks only for the
 * shapes DETECTION_RULES names (form-detect.ts; the sentence below is built
 * from their `plain` words, and create-forms-detect-copy.test.ts holds every
 * listing to them both ways). What it finds is a SUGGESTION in its own list
 * ("Found fields"), drawn dotted on the preview: a card exists only once a
 * person presses Add (or Add all on this page / Add all; Enter on the dotted
 * box), named then from its label against the cards and the PDF's fields,
 * and dropped if validateFormFields refuses it. The first Add replaces the
 * starter card only if it was never touched. Signature lines are never
 * suggested (counted, with a link to Sign PDF); a page that looks like a
 * scan is not searched (bound to the reader's behaviour on the image-only
 * case, O1, by the copy guard); pages past 50, and suggestions past 60 a
 * page or 300 a run, are counted and said. It misses fields (S1's known
 * misses: tables beyond two columns, combs, radio groups, anything drawn on
 * its side), so no sentence here may say it finds every field.
 */
const tool = getToolBySlug("create-forms");
const maxMb = tool ? toolFileCeilingMb(tool) : null;
if (!tool || maxMb === null) {
  throw new Error("create-forms content states a file ceiling it cannot find");
}
const betaSentence =
  tool.badge === "beta" ? " The builder is marked beta on pdf.xyz." : "";

/** Points per inch, from the function the renderer uses to convert them. */
const POINTS_PER_INCH = Math.round(1 / rasterScaleForDpi(1));

/*
 * Edit PDF drags out the same field types plus a signature field (its Forms
 * group, editor/model.ts). Audit create-forms#1 (2026-11-07): this page said
 * neither existed and never named it. The name and the in-browser claim are
 * read from the catalogue.
 */
const EDIT_PDF = getToolBySlug("edit-pdf");
if (!EDIT_PDF || modeUploadsFiles(EDIT_PDF.processing)) {
  throw new Error(
    "create-forms content says Edit PDF runs in the browser, but it does not",
  );
}
const SIGNATURE_FIELD = EDITOR_FIELD_LABEL.signature;

/** "a, b, c and d": DETECTION_RULES' plain words, as Find fields' panel lists them. */
const LOOKS_FOR = ((items: string[]) =>
  `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`)(
  DETECTION_RULES.map((r) => r.plain),
);
const FIND_FIELDS = `Find fields looks for ${LOOKS_FOR}, and suggests a field for each one for you to check and add.`;

const SIGN_PDF = getToolBySlug("sign-pdf");
if (!SIGN_PDF)
  throw new Error("create-forms content links Sign PDF, which is gone");

const content: ToolContent = {
  slug: "create-forms",

  seoTitle: "Create Fillable PDF Forms — Built in Your Browser",

  metaDescription:
    "Add text boxes, checkboxes, dropdowns, radio groups and lists to a PDF, or review fields suggested from its lines. Real AcroForm fields, built in your browser.",

  intro: [
    "Create Fillable Forms turns a flat PDF, such as a printed-style application or checklist, into one people can type into. You describe each field in a card: its type, a unique name, the page it sits on, and its box in whole PDF points measured from the page's bottom-left corner. Each card shows the width and height of the page it points at, and the Page box only accepts pages the document has. A preview of the page shows every field's box where its numbers put it: click the page to move a field's bottom-left corner there, drag a box, or nudge it with the arrow keys, and its X and Y change to match. Width and height are typed on the card.",
    `Or let the builder suggest fields for you to check: press “Find fields”. ${FIND_FIELDS} Each suggestion is listed with its label and page and drawn dotted on the preview, and nothing is added until you add it. It can miss a field or suggest a wrong one, so check the page as well. A scanned page, a picture of a form, is not searched.`,
    "The output is a classic AcroForm, the form type PDF readers with form support can fill. Text fields can carry pre-filled text, a character limit and multiple lines; checkboxes can start ticked; dropdowns can accept free typing, and lists can accept several selections; dropdowns, lists and radio groups take their choices one per line. Existing pages and AcroForm fields are kept, and new names are checked against the old ones first.",
    `Your browser does the whole build: the PDF is read from your device, the fields are written into it in memory, and the result is saved to your device without a copy going to pdf.xyz. PDFs up to ${maxMb} MB are accepted.${betaSentence} This builder has no ${SIGNATURE_FIELD.toLowerCase()} type: ${EDIT_PDF.name} adds one with the field tools in its ${EDITOR_FORMS_GROUP} group, also in your browser. There is no font, border or colour styling and no XFA output; if the source carries an XFA layer, for instance a hybrid AcroForm-and-XFA form, the saved copy drops that layer and keeps only its AcroForm fields. A password-protected PDF is refused until you unlock it.`,
  ],

  useCases: [
    {
      title: "A registration sheet people complete on screen",
      body: "Press “Find fields” for a text field suggested over each labelled blank line, check and add the right ones, cap the phone field's length, and send one PDF people fill in without printing.",
    },
    {
      title: "An inspection or onboarding checklist",
      body: "Drop a checkbox beside each item. Tick the ones that usually apply with “Checked by default” so reviewers only change the exceptions.",
    },
    {
      title: "Questions with a fixed set of answers",
      body: "Use a dropdown for department or country, a radio group where exactly one answer counts, and a list when several choices may be selected at once.",
    },
    {
      title: "Adding a missing field to an existing form",
      body: "If a supplier's fillable PDF lacks a box you need, add just that field. The original fields stay, and the builder stops you reusing one of their names.",
    },
  ],

  steps: [
    {
      title: "Open the flat PDF",
      body: "Drag it into the drop box, or use browse to pick it. The builder reads it, shows page one's size in points and how many form fields the file already has, and starts you with one Text field card and a preview of the page it is on.",
    },
    {
      title: "Review each suggestion",
      body: "Press “Find fields” to have fields suggested from the PDF's printed lines and boxes, for you to review. Each one is listed with its label and page and drawn dotted on the preview: add the ones that are right, rename any first if you like, and dismiss the rest. Nothing is added until you add it.",
    },
    {
      title: "Set up each field",
      body: "Pick Text, Checkbox, Dropdown, Radio or List, fill in Field name, then Page, X, Y, Width and Height. Instead of typing X and Y, you can click the page preview where the field's bottom-left corner belongs, or drag its box. Choice fields take options one per line, with an optional default.",
    },
    {
      title: "Add the rest and clear any warnings",
      body: "Press “Add field” for each extra box and “Remove” to drop one. Problems such as a duplicate name, a radio group with one option or a box running off the page appear in red on that card, and “Create form” stays disabled until they are fixed. Characters outside the Western alphabet are the exception: they are only caught once you press it.",
    },
    {
      title: "Create and download",
      body: "Press “Create form”, then “Download form PDF”. The download is named after your source file with “-form” before the .pdf extension, and “Start over” returns you to the drop box for another document.",
    },
  ],

  faqs: [
    {
      q: "Which X and Y should I type for a field?",
      a: `Coordinates are PDF points, ${POINTS_PER_INCH} to the inch, counted from the bottom-left corner: X grows to the right and Y grows upward. X and Y mark the field's lower-left corner, so a field near the top of the page needs a Y of roughly the page height the card displays minus the field's own height. You can also skip the arithmetic: click the page preview where that corner should go, and the card fills in X and Y. A field you add from a Find fields suggestion arrives with its X, Y, width and height filled in, and you can change them like any other.`,
    },
    {
      q: "How are radio buttons laid out?",
      a: `A radio group needs at least two options. The first button sits at your X and Y, and each further option stacks downward, ${RADIO_STACK_GAP} points below the previous one, every button using the Button W and Button H you set. If the stack would run past the bottom of the page, the card tells you before anything is created.`,
    },
    {
      q: "Do the PDF or my field names leave my device?",
      a: "No. The fields are added by code running in your browser tab and the file is saved straight to your device, so pdf.xyz never receives the document or what you type into the cards.",
    },
    {
      q: "Can I drag fields into place or style them?",
      a: `You can move a field on the page preview: drag its box, click where its bottom-left corner should go, or select it and use the arrow keys. Each move changes the X and Y on its card, and the form is built from those numbers, so the saved field sits where the preview showed it. Width and height are typed on the card, or come filled in on a field you add from a Find fields suggestion. Fields come in one plain default style, with no choice of font, colour or border. For a ${SIGNATURE_FIELD.toLowerCase()}, use ${EDIT_PDF.name}: the field tools in its ${EDITOR_FORMS_GROUP} group drag one onto the page, saved as a real form field, and it also runs in your browser.`,
    },
    {
      q: "Can it find the fields for me?",
      a: `It can suggest them, for you to check. ${FIND_FIELDS} Each suggestion is listed with its label and page and drawn dotted on the page preview; nothing is added until you add it, and you can rename it first or dismiss it. It runs in your browser, only when you press the button, and it can miss a field or suggest a wrong one, so check the page as well. Signature lines are never suggested: the summary counts them, and ${SIGN_PDF.name} adds a signature.`,
    },
    {
      q: "Why did it find nothing?",
      a: "Find fields reads only what the PDF itself draws as text, lines and boxes, so add by hand any field it cannot see. A scanned page, a picture of a form, is not searched, and the summary names each page that looks like one. A page drawn on its side, a page that could not be read, and blanks that are not lines, underscores or small boxes give it nothing to suggest either, so add those fields with Add field.",
    },
    {
      q: "Why was a default value or a dropdown or list option refused for its characters?",
      a: "New fields are drawn with a standard PDF font that covers only the Western (WinAnsi) character set, and a PDF reader redraws a field's text from that font. When you press “Create form”, every text default and every dropdown or list option is checked against that set; one containing, say, Cyrillic, Greek or Bengali letters stops the build with a message naming the characters, instead of turning them into question marks. Field names and radio-button options are never drawn, so they can be in any alphabet.",
    },
    {
      q: "How do people complete and lock the form afterwards?",
      a: "Any PDF reader with form support can fill it, as can Fill Forms here, which can flatten the form once it is filled. Flatten PDF does that step on its own, baking the values into the page so they stop being editable.",
    },
  ],

  relatedGuides: [
    "how-to-create-a-fillable-pdf-form",
    "how-to-fill-out-a-pdf-form",
  ],
};

export default content;
