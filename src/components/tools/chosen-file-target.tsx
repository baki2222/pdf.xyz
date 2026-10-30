"use client";

import { lazy, Suspense, useEffect } from "react";
import { warmJobRun } from "@/lib/workers/job-run-lazy";
import type { ChosenFileProps } from "./replace-boxes";

/** The chip as its page's target, fetched with the file it shows. */
const ChosenFileLive = lazy(() => import("./replace-boxes"));

/**
 * The file a worker panel has chosen, as its page's drop target: a file
 * dropped or pasted anywhere on the page REPLACES it (verb "replace"), as a
 * pick through the panel's own zone would have chosen it.
 *
 * WHY. A worker panel shows its drop zone until a file is chosen, then a
 * chip with the file's name and Remove in its place — and the zone was the
 * page's only target. So once a file was chosen the page had none: a second
 * PDF dropped on Protect PDF went to the ticket dialog, which never offers
 * the page's own tool, and its top rows sent the visitor to Compress, Sign
 * and Edit (WP-07 review, 13 panels). The registry
 * (`@/lib/intent/page-target`) now has this chip's target for exactly as
 * long as the zone is gone.
 *
 * THE SAME GATES AS THE ZONE: the page routes here only files of a kind the
 * panel takes (its `accept`, as the zone reads it), never while its job is
 * running (`busy` — the release goes to the dialog, which says the tool is
 * at work), and every file passes the panel's own `refuse` first (its
 * ceiling, the server's type rule): a refused file is never chosen, and
 * why is said here, as the zone says it. Unsaved work is asked about
 * before the swap (`confirmLeave`, WP-08's to fill), and the swap is
 * announced: "Replaced alpha.pdf with beta.pdf in Protect PDF."
 *
 * All of that is `ChosenFileLive` (`./replace-boxes`), fetched as the chip
 * first appears — with the file, not with the page. It names the tool its
 * page names (`data-tool-name`).
 */
export function ChosenFileTarget(props: ChosenFileProps) {
  // The chip appears when a worker panel's file is chosen (a pick, a drop,
  // a hand-off), so this is where the run's upload and polling code starts
  // downloading (`@/lib/workers/job-run-lazy`): in hand when Run is pressed,
  // and never with the page.
  useEffect(() => {
    warmJobRun();
  }, []);
  return (
    // Until its box is here the chip is drawn on its own — marked as the
    // page's target to be, so a file released meanwhile waits for it
    // (`targetsArrived`) rather than going to the ticket dialog.
    <Suspense fallback={<div data-page-drop-target="">{props.children}</div>}>
      <ChosenFileLive {...props} />
    </Suspense>
  );
}
