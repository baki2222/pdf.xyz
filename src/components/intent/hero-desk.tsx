"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FilePlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropDesk,
  DropSheetPick,
  type DropVia,
  type SheetTarget,
} from "@/components/upload/drop-desk";
import type { HandoffOrigin } from "@/lib/handoff/origin";
import { cn } from "@/lib/utils";
import { DESK_ISLAND_MARKER } from "./desk-island-chunk";
import { RecentsSlot } from "./recents-slot";
import { SamplePdfButton } from "./sample-pdf-button";
import { PendingTicket, TicketFrame } from "./ticket-frame";
import {
  loadTicketView,
  loadedTicketView,
  prefetchTicket,
  useTicket,
} from "./use-ticket";
import { ViewTransition } from "@/components/motion/vt";

/** Where the desk's files came from, for the tool page to say. */
const ORIGIN: HandoffOrigin = { kind: "drop", surface: "home" };

type TicketViewComponent = typeof import("./ticket-view").default;

/** Is focus nowhere a person put it — on the body, or on a node now gone? */
function focusOrphaned(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !document.body.contains(active);
}

/**
 * The home page's desk: a sheet to drop or pick files on, and — once files
 * arrive — the job ticket in its place, at the same size.
 *
 * IDLE is server-rendered and works before hydration: "Choose files" is a
 * label around a native file input, the caption under it is generated from
 * the same list as the input's `accept`, and the note under that is the
 * server's own markup (all passed in by the server, so this island imports
 * neither the list nor the catalogue).
 *
 * WAS a working desk on the first screen — a mono "Drop a file · checked in
 * this tab" kicker, the six "Start from a task" links with their mode
 * shapes, and a perforation between them. The owner's brief (2026-10-21)
 * found the home page read as a developer's tool; the tasks became the tool
 * cards under the hero, and the idle desk is now a plain drop area: the
 * button, the drop hint, what it takes, and one sentence on where files go.
 *
 * WITH FILES, the box's content swaps in place (one height, so nothing
 * below moves): the rows land at once, the ticket's chunk is fetched if the
 * approach did not already fetch it, the files are measured in this tab, and
 * the suggestions appear when the facts are in. Nothing is uploaded; a tool
 * opens with the files through a hand-off in this browser.
 *
 * FOCUS. After a pick the control that was used is gone, so focus moves to
 * the ticket (its region is named by its heading); after Clear, back to
 * "Choose files". A drop moves nothing — the outcome is announced.
 */
export function HeroDesk({
  id,
  accept,
  acceptHint,
  note,
}: {
  /** The anchor every "Choose files" link on the page points at. */
  id: string;
  /** The picker's `accept`, generated on the server with the caption. */
  accept: string;
  acceptHint: string;
  /** The server-rendered sentence on where the files go. */
  note: ReactNode;
}) {
  const ticket = useTicket();
  const { state, add, clear, dispatch } = ticket;
  const idle = state.phase === "idle";
  const headingId = useId();
  const deskRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLElement>(null);
  const idleRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<TicketViewComponent | null>(null);
  const View = loaded ?? loadedTicketView()?.default ?? null;

  // Files arrived before the view did: fetch it now.
  useEffect(() => {
    if (idle || View) return;
    let live = true;
    loadTicketView().then(
      (mod) => live && setLoaded(() => mod.default),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [idle, View]);

  const focusPick = useCallback(() => {
    deskRef.current
      ?.querySelector<HTMLElement>('input[type="file"]:not([hidden])')
      ?.focus({ preventScroll: true });
  }, []);

  // A new arrival (or a clear): put focus somewhere real if it was lost —
  // including into the empty desk, which went inert under the ticket (a
  // browser moves focus out of an inert subtree; this does not wait for it).
  const seen = useRef(state.arrival);
  useEffect(() => {
    if (seen.current === state.arrival) return;
    seen.current = state.arrival;
    const stranded =
      state.phase !== "idle" &&
      !!idleRef.current?.contains(document.activeElement);
    if (!stranded && !focusOrphaned()) return;
    if (state.phase === "idle") focusPick();
    else if (state.via !== "drop")
      regionRef.current?.focus({ preventScroll: true });
  }, [state.arrival, state.phase, state.via, focusPick]);

  const onFiles = useCallback(
    (files: File[], via: DropVia) => add(files, via),
    [add],
  );
  // A link to `#id` (the colophon's "Choose files") lands on the control
  // that starts: the picker while the desk is empty, the ticket after.
  // Here, not in the sheet: the desk is the only sheet a link names, and
  // every other page's sheet loaded the listener for nothing.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash !== `#${id}`) return;
      if (idle) focusPick();
      else regionRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [id, idle, focusPick]);
  // The page's drop target: a file released anywhere on the home page lands
  // here, whatever it is — the ticket says what it cannot use. Not while a
  // launch is on its way out.
  const launching = state.phase === "launching";
  const deskTarget = useMemo<SheetTarget>(
    () => ({
      name: "the desk",
      verb: "check",
      canReceive: () => !launching,
      takes: () => true,
    }),
    [launching],
  );
  const onSample = useCallback(
    (file: File) => add([file], "pick", { sample: true }),
    [add],
  );

  return (
    <div
      data-desk-stack=""
      data-island={DESK_ISLAND_MARKER}
      className="relative"
      onPointerEnter={prefetchTicket}
      onFocusCapture={prefetchTicket}
    >
      {/* The stack behind the working sheet: physical presence for the one
          thing on this screen a visitor can use. They fan apart while a file
          is dragged over the page (M2). */}
      <div
        aria-hidden
        data-sheet="back"
        className="border-line bg-panel absolute -top-2.5 right-4 left-4 h-16 border"
      />
      <div
        aria-hidden
        data-sheet="mid"
        className="border-line bg-panel absolute -top-[5px] right-2 left-2 h-16 border"
      />
      <DropDesk
        id={id}
        accept={accept}
        multiple
        pageTarget={deskTarget}
        onFiles={onFiles}
        onIntent={prefetchTicket}
        className="border-line bg-panel shadow-sheet data-[armed]:border-accent flex flex-col border p-4 sm:p-5"
      >
        {(api) => (
          // ONE BOX FOR EVERY STATE. Three layers share one grid cell: the
          // empty desk, an empty ticket frame (`ghost`), and — once files
          // arrive — the ticket. The first two are laid out from the server
          // render on, so the box is as tall as the taller of them before any
          // file arrives; the ticket fills the same frame, whose every slot
          // has a height its content cannot change, so it is exactly that
          // tall whatever was dropped. WAS two layers, the empty desk and the
          // ticket: the box was the taller of the empty desk and a ticket
          // that grew with its content, and moved the page below it by up to
          // 110px (WP-05 review, measured on the served build). No height is
          // typed anywhere: one typed per breakpoint and pointer drifted from
          // the content it was measured on in the first draft.
          <ViewTransition name="work-sheet">
            <div
              ref={deskRef}
              data-desk=""
              className="grid flex-1 grid-cols-[minmax(0,1fr)] *:col-start-1 *:row-start-1"
            >
              <div
                aria-hidden
                inert
                data-desk-ghost=""
                className="invisible flex flex-col"
              >
                <TicketFrame ghost />
              </div>
              <div
                ref={idleRef}
                className={cn(
                  "flex flex-col items-center justify-center text-center",
                  !idle && "invisible",
                )}
                inert={!idle}
                aria-hidden={!idle || undefined}
              >
                <FilePlus
                  className="text-accent size-10"
                  strokeWidth={1.25}
                  aria-hidden
                />
                <DropSheetPick
                  className={buttonVariants({
                    variant: "primary",
                    size: "lg",
                    className: cn(
                      "mt-4 w-full max-w-xs cursor-pointer",
                      "has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                      "motion-safe:active:translate-y-px",
                    ),
                  })}
                >
                  <FilePlus className="size-4" aria-hidden />
                  Choose files
                </DropSheetPick>
                {/* Said only while it is true: from the same value that makes
                  the sheet catch the page's drops. */}
                {api.catchesPageDrops && (
                  <p className="text-muted mt-2 hidden text-center text-xs pointer-fine:block">
                    or drop them anywhere on this page
                  </p>
                )}
                <p
                  id={api.hintId}
                  className="text-muted mt-3 text-xs leading-snug"
                >
                  {acceptHint}
                </p>
                {note}
                <SamplePdfButton className="mt-1" onSample={onSample} />
                <RecentsSlot className="w-full pt-1" />
              </div>
              {!idle && (
                <section
                  ref={regionRef}
                  aria-labelledby={headingId}
                  tabIndex={-1}
                  data-motion-ui=""
                  className="flex flex-col outline-none"
                >
                  {View ? (
                    <View
                      state={state}
                      variant="desk"
                      headingId={headingId}
                      origin={ORIGIN}
                      source="desk"
                      onEvent={dispatch}
                      onAddFiles={api.pick}
                      onClear={clear}
                    />
                  ) : (
                    <PendingTicket
                      headingId={headingId}
                      names={state.entries.map((e) => e.file.name)}
                    />
                  )}
                </section>
              )}
            </div>
          </ViewTransition>
        )}
      </DropDesk>
    </div>
  );
}
