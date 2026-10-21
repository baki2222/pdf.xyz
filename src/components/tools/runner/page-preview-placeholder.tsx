/**
 * What a page preview holds while the page's size is still being read —
 * the editor's first frame after a drop or a paste.
 *
 * Its own component, the SAME shape as the preview that replaces it (a
 * frame and its "Page N preview" line, in the same wrapper), and STILL.
 *
 * It used to be a bare `animate-pulse` <div> returned from each editor's
 * `PagePreview`, which then returned a <div> wrapper in its place — so
 * React kept the DOM node and changed its class, and Chrome reported that
 * node as moved from the viewport's origin (its previous rect taken from
 * the pulse's own layer): 0.1500 at 360 x 800 and 0.1312 at 390 x 844,
 * exactly 180 x 240 px over the screen's area, counted as CLS while the box
 * sat ~1,190 px below the fold. Either half alone stops it (measured
 * 2026-10-20: the old box without its pulse, or with its pulse behind this
 * component's boundary); both are gone here. The matching shape is what
 * holds still where the preview is ON screen: the bare box measured 0.0020
 * (Annotate) and 0.0060 (Redact) at 1280 x 900, this one 0.
 * `e2e/editor-arrival.spec.ts` holds every editor that draws it to ≤ 0.01
 * from the drop.
 */
export function PagePreviewPlaceholder({ pageNumber }: { pageNumber: number }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-wash rounded-sheet aspect-[3/4] w-full max-w-[180px]" />
      <span className="text-muted text-[11px]">Page {pageNumber} preview</span>
    </div>
  );
}
