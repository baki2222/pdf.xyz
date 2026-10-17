"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
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
  Info,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { PageRangeError } from "@/lib/pdf/ranges";
import { PdfEngineError } from "@/lib/pdf/engine";
import { UNLOCK_TOOL_HREF, UNLOCK_TOOL_NAME } from "@/lib/pdf/encryption";
import { remedyFor, type Remedy, type RemedyInput } from "@/lib/pdf/remedies";
import type { RunOutput } from "@/lib/intent/run-output";
import { registerUnkeptResult } from "@/lib/intent/unsaved";
import { buttonVariants } from "@/components/ui/button";
import { NAME_WRAP } from "@/components/ui/name-wrap";
import { DropSheet, type SheetTarget } from "@/components/upload/drop-sheet";
import { warmPdfLib } from "@/lib/pdf/pdf-lib";
import { cn } from "@/lib/utils";
import {
  reportToolCompleted,
  reportToolFailed,
} from "@/lib/telemetry/tool-outcome";
import { holdRunnerStage } from "./stage-hold";
import { useToolRun } from "./tool-context";

export {
  outputFile,
  textOutputFile,
  type RunOutput,
} from "@/lib/intent/run-output";

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
 * The failure code a thrown value maps to for telemetry. Our typed errors are
 * refusals of the INPUT; the engine's own refusals say which (an encrypted
 * file, an unreadable one), and the rest — a bad page range, an engine error
 * with no kind — are the input refused as it stands. Anything else failed
 * while processing and gets no code.
 */
export function failureCode(err: unknown): string | undefined {
  if (err instanceof PdfEngineError && err.kind !== undefined)
    return err.kind === "encrypted" ? "encrypted_input" : "unreadable_input";
  return err instanceof PdfEngineError || err instanceof PageRangeError
    ? "unprocessable_entity"
    : undefined;
}

/**
 * The end of a result — its receipt and "Continue with" — is one on-demand
 * chunk (`@/components/intent/result-ending`): in the runner kit it would be
 * in every tool page's first load, for a screen most visits never reach.
 * Fetched the moment a run STARTS (Compress PDF, whose analysis starts with
 * its file, fetches it as the file arrives), and a finished run WAITS for it
 * ({@link endingReady}) before its result is drawn, so the receipt and the
 * rows draw in the same commit as the result — never into a result already
 * on screen, where each was a shift nothing had reserved space for (the
 * receipt landed ABOVE Download; Compress's ending pushed its worker card
 * off screen ~330 ms after the analysis painted, CLS +0.032 after a file
 * pick, long after the pick's input window had closed: WP-08 review,
 * 2026-10-10).
 *
 * One commit is not, by itself, a page that holds still: one taller commit
 * throws what is under the runner farther than two short ones did, and a
 * layout shift is charged by the distance (Compress PDF after a pick,
 * 0.0725 + 0.0325 became one 0.1357: WP-08 re-review, 2026-10-11). So on a
 * tool page nothing is under the runner on screen: the panel holds the
 * first screen from the first paint (`data-first-screen` in
 * `app/tools/[slug]/page.tsx`), and a result grows the panel downwards,
 * past the bottom of the screen, moving nothing a reader can see.
 *
 * The wait is bounded ({@link ENDING_WAIT_MS}). A result that outwaits it
 * is drawn without its ending, and the ending, when it comes, is drawn
 * BELOW the Download row (`ResultPanel`), where it moves nothing a hand is
 * on its way to.
 */
type Ending = typeof import("@/components/intent/result-ending");
let ending: Ending | null = null;
let endingLoad: Promise<Ending> | null = null;

export function warmEnding(): Promise<Ending> {
  endingLoad ??= import("@/components/intent/result-ending").then(
    (m) => (ending = m),
    (err: unknown) => {
      endingLoad = null;
      throw err;
    },
  );
  return endingLoad;
}

/** The longest a finished run waits for its ending before it is drawn. */
export const ENDING_WAIT_MS = 800;

/**
 * Settles when the ending is here, or after {@link ENDING_WAIT_MS} —
 * whichever is first. Never rejects: an ending that failed to load costs the
 * result its receipt, never the result.
 */
export function endingReady(): Promise<void> {
  if (ending) return Promise.resolve();
  return Promise.race([
    warmEnding().then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, ENDING_WAIT_MS)),
  ]);
}

function useEnding(): Ending | null {
  const [loaded, setLoaded] = useState(ending);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    warmEnding().then(
      (m) => live && setLoaded(m),
      () => {
        // Not loaded: the result still offers Download and Start over.
      },
    );
    return () => {
      live = false;
    };
  }, [loaded]);
  return loaded;
}

/**
 * Small state machine shared by every runner: tracks a busy flag, the last
 * error, and the produced result, and wraps an async task with try/catch.
 */
export function useAsyncRun<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);
  // A run still in flight when the runner unmounts settles its hold then:
  // the result it was held for will never be drawn (`./stage-hold`).
  const holding = useRef<(() => void) | null>(null);
  useEffect(() => () => holding.current?.(), []);

  const run = useCallback(async (task: () => Promise<T>) => {
    // The stage the result will be drawn into, held from the press, in the
    // press's own handler (`./stage-hold`).
    const settled = holdRunnerStage();
    holding.current = settled;
    setBusy(true);
    setError(null);
    void warmEnding().catch(() => {});
    const started = Date.now();
    try {
      const value = await task();
      // Every browser runner's outcome passes through here, so this is where
      // it is reported — never the message, only a coarse reason from the
      // error's TYPE. See `@/lib/telemetry/tool-outcome`. Reported as the
      // work finished, before the wait below, which is drawing, not work.
      reportToolCompleted({ elapsedMs: Date.now() - started });
      // Drawn with its ending, not before it (`endingReady`): the run is
      // still busy for the moment it waits, so nothing flashes.
      await endingReady();
      setResult(value);
      return value;
    } catch (err) {
      setError(errorMessage(err));
      reportToolFailed({ code: failureCode(err) });
      return null;
    } finally {
      setBusy(false);
      settled();
      if (holding.current === settled) holding.current = null;
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

/**
 * A runner's or panel's drop zone: the one drop primitive (`DropSheet`) with
 * the runners' defaults — a square sheet with crop marks around a dashed
 * field, the title a "…, or" that the accent "browse" ends.
 *
 * `pageTarget`: this zone is where a file dropped or pasted ANYWHERE on its
 * page lands (`@/lib/intent/page-target`) — the empty state's zone and the
 * add-more tile. OFF by default: a secondary zone inside an editor (Sign
 * PDF's signature image, Overlay PDF's overlay) must never take the page's
 * drops from the editor's own "replace" target, and an opt-in cannot be
 * forgotten in the direction that steals them (`drop-anywhere` e2e, and the
 * discovery in `page-target-sites.test.ts`). The page names the tool
 * (`data-tool-name` around the runner and the panel).
 *
 * `busy`: the zone's runner is at work; a file dropped on the PAGE then goes
 * to the ticket dialog rather than into a run already started.
 *
 * On a tool page the sheet takes the room the first screen leaves it, while
 * it is all its runner shows: the rule is the runner stage's
 * (`data-runner-stage` in `app/tools/[slug]/page.tsx`), not this zone's.
 */
export function Dropzone({
  onFiles,
  accept = "application/pdf",
  multiple = true,
  title = "Drop your PDF here, or",
  compact,
  pageTarget,
  busy,
  ...sheet
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  title?: string;
  browse?: boolean;
  hint?: string;
  compact?: boolean;
  className?: string;
  /**
   * Why a picked file cannot be used, or `null` when it can. Runs on EVERY way
   * a file arrives (drop, browse, a pick made before hydration, a drop or a
   * paste anywhere on the page) and before `onFiles`, so a refused file is
   * never read or uploaded. A drop is not filtered by `accept`, which is why
   * this exists. The worker panels pass `pickRefusal` from
   * `@/lib/uploads/pick-check`.
   */
  refuse?: (file: File) => string | null;
  pageTarget?: boolean;
  busy?: boolean;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);

  const receive = useCallback(
    (files: File[]) => {
      // The engine downloads the moment files arrive (including a pre-hydration
      // pick the sheet adopts), so by the time a hand reaches the run button
      // the pdf-lib chunk is usually already here. Fire-and-forget; the
      // operation's own await is the surface that reports failures.
      warmPdfLib();
      onFiles(files);
    },
    [onFiles],
  );

  // Read by the page at every question, so the latest `busy` is the answer.
  // Named by the page it is on (`data-tool-name`), not here.
  const target: SheetTarget | undefined = pageTarget
    ? { verb: multiple ? "add" : "open", canReceive: () => !busy }
    : undefined;

  // `browse`, `hint`, `className` and `refuse` go to the sheet as given.
  const zone = (
    <DropSheet
      {...sheet}
      accept={accept}
      multiple={multiple}
      title={title}
      variant={compact ? "compact" : "sheet"}
      onRefusal={setRefusal}
      pageTarget={target}
      onFiles={receive}
    />
  );
  // Without a refusal the zone renders alone: no wrapper, so the runners'
  // layouts (which never pass `refuse`) are untouched.
  if (!refusal) return zone;
  return (
    <>
      {zone}
      <ErrorNote message={refusal} />
    </>
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

/**
 * Does {@link ErrorNote} put a link to Unlock PDF inside this alert? Exported
 * so a panel with its own next-step link (the office-export codes) can tell
 * the alert already carries that one, rather than render it twice: two
 * "Open Unlock PDF" links, one inside the alert and one below it.
 *
 * ONE answer for both ways the alert gets the link: a remedy read off the
 * error's cause (`remedyFor`), or — for a message that names Unlock PDF and
 * came with no cause — the link the message's words ask for. Never both.
 */
export function errorNoteLinksUnlock(
  message: string,
  remedy: Remedy | null = null,
): boolean {
  return remedy
    ? remedy.href === UNLOCK_TOOL_HREF
    : message.includes(UNLOCK_TOOL_NAME);
}

/**
 * A failure, announced. `action` is the next step when there is one — a link
 * to the tool that can do what this one could not — and it renders INSIDE the
 * alert, so it is announced with the error and reached by keyboard right after
 * it, rather than sitting somewhere the reader has to go and find.
 *
 * `cause` is what the error says about why (`causeOf(err)`, or the file
 * check's own kind): an encrypted or unreadable file gets its REMEDY here
 * (`@/lib/pdf/remedies`) — the tool that fixes it, how, and where the file
 * goes there — never offered from the tool that is that remedy. A cause the
 * engine did not name gets none.
 */
export function ErrorNote({
  message,
  action,
  cause,
}: {
  message: string;
  action?: ReactNode;
  cause?: RemedyInput;
}) {
  const run = useToolRun();
  const remedy = cause ? remedyFor(cause, run?.slug ?? "") : null;
  // A message that sends the user to Unlock PDF (every encrypted-file message
  // does) carries the way there, rather than a tool name to go and find —
  // as the remedy's link when there is one, else as its own.
  const offersUnlock = !remedy && errorNoteLinksUnlock(message);
  return (
    <p
      role="alert"
      className="border-err/40 bg-err/10 text-err flex items-start gap-2 rounded-[4px] border px-4 py-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {/* Most messages name the file ("<name> isn't a PDF"); see NAME_WRAP. */}
      <span className={NAME_WRAP}>
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
        {action ? <> {action}</> : null}
        {remedy && (
          <span data-remedy="" className="mt-2 flex flex-col gap-0.5">
            <span>
              <Link
                href={remedy.href}
                className="font-semibold underline underline-offset-2"
              >
                {remedy.label}
              </Link>{" "}
              {remedy.why}.
            </span>
            {remedy.where && <span className="text-xs">{remedy.where}</span>}
          </span>
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
  progress,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
  busyLabel?: string;
  className?: string;
  /**
   * How far a run that reports progress has got (grayscale, PDF to image,
   * redact). Drawn under the button only while busy: a 2px mark bar and
   * "7 / 24 pages", never a percentage the operation did not report.
   */
  progress?: RunProgress | null;
}) {
  const blocked = Boolean(busy) || Boolean(disabled);
  const button = (
    <button
      type="button"
      data-run-trigger=""
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
  if (progress === undefined) return button;
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      {button}
      {busy && progress && <ProgressLine {...progress} />}
    </div>
  );
}

/** Work done of a run that counts it, in the run's own unit ("pages"). */
export interface RunProgress {
  readonly done: number;
  readonly total: number;
  readonly unit: string;
}

/**
 * A run's progress, as it reports it: a bar that is a share of the width
 * (`scaleX`, M14) and the count beside it. The bar is decoration; the count
 * is the fact, exposed as a progressbar. It is not a live region — a page
 * a second read out aloud is noise — so it speaks at each quarter instead,
 * through the app's region.
 */
function ProgressLine({ done, total, unit }: RunProgress) {
  const share = total > 0 ? Math.min(1, done / total) : 0;
  const quarter = Math.floor(share * 4);
  const spoken = useRef(0);
  useEffect(() => {
    if (quarter > spoken.current && quarter < 4) {
      spoken.current = quarter;
      announceOutcome(`${quarter * 25}% — ${done} of ${total} ${unit}`);
    }
  }, [quarter, done, total, unit]);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total} ${unit}`}
      className="flex w-full items-center gap-3 sm:w-auto"
      style={{ minWidth: "14rem" }}
    >
      {/* Sized and turned in its style, not with utilities of its own: the
          stylesheet is on every page (shipped-css.test.ts), this bar on
          three. The transition is stilled by the reduced-motion reset. */}
      <span
        aria-hidden
        className="bg-line relative flex-1 overflow-hidden"
        style={{ height: 2 }}
      >
        <span
          className="bg-mark absolute inset-0 transition-transform duration-200"
          style={{ transform: `scaleX(${share})`, transformOrigin: "left" }}
        />
      </span>
      <span className="figure text-muted shrink-0 text-xs">
        {done} / {total} {unit}
      </span>
    </div>
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
        "inline-flex w-full items-center justify-center gap-2 rounded-[3px] border px-6 py-2.5 text-sm font-semibold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-65 sm:w-auto sm:self-start",
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
  // `data-download`: what keeps a result (`useUnkeptResult`).
  if (href !== undefined) {
    return (
      <a href={href} download={download} className={classes} data-download="">
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={classes}
      data-download=""
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * A result on screen that has not been KEPT — downloaded — registered for
 * as long as it is on the page, so a paste that would replace the document
 * asks first (`confirmReplaceResult`, `@/lib/intent/unsaved`). An
 * in-browser download keeps it wherever its button is (`downloadBlob`); the
 * click handler returned, for the result's box in the capture phase, keeps
 * it for a link that downloads.
 */
function useUnkeptResult(active: boolean) {
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!active) return;
    const done = registerUnkeptResult();
    release.current = done;
    return () => {
      done();
      release.current = null;
    };
  }, [active]);
  return useCallback((event: MouseEvent<HTMLElement>) => {
    const target = event.target as Element | null;
    // An in-browser Download keeps it through `downloadBlob`; a link to the
    // file does not. NOT a Continue row: one that carries the file
    // navigates, and the result leaves the page with it; one that stays —
    // a modified click, a store that refused the file — carried nothing
    // (PR #180 re-review).
    if (target?.closest?.("[data-download], a[download]")) release.current?.();
  }, []);
}

/**
 * A result with nothing to go back to — said, with the reason, where the
 * result is built, so a census can tell a decision from an omission
 * (`result-output.test.ts`).
 */
export interface NoAdjust {
  readonly noAdjust: string;
}
export const NO_ADJUST = (reason: string): NoAdjust => ({ noAdjust: reason });

/**
 * A finished run that wrote no file (a PDF with no text to extract): no
 * receipt to show and nothing to carry on — said, with the reason.
 */
export interface NoOutput {
  readonly noOutput: string;
}
export const NO_OUTPUT = (reason: string): NoOutput => ({ noOutput: reason });

/**
 * The finished run: its title and summary, the RECEIPT (what it made,
 * measured here), Download (the children), "Back to adjust", "Continue
 * with", and "Start over" — every ending a fork (redesign E.6, C.3).
 *
 * `output` is REQUIRED: what the run produced, which the receipt re-opens
 * and counts and "Continue with" carries to the next tool. `onAdjust` is
 * required too: `reset` from the run's own `useAsyncRun` (the editor's
 * settings live in the component that renders this panel, so clearing the
 * result shows them again, untouched, with the same file), or
 * `NO_ADJUST(reason)` where a run has nothing to adjust.
 * `result-output.test.ts` holds every call site to both.
 *
 * The receipt and "Continue with" are one on-demand chunk (`warmEnding`),
 * fetched as the run started and waited for before the result is drawn
 * (`endingReady`, bounded), so they draw with the panel. Download, Back to
 * adjust and Start over are here; if the chunk outwaited the run, what it
 * brings is drawn under the Download row, never above it.
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
  tone = "ok",
  output,
  onAdjust,
  expectedPages,
  inputBytes,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  onReset: () => void;
  resetLabel?: string;
  /**
   * `warn` for an outcome that finished but did not give the user what they
   * came for (a PDF with no selectable text), so it does not read as success.
   *
   * `neutral` for a run that finished but did not do the tool's job — a
   * "flatten" of a PDF with nothing to flatten. A green check on that panel is
   * a claim the file does not back.
   */
  tone?: "ok" | "warn" | "neutral";
  /**
   * What to say when focus cannot be moved. Defaults to `title`, which is right
   * for most tools; override where the title alone is thin out of context
   * ("PDF re-saved", "Selectable text matches").
   */
  announcement?: string;
  /** What the run produced (`outputFile(bytes, name)`), or `NO_OUTPUT(…)`. */
  output: RunOutput | NoOutput;
  /** Back to the settings with the same file: `reset`, or `NO_ADJUST(…)`. */
  onAdjust: (() => void) | NoAdjust;
  /**
   * The pages the runner meant to write, when it knows exactly (a merge's
   * sum): a re-count that differs is said on the receipt.
   */
  expectedPages?: number;
  /** What went in, for the optimize tools' before-and-after. */
  inputBytes?: number;
}) {
  const id = useId();
  const run = useToolRun();
  const ending = useEnding();
  // Was the ending here when the result was first drawn? It is, unless the
  // run outwaited `endingReady` — and then it is drawn under the Download
  // row when it comes, never above it.
  const [late] = useState(() => ending === null);
  // Always `true`: this panel only ever renders on success, so its existence IS
  // the outcome. Surfaces that persist across runs pass a real condition.
  const outcome = useOutcomeFocus(true, announcement ?? title);
  const finished = run?.finished;
  useEffect(() => {
    if (!finished) return;
    finished(true);
    return () => finished(false);
  }, [finished]);

  const adjust = typeof onAdjust === "function" ? onAdjust : null;
  const made = "noOutput" in output ? null : output;
  const keep = useUnkeptResult(made !== null);
  // The receipt; its count-mismatch warning is drawn under Download.
  const receipt = ending && made && (
    <ending.OutputFacts
      output={made}
      expectedPages={expectedPages}
      inputBytes={inputBytes}
      optimize={run?.category === "optimize"}
      mismatch={false}
    />
  );
  const backToAdjust = () => {
    if (!adjust) return;
    // Found before the panel unmounts: the tool's panel, then its Run.
    const scope: ParentNode =
      outcome.ref.current?.closest("[data-tool-panel]") ?? document;
    adjust();
    requestAnimationFrame(() => {
      const trigger = scope.querySelector<HTMLElement>("[data-run-trigger]");
      if (!trigger) return;
      trigger.focus({ preventScroll: true });
      trigger.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    });
  };

  return (
    <div
      {...outcome}
      role="group"
      aria-labelledby={summary ? `${id}-t ${id}-s` : `${id}-t`}
      data-tone={tone}
      data-result-panel=""
      data-motion-ui=""
      onClickCapture={keep}
      className={cn(
        "rounded-panel motion-safe:animate-rise flex flex-col gap-5 border p-6 outline-none focus-visible:ring-2",
        tone === "warn"
          ? "border-warn/40 bg-warn/10 focus-visible:ring-warn/50"
          : tone === "ok"
            ? "border-ok/30 bg-ok/10 focus-visible:ring-ok/50"
            : "border-line bg-wash focus-visible:ring-line-strong",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-[3px]",
            tone === "warn"
              ? "bg-warn/15 text-warn"
              : tone === "ok"
                ? "bg-ok/15 text-ok"
                : "bg-panel text-muted",
          )}
        >
          {tone === "warn" ? (
            <AlertTriangle className="size-5" aria-hidden />
          ) : tone === "ok" ? (
            <CheckCircle2 className="size-5" aria-hidden />
          ) : (
            <Info className="size-5" aria-hidden />
          )}
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
      {!late && receipt}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {children}
        {adjust && (
          <button
            type="button"
            onClick={backToAdjust}
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Back to adjust
          </button>
        )}
      </div>
      {late && receipt}
      {/* After the count, so never above Download. */}
      {ending && made && (
        <ending.CountMismatch output={made} expectedPages={expectedPages} />
      )}
      {ending && made && <ending.ContinueWith output={made} />}
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
 *
 * `output`, when the card has the file in hand, adds the receipt and
 * "Continue with" under its contents, as {@link ResultPanel} does. Optional
 * until every worker panel has its file to give (redesign WP-10).
 *
 * Without one, a tool whose output nothing here should touch again (Protect
 * PDF, PDF to PDF/A: `NO_CONTINUE`) still says why nothing follows — the
 * page gives every worker panel its job (`ToolRunProvider`), and this card
 * reads the reason from it. `result-ending.test.tsx` drives Protect PDF's
 * panel to this card.
 */
export function ResultCard({
  announce,
  children,
  className,
  output,
  inputBytes,
}: {
  announce: string;
  children: ReactNode;
  className?: string;
  output?: RunOutput;
  inputBytes?: number;
}) {
  const outcome = useOutcomeFocus(true, announce);
  const none = useToolRun()?.plan.none;
  // Every card is a result to download (each worker panel draws one with
  // its Download), whether or not it is handed the run's `output`: none of
  // the twelve worker panels is, and their results went unasked-for under a
  // paste (PR #180 re-review).
  const keep = useUnkeptResult(true);
  return (
    <div
      {...outcome}
      role="group"
      aria-label={announce}
      onClickCapture={keep}
      className={cn(
        "border-ok/30 bg-ok/10 focus-visible:ring-ok/50 flex flex-col gap-2 rounded-[4px] border p-4 outline-none focus-visible:ring-2",
        className,
      )}
    >
      {children}
      {output ? (
        <RunEnding
          output={output}
          inputBytes={inputBytes}
          className="border-ok/30 mt-2 border-t pt-4"
        />
      ) : (
        none && (
          <p
            data-no-continue=""
            className="border-ok/30 text-muted mt-2 border-t pt-4 text-xs leading-5"
          >
            {none}
          </p>
        )
      )}
    </div>
  );
}

/**
 * The receipt and "Continue with" for a result that is not a
 * {@link ResultPanel} — Compress PDF's analysis and its batch, the worker
 * result card — from the same on-demand chunk, drawn once it is here.
 */
export function RunEnding({
  output,
  inputBytes,
  expectedPages,
  className,
}: {
  output: RunOutput;
  inputBytes?: number;
  expectedPages?: number;
  className?: string;
}) {
  const run = useToolRun();
  const ending = useEnding();
  if (!ending) return null;
  return (
    <div className={cn("flex flex-col gap-4", className)} data-motion-ui="">
      <ending.OutputFacts
        output={output}
        inputBytes={inputBytes}
        expectedPages={expectedPages}
        optimize={run?.category === "optimize"}
      />
      <ending.ContinueWith output={output} />
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
          {title && <h3 className="text-faint kicker">{title}</h3>}
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
