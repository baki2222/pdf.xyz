"use client";

import { useId, useRef, type ReactNode } from "react";
import type { DropVia } from "@/lib/intent/page-target";
import type { BoxTarget } from "@/lib/intent/drop-engine";
import { sheetClass } from "./drop-sheet-box";
import { faceClass, SheetFace } from "./drop-sheet-face";
import { useDropBox, sheetEmit } from "./use-drop-box";

export type { DropVia } from "@/lib/intent/page-target";
export type { BoxTarget as SheetTarget } from "@/lib/intent/drop-engine";

/**
 * The one drop primitive: a sheet a file is dropped on, pasted to or picked
 * into — here as a whole-surface label (`sheet`, `compact`: drop or click
 * anywhere), and as `./drop-desk` where the body is its owner's. Every file
 * input the site renders is one of the primitive's (`drop-surface.test.ts`
 * discovers them all).
 *
 * Server-rendered, so its picker works before the page hydrates (a pick made
 * then is adopted as React takes the sheet, `useDropBox`), and without
 * JavaScript the input is still a native, keyboard-operable file input with
 * a real label.
 *
 * WHAT SHIPS WITH THE PAGE IS THE SHEET, NOT ITS ENGINE. This draws the
 * sheet and owns its picker and its one path in (`sheetEmit`). Its drag
 * states, its claim on a release and its registration as the page's target
 * are the drop engine's (`useDropBox`), fetched as it mounts. WAS one
 * component with the desk and the engine in it: 2.4 KB gz in the first load
 * of every tool page, against the redesign's 0.8 for the whole of WP-07
 * there (WP-07 re-review). A file released on the sheet before its engine
 * is here is the drop layer's, which hands it back to the sheet once it is.
 *
 * STATES, each an attribute the stylesheet reads:
 *  - `data-live`: "pending" until React is listening, then "on" (set on
 *    the element as React attaches it, `useDropBox`) — the crop marks draw
 *    in at that moment (M1): from then its picker is React's, and a
 *    release on it reaches it (through its engine, or through the page's
 *    layer until the engine is here);
 *  - `data-over` (the engine's): a file the sheet takes is being dragged
 *    over the sheet;
 *  - `data-armed` (the engine's): a file is being dragged anywhere over the
 *    page, and this sheet is where it will land — the marks grow (M2);
 *  - `data-page-drop-target`: it is the page's target (`pageTarget`).
 *
 * WHAT IT TAKES, IT TAKES; WHAT IT DOES NOT, IT LEAVES TO THE PAGE — the
 * engine's rule (`@/lib/intent/drop-engine`): a drag of files the sheet
 * does not take (a JPG over Rotate PDF's PDF zone), or any file while its
 * owner is at work, neither lights the sheet nor is claimed by it.
 *
 * `multiple` governs the PICKER. A drop is not filtered by it (the browser
 * does not filter one), so every dropped file reaches the owner, which keeps
 * what it takes and can say what it did not.
 */
export function DropSheet({
  accept,
  multiple,
  title,
  browse = true,
  hint,
  onFiles,
  pageTarget,
  refuse,
  onRefusal,
  variant,
  id,
  className,
}: {
  accept: string;
  /** Whether the picker takes more than one file (a drop is not filtered). */
  multiple: boolean;
  /** The sentence on the sheet, a "…, or" that "browse" ends. */
  title: string;
  /** Whether the title ends in the accent "browse". */
  browse?: boolean;
  /** What the sheet takes; it describes the picker (`aria-describedby`). */
  hint?: ReactNode;
  onFiles(files: File[], via: DropVia): void;
  /** Be the page's drop target while mounted (`@/lib/intent/page-target`). */
  pageTarget?: BoxTarget;
  /** Why a file cannot be used here, or null when it can. */
  refuse?: (file: File) => string | null;
  /** The first refusal of the latest arrival, or null when none was refused. */
  onRefusal?(reason: string | null): void;
  variant: "sheet" | "compact";
  id?: string;
  className?: string;
}) {
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const emit = sheetEmit(onFiles, refuse, onRefusal);
  const box = useDropBox({
    accept,
    target: pageTarget ?? null,
    emit,
    pick: () => input.current?.click(),
  });

  return (
    <div
      ref={box}
      id={id}
      data-drop-sheet=""
      data-live="pending"
      data-page-drop-target={pageTarget ? "" : undefined}
      className={sheetClass(variant, className)}
    >
      <label className={faceClass(variant)}>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          aria-describedby={hint != null ? hintId : undefined}
          className="sr-only"
          onChange={(e) => {
            emit(e.target.files, "pick");
            e.target.value = "";
          }}
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
