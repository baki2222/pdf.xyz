import { announceOutcome } from "@/components/a11y/live-region";
import { confirmLeave } from "@/lib/intent/unsaved";

/**
 * Replace the document open in a single-PDF editor with a file that arrived
 * on its page (a drop or a paste anywhere) — fetched with that file, never
 * with the page: `SinglePdfRunner`'s "replace" target imports this when it
 * receives one.
 *
 * Unsaved work is asked about first (`confirmLeave`; which editors register
 * it is WP-08's). Then the swap is SAID and focus SURVIVES it. The editor is
 * keyed by its file, so the swap remounts it: whatever had focus inside it
 * (a paste is made with focus somewhere — on Rotate's buttons, say) is gone,
 * and focus fell to <body>; and nothing said a file had been swapped — on a
 * paste the live region stayed empty, on a drop it heard only "Rendering
 * previews…" (WP-07 review, measured on the served build). Now, once the new
 * editor is on the page, the swap is announced — "Replaced alpha.pdf with
 * beta.pdf in Rotate PDF." — and when focus was inside the old editor, or
 * has nowhere to be, it moves to the new one's file header (its name, pages
 * and size), as `useOutcomeFocus` repairs an orphaned focus after a run. A
 * file that cannot be opened says so itself (the runner's error), and is
 * not announced as a replace.
 */
export async function replaceOpenFile({
  next,
  from,
  name,
  open,
  editor,
}: {
  /** The file arriving. */
  readonly next: File;
  /** The name of the file it replaces. */
  readonly from: string;
  /** The tool, as the sentence names it. */
  readonly name: string;
  /** The runner's own `open`, the one a pick uses. */
  readonly open: (file: File) => Promise<void>;
  /** The editor on the page now (its element changes with the file). */
  readonly editor: () => HTMLElement | null;
}): Promise<void> {
  if (!confirmLeave()) return;
  const before = editor();
  const active = document.activeElement;
  const focusInside = !!active && !!before?.contains(active);
  await open(next);
  const after = await remounted(editor, before);
  if (!after) return;
  announceOutcome(`Replaced ${from} with ${next.name} in ${name}.`);
  const now = document.activeElement;
  const orphaned = !now || now === document.body || !now.isConnected;
  if (!(focusInside || orphaned)) return;
  const into = after.querySelector<HTMLElement>("[data-file-header]") ?? after;
  if (!into.hasAttribute("tabindex")) into.setAttribute("tabindex", "-1");
  into.focus({ preventScroll: true });
}

/** Frames to wait for the new editor; past them the file did not open. */
const FRAMES = 120;

/** The editor once it has remounted with the new file, or null. */
function remounted(
  editor: () => HTMLElement | null,
  before: HTMLElement | null,
): Promise<HTMLElement | null> {
  const frame =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 16);
  return new Promise((resolve) => {
    let frames = 0;
    const look = () => {
      const el = editor();
      if (el && el !== before && el.isConnected) return resolve(el);
      if (++frames > FRAMES) return resolve(null);
      frame(look);
    };
    look();
  });
}
