"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import {
  DropDesk,
  DropSheetPick,
  type DropVia,
  type SheetTarget,
} from "@/components/upload/drop-desk";
import { faceClass, SheetFace } from "@/components/upload/drop-sheet-face";
import { takesByAccept } from "@/lib/intent/accept-match";
import type { LaunchRouter } from "@/lib/intent/launch";
import { GUIDE_DESK_STATUS_CLASS, guideDeskTitle } from "./guide-desk-words";

const noSubscription = () => () => {};

/**
 * The App Router, caught for the launch. Mounted only once the page is live:
 * the router is needed only when a file arrives, and the desk itself renders
 * wherever the guide does — including where there is no router to ask for
 * (a static render of the page, as its tests make).
 */
function RouterInto({
  onRouter,
}: {
  onRouter: (router: LaunchRouter) => void;
}) {
  const router = useRouter();
  useEffect(() => onRouter(router), [router, onRouter]);
  return null;
}

export interface GuideDeskProps {
  /** The guide's primary tool. */
  readonly tool: { readonly slug: string; readonly name: string };
  /**
   * What a hand-off brings it, from its live runner (`handoffCapabilityFor`
   * on the server): one file, several, or — a tool with no in-browser
   * runner — none, when the desk shows the tools that open the file instead
   * of promising to open it here.
   */
  readonly opens: "one" | "many" | null;
  /** The files it takes (`acceptNoun`): "a PDF" / "PDFs", "a JPG or PNG image". */
  readonly noun: { readonly one: string; readonly many: string };
  /** The picker's `accept`, from the same `accept` row. */
  readonly accept: string;
  /** `stagingHint(tool)`: what it accepts and the cap it refuses above. */
  readonly hint: string;
  /** Files picked in the shell before this desk arrived (`GuideDeskSlot`). */
  readonly early?: readonly File[];
  /** Focus was on the shell's picker: it goes to this desk's. */
  readonly refocus?: boolean;
}

type DeskState =
  | { readonly phase: "idle" }
  | { readonly phase: "launching" | "failed"; readonly count: number };

/** "your file", "your 2 files" — what is on its way, counted. */
const yours = (count: number) =>
  count === 1 ? "your file" : `your ${count} files`;

/**
 * A guide's own drop sheet: the file the guide teaches about goes straight
 * into the tool it teaches, already loaded — "drop on the guide, the tool
 * opens with it" (redesign G.7, "Guide: merge").
 *
 * The guide page's drop target (a file dropped or pasted anywhere on the
 * article lands here). NOT in the guide's first load: the server draws its
 * shell (`./guide-desk-shell`, whose picker works before any code arrives)
 * and `./guide-desk-slot` fetches this as the page mounts, swaps it in, and
 * hands it what was picked meanwhile (`early`). It holds no catalogue —
 * everything about the tool arrives as props, and the hand-off code is
 * fetched when a file does.
 *
 * WHAT IT PROMISES is decided by the tool's runner, not by the guide: a
 * tool with no in-browser runner (PDF to Word, OCR, Protect, Translate,
 * Repair, Unlock) cannot be handed a file, so its desk says "see which
 * tools open it" and opens the ticket dialog — with that tool FIRST, as the
 * row that says the file is added there (`stage`), never "open PDF to Word
 * with it". WAS: the dialog ranked it like any other tool, about 26th of
 * 42 under "More", below Compress, Sign and Edit (WP-07 review).
 *
 * WHAT IT TAKES is what the tool takes: its `accept`, the sheet's default.
 * WAS `takes: () => true` on every desk — so a JPG held over the Merge PDF
 * guide was routed to the desk, the veil said "Release to open in Merge
 * PDF", and the release opened the dialog saying "Merge PDF can't open it."
 * (WP-07 review). Only the desk of a tool with no runner takes everything:
 * it opens nothing itself, and checks whatever arrives. A file that passes
 * the `accept` is read once more through the hand-off's own gate
 * (`eligibleFilesFor`), the one a launch passes, so the desk cannot
 * disagree with it.
 *
 * WHAT IT SAYS while a launch is on its way, and if it fails, sits in ONE
 * slot that is always there at a fixed height, counted ("with your 2
 * files"). WAS a paragraph mounted with the launch: it grew the desk by
 * 24px and moved everything under it (CLS 0.0167 at 390, measured by the
 * WP-07 review), and a live region mounted already holding its words is
 * one several screen readers never read.
 */
export function GuideDesk({
  tool,
  opens,
  noun,
  accept,
  hint,
  early,
  refocus,
}: GuideDeskProps) {
  const live = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const router = useRef<LaunchRouter | null>(null);
  const keepRouter = useCallback((r: LaunchRouter) => {
    router.current = r;
  }, []);
  const [state, setState] = useState<DeskState>({ phase: "idle" });
  const takes = useMemo(() => takesByAccept(accept), [accept]);

  const onFiles = useCallback(
    (files: File[], via: DropVia) => {
      // Counted now, from the same `accept` the sheet took them by; the
      // hand-off's gate has the last word (`onCount`).
      if (opens !== null)
        setState({
          phase: "launching",
          count: opens === "one" ? 1 : Math.max(1, files.filter(takes).length),
        });
      import("./guide-desk-carry")
        .then(({ carryToGuideTool }) =>
          carryToGuideTool({
            files,
            via,
            tool,
            opens,
            router: router.current,
            onCount: (count) => setState({ phase: "launching", count }),
          }),
        )
        .then(
          (result) =>
            setState((s) =>
              result === "failed" && s.phase !== "idle"
                ? { phase: "failed", count: s.count }
                : { phase: "idle" },
            ),
          // Offline, or a deploy replaced the chunk.
          () =>
            setState((s) =>
              s.phase === "idle" ? s : { phase: "failed", count: s.count },
            ),
        );
    },
    [opens, takes, tool],
  );

  const title = guideDeskTitle({ tool, opens, noun });

  // Arrived over the server's shell (`GuideDeskSlot`): what was picked there
  // is this desk's, and focus that was on its picker is on this one — once.
  const root = useRef<HTMLDivElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if (refocus)
      root.current
        ?.querySelector<HTMLElement>('input[type="file"]:not([hidden])')
        ?.focus({ preventScroll: true });
    // As an arrival, not in this render's effect pass.
    if (early && early.length > 0)
      queueMicrotask(() => onFiles([...early], "early"));
  }, [early, refocus, onFiles]);

  // The page's target. A desk whose tool opens files takes what the tool
  // takes (the sheet's `accept`); one whose tool opens none checks anything.
  const launching = state.phase === "launching";
  const target = useMemo<SheetTarget>(
    () =>
      opens
        ? { name: tool.name, verb: "open", canReceive: () => !launching }
        : {
            name: tool.name,
            verb: "check",
            canReceive: () => !launching,
            takes: () => true,
          },
    [opens, tool.name, launching],
  );

  const them = state.phase !== "idle" && state.count !== 1 ? "them" : "it";
  return (
    <div ref={root} className="flex w-full flex-col gap-2" data-guide-desk="">
      {live && <RouterInto onRouter={keepRouter} />}
      {/* The compact sheet as a desk whose body is the sheet's own face —
          the shell's markup to the pixel (`drop-sheet-shell.test.tsx`), and
          `./drop-sheet` stays the tool pages' alone, where the bundler
          folds it into the runner kit's scope (WP-07 re-review). */}
      <DropDesk
        accept={accept}
        multiple={opens !== "one"}
        onFiles={onFiles}
        pageTarget={target}
        variant="compact"
        className="w-full"
      >
        {(api) => (
          <DropSheetPick className={faceClass("compact")}>
            <SheetFace
              variant="compact"
              title={title}
              browse
              hint={hint}
              hintId={api.hintId}
            />
          </DropSheetPick>
        )}
      </DropDesk>
      {/* Always here, at the height of its longest sentence (two lines of
          the failure at 360px), so what it says never moves the page. */}
      <p
        role="status"
        data-slot="guide-desk-status"
        className={GUIDE_DESK_STATUS_CLASS}
      >
        {state.phase === "launching" &&
          `Opening ${tool.name} with ${yours(state.count)}…`}
        {state.phase === "failed" && (
          <>
            <span aria-hidden className="text-warn font-semibold">
              !{" "}
            </span>
            Couldn&apos;t carry {yours(state.count)} here —{" "}
            <a
              href={`/tools/${tool.slug}`}
              className="text-fg underline underline-offset-4"
            >
              open {tool.name}
            </a>{" "}
            and add {them} there.
          </>
        )}
      </p>
    </div>
  );
}
