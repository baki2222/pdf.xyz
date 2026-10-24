"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  BringToFront,
  Check as CheckIcon,
  Copy,
  Info,
  Italic,
  SendToBack,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EDITOR_FIELD_LABEL,
  EDITOR_FONTS,
  EDITOR_FONT_LABEL,
  EDITOR_OBJECT_LABEL,
  type EditorObject,
  type FieldObject,
  type LinkObject,
  type LinkTarget,
  type MarkGlyph,
  type TextAlign,
  type TextEditObject,
} from "@/lib/pdf/editor/model";
import type { StackMove } from "@/lib/pdf/editor/history";
import { parseLinkInput } from "@/lib/pdf/editor/links";
import {
  DATE_FORMATS,
  formatDate,
  type DateFormat,
} from "@/lib/pdf/editor/quick-fields";
import { ownFontCovers, substituteLabel } from "@/lib/pdf/editor/runs";
import { needsUnicodeFace } from "@/lib/pdf/editor/text";
import type { Defaults, Tool } from "./editor-state";

/**
 * The properties of what is selected — or, with nothing selected, of what
 * the active tool will place next. A change applies to every selected object
 * that has the property, as one undo step per control (`coalesce`), and
 * becomes the default for the next object of that kind.
 */

/** Which defaults bucket an object or tool reads. */
export type StyleBucket =
  | keyof Defaults
  | "image"
  | "signature"
  | "whiteout"
  | "textedit"
  | "link"
  | "field";

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
    case "redact":
      return "redact";
    case "date":
      return "date";
    case "initials":
    case "name":
      return "person";
    case "check":
      return "mark";
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
  glyph: MarkGlyph;
  format: DateFormat;
  name: string;
  target: LinkTarget;
  options: string[];
  value: string;
  checked: boolean;
  multiline: boolean;
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
  onStack,
  pageIds = [],
  className,
}: {
  selection: EditorObject[];
  /** The tool's bucket when nothing is selected. */
  bucket: StyleBucket | null;
  defaults: Defaults;
  onPatch: (patch: StylePatch, key: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Z-order: move the selection within its page's stack. */
  onStack?: (move: StackMove) => void;
  /** The displayed pages' ids, in order — a link's "go to page" choices. */
  pageIds?: readonly string[];
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
    : (NEW_TITLE[kind] ??
      `New ${kind === "shape" ? "shape" : kind === "line" ? "line" : kind}`);
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
          the file — search, copy and text extraction can find it. Use Redact to
          remove it.
        </p>
      )}

      {kind === "redact" && (
        <>
          <Field label="Box colour">
            <select
              aria-label="Redaction box colour"
              value={shown.fill === "white" ? "white" : "black"}
              onChange={(e) => set({ fill: e.target.value }, "fill")}
              className={input}
            >
              <option value="black">Black</option>
              <option value="white">White</option>
            </select>
          </Field>
          <p
            data-redact-note=""
            className="text-muted flex gap-1.5 text-[11px] leading-snug"
          >
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            When you apply, the text, picture pixels and comments under the box
            are removed from the file, not just covered. Lines and shapes drawn
            under it are covered.
          </p>
        </>
      )}

      {kind === "date" && (
        <Field label="Format">
          <select
            aria-label="Date format"
            value={shown.format}
            onChange={(e) =>
              set({ format: e.target.value as DateFormat }, "format")
            }
            className={input}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {formatDate(new Date(), f)}
              </option>
            ))}
          </select>
        </Field>
      )}

      {kind === "person" && (
        <Field label="Your name">
          <input
            type="text"
            aria-label="Your name"
            value={shown.name ?? ""}
            placeholder="Type your name"
            onChange={(e) => set({ name: e.target.value }, "name")}
            className={cn(input, "w-36")}
          />
        </Field>
      )}

      {kind === "mark" && (
        <>
          <div className="flex items-center gap-1.5">
            {(
              [
                ["check", "Check mark", CheckIcon],
                ["cross", "Cross", X],
              ] as const
            ).map(([glyph, label, Icon]) => (
              <Toggle
                key={glyph}
                label={label}
                pressed={shown.glyph === glyph}
                onClick={() => set({ glyph }, "glyph")}
              >
                <Icon className="size-3.5" aria-hidden />
              </Toggle>
            ))}
          </div>
          <Field label="Colour">
            <input
              type="color"
              aria-label="Mark colour"
              value={shown.color ?? "#111827"}
              onChange={(e) => set({ color: e.target.value }, "color")}
              className="h-8 w-10 cursor-pointer"
            />
          </Field>
        </>
      )}

      {first?.kind === "link" && selection.length === 1 && (
        <LinkFields
          key={first.id}
          obj={first}
          pageIds={pageIds}
          onTarget={(target) => set({ target }, "target")}
        />
      )}

      {first?.kind === "field" && selection.length === 1 && (
        <FieldFields key={first.id} obj={first} onPatch={set} />
      )}

      {first?.kind === "textedit" && selection.length === 1 && (
        <TextEditInfo obj={first} />
      )}

      {onStack && selection.length > 0 && kind !== "textedit" && (
        <div
          role="group"
          aria-label="Order"
          className="flex flex-col gap-1.5 text-xs"
        >
          <span className="text-muted" aria-hidden>
            Order
          </span>
          <span className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["front", "To front", "Bring to front", BringToFront],
                ["forward", "Forward", "Bring forward", ArrowUp],
                ["backward", "Backward", "Send backward", ArrowDown],
                ["back", "To back", "Send to back", SendToBack],
              ] as const
            ).map(([move, text, label, Icon]) => (
              <button
                key={move}
                type="button"
                aria-label={label}
                onClick={() => onStack(move)}
                className="border-line text-muted hover:text-fg rounded-ctl inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-xs"
              >
                <Icon className="size-3.5" aria-hidden />
                {text}
              </button>
            ))}
          </span>
        </div>
      )}

      {selection.length > 0 && (
        <div className="flex gap-2">
          {kind !== "textedit" && (
            <button
              type="button"
              onClick={onDuplicate}
              className="border-line text-muted hover:text-fg rounded-ctl inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-xs"
            >
              <Copy className="size-3.5" aria-hidden />
              Duplicate
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="border-line text-muted hover:text-err rounded-ctl inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-xs"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {kind === "textedit" ? "Undo this edit" : "Delete"}
          </button>
        </div>
      )}
    </section>
  );
}

const NEW_TITLE: Partial<Record<StyleBucket, string>> = {
  date: "Date",
  person: "Initials and name",
  mark: "Check mark",
};

/** Where a link goes: a web address, email or phone number — or a page. */
function LinkFields({
  obj,
  pageIds,
  onTarget,
}: {
  obj: LinkObject;
  pageIds: readonly string[];
  onTarget: (target: LinkTarget) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<"uri" | "page">(
    obj.target.type === "page" ? "page" : "uri",
  );
  const [text, setText] = useState(
    obj.target.type === "uri" ? obj.target.uri : "",
  );
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // A link just drawn has nowhere to go yet: the address is the next thing.
  const fresh = obj.target.type === "uri" && !obj.target.uri;
  useEffect(() => {
    if (fresh) field.current?.focus({ preventScroll: true });
    // Once, when this link's fields open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const commitText = () => {
    if (!text.trim() && fresh) return;
    const parsed = parseLinkInput(text);
    if (!parsed.ok) {
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    setText(parsed.uri);
    onTarget({ type: "uri", uri: parsed.uri });
  };
  const pageIndex =
    obj.target.type === "page" ? pageIds.indexOf(obj.target.pageId) : -1;
  return (
    <div className="flex flex-col gap-2 text-xs" data-link-fields="">
      {obj.target.type === "other" && (
        <p className="text-muted text-[11px] leading-snug">
          Goes to {obj.target.label}. Choose a new target below to change it;
          left as it is, the link is kept exactly as it was.
        </p>
      )}
      <div role="radiogroup" aria-label="Link goes to" className="flex gap-1">
        {(
          [
            ["uri", "Web, email or phone"],
            ["page", "A page"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "rounded-ctl border px-2 py-1.5",
              mode === value
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-line text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "uri" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-uri`} className="text-muted">
            Address
          </label>
          <div className="flex gap-1">
            <input
              ref={field}
              id={`${id}-uri`}
              type="text"
              onBlur={() => {
                if (text.trim()) commitText();
              }}
              inputMode="url"
              aria-label="Link address"
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-err` : undefined}
              value={text}
              placeholder="example.com, name@example.com or +1 555 0100"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitText();
                }
              }}
              className={cn(input, "min-w-0 flex-1")}
            />
            <button
              type="button"
              onClick={commitText}
              className="border-line text-fg rounded-ctl border px-2.5 text-xs font-semibold"
            >
              Set
            </button>
          </div>
          {problem && (
            <p id={`${id}-err`} role="alert" className="text-err text-[11px]">
              {problem}
            </p>
          )}
        </div>
      ) : (
        <Field label="Go to page">
          <select
            aria-label="Go to page"
            value={pageIndex >= 0 ? String(pageIndex) : ""}
            onChange={(e) => {
              const page = pageIds[Number(e.target.value)];
              if (page) onTarget({ type: "page", pageId: page });
            }}
            className={input}
          >
            {pageIndex < 0 && (
              <option value="">
                {obj.target.type === "page" ? "Deleted page" : "Choose"}
              </option>
            )}
            {pageIds.map((pid, i) => (
              <option key={pid} value={String(i)}>
                Page {i + 1}
              </option>
            ))}
          </select>
        </Field>
      )}
      {obj.target.type === "page" && pageIndex < 0 && (
        <p role="alert" className="text-err text-[11px]">
          This link goes to a page you deleted. Choose another page.
        </p>
      )}
      <p className="text-muted text-[11px] leading-snug">
        Saved as a real link: it opens in any PDF reader. Nothing is drawn on
        the page.
      </p>
    </div>
  );
}

/** A new form field's name, choices and starting value. */
function FieldFields({
  obj,
  onPatch,
}: {
  obj: FieldObject;
  onPatch: (patch: StylePatch, key: string) => void;
}) {
  const id = useId();
  const [options, setOptions] = useState(obj.options.join("\n"));
  const choices = obj.fieldType === "dropdown" || obj.fieldType === "radio";
  return (
    <div className="flex flex-col gap-2 text-xs" data-field-fields="">
      <p className="text-fg font-medium">{EDITOR_FIELD_LABEL[obj.fieldType]}</p>
      <Field label="Name">
        <input
          type="text"
          aria-label="Field name"
          value={obj.name}
          onChange={(e) => onPatch({ name: e.target.value }, "name")}
          className={cn(input, "w-36")}
        />
      </Field>
      {choices && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-opts`} className="text-muted">
            Options, one per line
          </label>
          <textarea
            id={`${id}-opts`}
            aria-label="Options"
            rows={4}
            value={options}
            onChange={(e) => {
              setOptions(e.target.value);
              const list = e.target.value
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean);
              onPatch(
                {
                  options: list,
                  ...(obj.value && !list.includes(obj.value)
                    ? { value: "" }
                    : {}),
                },
                "options",
              );
            }}
            className="border-line bg-canvas text-fg rounded-ctl border px-2 py-1 text-xs"
          />
        </div>
      )}
      {obj.fieldType === "text" && (
        <>
          <Field label="Starting text">
            <input
              type="text"
              aria-label="Starting text"
              value={obj.value}
              onChange={(e) => onPatch({ value: e.target.value }, "value")}
              className={cn(input, "w-36")}
            />
          </Field>
          <Check
            label="Several lines"
            checked={obj.multiline}
            onChange={(on) => onPatch({ multiline: on }, "multiline")}
          />
        </>
      )}
      {choices && (
        <Field label="Chosen">
          <select
            aria-label="Chosen option"
            value={obj.value}
            onChange={(e) => onPatch({ value: e.target.value }, "value")}
            className={input}
          >
            <option value="">None</option>
            {obj.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
      )}
      {obj.fieldType === "checkbox" && (
        <Check
          label="Starts ticked"
          checked={obj.checked}
          onChange={(on) => onPatch({ checked: on }, "checked")}
        />
      )}
      <p className="text-muted text-[11px] leading-snug">
        {obj.fieldType === "signature"
          ? "An empty signature field: a reader that signs with a certificate fills it in."
          : "A real form field: anyone can fill it in in a PDF reader."}{" "}
        Names and options use the standard PDF alphabet (Latin letters).
      </p>
    </div>
  );
}

/** What an edit to existing text will be written in, and what it replaces. */
function TextEditInfo({ obj }: { obj: TextEditObject }) {
  const own = ownFontCovers(obj.ownChars, obj.text);
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <p className="text-muted">
        Was: <span className="text-fg">“{obj.original}”</span>
      </p>
      <p className="text-muted">
        Now:{" "}
        <span className="text-fg">
          {obj.text.trim() ? `“${obj.text}”` : "deleted"}
        </span>
      </p>
      {obj.text.trim().length > 0 && (
        <p
          data-font-note=""
          className="text-muted flex gap-1.5 text-[11px] leading-snug"
        >
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          {own
            ? `Written in the text's own font (${obj.fontName}).`
            : `Font substituted: ${substituteLabel(obj, obj.text)}. The text's own font (${obj.fontName}) doesn't include every character you typed.`}
        </p>
      )}
      <p className="text-muted text-[11px] leading-snug">
        The original words are removed from the file when you apply.
      </p>
    </div>
  );
}
