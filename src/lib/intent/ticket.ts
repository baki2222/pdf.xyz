/**
 * The job ticket's state: the files a visitor brought to the desk (or to the
 * ticket dialog), what this tab has measured of each, and where the ticket is
 * in its short life — `idle → checking → ready → launching`.
 *
 * Pure, and free of the catalogue and of every engine: the desk that owns it
 * is in the home page's first load, so this module may import TYPES only.
 * What the files are is measured elsewhere (`./facts`, loaded on demand) and
 * arrives here as `facts` actions; what to offer for them is the ranking's,
 * inside the lazy ticket chunk.
 *
 * CHECKING → READY. The ticket waits for its files' facts before it offers
 * anything, so the first suggestion is the one the facts justify and not the
 * one the names alone suggested — a scan's OCR PDF arriving a moment later
 * would otherwise replace the row under the pointer. It waits until every
 * file is measured, or until the owner says it has waited long enough
 * (`settle`), whichever is first; the workspace learned the same rule the
 * hard way (`file-suggestions.tsx`, SETTLE_MS).
 */
import type { FileFacts } from "./facts";

/**
 * Files a ticket measures and ranks. More can arrive: they are kept, so
 * "Open in workspace" still carries every one, but past this the ticket's
 * rows would be a list nobody reads, and the workspace is the better place.
 */
export const MAX_TICKET_FILES = 20;

export type TicketPhase = "idle" | "checking" | "ready" | "launching";

/** How files reached the ticket — it decides where focus may go. */
export type TicketVia = "pick" | "drop" | "paste" | "early" | "header";

export interface TicketEntry {
  readonly id: string;
  readonly file: File;
  /** What this tab knows of it; null until the facts module has read it. */
  readonly facts: FileFacts | null;
  /** pdf.xyz's sample PDF, not a file the visitor brought. */
  readonly sample: boolean;
}

export interface TicketState {
  readonly phase: TicketPhase;
  readonly entries: readonly TicketEntry[];
  /** Files past {@link MAX_TICKET_FILES}: kept for the workspace, not ranked. */
  readonly overflow: readonly File[];
  /** How the latest files arrived. */
  readonly via: TicketVia | null;
  /** Counts arrivals, so an owner can tell a new batch from a re-render. */
  readonly arrival: number;
  /** Every file measured, or the owner stopped waiting: offers may show. */
  readonly settled: boolean;
  /** Where a launch is going (a tool slug, or "workspace"), while it is. */
  readonly launching: string | null;
  /** A launch whose files could not be stored: said, with a plain way on. */
  readonly failed: { readonly target: string } | null;
}

export type TicketAction =
  | {
      readonly type: "add";
      readonly files: readonly {
        readonly id: string;
        readonly file: File;
        readonly sample?: boolean;
      }[];
      readonly via: TicketVia;
    }
  | { readonly type: "facts"; readonly facts: FileFacts }
  /** The owner waited long enough for facts: offer what is known. */
  | { readonly type: "settle"; readonly arrival: number }
  | { readonly type: "launch"; readonly target: string }
  | {
      readonly type: "launched";
      readonly target: string;
      readonly result: "carried" | "plain" | "cancelled" | "failed";
    }
  | { readonly type: "clear" };

export const EMPTY_TICKET: TicketState = {
  phase: "idle",
  entries: [],
  overflow: [],
  via: null,
  arrival: 0,
  settled: false,
  launching: null,
  failed: null,
};

/**
 * Whether a file's facts are as complete as this tab will make them: its
 * first bytes read (or contradicted), and a PDF's probe done or declined.
 */
export function isMeasured(facts: FileFacts | null): boolean {
  if (!facts) return false;
  if (facts.bytes === undefined && !facts.contradicted) return false;
  return facts.pdf?.state !== "pending";
}

const allMeasured = (entries: readonly TicketEntry[]) =>
  entries.every((e) => isMeasured(e.facts));

export function ticketReducer(
  state: TicketState,
  action: TicketAction,
): TicketState {
  switch (action.type) {
    case "add": {
      if (action.files.length === 0 || state.phase === "launching")
        return state;
      const room = Math.max(0, MAX_TICKET_FILES - state.entries.length);
      const kept = action.files.slice(0, room).map((f) => ({
        id: f.id,
        file: f.file,
        facts: null,
        sample: f.sample === true,
      }));
      return {
        ...state,
        phase: "checking",
        entries: [...state.entries, ...kept],
        overflow: [
          ...state.overflow,
          ...action.files.slice(room).map((f) => f.file),
        ],
        via: action.via,
        arrival: state.arrival + 1,
        settled: false,
        failed: null,
      };
    }
    case "facts": {
      const at = state.entries.findIndex((e) => e.id === action.facts.id);
      if (at < 0) return state;
      const entries = state.entries.map((e, i) =>
        i === at ? { ...e, facts: action.facts } : e,
      );
      const settled = state.settled || allMeasured(entries);
      const phase =
        state.phase === "checking" && settled ? "ready" : state.phase;
      return { ...state, entries, settled, phase };
    }
    case "settle":
      if (action.arrival !== state.arrival || state.settled) return state;
      return {
        ...state,
        settled: true,
        phase: state.phase === "checking" ? "ready" : state.phase,
      };
    case "launch":
      // From "checking" too: Open in workspace needs no facts.
      if (
        (state.phase !== "ready" && state.phase !== "checking") ||
        state.launching !== null
      )
        return state;
      return {
        ...state,
        phase: "launching",
        launching: action.target,
        failed: null,
      };
    case "launched": {
      if (state.launching !== action.target) return state;
      // Carried or plain: the page is navigating away, and stays busy until
      // it has gone.
      if (action.result === "carried" || action.result === "plain")
        return state;
      return {
        ...state,
        phase: state.settled ? "ready" : "checking",
        launching: null,
        failed: action.result === "failed" ? { target: action.target } : null,
      };
    }
    case "clear":
      return { ...EMPTY_TICKET, arrival: state.arrival + 1 };
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

/** Every file the ticket holds, ranked or not — what the workspace receives. */
export function ticketFiles(state: TicketState): File[] {
  return [...state.entries.map((e) => e.file), ...state.overflow];
}
