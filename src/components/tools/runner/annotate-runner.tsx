"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Highlighter,
  Info,
  Layers,
  Lock,
  PenLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import {
  annotatePdf,
  annotatedOutputName,
  getAnnotatePageSizes,
  validateAnnotations,
  type Annotation,
  type AnnotationType,
  type AnnotateResult,
  type PageSize,
} from "@/lib/pdf/annotate";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  useAsyncRun,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import {
  NumberField,
  PrivacyLine,
  RangeField,
  SegmentedControl,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/** A placed markup plus a stable id for list/preview rendering. */
interface Markup {
  id: number;
  annotation: Annotation;
}

/** Flat form state covering every markup type; `buildAnnotation` narrows it. */
interface Draft {
  type: AnnotationType;
  page: number;
  color: string;
  /** Rect/highlight lower-left & note anchor & line start. */
  x: number;
  y: number;
  /** Rect/highlight size. */
  width: number;
  height: number;
  /** Highlight fill opacity, as a percentage. */
  opacity: number;
  /** Rect outline width, points. */
  borderWidth: number;
  /** Note text. */
  text: string;
  /** Note font size, points. */
  size: number;
  /** Note wrap width, points (0 = no wrapping). */
  wrapWidth: number;
  /** Line end point. */
  x2: number;
  y2: number;
  /** Line thickness, points. */
  thickness: number;
  /** Draw an arrowhead at the line's end. */
  arrow: boolean;
}

const DEFAULT_DRAFT: Draft = {
  type: "highlight",
  page: 1,
  color: "#facc15",
  x: 72,
  y: 690,
  width: 220,
  height: 16,
  opacity: 40,
  borderWidth: 2,
  text: "",
  size: 14,
  wrapWidth: 220,
  x2: 300,
  y2: 690,
  thickness: 2,
  arrow: true,
};

const TYPE_OPTIONS: {
  value: AnnotationType;
  label: string;
  icon: typeof Square;
}[] = [
  { value: "highlight", label: "Highlight", icon: Highlighter },
  { value: "rect", label: "Box", icon: Square },
  { value: "note", label: "Note", icon: Type },
  { value: "line", label: "Line", icon: PenLine },
];

/** A curated markup palette — bright enough to read over page content. */
const PALETTE: { hex: string; label: string }[] = [
  { hex: "#facc15", label: "Yellow" },
  { hex: "#fb923c", label: "Orange" },
  { hex: "#f87171", label: "Red" },
  { hex: "#34d399", label: "Green" },
  { hex: "#60a5fa", label: "Blue" },
  { hex: "#a78bfa", label: "Violet" },
  { hex: "#111827", label: "Black" },
];

/** Narrow the flat draft into a concrete, typed annotation. */
function buildAnnotation(draft: Draft): Annotation {
  const { page, color } = draft;
  switch (draft.type) {
    case "highlight":
      return {
        type: "highlight",
        page,
        color,
        x: draft.x,
        y: draft.y,
        width: draft.width,
        height: draft.height,
        opacity: draft.opacity / 100,
      };
    case "rect":
      return {
        type: "rect",
        page,
        color,
        x: draft.x,
        y: draft.y,
        width: draft.width,
        height: draft.height,
        borderWidth: draft.borderWidth,
      };
    case "note":
      return {
        type: "note",
        page,
        color,
        x: draft.x,
        y: draft.y,
        text: draft.text,
        size: draft.size,
        maxWidth: draft.wrapWidth > 0 ? draft.wrapWidth : undefined,
      };
    case "line":
      return {
        type: "line",
        page,
        color,
        x1: draft.x,
        y1: draft.y,
        x2: draft.x2,
        y2: draft.y2,
        thickness: draft.thickness,
        arrow: draft.arrow,
      };
  }
}

const TYPE_LABEL: Record<AnnotationType, string> = {
  highlight: "Highlight",
  rect: "Box",
  note: "Note",
  line: "Line",
};

/** A one-line summary of a placed markup for the list. */
function describeMarkup(annotation: Annotation): string {
  switch (annotation.type) {
    case "highlight":
    case "rect":
      return `x ${annotation.x}, y ${annotation.y} · ${annotation.width} × ${annotation.height} pt`;
    case "note":
      return `x ${annotation.x}, y ${annotation.y} · “${annotation.text.slice(0, 24)}${annotation.text.length > 24 ? "…" : ""}”`;
    case "line":
      return `(${annotation.x1}, ${annotation.y1}) → (${annotation.x2}, ${annotation.y2})${annotation.arrow ? " · arrow" : ""}`;
  }
}

export function AnnotateRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · marked up locally in your browser"
      handoffSlug="annotate-pdf"
      toolName="Annotate PDF"
    >
      {(pdf, reset) => <AnnotateEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function AnnotateEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const { busy, error, result, run } = useAsyncRun<AnnotateResult>();
  const [pageSizes, setPageSizes] = useState<PageSize[] | null>(null);
  const [markups, setMarkups] = useState<Markup[]>([]);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const idRef = useRef(0);

  // Content-space page sizes back the preview and validation. The editor subtree
  // is keyed by file, so this runs once per document.
  useEffect(() => {
    let alive = true;
    getAnnotatePageSizes(pdf.bytes)
      .then((sizes) => {
        if (alive) setPageSizes(sizes);
      })
      .catch(() => {
        // Sizes only gate the builder; failing to read them leaves it disabled
        // rather than crashing the tool.
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  const activePage = pageSizes?.[draft.page - 1] ?? null;
  const maxW = activePage ? Math.max(1, Math.floor(activePage.width)) : 100000;
  const maxH = activePage ? Math.max(1, Math.floor(activePage.height)) : 100000;

  const pageMarkups = useMemo(
    () => markups.filter((markup) => markup.annotation.page === draft.page),
    [markups, draft.page],
  );

  const setField = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const addMarkup = () => {
    if (!pageSizes) return;
    const annotation = buildAnnotation(draft);
    const issues = validateAnnotations([annotation], pageSizes);
    if (issues.length > 0) {
      setFormError(issues[0]!.message);
      return;
    }
    setFormError(null);
    setMarkups((prev) => [...prev, { id: idRef.current++, annotation }]);
  };

  const removeMarkup = (id: number) =>
    setMarkups((prev) => prev.filter((markup) => markup.id !== id));

  const onRun = () => {
    if (markups.length === 0 || !pageSizes) return;
    const annotations = markups.map((markup) => markup.annotation);
    const issues = validateAnnotations(annotations, pageSizes);
    if (issues.length > 0) {
      setFormError(issues[0]!.message);
      return;
    }
    setFormError(null);
    void run(() => annotatePdf(pdf.bytes, annotations));
  };

  if (result) {
    return (
      <ResultPanel
        title="Annotated PDF ready"
        summary={`${result.annotationCount} markup${result.annotationCount === 1 ? "" : "s"} flattened across ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.bytes, annotatedOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download annotated PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Add markup"
        aside={
          <span className="text-muted text-xs">
            Points from bottom-left · 72 pt = 1 in
          </span>
        }
      >
        <div className="border-line bg-wash flex flex-col gap-4 rounded-[4px] border p-4">
          <TypePicker
            value={draft.type}
            onChange={(type) => setField("type", type)}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted text-xs">
              {activePage
                ? `Page ${draft.page} is ${Math.round(activePage.width)} × ${Math.round(activePage.height)} pt`
                : "Reading page sizes…"}
            </span>
            <ColorSwatches
              value={draft.color}
              onChange={(color) => setField("color", color)}
            />
          </div>

          <TypeFields
            draft={draft}
            pageCount={pdf.pageCount}
            maxW={maxW}
            maxH={maxH}
            setField={setField}
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={addMarkup}
              aria-disabled={!pageSizes || undefined}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Plus className="size-4" aria-hidden />
              Add markup
            </button>
          </div>

          {formError && <ErrorNote message={formError} />}
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <MarkupList markups={markups} onRemove={removeMarkup} />
          <PagePreview
            page={activePage}
            pageNumber={draft.page}
            markups={pageMarkups}
          />
        </div>
      </RunnerSection>

      <HonestScopeNote />

      <div className="grid gap-3 sm:grid-cols-3">
        <InfoTile
          icon={Sparkles}
          title="Real vector markup"
          body="Highlights, boxes, notes, and lines are drawn as vector content — your page text and graphics stay crisp and selectable, not flattened to an image."
        />
        <InfoTile
          icon={Lock}
          title="Baked into the page"
          body="Markups become part of the page content on export. They aren't separate PDF comment objects a reader can toggle, reply to, or delete."
        />
        <InfoTile
          icon={ShieldCheck}
          title="Local only"
          body="Everything runs in your browser with pdf-lib — your PDF is never uploaded."
        />
      </div>

      <PrivacyLine>
        Markups are applied on your device — your PDF never leaves the browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton
          onClick={onRun}
          busy={busy}
          disabled={markups.length === 0 || !pageSizes}
          busyLabel="Applying…"
        >
          <Layers className="size-4" aria-hidden />
          Apply {markups.length} markup{markups.length === 1 ? "" : "s"}
        </RunButton>
      </div>
    </div>
  );
}

function TypePicker({
  value,
  onChange,
}: {
  value: AnnotationType;
  onChange: (type: AnnotationType) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Markup type"
      className="flex flex-wrap gap-2"
    >
      {TYPE_OPTIONS.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[3px] border px-3 py-1.5 text-xs font-medium transition",
              active
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-line bg-wash text-muted hover:border-line-strong hover:bg-wash hover:text-fg",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Markup color"
      className="flex items-center gap-1.5"
    >
      {PALETTE.map((swatch) => {
        const active = swatch.hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={swatch.hex}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={swatch.label}
            title={swatch.label}
            onClick={() => onChange(swatch.hex)}
            className={cn(
              "size-5 rounded-full ring-offset-1 ring-offset-black/40 transition",
              active
                ? "ring-2 ring-white"
                : "ring-1 ring-white/20 hover:ring-white/50",
            )}
            style={{ backgroundColor: swatch.hex }}
          />
        );
      })}
    </div>
  );
}

/** Per-type coordinate/size controls, driven off the flat draft. */
function TypeFields({
  draft,
  pageCount,
  maxW,
  maxH,
  setField,
}: {
  draft: Draft;
  pageCount: number;
  maxW: number;
  maxH: number;
  setField: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
}) {
  const pageField = (
    <NumberField
      label="Page"
      value={draft.page}
      min={1}
      max={pageCount}
      onChange={(value) => setField("page", value)}
    />
  );

  if (draft.type === "highlight" || draft.type === "rect") {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {pageField}
          <NumberField
            label="X (pt)"
            value={draft.x}
            min={0}
            max={maxW}
            onChange={(v) => setField("x", v)}
          />
          <NumberField
            label="Y (pt)"
            value={draft.y}
            min={0}
            max={maxH}
            onChange={(v) => setField("y", v)}
          />
          <NumberField
            label="Width (pt)"
            value={draft.width}
            min={1}
            max={maxW}
            onChange={(v) => setField("width", v)}
          />
          <NumberField
            label="Height (pt)"
            value={draft.height}
            min={1}
            max={maxH}
            onChange={(v) => setField("height", v)}
          />
        </div>
        {draft.type === "highlight" ? (
          <RangeField
            label="Fill opacity"
            value={draft.opacity}
            min={10}
            max={100}
            step={5}
            onChange={(v) => setField("opacity", v)}
            format={(v) => `${v}%`}
          />
        ) : (
          <RangeField
            label="Outline width"
            value={draft.borderWidth}
            min={1}
            max={8}
            step={1}
            onChange={(v) => setField("borderWidth", v)}
            format={(v) => `${v} pt`}
          />
        )}
      </div>
    );
  }

  if (draft.type === "note") {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {pageField}
          <NumberField
            label="X (pt)"
            value={draft.x}
            min={0}
            max={maxW}
            onChange={(v) => setField("x", v)}
          />
          <NumberField
            label="Y (pt)"
            value={draft.y}
            min={0}
            max={maxH}
            onChange={(v) => setField("y", v)}
          />
          <NumberField
            label="Wrap (pt)"
            value={draft.wrapWidth}
            min={0}
            max={maxW}
            onChange={(v) => setField("wrapWidth", v)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="annotate-note-text"
            className="text-muted text-xs font-medium"
          >
            Note text
          </label>
          <textarea
            id="annotate-note-text"
            value={draft.text}
            rows={2}
            placeholder="Type the note to place on the page…"
            onChange={(event) => setField("text", event.target.value)}
            className="border-line text-fg placeholder:text-muted focus:border-accent/40 focus:ring-accent/50 w-full resize-y rounded-[3px] border bg-black/20 px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
          />
          <span className="text-muted text-[11px]">
            Y is the baseline of the first line; wrapped lines flow downward.
            Wrap 0 = one line per line break.
          </span>
        </div>
        <RangeField
          label="Font size"
          value={draft.size}
          min={8}
          max={36}
          step={1}
          onChange={(v) => setField("size", v)}
          format={(v) => `${v} pt`}
        />
      </div>
    );
  }

  // Line
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {pageField}
        <NumberField
          label="Start X"
          value={draft.x}
          min={0}
          max={maxW}
          onChange={(v) => setField("x", v)}
        />
        <NumberField
          label="Start Y"
          value={draft.y}
          min={0}
          max={maxH}
          onChange={(v) => setField("y", v)}
        />
        <NumberField
          label="End X"
          value={draft.x2}
          min={0}
          max={maxW}
          onChange={(v) => setField("x2", v)}
        />
        <NumberField
          label="End Y"
          value={draft.y2}
          min={0}
          max={maxH}
          onChange={(v) => setField("y2", v)}
        />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangeField
          label="Thickness"
          value={draft.thickness}
          min={1}
          max={8}
          step={1}
          onChange={(v) => setField("thickness", v)}
          format={(v) => `${v} pt`}
        />
        <SegmentedControl
          label="Arrowhead"
          value={draft.arrow ? "arrow" : "plain"}
          onChange={(value) => setField("arrow", value === "arrow")}
          options={[
            { value: "plain", label: "Line" },
            { value: "arrow", label: "Arrow" },
          ]}
        />
      </div>
    </div>
  );
}

function MarkupList({
  markups,
  onRemove,
}: {
  markups: Markup[];
  onRemove: (id: number) => void;
}) {
  if (markups.length === 0) {
    return (
      <p className="border-line bg-wash text-muted rounded-[4px] border border-dashed px-4 py-6 text-center text-xs">
        No markups yet. Add one above — it appears on the page preview.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Placed markups">
      {markups.map((markup, index) => (
        <li
          key={markup.id}
          className="border-line bg-wash flex items-center gap-3 rounded-[3px] border px-3.5 py-2.5"
        >
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full ring-1 ring-white/30"
            style={{ backgroundColor: markup.annotation.color }}
          />
          <span className="bg-accent/10 text-accent grid shrink-0 place-items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
            {TYPE_LABEL[markup.annotation.type]}
          </span>
          <span className="text-muted min-w-0 flex-1 truncate text-xs">
            Page {markup.annotation.page} · {describeMarkup(markup.annotation)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(markup.id)}
            aria-label={`Remove markup ${index + 1}`}
            className="text-muted hover:bg-wash hover:text-err shrink-0 rounded-md p-1 transition"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A schematic of the current page with its placed markups. */
function PagePreview({
  page,
  pageNumber,
  markups,
}: {
  page: PageSize | null;
  pageNumber: number;
  markups: Markup[];
}) {
  if (!page || page.width <= 0 || page.height <= 0) {
    return (
      <div className="bg-wash aspect-[3/4] w-full max-w-[180px] animate-pulse rounded-lg" />
    );
  }

  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative w-full max-w-[180px] overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/10"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        {markups.map(({ id, annotation }) => {
          if (annotation.type === "highlight") {
            return (
              <span
                key={id}
                aria-hidden
                className="absolute"
                style={{
                  left: pct(annotation.x, page.width),
                  width: pct(annotation.width, page.width),
                  top: pct(
                    page.height - (annotation.y + annotation.height),
                    page.height,
                  ),
                  height: pct(annotation.height, page.height),
                  backgroundColor: annotation.color,
                  opacity: annotation.opacity ?? 0.4,
                }}
              />
            );
          }
          if (annotation.type === "rect") {
            return (
              <span
                key={id}
                aria-hidden
                className="absolute"
                style={{
                  left: pct(annotation.x, page.width),
                  width: pct(annotation.width, page.width),
                  top: pct(
                    page.height - (annotation.y + annotation.height),
                    page.height,
                  ),
                  height: pct(annotation.height, page.height),
                  border: `1.5px solid ${annotation.color}`,
                }}
              />
            );
          }
          if (annotation.type === "note") {
            return (
              <span
                key={id}
                aria-hidden
                className="absolute max-w-[70%] truncate text-[6px] leading-none font-medium"
                style={{
                  left: pct(annotation.x, page.width),
                  top: pct(page.height - annotation.y, page.height),
                  color: annotation.color,
                }}
              >
                {annotation.text}
              </span>
            );
          }
          // Line
          return (
            <svg
              key={id}
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <line
                x1={pct(annotation.x1, page.width)}
                y1={pct(page.height - annotation.y1, page.height)}
                x2={pct(annotation.x2, page.width)}
                y2={pct(page.height - annotation.y2, page.height)}
                stroke={annotation.color}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            </svg>
          );
        })}
      </div>
      <span className="text-muted text-[11px]">Page {pageNumber} preview</span>
    </div>
  );
}

/** The load-bearing honesty of this tool: flattened markup, not comments. */
function HonestScopeNote() {
  return (
    <div className="border-info/40 bg-info/10 text-info flex items-start gap-3 rounded-[4px] border px-4 py-3.5 text-sm">
      <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-semibold">
          Markups are flattened into the page.
        </span>{" "}
        This tool draws highlight boxes, outlines, text notes, and lines/arrows
        as page content by coordinate. It is{" "}
        <span className="font-semibold">not</span> a collaborative comment layer
        — there are no sticky notes, reply threads, or editable PDF annotation
        objects, and highlights are rectangles you position, not selections
        snapped to the underlying text.
      </p>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
}) {
  return (
    <div className="border-line bg-wash rounded-[4px] border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
