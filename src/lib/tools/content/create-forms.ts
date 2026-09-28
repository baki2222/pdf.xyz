import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { RADIO_STACK_GAP } from "@/lib/pdf/create-forms";
import { rasterScaleForDpi } from "@/lib/pdf/pdf-to-image";

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
 *    non-WinAnsi character does not disable the button — it is refused then;
 *  - XFA: pdf-lib's PDFDocument.getForm() calls deleteXFA() when present, and
 *    both readFormContext and createFormFields call getForm();
 *  - loadPdf (src/lib/pdf/engine.ts) refuses encrypted input;
 *  - download name: createdFormOutputName → outputName(name, "form"), which
 *    strips / \ ? % * : | " < > from the base name;
 *  - no network call on the runner path (no fetch, no analytics in the runner,
 *    runner-kit, single-pdf-runner or use-single-pdf).
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

const content: ToolContent = {
  slug: "create-forms",

  seoTitle: "Create Fillable PDF Forms — Built in Your Browser",

  metaDescription:
    "Add text boxes, checkboxes, dropdowns, radio groups and lists to a PDF by page coordinates. Real AcroForm fields, built in your browser with no upload.",

  intro: [
    "Create Fillable Forms turns a flat PDF, such as a printed-style application or checklist, into one people can type into. You describe each field in a card: its type, a unique name, the page it sits on, and its box in whole PDF points measured from the page's bottom-left corner. Each card shows the width and height of the page it points at, and the Page box only accepts pages the document has.",
    "The output is a classic AcroForm, the form type PDF readers with form support can fill. Text fields can carry pre-filled text, a character limit and multiple lines; checkboxes can start ticked; dropdowns can accept free typing or several selections; lists and radio groups take their choices one per line. Existing pages and AcroForm fields are kept, and new names are checked against the old ones first.",
    `Your browser does the whole build: the PDF is read from your device, the fields are written into it in memory, and the result is saved to your device without a copy going to pdf.xyz. PDFs up to ${maxMb} MB are accepted.${betaSentence} There is no canvas for dragging fields into place, no font, border or colour styling, no signature field type and no XFA output; if the source carries an XFA layer, for instance a hybrid AcroForm-and-XFA form, the saved copy drops that layer and keeps only its AcroForm fields. A password-protected PDF is refused until you unlock it.`,
  ],

  useCases: [
    {
      title: "A registration sheet people complete on screen",
      body: "Put a text field over each blank line, cap the phone field's length, and send one PDF people fill in without printing.",
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
      body: "Drag it into the drop box, or use browse to pick it. The builder reads it, shows page one's size in points and how many form fields the file already has, and starts you with one Text field card.",
    },
    {
      title: "Set up each field",
      body: "Pick Text, Checkbox, Dropdown, Radio or List, fill in Field name, then Page, X, Y, Width and Height. Choice fields take options one per line, with an optional default.",
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
      a: `Coordinates are PDF points, ${POINTS_PER_INCH} to the inch, counted from the bottom-left corner: X grows to the right and Y grows upward. X and Y mark the field's lower-left corner, so a field near the top of the page needs a Y of roughly the page height the card displays minus the field's own height.`,
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
      q: "Can I style the fields?",
      a: "No. Fields come in one plain default style, with no choice of font, colour or border.",
    },
    {
      q: "Why was a field name or option refused for its characters?",
      a: "New fields are drawn with a standard PDF font that covers only the Western (WinAnsi) character set, and a PDF reader redraws a field's text from that font. When you press “Create form”, every field name, default and option is checked against that set; one containing, say, Cyrillic, Greek or Bengali letters stops the build with a message naming the characters, instead of turning them into question marks.",
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
