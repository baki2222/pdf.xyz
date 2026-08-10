"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Image as ImageIcon,
  ImagePlus,
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
  X,
} from "lucide-react";
import {
  checkEditImage,
  editPdf,
  editedOutputName,
  getEditPageSizes,
  MAX_EDIT_IMAGE_BYTES,
  sniffImageFormat,
  validateEditOps,
  type EditImageFormat,
  type EditOp,
  type EditOpType,
  type EditResult,
  type PageSize,
} from "@/lib/pdf/edit";
import { downloadBytes, readFileBytes } from "@/lib/pdf/browser";
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

/** A placed edit plus a stable id for list/preview rendering. */
interface Edit {
  id: number;
  op: EditOp;
}

/** A picked, validated image kept alongside the draft until it's placed. */
interface LoadedImage {
  name: string;
  format: EditImageFormat;
  bytes: Uint8Array;
  /** Natural pixel size, used to seed a sensible placed rectangle. */
  width: number;
  height: number;
}

/** Flat form state covering every edit type; `buildOp` narrows it. */
interface Draft {
  type: EditOpType;
  page: number;
  color: string;
  /** Rect/image lower-left, text anchor, line start. */
  x: number;
  y: number;
  /** Rect/image size. */
  width: number;
  height: number;
  /** Fill/stroke opacity for boxes and images, as a percentage. */
  opacity: number;
  /** Text content. */
  text: string;
  /** Text font size, points. */
  size: number;
  /** Text wrap width, points (0 = no wrapping). */
  wrapWidth: number;
  /** Fill the box, or draw only its outline. */
  filled: boolean;
  /** Box outline width, points. */
  borderWidth: number;
  /** Line end point. */
  x2: number;
  y2: number;
  /** Line thickness, points. */
  thickness: number;
  /** Draw an arrowhead at the line's end. */
  arrow: boolean;
}

const DEFAULT_DRAFT: Draft = {
  type: "text",
  page: 1,
  color: "#111827",
  x: 72,
  y: 690,
  width: 200,
  height: 120,
  opacity: 100,
  text: "",
  size: 16,
  wrapWidth: 0,
  filled: true,
  borderWidth: 2,
  x2: 320,
  y2: 690,
  thickness: 2,
  arrow: false,
};

const TYPE_OPTIONS: {
  value: EditOpType;
  label: string;
  icon: typeof Square;
}[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "rect", label: "Box", icon: Square },
  { value: "line", label: "Line", icon: PenLine },
  { value: "image", label: "Image", icon: ImageIcon },
];

/** A curated palette — dark ink first, then bright accents. */
const PALETTE: { hex: string; label: string }[] = [
  { hex: "#111827", label: "Black" },
  { hex: "#ffffff", label: "White" },
  { hex: "#ef4444", label: "Red" },
  { hex: "#f59e0b", label: "Amber" },
  { hex: "#22c55e", label: "Green" },
  { hex: "#3b82f6", label: "Blue" },
  { hex: "#a855f7", label: "Violet" },
];

const TYPE_LABEL: Record<EditOpType, string> = {
  text: "Text",
  rect: "Box",
  line: "Line",
  image: "Image",
};

const MAX_IMAGE_MB = Math.round(MAX_EDIT_IMAGE_BYTES / (1024 * 1024));

/** Copy an image's bytes into a fresh ArrayBuffer for a typed BlobPart. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Best-effort natural size of an image, so a placed box can match its aspect. */
function readImageDims(
  bytes: Uint8Array,
  format: EditImageFormat,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([toArrayBuffer(bytes)], {
      type: format === "png" ? "image/png" : "image/jpeg",
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const dims = {
        width: img.naturalWidth || 1,
        height: img.naturalHeight || 1,
      };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

/** Read a picked file into a validated {@link LoadedImage}, or throw clear copy. */
async function readImageForEdit(file: File): Promise<LoadedImage> {
  const bytes = await readFileBytes(file);
  const format = sniffImageFormat(bytes);
  if (!format) {
    throw new Error(`"${file.name}" isn't a PNG or JPG image.`);
  }
  const issue = checkEditImage(format, bytes);
  if (issue === "image-missing") throw new Error(`"${file.name}" is empty.`);
  if (issue === "image-type") {
    throw new Error(
      `"${file.name}" must be a PNG or JPG under ${MAX_IMAGE_MB} MB.`,
    );
  }
  const dims = await readImageDims(bytes, format).catch(() => ({
    width: 1,
    height: 1,
  }));
  return {
    name: file.name,
    format,
    bytes,
    width: dims.width,
    height: dims.height,
  };
}

/** Narrow the flat draft into a concrete, typed edit (null = image not ready). */
function buildOp(draft: Draft, image: LoadedImage | null): EditOp | null {
  const { page, color } = draft;
  switch (draft.type) {
    case "text":
      return {
        type: "text",
        page,
        color,
        x: draft.x,
        y: draft.y,
        text: draft.text,
        size: draft.size,
        maxWidth: draft.wrapWidth > 0 ? draft.wrapWidth : undefined,
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
        filled: draft.filled,
        borderWidth: draft.filled ? undefined : draft.borderWidth,
        opacity: draft.opacity / 100,
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
    case "image":
      if (!image) return null;
      return {
        type: "image",
        page,
        x: draft.x,
        y: draft.y,
        width: draft.width,
        height: draft.height,
        format: image.format,
        bytes: image.bytes,
        opacity: draft.opacity / 100,
      };
  }
}

/** A one-line summary of a placed edit for the list. */
function describeOp(op: EditOp): string {
  switch (op.type) {
    case "text":
      return `x ${op.x}, y ${op.y} · “${op.text.slice(0, 24)}${op.text.length > 24 ? "…" : ""}”`;
    case "rect":
      return `x ${op.x}, y ${op.y} · ${op.width} × ${op.height} pt · ${op.filled === false ? "outline" : "filled"}`;
    case "line":
      return `(${op.x1}, ${op.y1}) → (${op.x2}, ${op.y2})${op.arrow ? " · arrow" : ""}`;
    case "image":
      return `x ${op.x}, y ${op.y} · ${op.width} × ${op.height} pt · ${op.format.toUpperCase()}`;
  }
}

export function EditRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · edited locally in your browser"
      handoffSlug="edit-pdf"
      toolName="Edit PDF"
    >
      {(pdf, reset) => <EditEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function EditEditor({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
  const { busy, error, result, run } = useAsyncRun<EditResult>();
  const [pageSizes, setPageSizes] = useState<PageSize[] | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const idRef = useRef(0);

  // Content-space page sizes back the preview and validation. The editor subtree
  // is keyed by file, so this runs once per document.
  useEffect(() => {
    let alive = true;
    getEditPageSizes(pdf.bytes)
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

  const pageEdits = useMemo(
    () => edits.filter((edit) => edit.op.page === draft.page),
    [edits, draft.page],
  );

  const setField = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const onPickImage = async (file: File) => {
    setFormError(null);
    try {
      const loaded = await readImageForEdit(file);
      setImage(loaded);
      // Seed the placed rectangle from the image's aspect, scaled to fit.
      const cap = Math.min(240, maxW, maxH);
      const scale = Math.min(cap / loaded.width, cap / loaded.height, 1);
      setDraft((prev) => ({
        ...prev,
        width: Math.max(1, Math.round(loaded.width * scale)),
        height: Math.max(1, Math.round(loaded.height * scale)),
      }));
    } catch (err) {
      setImage(null);
      setFormError(
        err instanceof Error ? err.message : "That image can't be used.",
      );
    }
  };

  const addEdit = () => {
    if (!pageSizes) return;
    const op = buildOp(draft, image);
    if (!op) {
      setFormError("Choose a PNG or JPG image to insert first.");
      return;
    }
    const issues = validateEditOps([op], pageSizes);
    if (issues.length > 0) {
      setFormError(issues[0]!.message);
      return;
    }
    setFormError(null);
    setEdits((prev) => [...prev, { id: idRef.current++, op }]);
  };

  const removeEdit = (id: number) =>
    setEdits((prev) => prev.filter((edit) => edit.id !== id));

  const onRun = () => {
    if (edits.length === 0 || !pageSizes) return;
    const ops = edits.map((edit) => edit.op);
    const issues = validateEditOps(ops, pageSizes);
    if (issues.length > 0) {
      setFormError(issues[0]!.message);
      return;
    }
    setFormError(null);
    void run(() => editPdf(pdf.bytes, ops));
  };

  if (result) {
    return (
      <ResultPanel
        title="Edited PDF ready"
        summary={`${result.opCount} edit${result.opCount === 1 ? "" : "s"} flattened across ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.bytes, editedOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download edited PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Add content"
        aside={
          <span className="text-xs text-slate-400">
            Points from bottom-left · 72 pt = 1 in
          </span>
        }
      >
        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <TypePicker
            value={draft.type}
            onChange={(type) => setField("type", type)}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              {activePage
                ? `Page ${draft.page} is ${Math.round(activePage.width)} × ${Math.round(activePage.height)} pt`
                : "Reading page sizes…"}
            </span>
            {draft.type !== "image" && (
              <ColorSwatches
                value={draft.color}
                onChange={(color) => setField("color", color)}
              />
            )}
          </div>

          {draft.type === "image" && (
            <ImagePicker
              image={image}
              onPick={onPickImage}
              onClear={() => setImage(null)}
            />
          )}

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
              onClick={addEdit}
              aria-disabled={
                !pageSizes || (draft.type === "image" && !image) || undefined
              }
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Plus className="size-4" aria-hidden />
              Add to page
            </button>
          </div>

          {formError && <ErrorNote message={formError} />}
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <EditList edits={edits} onRemove={removeEdit} />
          <PagePreview
            page={activePage}
            pageNumber={draft.page}
            edits={pageEdits}
          />
        </div>
      </RunnerSection>

      <HonestScopeNote />

      <div className="grid gap-3 sm:grid-cols-3">
        <InfoTile
          icon={Sparkles}
          title="Adds new content"
          body="Text, boxes, lines, and images are drawn as real vector/image content on top of your pages — the pages themselves are preserved, not rasterized."
        />
        <InfoTile
          icon={Lock}
          title="Flattened on export"
          body="New content is baked into the page. To hide something underneath, draw a filled box over it — use Redact when the data must actually be removed."
        />
        <InfoTile
          icon={ShieldCheck}
          title="Local only"
          body="Everything runs in your browser with pdf-lib — your PDF and images are never uploaded."
        />
      </div>

      <PrivacyLine>
        Edits are applied on your device — your PDF never leaves the browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton
          onClick={onRun}
          busy={busy}
          disabled={edits.length === 0 || !pageSizes}
          busyLabel="Applying…"
        >
          <Layers className="size-4" aria-hidden />
          Apply {edits.length} edit{edits.length === 1 ? "" : "s"}
        </RunButton>
      </div>
    </div>
  );
}

function TypePicker({
  value,
  onChange,
}: {
  value: EditOpType;
  onChange: (type: EditOpType) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Content type"
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
              "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition",
              active
                ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.06] hover:text-white",
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
      aria-label="Content color"
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

/** File chooser + selected-file chip for the inserted image. */
function ImagePicker({
  image,
  onPick,
  onClear,
}: {
  image: LoadedImage | null;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  if (image) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5">
        <ImageIcon className="size-4 shrink-0 text-violet-300" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
          {image.name} · {image.format.toUpperCase()} · {image.width} ×{" "}
          {image.height} px
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Remove image"
          className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-red-300"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <label className="flex cursor-pointer items-center gap-2 self-start rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3.5 py-2.5 text-xs font-medium text-slate-300 transition hover:border-white/30 hover:bg-white/[0.04]">
      <input
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = "";
        }}
      />
      <ImagePlus className="size-4 text-violet-300" aria-hidden />
      Choose a PNG or JPG image (max {MAX_IMAGE_MB} MB)
    </label>
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

  if (draft.type === "text") {
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
            htmlFor="edit-text"
            className="text-xs font-medium text-slate-300"
          >
            Text
          </label>
          <textarea
            id="edit-text"
            value={draft.text}
            rows={2}
            placeholder="Type the text to add to the page…"
            onChange={(event) => setField("text", event.target.value)}
            className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-slate-100 transition outline-none placeholder:text-slate-400 focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/20"
          />
          <span className="text-[11px] text-slate-400">
            Y is the baseline of the first line; wrapped lines flow downward.
            Wrap 0 = one line per line break.
          </span>
        </div>
        <RangeField
          label="Font size"
          value={draft.size}
          min={8}
          max={48}
          step={1}
          onChange={(v) => setField("size", v)}
          format={(v) => `${v} pt`}
        />
      </div>
    );
  }

  if (draft.type === "rect" || draft.type === "image") {
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
        {draft.type === "rect" ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SegmentedControl
              label="Box style"
              value={draft.filled ? "filled" : "outline"}
              onChange={(value) => setField("filled", value === "filled")}
              options={[
                { value: "filled", label: "Filled" },
                { value: "outline", label: "Outline" },
              ]}
            />
            {draft.filled ? (
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
        ) : (
          <RangeField
            label="Opacity"
            value={draft.opacity}
            min={10}
            max={100}
            step={5}
            onChange={(v) => setField("opacity", v)}
            format={(v) => `${v}%`}
          />
        )}
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

function EditList({
  edits,
  onRemove,
}: {
  edits: Edit[];
  onRemove: (id: number) => void;
}) {
  if (edits.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.01] px-4 py-6 text-center text-xs text-slate-400">
        Nothing added yet. Build an edit above — it appears on the page preview.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Placed edits">
      {edits.map((edit, index) => (
        <li
          key={edit.id}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5"
        >
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full ring-1 ring-white/30"
            style={{
              backgroundColor:
                edit.op.type === "image" ? "#94a3b8" : edit.op.color,
            }}
          />
          <span className="grid shrink-0 place-items-center rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-200 uppercase">
            {TYPE_LABEL[edit.op.type]}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
            Page {edit.op.page} · {describeOp(edit.op)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(edit.id)}
            aria-label={`Remove edit ${index + 1}`}
            className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-red-300"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A schematic of the current page with its placed edits. */
function PagePreview({
  page,
  pageNumber,
  edits,
}: {
  page: PageSize | null;
  pageNumber: number;
  edits: Edit[];
}) {
  if (!page || page.width <= 0 || page.height <= 0) {
    return (
      <div className="aspect-[3/4] w-full max-w-[180px] animate-pulse rounded-lg bg-white/10" />
    );
  }

  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative w-full max-w-[180px] overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/10"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        {edits.map(({ id, op }) => {
          if (op.type === "rect") {
            const box = {
              left: pct(op.x, page.width),
              width: pct(op.width, page.width),
              top: pct(page.height - (op.y + op.height), page.height),
              height: pct(op.height, page.height),
            };
            return op.filled === false ? (
              <span
                key={id}
                aria-hidden
                className="absolute"
                style={{ ...box, border: `1.5px solid ${op.color}` }}
              />
            ) : (
              <span
                key={id}
                aria-hidden
                className="absolute"
                style={{
                  ...box,
                  backgroundColor: op.color,
                  opacity: op.opacity ?? 1,
                }}
              />
            );
          }
          if (op.type === "image") {
            return (
              <span
                key={id}
                aria-hidden
                className="absolute grid place-items-center border border-slate-400/70 bg-slate-200/60"
                style={{
                  left: pct(op.x, page.width),
                  width: pct(op.width, page.width),
                  top: pct(page.height - (op.y + op.height), page.height),
                  height: pct(op.height, page.height),
                  opacity: op.opacity ?? 1,
                }}
              >
                <ImageIcon className="size-3 text-slate-400" aria-hidden />
              </span>
            );
          }
          if (op.type === "text") {
            return (
              <span
                key={id}
                aria-hidden
                className="absolute max-w-[70%] truncate text-[6px] leading-none font-medium"
                style={{
                  left: pct(op.x, page.width),
                  top: pct(page.height - op.y, page.height),
                  color: op.color,
                }}
              >
                {op.text}
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
                x1={pct(op.x1, page.width)}
                y1={pct(page.height - op.y1, page.height)}
                x2={pct(op.x2, page.width)}
                y2={pct(page.height - op.y2, page.height)}
                stroke={op.color}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            </svg>
          );
        })}
      </div>
      <span className="text-[11px] text-slate-400">
        Page {pageNumber} preview
      </span>
    </div>
  );
}

/** The load-bearing honesty of this tool: added content, not true text editing. */
function HonestScopeNote() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-sky-400/25 bg-sky-500/[0.08] px-4 py-3.5 text-sm text-sky-100">
      <Info className="mt-0.5 size-4 shrink-0 text-sky-300" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-semibold">This adds new, flattened content.</span>{" "}
        You can place text, boxes, lines/arrows, and PNG/JPG images by page and
        coordinates. It does <span className="font-semibold">not</span> edit,
        reflow, restyle, or delete the text and objects already in your PDF —
        there is no OCR text layer, no drag handles, and no click-to-place
        canvas. To cover existing content, draw a filled box over it (that hides
        but doesn&apos;t remove it — use Redact to delete data).
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Icon className="size-4 text-violet-300" aria-hidden />
        {title}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}
