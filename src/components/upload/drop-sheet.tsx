"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from "react";
import { UploadCloud } from "lucide-react";
import {
  carriesFiles,
  type DropVia,
  type FileKind,
  type PageTarget,
  type TargetVerb,
} from "@/lib/intent/page-target";
import { takesByAccept } from "@/lib/intent/accept-match";
import { cn } from "@/lib/utils";
import { useEarlyFilePick } from "./use-early-file-pick";
import { usePageTarget } from "./use-page-target";

export type { DropVia } from "@/lib/intent/page-target";

/** What a desk body needs to place its own controls. */
export interface DropSheetApi {
  /** Open the file picker (the sheet's own hidden input). */
  pick(): void;
  /** The id of the sentence that describes what the sheet takes. */
  readonly hintId: string;
  /**
   * Whether a file dropped anywhere on the page lands here — the sheet is
   * registered as the page's target (`pageTarget`) — for a body that says
   * so, from the same value that makes it true, so the sentence cannot
   * outlive the behaviour.
   */
  readonly catchesPageDrops: boolean;
}

interface SheetContext extends DropSheetApi {
  readonly accept: string;
  readonly multiple: boolean;
  /** Whether an element carries `hintId` (a desk's body places it). */
  readonly described: boolean;
  readonly emit: (
    list: FileList | readonly File[] | null,
    via: DropVia,
  ) => void;
}

const Sheet = createContext<SheetContext | null>(null);

const noSubscription = () => () => {};
/** False in the server render and while hydrating, true once React is live. */
const useLive = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

/**
 * Count enters and leaves, so crossing from the sheet onto one of its own
 * children (a `dragleave` on the parent, a `dragenter` on the child) does
 * not read as the file leaving. Reset by a drop, a drag that ends, or the
 * window losing focus. The zones before this cleared their state on every
 * `dragleave`, and flickered as a file moved over their text.
 */
export function createDragDepth(onChange: (inside: boolean) => void) {
  let depth = 0;
  return {
    enter() {
      depth += 1;
      if (depth === 1) onChange(true);
    },
    leave() {
      depth = Math.max(0, depth - 1);
      if (depth === 0) onChange(false);
    },
    reset() {
      if (depth === 0) return;
      depth = 0;
      onChange(false);
    },
    get depth() {
      return depth;
    },
  };
}

/** How a sheet asks to be the page's drop target (see `pageTarget`). */
export interface SheetTarget {
  /** Who receives, as the page's veil names it: "Merge PDF", "the workspace". */
  readonly name: string;
  readonly verb: TargetVerb;
  /** Asked at the moment of each drop; false while its owner is at work. */
  readonly canReceive?: () => boolean;
  /**
   * Whether it opens this kind of file; default: its `accept`, read as the
   * browser's picker reads it. A surface that says what it cannot use (the
   * desk's ticket, the workspace's "couldn't be staged") takes everything.
   */
  readonly takes?: (file: FileKind) => boolean;
}

/**
 * The one drop primitive: a sheet a file is dropped on, pasted to or picked
 * into. Every file input the site renders is one of this sheet's
 * (`drop-surface.test.ts` discovers them all).
 *
 * Server-rendered, so its picker works before the page hydrates (a pick made
 * then is adopted on mount, `useEarlyFilePick`), and without JavaScript the
 * input is still a native, keyboard-operable file input with a real label.
 *
 * STATES, each an attribute the stylesheet reads:
 *  - `data-live`: "pending" until React is listening, then "on" — the crop
 *    marks draw in at that moment (M1), because that is when a drop works;
 *  - `data-over`: a file is being dragged over the sheet itself;
 *  - `data-armed`: a file is being dragged anywhere over the page, and this
 *    sheet is where it will land — the marks grow (M2);
 *  - `data-page-drop-target`: it is registered as the page's target.
 *
 * VARIANTS. `sheet` and `compact` are a whole-surface label: drop or click
 * anywhere. `desk` is a sheet whose body is its owner's (`children`), with a
 * {@link DropSheetPick} wherever the owner wants the picker, and a hidden
 * input behind {@link DropSheetApi.pick} for a control that is not a label.
 *
 * ONE PATH IN. A pick, a drop on the sheet, a pick made before hydration,
 * and a file the page hands it (a drop or a paste anywhere on the page,
 * when it is the page's target) all pass through the same `emit`: `refuse`
 * runs there, on every way in, so a refused file never reaches `onFiles`
 * (and so is never read or uploaded); the first reason goes to `onRefusal`,
 * and `null` once files arrive with nothing refused.
 *
 * `multiple` governs the PICKER. A drop is not filtered by it (the browser
 * does not filter one), so every dropped file reaches the owner, which keeps
 * what it takes and can say what it did not.
 */
export function DropSheet({
  accept,
  multiple = true,
  title = "Drop your files here, or",
  browse = true,
  hint,
  onFiles,
  onIntent,
  onHashTarget,
  pageTarget,
  refuse,
  onRefusal,
  variant = "sheet",
  id,
  className,
  children,
}: {
  accept: string;
  multiple?: boolean;
  /** `sheet`/`compact`: the sentence on the sheet, a "…, or" that "browse" ends. */
  title?: string;
  /** Whether the title ends in the accent "browse". */
  browse?: boolean;
  /** What the sheet takes; it describes the picker (`aria-describedby`). */
  hint?: ReactNode;
  onFiles(files: File[], via: DropVia): void;
  /** A file is on its way (a drag carrying one): warm what is next. */
  onIntent?(): void;
  /** `#id` became the URL's fragment; default: focus the picker. */
  onHashTarget?(): void;
  /** Be the page's drop target while mounted (`@/lib/intent/page-target`). */
  pageTarget?: SheetTarget;
  /** Why a file cannot be used here, or null when it can. */
  refuse?: (file: File) => string | null;
  /** The first refusal of the latest arrival, or null when none was refused. */
  onRefusal?(reason: string | null): void;
  variant?: "sheet" | "compact" | "desk";
  id?: string;
  className?: string;
  /** `desk`: the sheet's body. */
  children?: (api: DropSheetApi) => ReactNode;
}) {
  const live = useLive();
  const hintId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // State, not a ref: `pick` travels to the desk's body during render, and a
  // ref read through it is what the hooks rules forbid.
  const [hidden, setHidden] = useState<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [armed, setArmed] = useState(false);
  const overDepth = useRef(createDragDepth(setOver));

  const emit = useCallback(
    (list: FileList | readonly File[] | null, via: DropVia) => {
      if (!list || list.length === 0) return;
      const kept: File[] = [];
      let first: string | null = null;
      for (const file of Array.from(list)) {
        const why = refuse ? refuse(file) : null;
        if (why === null) kept.push(file);
        else first ??= why;
      }
      onRefusal?.(first);
      if (kept.length > 0) onFiles(kept, via);
    },
    [onFiles, refuse, onRefusal],
  );
  const pick = useCallback(() => hidden?.click(), [hidden]);

  const takes = useMemo(() => takesByAccept(accept), [accept]);
  const target: PageTarget | null = pageTarget
    ? {
        name: pageTarget.name,
        verb: pageTarget.verb,
        canReceive: () => pageTarget.canReceive?.() ?? true,
        takes: pageTarget.takes ?? takes,
        receive: (files, via) => emit(files, via),
        pick,
        arm: (on) => {
          setArmed(on);
          if (on) onIntent?.();
        },
        element: () => rootRef.current,
      }
    : null;
  usePageTarget(target);

  // A link to `#id` lands on the control that starts, not just on the sheet.
  useEffect(() => {
    if (!id) return;
    const onHash = () => {
      if (window.location.hash !== `#${id}`) return;
      if (onHashTarget) return onHashTarget();
      rootRef.current
        ?.querySelector<HTMLElement>('input[type="file"]:not([hidden])')
        ?.focus({ preventScroll: true });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [id, onHashTarget]);

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(e)) return;
    if (!armed && overDepth.current.depth === 0) onIntent?.();
    overDepth.current.enter();
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (carriesFiles(e)) overDepth.current.leave();
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    overDepth.current.reset();
    if (!carriesFiles(e)) return;
    // Claimed here, so the page's drop layer knows a sheet took it.
    e.preventDefault();
    emit(e.dataTransfer.files, "drop");
  };

  const context: SheetContext = {
    accept,
    multiple,
    emit,
    pick,
    hintId,
    catchesPageDrops: pageTarget !== undefined,
    // A desk's body renders the hint itself, under `hintId`.
    described: variant === "desk" || hint != null,
  };
  const desk = variant === "desk";

  return (
    <Sheet.Provider value={context}>
      <div
        ref={rootRef}
        id={id}
        data-drop-sheet=""
        data-live={live ? "on" : "pending"}
        data-over={over || undefined}
        data-armed={armed || over || undefined}
        data-page-drop-target={pageTarget ? "" : undefined}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={cn(
          "crop-marks group/sheet rounded-sheet relative scroll-mt-24",
          !desk && "flex flex-col",
          className,
        )}
      >
        {desk ? (
          children?.(context)
        ) : (
          <DropSheetPick
            className={cn(
              "rounded-sheet flex cursor-pointer flex-col items-center justify-center gap-3 border border-dashed text-center transition-colors duration-150",
              variant === "compact" ? "px-4 py-6" : "px-6 py-12",
              "border-line-strong bg-canvas hover:border-fg/40 group-data-[armed]/sheet:border-accent group-data-[over]/sheet:bg-accent/5",
              "has-[:focus-visible]:border-accent has-[:focus-visible]:ring-accent/40 has-[:focus-visible]:ring-2",
            )}
          >
            <UploadCloud
              className={cn(
                "text-muted group-data-[armed]/sheet:text-accent transition-colors",
                variant === "compact" ? "size-5" : "size-6",
              )}
              strokeWidth={1.5}
              aria-hidden
            />
            <span className="flex flex-col gap-1">
              <span
                className={cn(
                  "text-fg font-medium",
                  variant === "compact" ? "text-sm" : "text-[15px]",
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
              {hint && (
                <span id={hintId} className="text-muted text-xs">
                  {hint}
                </span>
              )}
            </span>
          </DropSheetPick>
        )}
        {/* Behind `pick()`: for a control that is a button, not a label, and
            for "Open files". Not a tab stop and not announced — the control
            that calls it is. It comes after the body, so a page's first file
            input is the one a person can see. */}
        <input
          ref={setHidden}
          type="file"
          hidden
          tabIndex={-1}
          aria-hidden
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            emit(e.target.files, "pick");
            e.target.value = "";
          }}
        />
      </div>
    </Sheet.Provider>
  );
}

/**
 * A label that is the sheet's picker: it wraps a visually hidden native file
 * input, so it opens the picker on a click before hydration and without
 * JavaScript, takes focus as an input, and is announced by its own words.
 * The focus ring is drawn on the label (`has-[:focus-visible]`) — the input
 * itself is invisible, and must not be an invisible tab stop.
 */
export function DropSheetPick({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const sheet = useContext(Sheet);
  if (!sheet) throw new Error("DropSheetPick must be inside a DropSheet");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { emit } = sheet;
  const adopt = useCallback(
    (list: FileList | null) => emit(list, "early"),
    [emit],
  );
  useEarlyFilePick(inputRef, adopt);

  return (
    <label htmlFor={inputId} className={className}>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={sheet.accept}
        multiple={sheet.multiple}
        aria-describedby={sheet.described ? sheet.hintId : undefined}
        className="sr-only"
        onChange={(e) => {
          emit(e.target.files, "pick");
          e.target.value = "";
        }}
      />
      {children}
    </label>
  );
}
