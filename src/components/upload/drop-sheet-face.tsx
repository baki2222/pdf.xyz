import type { ReactNode } from "react";
import { UploadCloud } from "lucide-react";

/**
 * What a drop sheet's FACE looks like — the label's classes and the words
 * and mark on a `sheet` or `compact` face — with no behaviour and no "use
 * client": the one spelling both the live sheet (`./drop-sheet`) and its
 * server-rendered shell (`./drop-sheet-shell`) draw, so the shell a page
 * shows before the sheet's code arrives is the sheet, to the pixel, and
 * cannot drift from it (`drop-sheet-shell.test.tsx` holds the two markups
 * to one). The box the face sits in is `./drop-sheet-box`.
 */

/**
 * The picker's label on a `sheet` or `compact` face: the whole surface.
 * Joined as written, not through `cn`: nothing here conflicts, so merging
 * returned the same string (checked when it changed, WP-07 re-review) for
 * more code on every tool page.
 */
export const faceClass = (variant: "sheet" | "compact") =>
  `rounded-sheet flex cursor-pointer flex-col items-center justify-center gap-3 border border-dashed text-center transition-colors duration-150 ${variant === "compact" ? "px-4 py-6" : "px-6 py-12"} border-line-strong bg-canvas hover:border-fg/40 group-data-[armed]/sheet:border-accent group-data-[over]/sheet:bg-accent/5 has-[:focus-visible]:border-accent has-[:focus-visible]:ring-accent/40 has-[:focus-visible]:ring-2`;

/** The words and the mark on a `sheet` or `compact` face, inside its label. */
export function SheetFace({
  variant,
  title,
  browse,
  hint,
  hintId,
}: {
  variant: "sheet" | "compact";
  /** A "…, or" that "browse" ends. */
  title: string;
  browse: boolean;
  hint?: ReactNode;
  hintId: string;
}) {
  return (
    <>
      <UploadCloud
        className={`text-muted group-data-[armed]/sheet:text-accent transition-colors ${variant === "compact" ? "size-5" : "size-6"}`}
        strokeWidth={1.5}
        aria-hidden
      />
      <span className="flex flex-col gap-1">
        <span
          className={`text-fg font-medium ${variant === "compact" ? "text-sm" : "text-[15px]"}`}
        >
          {title}
          {browse && (
            <>
              {" "}
              <span className="text-accent underline underline-offset-4">
                browse
              </span>
            </>
          )}
        </span>
        {hint && (
          <span id={hintId} className="text-muted text-xs">
            {hint}
          </span>
        )}
      </span>
    </>
  );
}
