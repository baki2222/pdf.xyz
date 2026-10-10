import type { ReactNode } from "react";
import { faceClass, SheetFace, sheetClass } from "./drop-sheet-face";

/**
 * A drop sheet's SHELL: the sheet as the server draws it, for a page whose
 * sheet's code is not in its first load — the guide desk, which a guide's
 * prose does not wait for (`@/components/intent/guide-desk-slot`). Its
 * markup is the sheet's own (`./drop-sheet-face`; `drop-sheet-shell.test`
 * holds the two to one), so the live sheet replaces it without moving a
 * pixel; and its picker is a native, labelled file input, so a pick works
 * before any code has arrived — the live sheet adopts what was picked.
 *
 * Part of the one drop primitive, not a second one: it does nothing but be
 * picked (no drag, no drop, no paste — those are the live sheet's, and a
 * file released on the page before it arrives is the drop layer's), and
 * `drop-surface.test.ts` allows a file input here and in `./drop-sheet`
 * alone.
 */
export function DropSheetShell({
  accept,
  multiple,
  title,
  browse = true,
  hint,
  hintId,
  variant,
  className,
}: {
  accept: string;
  multiple: boolean;
  title: string;
  browse?: boolean;
  hint?: ReactNode;
  /** The hint's id — the shell has no `useId`; one sheet per page names it. */
  hintId: string;
  variant: "sheet" | "compact";
  className?: string;
}) {
  return (
    <div
      data-drop-sheet=""
      data-drop-sheet-shell=""
      data-live="pending"
      className={sheetClass(variant, className)}
    >
      <label className={faceClass(variant)}>
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          aria-describedby={hint != null ? hintId : undefined}
          className="sr-only"
        />
        <SheetFace
          variant={variant}
          title={title}
          browse={browse}
          hint={hint}
          hintId={hintId}
        />
      </label>
    </div>
  );
}
