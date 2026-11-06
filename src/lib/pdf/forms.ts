import {
  PDFButton,
  PDFCheckBox,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFField,
  type PDFFont,
} from "pdf-lib";
import { loadPdf, stampProducer } from "./stamp";
import { assertFormFieldTextDrawable } from "./unicode-font";

/**
 * Pure, in-browser AcroForm filling built on pdf-lib only — no uploads, no
 * worker. Two responsibilities:
 *
 *  1. `inspectFormFields` reads an existing PDF's AcroForm and returns safe,
 *     display-ready metadata for every field (name, type, current value, and
 *     the options for dropdowns/lists/radio groups).
 *  2. `applyFormValues` writes user-supplied values back into the *existing*
 *     fields and saves a new PDF.
 *
 * HONEST SCOPE: this fills fields that already exist. It never creates form
 * fields, and it does not support XFA forms (the dynamic XML form layer some
 * PDFs carry) — pdf-lib exposes only the classic AcroForm dictionary, so that
 * is exactly what we read and write. Field types pdf-lib cannot safely fill
 * (push buttons, signature fields) are reported as `unsupported` and left
 * untouched. A PDF with no AcroForm fields yields an empty field list — we
 * never fabricate fields or fake a "filled" result.
 */

/** The field kinds we can classify. Everything else is `unsupported`. */
export type FormFieldType =
  "text" | "checkbox" | "radio" | "dropdown" | "optionlist" | "unsupported";

/** Safe, display-ready metadata for a single AcroForm field. */
export interface FormFieldInfo {
  /** The field's fully-qualified AcroForm name (its identity for filling). */
  name: string;
  type: FormFieldType;
  /** A stable, human-facing label for the widget kind (e.g. "List box"). */
  widgetLabel: string;
  /** Field is marked read-only — we surface it but never write to it. */
  readOnly: boolean;
  /** Field is marked required in the source form. */
  required: boolean;
  /** Current text value (text fields only). */
  text?: string;
  /** Text field allows multiple lines. */
  multiline?: boolean;
  /** Maximum character length enforced by the field, when set. */
  maxLength?: number;
  /** Current checked state (checkboxes only). */
  checked?: boolean;
  /** Selectable options (radio groups, dropdowns, and option lists). */
  options?: string[];
  /** Currently selected option(s). Radio groups are 0-or-1; lists may be many. */
  selected?: string[];
  /** Dropdown/option-list accepts more than one selection. */
  multiselect?: boolean;
  /** Dropdown (combo box) accepts free-text values outside its option list. */
  editable?: boolean;
}

/** The result of inspecting a PDF's AcroForm. */
export interface FormInspection {
  /** True when the PDF has an AcroForm with at least one field. */
  hasFields: boolean;
  /** Every field pdf-lib exposes, in document order. */
  fields: FormFieldInfo[];
  /** How many fields are of a type we can fill. */
  fillableCount: number;
  /** How many fields are present but of an unsupported type. */
  unsupportedCount: number;
}

/** A value the UI supplies for one field, shaped by that field's type. */
export type FieldValue = string | boolean | string[];

export type FieldApplyStatus = "applied" | "skipped" | "invalid" | "missing";

/** What happened when we tried to write one supplied value. */
export interface FieldApplyOutcome {
  name: string;
  type: FormFieldType;
  status: FieldApplyStatus;
  /** Present for `skipped`/`invalid`/`missing`: why it wasn't applied. */
  detail?: string;
}

export interface ApplyFormValuesOptions {
  /**
   * Bake the filled values into static page content so the result can no longer
   * be edited or cleared in a viewer. Best-effort: if pdf-lib can't flatten a
   * field we keep the filled (still-interactive) document rather than lose the
   * work, and report `flattened: false`.
   */
  flatten?: boolean;
}

export interface FillFormsResult {
  bytes: Uint8Array;
  /** One entry per supplied value, in the order they were provided. */
  outcomes: FieldApplyOutcome[];
  /** How many supplied values were written successfully. */
  appliedCount: number;
  /** Whether the output was flattened (only ever true when requested). */
  flattened: boolean;
  /**
   * Whether the caller asked for a flatten. Carried with the result because
   * `flattened: false` alone reads the same for "not asked" and "asked, and
   * pdf-lib could not do it" — and the second leaves a form the user believes
   * is locked fully editable. `flattenRequested && !flattened` is that case.
   */
  flattenRequested: boolean;
}

// The two pdf-lib-free helpers the UI renders with live in ./forms-meta (so the
// runner's static imports stay light); imported for internal use and re-exported
// so existing importers and tests see one unchanged surface.
import { filledFormsOutputName, isFillableType } from "./forms-meta";
export { filledFormsOutputName, isFillableType };

/** Classify a pdf-lib field into one of our supported kinds. */
export function classifyField(field: PDFField): FormFieldType {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "optionlist";
  return "unsupported";
}

/**
 * A stable, human-facing label for the widget kind. Derived from the classified
 * type (not `constructor.name`, which minifies away in production builds) so it
 * stays correct in the shipped bundle.
 */
function widgetLabel(field: PDFField, type: FormFieldType): string {
  switch (type) {
    case "text":
      return "Text field";
    case "checkbox":
      return "Checkbox";
    case "radio":
      return "Radio group";
    case "dropdown":
      return "Dropdown";
    case "optionlist":
      return "List box";
    default:
      if (field instanceof PDFButton) return "Push button";
      if (field instanceof PDFSignature) return "Signature field";
      return "Unsupported field";
  }
}

/** Run a pdf-lib read that could theoretically throw, with a safe fallback. */
function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/**
 * A choice field's options as `/Opt` stores them: the EXPORT value a form's
 * data carries in `/V`, and the DISPLAY text a reader shows. pdf-lib's
 * `getOptions()` returns only the display text while `getSelected()` returns
 * the stored export value, so the two never matched on a form that pairs them
 * (`[(US) (United States)]`): the pre-filled answer was refused as "Not an
 * option: US", and a new choice wrote "Bangladesh" into `/V` instead of "BD".
 */
interface ChoiceOption {
  value: string;
  display: string;
}

function choiceOptions(field: PDFDropdown | PDFOptionList): ChoiceOption[] {
  return field.acroField.getOptions().map(({ value, display }) => ({
    value: value.decodeText(),
    display: (display ?? value).decodeText(),
  }));
}

/** The display text for a stored `/V` value (a custom value is its own). */
function displayFor(options: readonly ChoiceOption[], value: string): string {
  return options.find((o) => o.value === value)?.display ?? value;
}

/**
 * The option a supplied choice names, by its display text first (what the
 * runner shows) and then by its export value (what an API caller may send).
 */
function optionFor(
  options: readonly ChoiceOption[],
  choice: string,
): ChoiceOption | undefined {
  return (
    options.find((o) => o.display === choice) ??
    options.find((o) => o.value === choice)
  );
}

/**
 * Redraw the appearance of a field THIS fill changed, and only such a field.
 * The save that follows runs with `updateFieldAppearances: false`, because
 * pdf-lib's default regenerates every field it thinks needs it: a read-only
 * field holding Bengali with no stored appearance threw the raw `WinAnsi
 * cannot encode` and lost the run, and every untouched field without one was
 * redrawn in Helvetica over its author's font. The same rule as pdf-lib's
 * `updateFieldAppearances`, scoped to the fields we wrote.
 */
function redraw(field: PDFField, font: PDFFont): void {
  if (field.needsAppearancesUpdate()) field.defaultUpdateAppearances(font);
}

/**
 * Select `choices` in a choice field so that the reader SHOWS the display text
 * and the form's data holds the EXPORT value. pdf-lib's `select()` writes the
 * string it is given into `/V`, and turns on free typing for one outside its
 * display list, so it is given the display texts, the appearance is drawn
 * from them, and only then is `/V` rewritten with the export values.
 */
function selectChoices(
  field: PDFDropdown | PDFOptionList,
  choices: readonly string[],
  font: PDFFont,
): void {
  const options = choiceOptions(field);
  const picked = choices.map(
    (c) => optionFor(options, c) ?? { value: c, display: c },
  );
  field.select(picked.map((o) => o.display));
  redraw(field, font);
  // Written straight into `/V`: pdf-lib's `setValues` validates against the
  // display texts and refuses an export value. `/I` (the selected indices)
  // was already set by `select()` and does not change.
  const values = picked.map((o) => PDFHexString.fromText(o.value));
  field.acroField.dict.set(
    PDFName.of("V"),
    values.length === 1 && values[0]
      ? values[0]
      : field.doc.context.obj(values),
  );
}

/** Build safe, display-ready metadata for a single field. */
function describeField(field: PDFField): FormFieldInfo {
  const type = classifyField(field);
  const info: FormFieldInfo = {
    name: field.getName(),
    type,
    widgetLabel: widgetLabel(field, type),
    readOnly: safe(() => field.isReadOnly(), false),
    required: safe(() => field.isRequired(), false),
  };

  if (field instanceof PDFTextField) {
    info.text = safe(() => field.getText() ?? "", "");
    info.multiline = safe(() => field.isMultiline(), false);
    const max = safe<number | undefined>(() => field.getMaxLength(), undefined);
    if (typeof max === "number" && Number.isFinite(max)) info.maxLength = max;
  } else if (field instanceof PDFCheckBox) {
    info.checked = safe(() => field.isChecked(), false);
  } else if (field instanceof PDFRadioGroup) {
    info.options = safe(() => field.getOptions(), []);
    const selected = safe<string | undefined>(
      () => field.getSelected(),
      undefined,
    );
    info.selected = selected ? [selected] : [];
  } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const options = safe(() => choiceOptions(field), []);
    info.options = options.map((o) => o.display);
    info.selected = safe(() => field.getSelected(), []).map((v) =>
      displayFor(options, v),
    );
    info.multiselect = safe(() => field.isMultiselect(), false);
    if (field instanceof PDFDropdown) {
      info.editable = safe(() => field.isEditable(), false);
    }
  }

  return info;
}

/**
 * Inspect a PDF's AcroForm and return safe metadata for every field. A PDF with
 * no form yields `hasFields: false` and an empty list — the caller must not
 * pretend otherwise.
 */
export async function inspectFormFields(
  bytes: Uint8Array,
): Promise<FormInspection> {
  const doc = await loadPdf(bytes);
  const fields = doc.getForm().getFields().map(describeField);
  const fillableCount = fields.filter((f) => isFillableType(f.type)).length;
  return {
    hasFields: fields.length > 0,
    fields,
    fillableCount,
    unsupportedCount: fields.length - fillableCount,
  };
}

/* ------------------------------------------------------------------ *
 *  Value coercion — the UI holds loosely-typed values; the field's
 *  classified type is authoritative for how to interpret them.
 * ------------------------------------------------------------------ */

function toText(value: FieldValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "";
  return value[0] ?? "";
}

function toBool(value: FieldValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "on", "yes", "checked", "1"].includes(
      value.trim().toLowerCase(),
    );
  }
  return value.length > 0;
}

function toChoices(value: FieldValue): string[] {
  if (Array.isArray(value))
    return value.map(String).filter((v) => v.length > 0);
  if (typeof value === "string") return value.length > 0 ? [value] : [];
  return [];
}

/** Apply one supplied value to one already-resolved field. */
function applyToField(
  field: PDFField,
  info: FormFieldInfo,
  value: FieldValue,
  font: PDFFont,
): FieldApplyOutcome {
  const { name, type } = info;

  if (type === "unsupported") {
    return {
      name,
      type,
      status: "skipped",
      detail: `${info.widgetLabel} can't be filled`,
    };
  }
  if (info.readOnly) {
    return { name, type, status: "skipped", detail: "Read-only field" };
  }

  const options = info.options ?? [];

  try {
    switch (type) {
      case "text": {
        const text = toText(value);
        if (info.maxLength !== undefined && text.length > info.maxLength) {
          return {
            name,
            type,
            status: "invalid",
            detail: `Exceeds the ${info.maxLength}-character limit`,
          };
        }
        (field as PDFTextField).setText(text);
        redraw(field, font);
        return { name, type, status: "applied" };
      }
      case "checkbox": {
        const checkbox = field as PDFCheckBox;
        if (toBool(value)) checkbox.check();
        else checkbox.uncheck();
        redraw(field, font);
        return { name, type, status: "applied" };
      }
      case "radio": {
        const group = field as PDFRadioGroup;
        const choice = toText(value);
        if (choice === "") {
          group.clear();
          redraw(field, font);
          return { name, type, status: "applied" };
        }
        if (!options.includes(choice)) {
          return {
            name,
            type,
            status: "invalid",
            detail: `"${choice}" is not an option`,
          };
        }
        group.select(choice);
        redraw(field, font);
        return { name, type, status: "applied" };
      }
      case "dropdown": {
        const dropdown = field as PDFDropdown;
        let choices = toChoices(value);
        if (!info.multiselect && choices.length > 1)
          choices = choices.slice(0, 1);
        if (choices.length === 0) {
          dropdown.clear();
          redraw(field, font);
          return { name, type, status: "applied" };
        }
        // A non-editable dropdown must only take listed options; pdf-lib would
        // otherwise silently accept an off-list value and corrupt the choice.
        if (!info.editable) {
          const listed = choiceOptions(dropdown);
          const unknown = choices.filter((c) => !optionFor(listed, c));
          if (unknown.length > 0) {
            return {
              name,
              type,
              status: "invalid",
              detail: `Not an option: ${unknown.join(", ")}`,
            };
          }
        }
        selectChoices(dropdown, choices, font);
        return { name, type, status: "applied" };
      }
      case "optionlist": {
        const list = field as PDFOptionList;
        let choices = toChoices(value);
        if (!info.multiselect && choices.length > 1)
          choices = choices.slice(0, 1);
        if (choices.length === 0) {
          list.clear();
          redraw(field, font);
          return { name, type, status: "applied" };
        }
        const listed = choiceOptions(list);
        const unknown = choices.filter((c) => !optionFor(listed, c));
        if (unknown.length > 0) {
          return {
            name,
            type,
            status: "invalid",
            detail: `Not an option: ${unknown.join(", ")}`,
          };
        }
        selectChoices(list, choices, font);
        return { name, type, status: "applied" };
      }
      default:
        return { name, type, status: "skipped" };
    }
  } catch (err) {
    return {
      name,
      type,
      status: "invalid",
      detail: err instanceof Error ? err.message : "Could not set value",
    };
  }
}

/**
 * Write user-supplied values into a PDF's *existing* AcroForm fields and save a
 * new document. `values` is keyed by field name; each field is filled according
 * to its own type, so an off-list dropdown value or an over-length text value is
 * reported as `invalid` and skipped rather than silently corrupting the form.
 * Fields never mentioned in `values` are left exactly as they were.
 */
export async function applyFormValues(
  bytes: Uint8Array,
  values: Record<string, FieldValue>,
  options: ApplyFormValuesOptions = {},
): Promise<FillFormsResult> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  const fields = form.getFields();
  const byName = new Map(
    fields.map((field) => [
      field.getName(),
      { field, info: describeField(field) },
    ]),
  );

  // Before anything is written. A field value outside the built-in alphabet
  // does not fail where it is set — it fails inside `doc.save()`, where pdf-lib
  // regenerates the field's appearance from the form's own Helvetica and throws
  // the raw string `WinAnsi cannot encode "গ" (0x0997)`. Correct refusal, no
  // usable message, and only after every other field has already been applied.
  assertFormFieldTextDrawable(
    Object.values(values).flatMap((value) =>
      typeof value === "boolean" ? [] : value,
    ),
  );
  const font = form.getDefaultFont();

  const outcomes: FieldApplyOutcome[] = [];
  for (const [name, value] of Object.entries(values)) {
    const entry = byName.get(name);
    if (!entry) {
      outcomes.push({
        name,
        type: "unsupported",
        status: "missing",
        detail: "No such field",
      });
      continue;
    }
    outcomes.push(applyToField(entry.field, entry.info, value, font));
  }

  stampProducer(doc);
  // Only the fields written above were redrawn (see `redraw`); every other
  // field leaves exactly as it came. Pinned by the "audit #15" tests.
  const filledBytes = await doc.save({ updateFieldAppearances: false });
  const appliedCount = outcomes.filter((o) => o.status === "applied").length;
  const flattenRequested = options.flatten === true;
  const unflattened = {
    bytes: filledBytes,
    outcomes,
    appliedCount,
    flattened: false,
    flattenRequested,
  };

  // Flatten from a saved snapshot so a flatten failure can always fall back to
  // the valid, filled document instead of a half-mutated one. The fallback is
  // NOT silent: `flattenRequested` stays true, and the runner says the fields
  // are still editable (pdf-lib throws here on real forms, e.g. a widget that
  // no page lists).
  if (flattenRequested && fields.length > 0) {
    try {
      const flatDoc = await loadPdf(filledBytes);
      flatDoc.getForm().flatten();
      stampProducer(flatDoc);
      return { ...unflattened, bytes: await flatDoc.save(), flattened: true };
    } catch {
      return unflattened;
    }
  }

  return unflattened;
}
