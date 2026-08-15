import { getProcessingMeta } from "@/lib/tools/processing";
import type { ProcessingMode } from "@/lib/tools/types";
import { cn } from "@/lib/utils";

/**
 * Non-text status dot per mode. These are semantic (where does my file go?),
 * not decoration, so they keep distinct hues — but the words moved to plain
 * mono text so the chip stopped being a coloured pill. Copy still comes from
 * the single source of truth in `processing.ts`; only its `tone` classes are
 * no longer consumed here, because they hardcode the legacy dark palette and
 * this component now renders inside any theme scope.
 */
const dotByMode: Record<ProcessingMode, string> = {
  client: "bg-emerald-600",
  server: "bg-blue-600",
  hybrid: "bg-cyan-600",
  ai: "bg-violet-600",
};

function ProcessingDot({ mode }: { mode: ProcessingMode }) {
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", dotByMode[mode])}
      aria-hidden
    />
  );
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
        "text-muted inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wide uppercase",
        className,
      )}
    >
      <ProcessingDot mode={mode} />
      {variant === "short" ? meta.short : meta.label}
    </span>
  );
}
