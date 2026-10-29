"use client";

import { FilePlus2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Open files", in the header of every page (E.5): the page's own picker
 * when its drop target has one — the home desk, a tool's drop zone, the
 * workspace — or else the drop layer's, whose files go to the ticket
 * dialog. NOT a file input: the header renders none (G.5 trap 3, and the
 * site-landmarks test), so a page's first file input stays its own.
 *
 * The registry arrives on demand (the drop layer fetches it on idle, so a
 * click usually finds it here); a click within the moment of activation
 * still opens the browser's picker.
 */
export function OpenFilesButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void import("@/lib/intent/page-target").then(
          (registry) => registry.requestFilePick(),
          () => {},
        );
      }}
      className={cn(
        "border-line text-fg hover:bg-wash rounded-ctl inline-flex h-11 shrink-0 items-center justify-center gap-2 border px-3.5 text-sm font-medium transition-colors",
        className,
      )}
    >
      <FilePlus2 className="size-4 shrink-0" aria-hidden />
      <span className="max-sm:sr-only">Open files</span>
    </button>
  );
}
