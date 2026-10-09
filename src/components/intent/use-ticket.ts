"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
} from "react";
import type { FileFacts } from "@/lib/intent/facts";
import {
  EMPTY_TICKET,
  MAX_TICKET_FILES,
  ticketReducer,
  type TicketAction,
  type TicketState,
  type TicketVia,
} from "@/lib/intent/ticket";

/**
 * How long a ticket waits for its files' facts before it offers what it
 * knows. A text PDF is measured in tens of milliseconds; a long or locked one
 * may take longer, and a visitor should not watch a placeholder for it. The
 * workspace waits the same (`file-suggestions.tsx`, SETTLE_MS), for the same
 * reason: an offer that changes under the pointer moves the row someone was
 * about to press.
 */
export const TICKET_SETTLE_MS = 1500;

/** PDFs a ticket probes; the rest say they were not checked (spec E.4). */
export const TICKET_PROBES = 5;

/** The ticket's view, fetched on intent and on arrival, never with the page. */
type TicketModule = typeof import("./ticket-view");
let ticketModule: Promise<TicketModule> | null = null;
let ticketModuleLoaded: TicketModule | null = null;

/**
 * Fetch the ticket's chunk — the view, the ranking, the catalogue — once.
 * Fire-and-forget on intent (a drag entering, the pointer or focus reaching
 * the desk), so by the time a file lands the view is usually here already.
 */
export function loadTicketView(): Promise<TicketModule> {
  ticketModule ??= import("./ticket-view").then(
    (mod) => (ticketModuleLoaded = mod),
    (error) => {
      // A failed fetch must not be remembered: the next intent retries.
      ticketModule = null;
      throw error;
    },
  );
  return ticketModule;
}

/**
 * The view, if it has already arrived — so files that land after the
 * approach fetched it render the ticket in the same frame, with no stand-in.
 */
export function loadedTicketView(): TicketModule | null {
  return ticketModuleLoaded;
}

/** Warm the ticket: its view, and the measuring it ships with. */
export function prefetchTicket(): void {
  void loadTicketView().catch(() => {});
}

export interface Ticket {
  readonly state: TicketState;
  readonly dispatch: Dispatch<TicketAction>;
  /** Files arrive: they are listed at once and measured one by one. */
  add(
    files: readonly File[],
    via: TicketVia,
    options?: { readonly sample?: boolean },
  ): void;
  clear(): void;
}

/**
 * A ticket's state and the measuring behind it, for whatever shows it (the
 * home desk; the drop dialog to come).
 *
 * Measuring is the workspace's (`use-workspace.ts`), at a ticket's scale:
 * each file's first bytes, then — for the first {@link TICKET_PROBES} PDFs —
 * the probe; runs are CHAINED, so files added while others are measured
 * wait their turn; clearing aborts what is in flight. The measuring code
 * comes with the ticket's chunk, on first use, so the page that holds a
 * ticket pays nothing for it until a file approaches. Nothing leaves the tab.
 */
export function useTicket(): Ticket {
  const [state, dispatch] = useReducer(ticketReducer, EMPTY_TICKET);
  const held = useRef(0);
  const seq = useRef(0);
  const probed = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const session = useRef(new AbortController());

  const measure = useCallback((entries: { id: string; file: File }[]) => {
    const { signal } = session.current;
    chain.current = chain.current.then(async () => {
      if (signal.aborted) return;
      try {
        const { measureFacts, quickFacts } = await loadTicketView();
        if (signal.aborted) return;
        const quick: FileFacts[] = entries.map(({ id, file }) =>
          quickFacts(file, id),
        );
        for (const facts of quick) dispatch({ type: "facts", facts });
        const blobs = new Map(entries.map((e) => [e.id, e.file]));
        const final = await measureFacts(
          quick,
          (id) => blobs.get(id),
          (facts) => {
            if (!signal.aborted) dispatch({ type: "facts", facts });
          },
          {
            maxProbes: Math.max(0, TICKET_PROBES - probed.current),
            signal,
          },
        );
        probed.current += final.filter(
          (f) => f.pdf?.state === "checked",
        ).length;
      } catch {
        // Measuring is an enhancement: a file that could not be read keeps
        // what its name says, and the ticket settles on its timer.
      }
    });
  }, []);

  const add = useCallback<Ticket["add"]>(
    (files, via, options) => {
      if (files.length === 0) return;
      const entries = files.map((file) => ({
        id: `t${(seq.current += 1)}`,
        file,
        sample: options?.sample === true,
      }));
      const room = Math.max(0, MAX_TICKET_FILES - held.current);
      held.current += Math.min(room, entries.length);
      dispatch({ type: "add", files: entries, via });
      measure(entries.slice(0, room));
    },
    [measure],
  );

  const clear = useCallback(() => {
    session.current.abort();
    session.current = new AbortController();
    held.current = 0;
    probed.current = 0;
    dispatch({ type: "clear" });
  }, []);

  // Offer what is known once the facts have had their time.
  useEffect(() => {
    if (state.phase !== "checking") return;
    const arrival = state.arrival;
    const timer = setTimeout(
      () => dispatch({ type: "settle", arrival }),
      TICKET_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [state.phase, state.arrival]);

  // Unmounted: whatever is still being measured is no one's. (A remount —
  // StrictMode's rehearsal — starts a fresh session rather than a dead one.)
  useEffect(() => {
    const live = session;
    if (live.current.signal.aborted) live.current = new AbortController();
    return () => live.current.abort();
  }, []);

  return { state, dispatch, add, clear };
}
