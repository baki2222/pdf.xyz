/**
 * What a drag says about itself before release — read by every surface a
 * file can be dropped on, synchronously, in the event's own turn.
 *
 * Its own module, not the registry's (`./page-target`): a drop sheet asks
 * these on every enter and drop, and the registry is fetched only when a
 * page first needs it (the drop layer's on idle, a target's registration on
 * mount), so the sheet keeps it out of every page's first load. The drop
 * layer, in the root layout's chunk, keeps its own copies — a module the
 * layout shared with a page's chunks would be downloaded twice there
 * (`first-load-duplicates.test.ts`) — and `drop-layer.test.tsx` holds the
 * copies to one answer over every shape a drag comes in.
 */
import type { FileKind } from "./page-target";

/**
 * Does this drag carry files (not text, not a link)? A browser lists
 * "Files" among the drag's types from the moment it enters; a drop event
 * built by hand (every test that fires one) may list the files alone.
 */
export function carriesFiles(event: {
  dataTransfer: Pick<DataTransfer, "types" | "files"> | null;
}): boolean {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  if (transfer.types && Array.from(transfer.types).includes("Files"))
    return true;
  return (transfer.files?.length ?? 0) > 0;
}

/**
 * The files a drag describes before release: their types where the browser
 * gives them (Chromium), and nothing where it does not (WebKit 223517) — a
 * file with no name and no type is held against no target.
 */
export function describeDrag(
  transfer: Pick<DataTransfer, "items"> | null | undefined,
): FileKind[] {
  if (!transfer?.items) return [];
  return Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => ({ name: "", type: item.type }));
}
