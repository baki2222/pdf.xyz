import { cn } from "@/lib/utils";

/**
 * A drop sheet's BOX — the crop-marked surface every sheet and desk is
 * drawn on — with no behaviour and no "use client", for the live sheet
 * (`./drop-sheet`), a desk (`./drop-desk`) and the server-drawn shell
 * (`./drop-sheet-shell`) alike.
 *
 * Its own module, not the face's (`./drop-sheet-face`): a desk draws the
 * box and its owner's body, never the sheet's face, and a module is shipped
 * whole — so a desk that took the box from the face carried the face's
 * component, its class strings and its icon into the home page's first load
 * (WP-07 re-review).
 */

export type SheetVariant = "sheet" | "compact" | "desk";

/** The sheet's own box: a column of its face, or a desk's own body. */
export const sheetClass = (variant: SheetVariant, className?: string) =>
  cn(
    "crop-marks group/sheet rounded-sheet relative scroll-mt-24",
    variant !== "desk" && "flex flex-col",
    className,
  );
