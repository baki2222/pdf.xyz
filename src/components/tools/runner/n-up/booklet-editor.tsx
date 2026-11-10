"use client";

import { useState } from "react";
import { Download, NotebookText } from "lucide-react";
import {
  BOOKLET_BINDINGS,
  BOOKLET_BUSY_LABEL,
  BOOKLET_FLIPS,
  BOOKLET_PREVIEW_SIDES,
  BOOKLET_SHEETS,
  DEFAULT_BOOKLET_OPTIONS,
  bookletBackCoverBlocked,
  bookletDrawnPair,
  bookletOrder,
  bookletSideTurned,
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
import { cn, formatBytes } from "@/lib/utils";
import {
  ChipButton,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  useAsyncRun,
} from "../runner-kit";
import { RunBar } from "../run-bar";
import { FileHeader } from "../single-pdf-runner";
import { PrivacyLine } from "../stamp-controls";
import type { LoadedPdf } from "../use-single-pdf";

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

/** The back-cover hint: where the blank pages go, said in agreement with the count. */
export function bookletBlanksLine(blanks: number): string {
  return blanks === 1
    ? "The blank page goes before your last page instead of after it."
    : `The ${blanks} blank pages go before your last page instead of after it.`;
}

/**
 * The back-cover checkbox. Its own control, not the shared `CheckboxField`
 * (stamp-controls.tsx, first-load on 17 tool pages): an off state cost each
 * of those pages +28 B gz for one box on one tool (review, 2026-11-10).
 *
 * Off is SEEN, not only announced: the box and label are muted, because a
 * phone shows no cursor and a tap on an enabled-looking box that does
 * nothing reads as broken. `aria-disabled`, not `disabled`, so a keyboard
 * user still reaches the box and its reason. The label is at least 44 px
 * tall at every width: the whole row is the thumb target
 * (`e2e/booklet-pdf.mobile.spec.ts` measures it).
 */
function BackCoverField({
  checked,
  off,
  onChange,
  hint,
}: {
  checked: boolean;
  off: boolean;
  onChange: (checked: boolean) => void;
  hint: string;
}) {
  return (
    <label
      data-booklet-back-cover
      className={cn(
        "inline-flex min-h-11 items-start gap-2 py-2 text-sm",
        off ? "text-muted cursor-not-allowed" : "text-fg cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        aria-disabled={off || undefined}
        onChange={(event) => {
          if (!off) onChange(event.target.checked);
        }}
        className={cn(
          "accent-accent mt-0.5 size-4 shrink-0",
          off && "opacity-50",
        )}
      />
      <span className="flex flex-col gap-0.5">
        <span>Keep the last page as the back cover</span>
        <span className="text-muted text-xs">{hint}</span>
      </span>
    </label>
  );
}

/** The two-sided printing instruction for the flip the booklet was made for. */
export function bookletFlipLine(flip: BookletFlip): string {
  const other = BOOKLET_FLIPS.find((f) => f.id !== flip)!.label;
  return `Print it on both sides of the paper, flipping on the ${flipLabel(flip).toLowerCase()}. If the backs come out upside down, choose ${other} and create it again.`;
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

      <BackCoverField
        checked={options.backCover && blocked === null}
        off={busy || blocked !== null}
        onChange={(backCover) => set({ backCover })}
        hint={blocked ?? bookletBlanksLine(blanks)}
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
          {shown.map((side) => {
            // As the PDF page draws it: on Long edge a back is turned, so
            // its halves read the other way round in the file.
            const [left, right] = bookletDrawnPair(options.flip, side);
            return (
              <li
                key={`${side.sheet}-${side.face}`}
                className="flex justify-between gap-3"
              >
                <span className="text-muted">{sideName(side)}</span>
                <span>
                  {cell(left)} | {cell(right)}
                  {bookletSideTurned(options.flip, side) && (
                    <span className="text-muted"> (upside down)</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {options.flip === "long" && (
          <p className="text-muted text-xs">
            On {flipLabel("long")}, each back is drawn upside down in the PDF,
            so its two pages appear swapped there; the printer&apos;s turn puts
            them the right way up.
          </p>
        )}
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
