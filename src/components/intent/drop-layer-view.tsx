"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { DropVia, Route, Unrouted } from "@/lib/intent/page-target";

/**
 * The registry, for the layer: it arrives with this chunk rather than in the
 * layout's, which every drop sheet's page would then download twice (see
 * `./drop-layer`).
 */
export {
  deliverFiles,
  registerFallback,
  routeFor,
} from "@/lib/intent/page-target";
import { cn } from "@/lib/utils";

/**
 * What the drop layer draws — the veil while a file is held over the page,
 * and the ticket dialog for files the page's target does not take — in a
 * chunk of its own. The layer (`./drop-layer`) is in every page's first
 * load and keeps only what must answer at once: the listeners, the routing,
 * the picker. This arrives on idle after the page loads, or with the first
 * drag, and with it the words and the geometry.
 */

/** A drag over the page, as the layer saw it. */
export interface DragState {
  readonly open: boolean;
  /** Where a release goes now (routed from what the drag describes). */
  readonly route: Route;
  /** Files the browser said the drag carries; 0 where it does not say. */
  readonly count: number;
  /** The box a release lands in: the target's, or a zone under the pointer. */
  readonly landing: Element | null;
  /** A zone that takes its own drops is under the pointer: no words. */
  readonly local: boolean;
}

/** Files on their way to the ticket dialog. */
export interface DropTicket {
  readonly key: number;
  readonly files: File[];
  readonly via: DropVia;
  readonly why: Unrouted;
}

/** "this file", "2 files", or — where the browser does not say — "these files". */
function filesWord(count: number): string {
  if (count === 1) return "this file";
  return count > 1 ? `${count} files` : "these files";
}

/** Where the page's privacy line is said once more, at the moment of release. */
const STAYS =
  "Stays in this browser until you start a step marked Secure worker or AI.";

/** What the veil says a release will do — the route, put in words. */
export function veilWords(
  route: Route,
  count: number,
): { readonly main: string; readonly sub: string } {
  const files = filesWord(count);
  if (route.to === "target") {
    const { name, verb, current } = route.target;
    const what = count > 1 ? ` ${count} files` : "";
    switch (verb) {
      case "add":
        return { main: `Release to add${what} to ${name}`, sub: STAYS };
      case "open":
        return { main: `Release to open in ${name}`, sub: STAYS };
      case "replace":
        return {
          main: `Release to replace ${current ?? "the file"} in ${name}`,
          sub: STAYS,
        };
      case "check":
        return { main: `Release to check ${files}`, sub: STAYS };
      default: {
        const unhandled: never = verb;
        return unhandled;
      }
    }
  }
  const { why } = route;
  switch (why.kind) {
    case "none":
      return { main: `Release to see what opens ${files}`, sub: STAYS };
    case "busy":
      return {
        main: `${why.name} is working on a file`,
        sub: "Release to see what else opens yours",
      };
    case "refused":
      return {
        main: `${why.name} can't open ${count > 1 ? "these files" : files}`,
        sub: "Release to see what can",
      };
    default: {
      const unhandled: never = why;
      return unhandled;
    }
  }
}

interface Hole {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** The box a release lands in, padded, while any of it is on screen. */
function holeAround(element: Element | null): Hole | null {
  if (!element || !element.isConnected) return null;
  const r = element.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  if (r.bottom <= 0 || r.top >= window.innerHeight) return null;
  const pad = 10;
  return {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

type DialogModule = typeof import("./ticket-dialog");
let dialogModule: Promise<DialogModule> | null = null;

/** The ticket dialog's chunk, fetched once — on a drag no target will take, or on use. */
export function loadDialog(): Promise<DialogModule> {
  dialogModule ??= import("./ticket-dialog").catch((error) => {
    // A failed fetch is not remembered: the next drag retries.
    dialogModule = null;
    throw error;
  });
  return dialogModule;
}

export default function DropLayerView({
  drag,
  ticket,
  exclude,
  onClose,
  onUnreachable,
}: {
  readonly drag: DragState | null;
  readonly ticket: DropTicket | null;
  /** The tool page it is on, never offered back to itself. */
  readonly exclude: string | null;
  readonly onClose: () => void;
  /** The dialog's chunk could not be fetched: the layer says so. */
  readonly onUnreachable: () => void;
}) {
  return (
    <>
      {drag && <VeilView drag={drag} />}
      {ticket && (
        <TicketHost
          key={ticket.key}
          ticket={ticket}
          exclude={exclude}
          onClose={onClose}
          onUnreachable={onUnreachable}
        />
      )}
    </>
  );
}

/**
 * The veil: the page dimmed except the box a release lands in, and one
 * sentence saying what a release does there. Never read out (`aria-hidden`)
 * — a drag is a pointer gesture, and what it did is announced by whatever
 * receives the file — and never in the pointer's way. The box follows the
 * page as it scrolls under the drag.
 */
function VeilView({ drag }: { drag: DragState }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!drag.open) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((n) => n + 1));
    };
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [drag.open]);

  const hole = holeAround(drag.landing);
  // A drop sheet draws its own armed marks; anything else that catches the
  // file (an open editor) gets them on the clear box, so every landing
  // place reads the same way: a sheet, its corners reaching out.
  const sheet = drag.landing?.hasAttribute("data-drop-sheet") ?? false;
  const words = drag.local ? null : veilWords(drag.route, drag.count);
  // The sentence sits under the clear box when there is room, over it when
  // there is not (anchored by its foot, so its height is never guessed
  // into the gap), and in the middle of the page when there is no box.
  const room = 96;
  const vh = window.innerHeight;
  const below = hole ? hole.top + hole.height + 12 : 0;
  const place: CSSProperties | undefined = hole
    ? below + room < vh
      ? { top: below }
      : hole.top - 12 - room > 0
        ? { bottom: vh - hole.top + 12 }
        : { bottom: 24 }
    : undefined;
  return (
    <div
      aria-hidden
      data-drop-veil=""
      data-open={drag.open || undefined}
      className={cn(
        "pointer-events-none fixed inset-0 z-[80]",
        "hidden opacity-0 data-[open]:block data-[open]:opacity-100",
        "motion-safe:transition-[opacity,display] motion-safe:transition-discrete motion-safe:duration-90 motion-safe:data-[open]:duration-120 motion-safe:starting:data-[open]:opacity-0",
      )}
    >
      {hole ? (
        <div
          data-drop-veil-hole=""
          data-armed={sheet ? undefined : ""}
          className={cn(
            "absolute shadow-[0_0_0_200vmax_var(--sf-scrim)] motion-safe:transition-[top,left,width,height] motion-safe:duration-150 motion-safe:ease-(--ease-snap)",
            !sheet && "crop-marks",
          )}
          style={hole}
        />
      ) : (
        <div className="bg-scrim absolute inset-0" />
      )}
      {words && (
        <div
          className={cn(
            // Its own scrim: invisible where it sits on the dimmed page, and
            // legible where it has to sit over the clear box.
            "bg-scrim rounded-panel absolute inset-x-4 mx-auto flex max-w-md flex-col items-center gap-1 px-5 py-3 text-center",
            !place && "top-1/2 -translate-y-1/2",
          )}
          style={place}
        >
          <p className="font-display text-fg text-xl leading-snug font-semibold tracking-tight text-balance wrap-anywhere">
            {words.main}
          </p>
          <p className="text-muted text-sm text-balance">{words.sub}</p>
        </div>
      )}
    </div>
  );
}

/** The ticket dialog, once its chunk is here. */
function TicketHost({
  ticket,
  exclude,
  onClose,
  onUnreachable,
}: {
  ticket: DropTicket;
  exclude: string | null;
  onClose: () => void;
  onUnreachable: () => void;
}) {
  const [Dialog, setDialog] = useState<DialogModule["default"] | null>(null);
  useEffect(() => {
    let live = true;
    loadDialog().then(
      (mod) => live && setDialog(() => mod.default),
      // Offline, or a deploy replaced the chunk: the files went nowhere,
      // and the page says so rather than nothing.
      () => live && onUnreachable(),
    );
    return () => {
      live = false;
    };
  }, [onUnreachable]);
  if (!Dialog) return null;
  return (
    <Dialog
      files={ticket.files}
      via={ticket.via}
      why={ticket.why}
      exclude={exclude}
      onClose={onClose}
    />
  );
}
