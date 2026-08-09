"use client";

import { useState } from "react";
import { BellRing, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { track } from "@/lib/telemetry/track";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getToolBySlug } from "@/lib/tools";

/**
 * "Tell me when this ships", for a tool that is not enabled in this deployment.
 *
 * The click is an act of communication — the one signal that separates
 * *traffic* on a gated tool page from *demand* for the tool — and since the
 * interest counter shipped it is treated as exactly that: pressing the button
 * sends `POST /api/interest` carrying the tool's slug and nothing else, which
 * adds one to a per-tool count (`/privacy` §4 discloses this in the same
 * words). The disclosure line under the button is load-bearing: the user must
 * know what pressing sends BEFORE they press, in plain sight — not behind a
 * hover or a link — because the whole distinction between a request and
 * analytics is that the person knowingly made it.
 *
 * The beacon is fire-and-forget (`keepalive`, errors swallowed): it must
 * never delay, block, or change what the user sees. There is still no
 * waitlist backend and no way to actually notify anyone — the copy promises
 * only what exists: the ask was counted.
 *
 * The dev-only `track()` event keeps its extra capability dimension for local
 * console visibility; the beacon deliberately carries the slug alone.
 */
export function NotifyMe({
  toolName,
  toolSlug,
}: {
  toolName: string;
  toolSlug: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  // Derived here rather than passed in: fourteen panels render this button, and
  // a capability threaded by hand through each of them is fourteen chances to
  // file a click under the wrong one.
  const tool = getToolBySlug(toolSlug);

  if (acknowledged) {
    return (
      <p
        role="status"
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm",
          "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
        )}
      >
        <Check className="size-4 shrink-0" aria-hidden />
        Noted — one more ask for {toolName} counted.
        {tool
          ? " Only the tool's name was sent; nothing about you or your files."
          : " Nothing was sent from your device."}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={() => {
          if (tool) {
            // The beacon: the slug, nothing else. Fire-and-forget — a failed
            // count must never surface to the person asking.
            void fetch("/api/interest", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ slug: tool.slug }),
              keepalive: true,
            }).catch(() => {});
            track({
              name: "gated_tool_interest",
              toolSlug,
              capability: capabilityForMode(tool.processing),
            });
          }
          setAcknowledged(true);
        }}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        <BellRing className="size-4" aria-hidden />
        Notify me when this ships
      </button>
      <p className="text-xs leading-relaxed text-slate-400">
        Pressing it sends us the tool&apos;s name — nothing about you.
      </p>
    </div>
  );
}
