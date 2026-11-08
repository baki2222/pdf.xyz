"use client";

import { cn } from "@/lib/utils";

/**
 * A row of choices for a batch's one setting, drawn as the runners'
 * `SegmentedControl` draws its own (a radiogroup of 44px buttons). Its own
 * module, in the batch's chunk: Rotate PDF's runner does not load
 * `../stamp-controls`, and a batch module importing it there put it in a
 * chunk of its own — one more entry in the webpack runtime every page
 * downloads first (`next.config.mjs`, the `batch` cache group).
 */
export function BatchChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="border-line bg-canvas rounded-ctl inline-flex max-w-full flex-wrap border p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-ctl inline-flex h-11 items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition",
              active ? "bg-accent/10 text-accent" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
