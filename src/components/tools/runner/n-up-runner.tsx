"use client";

import { useState } from "react";
import { Download, Grid2x2 } from "lucide-react";
import {
  DEFAULT_N_UP_OPTIONS,
  N_UP_COUNTS,
  N_UP_MARGINS,
  N_UP_ORDERS,
  N_UP_ORIENTATIONS,
  N_UP_SHEETS,
  nUpOutputName,
  nUpPdf,
  type NUpOptions,
  type NUpResult,
} from "@/lib/pdf/n-up";
import { inches } from "@/lib/pdf/page-geometry";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ChipButton,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { CheckboxField, PrivacyLine } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/** The run button's label — exported so the page's steps quote it. */
export const N_UP_RUN_LABEL = "Create sheets";

export function NUpRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · pages laid out on sheets locally in your browser"
      handoffSlug="n-up-pdf"
      toolName="Multiple Pages per Sheet"
    >
      {(pdf, reset) => <NUpEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

export function NUpEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [options, setOptions] = useState<NUpOptions>({
    ...DEFAULT_N_UP_OPTIONS,
  });
  const { busy, error, result, run, reset } = useAsyncRun<NUpResult>();
  const set = (next: Partial<NUpOptions>) => {
    if (!busy) setOptions((prev) => ({ ...prev, ...next }));
  };
  const sheets = Math.ceil(pdf.pageCount / options.perSheet);

  const onRun = () => {
    void run(() => nUpPdf(pdf.bytes, options));
  };

  if (result) {
    const name = nUpOutputName(pdf.file.name, options.perSheet);
    return (
      <ResultPanel
        title="Sheets created"
        summary={`${result.sourcePages} page${result.sourcePages === 1 ? "" : "s"} on ${result.sheets} sheet${result.sheets === 1 ? "" : "s"} · ${result.grid.cols} × ${result.grid.rows}, ${result.orientation} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, name)}
        onAdjust={reset}
        expectedPages={result.sheets}
      >
        <div className="flex flex-col gap-3">
          <p className="text-muted max-w-2xl text-sm">
            Links and form fields on the original pages are not clickable on the
            sheets: each page is placed as a drawing.
          </p>
          <button
            type="button"
            onClick={() => downloadBytes(result.bytes, name)}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <Download className="size-4" aria-hidden />
            Download PDF
          </button>
        </div>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Pages per sheet"
        aside={
          <span className="text-muted tnum text-xs">
            {pdf.pageCount} page{pdf.pageCount === 1 ? "" : "s"} → {sheets}{" "}
            sheet{sheets === 1 ? "" : "s"}
          </span>
        }
      >
        <div className="flex flex-wrap gap-2">
          {N_UP_COUNTS.map((count) => (
            <ChipButton
              key={count}
              onClick={() => set({ perSheet: count })}
              disabled={busy}
              active={count === options.perSheet}
            >
              {count} per sheet
            </ChipButton>
          ))}
        </div>
      </RunnerSection>

      <div className="grid gap-5 sm:grid-cols-2">
        <RunnerSection title="Sheet size">
          <div className="flex flex-wrap gap-2">
            {N_UP_SHEETS.map((sheet) => (
              <ChipButton
                key={sheet.id}
                onClick={() => set({ sheet: sheet.id })}
                disabled={busy}
                active={sheet.id === options.sheet}
                title={`${inches(sheet.size.width)} × ${inches(sheet.size.height)} in`}
              >
                {sheet.label}
              </ChipButton>
            ))}
          </div>
        </RunnerSection>
        <RunnerSection title="Orientation">
          <div className="flex flex-wrap gap-2">
            {N_UP_ORIENTATIONS.map((o) => (
              <ChipButton
                key={o.id}
                onClick={() => set({ orientation: o.id })}
                disabled={busy}
                active={o.id === options.orientation}
                title={
                  o.id === "auto"
                    ? "The orientation that shows the pages largest"
                    : undefined
                }
              >
                {o.label}
              </ChipButton>
            ))}
          </div>
        </RunnerSection>
        <RunnerSection title="Order">
          <div className="flex flex-wrap gap-2">
            {N_UP_ORDERS.map((o) => (
              <ChipButton
                key={o.id}
                onClick={() => set({ order: o.id })}
                disabled={busy}
                active={o.id === options.order}
              >
                {o.label}
              </ChipButton>
            ))}
          </div>
        </RunnerSection>
        <RunnerSection title="Margin">
          <div className="flex flex-wrap gap-2">
            {N_UP_MARGINS.map((m) => (
              <ChipButton
                key={m.id}
                onClick={() => set({ margin: m.id })}
                disabled={busy}
                active={m.id === options.margin}
              >
                {m.label}
                {m.points > 0 && (
                  <span className="text-muted text-[10px]">
                    {inches(m.points)} in
                  </span>
                )}
              </ChipButton>
            ))}
          </div>
        </RunnerSection>
      </div>

      <CheckboxField
        label="Draw a thin border around each page"
        checked={options.borders}
        onChange={(borders) => set({ borders })}
      />

      <PrivacyLine>
        The sheets are made on your device — the PDF never leaves your browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton onClick={onRun} busy={busy} busyLabel="Creating…">
            <Grid2x2 className="size-4" aria-hidden />
            {N_UP_RUN_LABEL}
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}
