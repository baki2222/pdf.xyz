"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { announceOutcome } from "@/components/a11y/live-region";
import { ErrorNote } from "@/components/tools/runner/runner-kit";
import { useToolContext } from "@/components/tools/tool-context";
import { usePageTarget } from "@/components/upload/use-page-target";
import { takesByAccept } from "@/lib/intent/accept-match";

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
 */
export function ChosenFileTarget({
  file,
  accept,
  busy,
  refuse,
  onReplace,
  children,
}: {
  /** The file chosen now. */
  file: File;
  /** The panel zone's `accept`. */
  accept: string;
  /** The panel's job is running: nothing may land mid-run. */
  busy: boolean;
  /** The panel zone's `refuse`. */
  refuse: (file: File) => string | null;
  /** What the zone's `onFiles` does, after whatever Remove resets. */
  onReplace: (files: File[]) => void;
  /** The chip. */
  children: ReactNode;
}) {
  const tool = useToolContext();
  const name = tool?.name ?? "this tool";
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const takes = useMemo(() => takesByAccept(accept), [accept]);

  usePageTarget({
    name,
    verb: "replace",
    current: file.name,
    canReceive: () => !busy,
    takes,
    receive: (files) => {
      const kept: File[] = [];
      let first: string | null = null;
      for (const f of files) {
        const why = refuse(f);
        if (why === null) kept.push(f);
        else first ??= why;
      }
      setRefusal(first);
      if (kept.length === 0) return;
      const from = file.name;
      void import("@/lib/intent/unsaved").then(({ confirmLeave }) => {
        if (!confirmLeave()) return;
        onReplace(kept);
        announceOutcome(`Replaced ${from} with ${kept[0]!.name} in ${name}.`);
      });
    },
    arm: setArmed,
    element: () => ref.current,
  });

  return (
    <div
      ref={ref}
      data-page-drop-target=""
      data-armed={armed || undefined}
      className="flex flex-col gap-2"
    >
      {children}
      {refusal && <ErrorNote message={refusal} />}
    </div>
  );
}
