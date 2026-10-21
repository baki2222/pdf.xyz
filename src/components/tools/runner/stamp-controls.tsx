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
      className="border-line bg-canvas rounded-panel grid aspect-[4/3] w-40 grid-cols-3 grid-rows-3 gap-1 border p-1.5"
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
              "rounded-ctl flex border p-1.5 transition",
              H_JUSTIFY[h],
              V_ALIGN[v],
              active
                ? "border-accent/40 bg-accent/10"
                : "border-line bg-wash hover:border-line-strong hover:bg-wash",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full transition",
                active ? "bg-accent" : "bg-faint",
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
        <label htmlFor={id} className="text-muted text-xs font-medium">
          {label}
        </label>
        <span className="text-muted text-xs tabular-nums">
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
        className="bg-wash accent-accent rounded-tag h-1.5 w-full cursor-pointer appearance-none"
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
      className="border-line bg-canvas rounded-ctl inline-flex border p-1"
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
              "rounded-ctl inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition",
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
        <label htmlFor={id} className="text-muted text-xs font-medium">
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
        className="border-line text-fg placeholder:text-muted focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl w-full border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
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
      <label htmlFor={id} className="text-muted text-xs font-medium">
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
        className="border-line text-fg focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl w-full border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
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
      <span className="text-muted text-[11px] tracking-wide uppercase">
        Insert
      </span>
      {tokens.map(({ token, label }) => (
        <button
          key={token}
          type="button"
          onClick={() => onInsert(token)}
          className="border-line bg-wash text-accent hover:border-accent/40 hover:bg-accent/10 rounded-ctl border px-2 py-0.5 font-mono text-[11px] transition"
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
    <p className="text-muted inline-flex items-center gap-1.5 text-xs">
      <ShieldCheck className="text-ok size-3.5" aria-hidden />
      {children}
    </p>
  );
}
