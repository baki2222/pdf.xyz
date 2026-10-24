"use client";

import type { ReactNode } from "react";
import {
  Bold,
  Copy,
  Info,
  Italic,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EDITOR_FONTS,
  EDITOR_FONT_LABEL,
  EDITOR_OBJECT_LABEL,
  type EditorObject,
  type TextAlign,
} from "@/lib/pdf/editor/model";
import { needsUnicodeFace } from "@/lib/pdf/editor/text";
import type { Defaults, Tool } from "./editor-state";

/**
 * The properties of what is selected — or, with nothing selected, of what
 * the active tool will place next. A change applies to every selected object
 * that has the property, as one undo step per control (`coalesce`), and
 * becomes the default for the next object of that kind.
 */

/** Which defaults bucket an object or tool reads. */
export type StyleBucket = keyof Defaults | "image" | "signature" | "whiteout";

export function bucketOf(obj: EditorObject): StyleBucket {
  switch (obj.kind) {
    case "text":
      return "text";
    case "note":
      return "note";
    case "shape":
      return "shape";
    case "line":
      return "line";
    case "highlight":
      return "highlight";
    case "ink":
      return "ink";
    default:
      return obj.kind;
  }
}

export function bucketOfTool(tool: Tool): StyleBucket | null {
  switch (tool) {
    case "text":
      return "text";
    case "note":
      return "note";
    case "rect":
    case "ellipse":
      return "shape";
    case "line":
    case "arrow":
      return "line";
    case "highlight":
      return "highlight";
    case "ink":
      return "ink";
    case "whiteout":
      return "whiteout";
    default:
      return null;
  }
}

/** A loose bag of the editable fields; every object kind uses a subset. */
export type StylePatch = Partial<{
  font: (typeof EDITOR_FONTS)[number];
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  lineHeight: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  arrow: boolean;
}>;

/** A row: its name, then its control(s) — each control carries its own name. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted" aria-hidden>
        {label}
      </span>
      {children}
    </div>
  );
}

/** A labelled checkbox. */
function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="text-muted inline-flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function Toggle({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={cn(
        "rounded-ctl inline-flex size-8 items-center justify-center border",
        pressed
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-line text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

const input =
  "border-line bg-canvas text-fg rounded-ctl h-8 border px-2 text-xs tabular-nums";

/** The values the panel shows: the first selected object's, or the defaults. */
type Shown = StylePatch & { kind: StyleBucket; text?: string };

export function PropertiesPanel({
  selection,
  bucket,
  defaults,
  onPatch,
  onDelete,
  onDuplicate,
  className,
}: {
  selection: EditorObject[];
  /** The tool's bucket when nothing is selected. */
  bucket: StyleBucket | null;
  defaults: Defaults;
  onPatch: (patch: StylePatch, key: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  className?: string;
}) {
  const first = selection[0];
  const kind: StyleBucket | null = first ? bucketOf(first) : bucket;
  if (!kind) return null;
  const shown: Shown = first
    ? ({ ...(first as object), kind } as Shown)
    : ({
        ...((defaults as unknown as Record<string, object>)[kind] ?? {}),
        kind,
      } as Shown);
  const title = first
    ? selection.length > 1
      ? `${selection.length} items selected`
      : EDITOR_OBJECT_LABEL[first.kind]
    : `New ${kind === "shape" ? "shape" : kind === "line" ? "line" : kind}`;
  const unicode = selection.some(
    (o) => (o.kind === "text" || o.kind === "note") && needsUnicodeFace(o.text),
  );

  const set = (patch: StylePatch, key: string) => onPatch(patch, key);

  return (
    <section
      aria-label="Properties"
      className={cn("flex flex-col gap-3 text-sm", className)}
    >
      <h3 className="text-faint kicker">{title}</h3>

      {(kind === "text" || kind === "note") && (
        <>
          <Field label="Font">
            <select
              aria-label="Font"
              value={shown.font}
              onChange={(e) =>
                set({ font: e.target.value as StylePatch["font"] }, "font")
              }
              className={input}
            >
              {EDITOR_FONTS.map((f) => (
                <option key={f} value={f}>
                  {EDITOR_FONT_LABEL[f]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Size (pt)">
            <input
              type="number"
              aria-label="Font size"
              min={4}
              max={144}
              step={1}
              value={shown.size}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 4 && v <= 144) set({ size: v }, "size");
              }}
              className={cn(input, "w-16")}
            />
          </Field>
          <Field label="Colour">
            <input
              type="color"
              aria-label="Text colour"
              value={shown.color}
              onChange={(e) => set({ color: e.target.value }, "color")}
              className="h-8 w-10 cursor-pointer"
            />
          </Field>
          <div className="flex items-center gap-1.5">
            <Toggle
              label="Bold"
              pressed={!!shown.bold}
              onClick={() => set({ bold: !shown.bold }, "bold")}
            >
              <Bold className="size-3.5" aria-hidden />
            </Toggle>
            <Toggle
              label="Italic"
              pressed={!!shown.italic}
              onClick={() => set({ italic: !shown.italic }, "italic")}
            >
              <Italic className="size-3.5" aria-hidden />
            </Toggle>
            <span className="bg-line mx-1 h-5 w-px" aria-hidden />
            {(
              [
                ["left", "Align left", TextAlignStart],
                ["center", "Align centre", TextAlignCenter],
                ["right", "Align right", TextAlignEnd],
              ] as const
            ).map(([value, label, Icon]) => (
              <Toggle
                key={value}
                label={label}
                pressed={shown.align === value}
                onClick={() => set({ align: value }, "align")}
              >
                <Icon className="size-3.5" aria-hidden />
              </Toggle>
            ))}
          </div>
          <Field label="Line height">
            <select
              aria-label="Line height"
              value={String(shown.lineHeight)}
              onChange={(e) =>
                set({ lineHeight: Number(e.target.value) }, "lineHeight")
              }
              className={input}
            >
              {[1, 1.15, 1.2, 1.5, 2].map((v) => (
                <option key={v} value={String(v)}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {kind === "note" && (
            <Field label="Paper">
              <input
                type="color"
                aria-label="Note colour"
                value={shown.fill ?? "#fef08a"}
                onChange={(e) => set({ fill: e.target.value }, "fill")}
                className="h-8 w-10 cursor-pointer"
              />
            </Field>
          )}
          {unicode && (
            <p className="text-muted flex gap-1.5 text-[11px] leading-snug">
              <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
              This script is drawn with a Noto Sans face, in its regular weight:
              the font, bold and italic choices apply to Latin-only text.
            </p>
          )}
        </>
      )}

      {(kind === "shape" || kind === "line" || kind === "ink") && (
        <>
          <Field label="Outline">
            <span className="flex items-center gap-2">
              {kind === "shape" && (
                <Check
                  label="Draw an outline"
                  checked={shown.stroke !== null}
                  onChange={(on) =>
                    set({ stroke: on ? "#dc2626" : null }, "stroke")
                  }
                />
              )}
              {shown.stroke !== null && (
                <input
                  type="color"
                  aria-label="Outline colour"
                  value={shown.stroke ?? "#dc2626"}
                  onChange={(e) => set({ stroke: e.target.value }, "stroke")}
                  className="h-8 w-10 cursor-pointer"
                />
              )}
            </span>
          </Field>
          <Field label="Width (pt)">
            <input
              type="number"
              aria-label="Outline width"
              min={0.5}
              max={40}
              step={0.5}
              value={shown.strokeWidth}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 0.5 && v <= 40) set({ strokeWidth: v }, "strokeWidth");
              }}
              className={cn(input, "w-16")}
            />
          </Field>
        </>
      )}

      {kind === "shape" && (
        <Field label="Fill">
          <span className="flex items-center gap-2">
            <Check
              label="Fill the shape"
              checked={shown.fill !== null}
              onChange={(on) => set({ fill: on ? "#fde68a" : null }, "fill")}
            />
            {shown.fill !== null && (
              <input
                type="color"
                aria-label="Fill colour"
                value={shown.fill ?? "#fde68a"}
                onChange={(e) => set({ fill: e.target.value }, "fill")}
                className="h-8 w-10 cursor-pointer"
              />
            )}
          </span>
        </Field>
      )}

      {kind === "line" && (
        <Check
          label="Arrowhead"
          checked={!!shown.arrow}
          onChange={(on) => set({ arrow: on }, "arrow")}
        />
      )}

      {kind === "highlight" && (
        <Field label="Colour">
          <input
            type="color"
            aria-label="Highlight colour"
            value={shown.color}
            onChange={(e) => set({ color: e.target.value }, "color")}
            className="h-8 w-10 cursor-pointer"
          />
        </Field>
      )}

      {(kind === "shape" ||
        kind === "line" ||
        kind === "ink" ||
        kind === "highlight" ||
        kind === "image") && (
        <Field label={`Opacity ${Math.round((shown.opacity ?? 1) * 100)}%`}>
          <input
            type="range"
            aria-label="Opacity"
            min={10}
            max={100}
            step={5}
            value={Math.round((shown.opacity ?? 1) * 100)}
            onChange={(e) =>
              set({ opacity: Number(e.target.value) / 100 }, "opacity")
            }
            className="w-28"
          />
        </Field>
      )}

      {kind === "whiteout" && (
        <p className="text-muted flex gap-1.5 text-[11px] leading-snug">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          Whiteout paints a white box over the page. What it covers is still in
          the file — search, copy and text extraction can find it. Use Redact
          PDF to remove it.
        </p>
      )}

      {selection.length > 0 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDuplicate}
            className="border-line text-muted hover:text-fg rounded-ctl inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-xs"
          >
            <Copy className="size-3.5" aria-hidden />
            Duplicate
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="border-line text-muted hover:text-err rounded-ctl inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-xs"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </button>
        </div>
      )}
    </section>
  );
}
