"use client";

/**
 * The deep step's Target size and Image quality controls, shared by the
 * single-file panel (`./compress-runner`) and the batch (`./compress-batch`,
 * audit backlog #15). One set of chips, labels, presets and hints, so the two
 * panels cannot offer different choices; the bounds and the validation live
 * in `@/lib/pdf/compress-target`, which the worker's parser also reads.
 *
 * Each caller says what its own validation message is and whether a preset is
 * out of reach: the single-file panel weighs presets against its one file,
 * the batch against nothing (each row is weighed on its own, `alreadyFits`).
 */
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DEFAULT_IMAGE_QUALITY,
  IMAGE_QUALITY_HINT,
  IMAGE_QUALITY_LABELS,
  IMAGE_QUALITY_LEVELS,
  type ImageQuality,
} from "@/lib/pdf/compress-image-quality";
import {
  PRESET_ALREADY_SMALLER_TITLE,
  TARGET_SIZE_LABELS,
  TARGET_SIZE_PRESETS,
  type TargetChoice,
} from "@/lib/pdf/compress-target";
import { cn } from "@/lib/utils";
import { ChipButton } from "./runner-kit";

export function TargetSizeControl({
  target,
  onTarget,
  customKb,
  onCustomKb,
  invalid,
  invalidText,
  hint,
  placeholderKb,
  presetOutOfReach = () => false,
  busy = false,
}: {
  target: TargetChoice;
  onTarget: (choice: TargetChoice) => void;
  customKb: string;
  onCustomKb: (kb: string) => void;
  /** The chosen target is one the worker would refuse; the run waits. */
  invalid: boolean;
  /** What to type instead, shown while `invalid`. */
  invalidText: string;
  /** The line under the choice otherwise. */
  hint: string;
  placeholderKb: number;
  /** A preset the file is already under: disabled, with a title saying so. */
  presetOutOfReach?: (bytes: number) => boolean;
  busy?: boolean;
}) {
  const customId = useId();
  return (
    <>
      <div
        role="group"
        aria-label={TARGET_SIZE_LABELS.heading}
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-muted text-[11px] font-medium tracking-wide uppercase">
          {TARGET_SIZE_LABELS.heading}
        </span>
        <ChipButton
          onClick={() => onTarget("none")}
          active={target === "none"}
          disabled={busy}
        >
          {TARGET_SIZE_LABELS.none}
        </ChipButton>
        {TARGET_SIZE_PRESETS.map((p) => {
          const out = presetOutOfReach(p.bytes);
          return (
            <ChipButton
              key={p.bytes}
              onClick={() => onTarget(p.bytes)}
              active={target === p.bytes}
              // A file already under a preset has nothing to aim for.
              disabled={busy || out}
              {...(out ? { title: PRESET_ALREADY_SMALLER_TITLE } : {})}
            >
              {p.label}
            </ChipButton>
          );
        })}
        <ChipButton
          onClick={() => onTarget("custom")}
          active={target === "custom"}
          disabled={busy}
        >
          {TARGET_SIZE_LABELS.custom}
        </ChipButton>
        {target === "custom" && (
          <span className="text-muted inline-flex items-center gap-1.5 text-xs">
            <input
              id={customId}
              type="text"
              inputMode="numeric"
              aria-label="Custom target size in KB"
              placeholder={String(placeholderKb)}
              value={customKb}
              readOnly={busy}
              onChange={(event) => onCustomKb(event.target.value)}
              className="border-line text-fg focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl h-11 w-24 border px-3.5 text-sm transition outline-none focus:ring-2"
            />
            <label htmlFor={customId}>KB</label>
          </span>
        )}
      </div>
      {target !== "none" && (
        <p
          className={cn(
            "text-xs leading-relaxed",
            invalid ? "text-warn" : "text-muted",
          )}
        >
          {invalid ? invalidText : hint}
        </p>
      )}
    </>
  );
}

/**
 * Image quality, apart from resolution (audit compress-pdf#4). A button
 * rather than <details>, as the other worker panels do; 44px tall, as every
 * control on the way to Run is on a phone.
 */
export function ImageQualityControl({
  imageQuality,
  onImageQuality,
  busy = false,
}: {
  imageQuality: ImageQuality;
  onImageQuality: (quality: ImageQuality) => void;
  busy?: boolean;
}) {
  const advancedId = useId();
  // Closed by default, and open when a level other than the default is
  // chosen, so a choice is never hidden from the person who made it.
  const [advancedOpen, setAdvancedOpen] = useState(
    imageQuality !== DEFAULT_IMAGE_QUALITY,
  );
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={advancedOpen}
        aria-controls={advancedId}
        onClick={() => setAdvancedOpen((open) => !open)}
        className="text-accent hover:text-fg inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium transition"
      >
        <ChevronDown
          className={cn("size-4 transition", advancedOpen && "rotate-180")}
          aria-hidden
        />
        {IMAGE_QUALITY_LABELS.disclosure}
      </button>
      <div
        id={advancedId}
        hidden={!advancedOpen}
        className="flex flex-col gap-2"
      >
        <div
          role="group"
          aria-label={IMAGE_QUALITY_LABELS.heading}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-muted text-[11px] font-medium tracking-wide uppercase">
            {IMAGE_QUALITY_LABELS.heading}
          </span>
          {IMAGE_QUALITY_LEVELS.map((level) => (
            <ChipButton
              key={level.id}
              onClick={() => onImageQuality(level.id)}
              active={imageQuality === level.id}
              disabled={busy}
            >
              {level.label}
            </ChipButton>
          ))}
        </div>
        <p className="text-muted text-xs leading-relaxed">
          {IMAGE_QUALITY_HINT}
        </p>
      </div>
    </div>
  );
}
