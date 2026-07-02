import { Server, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { getProcessingMeta } from "@/lib/tools/processing";
import type { ProcessingMode } from "@/lib/tools/types";
import { cn } from "@/lib/utils";

function ProcessingIcon({
  mode,
  className,
}: {
  mode: ProcessingMode;
  className?: string;
}) {
  // A switch keeps each icon a static element (no component created in render).
  switch (mode) {
    case "client":
      return <ShieldCheck className={className} aria-hidden />;
    case "server":
      return <Server className={className} aria-hidden />;
    case "hybrid":
      return <Zap className={className} aria-hidden />;
    case "ai":
      return <Sparkles className={className} aria-hidden />;
  }
}

/**
 * Honest, at-a-glance chip telling the user where a tool runs. Copy comes from
 * the single source of truth in `processing.ts`.
 */
export function ProcessingBadge({
  mode,
  variant = "short",
  className,
}: {
  mode: ProcessingMode;
  variant?: "short" | "long";
  className?: string;
}) {
  const meta = getProcessingMeta(mode);
  return (
    <span
      title={meta.description}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        meta.tone,
        className,
      )}
    >
      <ProcessingIcon mode={mode} className="size-3" />
      {variant === "short" ? meta.short : meta.label}
    </span>
  );
}
