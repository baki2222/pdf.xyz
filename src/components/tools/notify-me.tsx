"use client";

import { useState } from "react";
import { BellRing, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Honest "notify me" placeholder. There is no waitlist backend yet and this
 * component intentionally collects nothing and makes no network request — it
 * simply acknowledges interest on-device. When a real notification service
 * exists it can be wired in here without changing the tool pages.
 */
export function NotifyMe({ toolName }: { toolName: string }) {
  const [acknowledged, setAcknowledged] = useState(false);

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
        Nothing was sent from your device.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setAcknowledged(true)}
      className={buttonVariants({ variant: "secondary", size: "sm" })}
    >
      <BellRing className="size-4" aria-hidden />
      Notify me when this ships
    </button>
  );
}
