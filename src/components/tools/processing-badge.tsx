import { getProcessingMeta } from "@/lib/tools/processing";
import type { ProcessingMode } from "@/lib/tools/types";
import { cn } from "@/lib/utils";

/**
 * Non-text status dot per mode. These are semantic (where does my file go?),
 * not decoration, so they keep distinct hues — but the words moved to plain
 * mono text so the chip stopped being a coloured pill.
 *
 * WAS A LOCAL `dotByMode` TABLE, with a docblock explaining that
 * `processing.ts`'s `tone` field was not consumed here because it held the
 * legacy dark palette. That was true and it was the wrong fix: it left the
 * abandoned field in place, still reading as the source of truth, while this
 * file and the per-tool share card each grew a copy. The field now holds the
 * hue in both syntaxes — `dot` for here, `card` for Satori — so the site and
 * the card cannot disagree about what "AI-assisted" looks like.
 */
function ProcessingDot({ mode }: { mode: ProcessingMode }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        getProcessingMeta(mode).hue.dot,
      )}
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
