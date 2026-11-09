"use client";

import { useState } from "react";
import { Download, NotebookText } from "lucide-react";
import {
  BOOKLET_BINDINGS,
  BOOKLET_BUSY_LABEL,
  BOOKLET_FLIPS,
  BOOKLET_SHEETS,
  DEFAULT_BOOKLET_OPTIONS,
  bookletBackCoverBlocked,
  bookletOrder,
  bookletOutputName,
  bookletPageSlots,
  bookletPdf,
  type BookletFlip,
  type BookletOptions,
  type BookletResult,
  type BookletSide,
} from "@/lib/pdf/booklet";
import { N_UP_MARGINS } from "@/lib/pdf/n-up";
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

/** How many sides the preview lists before it summarises the rest. */
export const BOOKLET_PREVIEW_SIDES = 8;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const flipLabel = (id: BookletFlip) =>
  BOOKLET_FLIPS.find((f) => f.id === id)!.label;

/** "blank" or the page number, for the preview. */
const cell = (page: number | null) => (page === null ? "blank" : `${page}`);

function sideName(side: BookletSide): string {
  return `Sheet ${side.sheet + 1} ${side.face}`;
}

/** What the result says about the size the pages are drawn at. */
export function bookletScaleLine(scale: BookletResult["scalePercent"]): string {
  return scale.min === scale.max
    ? `Pages are drawn at ${scale.min}% of their size.`
    : `Pages are drawn at ${scale.min}% to ${scale.max}% of their size.`;
}

/** The two-sided printing instruction for the flip the booklet was made for. */
export function bookletFlipLine(flip: BookletFlip): string {
  const other = BOOKLET_FLIPS.find((f) => f.id !== flip)!.label;
  return `Print it on both sides of the paper, flipping on the ${flipLabel(flip).toLowerCase()}. If the backs come out upside down, choose ${other} and create it again.`;
}

/** PDF Booklet Maker's runner: one PDF, then the booklet editor. */
export function BookletRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · pages put in booklet order locally in your browser"
      handoffSlug="booklet-pdf"
      toolName="PDF Booklet Maker"
    >
      {(pdf, reset) => <BookletEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

export function BookletEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [options, setOptions] = useState<BookletOptions>({
    ...DEFAULT_BOOKLET_OPTIONS,
  });
  const { busy, error, result, run, reset } = useAsyncRun<BookletResult>();
  const set = (next: Partial<BookletOptions>) => {
    if (!busy) setOptions((prev) => ({ ...prev, ...next }));
  };
  const blocked = bookletBackCoverBlocked(pdf.pageCount);
  const slots = bookletPageSlots(pdf.pageCount);
  const sheets = slots / 4;
  const blanks = slots - pdf.pageCount;
  const order = bookletOrder(pdf.pageCount, {
    binding: options.binding,
    backCover: options.backCover && blocked === null,
  });

  const onRun = () => {
    void run(() =>
      bookletPdf(pdf.bytes, {
        ...options,
        backCover: options.backCover && blocked === null,
      }),
    );
  };

  if (result) {
    const name = bookletOutputName(pdf.file.name);
    return (
      <ResultPanel
        // Typed here, like the run button and the back-cover box below, so
        // the page-copy guards read them in the runner's source;
        // booklet-editor.test.tsx holds each to its booklet.ts constant,
        // which the tool page and its steps quote.
        title="Booklet created"
        summary={`${plural(result.sourcePages, "page")}${result.blanks > 0 ? ` + ${plural(result.blanks, "blank page")}` : ""} on ${plural(result.sheets, "sheet")} · ${plural(result.sides, "PDF page")} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, name)}
        onAdjust={reset}
        expectedPages={result.sides}
      >
        <div className="flex flex-col gap-3">
          <p className="max-w-2xl text-sm">{bookletFlipLine(result.flip)}</p>
          <p className="text-muted max-w-2xl text-sm">
            {bookletScaleLine(result.scalePercent)} Links and form fields on the
            original pages are not clickable in the booklet: each page is placed
            as a drawing.
          </p>
          {result.undrawnFields.length > 0 && (
            <p role="status" className="max-w-2xl text-sm">
              Not in the booklet: the value of {result.undrawnFields.join(", ")}
              . The file holds no drawing of it and it could not be drawn here,
              so keep the original to show it.
            </p>
          )}
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

  const shown = order.slice(0, BOOKLET_PREVIEW_SIDES);
  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <div className="grid gap-5 sm:grid-cols-2">
        <RunnerSection title="Sheet size">
          <div className="flex flex-wrap gap-2">
            {BOOKLET_SHEETS.map((sheet) => (
              <ChipButton
                key={sheet.id}
                onClick={() => set({ sheet: sheet.id })}
                disabled={busy}
                active={sheet.id === options.sheet}
                title={
                  sheet.size
                    ? `${inches(Math.max(sheet.size.width, sheet.size.height))} × ${inches(Math.min(sheet.size.width, sheet.size.height))} in, landscape`
                    : "Each sheet two of your first page wide"
                }
              >
                {sheet.label}
              </ChipButton>
            ))}
          </div>
        </RunnerSection>
        <RunnerSection title="Binding">
          <div className="flex flex-wrap gap-2">
            {BOOKLET_BINDINGS.map((b) => (
              <ChipButton
                key={b.id}
                onClick={() => set({ binding: b.id })}
                disabled={busy}
                active={b.id === options.binding}
              >
                {b.label}
              </ChipButton>
            ))}
          </div>
        </RunnerSection>
        <RunnerSection title="Flip">
          <div className="flex flex-wrap gap-2">
            {BOOKLET_FLIPS.map((f) => (
              <ChipButton
                key={f.id}
                onClick={() => set({ flip: f.id })}
                disabled={busy}
                active={f.id === options.flip}
              >
                {f.label}
              </ChipButton>
            ))}
          </div>
          <p className="text-muted text-xs">
            The edge your printer flips the paper on when it prints both sides.
          </p>
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
        label="Keep the last page as the back cover"
        checked={options.backCover && blocked === null}
        disabled={busy || blocked !== null}
        onChange={(backCover) => set({ backCover })}
        hint={
          blocked ??
          `The ${plural(blanks, "blank page")} go before your last page instead of after it.`
        }
      />

      <RunnerSection
        title="Page order"
        aside={
          <span className="text-muted tnum text-xs">
            {plural(pdf.pageCount, "page")}
            {blanks > 0 ? ` + ${plural(blanks, "blank")}` : ""} →{" "}
            {plural(sheets, "sheet")}
          </span>
        }
      >
        <ol
          aria-label="Page order on each side"
          className="tnum grid gap-1 text-xs sm:grid-cols-2"
        >
          {shown.map((side) => (
            <li
              key={`${side.sheet}-${side.face}`}
              className="flex justify-between gap-3"
            >
              <span className="text-muted">{sideName(side)}</span>
              <span>
                {cell(side.left)} | {cell(side.right)}
              </span>
            </li>
          ))}
        </ol>
        {order.length > shown.length && (
          <p className="text-muted text-xs">
            …and {plural(order.length - shown.length, "more side")}.
          </p>
        )}
      </RunnerSection>

      <PrivacyLine>
        The booklet is made on your device — the PDF never leaves your browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton onClick={onRun} busy={busy} busyLabel={BOOKLET_BUSY_LABEL}>
            <NotebookText className="size-4" aria-hidden />
            Create booklet
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}
