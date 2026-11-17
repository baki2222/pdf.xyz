"use client";

/**
 * "View page N larger" on a page board (audit remove-pages#3, 2026-11-08;
 * every board since backlog #9, 2026-11-17): the label, the button, and the
 * dialog's loader, defined once for every board that draws page tiles —
 * Delete / Extract Pages, Rotate, Organize, and the shared page picker
 * (Split, PDF to PNG / JPG, Resize). `page-boards.test.ts` finds those boards
 * by what they render and holds each to this button.
 *
 * The dialog itself loads with next/dynamic on the first press. Rotate's and
 * Organize's boards are in their pages' first load, so the button is the
 * tile's own `TileAction` (already there) and the work of turning a board
 * into pages is done in the dialog, not here.
 */
import dynamic from "next/dynamic";
import { Maximize2 } from "lucide-react";
import { TileAction } from "./page-tile";

/** The enlarge button's name — Delete Pages' copy quotes its shape. */
export const zoomLabel = (pageNumber: number) =>
  `View page ${pageNumber} larger`;

/**
 * `ssr: false` gives the loader its own Suspense boundary. Without one, the
 * first press suspends up to the nearest boundary above the board — the page
 * picker's own loader — which hides the whole picker while the chunk loads,
 * and the button that was pressed loses focus, so Escape had nowhere to send
 * it back (e2e/page-zoom.spec.ts, 2026-11-17). The dialog draws into
 * document.body after a press, so it never had server HTML to lose.
 */
export const LazyPageZoomDialog = dynamic(
  () =>
    import("./page-zoom-dialog").then(({ PageZoomDialog }) => PageZoomDialog),
  { ssr: false },
);

/**
 * The enlarge button. Its own button, never inside a tile that is itself a
 * button: a board puts it beside such a tile (Delete Pages, Rotate, the
 * picker's select mode) or in the action row of a tile that is not one
 * (Organize, the picker's cut mode), so the tile's own toggle, drag and turn
 * never see its press (page-board-zoom.test.tsx). `tabIndex` is for a board
 * with one tab stop (the page picker); elsewhere it is a tab stop of its own.
 */
export function ZoomButton({
  pageNumber,
  onClick,
  tabIndex,
}: {
  pageNumber: number;
  onClick: () => void;
  tabIndex?: number;
}) {
  return (
    <TileAction
      title={zoomLabel(pageNumber)}
      onClick={onClick}
      tabIndex={tabIndex}
    >
      <Maximize2 className="size-3.5" aria-hidden />
    </TileAction>
  );
}
