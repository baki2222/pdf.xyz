"use client";

import { RunReason } from "@/components/tools/runner/run-reason";
import { useEffect, useMemo, useState } from "react";
import { Download, PanelTop } from "lucide-react";
import {
  addHeaderFooter,
  DEFAULT_HEADER_FOOTER_SIZE,
  HEADER_FOOTER_MARGIN_LABELS,
  HEADER_FOOTER_MARGINS,
  HEADER_FOOTER_SIZES,
  headerFooterOutputName,
  headerFooterPlan,
  NO_PAGE_STAMPED,
  resolveStampDate,
  stampDateCandidates,
  type HeaderFooterMargin,
  type HeaderFooterZone,
} from "@/lib/pdf/header-footer";
import {
  applyTokens,
  hexToRgb,
  INK,
  rgbToHex,
  STAMP_FONT_FAMILIES,
  STAMP_FONT_LABELS,
  type HAlign,
  type StampFontFamily,
} from "@/lib/pdf/stamp";
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
  CheckboxField,
  ColorField,
  MoreOptions,
  NumberField,
  PrivacyLine,
  RangeField,
  SegmentedControl,
  TextField,
  TokenButtons,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * The three boxes each band offers, in order. Each box's name is its band and
 * this label ("Header left", "Footer center"); exported so the tool page and
 * option memory are pinned to the boxes the editor draws.
 */
export const ALIGN_OPTIONS: { value: HAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

/** The token buttons — exported so the page's Fields fact is pinned to them. */
export const TOKENS = [
  { token: "{n}", label: "{n}" },
  { token: "{total}", label: "{total}" },
  { token: "{date}", label: "{date}" },
];

export function HeaderFooterRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · header & footer applied locally in your browser"
      handoffSlug="header-footer"
      toolName="PDF Header & Footer"
    >
      {(pdf, reset) => <HeaderFooterEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

/** The default ink as a colour-input value; any other value is a choice. */
const DEFAULT_INK_HEX = rgbToHex(INK);

/** One band's text per box. */
type BandText = Record<HAlign, string>;

const EMPTY_BAND: BandText = { left: "", center: "", right: "" };

/** The footer a new document starts with, in the box it was last used in. */
const DEFAULT_FOOTER = "Page {n} of {total}";

/** What `band`'s boxes send the engine: only the ones holding text. */
function zoneOf(band: BandText): HeaderFooterZone | undefined {
  const zone: HeaderFooterZone = {};
  for (const { value } of ALIGN_OPTIONS)
    if (band[value].trim()) zone[value] = band[value];
  return Object.keys(zone).length > 0 ? zone : undefined;
}

/**
 * A band's three boxes and its field buttons. The buttons add to the box last
 * typed in or clicked in this band, which `target` holds; the Insert line
 * names it so the reader knows where the field will land.
 */
function BandFields({
  band,
  text,
  onChange,
  placeholders,
}: {
  band: "Header" | "Footer";
  text: BandText;
  onChange: (next: BandText) => void;
  placeholders: Partial<Record<HAlign, string>>;
}) {
  const [target, setTarget] = useState<HAlign>(
    () =>
      ALIGN_OPTIONS.find(({ value }) => text[value].trim())?.value ?? "center",
  );
  const targetLabel = ALIGN_OPTIONS.find((o) => o.value === target)!.label;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {ALIGN_OPTIONS.map(({ value, label }) => (
          <div key={value} onFocus={() => setTarget(value)}>
            <TextField
              label={`${band} ${label.toLowerCase()}`}
              value={text[value]}
              onChange={(next) => onChange({ ...text, [value]: next })}
              placeholder={placeholders[value]}
            />
          </div>
        ))}
      </div>
      <TokenButtons
        tokens={TOKENS}
        into={`${band} ${targetLabel.toLowerCase()}`}
        onInsert={(token) =>
          onChange({ ...text, [target]: text[target] + token })
        }
      />
    </div>
  );
}

export function HeaderFooterEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  // The box the footer's single line was in last time, never the words
  // (option memory): the default footer starts there.
  const [kept] = useState(() => recallOptions("header-footer"));
  const [header, setHeader] = useState<BandText>(EMPTY_BAND);
  const [footer, setFooter] = useState<BandText>(() => ({
    ...EMPTY_BAND,
    [kept.footerAlign ?? "center"]: DEFAULT_FOOTER,
  }));
  // Every template the user wrote, for the {date} resolver and the gate.
  const templates = useMemo(
    () => [
      ...ALIGN_OPTIONS.map(({ value }) => header[value]),
      ...ALIGN_OPTIONS.map(({ value }) => footer[value]),
    ],
    [header, footer],
  );
  // Which pages get the bands. Like Page Numbers' Start on page and First
  // number, these belong to ONE document and are never remembered (audit #28).
  const [pagesOpen, setPagesOpen] = useState(false);
  const [startPage, setStartPage] = useState(1);
  const [startAt, setStartAt] = useState(1);
  const [skipCover, setSkipCover] = useState(false);
  const [skipLast, setSkipLast] = useState(0);
  // How the lines look. Untouched, a run draws exactly what it always did:
  // Helvetica, 10 pt, slate ink, 32 pt from the edge.
  const [styleOpen, setStyleOpen] = useState(false);
  const [fontSize, setFontSize] = useState(DEFAULT_HEADER_FOOTER_SIZE);
  const [margin, setMargin] = useState<HeaderFooterMargin>("medium");
  const [font, setFont] = useState<StampFontFamily>("helvetica");
  const [inkHex, setInkHex] = useState(DEFAULT_INK_HEX);
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();

  // The engine's own arithmetic, so the preview, the summary and the Run gate
  // cannot disagree with what is drawn.
  const plan = useMemo(
    () =>
      headerFooterPlan(pdf.pageCount, {
        startPage,
        startAt,
        skipCover,
        skipLast,
      }),
    [pdf.pageCount, startPage, startAt, skipCover, skipLast],
  );
  const stampedCount = plan.stamps.length;

  // `{date}` in the reader's own locale format when a face we ship can draw it
  // beside what they typed, else the same day in Latin digits, else ISO. The
  // preview shows the value Run will stamp — it used to show an Arabic-Indic
  // date that Run then refused (see resolveStampDate).
  const [date, setDate] = useState(() => stampDateCandidates()[0] ?? "");
  useEffect(() => {
    let live = true;
    resolveStampDate(templates)
      .then((resolved) => {
        if (live) setDate(resolved);
      })
      .catch(() => {
        // Coverage tables failed to load: keep the current value; Run resolves
        // again and reports any real failure through the engine's own error.
      });
    return () => {
      live = false;
    };
  }, [templates]);

  // The preview reads as the FIRST page that gets the bands.
  const sampleTokens = useMemo(
    () => ({ n: plan.stamps[0]?.n ?? startAt, total: plan.total, date }),
    [plan, startAt, date],
  );
  // Each band's boxes as page 1 reads them, left to right.
  const preview = (band: BandText) =>
    ALIGN_OPTIONS.map(({ value }) => applyTokens(band[value], sampleTokens))
      .filter((line) => line.trim())
      .join("  ·  ");
  const headerPreview = preview(header);
  const footerPreview = preview(footer);

  const hasContent = templates.some((t) => t.trim().length > 0);

  const onRun = () => {
    // A footer in exactly one box is remembered by that box; otherwise the
    // last choice stands.
    const footerBoxes = ALIGN_OPTIONS.filter(({ value }) =>
      footer[value].trim(),
    );
    if (footerBoxes.length === 1)
      rememberOptions("header-footer", { footerAlign: footerBoxes[0]!.value });
    return run(async () =>
      addHeaderFooter(pdf.bytes, {
        header: zoneOf(header),
        footer: zoneOf(footer),
        startPage,
        startAt,
        skipCover,
        skipLast,
        fontSize,
        margin: HEADER_FOOTER_MARGINS[margin],
        font,
        // The default ink is passed as nothing at all, so an untouched run
        // draws exactly the colour it always did.
        ...(inkHex !== DEFAULT_INK_HEX && hexToRgb(inkHex)
          ? { color: hexToRgb(inkHex)! }
          : {}),
        date: await resolveStampDate(templates),
      }),
    );
  };

  if (result) {
    return (
      <ResultPanel
        title="Header & footer added"
        summary={`${
          stampedCount === pdf.pageCount
            ? `Applied to all ${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"}`
            : `Applied to ${stampedCount} of ${pdf.pageCount} pages`
        } · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
        output={outputFile(result, headerFooterOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, headerFooterOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Header"
        aside={
          headerPreview.trim() && (
            <span className="border-line bg-wash text-muted rounded-tag border px-2.5 py-1 text-xs">
              {headerPreview}
            </span>
          )
        }
      >
        <BandFields
          band="Header"
          text={header}
          onChange={setHeader}
          placeholders={{ left: "e.g. Acme Ltd", right: "e.g. {date}" }}
        />
      </RunnerSection>

      <RunnerSection
        title="Footer"
        aside={
          footerPreview.trim() && (
            <span className="border-line bg-wash text-muted rounded-tag border px-2.5 py-1 text-xs">
              {footerPreview}
            </span>
          )
        }
      >
        <BandFields
          band="Footer"
          text={footer}
          onChange={setFooter}
          placeholders={{
            left: "e.g. Confidential",
            right: "e.g. {n} / {total}",
          }}
        />
      </RunnerSection>

      <MoreOptions label="Pages" open={pagesOpen} onToggle={setPagesOpen}>
        <div className="flex flex-col gap-3">
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
          <CheckboxField
            label="Leave the cover page blank"
            checked={skipCover}
            onChange={setSkipCover}
            hint="Page 1 gets no header or footer but is still counted, so page 2 shows {n} as 2."
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
      </MoreOptions>

      <MoreOptions
        label="Size, margin, font and color"
        open={styleOpen}
        onToggle={setStyleOpen}
      >
        <RangeField
          label="Font size"
          value={fontSize}
          min={HEADER_FOOTER_SIZES.min}
          max={HEADER_FOOTER_SIZES.max}
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
              Object.keys(HEADER_FOOTER_MARGINS) as HeaderFooterMargin[]
            ).map((key) => ({
              value: key,
              label: HEADER_FOOTER_MARGIN_LABELS[key],
            }))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-muted text-xs font-medium">Font</span>
          <SegmentedControl
            label="Header and footer font"
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
        Headers and footers are drawn on your device — nothing is uploaded.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunReason
            reason={
              !hasContent
                ? "Type a header or a footer first."
                : stampedCount === 0
                  ? NO_PAGE_STAMPED
                  : null
            }
          >
            {(describedBy) => (
              <RunButton
                onClick={onRun}
                busy={busy}
                describedBy={describedBy}
                disabled={!hasContent || stampedCount === 0}
                busyLabel="Applying…"
              >
                <PanelTop className="size-4" aria-hidden />
                Add header &amp; footer
              </RunButton>
            )}
          </RunReason>
        </div>
      </RunBar>
    </div>
  );
}
