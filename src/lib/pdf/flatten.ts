import type {
  PDFDocument,
  PDFField,
  PDFForm,
  PDFPage,
  PDFRef,
  PDFWidgetAnnotation,
} from "pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { loadPdf, stampProducer } from "./stamp";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import {
  assertFormFieldTextDrawable,
  formTextsDrawnOnRegeneration,
} from "./unicode-font";

/**
 * Flatten a PDF's fillable AcroForm fields into static page content, entirely
 * in-browser. Each field's current appearance is drawn into its page and the
 * interactive field is removed, so the values become permanent and can no
 * longer be edited or cleared in a viewer.
 *
 * HONEST SCOPE: this flattens AcroForm *form fields* only (text inputs,
 * checkboxes, radio groups, dropdowns, list boxes, buttons). It does NOT flatten
 * other annotation types (comments, ink, stamps) or optional-content layers
 * (OCGs) — those are re-saved unchanged. Signature fields are never flattened
 * (see {@link flattenFormFields}), and any field that cannot be drawn is left
 * exactly as it was and REPORTED, never dropped. The runner states all of this.
 *
 * Four ways this used to hand back a file that was not what the panel said —
 * each pinned in `flatten.test.ts`:
 *  - A form filled by a tool that sets `/NeedAppearances true` and writes no
 *    fresh appearance (pdftk's `need_appearances`, many server fillers) shows
 *    its values in every reader, because readers honour the flag. pdf-lib does
 *    not read it: it drew the stale — usually blank — appearance and deleted
 *    the field holding the value. The answers were gone, under "1 form field
 *    flattened".
 *  - One field with nothing to draw (an empty signature box) or a widget on a
 *    page that no longer exists made `form.flatten()` throw, and the whole
 *    document was refused with a message blaming the file.
 *  - `doc.getForm()` silently deletes XFA. A dynamic XFA form (no AcroForm
 *    fields, a "Please wait…" shell page) was "re-saved" into that shell page.
 *  - A PDF with no fields at all got a success panel and a "-flattened" name.
 */

/** A field left exactly as it was, and why. */
export interface FlattenSkip {
  name: string;
  reason: string;
}

export interface FlattenResult {
  bytes: Uint8Array;
  /** How many AcroForm fields were actually drawn into page content. */
  flattenedFields: number;
  /** How many AcroForm fields the source had (flattened + skipped). */
  totalFields: number;
  /** Whether the source contained any AcroForm fields. */
  hadForm: boolean;
  /** Fields left untouched and still interactive, with the reason for each. */
  skipped: FlattenSkip[];
  /** Whether the source carried a filled digital signature. */
  signed: boolean;
  /** Whether an XFA layer was present and removed (hybrid forms only). */
  droppedXfa: boolean;
}

/** What the runner shows before anything runs. */
export interface FormInspection {
  /** All AcroForm fields, signature fields included. */
  fields: number;
  /** Signature fields — never flattened, always left as-is. */
  signatureFields: number;
  /** Whether any signature field carries a signature (`/V`). */
  signed: boolean;
  /** Whether the AcroForm carries an XFA layer. */
  xfa: boolean;
  /**
   * A dynamic XFA form: the pages are a placeholder and the real form lives
   * only in the XFA, which no browser engine renders. Refused, never saved.
   */
  dynamicXfa: boolean;
}

/** The refusal for a dynamic XFA form — shown by the runner and the engine. */
export const DYNAMIC_XFA_MESSAGE =
  "This is a dynamic XFA form. Its content only exists in a format browsers can't render or flatten, so saving it here would leave just its placeholder page. Open it in Adobe Acrobat Reader and print it to PDF instead.";

/** A sensible download name for a flattened document, derived from the source. */
export function flattenedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "flattened");
}

/**
 * The name the download actually gets. A file in which nothing was flattened
 * must not be called "-flattened": that name is a claim about its content.
 */
export function flattenDownloadName(
  sourceName: string,
  result: Pick<FlattenResult, "flattenedFields">,
): string {
  return result.flattenedFields > 0
    ? flattenedOutputName(sourceName)
    : outputName(sourceName || "document", "resaved");
}

interface XfaState {
  xfa: boolean;
  needsRendering: boolean;
}

/**
 * Read the XFA state from the RAW catalog. This must run before
 * `doc.getForm()`, which deletes the XFA entry as a side effect — asking the
 * form API would always answer "no XFA".
 */
function readXfa(doc: PDFDocument, lib: PdfLibModule): XfaState {
  const { PDFBool, PDFDict, PDFName } = lib;
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  const xfa = acroForm instanceof PDFDict && acroForm.has(PDFName.of("XFA"));
  const flag = doc.catalog.lookup(PDFName.of("NeedsRendering"));
  return { xfa, needsRendering: flag instanceof PDFBool && flag.asBoolean() };
}

function isDynamicXfa(state: XfaState, fields: number): boolean {
  return state.xfa && (state.needsRendering || fields === 0);
}

function signatureState(
  fields: readonly PDFField[],
  lib: PdfLibModule,
): { signatureFields: number; signed: boolean } {
  const signatures = fields.filter((f) => f instanceof lib.PDFSignature);
  return {
    signatureFields: signatures.length,
    signed: signatures.some(
      (f) =>
        f.acroField.dict.lookup(lib.PDFName.of("V")) instanceof lib.PDFDict,
    ),
  };
}

/** Inspect a PDF's form before running anything. */
export async function inspectForm(bytes: Uint8Array): Promise<FormInspection> {
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const xfa = readXfa(doc, lib);
  const fields = doc.getForm().getFields();
  return {
    fields: fields.length,
    ...signatureState(fields, lib),
    xfa: xfa.xfa,
    dynamicXfa: isDynamicXfa(xfa, fields.length),
  };
}

interface PlacedWidget {
  page: PDFPage;
  appearance: PDFRef;
  widget: PDFWidgetAnnotation;
}

/**
 * The page a widget sits on. Its `/P` first, then any page whose `/Annots`
 * lists it — the same order pdf-lib uses, but answering `undefined` instead of
 * throwing, so one orphaned widget cannot take the whole document down.
 */
function widgetPage(
  doc: PDFDocument,
  widget: PDFWidgetAnnotation,
): PDFPage | undefined {
  const pages = doc.getPages();
  const pageRef = widget.P();
  const byP = pages.find((page) => page.ref === pageRef);
  if (byP) return byP;
  const widgetRef = doc.context.getObjectRef(widget.dict);
  return widgetRef ? doc.findPageForAnnotationRef(widgetRef) : undefined;
}

/**
 * The appearance stream a widget shows right now, or `undefined`. Mirrors
 * pdf-lib's own choice (a checkbox/radio picks its state from the field's
 * `/V`, falling back to `/Off`) WITHOUT `getNormalAppearance()`, which writes
 * an empty `/AP` into a widget that had none — a mutation of a field this
 * function may be about to leave untouched.
 */
function widgetAppearance(
  field: PDFField,
  widget: PDFWidgetAnnotation,
  lib: PdfLibModule,
): PDFRef | undefined {
  const { PDFCheckBox, PDFDict, PDFName, PDFRadioGroup, PDFRef } = lib;
  const ap = widget.dict.lookup(PDFName.of("AP"));
  if (!(ap instanceof PDFDict)) return undefined;
  let normal = ap.get(PDFName.of("N"));
  if (
    normal instanceof PDFRef &&
    (field instanceof PDFCheckBox || field instanceof PDFRadioGroup)
  ) {
    // A ref to a state dictionary: resolve through it.
    const resolved = ap.lookup(PDFName.of("N"));
    if (resolved instanceof PDFDict) normal = resolved;
  }
  if (
    normal instanceof PDFDict &&
    (field instanceof PDFCheckBox || field instanceof PDFRadioGroup)
  ) {
    const value = field.acroField.getValue();
    normal = normal.get(value) ?? normal.get(PDFName.of("Off"));
  }
  return normal instanceof PDFRef ? normal : undefined;
}

/** Why a field was left as-is, in words a person filling forms uses. */
const SKIP = {
  emptySignature: "empty signature box, left for signing",
  signature: "digital signature, kept as a signature field",
  noPage: "its box isn't on any page of this PDF",
  noAppearance: "it has no appearance to draw",
  undrawable: "its value couldn't be drawn",
} as const;

/** Draw one resolved widget into its page, exactly as pdf-lib's flatten does. */
function drawWidget(placed: PlacedWidget, lib: PdfLibModule): void {
  const { page, appearance, widget } = placed;
  const key = page.node.newXObject("FlatWidget", appearance);
  const rect = widget.getRectangle();
  const operators = [
    lib.pushGraphicsState(),
    lib.translate(rect.x, rect.y),
    ...lib.rotateInPlace({ ...rect, rotation: 0 }),
    lib.drawObject(key),
    lib.popGraphicsState(),
  ].filter(Boolean);
  page.pushOperators(...operators);
}

/**
 * Remove a flattened field and ITS widget annotations. pdf-lib's `removeField`
 * removes the widget's APPEARANCE ref from `/Annots` (a no-op) and then deletes
 * the kid widgets from the document, which leaves `/Annots` pointing at objects
 * that no longer exist whenever a field has separate widget kids. This removes
 * the widget annotation refs themselves, from the pages they were found on.
 */
function removeFlattenedField(
  doc: PDFDocument,
  form: PDFForm,
  field: PDFField,
  placed: readonly PlacedWidget[],
  lib: PdfLibModule,
): void {
  const pages = new Set<PDFPage>();
  for (const { page, widget } of placed) {
    pages.add(page);
    const ref = doc.context.getObjectRef(widget.dict);
    if (ref) page.node.removeAnnot(ref);
  }
  for (const page of pages) page.node.removeAnnot(field.ref);
  form.acroForm.removeField(field.acroField);
  const kids = field.acroField.Kids();
  for (let i = 0; i < (kids?.size() ?? 0); i += 1) {
    const kid = kids?.get(i);
    if (kid instanceof lib.PDFRef) doc.context.delete(kid);
  }
  doc.context.delete(field.ref);
}

export interface FlattenFieldsOutcome {
  flattened: string[];
  skipped: FlattenSkip[];
  signed: boolean;
}

/**
 * Flatten every AcroForm field that can be flattened, one field at a time.
 *
 * A field is drawn only when EVERY one of its widgets resolves to a page and an
 * appearance; otherwise nothing of it is drawn and it is left exactly as it
 * was — still interactive, value intact — and reported in `skipped`. Half a
 * field drawn plus a live field on top is worse than either.
 *
 * Signature fields are always left as-is. An empty one is a box someone still
 * has to sign. A filled one is already invalidated by any re-save; kept as a
 * signature field, a reader says so, whereas drawn into the page it would look
 * signed and prove nothing.
 *
 * When the form says `/NeedAppearances true`, the stored appearances are not
 * what a reader shows — the reader regenerates them from the values. So every
 * value-bearing field is marked dirty and regenerated from its value first.
 * Without the flag, authored appearances are kept: that is what readers show.
 *
 * A field skipped as "couldn't be drawn" is still dirty, so `flattenPdf` saves
 * with `updateFieldAppearances: false` — a plain `save()` would regenerate it
 * and throw outside every try. That, the catch below, and the "no appearance"
 * arm are pinned through `flattenPdf` by the "is skipped with its reason; the
 * rest of the form still flattens" tests in `flatten.test.ts`.
 */
export function flattenFormFields(
  doc: PDFDocument,
  lib: PdfLibModule,
): FlattenFieldsOutcome {
  const { PDFBool, PDFDropdown, PDFName, PDFOptionList, PDFSignature } = lib;
  const { PDFTextField } = lib;
  const form = doc.getForm();
  const fields = form.getFields();
  const { signed } = signatureState(fields, lib);

  const flag = form.acroForm.dict.lookup(PDFName.of("NeedAppearances"));
  if (flag instanceof PDFBool && flag.asBoolean()) {
    for (const field of fields) {
      if (
        field instanceof PDFTextField ||
        field instanceof PDFDropdown ||
        field instanceof PDFOptionList
      ) {
        form.markFieldAsDirty(field.ref);
      }
    }
  }

  // Everything that will be drawn with the form's WinAnsi font, checked AFTER
  // the dirty-marking above (which is what makes a flagged field "need" a
  // redraw) and before anything is touched, so a Bengali value is refused with
  // a message that names it rather than skipped with "couldn't be drawn". A
  // field whose authored appearance will be drawn as-is is not checked: the
  // font never sees its value. Pinned both ways in `flatten.test.ts`.
  assertFormFieldTextDrawable(formTextsDrawnOnRegeneration(fields, lib));

  const font = form.getDefaultFont();
  const flattened: string[] = [];
  const skipped: FlattenSkip[] = [];

  for (const field of fields) {
    const name = field.getName();
    if (field instanceof PDFSignature) {
      const hasValue =
        field.acroField.dict.lookup(PDFName.of("V")) instanceof lib.PDFDict;
      skipped.push({
        name,
        reason: hasValue ? SKIP.signature : SKIP.emptySignature,
      });
      continue;
    }
    try {
      if (field.needsAppearancesUpdate()) field.defaultUpdateAppearances(font);
    } catch {
      skipped.push({ name, reason: SKIP.undrawable });
      continue;
    }

    const placed: PlacedWidget[] = [];
    let reason: string | null = null;
    for (const widget of field.acroField.getWidgets()) {
      const page = widgetPage(doc, widget);
      if (!page) {
        reason = SKIP.noPage;
        break;
      }
      const appearance = widgetAppearance(field, widget, lib);
      if (!appearance) {
        reason = SKIP.noAppearance;
        break;
      }
      placed.push({ page, appearance, widget });
    }
    if (reason !== null) {
      skipped.push({ name, reason });
      continue;
    }

    for (const widget of placed) drawWidget(widget, lib);
    removeFlattenedField(doc, form, field, placed, lib);
    flattened.push(name);
  }

  return { flattened, skipped, signed };
}

/**
 * Flatten every AcroForm field into page content. When the PDF has no form
 * fields this is honest about it: nothing is flattened, and the document is
 * simply re-saved (with our metadata) so the tool still produces a valid file.
 * A dynamic XFA form is refused: re-saving it would keep only its placeholder.
 */
export async function flattenPdf(bytes: Uint8Array): Promise<FlattenResult> {
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const xfa = readXfa(doc, lib);
  // getForm() deletes the XFA; the state above was read first, on purpose.
  const totalFields = doc.getForm().getFields().length;
  if (isDynamicXfa(xfa, totalFields)) {
    throw new PdfEngineError(DYNAMIC_XFA_MESSAGE);
  }
  if (xfa.xfa) {
    // pdf-lib removes /XFA but leaves the catalog's /NeedsRendering, which
    // tells a reader to go looking for an XFA layer that is no longer there.
    doc.catalog.delete(lib.PDFName.of("NeedsRendering"));
  }

  let outcome: FlattenFieldsOutcome = {
    flattened: [],
    skipped: [],
    signed: false,
  };
  if (totalFields > 0) {
    try {
      outcome = flattenFormFields(doc, lib);
    } catch (error) {
      if (error instanceof PdfEngineError) throw error;
      throw new PdfEngineError(
        "This PDF's form fields couldn't be flattened — they may use features we can't render yet.",
      );
    }
  }

  stampProducer(doc);
  const out = await doc.save({ updateFieldAppearances: false });
  return {
    bytes: out,
    flattenedFields: outcome.flattened.length,
    totalFields,
    hadForm: totalFields > 0,
    skipped: outcome.skipped,
    signed: outcome.signed,
    droppedXfa: xfa.xfa,
  };
}
