import { PdfEngineError } from "./engine";
import { outputName } from "./files";
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
 * (1pt = 1/72") from the *bottom-left* corner of the page.
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

/** The displayed size of one page, in points. */
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
 * Validate a list of field specs against the target PDF. Returns every problem
 * found (empty array means the specs are safe to create), each tagged with the
 * offending spec's index so a builder UI can show issues inline. Checks: at
 * least one field, non-empty and unique names (including against the PDF's
 * existing fields), in-range pages, positive sizes, on-page placement, per-type
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
  const pageSizes = doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width, height };
  });
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
 * are preserved untouched.
 */
export async function createFormFields(
  bytes: Uint8Array,
  specs: NewFormField[],
): Promise<CreateFormResult> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const pageSizes = pages.map((page) => {
    const { width, height } = page.getSize();
    return { width, height };
  });
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
  // `doc.save()` as a raw `WinAnsi cannot encode` with the form half-built.
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
    if (!page) continue; // Unreachable after validation; satisfies the type checker.
    const name = spec.name.trim();
    const box: Placement = {
      x: spec.x,
      y: spec.y,
      width: spec.width,
      height: spec.height,
    };

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
        if (spec.checked) field.check();
        field.addToPage(page, box);
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
        const boxes = fieldBoxes(spec);
        spec.options.forEach((option, i) => {
          const at = boxes[i];
          if (at) field.addOptionToPage(option, page, at);
        });
        if (spec.defaultValue) field.select(spec.defaultValue);
        break;
      }
    }
  }

  stampProducer(doc);
  const out = await doc.save();
  return {
    bytes: out,
    fieldCount: specs.length,
    names: specs.map((spec) => spec.name.trim()),
  };
}
