"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { DropVia, PageTarget, Route } from "@/lib/intent/page-target";
import type { DragState, DropTicket } from "./drop-layer-view";

/*
 * NOTHING HERE IS IMPORTED AT RUN TIME BUT REACT AND NEXT. This module is in
 * the root layout's chunk, and a module the layout shares with a page's own
 * chunks is downloaded twice on that page (`first-load-duplicates.test.ts`):
 * the registry (`@/lib/intent/page-target`) is every drop sheet's too, so
 * the layer takes it from its lazily loaded view (`./drop-layer-view`, which
 * re-exports it) — on idle, or with the first file — and the types above
 * erase. The one thing it must answer synchronously, whether a drag carries
 * files, is `carriesFiles` below, held to the registry's by a test.
 */

type Engine = typeof import("./drop-layer-view");
let engineModule: Promise<Engine> | null = null;

/** The registry, the veil and the dialog's host — fetched once. */
function loadEngine(): Promise<Engine> {
  engineModule ??= import("./drop-layer-view").catch((error) => {
    // A failed fetch is not remembered: the next file retries.
    engineModule = null;
    throw error;
  });
  return engineModule;
}

/**
 * Does this drag carry files (not text, not a link)? The layer's own copy of
 * the registry's `carriesFiles` — asked on every `dragover`, before the
 * registry may have arrived; `drop-layer.test.tsx` holds the two to one
 * answer over every shape.
 */
export function carriesFiles(event: {
  dataTransfer: Pick<DataTransfer, "types" | "files"> | null;
}): boolean {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  if (transfer.types && Array.from(transfer.types).includes("Files"))
    return true;
  return (transfer.files?.length ?? 0) > 0;
}

/** What a drag says about its files before release (Chromium: their types). */
function describeDrag(transfer: DataTransfer | null) {
  if (!transfer?.items) return [];
  return Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => ({ name: "", type: item.type }));
}

/** The tool page a file was dropped on, from its route — never offered back to itself. */
function toolOfPath(path: string | null): string | null {
  const match = /^\/tools\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(path ?? "");
  return match && match[1] !== "category" ? match[1]! : null;
}

/**
 * The picker of last resort: a file input made on demand, at the end of
 * <body>, never a tab stop and never announced — the control that asked
 * for it is. Its files are routed like a drop.
 */
function makePicker(onFiles: (files: File[]) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.hidden = true;
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    onFiles(files);
  });
  document.body.append(input);
  return input;
}

/** Input types a paste is typed into; every other input is a control. */
const TEXT_INPUTS =
  /^(?:text|search|url|tel|email|password|number|date|datetime-local|month|time|week)$/;

/** Is a paste meant for a field (a text input, a textarea, an editable region)? */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement)
    return true;
  return target instanceof HTMLInputElement && TEXT_INPUTS.test(target.type);
}

/**
 * Drop and paste anywhere: no file that lands on a pdf.xyz page is opened by
 * the browser in the tab, and none lands where it cannot be used.
 *
 * Mounted once, in the root layout, after the footer. While a drag carrying
 * FILES is over the window (depth-counted, so crossing elements does not
 * flicker it; a drag of text or a link is ignored) it marks the page —
 * `html[data-dragging]`, the page's target armed — and shows the VEIL: the
 * page dimmed except the box the file will land in, and one sentence saying
 * what a release does there ("Release to add 2 files to Merge PDF"). A
 * release no zone on the page claimed for itself (`defaultPrevented`) goes
 * where `@/lib/intent/page-target` routes it: the page's target, or — no
 * target, a target at work, a target that opens none of the files — the
 * ticket dialog, which says what does open them. A paste of files outside a
 * text field is routed the same way. Over a zone that takes its own drops
 * (Sign PDF's signature image) the veil clears that zone instead, and says
 * nothing: the zone's own highlight is what a release there does.
 *
 * It is also the page's picker of last resort (`requestFilePick`): an input
 * made at the moment it is asked for and appended to the end of `<body>`,
 * whose files are routed like a drop. Not rendered with the page: React 19
 * reveals a prerendered page's content a moment after the shell hydrates,
 * and in that moment a layer input already in the DOM was the page's FIRST
 * file input — a pick meant for the workspace's sheet went to the dialog
 * (e2e/workspace.spec.ts, caught on this package's first run).
 *
 * COST. In every page's first load, so it is only what must answer at once:
 * the listeners, accepting the drag, and holding on to what was dropped.
 * Where files go and what is drawn — the registry, the veil, the dialog's
 * host — arrive on idle (so the first drag finds them here) or with the
 * first file; the dialog, the ticket and the catalogue only with files that
 * need them.
 */
export function DropLayer() {
  const path = usePathname();
  const picker = useRef<HTMLInputElement | null>(null);
  const [View, setView] = useState<Engine["default"] | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ticket, setTicket] = useState<DropTicket | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  // A ticket belongs to the page it was opened on: a launch navigates, and
  // the dialog closes — and stays closed when Back returns to that page.
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) {
    setSeenPath(path);
    setTicket(null);
  }

  const close = useCallback(() => setTicket(null), []);
  const lost = useCallback(() => setUnreachable(true), []);

  // The engine, once: loaded on idle or by the first file, and on arrival
  // registered as the page's fallback — the dialog, and the picker of last
  // resort. `engine()` resolves only after that registration.
  const ready = useRef<Promise<Engine> | null>(null);
  const unregister = useRef<(() => void) | null>(null);
  const engine = useCallback((): Promise<Engine> => {
    ready.current ??= loadEngine().then(
      (mod) => {
        let seq = 0;
        unregister.current = mod.registerFallback({
          receive(files, via, why) {
            seq += 1;
            setUnreachable(false);
            setTicket({ key: seq, files, via, why });
          },
          pick() {
            picker.current ??= makePicker((files) =>
              mod.deliverFiles(files, "header"),
            );
            picker.current.click();
          },
        });
        setView(() => mod.default);
        return mod;
      },
      (error: unknown) => {
        // Not said here: a fetch on idle failing is nobody's business until
        // a file needs it (`deliver`, below).
        ready.current = null;
        throw error;
      },
    );
    return ready.current;
  }, []);

  // Leaving takes everything the layer put on the page with it: its place
  // as the fallback, and the picker it appended to <body>.
  useEffect(
    () => () => {
      unregister.current?.();
      unregister.current = null;
      ready.current = null;
      picker.current?.remove();
      picker.current = null;
    },
    [],
  );

  // Fetch it while the page is idle, so the first drag draws at once.
  useEffect(() => {
    const warm = () => void engine().catch(() => {});
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(timer);
  }, [engine]);

  // Files that landed: where they go is the registry's, as soon as it is here.
  const deliver = useCallback(
    (files: File[], via: DropVia) => {
      if (files.length === 0) return;
      setUnreachable(false);
      void engine().then(
        (mod) => mod.deliverFiles(files, via),
        // Offline, or a deploy replaced the chunk: the files went nowhere,
        // and the page says so rather than nothing.
        () => setUnreachable(true),
      );
    },
    [engine],
  );

  // The page's drags, drops and pastes.
  useEffect(() => {
    const html = document.documentElement;
    let depth = 0;
    let count = 0;
    let kinds: { name: string; type: string }[] = [];
    let route: Route | null = null;
    let armed: PageTarget | null = null;
    let local: Element | null = null;

    const show = () => {
      if (!route || depth === 0) return;
      const target = route.to === "target" ? route.target : null;
      setDrag({
        open: true,
        route,
        count,
        landing: local ?? target?.element() ?? null,
        local: local !== null,
      });
    };
    const start = (transfer: DataTransfer | null) => {
      kinds = describeDrag(transfer);
      count = kinds.length;
      html.setAttribute("data-dragging", "");
      void engine().then(
        (mod) => {
          if (depth === 0) return;
          route = mod.routeFor(kinds);
          if (route.to === "target") {
            armed = route.target;
            armed.arm(true);
          } else {
            // The dialog is where this is going: fetch it while the hand moves.
            void mod.loadDialog().catch(() => {});
          }
          show();
        },
        () => {},
      );
    };
    const end = () => {
      depth = 0;
      local = null;
      armed?.arm(false);
      armed = null;
      route = null;
      html.removeAttribute("data-dragging");
      setDrag((d) => (d ? { ...d, open: false } : d));
    };

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth += 1;
      if (depth === 1) start(e.dataTransfer);
      // A zone that takes its own drops, under the pointer: the veil clears
      // it and says nothing — a release there is that zone's.
      const zone =
        e.target instanceof Element
          ? e.target.closest("[data-drop-sheet]:not([data-page-drop-target])")
          : null;
      if (zone !== local) {
        local = zone;
        show();
      }
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) end();
    };
    const onOver = (e: DragEvent) => {
      // Accept the drag everywhere — or the browser opens the file in the
      // tab on release. No React work here: it fires every few milliseconds.
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (depth > 0) end();
      if (!carriesFiles(e)) return;
      // A zone on the page claimed it (a drop sheet's own handler ran first).
      if (e.defaultPrevented) return;
      e.preventDefault();
      deliver(Array.from(e.dataTransfer?.files ?? []), "drop");
    };
    const onPaste = (e: ClipboardEvent) => {
      if (editable(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      deliver(files, "paste");
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", end);
    window.addEventListener("blur", end);
    window.addEventListener("paste", onPaste);
    // Said on the page, so a test (and anyone debugging) can tell the page
    // is taking its drops before it drops anything.
    html.setAttribute("data-drop-layer", "");
    return () => {
      html.removeAttribute("data-drop-layer");
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", end);
      window.removeEventListener("blur", end);
      window.removeEventListener("paste", onPaste);
      html.removeAttribute("data-dragging");
    };
  }, [engine, deliver]);

  return (
    <>
      {View && (drag || ticket) && (
        <View
          drag={drag}
          ticket={ticket}
          exclude={toolOfPath(path)}
          onClose={close}
          onUnreachable={lost}
        />
      )}
      {unreachable && (
        <p
          role="alert"
          className="bg-panel border-warn/40 text-fg rounded-panel shadow-lift fixed inset-x-4 bottom-4 z-[85] mx-auto max-w-md border px-4 py-3 text-sm"
        >
          Couldn&apos;t load what checks your files — check your connection,
          then drop them again.
        </p>
      )}
    </>
  );
}
