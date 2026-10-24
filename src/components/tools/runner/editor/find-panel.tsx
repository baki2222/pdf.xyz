"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Find & replace across every page's text (Ctrl+F). Matches are the runs'
 * CURRENT words — an edit already made is searched as edited — and a
 * replacement is an Edit-text edit of the run, so the old words are removed
 * from the file on export like any other edit, and each Replace (or one
 * Replace all) is one undo step.
 */
export interface FindState {
  query: string;
  replacement: string;
  matchCase: boolean;
  /** Index into the current matches. */
  index: number;
}

export const INITIAL_FIND: FindState = {
  query: "",
  replacement: "",
  matchCase: false,
  index: 0,
};

const field =
  "border-line bg-canvas text-fg rounded-ctl h-9 flex-1 border px-2.5 text-sm";
/** Inline, not a utility: a class only this panel used cost the shared stylesheet. */
const fieldStyle = { minWidth: 0 } as const;
const button =
  "border-line text-fg hover:bg-wash rounded-ctl inline-flex h-9 shrink-0 items-center justify-center border px-3 text-xs font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-40";

export function FindPanel({
  state,
  onChange,
  count,
  reading,
  onStep,
  onReplace,
  onReplaceAll,
  onClose,
}: {
  state: FindState;
  onChange: (patch: Partial<FindState>) => void;
  count: number;
  /** Pages still being read, or 0 when every page's text is in. */
  reading: number;
  onStep: (dir: 1 | -1) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}) {
  const findRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, []);
  const none = count === 0;
  const status =
    state.query.length === 0
      ? "Type to search every page"
      : reading > 0
        ? `Reading text… ${count} match${count === 1 ? "" : "es"} so far`
        : none
          ? "No matches"
          : `${Math.min(state.index + 1, count)} of ${count} match${count === 1 ? "" : "es"}`;
  return (
    <section
      role="search"
      aria-label="Find and replace"
      data-find-panel=""
      className="border-line bg-panel rounded-panel flex flex-col gap-2 border p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="editor-find">
          Find
        </label>
        <input
          ref={findRef}
          id="editor-find"
          type="search"
          placeholder="Find"
          value={state.query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange({ query: e.target.value, index: 0 })}
          style={fieldStyle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            }
          }}
          className={field}
        />
        <button
          type="button"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          aria-disabled={none || undefined}
          onClick={() => !none && onStep(-1)}
          className={cn(button, "px-2")}
        >
          <ChevronUp className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Next match"
          title="Next match (Enter)"
          aria-disabled={none || undefined}
          onClick={() => !none && onStep(1)}
          className={cn(button, "px-2")}
        >
          <ChevronDown className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Close find and replace"
          title="Close (Esc)"
          onClick={onClose}
          className="text-muted hover:text-fg rounded-ctl inline-flex size-9 shrink-0 items-center justify-center"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="editor-replace">
          Replace with
        </label>
        <input
          id="editor-replace"
          type="text"
          placeholder="Replace with"
          value={state.replacement}
          autoComplete="off"
          onChange={(e) => onChange({ replacement: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !none) {
              e.preventDefault();
              onReplace();
            }
          }}
          className={field}
          style={{ ...fieldStyle, flexBasis: "10rem" }}
        />
        <button
          type="button"
          aria-disabled={none || undefined}
          onClick={() => !none && onReplace()}
          className={button}
        >
          Replace
        </button>
        <button
          type="button"
          aria-disabled={none || undefined}
          onClick={() => !none && onReplaceAll()}
          className={button}
        >
          Replace all
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-muted inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={state.matchCase}
            onChange={(e) =>
              onChange({ matchCase: e.target.checked, index: 0 })
            }
          />
          Match case
        </label>
        <p
          className="text-muted text-xs tabular-nums"
          aria-live="polite"
          data-find-status=""
        >
          {status}
        </p>
      </div>
    </section>
  );
}
