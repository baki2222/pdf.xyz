"use client";

import { useCallback, useLayoutEffect, useRef, type RefCallback } from "react";
import type { DropBox } from "@/lib/intent/drop-engine";
import type { DropVia } from "@/lib/intent/page-target";

/**
 * Make the element this returns a ref for a DROP BOX: a box that takes the
 * files released on it, and — while `box.target` is set — is the page's
 * drop target (`@/lib/intent/page-target`): a file dropped or pasted
 * anywhere on the page, and "Open files", come to it. A drop sheet, an open
 * editor, a chosen file's chip.
 *
 * WHAT SHIPS WITH THE PAGE IS THE BOX'S DESCRIPTION, NOT ITS ENGINE. The box
 * renders what it is made of — what it takes, what a file landing on it
 * does, whether it is the page's target. Its drag states, its claim on a
 * release and its registration are `@/lib/intent/drop-engine`, attached as
 * the box mounts through the registry's own `import()` (`attachDropBox`) —
 * the chunk the drop layer fetches on idle, so on any page the first box
 * fetches it at most once. As first merged, every box carried that itself:
 * 2.4 KB gz in the first load of every tool page, against the redesign's
 * 0.8 for the whole of WP-07 there (WP-07 re-review). A file released on a
 * box before its engine is here is the drop layer's, which hands it to the
 * box once the engine is (`deliverFiles`), so it lands where it would have.
 *
 * It attaches ONCE per element and per activation as a target, not per
 * render: the registry is a stack whose last entry wins, so attaching on
 * every render would move this box above one that mounted after it (an
 * editor's, a dialog's). The engine reads `box` from the latest render at
 * every question, so a new name or busy state is what the page sees. A box
 * that leaves before its engine arrives never registers; one whose element
 * is replaced (an editor keyed by its file) is attached to the new one.
 */
export function useDropBox(box: DropBox): RefCallback<HTMLElement> {
  const latest = useRef(box);
  useLayoutEffect(() => {
    latest.current = box;
  });
  const isTarget = box.target !== null;
  return useCallback(
    (root: HTMLElement | null) => {
      if (!root) return;
      // LIVE: React holds this element now — a pick on it is React's, and a
      // release on it reaches it. A sheet says so (`data-live`, rendered
      // "pending", and its crop marks draw in at this moment: M1) on the
      // element rather than in state, so going live costs no render.
      if (root.dataset.live) {
        root.dataset.live = "on";
        // EARLY: a pick made before React held the sheet — the page was
        // still hydrating, so no `change` was heard — is still in its
        // inputs. Adopted here, as React takes the sheet, and the inputs
        // cleared, so every later pick is an ordinary change. Only the
        // sheet's own inputs, never a sheet's inside it. WAS
        // `useEarlyFilePick`, an effect per picker (its history is in
        // `drop-sheet.test.tsx`; `e2e/pre-hydration-upload.spec.ts` holds
        // the browser half).
        for (const input of root.querySelectorAll<HTMLInputElement>(
          'input[type="file"]',
        ))
          if (
            input.closest("[data-drop-sheet]") === root &&
            input.files?.length
          ) {
            latest.current.emit(Array.from(input.files), "early");
            input.value = "";
          }
      }
      let detach: (() => void) | undefined;
      let mounted = true;
      import("@/lib/intent/page-target").then(
        ({ attachDropBox }) => {
          if (mounted) detach = attachDropBox(root, latest);
        },
        // Offline, or a deploy replaced the chunk: the box still draws and
        // picks, and the page's layer — whose routing needs the same
        // chunk — says what failed when a file is dropped.
        () => {},
      );
      return () => {
        mounted = false;
        detach?.();
      };
    },
    // A new callback when the box starts or stops being the page's target:
    // React detaches the old engine and attaches a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isTarget],
  );
}

/**
 * A drop sheet's one path in (`./drop-sheet`, `./drop-desk`): `refuse` runs
 * on every file, whichever way it came — a pick, a drop on the sheet, a
 * pick made before hydration, a file the page hands it — so a refused file
 * never reaches `onFiles` (and so is never read or uploaded); the first
 * reason goes to `onRefusal`, and `null` once files arrive with nothing
 * refused. Made at each render, not memoised: the box reads the latest one
 * at every question, and nothing keys on its identity.
 */
export function sheetEmit(
  onFiles: (files: File[], via: DropVia) => void,
  refuse?: (file: File) => string | null,
  onRefusal?: (reason: string | null) => void,
) {
  return (list: FileList | readonly File[] | null, via: DropVia) => {
    if (!list || list.length === 0) return;
    const kept: File[] = [];
    let first: string | null = null;
    for (const file of Array.from(list)) {
      const why = refuse ? refuse(file) : null;
      if (why === null) kept.push(file);
      else first ??= why;
    }
    onRefusal?.(first);
    if (kept.length > 0) onFiles(kept, via);
  };
}
