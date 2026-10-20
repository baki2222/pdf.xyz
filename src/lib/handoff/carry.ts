/**
 * Carry a hand-off's token to the next page without putting it in the
 * address: written to this tab's sessionStorage just before the in-app
 * navigation (`launchWithFiles`), read and removed by the page it names
 * (`claimArrival`). See `./carry-key` for the shape and `./url` for why.
 *
 *  - Single-use twice over: the record is consumed by its claim, and the
 *    carried token is removed by the read that finds it.
 *  - Addressed: a page claims only a token carried to its own path, so Back
 *    to the page that sent it does not claim it.
 *  - This tab only: a tab opened with Ctrl+click navigates natively, never
 *    through the launch, so nothing is written for it to find.
 */
import { HANDOFF_CARRY_KEY, peekCarriedHandoff } from "./carry-key";
import { looksLikeHandoffId } from "./ids";

/**
 * Carry `id` to `pathname`. False when this tab's storage refused the write
 * — the launch then reports a failed hand-off rather than navigating to a
 * page that would find nothing.
 */
export function carryHandoff(pathname: string, id: string): boolean {
  try {
    window.sessionStorage.setItem(
      HANDOFF_CARRY_KEY,
      JSON.stringify({ path: pathname, id }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Take the token carried to `pathname`: removed from storage when found,
 * returned only when well-formed. Null — touching nothing — when none is
 * carried here.
 */
export function takeCarriedHandoff(pathname: string): string | null {
  const id = peekCarriedHandoff(pathname);
  if (id === null) return null;
  try {
    window.sessionStorage.removeItem(HANDOFF_CARRY_KEY);
  } catch {
    // Unremovable storage: the record's own single use still holds.
  }
  return looksLikeHandoffId(id) ? id : null;
}
