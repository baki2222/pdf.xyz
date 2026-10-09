import type { ReactNode } from "react";
import {
  getProcessingMeta,
  type ProcessingShape,
} from "@/lib/tools/processing";
import type { ProcessingMode } from "@/lib/tools/types";
import { cn } from "@/lib/utils";

/**
 * The geometry of each mode's mark, on an 8×8 grid. Keyed by SHAPE, not by
 * mode: which mode wears which shape is decided once, in `processing.ts`.
 * The ring and the half share a 1.5px stroke so the family reads as one set
 * at 8px; the diamond is the dot's square turned 45°.
 */
const GEOMETRY: Record<ProcessingShape, ReactNode> = {
  dot: <circle cx="4" cy="4" r="3.5" />,
  half: (
    <>
      <circle
        cx="4"
        cy="4"
        r="3.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M4 .75a3.25 3.25 0 0 0 0 6.5z" />
    </>
  ),
  ring: (
    <circle
      cx="4"
      cy="4"
      r="3.25"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  diamond: <path d="M4 .25 7.75 4 4 7.75.25 4z" />,
};

/**
 * Where a tool runs, as a shape: ● in-browser, ◐ browser-first, ○ secure
 * worker, ◆ AI. Decorative to assistive tech — the mode word always travels
 * with it, visibly or in `sr-only` text — and drawn in `currentColor` so the
 * mode's text-colour ink fills it and forced-colours mode can repaint it.
 *
 * WAS A 6px DOT, the same circle for every mode, told apart by hue alone
 * (WCAG 1.4.1); `processing-badge.test.tsx` now fails any two modes that
 * draw the same geometry, and any ink under 3:1 on a ground the badge uses.
 */
export function ModeShape({
  mode,
  className,
}: {
  mode: ProcessingMode;
  className?: string;
}) {
  const { hue, shape } = getProcessingMeta(mode);
  return (
    <svg
      viewBox="0 0 8 8"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("size-2 shrink-0", hue.ink, className)}
    >
      {GEOMETRY[shape]}
    </svg>
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
      <ModeShape mode={mode} />
      {variant === "short" ? meta.short : meta.label}
    </span>
  );
}
