"use client";

import { useState } from "react";
import { Download, Stamp } from "lucide-react";
import {
  watermarkPdf,
  watermarkedOutputName,
  type WatermarkReport,
} from "@/lib/pdf/watermark";
import type { RGB } from "@/lib/pdf/stamp";
import { WATERMARK_INK } from "@/lib/pdf/stamp";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { recallOptions, rememberOptions } from "@/lib/intent/option-memory";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import {
  PrivacyLine,
  RangeField,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

const COLORS: Record<string, RGB> = {
  gray: WATERMARK_INK,
  red: { r: 0.78, g: 0.12, b: 0.12 },
  blue: { r: 0.16, g: 0.32, b: 0.7 },
};

export function WatermarkRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · watermark applied locally in your browser"
      handoffSlug="watermark-pdf"
      toolName="Add Watermark"
    >
      {(pdf, reset) => <WatermarkEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

export function WatermarkEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  // The last opacity and angle chosen here, never the text (option memory).
  const [kept] = useState(() => recallOptions("watermark"));
  const [text, setText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(kept.opacity ?? 18);
  const [rotation, setRotation] = useState(kept.rotation ?? 45);
  const [fontSize, setFontSize] = useState(60);
  const [color, setColor] = useState<keyof typeof COLORS>("gray");
  const { busy, error, result, run, reset } = useAsyncRun<WatermarkReport>();

  const trimmed = text.trim();

  const onRun = () => {
    rememberOptions("watermark", { opacity, rotation });
    return run(() =>
      watermarkPdf(pdf.bytes, text, {
        opacity: opacity / 100,
        rotation,
        fontSize,
        color: COLORS[color],
      }),
    );
  };

  if (result) {
    const pages = result.pages;
    const plural = (n: number) => (n === 1 ? "" : "s");
    // The size is a ceiling: a page too small for it got the largest size that
    // fits. Say so — the reader otherwise finds a smaller watermark than the
    // slider showed and no reason why.
    const shrunk =
      result.shrunkPages > 0
        ? ` · Shrunk to fit on ${result.shrunkPages} of ${pages} page${plural(pages)}`
        : "";
    return (
      <ResultPanel
        title="Watermark added"
        summary={`Stamped on all ${pages} page${plural(pages)}${shrunk} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, watermarkedOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.bytes, watermarkedOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download watermarked PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="Watermark">
        <TextField
          label="Text"
          value={text}
          onChange={setText}
          placeholder="e.g. CONFIDENTIAL, DRAFT, SAMPLE"
        />
      </RunnerSection>

      <RunnerSection title="Appearance">
        <div className="grid gap-5 sm:grid-cols-2">
          <RangeField
            label="Opacity"
            value={opacity}
            min={5}
            max={100}
            onChange={setOpacity}
            format={(v) => `${v}%`}
          />
          <RangeField
            label="Rotation"
            value={rotation}
            min={-90}
            max={90}
            onChange={setRotation}
            format={(v) => `${v}°`}
          />
          <RangeField
            label="Max font size"
            value={fontSize}
            min={16}
            max={160}
            onChange={setFontSize}
            format={(v) => `${v} pt`}
          />
          <div className="flex flex-col gap-2">
            <span className="text-muted text-xs font-medium">Color</span>
            <SegmentedControl
              label="Watermark color"
              value={color}
              onChange={setColor}
              options={[
                { value: "gray", label: "Gray" },
                { value: "red", label: "Red" },
                { value: "blue", label: "Blue" },
              ]}
            />
          </div>
        </div>
      </RunnerSection>

      <PrivacyLine>
        The watermark is drawn on your device — your PDF never leaves the
        browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={trimmed.length === 0}
            busyLabel="Stamping…"
          >
            <Stamp className="size-4" aria-hidden />
            Add watermark
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}
