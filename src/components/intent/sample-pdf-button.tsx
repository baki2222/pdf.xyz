"use client";

import { useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const noSubscription = () => () => {};

/**
 * "No file handy? Try a sample PDF" — for a visitor who wants to see what
 * the desk does before trusting it with a file of their own. Pressed, it
 * fetches pdf.xyz's sample (`@/lib/intent/sample-pdf`, three pages and a
 * small form, a few KB) and hands it to the desk like a picked file, where it
 * is measured like one and marked as the site's sample.
 *
 * Rendered only once the page is live (a button that cannot work before
 * hydration is not offered), into a slot of fixed height the server reserves,
 * so it appears without moving anything (`data-slot`).
 */
export function SamplePdfButton({
  onSample,
  className,
}: {
  onSample: (file: File) => void;
  className?: string;
}) {
  const live = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  const load = async () => {
    if (state === "loading") return;
    setState("loading");
    try {
      const { samplePdfFile } = await import("@/lib/intent/sample-pdf");
      const file = samplePdfFile();
      setState("idle");
      onSample(file);
    } catch {
      setState("failed");
    }
  };

  return (
    <div
      data-slot="sample"
      className={cn("flex h-6 items-center text-xs", className)}
    >
      {live &&
        (state === "failed" ? (
          <p role="status" className="text-warn">
            The sample couldn&apos;t be loaded. Try again after a reload.
          </p>
        ) : (
          <p className="text-muted">
            No file handy?{" "}
            <button
              type="button"
              onClick={load}
              aria-disabled={state === "loading" || undefined}
              aria-busy={state === "loading" || undefined}
              className="text-fg decoration-line-strong hover:decoration-accent inline-flex items-center gap-1 font-medium underline decoration-1 underline-offset-4"
            >
              {state === "loading" && (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              )}
              Try a sample PDF
            </button>
          </p>
        ))}
    </div>
  );
}
