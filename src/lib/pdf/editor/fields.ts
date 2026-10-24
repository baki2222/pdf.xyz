import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import type { PdfLibModule } from "../pdf-lib";
import { PdfEngineError } from "../engine";
import { assertFormFieldTextDrawable } from "../unicode-font";
import {
  rectAnchor,
  viewerRectToContent,
  viewerToContent,
  type ExportFrame,
} from "./geometry";
import {
  EDITOR_FIELD_LABEL,
  radioRows,
  type FieldObject,
  type Rect,
} from "./model";
import { refKey } from "./links";

/**
 * Form fields in the editor: the file's own AcroForm fields, read so they
 * can be filled in place, and the editor's new fields, written as real
 * AcroForm fields with pdf-lib's form API — fillable in any PDF reader, not
 * drawn into the page.
 *
 * Appearances: every field this writes or fills gets its appearance drawn
 * HERE, explicitly, and the export saves with `updateFieldAppearances:
 * false`, so the file's other fields are left exactly as they came (the
 * reasoning `create-forms.ts` records: pdf-lib's default would redraw every
 * field lacking an appearance, in Helvetica).
 */

export type FileFieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "optionlist"
  | "signature"
  | "button";

/** A value typed into one of the file's fields. */
export type FieldFill = string | boolean;

export interface FileFieldWidget {
  /** 0-based page of the SOURCE file. */
  source: number;
  /** The widget's box in content space. */
  rect: { x0: number; y0: number; x1: number; y1: number };
  /** A radio button: the option it stands for. */
  option?: string;
}

/** One of the file's own fields, as the editor shows it. */
export interface FileField {
  name: string;
  type: FileFieldType;
  readOnly: boolean;
  multiline: boolean;
  options: string[];
  /** Its value as read: text, the chosen option, or ticked. */
  value: FieldFill;
  widgets: FileFieldWidget[];
}

/** Every field in the file's AcroForm, with where each of its widgets sits. */
export function readFileFields(
  lib: PdfLibModule,
  doc: PDFDocument,
): FileField[] {
  let fields;
  try {
    fields = doc.getForm().getFields();
  } catch {
    return [];
  }
  const pages = doc.getPages();
  const pageOf = new Map(pages.map((p, i) => [refKey(p.ref), i]));
  const annotPage = new Map<string, number>();
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k += 1) {
      const ref = annots.get(k);
      if (ref instanceof lib.PDFRef) annotPage.set(refKey(ref), i);
    }
  });
  const safe = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  const out: FileField[] = [];
  for (const field of fields) {
    let type: FileFieldType = "button";
    let value: FieldFill = "";
    let options: string[] = [];
    let multiline = false;
    if (field instanceof lib.PDFTextField) {
      type = "text";
      value = safe(() => field.getText() ?? "", "");
      multiline = safe(() => field.isMultiline(), false);
    } else if (field instanceof lib.PDFCheckBox) {
      type = "checkbox";
      value = safe(() => field.isChecked(), false);
    } else if (field instanceof lib.PDFRadioGroup) {
      type = "radio";
      options = safe(() => field.getOptions(), []);
      value = safe(() => field.getSelected() ?? "", "");
    } else if (field instanceof lib.PDFDropdown) {
      type = "dropdown";
      options = safe(() => field.getOptions(), []);
      value = safe(() => field.getSelected()[0] ?? "", "");
    } else if (field instanceof lib.PDFOptionList) {
      type = "optionlist";
      options = safe(() => field.getOptions(), []);
      value = safe(() => field.getSelected()[0] ?? "", "");
    } else if (field instanceof lib.PDFSignature) {
      type = "signature";
    }
    const widgets: FileFieldWidget[] = [];
    const list = safe(() => field.acroField.getWidgets(), []);
    list.forEach((widget, i) => {
      const r = safe(() => widget.getRectangle(), null);
      if (!r) return;
      const ref = doc.context.getObjectRef(widget.dict);
      const p = widget.P();
      const source =
        (p ? pageOf.get(refKey(p)) : undefined) ??
        (ref ? annotPage.get(refKey(ref)) : undefined);
      if (source === undefined) return;
      widgets.push({
        source,
        rect: { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height },
        ...(type === "radio" && options[i] !== undefined
          ? { option: options[i] }
          : {}),
      });
    });
    out.push({
      name: field.getName(),
      type,
      readOnly: safe(() => field.isReadOnly(), false),
      multiline,
      options,
      value,
      widgets,
    });
  }
  return out;
}

/** Can the editor fill this kind of field in place? */
export function fillableFileField(field: FileField): boolean {
  return (
    !field.readOnly &&
    (field.type === "text" ||
      field.type === "checkbox" ||
      field.type === "radio" ||
      field.type === "dropdown" ||
      field.type === "optionlist")
  );
}

/**
 * Write the values typed into the file's own fields, by name, and redraw
 * each filled field's appearance. Unknown names, read-only fields and
 * options a field does not list are refused with the field's name — a fill
 * that silently did nothing would be the worst outcome here.
 */
export function fillFileFields(
  lib: PdfLibModule,
  doc: PDFDocument,
  values: Readonly<Record<string, FieldFill>>,
  font: PDFFont,
): number {
  const names = Object.keys(values);
  if (names.length === 0) return 0;
  assertFormFieldTextDrawable(
    Object.values(values).map((v) => (typeof v === "string" ? v : "")),
  );
  const form = doc.getForm();
  let filled = 0;
  for (const name of names) {
    const value = values[name]!;
    const field = form.getFieldMaybe(name);
    if (!field) {
      throw new PdfEngineError(`The form field “${name}” is not in this PDF.`);
    }
    if (field.isReadOnly()) {
      throw new PdfEngineError(`The form field “${name}” is read-only.`);
    }
    const text = typeof value === "string" ? value : value ? "Yes" : "";
    if (field instanceof lib.PDFTextField) {
      const max = field.getMaxLength();
      if (max !== undefined && text.length > max) {
        throw new PdfEngineError(`“${name}” takes at most ${max} characters.`);
      }
      field.setText(text);
      field.defaultUpdateAppearances(font);
    } else if (field instanceof lib.PDFCheckBox) {
      if (value === true || value === "Yes") field.check();
      else field.uncheck();
      field.defaultUpdateAppearances();
    } else if (field instanceof lib.PDFRadioGroup) {
      if (!text) field.clear();
      else if (field.getOptions().includes(text)) field.select(text);
      else throw new PdfEngineError(`“${text}” is not an option of “${name}”.`);
      field.defaultUpdateAppearances();
    } else if (
      field instanceof lib.PDFDropdown ||
      field instanceof lib.PDFOptionList
    ) {
      if (!text) field.clear();
      else if (
        field.getOptions().includes(text) ||
        (field instanceof lib.PDFDropdown && field.isEditable())
      )
        field.select(text);
      else throw new PdfEngineError(`“${text}” is not an option of “${name}”.`);
      field.defaultUpdateAppearances(font);
    } else {
      throw new PdfEngineError(
        `The form field “${name}” can't be filled here.`,
      );
    }
    filled += 1;
  }
  return filled;
}

/** Border width of a new field's widget, points. */
const BORDER = 1;

/** Problems with the new fields, before anything is written. */
export function validateNewFields(
  fields: readonly FieldObject[],
  existingNames: readonly string[],
): string[] {
  const issues: string[] = [];
  const seen = new Set(existingNames);
  for (const f of fields) {
    const label = `${EDITOR_FIELD_LABEL[f.fieldType]} on page ${f.page + 1}`;
    const name = f.name.trim();
    if (!name) {
      issues.push(`The ${label} needs a name.`);
      continue;
    }
    if (name.includes(".")) {
      issues.push(`The field name “${name}” can't contain a full stop.`);
    }
    if (seen.has(name)) {
      issues.push(
        `Two form fields are named “${name}”. Each needs its own name.`,
      );
    }
    seen.add(name);
    const options = f.options.map((o) => o.trim());
    if (f.fieldType === "dropdown" && options.filter(Boolean).length < 1) {
      issues.push(`The dropdown “${name}” needs at least one option.`);
    }
    if (f.fieldType === "radio" && options.filter(Boolean).length < 2) {
      issues.push(`The radio group “${name}” needs at least two options.`);
    }
    if (
      (f.fieldType === "dropdown" || f.fieldType === "radio") &&
      (new Set(options).size !== options.length || options.some((o) => !o))
    ) {
      issues.push(
        `The options of “${name}” must each be different and not empty.`,
      );
    }
    if (
      (f.fieldType === "dropdown" || f.fieldType === "radio") &&
      f.value &&
      !options.includes(f.value)
    ) {
      issues.push(`“${f.value}” is not an option of “${name}”.`);
    }
  }
  return issues;
}

/**
 * Create the editor's new fields. Each one's starting value is set BEFORE
 * its widget is added, so `addToPage` draws the appearance with it (the
 * order `create-forms.ts` explains); a checkbox is ticked after, because
 * `check()` turns on widgets that already exist.
 */
export function writeNewFields(
  lib: PdfLibModule,
  doc: PDFDocument,
  pages: readonly PDFPage[],
  frames: readonly ExportFrame[],
  fields: readonly FieldObject[],
  font: PDFFont,
): number {
  if (fields.length === 0) return 0;
  const form = doc.getForm();
  const existing = form.getFields().map((f) => f.getName());
  const issues = validateNewFields(fields, existing);
  if (issues.length > 0) {
    const rest = issues.length - 1;
    throw new PdfEngineError(
      rest > 0
        ? `${issues[0]} (${rest} more issue${rest === 1 ? "" : "s"}.)`
        : issues[0]!,
    );
  }
  assertFormFieldTextDrawable(
    fields.flatMap((f) => [f.name, f.value, ...f.options]),
  );
  const { degrees, rgb } = lib;
  for (const f of fields) {
    const page = pages[f.page];
    const frame = frames[f.page];
    if (!page || !frame) continue;
    const name = f.name.trim();
    // pdf-lib grows a widget by half its border on every side; the box is
    // inset by that much first, so the widget covers exactly what was drawn.
    const place = (r: Rect) => {
      const inner = {
        x: r.x + BORDER / 2,
        y: r.y + BORDER / 2,
        width: Math.max(1, r.width - BORDER),
        height: Math.max(1, r.height - BORDER),
      };
      return {
        ...rectAnchor(inner, frame),
        width: inner.width,
        height: inner.height,
        rotate: degrees(frame.rotation),
        borderWidth: BORDER,
        font,
      };
    };
    switch (f.fieldType) {
      case "text": {
        const field = form.createTextField(name);
        if (f.multiline) field.enableMultiline();
        if (f.value) field.setText(f.value);
        field.addToPage(page, place(f));
        break;
      }
      case "checkbox": {
        const field = form.createCheckBox(name);
        field.addToPage(page, place(f));
        if (f.checked) field.check();
        break;
      }
      case "dropdown": {
        const field = form.createDropdown(name);
        field.addOptions(f.options.map((o) => o.trim()));
        if (f.value) field.select(f.value);
        field.addToPage(page, place(f));
        break;
      }
      case "radio": {
        const field = form.createRadioGroup(name);
        const rows = radioRows(f);
        f.options.forEach((option, i) => {
          const row = rows[i]!;
          field.addOptionToPage(option.trim(), page, place(row.box));
          // The option's name beside its button, as page text: a radio
          // button alone does not say what it means.
          const at = viewerToContent(row.labelX, row.baseline, frame);
          page.drawText(option.trim(), {
            x: at.x,
            y: at.y,
            size: row.size,
            font,
            rotate: degrees(frame.rotation),
            color: rgb(0.07, 0.09, 0.15),
          });
        });
        if (f.value) field.select(f.value);
        break;
      }
      case "signature": {
        const c = viewerRectToContent(f, frame);
        const w = c.x1 - c.x0;
        const h = c.y1 - c.y0;
        const appearance = doc.context.formXObject(
          [
            lib.pushGraphicsState(),
            lib.setStrokingColor(rgb(0.45, 0.5, 0.6)),
            lib.setLineWidth(1),
            lib.rectangle(0.5, 0.5, Math.max(0, w - 1), Math.max(0, h - 1)),
            lib.stroke(),
            lib.popGraphicsState(),
          ],
          { BBox: [0, 0, w, h] },
        );
        const widget = doc.context.obj({
          Type: "Annot",
          Subtype: "Widget",
          FT: "Sig",
          T: lib.PDFString.of(name),
          Rect: [c.x0, c.y0, c.x1, c.y1],
          F: 4,
          P: page.ref,
          AP: { N: doc.context.register(appearance) },
        });
        const ref = doc.context.register(widget);
        page.node.addAnnot(ref);
        form.acroForm.addField(ref);
        break;
      }
    }
  }
  return fields.length;
}
