"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Circle,
  Eraser,
  Replace,
  Highlighter,
  ImagePlus,
  Maximize2,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Redo2,
  Signature,
  Square,
  TextCursorInput,
  SquareSlash,
  StickyNote,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/pdf/editor/geometry";
import { MARKUP_KINDS, type EditorKind } from "@/lib/pdf/offered-kinds";
import type { Tool } from "./editor-state";

/**
 * The editor's toolbar: every tool is an icon AND its name — a bar of bare
 * icons read as "developer style" to the owner (2026-10-24) — grouped the
 * way a person thinks about the job: Add (text, a picture, a signature),
 * Shapes, Mark up. On a phone each name sits under its icon and the strip
 * scrolls sideways, with a fade at the edge that has more.
 */

export interface ToolButtonSpec {
  tool: Tool;
  label: string;
  key: string;
  icon: typeof Type;
}

const SPEC: Record<Tool, ToolButtonSpec> = {
  select: { tool: "select", label: "Select", key: "V", icon: MousePointer2 },
  text: { tool: "text", label: "Text", key: "T", icon: Type },
  edittext: {
    tool: "edittext",
    label: "Edit text",
    key: "X",
    icon: TextCursorInput,
  },
  image: { tool: "image", label: "Image", key: "I", icon: ImagePlus },
  signature: { tool: "signature", label: "Sign", key: "S", icon: Signature },
  rect: { tool: "rect", label: "Rectangle", key: "R", icon: Square },
  ellipse: { tool: "ellipse", label: "Ellipse", key: "E", icon: Circle },
  line: { tool: "line", label: "Line", key: "L", icon: Minus },
  arrow: { tool: "arrow", label: "Arrow", key: "A", icon: MoveUpRight },
  whiteout: { tool: "whiteout", label: "Whiteout", key: "W", icon: Eraser },
  redact: { tool: "redact", label: "Redact", key: "B", icon: SquareSlash },
  highlight: {
    tool: "highlight",
    label: "Highlight",
    key: "H",
    icon: Highlighter,
  },
  ink: { tool: "ink", label: "Draw", key: "D", icon: Pencil },
  note: { tool: "note", label: "Note", key: "N", icon: StickyNote },
};

/** The Mark-up group is the offered-kinds list Annotate PDF's page counts. */
const MARKUP_TOOL: Record<(typeof MARKUP_KINDS)[number], Tool> = {
  whiteout: "whiteout",
  redact: "redact",
  highlight: "highlight",
  ink: "ink",
  note: "note",
} satisfies Partial<Record<EditorKind, Tool>>;

export const TOOL_GROUPS: { name: string; tools: Tool[] }[] = [
  { name: "Select", tools: ["select"] },
  { name: "Add", tools: ["text", "edittext", "image", "signature"] },
  { name: "Shapes", tools: ["rect", "ellipse", "line", "arrow"] },
  { name: "Mark up", tools: MARKUP_KINDS.map((k) => MARKUP_TOOL[k]) },
];

/** Every tool's button, in toolbar order. */
export const TOOL_BUTTONS: ToolButtonSpec[] = TOOL_GROUPS.flatMap((g) =>
  g.tools.map((t) => SPEC[t]),
);

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function ToolButton({
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  icon: Icon,
  showLabel = true,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: typeof Type;
  showLabel?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={showLabel ? undefined : label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        "rounded-ctl inline-flex shrink-0 items-center transition aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
        // Phone: icon over a tiny name. Wider: icon beside the name.
        "h-11 w-14 flex-col justify-center gap-0.5 px-1.5 py-1 text-[10px] leading-none",
        "sm:h-9 sm:w-auto sm:flex-row sm:gap-1.5 sm:px-2.5 sm:text-xs sm:font-medium",
        pressed
          ? "bg-accent/15 text-accent ring-accent/40 ring-1"
          : "text-muted hover:bg-wash hover:text-fg",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {showLabel && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}

function Divider() {
  return (
    <span aria-hidden className="bg-line mx-1 h-8 w-px shrink-0 self-center" />
  );
}

/** A group of tools with its name: a caption on wide screens, a label for all. */
function Group({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={name}
      className="flex shrink-0 flex-col gap-0.5"
    >
      <span
        aria-hidden
        className="text-faint hidden px-1 text-[10px] font-semibold tracking-wide uppercase sm:block"
      >
        {name}
      </span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

/** A sideways-scrolling strip that shows a fade on each side with more. */
function Strip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setMore({
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      });
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      ro?.disconnect();
    };
  }, []);
  return (
    <div className="relative min-w-0 overflow-x-clip">
      <div
        ref={ref}
        role="toolbar"
        aria-label="Editor tools"
        className="flex min-w-0 [scrollbar-width:none] items-end gap-0.5 overflow-x-auto px-1 py-1 sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <span
        aria-hidden
        data-scroll-more="left"
        className={cn(
          "from-panel pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r to-transparent transition-opacity sm:hidden",
          more.left ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden
        data-scroll-more="right"
        className={cn(
          "from-panel pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent transition-opacity sm:hidden",
          more.right ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

export function EditorToolbar({
  tool,
  onTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  fit,
  onZoom,
  onFit,
  finding,
  onFind,
}: {
  finding: boolean;
  onFind: () => void;
  tool: Tool;
  onTool: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  fit: boolean;
  onZoom: (zoom: number) => void;
  onFit: () => void;
}) {
  const step = (dir: 1 | -1) => {
    const next =
      dir > 0
        ? ZOOM_STEPS.find((z) => z > zoom + 0.001)
        : [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001);
    onZoom(next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM));
  };
  return (
    <Strip>
      {TOOL_GROUPS.map((group, i) => (
        <div key={group.name} className="flex shrink-0 items-end">
          {i > 0 && <Divider />}
          <Group name={group.name}>
            {group.tools.map((t) => {
              const b = SPEC[t];
              return (
                <ToolButton
                  key={t}
                  label={b.label}
                  icon={b.icon}
                  shortcut={b.key}
                  pressed={tool === t}
                  onClick={() => onTool(t)}
                />
              );
            })}
          </Group>
        </div>
      ))}
      <Divider />
      <Group name="Find">
        <ToolButton
          label="Find & replace"
          icon={Replace}
          shortcut="Control+F"
          pressed={finding}
          onClick={onFind}
        />
      </Group>
      <Divider />
      <Group name="History">
        <ToolButton
          label="Undo"
          icon={Undo2}
          shortcut="Control+Z"
          disabled={!canUndo}
          onClick={onUndo}
        />
        <ToolButton
          label="Redo"
          icon={Redo2}
          shortcut="Control+Shift+Z"
          disabled={!canRedo}
          onClick={onRedo}
        />
      </Group>
      <Divider />
      <Group name="Zoom">
        <ToolButton
          label="Zoom out"
          icon={ZoomOut}
          showLabel={false}
          disabled={zoom <= MIN_ZOOM + 0.001}
          onClick={() => step(-1)}
        />
        <label className="sr-only" htmlFor="editor-zoom">
          Zoom
        </label>
        <select
          id="editor-zoom"
          value={fit ? "fit" : String(zoom)}
          onChange={(e) => {
            if (e.target.value === "fit") onFit();
            else onZoom(Number(e.target.value));
          }}
          className="border-line bg-canvas text-fg rounded-ctl h-9 shrink-0 border px-1.5 text-xs tabular-nums"
        >
          <option value="fit">
            {fit ? `Fit width (${Math.round(zoom * 100)}%)` : "Fit width"}
          </option>
          {!fit && !ZOOM_STEPS.includes(zoom) && (
            <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>
          )}
          {ZOOM_STEPS.map((z) => (
            <option key={z} value={String(z)}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
        <ToolButton
          label="Zoom in"
          icon={ZoomIn}
          showLabel={false}
          disabled={zoom >= MAX_ZOOM - 0.001}
          onClick={() => step(1)}
        />
        <ToolButton
          label="Fit width"
          icon={Maximize2}
          showLabel={false}
          pressed={fit}
          onClick={onFit}
        />
      </Group>
    </Strip>
  );
}
