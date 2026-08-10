"use client";

import { useId, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import {
  resolveAlign,
  STAMP_POSITIONS,
  type HAlign,
  type StampPosition,
  type VAlign,
} from "@/lib/pdf/stamp";
import { cn } from "@/lib/utils";

/**
 * Shared, accessible controls for the text-stamping runners (page numbers,
 * watermark, header/footer): a 3×3 position picker, labeled range sliders,
 * segmented alignment/preset toggles, and small labeled inputs.
 */

const POSITION_LABELS: Record<StampPosition, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "middle-left": "Middle left",
  "middle-center": "Middle center",
  "middle-right": "Middle right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};

const H_JUSTIFY: Record<HAlign, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
};

const V_ALIGN: Record<VAlign, string> = {
  top: "items-start",
  middle: "items-center",
  bottom: "items-end",
};

/** A 3×3 grid that mirrors where the stamp will land on the page. */
export function PositionPicker({
  value,
  onChange,
  label = "Position",
}: {
  value: StampPosition;
  onChange: (position: StampPosition) => void;
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid aspect-[4/3] w-40 grid-cols-3 grid-rows-3 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1.5"
    >
      {STAMP_POSITIONS.map((position) => {
        const { h, v } = resolveAlign(position);
        const active = position === value;
        return (
          <button
            key={position}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={POSITION_LABELS[position]}
            title={POSITION_LABELS[position]}
            onClick={() => onChange(position)}
            className={cn(
              "flex rounded-lg border p-1.5 transition",
              H_JUSTIFY[h],
              V_ALIGN[v],
              active
                ? "border-violet-400/60 bg-violet-500/20"
                : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.05]",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full transition",
                active ? "bg-violet-300" : "bg-slate-500",
              )}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

/** A labeled range slider with a live numeric readout. */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-slate-300">
          {label}
        </label>
        <span className="text-xs text-slate-400 tabular-nums">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-violet-400"
      />
    </div>
  );
}

/** A small segmented control for a fixed set of options. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              active
                ? "bg-violet-500/20 text-violet-100"
                : "text-slate-400 hover:text-white",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A labeled text input used across the stamping runners. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  aside,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  aside?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-300">
          {label}
        </label>
        {aside}
      </div>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-slate-100 transition outline-none placeholder:text-slate-400 focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/20"
      />
    </div>
  );
}

/** A labeled integer input with min/max bounds. */
export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs font-medium text-slate-300">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isNaN(next)) return;
          onChange(Math.min(max, Math.max(min, Math.round(next))));
        }}
        className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-slate-100 transition outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/20"
      />
    </div>
  );
}

/** Buttons that append a dynamic token to a text field (e.g. {n}, {date}). */
export function TokenButtons({
  tokens,
  onInsert,
}: {
  tokens: { token: string; label: string }[];
  onInsert: (token: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] tracking-wide text-slate-400 uppercase">
        Insert
      </span>
      {tokens.map(({ token, label }) => (
        <button
          key={token}
          type="button"
          onClick={() => onInsert(token)}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-violet-200 transition hover:border-violet-400/40 hover:bg-violet-500/10"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** A compact, reassuring privacy line reused across the stamping runners. */
export function PrivacyLine({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <ShieldCheck className="size-3.5 text-emerald-400/80" aria-hidden />
      {children}
    </p>
  );
}
