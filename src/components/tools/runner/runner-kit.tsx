"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import { PageRangeError } from "@/lib/pdf/ranges";
import { PdfEngineError } from "@/lib/pdf/engine";
import { buttonVariants } from "@/components/ui/button";
import { useEarlyFilePick } from "@/components/upload/use-early-file-pick";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 *  Async run state
 * ------------------------------------------------------------------ */

/** Turn any thrown value into user-facing copy, trusting our typed errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof PdfEngineError || err instanceof PageRangeError) {
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}

/**
 * Small state machine shared by every runner: tracks a busy flag, the last
 * error, and the produced result, and wraps an async task with try/catch.
 */
export function useAsyncRun<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);

  const run = useCallback(async (task: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      const value = await task();
      setResult(value);
      return value;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setBusy(false);
  }, []);

  return { busy, error, result, run, reset, setError };
}

/* ------------------------------------------------------------------ *
 *  Pure list helpers (re-exported from the pure module for call sites)
 * ------------------------------------------------------------------ */

export { reorder } from "./list-utils";

/* ------------------------------------------------------------------ *
 *  Presentational primitives
 * ------------------------------------------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn("size-4 animate-spin", className)}
      aria-hidden
    />
  );
}

/** Big drop target used for the empty state; also usable as an "add more" tile. */
export function Dropzone({
  onFiles,
  accept = "application/pdf",
  multiple = true,
  title = "Drop your PDF here, or",
  browse = true,
  hint,
  compact = false,
  className,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  title?: string;
  browse?: boolean;
  hint?: string;
  compact?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const emit = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [onFiles],
  );

  useEarlyFilePick(inputRef, emit);

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        emit(e.dataTransfer.files);
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed text-center transition-colors duration-200",
        compact ? "px-4 py-6" : "px-6 py-12",
        dragging
          ? "border-violet-400/70 bg-violet-500/10"
          : "border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]",
        className,
      )}
    >
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = "";
        }}
      />
      <span
        className={cn(
          "grid place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-500 text-white shadow-lg shadow-violet-500/30 transition-transform duration-200 group-hover:scale-105",
          compact ? "size-10" : "size-14",
        )}
      >
        <UploadCloud
          className={compact ? "size-5" : "size-7"}
          strokeWidth={1.75}
          aria-hidden
        />
      </span>
      <span className="flex flex-col gap-1">
        <span
          className={cn(
            "font-semibold text-white",
            compact ? "text-sm" : "text-base",
          )}
        >
          {title}
          {browse && (
            <>
              {" "}
              <span className="text-violet-300 underline underline-offset-4">
                browse
              </span>
            </>
          )}
        </span>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

/** Primary action button with an integrated loading state. */
export function RunButton({
  onClick,
  busy,
  disabled,
  children,
  busyLabel = "Working…",
  className,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
  busyLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      aria-busy={busy}
      className={buttonVariants({
        variant: "primary",
        size: "lg",
        className: cn("w-full sm:w-auto", className),
      })}
    >
      {busy ? (
        <>
          <Spinner />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Success panel shown after a tool produces output. */
export function ResultPanel({
  title,
  summary,
  children,
  onReset,
  resetLabel = "Start over",
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  onReset: () => void;
  resetLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-emerald-400/25 bg-emerald-500/[0.07] p-6 animate-float-up">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-300">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          {summary && (
            <div className="text-sm text-slate-400">{summary}</div>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">{children}</div>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-slate-400 transition hover:text-white"
      >
        <RefreshCw className="size-3.5" aria-hidden />
        {resetLabel}
      </button>
    </div>
  );
}

/** A compact toolbar chip button used across runner controls. */
export function ChipButton({
  onClick,
  disabled,
  active,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
          : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Compact, reusable status line for progressive thumbnail rendering: a live
 * progress bar while the eager pass runs, an honest "rendering as you scroll"
 * note when a large document is capped, and a graceful fallback message when
 * previews can't render at all.
 */
export function PreviewStatus({
  rendered,
  total,
  status,
  capped = false,
  eager,
}: {
  rendered: number;
  total: number;
  status: "idle" | "rendering" | "done" | "error";
  /** True when only the first `eager` pages render up front (rest on scroll). */
  capped?: boolean;
  /** How many pages render eagerly; defaults to `total`. */
  eager?: number;
}) {
  if (status === "error") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-slate-500" role="status">
        <ImageOff className="size-3.5" aria-hidden />
        Live previews couldn&apos;t be rendered — showing page placeholders. All
        tools still work.
      </p>
    );
  }

  const target = capped && eager ? eager : total;
  const done = Math.min(rendered, target);

  if (status === "rendering" && done < target) {
    const pct = target > 0 ? Math.round((done / target) * 100) : 0;
    return (
      <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <Spinner className="size-3" />
          Rendering previews… {done}/{target}
        </span>
        <span
          className="h-1 w-full overflow-hidden rounded-full bg-white/5"
          aria-hidden
        >
          <span
            className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>
    );
  }

  if (capped && (status === "done" || done >= target)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
        <ImageIcon className="size-3.5 text-violet-300/70" aria-hidden />
        Showing {eager ?? target} previews — the rest render as you scroll.
      </span>
    );
  }

  return null;
}

/**
 * A visually-hidden, polite live region plus an `announce()` setter. Runners use
 * it to voice reorder/undo/redo results for screen-reader users without any
 * visible UI. Render `node` once inside the runner.
 */
export function useAnnouncer(): {
  announce: (message: string) => void;
  node: ReactNode;
} {
  const [message, setMessage] = useState("");
  const announce = useCallback((next: string) => setMessage(next), []);
  const node = (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
  return { announce, node };
}

/** Section wrapper giving each runner a consistent titled block. */
export function RunnerSection({
  title,
  aside,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {(title || aside) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              {title}
            </h3>
          )}
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}
