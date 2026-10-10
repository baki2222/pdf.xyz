"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEarlyFilePick } from "./use-early-file-pick";

/** How files reached a sheet. */
export type DropVia = "pick" | "drop" | "paste" | "early" | "header";

/** What a desk body needs to place its own controls. */
export interface DropSheetApi {
  /** Open the file picker (the sheet's own hidden input). */
  pick(): void;
  /** The id of the sentence that describes what the sheet takes. */
  readonly hintId: string;
  /**
   * Whether a file dropped anywhere on the page lands here
   * (`catchPageDrops`) — for a body that says so, from the same value that
   * makes it true, so the sentence cannot outlive the behaviour.
   */
  readonly catchesPageDrops: boolean;
}

interface SheetContext extends DropSheetApi {
  readonly accept: string;
  readonly multiple: boolean;
  /** Whether an element carries `hintId` (a desk's body places it). */
  readonly described: boolean;
  readonly emit: (list: FileList | null, via: DropVia) => void;
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

/** Does this drag carry files (not text, not a link)? */
function carriesFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes("Files");
}

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

/**
 * The one drop primitive: a sheet a file is dropped on or picked into.
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
 *    sheet is where it will land (`catchPageDrops`) — the marks grow (M2).
 *
 * VARIANTS. `sheet` and `compact` are a whole-surface label: drop or click
 * anywhere. `desk` is a sheet whose body is its owner's (`children`), with a
 * {@link DropSheetPick} wherever the owner wants the picker, and a hidden
 * input behind {@link DropSheetApi.pick} for a control that is not a label.
 *
 * `catchPageDrops`: the sheet receives a file dropped ANYWHERE on its page,
 * so a near-miss never navigates the tab to the file. Used by the home desk
 * alone, which is the page's one drop target; WP-07 lifts this into one
 * page-level drop layer for every page.
 */
export function DropSheet({
  accept,
  multiple = true,
  title = "Drop your files here, or",
  browseLabel = "browse",
  hint,
  onFiles,
  onIntent,
  onHashTarget,
  catchPageDrops = false,
  variant = "sheet",
  id,
  className,
  children,
}: {
  accept: string;
  multiple?: boolean;
  /** `sheet`/`compact`: the sentence on the sheet. */
  title?: ReactNode;
  browseLabel?: string;
  /** What the sheet takes; it describes the picker (`aria-describedby`). */
  hint?: ReactNode;
  onFiles(files: File[], via: DropVia): void;
  /** A file is on its way (a drag carrying one entered): warm what is next. */
  onIntent?(): void;
  /** `#id` became the URL's fragment; default: focus the picker. */
  onHashTarget?(): void;
  catchPageDrops?: boolean;
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
    (list: FileList | null, via: DropVia) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      onFiles(multiple ? files : files.slice(0, 1), via);
    },
    [multiple, onFiles],
  );
  const pick = useCallback(() => hidden?.click(), [hidden]);

  // The page's drops, while this sheet is the page's target.
  useEffect(() => {
    if (!catchPageDrops) return;
    const page = createDragDepth(setArmed);
    const onEnter = (e: globalThis.DragEvent) => {
      if (!carriesFiles(e)) return;
      if (page.depth === 0) onIntent?.();
      page.enter();
    };
    const onLeave = (e: globalThis.DragEvent) => {
      if (carriesFiles(e)) page.leave();
    };
    const onOver = (e: globalThis.DragEvent) => {
      // Without this the browser refuses the drop — and on a release it
      // opens the file in the tab, leaving the page.
      if (carriesFiles(e)) e.preventDefault();
    };
    const onDrop = (e: globalThis.DragEvent) => {
      page.reset();
      if (e.defaultPrevented || !carriesFiles(e)) return;
      e.preventDefault();
      emit(e.dataTransfer?.files ?? null, "drop");
    };
    const onEnd = () => page.reset();
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onEnd);
    window.addEventListener("blur", onEnd);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("blur", onEnd);
    };
  }, [catchPageDrops, emit, onIntent]);

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
    if (!catchPageDrops && overDepth.current.depth === 0) onIntent?.();
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
    // Claimed here, so the page-level handler (and, later, the drop layer)
    // knows a sheet took it.
    e.preventDefault();
    emit(e.dataTransfer.files, "drop");
  };

  const context: SheetContext = {
    accept,
    multiple,
    emit,
    pick,
    hintId,
    catchesPageDrops: catchPageDrops,
    // A desk's body renders the hint itself, under `hintId`.
    described: variant === "desk" || hint != null,
  };
  const desk = variant === "desk";

  return (
    <Sheet.Provider value={context}>
      <div
        ref={rootRef}
        id={id}
        data-live={live ? "on" : "pending"}
        data-over={over || undefined}
        data-armed={armed || over || undefined}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={cn(
          "crop-marks group/sheet relative scroll-mt-24",
          desk ? "rounded-sheet" : "flex flex-col",
          className,
        )}
      >
        {desk ? (
          children?.(context)
        ) : (
          <DropSheetPick
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 border border-dashed text-center transition-colors duration-150",
              variant === "compact" ? "px-4 py-6" : "px-6 py-12",
              "group-data-[over]/sheet:border-accent group-data-[over]/sheet:bg-accent/5 border-line-strong bg-canvas hover:border-fg/40",
              "has-[:focus-visible]:border-accent has-[:focus-visible]:ring-accent/40 has-[:focus-visible]:ring-2",
            )}
          >
            <UploadCloud
              className={cn(
                "text-muted",
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
                {title}{" "}
                <span className="text-accent underline underline-offset-4">
                  {browseLabel}
                </span>
              </span>
              {hint && (
                <span id={hintId} className="text-muted text-xs">
                  {hint}
                </span>
              )}
            </span>
          </DropSheetPick>
        )}
        {/* Behind `pick()`: for a control that is a button, not a label. Not
            a tab stop and not announced — the control that calls it is. It
            comes after the body, so a page's first file input is the one a
            person can see. */}
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
