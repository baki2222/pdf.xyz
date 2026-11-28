import type { isolatePageContent as IsolatePageContent } from "./content-isolation";
import type {
  PDFDict,
  PDFDocument,
  PDFField,
  PDFForm,
  PDFPage,
  PDFRef,
  PDFWidgetAnnotation,
} from "pdf-lib";
import {
  ANNOT_HIDDEN,
  ANNOT_NO_VIEW,
  isDynamicXfa,
  readXfa,
} from "./annot-flags";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { repairFieldTree } from "./form-tree";
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
 * HONEST SCOPE: by default this flattens AcroForm *form fields* only (text
 * inputs, checkboxes, radio groups, dropdowns, list boxes, buttons). With
 * `annotations: true` (audit flatten-pdf#3, 2026-11-22) it also draws every
 * visible annotation that is not a Link, a widget or a pop-up into its page
 * and removes it — see {@link flattenAnnotations}. Optional-content layers
 * (OCGs) are re-saved unchanged either way. Signature fields are never flattened
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

export interface FlattenOptions {
  /**
   * Also draw comments and markup (highlights, ink, stamps, free text, notes,
   * shapes) into the page and remove them. Off by default: fields only.
   */
  annotations?: boolean;
}

export interface FlattenResult {
  bytes: Uint8Array;
  /** Annotations drawn into their pages and removed (0 unless asked). */
  flattenedAnnotations: number;
  /** Annotations left exactly as they were, and why (only when asked). */
  annotationsLeft: FlattenSkip[];
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
  /**
   * Comments and markup "Also flatten comments and markup" would act on:
   * every annotation that is not a Link, a form widget or a pop-up.
   */
  annotations: number;
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
  result: Pick<FlattenResult, "flattenedFields"> &
    Partial<Pick<FlattenResult, "flattenedAnnotations">>,
): string {
  return result.flattenedFields > 0 || (result.flattenedAnnotations ?? 0) > 0
    ? flattenedOutputName(sourceName)
    : outputName(sourceName || "document", "resaved");
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
  repairFieldTree(lib, doc);
  const fields = doc.getForm().getFields();
  return {
    fields: fields.length,
    ...signatureState(fields, lib),
    xfa: xfa.xfa,
    dynamicXfa: isDynamicXfa(xfa, fields.length),
    annotations: doc.getPages().reduce((sum, page) => {
      const annots = page.node.lookup(lib.PDFName.of("Annots"));
      if (!(annots instanceof lib.PDFArray)) return sum;
      let count = 0;
      for (let i = 0; i < annots.size(); i += 1) {
        const dict = annots.lookup(i);
        const subtype =
          dict instanceof lib.PDFDict
            ? dict.lookup(lib.PDFName.of("Subtype"))
            : undefined;
        if (subtype instanceof lib.PDFName && isDrawnKind(subtype.decodeText()))
          count += 1;
      }
      return sum + count;
    }, 0),
  };
}

interface PlacedWidget {
  page: PDFPage;
  /** `undefined` for a widget no reader shows: removed, never drawn. */
  appearance: PDFRef | undefined;
  widget: PDFWidgetAnnotation;
}

/**
 * Whether a reader shows this widget at all. A Hidden or NoView widget (a
 * calculation helper, an "office use only" overlay, a template hidden by form
 * script) was never on screen, so drawing it into the page would ADD content
 * the reader never displayed. Acrobat's flatten and pdf.js both honour these.
 */
function widgetIsViewable(widget: PDFWidgetAnnotation): boolean {
  const flags = widget.getFlags();
  return (flags & (ANNOT_HIDDEN | ANNOT_NO_VIEW)) === 0;
}

/**
 * A field none of whose widgets a reader shows. It is removed without being
 * drawn, so its value never meets the form's font: it is left out of the
 * alphabet check and of the appearance regeneration, either of which would
 * otherwise refuse the job, or keep the field interactive, over text nobody
 * would ever see. Pinned by the "hidden field's value is never drawn" tests.
 */
function fieldIsUnseen(field: PDFField): boolean {
  const widgets = field.acroField.getWidgets();
  return widgets.length > 0 && !widgets.some(widgetIsViewable);
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
  hidden: "hidden, so there is nothing to draw",
} as const;

type Matrix = [number, number, number, number, number, number];

/** A numeric array entry of `dict` with exactly `length` numbers, or undefined. */
function numbers(
  dict: PDFDict,
  key: string,
  length: number,
  lib: PdfLibModule,
): number[] | undefined {
  const value = dict.lookup(lib.PDFName.of(key));
  if (!(value instanceof lib.PDFArray) || value.size() !== length) {
    return undefined;
  }
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const item = value.lookup(i);
    if (!(item instanceof lib.PDFNumber)) return undefined;
    out.push(item.asNumber());
  }
  return out;
}

/**
 * The matrix that places an appearance stream on its annotation Rect — the
 * algorithm of ISO 32000, 12.5.5. The form's BBox is transformed by its own
 * `/Matrix`; the bounding box of the result is then mapped onto the Rect with
 * a scale and a translation. The form's `/Matrix` itself is applied by the
 * `Do` operator, so only that second mapping goes into `cm`.
 *
 * Translating to the Rect's corner alone (pdf-lib's flatten) is right only
 * when the BBox starts at 0,0, matches the Rect's size and has no rotation:
 * a field Acrobat rotated 90 degrees (`/Matrix [0 1 -1 0 0 0]`) landed one
 * box-width outside its box, and a BBox larger than the Rect overflowed it.
 */
function appearanceToRectMatrix(
  rect: { x: number; y: number; width: number; height: number },
  bbox: readonly number[] | undefined,
  matrix: readonly number[] | undefined,
): Matrix {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] =
    matrix?.length === 6 ? matrix : [];
  const [x0 = 0, y0 = 0, x1 = rect.width, y1 = rect.height] =
    bbox?.length === 4 ? bbox : [];
  const corners = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x = 0, y = 0]) => [a * x + c * y + e, b * x + d * y + f]);
  const xs = corners.map(([x = 0]) => x);
  const ys = corners.map(([, y = 0]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  // A degenerate box has no size to map; keep it unscaled rather than divide by 0.
  const sx = spanX > 0 ? rect.width / spanX : 1;
  const sy = spanY > 0 ? rect.height / spanY : 1;
  return [sx, 0, 0, sy, rect.x - minX * sx, rect.y - minY * sy];
}

/** Draw one resolved widget into its page where a reader shows it (12.5.5). */
function drawWidget(placed: PlacedWidget, lib: PdfLibModule): void {
  const { page, appearance, widget } = placed;
  if (!appearance) return;
  drawAppearance(page, appearance, widget.getRectangle(), lib);
}

/**
 * Draw an appearance stream on `rect` of `page` as a reader does (12.5.5).
 * With `state` (an annotation's /CA, /ca, /BM) the stream is painted as a
 * transparency group under that state, so the opacity applies to the whole
 * appearance at once, as a reader applies /CA, and a `gs` inside the stream
 * cannot override it.
 */
function drawAppearance(
  page: PDFPage,
  appearance: PDFRef,
  rect: { x: number; y: number; width: number; height: number },
  lib: PdfLibModule,
  state?: PDFDict,
): void {
  const stream = page.doc.context.lookup(appearance);
  const dict = stream instanceof lib.PDFStream ? stream.dict : undefined;
  const key = page.node.newXObject("FlatWidget", appearance);
  const placement = appearanceToRectMatrix(
    rect,
    dict && numbers(dict, "BBox", 4, lib),
    dict && numbers(dict, "Matrix", 6, lib),
  );
  const ops = [lib.pushGraphicsState()];
  if (state && dict) {
    if (!dict.has(lib.PDFName.of("Group")))
      dict.set(
        lib.PDFName.of("Group"),
        page.doc.context.obj({ Type: "Group", S: "Transparency" }),
      );
    ops.push(
      lib.setGraphicsState(page.node.newExtGState("FlatAnnotGS", state)),
    );
  }
  page.pushOperators(
    ...ops,
    lib.concatTransformationMatrix(...placement),
    lib.drawObject(key),
    lib.popGraphicsState(),
  );
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
 * A widget no reader shows (annotation flag Hidden or NoView) is removed with
 * its field but never drawn: flattening must not add content nobody saw.
 * Pinned in the "audit #14" tests in `flatten.test.ts`.
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
  assertFormFieldTextDrawable(
    formTextsDrawnOnRegeneration(
      fields.filter((f) => !fieldIsUnseen(f)),
      lib,
    ),
  );

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
      if (!fieldIsUnseen(field) && field.needsAppearancesUpdate())
        field.defaultUpdateAppearances(font);
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
      if (!widgetIsViewable(widget)) {
        // Removed with its field, never drawn: no reader showed it.
        placed.push({ page, appearance: undefined, widget });
        continue;
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
 * Content isolation (`./content-isolation`) runs only when a page is written,
 * so it is imported at call time, as the stamp tools do.
 */
const isolatePageContent = async (
  page: Parameters<typeof IsolatePageContent>[0],
  lib: PdfLibModule,
): ReturnType<typeof IsolatePageContent> =>
  (await import("./content-isolation")).isolatePageContent(page, lib);

/** Annotation kinds never flattened: kept live, or not a mark of their own. */
const KEPT_LIVE = new Set(["Link", "Widget", "Popup"]);

/**
 * Kinds that carry data or are not a drawing: kept as they are and LISTED,
 * because drawing their look and deleting them loses something. A pending
 * redaction drawn in looks done while the text under it stays in the file,
 * and it can no longer be applied (review finding 1, 2026-11-28). An attached
 * file or sound would lose the file; media and 3D would stop playing. Checked
 * against Remove Annotations' groups in `flatten-annotations.test.ts`.
 */
const KEPT_LISTED: ReadonlyMap<string, string> = new Map([
  [
    "Redact",
    "a redaction mark not yet applied, so the text under it is still there; use Redact PDF to remove it",
  ],
  ["FileAttachment", "an attached file, kept so it is not lost"],
  ["Sound", "a sound clip, kept so it is not lost"],
  ["Movie", "a video, kept so it still plays"],
  ["Screen", "a media player, kept so it still plays"],
  ["RichMedia", "a media player, kept so it still plays"],
  ["3D", "a 3D model, kept so it still works"],
]);

/** Whether "Also flatten comments and markup" draws this kind at all. */
const isDrawnKind = (kind: string): boolean =>
  !KEPT_LIVE.has(kind) && !KEPT_LISTED.has(kind);

/**
 * The annotation's own opacity and blend mode (ISO 32000 12.5.2: /CA applies
 * to everything it shows, /ca in PDF 2.0 to fills, /BM its blend), as an
 * ExtGState for the drawn appearance, or `undefined` when it is opaque and
 * normal. Without it a highlight whose look is an opaque box made see-through
 * only by /CA was drawn as a solid block over the text (review findings 4 and
 * 6, 2026-11-28).
 */
function annotationState(
  dict: PDFDict,
  lib: PdfLibModule,
): PDFDict | undefined {
  const { PDFName, PDFNumber } = lib;
  const read = (key: string): number | undefined => {
    const value = dict.lookup(PDFName.of(key));
    return value instanceof PDFNumber
      ? Math.min(1, Math.max(0, value.asNumber()))
      : undefined;
  };
  const stroke = read("CA") ?? 1;
  const fill = read("ca") ?? stroke;
  const blend = dict.lookup(PDFName.of("BM"));
  const hasBlend = blend instanceof PDFName && blend.decodeText() !== "Normal";
  if (stroke === 1 && fill === 1 && !hasBlend) return undefined;
  const state = dict.context.obj({
    Type: "ExtGState",
    CA: stroke,
    ca: fill,
  });
  if (hasBlend) state.set(PDFName.of("BM"), blend);
  return state;
}

/**
 * The appearance an annotation shows right now: its /AP /N stream, or the
 * state its /AS names when /N is a dictionary of states.
 */
function annotationAppearance(
  dict: PDFDict,
  lib: PdfLibModule,
): PDFRef | undefined {
  const { PDFDict, PDFName, PDFRef, PDFStream } = lib;
  const ap = dict.lookup(PDFName.of("AP"));
  if (!(ap instanceof PDFDict)) return undefined;
  const normal = ap.get(PDFName.of("N"));
  const states =
    normal instanceof PDFRef ? dict.context.lookup(normal) : normal;
  if (normal instanceof PDFRef && states instanceof PDFStream) return normal;
  if (!(states instanceof PDFDict)) return undefined;
  const state = dict.lookup(PDFName.of("AS"));
  const chosen = state instanceof PDFName ? states.get(state) : undefined;
  return chosen instanceof PDFRef &&
    dict.context.lookup(chosen) instanceof PDFStream
    ? chosen
    : undefined;
}

/**
 * Draw comments and markup into the page (audit flatten-pdf#3): every
 * annotation on every page that is not a Link (kept clickable), a widget (a
 * form field, handled by {@link flattenFormFields}) or a pop-up (part of its
 * comment) has its current appearance drawn where a reader shows it (ISO
 * 32000 12.5.5, the placement fields use) and is removed, with the pop-up
 * that belongs to it. A sticky note becomes its icon; its text goes with it.
 *
 * Left exactly as they were, and listed: an annotation with no appearance
 * stream (a reader makes one up, and this will not guess what it drew) and a
 * hidden one (nothing on screen to draw). The page's existing content is
 * wrapped first, so a stream that leaves its graphics state changed cannot
 * move or recolour what is drawn after it.
 */
export async function flattenAnnotations(
  doc: PDFDocument,
  lib: PdfLibModule,
): Promise<{ flattened: number; left: FlattenSkip[] }> {
  const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef } = lib;
  let flattened = 0;
  const left: FlattenSkip[] = [];
  for (const [index, page] of doc.getPages().entries()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    const drawn: { dict: PDFDict; appearance: PDFRef; rect: number[] }[] = [];
    for (let i = 0; i < annots.size(); i += 1) {
      const dict = annots.lookup(i);
      if (!(dict instanceof PDFDict)) continue;
      const subtype = dict.lookup(PDFName.of("Subtype"));
      const kind = subtype instanceof PDFName ? subtype.decodeText() : "";
      if (KEPT_LIVE.has(kind)) continue;
      const name = `${kind || "Annotation"} on page ${index + 1}`;
      const keptReason = KEPT_LISTED.get(kind);
      if (keptReason) {
        left.push({ name, reason: keptReason });
        continue;
      }
      const flags = dict.lookup(PDFName.of("F"));
      const bits =
        flags instanceof PDFNumber ? Math.trunc(flags.asNumber()) : 0;
      if ((bits & (ANNOT_HIDDEN | ANNOT_NO_VIEW)) !== 0) {
        left.push({ name, reason: SKIP.hidden });
        continue;
      }
      const appearance = annotationAppearance(dict, lib);
      const rect = numbers(dict, "Rect", 4, lib);
      if (!appearance || !rect) {
        left.push({ name, reason: SKIP.noAppearance });
        continue;
      }
      drawn.push({ dict, appearance, rect });
    }
    if (drawn.length === 0) continue;

    await isolatePageContent(page, lib);
    for (const { dict, appearance, rect } of drawn) {
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect;
      drawAppearance(
        page,
        appearance,
        {
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          width: Math.abs(x1 - x0),
          height: Math.abs(y1 - y0),
        },
        lib,
        annotationState(dict, lib),
      );
      flattened += 1;
    }

    // Keep what was not drawn, minus every pop-up whose comment was drawn.
    const gone = new Set(drawn.map((d) => d.dict));
    const keep = annots.asArray().filter((_, i) => {
      const dict = annots.lookup(i);
      if (!(dict instanceof PDFDict)) return true;
      if (gone.has(dict)) return false;
      const parent = dict.lookup(PDFName.of("Parent"));
      const subtype = dict.lookup(PDFName.of("Subtype"));
      return !(
        subtype instanceof PDFName &&
        subtype.decodeText() === "Popup" &&
        parent instanceof PDFDict &&
        gone.has(parent)
      );
    });
    const removed = annots.asArray().filter((ref) => !keep.includes(ref));
    if (keep.length === 0) page.node.delete(PDFName.of("Annots"));
    else page.node.set(PDFName.of("Annots"), doc.context.obj(keep));
    for (const ref of removed)
      if (ref instanceof PDFRef) doc.context.delete(ref);
  }
  return { flattened, left };
}

/**
 * Flatten every AcroForm field into page content. When the PDF has no form
 * fields this is honest about it: nothing is flattened, and the document is
 * simply re-saved (with our metadata) so the tool still produces a valid file.
 * A dynamic XFA form is refused: re-saving it would keep only its placeholder.
 */
export async function flattenPdf(
  bytes: Uint8Array,
  options: FlattenOptions = {},
): Promise<FlattenResult> {
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const xfa = readXfa(doc, lib);
  repairFieldTree(lib, doc);
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

  const annotations = options.annotations
    ? await flattenAnnotations(doc, lib)
    : { flattened: 0, left: [] };

  stampProducer(doc);
  const out = await doc.save({ updateFieldAppearances: false });
  return {
    bytes: out,
    flattenedAnnotations: annotations.flattened,
    annotationsLeft: annotations.left,
    flattenedFields: outcome.flattened.length,
    totalFields,
    hadForm: totalFields > 0,
    skipped: outcome.skipped,
    signed: outcome.signed,
    droppedXfa: xfa.xfa,
  };
}
