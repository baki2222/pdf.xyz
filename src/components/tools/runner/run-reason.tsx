"use client";

import { useId, type ReactNode } from "react";

/**
 * Why a run button is greyed out, in a few words ("Rotate at least one page
 * first."), beside it — above it on a phone, or below with `after` — and
 * read as its description: `children` gets the id to pass as the button's
 * `describedBy`. A greyed-out button with no reason is a riddle (the
 * 2026-10-29 phone audit: Apply & download, nothing placed yet, said
 * nothing about why it would not go).
 *
 * `reason` is null while the button is live. The wrapper is drawn either
 * way, so the button is never remounted under the reader's finger or their
 * keyboard focus. Pass a reason only for a state the reader clears with a
 * tap or a keystroke: the line comes and goes, and a change the reader
 * made themselves is not counted as a layout shift. From `sm` the line sits
 * in the button's row, where it moves nothing.
 *
 * Its own module, not a prop of `RunButton`: `runner-kit` is on every
 * worker page, and the OCR page's row had no room for it
 * (`bundle-budget.test.ts`).
 */
export function RunReason({
  reason,
  after = false,
  children,
}: {
  reason: string | null;
  after?: boolean;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const line = reason && (
    <p id={id} data-run-reason="" className="text-muted text-xs">
      {reason}
    </p>
  );
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
      {!after && line}
      {children(reason ? id : undefined)}
      {after && line}
    </div>
  );
}
