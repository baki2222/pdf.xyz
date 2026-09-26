import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { displayedSize, pageFrame, toContentSpace } from "./page-frame";
import { loadPdfLib } from "./pdf-lib";
import { loadPdf, stampProducer } from "./stamp";
import { assertFormFieldTextDrawable } from "./unicode-font";

/**
 * Pure, in-browser AcroForm *creation* built on pdf-lib only — no uploads, no
 * worker. Given an existing PDF and a list of field specs, it adds classic
 * AcroForm widgets (text inputs, checkboxes, dropdowns, radio groups, and option
 * lists) at caller-supplied coordinates and saves a new, fillable PDF.
 *
 * HONEST SCOPE: this creates the five classic AcroForm field types pdf-lib can
 * build and render reliably. It is NOT a visual PDF editor — there are no drag
 * handles, no live canvas, and no arbitrary rich styling (fonts, borders,
 * colors). Fields are placed by numeric coordinates in PDF points. It does NOT
 * create signature fields (pdf-lib cannot render a usable signature widget) and
 * it does NOT produce XFA (dynamic XML) forms — only the classic AcroForm
 * dictionary every viewer understands. Coordinates are measured in PDF points
 * (1pt = 1/72") from the *bottom-left* corner of the page AS A READER SEES IT:
 * the visible (crop) box, turned by the page's `/Rotate`. They are mapped into
 * pdf-lib's unrotated draw space through page-frame.ts, and each widget is
 * given the page's rotation so its contents read upright.
 */

/** The field kinds this tool can create. */
export type NewFieldType =
  "text" | "checkbox" | "dropdown" | "radio" | "optionlist";

/** Human-facing label for each creatable field type. */
export const FIELD_TYPE_LABELS: Record<NewFieldType, string> = {
  text: "Text field",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  radio: "Radio group",
  optionlist: "Option list",
};

/** Every creatable type, in the order the builder offers them. */
export const NEW_FIELD_TYPES: readonly NewFieldType[] = [
  "text",
  "checkbox",
  "dropdown",
  "radio",
  "optionlist",
];

/** A stable, human-facing label for a field type. */
export function describeFieldType(type: NewFieldType): string {
  return FIELD_TYPE_LABELS[type];
}

/** Default vertical gap (points) between the stacked buttons of a radio group. */
export const RADIO_STACK_GAP = 6;

/** Tolerance (points) when checking a field fits within the page box. */
const BOUND_EPS = 0.5;

/** Geometry shared by every field: where it sits on the page, in points. */
export interface NewFieldPlacement {
  /** 1-based page number the field is placed on. */
  page: number;
  /** Lower-left X in PDF points, measured from the page's bottom-left corner. */
  x: number;
  /** Lower-left Y in PDF points, measured from the page's bottom-left corner. */
  y: number;
  /** Width in points. For radio groups this is the size of a single button. */
  width: number;
  /** Height in points. For radio groups this is the size of a single button. */
  height: number;
}

export interface NewTextField extends NewFieldPlacement {
  type: "text";
  name: string;
  /** Pre-filled text value. */
  defaultValue?: string;
  /** Allow multiple lines of text. */
  multiline?: boolean;
  /** Cap the number of characters a user may enter. */
  maxLength?: number;
}

export interface NewCheckBoxField extends NewFieldPlacement {
  type: "checkbox";
  name: string;
  /** Whether the box starts checked. */
  checked?: boolean;
}

export interface NewDropdownField extends NewFieldPlacement {
  type: "dropdown";
  name: string;
  /** Selectable options; at least one is required. */
  options: string[];
  /** Preselected option (must be one of `options` unless `editable`). */
  defaultValue?: string;
  /** Combo box: also accept free-typed values outside the option list. */
  editable?: boolean;
  /** Allow selecting more than one option. */
  multiselect?: boolean;
}

export interface NewOptionListField extends NewFieldPlacement {
  type: "optionlist";
  name: string;
  /** Selectable options; at least one is required. */
  options: string[];
  /** Preselected option (must be one of `options`). */
  defaultValue?: string;
  /** Allow selecting more than one option. */
  multiselect?: boolean;
}

export interface NewRadioField extends NewFieldPlacement {
  type: "radio";
  name: string;
  /** The mutually-exclusive choices; at least two are required. */
  options: string[];
  /** Preselected option (must be one of `options`). */
  defaultValue?: string;
  /** Vertical gap in points between stacked buttons (defaults to {@link RADIO_STACK_GAP}). */
  gap?: number;
}

/** A single field to add to a PDF, discriminated by `type`. */
export type NewFormField =
  | NewTextField
  | NewCheckBoxField
  | NewDropdownField
  | NewOptionListField
  | NewRadioField;

/** Fields whose meaning is driven by a list of options. */
type ChoiceField = NewDropdownField | NewOptionListField | NewRadioField;

function isChoiceField(spec: NewFormField): spec is ChoiceField {
  return (
    spec.type === "dropdown" ||
    spec.type === "optionlist" ||
    spec.type === "radio"
  );
}

/**
 * The displayed size of one page, in points — the visible (crop) box, with
 * width and height swapped on a page turned a quarter by `/Rotate`.
 */
export interface PageDimensions {
  width: number;
  height: number;
}

/** Everything the builder needs to validate specs before creating anything. */
export interface NewFormContext {
  pageCount: number;
  /** Each page's size (points), in document order. */
  pageSizes: PageDimensions[];
  /** Names already used by the PDF's existing form fields (reserved). */
  existingNames: string[];
}

/** A validation problem with one field spec (or the form as a whole). */
export interface FieldSpecError {
  /** Index of the offending spec in the input list; -1 for a form-level issue. */
  index: number;
  /** The field's name, when it has one. */
  name?: string;
  /** User-facing description of the problem. */
  message: string;
}

export interface CreateFormResult {
  bytes: Uint8Array;
  /** How many fields were created. */
  fieldCount: number;
  /** The names of the created fields, in order. */
  names: string[];
}

/** A sensible download name for the created form, derived from the source. */
export function createdFormOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "form");
}

/** Split a textarea's contents into options — one per line, blanks dropped. */
export function parseOptions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The widget box(es) a field occupies. Every type is a single box except a
 * radio group, whose buttons stack downward from (x, y) — one per option, each
 * `width`×`height`, separated by `gap` points.
 */
function fieldBoxes(spec: NewFormField): Placement[] {
  if (spec.type === "radio") {
    const gap = spec.gap ?? RADIO_STACK_GAP;
    return spec.options.map((_, i) => ({
      x: spec.x,
      y: spec.y - i * (spec.height + gap),
      width: spec.width,
      height: spec.height,
    }));
  }
  return [{ x: spec.x, y: spec.y, width: spec.width, height: spec.height }];
}

/**
 * PDF field names are hierarchical: a period splits a name into a GROUP and the
 * field inside it, so "address.city" creates a group "address" holding a field
 * "city". A name cannot be both a field and a group — pdf-lib refuses the
 * second of "address" and "address.city", in either order, with a raw library
 * error. Returns the user-facing problem for `name` (the spec at `index`),
 * checked against every other new name and every name the PDF already has, or
 * null when it can coexist with all of them.
 */
function groupClash(
  name: string,
  index: number,
  specs: NewFormField[],
  reserved: ReadonlySet<string>,
): string | null {
  const others: { other: string; inPdf: boolean }[] = [
    ...[...reserved].map((other) => ({ other, inPdf: true })),
    ...specs.flatMap((spec, i) =>
      i === index || !spec.name.trim()
        ? []
        : [{ other: spec.name.trim(), inPdf: false }],
    ),
  ];
  for (const { other, inPdf } of others) {
    const where = inPdf ? " in this PDF" : "";
    if (other.startsWith(`${name}.`)) {
      return `"${name}" is also the group of "${other}"${where} — a period in a field name makes the part before it a group, and a group can't also be a field. Rename one of them.`;
    }
    if (name.startsWith(`${other}.`)) {
      return `"${other}" ${inPdf ? "is already a field in this PDF" : "is also a field here"}, so "${name}" can't use it as a group — a period in a field name makes the part before it a group. Rename one of them.`;
    }
  }
  return null;
}

/**
 * Validate a list of field specs against the target PDF. Returns every problem
 * found (empty array means the specs are safe to create), each tagged with the
 * offending spec's index so a builder UI can show issues inline. Checks: at
 * least one field, non-empty and unique names (including against the PDF's
 * existing fields, and the group/field hierarchy a period in a name creates),
 * in-range pages, positive sizes, on-page placement, per-type
 * option requirements, and default values that match their options.
 */
export function validateFormFields(
  specs: NewFormField[],
  pageSizes: PageDimensions[],
  reservedNames: Iterable<string> = [],
): FieldSpecError[] {
  if (specs.length === 0) {
    return [{ index: -1, message: "Add at least one field to create." }];
  }

  const errors: FieldSpecError[] = [];
  const reserved = new Set(reservedNames);

  // Count trimmed names so duplicates can be flagged on every occurrence.
  const nameCounts = new Map<string, number>();
  for (const spec of specs) {
    const name = spec.name.trim();
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  specs.forEach((spec, index) => {
    const name = spec.name.trim();
    const push = (message: string) =>
      errors.push(name ? { index, name, message } : { index, message });

    // Name — required and unique.
    if (!name) {
      push("Give this field a name.");
    } else if (reserved.has(name)) {
      push(
        `A field named "${name}" already exists in this PDF — choose another name.`,
      );
    } else if ((nameCounts.get(name) ?? 0) > 1) {
      push(`Duplicate field name "${name}" — names must be unique.`);
    } else if (name.split(".").some((part) => part.length === 0)) {
      push(
        `"${name}" can't be used as a name — a period separates a group from the field inside it, so it can't start or end a name or appear twice in a row.`,
      );
    } else {
      const clash = groupClash(name, index, specs, reserved);
      if (clash) push(clash);
    }

    // Page — a whole number within the document.
    const pageValid =
      Number.isInteger(spec.page) &&
      spec.page >= 1 &&
      spec.page <= pageSizes.length;
    if (!pageValid) {
      push(
        pageSizes.length > 0
          ? `Page ${spec.page} is out of range — this PDF has ${pageSizes.length} page${pageSizes.length === 1 ? "" : "s"}.`
          : `Page ${spec.page} is out of range.`,
      );
    }

    // Size — strictly positive.
    const sizeValid = spec.width > 0 && spec.height > 0;
    if (spec.width <= 0) push("Width must be greater than 0 pt.");
    if (spec.height <= 0) push("Height must be greater than 0 pt.");

    // Placement — every widget box must fit inside the page.
    if (pageValid && sizeValid) {
      const size = pageSizes[spec.page - 1];
      if (size) {
        const fits = fieldBoxes(spec).every(
          (box) =>
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= size.width + BOUND_EPS &&
            box.y + box.height <= size.height + BOUND_EPS,
        );
        if (!fits) {
          push(
            `Field extends past page ${spec.page} (${Math.round(size.width)}×${Math.round(size.height)} pt). Adjust its position or size.`,
          );
        }
      }
    }

    // Options — required for choice fields, non-blank, and unique.
    if (isChoiceField(spec)) {
      const opts = spec.options;
      if (spec.type === "radio" && opts.length < 2) {
        push("A radio group needs at least two options.");
      } else if (spec.type !== "radio" && opts.length < 1) {
        push(`${describeFieldType(spec.type)} needs at least one option.`);
      }
      if (opts.some((o) => o.trim() === "")) {
        push("Options can't be blank.");
      }
      const seen = new Set<string>();
      const dupes = new Set<string>();
      for (const raw of opts) {
        const o = raw.trim();
        if (!o) continue;
        if (seen.has(o)) dupes.add(o);
        seen.add(o);
      }
      if (dupes.size > 0) {
        push(
          `Duplicate option${dupes.size === 1 ? "" : "s"}: ${[...dupes].join(", ")}.`,
        );
      }

      // Default selection must be a real option (unless a combo box).
      const def = spec.defaultValue?.trim();
      const editable = spec.type === "dropdown" && spec.editable === true;
      if (def && !editable && !opts.some((o) => o.trim() === def)) {
        push(`Default value "${def}" isn't one of the options.`);
      }
    }

    // Text-specific limits.
    if (spec.type === "text" && spec.maxLength !== undefined) {
      if (!Number.isInteger(spec.maxLength) || spec.maxLength <= 0) {
        push("Max length must be a positive whole number.");
      } else if (
        spec.defaultValue &&
        spec.defaultValue.length > spec.maxLength
      ) {
        push(
          `Default text is longer than the ${spec.maxLength}-character limit.`,
        );
      }
    }
  });

  return errors;
}

/**
 * Read the details the builder needs from a PDF: how many pages it has, each
 * page's size (for coordinate bounds), and the names of any form fields that
 * already exist (which new fields must not collide with). Loading here also
 * surfaces a friendly error early if the file isn't a readable PDF.
 */
export async function readFormContext(
  bytes: Uint8Array,
): Promise<NewFormContext> {
  const doc = await loadPdf(bytes);
  // Sizes AS DISPLAYED, from the same frames createFormFields maps through, so
  // the runner's "Page 1 is W × H pt" and its bounds describe the page the
  // user is measuring on — not the unrotated media box underneath it.
  const pageSizes = doc
    .getPages()
    .map((page) => displayedSize(pageFrame(page)));
  const existingNames = doc
    .getForm()
    .getFields()
    .map((field) => field.getName());
  return { pageCount: pageSizes.length, pageSizes, existingNames };
}

function summarizeErrors(errors: FieldSpecError[]): string {
  const first = errors[0]?.message ?? "The form fields are invalid.";
  if (errors.length === 1) return `Can't create the form: ${first}`;
  const rest = errors.length - 1;
  return `Can't create the form: ${first} (and ${rest} more issue${rest === 1 ? "" : "s"}).`;
}

/**
 * Add the given fields to an existing PDF and save a new, fillable document.
 * Coordinates are PDF points from each page's bottom-left corner. Specs are
 * validated first (against the loaded PDF's pages and existing field names); an
 * invalid spec throws a typed, user-facing {@link PdfEngineError} rather than
 * producing a corrupt form. The source PDF's own pages and any existing fields
 * are preserved untouched: appearances are drawn for the NEW fields only, and
 * the save does not regenerate anyone else's (see the save call).
 */
export async function createFormFields(
  bytes: Uint8Array,
  specs: NewFormField[],
): Promise<CreateFormResult> {
  const doc = await loadPdf(bytes);
  const { degrees } = await loadPdfLib();
  const pages = doc.getPages();
  const frames = pages.map(pageFrame);
  const pageSizes = frames.map(displayedSize);
  const form = doc.getForm();
  const existingNames = form.getFields().map((field) => field.getName());

  const errors = validateFormFields(specs, pageSizes, existingNames);
  if (errors.length > 0) {
    throw new PdfEngineError(summarizeErrors(errors));
  }

  // Every string that will end up inside a field's appearance stream: the
  // default values, the dropdown/list options, and the field names themselves
  // (pdf-lib writes those into the AcroForm dictionary). Checked here, before a
  // single widget is added, because the failure otherwise surfaces from
  // pdf-lib's appearance drawing (`addToPage`) as a raw `WinAnsi cannot
  // encode` with the form half-built.
  assertFormFieldTextDrawable([
    ...specs.map((spec) => spec.name),
    ...specs.map((spec) =>
      "defaultValue" in spec && typeof spec.defaultValue === "string"
        ? spec.defaultValue
        : "",
    ),
    ...specs.flatMap((spec) =>
      "options" in spec && Array.isArray(spec.options) ? spec.options : [],
    ),
  ]);

  for (const spec of specs) {
    const page = pages[spec.page - 1];
    const frame = frames[spec.page - 1];
    if (!page || !frame) continue; // Unreachable after validation; satisfies the type checker.
    const name = spec.name.trim();
    // The user's box is in the DISPLAYED frame. pdf-lib takes the widget's
    // lower-left ANCHOR plus a rotation and turns the box about that anchor
    // itself (`rotateRectangle`), so only the anchor is mapped here — mapping
    // the whole rectangle as well would turn it twice. The same rotation lands
    // in the widget's /MK /R, which cancels the page's /Rotate so the field's
    // contents read upright to the viewer.
    const place = (at: Placement) => ({
      ...toContentSpace({ x: at.x, y: at.y }, frame),
      width: at.width,
      height: at.height,
      rotate: degrees(frame.rotation),
    });
    const box = place(spec);

    switch (spec.type) {
      case "text": {
        const field = form.createTextField(name);
        if (spec.multiline) field.enableMultiline();
        if (spec.maxLength !== undefined) field.setMaxLength(spec.maxLength);
        if (spec.defaultValue) field.setText(spec.defaultValue);
        field.addToPage(page, box);
        break;
      }
      case "checkbox": {
        const field = form.createCheckBox(name);
        field.addToPage(page, box);
        // AFTER addToPage: `check()` sets /V and turns each EXISTING widget's
        // /AS on, and `addToPage` creates its widget with /AS /Off. Checked
        // first, the box carried /V /Yes with /AS /Off — "starts checked" in
        // the data, drawn unchecked by any viewer that paints /AS.
        if (spec.checked) field.check();
        break;
      }
      case "dropdown": {
        const field = form.createDropdown(name);
        field.addOptions(spec.options);
        if (spec.editable) field.enableEditing();
        if (spec.multiselect) field.enableMultiselect();
        if (spec.defaultValue) field.select(spec.defaultValue);
        field.addToPage(page, box);
        break;
      }
      case "optionlist": {
        const field = form.createOptionList(name);
        field.addOptions(spec.options);
        if (spec.multiselect) field.enableMultiselect();
        if (spec.defaultValue) field.select(spec.defaultValue);
        field.addToPage(page, box);
        break;
      }
      case "radio": {
        const field = form.createRadioGroup(name);
        // Each stacked button's box is in the displayed frame too; map each.
        const boxes = fieldBoxes(spec);
        spec.options.forEach((option, i) => {
          const at = boxes[i];
          if (at) field.addOptionToPage(option, page, place(at));
        });
        if (spec.defaultValue) field.select(spec.defaultValue);
        break;
      }
    }
  }

  stampProducer(doc);
  // `updateFieldAppearances: false`: pdf-lib's default regenerates EVERY field
  // lacking an appearance, the PDF's existing ones included — redrawing them in
  // Helvetica, and throwing a raw `WinAnsi cannot encode` on an existing value
  // in Bengali or CJK (common from generators that set NeedAppearances and omit
  // /AP). Existing fields stay as they came. The NEW fields need nothing from
  // the save: each one's appearance is drawn by `addToPage`, AFTER its text or
  // selection is set, and a checkbox or radio only flips /AS between on/off
  // streams its widgets already have. Reorder a setter below `addToPage` and
  // that field ships blank — "each new field shows its starting value" in
  // create-forms.pdfjs.test.ts is the check.
  const out = await doc.save({ updateFieldAppearances: false });
  return {
    bytes: out,
    fieldCount: specs.length,
    names: specs.map((spec) => spec.name.trim()),
  };
}
