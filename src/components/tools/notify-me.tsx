"use client";

import { useState } from "react";
import { BellRing, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isTelemetryEnabled } from "@/lib/telemetry/config";
import { track } from "@/lib/telemetry/track";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getToolBySlug } from "@/lib/tools";

/**
 * "Tell me when this ships", for a tool that is not enabled in this deployment.
 *
 * There is still no waitlist backend and this collects nothing about the person
 * clicking — no address, no identifier, no per-visitor record. What it does now
 * emit is one bounded product event naming the tool, because the click is the
 * only signal that separates *traffic* on a gated tool page from *demand* for
 * the tool, and without it there is no basis for choosing which gated tool to
 * unblock first.
 *
 * The acknowledgement tells the truth about what just happened, which depends
 * on whether this build actually has a telemetry destination configured. With
 * none — the default — the event is dropped on-device and nothing leaves at
 * all, so it says so.
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
        Noted — the {toolName} waitlist opens when the secure worker ships.
        {isTelemetryEnabled()
          ? " Only the tool name was counted; nothing about you or your files."
          : " Nothing was sent from your device."}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (tool) {
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
  );
}
