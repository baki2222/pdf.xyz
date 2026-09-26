"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { announceOutcome } from "@/components/a11y/live-region";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  RefreshCw,
  TriangleAlert,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import { PageRangeError } from "@/lib/pdf/ranges";
import { PdfEngineError } from "@/lib/pdf/engine";
import { UNLOCK_TOOL_HREF, UNLOCK_TOOL_NAME } from "@/lib/pdf/encryption";
import { buttonVariants } from "@/components/ui/button";
import { useEarlyFilePick } from "@/components/upload/use-early-file-pick";
import { warmPdfLib } from "@/lib/pdf/pdf-lib";
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
    <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />
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
      // The engine downloads the moment files arrive (including a pre-hydration
      // pick adopted by useEarlyFilePick below), so by the time a hand reaches
      // the run button the pdf-lib chunk is usually already here. Fire-and-
      // forget; the operation's own await is the surface that reports failures.
      warmPdfLib();
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
        "group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[4px] border border-dashed text-center transition-colors duration-150",
        compact ? "px-4 py-6" : "px-6 py-12",
        dragging
          ? "border-accent bg-accent/5"
          : "border-line-strong bg-canvas hover:border-fg/40",
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
      <UploadCloud
        className={cn("text-muted", compact ? "size-5" : "size-6")}
        strokeWidth={1.5}
        aria-hidden
      />
      <span className="flex flex-col gap-1">
        <span
          className={cn(
            "text-fg font-medium",
            compact ? "text-sm" : "text-[15px]",
          )}
        >
          {title}
          {browse && (
            <>
              {" "}
              <span className="text-accent underline underline-offset-4">
                browse
              </span>
            </>
          )}
        </span>
        {hint && <span className="text-muted text-xs">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Give a finished run the same standing a failed one already has.
 *
 * `ErrorNote` below carries `role="alert"`, so a failure has always been spoken.
 * Success was not announced anywhere and focus was never moved — `.focus(`
 * appeared zero times in this repository — so the one flow the product exists
 * for ended, for a screen-reader or keyboard user, in silence.
 *
 * WHY FOCUS IS *REPAIRED*, NOT MERELY OFFERED
 * Most runners replace the whole form with their result, so the element the user
 * activated is gone by the time the outcome exists and focus has fallen to
 * `<body>`. There is nothing to return to; this moves focus rather than assuming
 * the trigger survived.
 * It used to be worse: `RunButton` set `disabled={busy}`, and a disabled element
 * cannot hold focus, so EVERY run dropped the user to `<body>` at t=0 — the
 * moment work started, not when it ended — even on panels whose button was never
 * removed. `RunButton` now uses `aria-disabled`, so that half is fixed at the
 * source and this hook sees an honest `document.activeElement`.
 *
 * WHEN IT ANNOUNCES INSTEAD
 * If focus has since landed somewhere real — the user carried on typing, or
 * tabbed away — yanking it would be its own accessibility failure. In that case
 * the outcome is spoken through the app live region and focus is left alone.
 * The two paths are mutually exclusive by construction: an element that receives
 * focus is deliberately NOT a live region, or some screen readers say it twice.
 *
 * `preventScroll` + an explicit `scrollIntoView` is not a stylistic choice.
 * `globals.css` ships `scroll-behavior: smooth`, and `layout.tsx` documents an
 * incident where a smooth glide swallowed clicks outright — press and release
 * resolving to different elements, so no `click` fired at all. Focusing without
 * `preventScroll` would re-enter that bug on every completed run.
 */
export function useOutcomeFocus<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
  message: string,
) {
  const ref = useRef<T>(null);
  // Which outcome has already been handled. Keyed by message rather than a
  // boolean because surfaces like `WorkerDeepPanel` stay mounted across runs: a
  // boolean latch would make the second run silent, and a mount-only test would
  // never notice.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      handled.current = null;
      return;
    }
    if (handled.current === message) return; // a re-render, not a new outcome
    handled.current = message;

    const node = ref.current;
    if (!node) {
      announceOutcome(message);
      return;
    }
    const activeElement = document.activeElement;
    const orphaned =
      !activeElement ||
      activeElement === document.body ||
      !document.body.contains(activeElement);
    if (!orphaned) {
      announceOutcome(message);
      return;
    }
    node.focus({ preventScroll: true });
    // `behavior: "instant"` is not a default worth omitting: with it absent the
    // call inherits `scroll-behavior: smooth` from `globals.css` and re-creates
    // the very glide `preventScroll` just avoided. Optional-called because jsdom
    // does not implement `scrollIntoView`, and a missing scroll must never turn
    // an accessibility improvement into a thrown error inside a tool.
    node.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [active, message]);

  return { ref, tabIndex: -1 } as const;
}

export function ErrorNote({ message }: { message: string }) {
  // A message that sends the user to Unlock PDF (every encrypted-file message
  // does) carries the way there, rather than a tool name to go and find.
  const offersUnlock = message.includes(UNLOCK_TOOL_NAME);
  return (
    <p
      role="alert"
      className="border-err/40 bg-err/10 text-err flex items-start gap-2 rounded-[4px] border px-4 py-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {message}
        {offersUnlock && (
          <>
            {" "}
            <Link
              href={UNLOCK_TOOL_HREF}
              className="font-medium underline underline-offset-2"
            >
              Open {UNLOCK_TOOL_NAME}
            </Link>
          </>
        )}
      </span>
    </p>
  );
}

/**
 * Primary action button with an integrated loading state.
 *
 * WHY `aria-disabled` AND NOT `disabled`
 * A natively disabled element cannot hold focus, so `disabled={busy}` blurred
 * the trigger the instant a run started: the user pressed Enter on a button and
 * was dropped to `<body>`, where they stayed for the whole run. Every tool on
 * the site did this — the run is the one thing the product exists for, and it
 * began by throwing the keyboard user out of the document.
 *
 * `aria-disabled` reports the same state to assistive tech without removing the
 * element from the focus order, so the trigger a user activated is still under
 * them when the outcome arrives. The browser no longer suppresses the click, so
 * the guard below has to: an unavailable button must do nothing, and the check
 * lives in one place rather than in each of the 28 call sites.
 *
 * The not-yet-ready state (`disabled`) is treated the same way deliberately.
 * Splitting them would mean a control that leaves and re-enters the tab order as
 * unrelated state changes — rotate a page back to 0° and Apply would vanish from
 * under the keyboard again — which is the same bug wearing a different trigger.
 *
 * This interacts with {@link useOutcomeFocus} by design: focus surviving the run
 * means a result surface that renders ALONGSIDE the button (the worker panels)
 * now speaks the outcome instead of yanking focus, while runners that replace
 * themselves with a `ResultPanel` unmount the button, focus lands on `<body>`,
 * and the panel takes it as before.
 */
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
  const blocked = Boolean(busy) || Boolean(disabled);
  return (
    <button
      type="button"
      onClick={(event) => {
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick();
      }}
      aria-disabled={blocked || undefined}
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

/**
 * Tone of a worker panel's run trigger. Blue is the secure-worker default; the
 * five AI panels (chat, extract, summarize, translate, signature requests) are
 * violet to match the violet framing their surrounding card already uses.
 */
export type WorkerRunTone = "blue" | "violet";

const WORKER_RUN_TONE: Record<WorkerRunTone, string> = {
  blue: "border-info/40 bg-info/10 text-info hover:bg-info/20",
  violet: "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20",
};

/**
 * The run trigger for the worker panels — the outline-on-tint button that starts
 * a real job on the secure worker.
 *
 * WHY THIS EXISTS AT ALL
 * Fourteen panels hand-rolled it: the same forty-class string pasted verbatim,
 * differing only in tone, icon and copy. Every copy therefore carried the same
 * defect {@link RunButton} was fixed for in #46 — a native `disabled` that blurs
 * the user at the instant their run starts — and the copying is precisely why
 * fixing one of them fixed none of the others. The markup lives in one place now
 * so the next fix reaches all fourteen.
 *
 * The blocked semantics are {@link RunButton}'s, for the reasons documented
 * there: `aria-disabled` plus a guard in `onClick`, so the trigger keeps its
 * place in the focus order for the whole run. It matters more here than on the
 * in-browser runners — a worker job takes seconds to minutes, and these panels
 * render their result ALONGSIDE the button rather than replacing it, so a user
 * who is not blurred at t=0 never has to be sent anywhere at all.
 *
 * `disabled` and `busy` are separate props but share one branch on purpose;
 * splitting them would let the control leave and re-enter the tab order as
 * unrelated state changes.
 */
export function WorkerRunButton({
  onClick,
  busy,
  disabled,
  busyLabel,
  icon: Icon,
  children,
  tone = "blue",
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** Shown, with a spinner, while the job is in flight. */
  busyLabel: string;
  icon: LucideIcon;
  children: ReactNode;
  tone?: WorkerRunTone;
}) {
  const blocked = Boolean(busy) || Boolean(disabled);
  return (
    <button
      type="button"
      onClick={(event) => {
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick();
      }}
      aria-disabled={blocked || undefined}
      aria-busy={busy}
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-[3px] border px-6 py-2.5 text-sm font-semibold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-60 sm:w-auto sm:self-start",
        WORKER_RUN_TONE[tone],
      )}
    >
      {busy ? (
        <>
          <Spinner />
          {busyLabel}
        </>
      ) : (
        <>
          <Icon className="size-4" aria-hidden />
          {children}
        </>
      )}
    </button>
  );
}

/**
 * Sizes of {@link DownloadCta}. Exactly the three shapes the hand-rolled
 * copies had converged on, no more: `md` is the standard result CTA, `lg` is
 * the compress runner's hero download, `inline` is the compact per-file link
 * used when a result is a LIST of artifacts (OCR batches) and a full-width
 * button per file would stack into a wall.
 */
export type DownloadCtaSize = "md" | "lg" | "inline";

const DOWNLOAD_CTA_SIZE: Record<DownloadCtaSize, string> = {
  md: "w-full px-6 py-2.5 text-sm sm:w-auto sm:self-start",
  lg: "w-full px-7 py-3 text-base sm:w-auto sm:self-start",
  inline: "px-5 py-2 text-sm",
};

/**
 * The download/open CTA a finished result offers — the inverted-ground primary
 * action that hands the user their file.
 *
 * WHY THIS EXISTS AT ALL
 * The same defect-shape as {@link WorkerRunButton}, one verb later. #46 fixed
 * the run trigger and #47 found the fix had reached 28 of 45 sites because the
 * other 17 had each pasted their own copy of the markup; the copying was the
 * bug's survival mechanism. The download CTA was living the identical history:
 * one class string pasted verbatim across eleven worker panels, twice in the
 * compress runner, and once (as an anchor, at a third size) in the OCR panel —
 * 14 sites in 13 files, found by deriving the set from the download BEHAVIOUR
 * (`downloadBytes` calls + `download=` anchors) rather than from any one
 * spelling of the class string. The gradient spelling this button wore before
 * the redesign died in PR #110; the paste survived the restyle, which is
 * exactly why the paste, not the spelling, is the thing to remove.
 *
 * Renders an `<a download>` when `href` is given (a worker artifact served by
 * URL), otherwise a `<button>` (bytes already in memory). Both are always
 * enabled — a result that exists is a result you may take, so this component
 * deliberately has no disabled state to mis-handle.
 */
export function DownloadCta({
  onClick,
  href,
  download,
  size = "md",
  className,
  children,
}: {
  onClick?: () => void;
  /** Render as an anchor to this URL instead of a button. */
  href?: string;
  /** The anchor's `download` filename (only meaningful with `href`). */
  download?: string;
  size?: DownloadCtaSize;
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(
    "bg-invert text-fg-invert hover:bg-invert/85 inline-flex items-center justify-center gap-2 rounded-[3px] font-semibold transition-colors",
    DOWNLOAD_CTA_SIZE[size],
    className,
  );
  const icon = <Download className="size-4" aria-hidden />;
  if (href !== undefined) {
    return (
      <a href={href} download={download} className={classes}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {icon}
      {children}
    </button>
  );
}

/**
 * Success panel shown after a tool produces output.
 *
 * Deliberately NOT a live region — it receives focus instead, and doing both
 * makes some screen readers read the outcome twice. See {@link useOutcomeFocus}.
 */
export function ResultPanel({
  title,
  summary,
  children,
  onReset,
  resetLabel = "Start over",
  announcement,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  onReset: () => void;
  resetLabel?: string;
  /**
   * What to say when focus cannot be moved. Defaults to `title`, which is right
   * for most tools; override where the title alone is thin out of context
   * ("PDF re-saved", "Selectable text matches").
   */
  announcement?: string;
}) {
  const id = useId();
  // Always `true`: this panel only ever renders on success, so its existence IS
  // the outcome. Surfaces that persist across runs pass a real condition.
  const outcome = useOutcomeFocus(true, announcement ?? title);
  return (
    <div
      {...outcome}
      role="group"
      aria-labelledby={summary ? `${id}-t ${id}-s` : `${id}-t`}
      className="animate-float-up border-ok/30 bg-ok/10 focus-visible:ring-ok/50 flex flex-col gap-5 rounded-[4px] border p-6 outline-none focus-visible:ring-2"
    >
      <div className="flex items-start gap-3">
        <span className="bg-ok/15 text-ok grid size-10 shrink-0 place-items-center rounded-[3px]">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h3 id={`${id}-t`} className="text-fg text-base font-semibold">
            {title}
          </h3>
          {summary && (
            <div id={`${id}-s`} className="text-muted text-sm">
              {summary}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {children}
      </div>
      <button
        type="button"
        onClick={onReset}
        className="text-muted hover:text-fg inline-flex items-center gap-1.5 self-start text-xs font-medium transition-colors"
      >
        <RefreshCw className="size-3.5" aria-hidden />
        {resetLabel}
      </button>
    </div>
  );
}

/**
 * The success card the worker panels render, with an outcome attached.
 *
 * Thirteen files had hand-copied the same emerald card markup, and every copy
 * was invisible to assistive tech. This is that exact markup — the swap is a
 * pixel-for-pixel no-op — with the difference that `announce` is REQUIRED. A new
 * panel cannot build the card without writing the sentence a user hears, which
 * is the only kind of convention this codebase has not drifted out of.
 */
export function ResultCard({
  announce,
  children,
  className,
}: {
  announce: string;
  children: ReactNode;
  className?: string;
}) {
  const outcome = useOutcomeFocus(true, announce);
  return (
    <div
      {...outcome}
      role="group"
      aria-label={announce}
      className={cn(
        "border-ok/30 bg-ok/10 focus-visible:ring-ok/50 flex flex-col gap-2 rounded-[4px] border p-4 outline-none focus-visible:ring-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A compact toolbar chip button used across runner controls.
 *
 * `disabled` renders as `aria-disabled` + a guarded click, never the native
 * attribute — the same rule as {@link RunButton}/{@link WorkerRunButton} (#46),
 * for the same reason: these chips are option/history controls that flip
 * state exactly when the user is interacting nearby (a quality chip disables
 * the moment a run starts; undo disables the moment history empties), and a
 * natively disabled element cannot hold focus, so the flip would throw a
 * keyboard user's place away at the worst moment. `aria-disabled` keeps the
 * chip in the tab order, announces it as unavailable, and the guard makes a
 * click a no-op.
 */
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
      onClick={() => {
        if (!disabled) onClick();
      }}
      aria-disabled={disabled || undefined}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[2px] border px-3 py-1.5 text-xs font-medium transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
        active
          ? "border-accent/50 bg-accent/10 text-accent"
          : "border-line text-muted hover:border-line-strong hover:bg-wash hover:text-fg",
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
      <p
        className="text-muted inline-flex items-center gap-1.5 text-xs"
        role="status"
      >
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
        <span className="text-muted inline-flex items-center gap-1.5 text-xs">
          <Spinner className="size-3" />
          Rendering previews… {done}/{target}
        </span>
        <span
          className="bg-line h-1 w-full overflow-hidden rounded-full"
          aria-hidden
        >
          <span
            className="bg-accent block h-full rounded-full transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>
    );
  }

  if (capped && (status === "done" || done >= target)) {
    return (
      <span className="text-muted inline-flex items-center gap-1.5 text-xs">
        <ImageIcon className="text-faint size-3.5" aria-hidden />
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
            <h3 className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
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

/**
 * "Some images could not be decoded" — pdfjs's own verdict, surfaced.
 *
 * Renders nothing when the count is 0, so callers can mount it unconditionally.
 * This is never a guess about pixels: a genuinely blank page produces no failed
 * image object and therefore no notice.
 *
 * The `redaction` wording exists because the stakes differ. On a converter a
 * failed decode costs the user a picture; on redact-pdf it can cost them the
 * belief that a document is safe to publish, so that variant says plainly that
 * the content is ABSENT rather than covered.
 */
export function UndecodedImagesNotice({
  count,
  redaction = false,
}: {
  count: number;
  redaction?: boolean;
}) {
  if (count <= 0) return null;
  const plural = count === 1 ? "" : "s";
  return (
    <div
      role="alert"
      className="border-warn/40 bg-warn/10 text-warn flex items-start gap-3 rounded-[4px] border px-4 py-3.5 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-semibold">
          {count} image{plural} could not be decoded.
        </span>{" "}
        {redaction ? (
          <>
            {count === 1 ? "It is" : "They are"} blank in this output — the
            content is missing from the file, not hidden underneath a redaction
            box. Open the downloaded PDF and check those pages before you share
            it.
          </>
        ) : (
          <>
            {count === 1 ? "It is" : "They are"} blank in the images above.
            Everything else on {count === 1 ? "that page" : "those pages"}{" "}
            converted normally.
          </>
        )}
      </p>
    </div>
  );
}
