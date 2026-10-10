import { DropSheetShell } from "@/components/upload/drop-sheet-shell";
import type { GuideDeskProps } from "./guide-desk";
import {
  GUIDE_DESK_HINT_ID,
  GUIDE_DESK_STATUS_CLASS,
  guideDeskTitle,
} from "./guide-desk-words";

/**
 * A guide's desk as the server draws it: the desk's own box, sheet and
 * status slot, with a native picker that works before any code arrives —
 * what `GuideDeskSlot` shows until the live desk (`./guide-desk`) is here,
 * and what it hands the live desk's sheet a pick made in the meantime. The
 * live desk replaces it in place, at the same size
 * (`drop-sheet-shell.test.tsx` holds the two markups to one).
 */
export function GuideDeskShell(props: GuideDeskProps) {
  return (
    <div className="flex w-full flex-col gap-2" data-guide-desk="">
      <DropSheetShell
        variant="compact"
        accept={props.accept}
        multiple={props.opens !== "one"}
        title={guideDeskTitle(props)}
        hint={props.hint}
        hintId={GUIDE_DESK_HINT_ID}
        className="w-full"
      />
      <p
        role="status"
        data-slot="guide-desk-status"
        className={GUIDE_DESK_STATUS_CLASS}
      />
    </div>
  );
}
