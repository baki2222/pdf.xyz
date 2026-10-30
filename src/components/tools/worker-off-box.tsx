"use client";

import { useId, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import { buttonVariants } from "@/components/ui/button";
import { NotifyMe } from "./notify-me";

/**
 * NOT ENABLED, IN ONE SENTENCE (owner, 2026-10-23). The box held the
 * engine's reason, a "never pretends to …" paragraph, Notify me and its
 * line, "Nothing is uploaded while the worker is unavailable…", and Try
 * again — the tallest state the slot shows, so every panel's reserve, and
 * so the band under Run on a WORKING worker, was its height.
 *
 * Shown: one plain sentence, Try again and Notify me as buttons, and
 * Notify me's line on what the press sends — that line is read BEFORE the
 * press, so it never goes behind "Why?" (`notify-me.tsx`). The panel's own
 * reason and the upload sentence are one press away, `hidden` rather than
 * unmounted, so the claim guards read what a crawler reads.
 * `worker-off-compact.test.tsx` holds every dispatched panel to this. Loaded
 * lazily by `WorkerGate`: a working tool page never needs it.
 */
export default function OffBox({
  tool,
  off,
  onRetry,
}: {
  tool: Pick<Tool, "name" | "slug">;
  off: ReactNode;
  onRetry: () => void;
}) {
  const [why, setWhy] = useState(false);
  const whyId = useId();
  return (
    <div
      data-off=""
      className="border-warn/40 bg-warn/10 rounded-panel flex flex-col gap-3 border p-4"
    >
      {/* "Why?" on the sentence's line, not a row of its own: the box is
          the slot's tallest state, so every row here is a row of empty band
          under Run on a working page. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p data-off-lead="" className="text-fg text-sm font-medium">
          This tool is offline right now. Try again later.
        </p>
        <button
          type="button"
          aria-expanded={why}
          aria-controls={whyId}
          onClick={() => setWhy((was) => !was)}
          className="text-muted hover:text-fg text-sm font-medium underline underline-offset-4 transition"
        >
          Why?
        </button>
      </div>
      <div id={whyId} hidden={!why} className="flex flex-col gap-2">
        {off}
        <p className="text-muted text-xs leading-relaxed">
          Nothing is uploaded while our server is unavailable. A file you add
          stays here, and Run turns on once our server is ready.
        </p>
      </div>
      <NotifyMe
        toolName={tool.name}
        toolSlug={tool.slug}
        checking={false}
        leading={<TryAgain onRetry={onRetry} />}
      />
    </div>
  );
}

function TryAgain({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      <RotateCw className="size-3.5" aria-hidden />
      Try again
    </button>
  );
}
