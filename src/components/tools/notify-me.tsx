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
 * The beacon deliberately carries the slug alone. The same press also calls
 * `track()`, and that is NOT dev-only, as this note said until 2026-10-10: for
 * a visitor who allowed analytics it reaches Google Analytics as
 * `gated_tool_interest`, with Google's cookie id. Both disclosures — the line
 * under the button and the /privacy bullet — now say so
 * (`interest-disclosure.test.ts`).
 *
 * "ONLY THE NAME" IS A CLAIM ABOUT THE COUNT, not about the request (review,
 * 2026-10-10). The line said "Pressing it sends us the tool's name — nothing
 * about you" and the acknowledgement "We received only the tool's name",
 * while /privacy §4 says — truly — that the request reaches us like any other
 * and so appears in the ordinary logs, IP address and user-agent included.
 * Both now scope the claim to the count and name the logs.
 */
export function NotifyMe({
  toolName,
  toolSlug,
  checking,
}: {
  toolName: string;
  toolSlug: string;
  /**
   * True while the panel is still asking the worker whether it can run.
   *
   * REQUIRED, so every panel has to answer it. The panels start in their
   * "loading" phase, and that is the phase the SERVER renders — so before this
   * prop, all twenty live worker and AI tool pages shipped "Notify me when this
   * ships" in their HTML, to every crawler and to every visitor until the
   * status check returned. A tool that is running in production told Google it
   * had not shipped. While checking, the button renders nothing; the panel's
   * own "Checking…" line is the whole truth at that moment.
   */
  checking: boolean;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  // Derived here rather than passed in: fourteen panels render this button, and
  // a capability threaded by hand through each of them is fourteen chances to
  // file a click under the wrong one.
  const tool = getToolBySlug(toolSlug);

  if (checking) return null;

  if (acknowledged) {
    return (
      <p
        role="status"
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm",
          "border-ok/40 bg-ok/10 text-ok",
        )}
      >
        <Check className="size-4 shrink-0" aria-hidden />
        Noted — one more ask for {toolName} counted.
        {tool
          ? " We counted only the tool's name; the count holds nothing about you or your files."
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
      <p className="text-muted text-xs leading-relaxed">
        The count holds only the tool&apos;s name; like any request, the press
        appears in our ordinary server logs. If you allowed analytics, Google
        Analytics counts the press too.
      </p>
    </div>
  );
}
