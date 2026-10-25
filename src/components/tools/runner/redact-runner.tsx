"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  EyeOff,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  getRedactPageSizes,
  redactPdf,
  redactPresetById,
  DEFAULT_REDACT_PRESET_ID,
  redactedOutputName,
  validateRedactions,
  DEFAULT_REDACTION_DRAFT,
  REDACT_DPI_PRESETS,
  REDACTION_FILL_OPTIONS,
  type PageSize,
  type RedactionFill,
  type RedactionRect,
} from "@/lib/pdf/redact";
import {
  DEFAULT_REDACT_METHOD,
  REDACT_METHODS,
  type RedactMethod,
} from "@/lib/pdf/redact-output";
import type { FoundText } from "@/lib/pdf/redact-find";
import { RedactFindPanel } from "./redact-find-panel";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  UndecodedImagesNotice,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { PagePreviewPlaceholder } from "./page-preview-placeholder";
import { RunBar } from "./run-bar";
import { useUnsavedGuard } from "./use-unsaved-guard";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { NumberField, PrivacyLine, SegmentedControl } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/** A redaction box plus a stable id for list rendering. */
interface Box extends RedactionRect {
  id: number;
}

/** What a run produced, by either method. */
interface RedactOutcome {
  bytes: Uint8Array;
  pageCount: number;
  redactionCount: number;
  method: RedactMethod;
  /** Flatten: images pdf.js could not decode (absent from the output). */
  undecodedImages: number;
  /** Remove: chosen matches searched for again in the output, not found. */
  verified: number;
}

const METHOD_LABEL = Object.fromEntries(
  REDACT_METHODS.map((m) => [m.id, m.label]),
) as Record<RedactMethod, string>;

export function RedactRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · redacted locally in your browser"
      handoffSlug="redact-pdf"
      toolName="Redact PDF"
    >
      {(pdf, reset) => <RedactEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function RedactEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const { busy, error, result, run, reset } = useAsyncRun<RedactOutcome>();
  const [pageSizes, setPageSizes] = useState<PageSize[] | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [draft, setDraft] = useState<RedactionRect>({
    ...DEFAULT_REDACTION_DRAFT,
  });
  const [fill, setFill] = useState<RedactionFill>("black");
  const [presetId, setPresetId] = useState<string>(DEFAULT_REDACT_PRESET_ID);
  const [method, setMethod] = useState<RedactMethod>(DEFAULT_REDACT_METHOD);
  // Find text / Detect personal data: the review list, and what is ticked.
  const [found, setFound] = useState<FoundText[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const chosenFound = useMemo(
    () => found.filter((f) => chosen.has(f.key)),
    [found, chosen],
  );
  const textRects = useMemo(
    () => chosenFound.flatMap((f) => f.rects),
    [chosenFound],
  );
  const areaCount = boxes.length + textRects.length;
  useUnsavedGuard(areaCount > 0 && !result, "your redaction areas");
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Read displayed (rotation-aware) page sizes so boxes can be bounded and
  // previewed. The editor subtree is keyed by file, so this runs once per doc.
  useEffect(() => {
    let alive = true;
    getRedactPageSizes(pdf.bytes)
      .then((sizes) => {
        if (alive) setPageSizes(sizes);
      })
      .catch(() => {
        // Sizes back the preview/validation; failing to read them just disables
        // the builder rather than crashing the tool.
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const activePage = pageSizes?.[draft.page - 1] ?? null;
  const maxW = activePage ? Math.max(1, Math.floor(activePage.width)) : 100000;
  const maxH = activePage ? Math.max(1, Math.floor(activePage.height)) : 100000;

  const pageBoxes = useMemo(
    () => [
      ...boxes.filter((box) => box.page === draft.page),
      ...textRects
        .filter((r) => r.page === draft.page)
        .map((r, i) => ({ ...r, id: -1 - i })),
    ],
    [boxes, textRects, draft.page],
  );

  const addFound = (matches: FoundText[]) => {
    setFound((prev) => {
      const have = new Set(prev.map((f) => f.key));
      return [...prev, ...matches.filter((m) => !have.has(m.key))];
    });
    setChosen((prev) => {
      const next = new Set(prev);
      for (const m of matches) next.add(m.key);
      return next;
    });
  };
  const toggleFound = (key: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setDraftField = (field: keyof RedactionRect, value: number) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const addBox = () => {
    if (!pageSizes) return;
    const issues = validateRedactions([draft], pageSizes);
    if (issues.length > 0) {
      setFormError(issues[0]!.message);
      return;
    }
    setFormError(null);
    setBoxes((prev) => [...prev, { ...draft, id: idRef.current++ }]);
  };

  const removeBox = (id: number) =>
    setBoxes((prev) => prev.filter((box) => box.id !== id));

  const onRun = () => {
    if (areaCount === 0 || !pageSizes) return;
    const issues = validateRedactions(boxes, pageSizes);
    if (issues.length > 0) {
      setFormError(issues[0]!.message);
      return;
    }
    setFormError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const preset = redactPresetById(presetId);
    const manual: RedactionRect[] = boxes.map(
      ({ page, x, y, width, height }) => ({ page, x, y, width, height }),
    );
    if (method === "remove") {
      setProgress(null);
      void run(async (): Promise<RedactOutcome> => {
        const { redactPdfByRemoval } = await import("@/lib/pdf/redact-remove");
        const done = await redactPdfByRemoval(pdf.bytes, {
          rects: [
            ...manual,
            ...textRects.map((r) => ({ ...r, fromText: true })),
          ],
          fill,
          verify: chosenFound,
        });
        return { ...done, method, undecodedImages: 0 };
      });
      return;
    }
    setProgress({ done: 0, total: pdf.pageCount });
    void run(async (): Promise<RedactOutcome> => {
      const redacted = await redactPdf(pdf.bytes, {
        rects: [...manual, ...textRects],
        fill,
        dpi: preset.dpi,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (controller.signal.aborted)
        throw new Error("Redaction was cancelled.");
      return { ...redacted, method, verified: 0 };
    });
  };

  if (result) {
    return (
      <ResultPanel
        title="Redacted PDF ready"
        summary={`${result.redactionCount} area${result.redactionCount === 1 ? "" : "s"} redacted across ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${METHOD_LABEL[result.method]} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, redactedOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        {result.undecodedImages > 0 && (
          <UndecodedImagesNotice count={result.undecodedImages} redaction />
        )}
        {result.verified > 0 && (
          <p className="text-muted text-sm" role="status">
            Checked: {result.verified === 1 ? "the" : `all ${result.verified}`}{" "}
            chosen text {result.verified === 1 ? "match was" : "matches were"}{" "}
            searched for again in the redacted file and{" "}
            {result.verified === 1 ? "is" : "are"} not in its text.
          </p>
        )}
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.bytes, redactedOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download redacted PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RedactFindPanel
        bytes={pdf.bytes}
        found={found}
        chosen={chosen}
        onFound={addFound}
        onToggle={toggleFound}
        onToggleAll={(on) =>
          setChosen(on ? new Set(found.map((f) => f.key)) : new Set())
        }
        onClear={() => {
          setFound([]);
          setChosen(new Set());
        }}
      />

      <RunnerSection
        title="Redaction areas"
        aside={
          <span className="text-muted text-xs">
            Points from bottom-left · 72 pt = 1 in
          </span>
        }
      >
        <div className="border-line bg-wash rounded-panel flex flex-col gap-4 border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted text-xs">
              {activePage
                ? `Page ${draft.page} is ${Math.round(activePage.width)} × ${Math.round(activePage.height)} pt`
                : "Reading page sizes…"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <NumberField
              label="Page"
              value={draft.page}
              min={1}
              max={pdf.pageCount}
              onChange={(value) => setDraftField("page", value)}
            />
            <NumberField
              label="X (pt)"
              value={draft.x}
              min={0}
              max={maxW}
              onChange={(value) => setDraftField("x", value)}
            />
            <NumberField
              label="Y (pt)"
              value={draft.y}
              min={0}
              max={maxH}
              onChange={(value) => setDraftField("y", value)}
            />
            <NumberField
              label="Width (pt)"
              value={draft.width}
              min={1}
              max={maxW}
              onChange={(value) => setDraftField("width", value)}
            />
            <NumberField
              label="Height (pt)"
              value={draft.height}
              min={1}
              max={maxH}
              onChange={(value) => setDraftField("height", value)}
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={addBox}
              aria-disabled={!pageSizes || undefined}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Plus className="size-4" aria-hidden />
              Add area
            </button>
          </div>

          {formError && <ErrorNote message={formError} />}
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <BoxList boxes={boxes} onRemove={removeBox} />
          <PagePreview
            page={activePage}
            pageNumber={draft.page}
            boxes={pageBoxes}
            draft={draft}
            fill={fill}
          />
        </div>
      </RunnerSection>

      <RunnerSection title="Method">
        <SegmentedControl<RedactMethod>
          label="Redaction method"
          value={method}
          onChange={setMethod}
          options={REDACT_METHODS.map((m) => ({ value: m.id, label: m.label }))}
        />
      </RunnerSection>

      <div className="grid gap-4 sm:grid-cols-2">
        <RunnerSection title="Fill">
          <SegmentedControl<RedactionFill>
            label="Redaction fill"
            value={fill}
            onChange={setFill}
            options={[...REDACTION_FILL_OPTIONS]}
          />
        </RunnerSection>

        {method === "flatten" && (
          <RunnerSection title="Output quality">
            <SegmentedControl
              label="Rasterization quality"
              value={presetId}
              onChange={setPresetId}
              options={REDACT_DPI_PRESETS.map((preset) => ({
                value: preset.id,
                label: `${preset.label} (${preset.dpi} DPI)`,
              }))}
            />
          </RunnerSection>
        )}
      </div>

      {method === "flatten" ? <RasterWarning /> : <RemoveNote />}

      <div className="grid gap-3 sm:grid-cols-3">
        {method === "flatten" ? (
          <>
            <InfoTile
              icon={EyeOff}
              title="Content is destroyed"
              body="Covered pixels are painted over before the image is saved — there is no text or vector layer hiding underneath."
            />
            <InfoTile
              icon={Lock}
              title="Permanent"
              body="The output is rebuilt from flattened page images, so redactions can't be selected, copied, or removed."
            />
          </>
        ) : (
          <>
            <InfoTile
              icon={EyeOff}
              title="Text is removed"
              body="The letters under each box are taken out of the page, and the pixels of a picture under it are overwritten, before the box is filled."
            />
            <InfoTile
              icon={Lock}
              title="Checked"
              body="Every match you chose from the list is searched for again in the redacted file; if one is still there, nothing is saved."
            />
          </>
        )}
        <InfoTile
          icon={ShieldCheck}
          title="Private"
          body="Rendering runs in your browser with the bundled pdf.js worker — your PDF is never uploaded."
        />
      </div>

      {error && <ErrorNote message={error} />}

      <PrivacyLine>
        Redaction happens on your device — your PDF never leaves the browser.
      </PrivacyLine>

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={areaCount === 0 || !pageSizes}
            busyLabel={
              method === "flatten" ? "Redacting pages…" : "Removing text…"
            }
            progress={
              method === "flatten" && progress
                ? { ...progress, unit: "pages" }
                : undefined
            }
          >
            <EyeOff className="size-4" aria-hidden />
            Redact PDF
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

function BoxList({
  boxes,
  onRemove,
}: {
  boxes: Box[];
  onRemove: (id: number) => void;
}) {
  if (boxes.length === 0) {
    return (
      <p className="border-line bg-wash text-muted rounded-panel border border-dashed px-4 py-6 text-center text-xs">
        No redaction areas yet. Add one above — its box appears on the page
        preview.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Redaction areas">
      {boxes.map((box, index) => (
        <li
          key={box.id}
          className="border-line bg-wash rounded-ctl flex items-center gap-3 border px-3.5 py-2.5"
        >
          <span className="bg-accent/10 text-accent rounded-tag grid size-6 shrink-0 place-items-center text-[11px] font-semibold">
            {index + 1}
          </span>
          <span className="text-muted min-w-0 flex-1 truncate text-xs">
            Page {box.page} · x {box.x}, y {box.y} · {box.width} × {box.height}{" "}
            pt
          </span>
          <button
            type="button"
            onClick={() => onRemove(box.id)}
            aria-label={`Remove redaction area ${index + 1}`}
            className="text-muted hover:bg-wash hover:text-err rounded-ctl shrink-0 p-1 transition"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A schematic of the current page with its redaction boxes and the live draft. */
function PagePreview({
  page,
  pageNumber,
  boxes,
  draft,
  fill,
}: {
  page: PageSize | null;
  pageNumber: number;
  boxes: Box[];
  draft: RedactionRect;
  fill: RedactionFill;
}) {
  if (!page || page.width <= 0 || page.height <= 0) {
    return <PagePreviewPlaceholder pageNumber={pageNumber} />;
  }

  const toStyle = (rect: RedactionRect) => ({
    left: `${(rect.x / page.width) * 100}%`,
    width: `${(rect.width / page.width) * 100}%`,
    top: `${((page.height - (rect.y + rect.height)) / page.height) * 100}%`,
    height: `${(rect.height / page.height) * 100}%`,
  });

  const draftValid =
    draft.page === pageNumber &&
    draft.width > 0 &&
    draft.height > 0 &&
    draft.x >= 0 &&
    draft.y >= 0 &&
    draft.x + draft.width <= page.width + 0.5 &&
    draft.y + draft.height <= page.height + 0.5;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="rounded-sheet relative w-full max-w-[180px] overflow-hidden bg-white shadow-sm ring-1 ring-black/10"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        {boxes.map((box) => (
          <span
            key={box.id}
            aria-hidden
            className={cn(
              "absolute",
              fill === "white"
                ? "border border-slate-400 bg-white"
                : "bg-slate-900",
            )}
            style={toStyle(box)}
          />
        ))}
        {draftValid && (
          <span
            aria-hidden
            className="border-accent/40 bg-accent/10 absolute border border-dashed"
            style={toStyle(draft)}
          />
        )}
      </div>
      <span className="text-muted text-[11px]">Page {pageNumber} preview</span>
    </div>
  );
}

/** The load-bearing honesty of this tool: the output is a raster PDF. */
function RasterWarning() {
  return (
    <div className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-3 border px-4 py-3.5 text-sm">
      <TriangleAlert className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-semibold">Output is rasterized.</span> Every page
        — not only the ones with a box — is flattened into an image, so
        selectable text, form fields, and vectors are converted to pixels on all
        of them. That flattening is exactly what makes the redaction permanent —
        nothing stays hidden underneath the boxes.
      </p>
    </div>
  );
}

/** What "Remove text under boxes" keeps — as plainly as the raster warning. */
function RemoveNote() {
  return (
    <div className="border-line bg-wash text-fg rounded-panel flex items-start gap-3 border px-4 py-3.5 text-sm">
      <ShieldCheck className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-semibold">
          Only what is under a box is removed.
        </span>{" "}
        The rest of every page stays as it was — its text can still be selected
        and searched — and so do bookmarks, links outside the boxes and the
        document&apos;s properties. Some content can&apos;t be removed this way
        (vertical text, a form field or certain images under a box); the
        redaction then stops and says so, and Flatten every page handles it.
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
    <div className="border-line bg-wash rounded-panel border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
