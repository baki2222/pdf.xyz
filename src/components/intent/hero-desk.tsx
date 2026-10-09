"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FilePlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropSheet,
  DropSheetPick,
  type DropVia,
} from "@/components/upload/drop-sheet";
import type { HandoffOrigin } from "@/lib/handoff/origin";
import { cn } from "@/lib/utils";
import { DESK_ISLAND_MARKER } from "./desk-island-chunk";
import { RecentsSlot } from "./recents-slot";
import { SamplePdfButton } from "./sample-pdf-button";
import {
  loadTicketView,
  loadedTicketView,
  prefetchTicket,
  useTicket,
} from "./use-ticket";

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
 * the same list as the input's `accept` (both passed in by the server, so
 * this island imports neither the list nor the catalogue), and the six task
 * links are the server's own markup, passed through.
 *
 * WITH FILES, the box's content swaps in place (fixed height, so nothing
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
  tasks,
}: {
  /** The anchor every "Choose files" link on the page points at. */
  id: string;
  /** The picker's `accept`, generated on the server with the caption. */
  accept: string;
  acceptHint: string;
  /** The server-rendered task list, label included. */
  tasks: ReactNode;
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
  const onHashTarget = useCallback(() => {
    if (state.phase === "idle") focusPick();
    else regionRef.current?.focus({ preventScroll: true });
  }, [state.phase, focusPick]);
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
      <DropSheet
        variant="desk"
        id={id}
        accept={accept}
        multiple
        catchPageDrops
        onFiles={onFiles}
        onIntent={prefetchTicket}
        onHashTarget={onHashTarget}
        className="border-line bg-panel shadow-sheet data-[armed]:border-accent flex flex-col border p-4 sm:p-5"
      >
        {(api) => (
          // ONE BOX FOR BOTH STATES. The empty desk stays laid out under the
          // ticket — invisible, inert, and out of the accessibility tree —
          // in the same grid cell, so the box is as tall as the taller of the
          // two and the swap changes what is drawn, not the height. No height
          // is typed anywhere: one typed per breakpoint and pointer drifted
          // from the content it was measured on in the first draft.
          <div
            ref={deskRef}
            data-desk=""
            className="grid flex-1 grid-cols-[minmax(0,1fr)] *:col-start-1 *:row-start-1"
          >
            <div
              ref={idleRef}
              className={cn("flex flex-col", !idle && "invisible")}
              inert={!idle}
              aria-hidden={!idle || undefined}
            >
              <p className="kicker text-faint">
                Drop a file<span aria-hidden> · </span>
                <span className="sr-only">, </span>checked in this tab
              </p>
              <DropSheetPick
                className={buttonVariants({
                  variant: "primary",
                  size: "lg",
                  className: cn(
                    "mt-3 w-full cursor-pointer",
                    "has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                    "motion-safe:active:translate-y-px",
                  ),
                })}
              >
                <FilePlus className="size-4" aria-hidden />
                Choose files
              </DropSheetPick>
              <p className="text-muted mt-2 hidden text-center text-xs pointer-fine:block">
                or drop them anywhere on this page
              </p>
              <p
                id={api.hintId}
                className="text-muted mt-3 text-xs leading-snug"
              >
                {acceptHint}
              </p>
              <p className="text-muted mt-1.5 flex gap-2 text-xs leading-snug text-pretty">
                <span
                  aria-hidden
                  className="bg-ok mt-[0.3rem] size-1.5 shrink-0 rounded-full"
                />
                <span>
                  Your files stay in this browser until you start a step marked
                  Secure worker or AI.
                </span>
              </p>
              <SamplePdfButton className="mt-1" onSample={onSample} />
              <div aria-hidden className="perforation my-2.5" />
              {tasks}
              <RecentsSlot className="mt-auto pt-1" />
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
        )}
      </DropSheet>
    </div>
  );
}

/**
 * The ticket while its chunk is still on the way (an arrival with no
 * approach to warn of it — a pick made before the page hydrated, say): the
 * same heading, so the region is named, and the files' names at once.
 */
function PendingTicket({
  headingId,
  names,
}: {
  headingId: string;
  names: readonly string[];
}) {
  return (
    <div aria-busy="true" className="flex flex-col">
      <p className="kicker text-faint">Job ticket</p>
      <h2
        id={headingId}
        className="font-display text-fg mt-1.5 text-lg leading-snug font-semibold tracking-tight"
      >
        What you can do with these files
      </h2>
      <ul className="mt-3 flex flex-col">
        {names.slice(0, 3).map((name, i) => (
          <li key={`${i}-${name}`} className="text-fg h-6 truncate text-[13px]">
            {name}
          </li>
        ))}
      </ul>
      <span className="sr-only">Checking your files…</span>
    </div>
  );
}
