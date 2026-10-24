"use client";

import type { ReactNode } from "react";
import {
  Circle,
  Eraser,
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
  StickyNote,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/pdf/editor/geometry";
import type { Tool } from "./editor-state";

/** Every tool's button: its accessible name, its key, its icon. */
export const TOOL_BUTTONS: {
  tool: Tool;
  label: string;
  key: string;
  icon: typeof Type;
  group: "main" | "shape";
}[] = [
  {
    tool: "select",
    label: "Select",
    key: "V",
    icon: MousePointer2,
    group: "main",
  },
  { tool: "text", label: "Text", key: "T", icon: Type, group: "main" },
  { tool: "image", label: "Image", key: "I", icon: ImagePlus, group: "main" },
  {
    tool: "signature",
    label: "Sign",
    key: "S",
    icon: Signature,
    group: "main",
  },
  { tool: "rect", label: "Rectangle", key: "R", icon: Square, group: "shape" },
  { tool: "ellipse", label: "Ellipse", key: "E", icon: Circle, group: "shape" },
  { tool: "line", label: "Line", key: "L", icon: Minus, group: "shape" },
  {
    tool: "arrow",
    label: "Arrow",
    key: "A",
    icon: MoveUpRight,
    group: "shape",
  },
  {
    tool: "whiteout",
    label: "Whiteout",
    key: "W",
    icon: Eraser,
    group: "main",
  },
  {
    tool: "highlight",
    label: "Highlight",
    key: "H",
    icon: Highlighter,
    group: "main",
  },
  { tool: "ink", label: "Draw", key: "D", icon: Pencil, group: "main" },
  { tool: "note", label: "Note", key: "N", icon: StickyNote, group: "main" },
];

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function ToolButton({
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        "rounded-ctl inline-flex size-9 shrink-0 items-center justify-center transition aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
        pressed
          ? "bg-accent/15 text-accent ring-accent/40 ring-1"
          : "text-muted hover:bg-wash hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="bg-line mx-1 h-6 w-px shrink-0" />;
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
  trailing,
}: {
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
  trailing?: ReactNode;
}) {
  const step = (dir: 1 | -1) => {
    const next =
      dir > 0
        ? ZOOM_STEPS.find((z) => z > zoom + 0.001)
        : [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001);
    onZoom(next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM));
  };
  const main = TOOL_BUTTONS.filter((b) => b.group === "main");
  const shapes = TOOL_BUTTONS.filter((b) => b.group === "shape");
  const render = (b: (typeof TOOL_BUTTONS)[number]) => {
    const Icon = b.icon;
    return (
      <ToolButton
        key={b.tool}
        label={b.label}
        shortcut={b.key}
        pressed={tool === b.tool}
        onClick={() => onTool(b.tool)}
      >
        <Icon className="size-4" aria-hidden />
      </ToolButton>
    );
  };
  return (
    <div
      role="toolbar"
      aria-label="Editor tools"
      className="flex min-w-0 [scrollbar-width:thin] items-center gap-0.5 overflow-x-auto px-1 py-1"
    >
      {main.slice(0, 4).map(render)}
      <Divider />
      <div
        role="group"
        aria-label="Shapes"
        className="flex items-center gap-0.5"
      >
        {shapes.map(render)}
      </div>
      <Divider />
      {main.slice(4).map(render)}
      <Divider />
      <ToolButton
        label="Undo"
        shortcut="Control+Z"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 className="size-4" aria-hidden />
      </ToolButton>
      <ToolButton
        label="Redo"
        shortcut="Control+Shift+Z"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 className="size-4" aria-hidden />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Zoom out"
        disabled={zoom <= MIN_ZOOM + 0.001}
        onClick={() => step(-1)}
      >
        <ZoomOut className="size-4" aria-hidden />
      </ToolButton>
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
        className="border-line bg-canvas text-fg rounded-ctl h-8 shrink-0 border px-1.5 text-xs tabular-nums"
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
        disabled={zoom >= MAX_ZOOM - 0.001}
        onClick={() => step(1)}
      >
        <ZoomIn className="size-4" aria-hidden />
      </ToolButton>
      <ToolButton label="Fit width" pressed={fit} onClick={onFit}>
        <Maximize2 className="size-4" aria-hidden />
      </ToolButton>
      {trailing && (
        <>
          <span className="flex-1" />
          {trailing}
        </>
      )}
    </div>
  );
}
