/**
 * The widget box(es) a new form field occupies, in the page's DISPLAYED frame
 * (points from the bottom-left of the page as a reader sees it). ONE
 * function, read by the engine that writes the widgets (`create-forms.ts`:
 * validation and `addOptionToPage`) and by the builder's page preview (the
 * runner hands it the boxes this returns), so the preview cannot draw a radio
 * stack the engine does not build. Moved here from create-forms.ts on
 * 2026-11-17 (backlog #17) so the preview's caller could read it without a
 * new export on the engine; `create-forms-preview.test.tsx` holds the drawn
 * boxes to this function and `create-forms.pdfjs.test.ts` holds them
 * to the widgets pdf.js reads from the saved file.
 */

/** Default vertical gap (points) between the stacked buttons of a radio group. */
export const RADIO_STACK_GAP = 6;

/** One widget's box, in points. */
export interface FieldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of a field spec its boxes are read from. */
export interface BoxedSpec extends FieldBox {
  type: string;
  /** A radio group's options: one stacked button each. */
  options?: readonly string[];
  /** A radio group's gap between buttons (defaults to {@link RADIO_STACK_GAP}). */
  gap?: number;
}

/**
 * Every type is a single box except a radio group, whose buttons stack
 * downward from (x, y) — one per option, each `width`×`height`, separated by
 * `gap` points.
 */
export function fieldBoxes(spec: BoxedSpec): FieldBox[] {
  if (spec.type === "radio") {
    const gap = spec.gap ?? RADIO_STACK_GAP;
    return (spec.options ?? []).map((_, i) => ({
      x: spec.x,
      y: spec.y - i * (spec.height + gap),
      width: spec.width,
      height: spec.height,
    }));
  }
  return [{ x: spec.x, y: spec.y, width: spec.width, height: spec.height }];
}
