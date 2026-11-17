"use client";

/**
 * Text to PDF's page setup — Page size, Orientation, Text size — shared by
 * the editor and the batch, so several files get the page one file would.
 * Every chip comes from `@/lib/pdf/text-page-options`, the table the engine
 * draws from, so the chips cannot offer a page the engine does not make.
 */
import {
  TEXT_FONT_SIZES,
  TEXT_ORIENTATIONS,
  TEXT_PAGE_SETUP_LABELS,
  TEXT_PAGE_SIZES,
  type TextPageOptions,
} from "@/lib/pdf/text-page-options";
import { inches } from "@/lib/pdf/page-geometry";
import { ChipButton, RunnerSection } from "./runner-kit";

export function TextPageSetup({
  value,
  onChange,
  disabled,
}: {
  value: TextPageOptions;
  onChange: (next: Partial<TextPageOptions>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      <RunnerSection title={TEXT_PAGE_SETUP_LABELS.pageSize}>
        <div className="flex flex-wrap gap-2">
          {TEXT_PAGE_SIZES.map((size) => (
            <ChipButton
              key={size.id}
              onClick={() => onChange({ pageSize: size.id })}
              disabled={disabled}
              active={size.id === value.pageSize}
              title={`${inches(size.size.width)} × ${inches(size.size.height)} in`}
            >
              {size.label}
            </ChipButton>
          ))}
        </div>
      </RunnerSection>
      <RunnerSection title={TEXT_PAGE_SETUP_LABELS.orientation}>
        <div className="flex flex-wrap gap-2">
          {TEXT_ORIENTATIONS.map((o) => (
            <ChipButton
              key={o.id}
              onClick={() => onChange({ orientation: o.id })}
              disabled={disabled}
              active={o.id === value.orientation}
            >
              {o.label}
            </ChipButton>
          ))}
        </div>
      </RunnerSection>
      <RunnerSection title={TEXT_PAGE_SETUP_LABELS.fontSize}>
        <div className="flex flex-wrap gap-2">
          {TEXT_FONT_SIZES.map((size) => (
            <ChipButton
              key={size}
              onClick={() => onChange({ fontSize: size })}
              disabled={disabled}
              active={size === value.fontSize}
              title={`${size}-point text`}
            >
              {`${size} pt`}
            </ChipButton>
          ))}
        </div>
      </RunnerSection>
    </div>
  );
}
