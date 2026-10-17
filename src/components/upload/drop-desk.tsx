"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import type { DropVia } from "@/lib/intent/page-target";
import type { BoxTarget } from "@/lib/intent/drop-engine";
import { sheetClass, type SheetVariant } from "./drop-sheet-box";
import { useDropBox, sheetEmit } from "./use-drop-box";

export type { DropVia } from "@/lib/intent/page-target";
export type { BoxTarget as SheetTarget } from "@/lib/intent/drop-engine";

/** What a desk body needs to place its own controls. */
export interface DropSheetApi {
  /** Open the file picker (the desk's own hidden input). */
  pick(): void;
  /** The id of the sentence that describes what the desk takes. */
  readonly hintId: string;
  /**
   * Whether a file dropped anywhere on the page lands here — the desk is
   * registered as the page's target (`pageTarget`) — for a body that says
   * so, from the same value that makes it true, so the sentence cannot
   * outlive the behaviour.
   */
  readonly catchesPageDrops: boolean;
}

interface DeskContext extends DropSheetApi {
  readonly accept: string;
  readonly multiple: boolean;
  readonly emit: (
    list: FileList | readonly File[] | null,
    via: DropVia,
  ) => void;
}

const Desk = createContext<DeskContext | null>(null);

/**
 * The drop primitive as a DESK: a drop sheet whose body is its owner's
 * (`children`) — the home desk, the workspace's drop panel, the ticket
 * dialog, a guide's desk (whose body is the compact sheet's own face, so
 * the tool pages' `./drop-sheet` is theirs alone) — with a
 * {@link DropSheetPick} wherever the owner wants the
 * picker, and a hidden input behind {@link DropSheetApi.pick} for a control
 * that is not a label.
 *
 * One primitive with `./drop-sheet`, which is the same sheet as a
 * whole-surface label: the same box (`./drop-sheet-box`), the same one
 * path in (`sheetEmit`: refusals, then `onFiles`), the same engine
 * (`useDropBox`), the same states. A module of its own so a tool page —
 * whose zones are all labels — does not carry a desk's body, context and
 * second picker in its first load (WP-07 re-review).
 */
export function DropDesk({
  accept,
  multiple = true,
  onFiles,
  onIntent,
  pageTarget,
  refuse,
  onRefusal,
  variant = "desk",
  id,
  className,
  children,
}: {
  accept: string;
  multiple?: boolean;
  onFiles(files: File[], via: DropVia): void;
  /** A file is on its way (a drag carrying one): warm what is next. */
  onIntent?(): void;
  /** Be the page's drop target while mounted (`@/lib/intent/page-target`). */
  pageTarget?: BoxTarget;
  /** Why a file cannot be used here, or null when it can. */
  refuse?: (file: File) => string | null;
  /** The first refusal of the latest arrival, or null when none was refused. */
  onRefusal?(reason: string | null): void;
  /**
   * The box: a desk's, whose body lays itself out (the default), or a
   * sheet's column, for a body that is the sheet's own face (a guide's
   * desk, the compact sheet its shell draws).
   */
  variant?: SheetVariant;
  id?: string;
  className?: string;
  /** The desk's body. */
  children: (api: DropSheetApi) => ReactNode;
}) {
  const hintId = useId();
  // State, not a ref: `pick` travels to the desk's body during render, and a
  // ref read through it is what the hooks rules forbid.
  const [hidden, setHidden] = useState<HTMLInputElement | null>(null);
  const emit = sheetEmit(onFiles, refuse, onRefusal);
  const pick = useCallback(() => hidden?.click(), [hidden]);
  const box = useDropBox({
    accept,
    target: pageTarget ?? null,
    emit,
    pick,
    intent: onIntent,
  });

  const context: DeskContext = {
    accept,
    multiple,
    emit,
    pick,
    hintId,
    catchesPageDrops: pageTarget !== undefined,
  };

  return (
    <Desk.Provider value={context}>
      <div
        ref={box}
        id={id}
        data-drop-sheet=""
        data-live="pending"
        data-page-drop-target={pageTarget ? "" : undefined}
        className={sheetClass(variant, className)}
      >
        {children(context)}
        {/* Behind `pick()`: for a control that is a button, not a label, and
            for "Open files". Not a tab stop and not announced — the control
            that calls it is. It comes after the body, so a page's first file
            input is the one a person can see. */}
        <input
          ref={setHidden}
          type="file"
          hidden
          tabIndex={-1}
          aria-hidden
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            emit(e.target.files, "pick");
            e.target.value = "";
          }}
        />
      </div>
    </Desk.Provider>
  );
}

/**
 * A label that is the desk's picker: it wraps a visually hidden native file
 * input, so it opens the picker on a click before hydration (a pick made
 * then is adopted as React takes the desk, `useDropBox`) and without
 * JavaScript, takes focus as an input, and is announced by its own words
 * (described by the desk's hint, which the body places under `hintId`).
 * The focus ring is drawn on the label (`has-[:focus-visible]`) — the input
 * itself is invisible, and must not be an invisible tab stop.
 */
export function DropSheetPick({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const desk = useContext(Desk);
  if (!desk) throw new Error("DropSheetPick must be inside a DropDesk");
  const { emit } = desk;

  return (
    <label className={className}>
      <input
        type="file"
        accept={desk.accept}
        multiple={desk.multiple}
        aria-describedby={desk.hintId}
        className="sr-only"
        onChange={(e) => {
          emit(e.target.files, "pick");
          e.target.value = "";
        }}
      />
      {children}
    </label>
  );
}
