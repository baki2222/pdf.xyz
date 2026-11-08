"use client";

import dynamic from "next/dynamic";
import { RunReason } from "@/components/tools/runner/run-reason";
import { useMemo, useState } from "react";
import { Download, ListOrdered } from "lucide-react";
import {
  addPageNumbers,
  BATES_MAX_DIGITS,
  batesFormat,
  DEFAULT_BATES_DIGITS,
  DEFAULT_PAGE_NUMBER_FORMAT,
  numberedOutputName,
  numberingPlan,
  NUMBER_STYLES,
  PAGE_NUMBER_MARGINS,
  previewPageNumber,
  validatePageNumberFormat,
  type NumberStyle,
  type PageNumberMargin,
} from "@/lib/pdf/page-numbers";
import {
  hexToRgb,
  INK,
  rgbToHex,
  STAMP_FONT_FAMILIES,
  STAMP_FONT_LABELS,
  type StampFontFamily,
  type StampPosition,
} from "@/lib/pdf/stamp";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import {
  OPTION_SCHEMAS,
  recallOptions,
  rememberOptions,
} from "@/lib/intent/option-memory";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  errorMessage,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import {
  FileHeader,
  SinglePdfRunner,
  type SinglePdfBatch,
} from "./single-pdf-runner";
import {
  CheckboxField,
  ColorField,
  MoreOptions,
  NumberField,
  POSITION_LABELS,
  PositionPicker,
  PrivacyLine,
  RangeField,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * The offered presets. Exported so the tool page's stated facts can be pinned
 * to them: the facts entry claimed "Three numbering formats" while this list
 * held four and a free-form field sat beside it, and nothing connected the two.
 */
export const FORMAT_PRESETS: { value: string; label: string }[] = [
  { value: "Page {n} of {total}", label: "Page 1 of N" },
  { value: "{n} / {total}", label: "1 / N" },
  { value: "{n}", label: "1" },
  { value: "- {n} -", label: "- 1 -" },
];

/** The margin presets as the runner labels them, smallest first. */
const MARGIN_LABELS: Record<PageNumberMargin, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

/** Where the number sits until someone picks another cell. */
const DEFAULT_POSITION: StampPosition = "bottom-center";

/** The default ink as a colour-input value; any other value is a choice. */
const DEFAULT_INK_HEX = rgbToHex(INK);

/**
 * Two or more PDFs: the batch (batch plan P1), its own chunk, fetched only
 * when they arrive — never with a visit to this page.
 */
const PageNumbersBatch = dynamic(
  () => import("./batch/page-numbers-batch").then((m) => m.PageNumbersBatch),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);
const batch = (props: SinglePdfBatch) => <PageNumbersBatch {...props} />;

export function PageNumbersRunner() {
  return (
    <SinglePdfRunner
      hint="One or more PDFs · numbers stamped locally in your browser"
      batch={batch}
      handoffSlug="page-numbers"
      toolName="Add Page Numbers"
    >
      {(pdf, reset) => <PageNumbersEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

export function PageNumbersEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  // The last preset and position chosen here (option memory). A custom
  // format is typed text and is never kept; Start on page and First number
  // belong to one document and are never kept either.
  const [kept] = useState(() => recallOptions("page-numbers"));
  const [format, setFormat] = useState<string>(
    kept.format ?? DEFAULT_PAGE_NUMBER_FORMAT,
  );
  const [position, setPosition] = useState<StampPosition>(
    kept.position ?? DEFAULT_POSITION,
  );
  const [startPage, setStartPage] = useState(1);
  const [startAt, setStartAt] = useState(1);
  const [fontSize, setFontSize] = useState(11);
  const [margin, setMargin] = useState<PageNumberMargin>("medium");
  const [moreOpen, setMoreOpen] = useState(false);
  const [skipCover, setSkipCover] = useState(false);
  const [skipLast, setSkipLast] = useState(0);
  const [facing, setFacing] = useState(false);
  const [font, setFont] = useState<StampFontFamily>("helvetica");
  const [inkHex, setInkHex] = useState(DEFAULT_INK_HEX);
  const [style, setStyle] = useState<NumberStyle>("pages");
  const [batesPrefix, setBatesPrefix] = useState("");
  const [batesDigits, setBatesDigits] = useState(DEFAULT_BATES_DIGITS);
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();

  // What came back from the last visit and is still in use — said on screen,
  // with a way back to the defaults the tool page describes.
  const carried = [
    kept.position && kept.position !== DEFAULT_POSITION
      ? position === kept.position && POSITION_LABELS[position]
      : null,
    kept.format && kept.format !== DEFAULT_PAGE_NUMBER_FORMAT
      ? style === "pages" &&
        format === kept.format &&
        FORMAT_PRESETS.find((p) => p.value === format)?.label
      : null,
  ].filter((label): label is string => Boolean(label));
  const useDefaults = () => {
    setPosition(DEFAULT_POSITION);
    setFormat(DEFAULT_PAGE_NUMBER_FORMAT);
  };

  // The template actually drawn: the typed or preset one, or the Bates
  // style's prefix + padded number.
  const template =
    style === "bates" ? batesFormat(batesPrefix, batesDigits) : format;
  // Said before the run, in the engine's own words, rather than after it.
  const formatProblem = useMemo(() => {
    try {
      validatePageNumberFormat(template || DEFAULT_PAGE_NUMBER_FORMAT);
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }, [template]);

  // The engine's own arithmetic, so the preview and the summary cannot
  // disagree with what is drawn.
  const plan = useMemo(
    () =>
      numberingPlan(pdf.pageCount, { startPage, startAt, skipCover, skipLast }),
    [pdf.pageCount, startPage, startAt, skipCover, skipLast],
  );
  const numberedCount = plan.stamps.length;
  const preview = useMemo(() => {
    const first = plan.stamps[0];
    if (!first) return "";
    return previewPageNumber(
      template || DEFAULT_PAGE_NUMBER_FORMAT,
      first.n,
      plan.total,
    );
  }, [template, plan]);

  const onRun = () => {
    // A preset is kept; anything typed is not (a Bates prefix is typed).
    const preset =
      style === "pages"
        ? OPTION_SCHEMAS["page-numbers"].format.values.find(
            (value) => value === format,
          )
        : undefined;
    rememberOptions("page-numbers", {
      position,
      ...(preset ? { format: preset } : {}),
    });
    return run(() =>
      addPageNumbers(pdf.bytes, {
        format: template,
        position,
        startPage,
        startAt,
        fontSize,
        margin: PAGE_NUMBER_MARGINS[margin],
        skipCover,
        skipLast,
        facing,
        font,
        // The default ink is passed as nothing at all, so an untouched run
        // draws exactly the colour it always did.
        ...(inkHex !== DEFAULT_INK_HEX && hexToRgb(inkHex)
          ? { color: hexToRgb(inkHex)! }
          : {}),
      }),
    );
  };

  if (result) {
    return (
      <ResultPanel
        title="Page numbers added"
        summary={`${numberedCount} page${numberedCount === 1 ? "" : "s"} numbered · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
        output={outputFile(result, numberedOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, numberedOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download numbered PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      {carried.length > 0 && (
        <p
          role="status"
          className="border-line bg-wash text-muted rounded-panel flex flex-wrap items-center gap-x-3 gap-y-1 border px-4 py-3 text-sm"
        >
          <span>Using your last settings: {carried.join(" · ")}.</span>
          <button
            type="button"
            onClick={useDefaults}
            className="text-fg underline underline-offset-2"
          >
            Use defaults
          </button>
        </p>
      )}

      <RunnerSection
        title="Format"
        aside={
          <span className="border-line bg-wash text-muted rounded-tag border px-2.5 py-1 text-xs">
            Preview: <span className="text-accent">{preview || "—"}</span>
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          <SegmentedControl
            label="Numbering style"
            value={style}
            options={[...NUMBER_STYLES]}
            onChange={setStyle}
          />
          {style === "pages" ? (
            <>
              <SegmentedControl
                label="Number format preset"
                value={
                  FORMAT_PRESETS.some((p) => p.value === format) ? format : ""
                }
                options={[
                  ...FORMAT_PRESETS,
                  ...(FORMAT_PRESETS.some((p) => p.value === format)
                    ? []
                    : [{ value: "", label: "Custom" }]),
                ]}
                onChange={(value) => value && setFormat(value)}
              />
              <TextField
                label="Custom format ({n} = page, {total} = count, {n:6} = 000001)"
                value={format}
                onChange={setFormat}
                placeholder={DEFAULT_PAGE_NUMBER_FORMAT}
              />
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Prefix"
                  value={batesPrefix}
                  onChange={setBatesPrefix}
                  placeholder="ACME-"
                />
                <NumberField
                  label="Digits"
                  value={batesDigits}
                  min={1}
                  max={BATES_MAX_DIGITS}
                  onChange={setBatesDigits}
                />
              </div>
              <p className="text-muted text-xs">
                Every page gets the prefix and a number padded with zeros to
                that many digits. It counts up from First number, under
                Placement, so a new batch can carry on from the last one.
              </p>
            </>
          )}
          {formatProblem && <ErrorNote message={formatProblem} />}
        </div>
      </RunnerSection>

      <RunnerSection title="Placement">
        <div className="flex flex-wrap items-start gap-6">
          <PositionPicker value={position} onChange={setPosition} />
          <div className="flex min-w-52 flex-1 flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Start on page"
                value={startPage}
                min={1}
                max={Math.max(1, pdf.pageCount)}
                onChange={setStartPage}
              />
              <NumberField
                label="First number"
                value={startAt}
                min={0}
                max={99999}
                onChange={setStartAt}
              />
            </div>
            <RangeField
              label="Font size"
              value={fontSize}
              min={7}
              max={28}
              onChange={setFontSize}
              format={(v) => `${v} pt`}
            />
            <div className="flex flex-col gap-2">
              <span className="text-muted text-xs font-medium">Margin</span>
              <SegmentedControl
                label="Margin from the page edge"
                value={margin}
                onChange={setMargin}
                options={(
                  Object.keys(PAGE_NUMBER_MARGINS) as PageNumberMargin[]
                ).map((key) => ({ value: key, label: MARGIN_LABELS[key] }))}
              />
            </div>
          </div>
        </div>
      </RunnerSection>

      <MoreOptions
        label="Pages, font and color"
        open={moreOpen}
        onToggle={setMoreOpen}
      >
        <div className="flex flex-col gap-3">
          <CheckboxField
            label="Leave the cover unnumbered"
            checked={skipCover}
            onChange={setSkipCover}
            hint="Page 1 is counted but gets no number, so page 2 shows the next one."
          />
          <CheckboxField
            label="Facing pages"
            checked={facing}
            onChange={setFacing}
            hint="Swaps left and right on even pages, for printing as a book."
          />
          <div className="max-w-52">
            <NumberField
              label="Skip last pages"
              value={skipLast}
              min={0}
              max={Math.max(0, pdf.pageCount - 1)}
              onChange={setSkipLast}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-muted text-xs font-medium">Font</span>
          <SegmentedControl
            label="Page number font"
            value={font}
            onChange={setFont}
            options={STAMP_FONT_FAMILIES.map((family) => ({
              value: family,
              label: STAMP_FONT_LABELS[family],
            }))}
          />
        </div>
        <ColorField label="Color" value={inkHex} onChange={setInkHex} />
      </MoreOptions>

      <PrivacyLine>
        Numbers are drawn on your device — the PDF never leaves your browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunReason
            reason={
              numberedCount === 0
                ? "No page gets a number with these settings."
                : formatProblem
                  ? "Fix the number format above first."
                  : null
            }
          >
            {(describedBy) => (
              <RunButton
                onClick={onRun}
                busy={busy}
                describedBy={describedBy}
                disabled={numberedCount === 0 || formatProblem !== null}
                busyLabel="Numbering…"
              >
                <ListOrdered className="size-4" aria-hidden />
                Add page numbers
              </RunButton>
            )}
          </RunReason>
        </div>
      </RunBar>
    </div>
  );
}
