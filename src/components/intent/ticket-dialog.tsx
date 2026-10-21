"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import {
  DropDesk,
  type DropVia,
  type SheetTarget,
} from "@/components/upload/drop-desk";
import type { HandoffOrigin } from "@/lib/handoff/origin";
import type { Unrouted } from "@/lib/intent/page-target";
import { cn } from "@/lib/utils";
import { TICKET_DIALOG_CHUNK_MARKER } from "./ticket-dialog-chunk";
import { PendingTicket } from "./ticket-frame";
import { loadTicketView, loadedTicketView, useTicket } from "./use-ticket";

/** Where the dialog's files came from, for the tool page to say. */
const ORIGIN: HandoffOrigin = { kind: "drop", surface: "dialog" };

type TicketViewComponent = typeof import("./ticket-view").default;

export interface TicketDialogProps {
  readonly files: File[];
  readonly via: DropVia;
  /** Why the files are here and not in the page's own target. */
  readonly why: Unrouted;
  /** The tool page it opened on, never offered back to itself. */
  readonly exclude: string | null;
  readonly onClose: () => void;
  /**
   * Where the files came from, for the tool page to say. The drop layer's
   * dialog leaves it out (`surface: "dialog"`); the home desk on a phone
   * opens this dialog for its own picks and drops, so it passes its own.
   */
  readonly origin?: HandoffOrigin;
  /** The files are the site's sample PDF (the desk's "Try a sample PDF"). */
  readonly sample?: boolean;
}

/** Why the files did not go into the tool on this page — said once, at the top. */
export function whyLine(why: Unrouted, count: number): string | null {
  const them = count === 1 ? "it" : "them";
  switch (why.kind) {
    case "none":
      return null;
    case "busy":
      return `${why.name} is still working on a file, so ${them} did not go in.`;
    case "refused":
      return `${why.name} can't open ${them}.`;
    // Its row says it, first: "Open PDF to Word — you'll add … there".
    case "stage":
      return null;
    default: {
      const unhandled: never = why;
      return unhandled;
    }
  }
}

/**
 * The job ticket, in a dialog: what a page does with files that land on it
 * and are not its own — on a page with no drop target (/tools, a category,
 * the guides index, the 404), beside a tool at work, or beside a tool that
 * opens none of them. The drop layer (`./drop-layer`) opens it, fetched on
 * demand: it carries the ticket, which carries the catalogue.
 *
 * A native `<dialog>` opened with `showModal()`, portalled to the end of
 * `<body>`: the focus trap, the inert page behind and Escape are the
 * browser's own, and closing returns focus to what had it (nothing moves
 * focus after a drop). Full-screen on a phone, 560px wide from `sm`.
 *
 * While it is open it is the page's drop target: a file dropped or pasted
 * on it, or on the page around it, joins the ticket. Launching a tool
 * navigates away, which closes it.
 */
export default function TicketDialog({
  files,
  via,
  why,
  exclude,
  onClose,
  origin = ORIGIN,
  sample = false,
}: TicketDialogProps) {
  const { state, add, dispatch } = useTicket();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const regionRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const [loaded, setLoaded] = useState<TicketViewComponent | null>(null);
  const View = loaded ?? loadedTicketView()?.default ?? null;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const close = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else closeRef.current();
  }, []);

  // Open as a modal; its own close (Escape, Close, the backdrop) tells the
  // layer. The listener goes before the cleanup's close, so a remount
  // (StrictMode's rehearsal) reopens rather than reporting a close.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    regionRef.current?.focus({ preventScroll: true });
    const onDialogClose = () => closeRef.current();
    dialog.addEventListener("close", onDialogClose);
    return () => {
      dialog.removeEventListener("close", onDialogClose);
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, []);

  // The files it opened with — once, and after the ticket's own measuring
  // session is live (cancelled by a remount's cleanup, so a rehearsal does
  // not measure them in a session about to be aborted).
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) add(files, via, sample ? { sample } : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [add, files, via, sample]);

  // The view arrives with the ticket's chunk.
  useEffect(() => {
    if (View) return;
    let live = true;
    loadTicketView().then(
      (mod) => live && setLoaded(() => mod.default),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [View]);

  // While it is open it is the page's target, and takes whatever arrives:
  // the ticket says what it cannot use. Never "busy" — a file that lands
  // while a tool is opening is not added (the ticket takes no file then)
  // and the page is about to leave; routed as busy, it would replace this
  // dialog with one saying "these files is still working".
  const target: SheetTarget = {
    name: "these files",
    verb: "add",
    takes: () => true,
  };
  const onFiles = useCallback(
    (more: File[], how: DropVia) => add(more, how),
    [add],
  );
  const note = whyLine(why, files.length);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      data-chunk={TICKET_DIALOG_CHUNK_MARKER}
      data-ticket-dialog=""
      data-motion-ui=""
      // A press on the backdrop (the dialog's own box, outside its body) closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className={cn(
        "bg-panel text-fg border-line shadow-lift m-auto border p-0",
        "max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:border-0",
        "sm:rounded-panel sm:w-[35rem] sm:max-w-[calc(100vw-2rem)]",
        "backdrop:bg-scrim",
        // M7: in 180ms, out 120ms; the backdrop fades with it.
        "opacity-0 open:opacity-100 sm:translate-y-1 sm:open:translate-y-0",
        "motion-safe:transition-[opacity,translate,display,overlay] motion-safe:transition-discrete motion-safe:duration-120 motion-safe:ease-(--ease-snap) motion-safe:open:duration-180",
        "motion-safe:starting:open:opacity-0 motion-safe:sm:starting:open:translate-y-1",
        "backdrop:opacity-0 open:backdrop:opacity-100",
        "motion-safe:backdrop:transition-[opacity,display,overlay] motion-safe:backdrop:transition-discrete motion-safe:backdrop:duration-120 motion-safe:starting:open:backdrop:opacity-0",
      )}
    >
      <DropDesk
        accept=""
        multiple
        onFiles={onFiles}
        pageTarget={target}
        className="data-[armed]:bg-accent/5 flex min-h-full flex-col p-4 sm:p-5"
      >
        {(api) => (
          <>
            {note && (
              <p className="text-muted border-line mb-3 flex items-start gap-2 border-b pb-3 text-xs leading-snug">
                <Info
                  className="text-info mt-px size-3.5 shrink-0"
                  aria-hidden
                />
                <span>{note}</span>
              </p>
            )}
            <section
              ref={regionRef}
              aria-labelledby={headingId}
              tabIndex={-1}
              className="flex flex-1 flex-col outline-none"
            >
              {View && state.phase !== "idle" ? (
                <View
                  state={state}
                  variant="dialog"
                  headingId={headingId}
                  origin={origin}
                  source="dialog"
                  exclude={exclude}
                  pin={why.kind === "stage" ? why.slug : null}
                  onEvent={dispatch}
                  onAddFiles={api.pick}
                  onClear={close}
                />
              ) : (
                <PendingTicket
                  headingId={headingId}
                  names={(state.phase === "idle"
                    ? files
                    : state.entries.map((e) => e.file)
                  ).map((f) => f.name)}
                />
              )}
            </section>
          </>
        )}
      </DropDesk>
    </dialog>,
    document.body,
  );
}
