import {
  signatureBlockFields,
  type RequestSignatureField,
  type RequestSignatureFieldType,
} from "@/lib/jobs/request-signatures";

/**
 * Request Signatures' box layout, as the placement editor edits it (audit #21,
 * 2026-11-17). Pure numbers: no pdf-lib, no React, no sentences.
 *
 * THE UNIT is the request contract's own, and there is no second one: a box is
 * `(x, y, width, height)` in fractions 0..1 of the page AS DISPLAYED (its
 * CropBox turned by `/Rotate`), from the bottom-left, y up
 * (`RequestSignatureField`). The worker resolves exactly these against the
 * same visible frame (`native.ts` → `placeVisibleRect`), so a box drawn with
 * `left: x%`, `bottom: y%` is where the field lands; the round trip through
 * the real engine and pdf.js is `native.integration.test.ts`.
 *
 * Sizes and steps are in POINTS of the visible frame, converted per page, so a
 * signature box is the same physical size on Letter, A4 or a landscape page.
 * Every operation ends in {@link clampField}: the parser's bounds
 * (`parseSignatureRequestOptions`) are what `request-layout.test.ts` holds
 * every output to, over a random corpus.
 */

/** A page's visible frame size in points (`VisiblePageFrame` has it). */
export interface FrameSize {
  width: number;
  height: number;
}

/** One box in the editor: the contract's field, owned by a signer ROW id. */
export interface LayoutField {
  /** Stable key, never reused within a layout. */
  id: number;
  /** The signer row's stable id — never an index, so a blank row cannot shift ownership. */
  owner: number;
  /** 1-based page. */
  page: number;
  type: RequestSignatureFieldType;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export type PresetKey = "signature" | "initials" | "date" | "name" | "text";

export interface Preset {
  type: RequestSignatureFieldType;
  label?: string;
  /** Default size, points. */
  width: number;
  height: number;
}

/** What each Add a box button adds. The contract has no name type: Name is a labelled text box. */
export const PRESETS: Readonly<Record<PresetKey, Preset>> = {
  signature: { type: "signature", width: 200, height: 40 },
  initials: { type: "initials", width: 60, height: 36 },
  date: { type: "date", width: 110, height: 24 },
  name: { type: "text", label: "Name", width: 180, height: 24 },
  text: { type: "text", width: 180, height: 24 },
};

export const PRESET_ORDER: readonly PresetKey[] = [
  "signature",
  "initials",
  "date",
  "name",
  "text",
];

/** Smallest box, points: below 12 pt high no legible text fits. */
export const MIN_FIELD_PT = { width: 24, height: 12 } as const;

/** Arrow-key steps, points: the same as Edit PDF's (`editor/model.ts`, pinned by test). */
export const STEP_PT = 1;
export const STEP_BIG_PT = 10;

/** Offset of each further new box on a page, points, so two adds never stack. */
const CASCADE_PT = 12;

/**
 * The least extent, points, a box claims on its page when a new box is
 * placed: 40 pt is at least 24 CSS px on a sheet drawn at 0.6 px/pt or more
 * (a turned Letter page at the editor's 420 px).
 */
export const CLEARANCE_PT = 40;

/**
 * Ten signer colours, each at least 4.5:1 against white (the sheet is always
 * the white page): `request-layout.test.ts` computes the ratios. Colour is
 * the SECOND cue; every box also says its signer number and type in text.
 */
export const SIGNER_COLOURS: readonly string[] = [
  "#1d4ed8",
  "#b91c1c",
  "#047857",
  "#6d28d9",
  "#9a3412",
  "#be185d",
  "#0e7490",
  "#3f6212",
  "#854d0e",
  "#334155",
];

export const signerColour = (index: number): string =>
  SIGNER_COLOURS[
    ((index % SIGNER_COLOURS.length) + SIGNER_COLOURS.length) %
      SIGNER_COLOURS.length
  ]!;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const ceil4 = (n: number) => Math.ceil(n * 1e4 - 1e-9) / 1e4;
const finite = (n: number, fallback: number) =>
  Number.isFinite(n) ? n : fallback;

/** The minimum box as fractions of this frame (the whole page when it is smaller). */
export function minFraction(frame: FrameSize): FrameSize {
  return {
    width: Math.min(1, MIN_FIELD_PT.width / frame.width),
    height: Math.min(1, MIN_FIELD_PT.height / frame.height),
  };
}

/**
 * The one ending of every operation: size between the minimum and the page,
 * then position inside [0, 1 − size] on both axes, then 4 decimals (1e-4 of an
 * A3 side is 0.12 pt) — re-clamped after rounding so it can never push a box
 * past the parser's bound. A box pushed past an edge stops there; it does not
 * shrink.
 */
export function clampField(field: LayoutField, frame: FrameSize): LayoutField {
  const min = minFraction(frame);
  const size = (value: number, least: number) => {
    let v = round4(Math.min(1, Math.max(least, finite(value, least))));
    if (v < least) v = ceil4(least);
    return Math.min(1, v);
  };
  const width = size(field.width, min.width);
  const height = size(field.height, min.height);
  const place = (value: number, extent: number) => {
    const most = round4(1 - extent);
    const v = round4(Math.max(0, Math.min(finite(value, 0), 1 - extent)));
    return Math.max(0, Math.min(v, most));
  };
  return {
    ...field,
    width,
    height,
    x: place(field.x, width),
    y: place(field.y, height),
  };
}

/** Move by a fraction of the page (screen y runs down; pass −dy for a drag). */
export function moveField(
  field: LayoutField,
  dx: number,
  dy: number,
  frame: FrameSize,
): LayoutField {
  return clampField({ ...field, x: field.x + dx, y: field.y + dy }, frame);
}

/** Move by points of the visible frame (the arrow keys). */
export function nudgeField(
  field: LayoutField,
  dxPt: number,
  dyPt: number,
  frame: FrameSize,
): LayoutField {
  return moveField(field, dxPt / frame.width, dyPt / frame.height, frame);
}

/**
 * Grow by fractions of the page from the displayed BOTTOM-RIGHT corner: the
 * displayed top-left stays put, so a taller box's bottom edge moves down.
 */
export function resizeField(
  field: LayoutField,
  dWidth: number,
  dHeight: number,
  frame: FrameSize,
): LayoutField {
  const min = minFraction(frame);
  const top = field.y + field.height;
  const width = Math.max(
    min.width,
    Math.min(field.width + dWidth, 1 - field.x),
  );
  const height = Math.max(min.height, Math.min(field.height + dHeight, top));
  return clampField({ ...field, width, height, y: top - height }, frame);
}

/** Resize by points (the handle's arrow keys): Right/Down grow. */
export function resizeFieldPt(
  field: LayoutField,
  dWidthPt: number,
  dHeightPt: number,
  frame: FrameSize,
): LayoutField {
  return resizeField(
    field,
    dWidthPt / frame.width,
    dHeightPt / frame.height,
    frame,
  );
}

const nextId = (layout: readonly LayoutField[]) =>
  layout.reduce((most, f) => Math.max(most, f.id), 0) + 1;

/**
 * Add one preset box for `owner` on `page`: centred, then cascaded 12 pt
 * right and down while it would touch another box on that page (see
 * {@link CLEARANCE_PT}), stopping at the page's edge; clamped.
 */
export function addField(
  layout: readonly LayoutField[],
  preset: PresetKey,
  owner: number,
  page: number,
  frame: FrameSize,
  /**
   * The clearance, points, when the sheet as drawn needs more than
   * {@link CLEARANCE_PT} (a phone draws a page smaller, so 24 CSS px is more
   * points); never less than it.
   */
  clearancePt?: number,
): LayoutField[] {
  const clear = Math.max(
    CLEARANCE_PT,
    Number.isFinite(clearancePt) ? clearancePt! : 0,
  );
  const p = PRESETS[preset];
  const width = p.width / frame.width;
  const height = p.height / frame.height;
  let field = clampField(
    {
      id: nextId(layout),
      owner,
      page,
      type: p.type,
      x: 0.5 - width / 2,
      y: 0.5 - height / 2,
      width,
      height,
      ...(p.label ? { label: p.label } : {}),
    },
    frame,
  );
  // Two boxes "touch" when their rectangles, each grown about its centre to
  // at least CLEARANCE_PT, overlap: a box drawn small on screen is still a
  // 24 px target there, and a new one must not land on another's target.
  const span = (f: LayoutField) => {
    const w = Math.max(f.width, clear / frame.width);
    const h = Math.max(f.height, clear / frame.height);
    const cx = f.x + f.width / 2;
    const cy = f.y + f.height / 2;
    return { l: cx - w / 2, r: cx + w / 2, b: cy - h / 2, t: cy + h / 2 };
  };
  const taken = (f: LayoutField) => {
    const a = span(f);
    return layout.some((o) => {
      if (o.page !== page) return false;
      const c = span(o);
      return (
        a.l < c.r - 1e-9 &&
        c.l < a.r - 1e-9 &&
        a.b < c.t - 1e-9 &&
        c.b < a.t - 1e-9
      );
    });
  };
  for (let i = 0; i < 60 && taken(field); i += 1) {
    const next = nudgeField(field, CASCADE_PT, -CASCADE_PT, frame);
    if (next.x === field.x && next.y === field.y) break;
    field = next;
  }
  return [...layout, field];
}

/**
 * The box a signer added while the layout is customised starts with: a
 * signature box in the starting block's column, just above the highest box
 * already there on that page.
 */
export function addStarterField(
  layout: readonly LayoutField[],
  owner: number,
  page: number,
  frame: FrameSize,
): LayoutField[] {
  const [model] = signatureBlockFields(1, page, false);
  const column = layout.filter(
    (f) => f.page === page && Math.abs(f.x - model!.x) < 0.02,
  );
  const y = column.length
    ? Math.max(...column.map((f) => f.y + f.height)) + 0.01
    : model!.y;
  return [
    ...layout,
    clampField(
      {
        id: nextId(layout),
        owner,
        page,
        type: "signature",
        x: model!.x,
        y,
        width: model!.width,
        height: model!.height,
      },
      frame,
    ),
  ];
}

/**
 * The layout the request carries before anyone touches it, BUILT FROM
 * `signatureBlockFields` (one definition): signer index i is owned by
 * `ownerIds[i]`. Values are kept exactly, so the untouched request is
 * byte-identical to the one sent before the editor existed.
 */
export function startingLayout(
  ownerIds: readonly number[],
  page: number,
  includeDate: boolean,
): LayoutField[] {
  return signatureBlockFields(ownerIds.length, page, includeDate).map(
    (f, i) => ({
      id: i + 1,
      owner: ownerIds[f.signer]!,
      page: f.page,
      type: f.type,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
    }),
  );
}

/**
 * The request's fields: each box's owner row id mapped to its index in the
 * signers sent. A box whose owner is not sent is left out HERE only because
 * the panel blocks Prepare on it first (`orphanBoxes`), in words. Labels are
 * passed as typed; the client's options builder makes them sendable
 * (`requestSignaturesJobOptions`), the one place free text is normalised.
 */
export function toRequestFields(
  layout: readonly LayoutField[],
  ownerIndex: ReadonlyMap<number, number>,
): RequestSignatureField[] {
  const out: RequestSignatureField[] = [];
  for (const f of layout) {
    const signer = ownerIndex.get(f.owner);
    if (signer === undefined) continue;
    const label = f.label?.trim() ?? "";
    out.push({
      signer,
      page: f.page,
      type: f.type,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      ...(label ? { label } : {}),
      required: true,
    });
  }
  return out;
}

/** Boxes whose owner is not among the signers sent. */
export function orphanBoxes(
  layout: readonly LayoutField[],
  ownerIndex: ReadonlyMap<number, number>,
): LayoutField[] {
  return layout.filter((f) => !ownerIndex.has(f.owner));
}

/** Page, then the page as displayed top to bottom, then left to right: Tab's order. */
export function readingOrder<T extends LayoutField>(fields: readonly T[]): T[] {
  return [...fields].sort(
    (a, b) =>
      a.page - b.page ||
      1 - a.y - a.height - (1 - b.y - b.height) ||
      a.x - b.x ||
      a.id - b.id,
  );
}
