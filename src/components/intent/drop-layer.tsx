"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { DropVia, PageTarget, Route } from "@/lib/intent/page-target";
import type { DragState, DropTicket } from "./drop-layer-view";

/*
 * NOTHING HERE IS IMPORTED AT RUN TIME BUT REACT AND NEXT. This module is in
 * the root layout's chunk, and a module the layout shares with a page's own
 * chunks is downloaded twice on that page (`first-load-duplicates.test.ts`).
 * So the layer fetches the rest: the REGISTRY (`@/lib/intent/page-target`,
 * where files go), through the same `import()` a page's targets register
 * with — one chunk, one module, and a registration made on mount is in the
 * stack before a file routed through it — and the VIEW (`./drop-layer-view`:
 * the veil, the dialog's host), on idle or with the first file. The types
 * above erase. The two questions it must answer synchronously, whether a
 * drag carries files and what it describes, are its own copies of
 * `@/lib/intent/drag`'s, held to them by a test.
 */

type Registry = typeof import("@/lib/intent/page-target");
type Engine = typeof import("./drop-layer-view");

/** Fetched once; a failed fetch is not remembered — the next file retries. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    }));
}
const loadRegistry = once(() => import("@/lib/intent/page-target"));
const loadEngine = once(() => import("./drop-layer-view"));

/**
 * The registry, once every registration already asked for is in it. A
 * target registers through its own `import()` of the registry, and once the
 * module is here every such import resolves within the same turn — so one
 * macrotask later, every target whose effect ran before this file arrived
 * is in the stack, whichever of the two imports a module loader happened to
 * settle first. Without it, a file dropped while the registry was still on
 * its way could be routed to a page with no target.
 */
const settled = (registry: Registry) =>
  new Promise<Registry>((resolve) => setTimeout(() => resolve(registry), 0));

/**
 * Does this drag carry files (not text, not a link)? The layer's own copy of
 * `@/lib/intent/drag`'s — asked on every `dragover`, synchronously;
 * `drop-layer.test.tsx` holds the two to one answer over every shape.
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
export function describeDrag(
  transfer: Pick<DataTransfer, "items"> | null | undefined,
) {
  if (!transfer?.items) return [];
  return Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => ({ name: "", type: item.type }));
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
 * the view makes at the moment it is asked for and appends to the end of
 * `<body>`, whose files are routed like a drop. Not rendered with the page: React 19
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
  // The view, once it is here: it owns the picker of last resort.
  const engine = useRef<Engine | null>(null);
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

  // What draws — the veil, the dialog's host — once, on idle or with the
  // first file or drag.
  const view = useCallback(
    (): Promise<Engine> =>
      loadEngine().then((mod) => {
        engine.current = mod;
        setView(() => mod.default);
        return mod;
      }),
    [],
  );

  // Where files go, once: on arrival registered as the page's fallback —
  // the dialog, and the picker of last resort. `registry()` resolves only
  // after that registration.
  const ready = useRef<Promise<Registry> | null>(null);
  const unregister = useRef<(() => void) | null>(null);
  const registry = useCallback((): Promise<Registry> => {
    ready.current ??= loadRegistry().then(
      (mod) => {
        let seq = 0;
        unregister.current = mod.registerFallback({
          receive(files, via, why) {
            seq += 1;
            setUnreachable(false);
            setTicket({ key: seq, files, via, why });
            // The dialog's host is the view's: fetched now if it is not here.
            void view().catch(() => setUnreachable(true));
          },
          pick() {
            // The view is here by a click (fetched on idle); a picker
            // opened within the click's activation still opens.
            void view().then(
              (v) => v.pickFiles((files) => mod.deliverFiles(files, "header")),
              () => setUnreachable(true),
            );
          },
        });
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
  }, [view]);

  // Leaving takes everything the layer put on the page with it: its place
  // as the fallback, and the picker it appended to <body>.
  useEffect(
    () => () => {
      unregister.current?.();
      unregister.current = null;
      ready.current = null;
      engine.current?.removePicker();
    },
    [],
  );

  // Fetch both while the page is idle, so the first drag draws at once.
  useEffect(() => {
    const warm = () => {
      void registry().catch(() => {});
      void view().catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(timer);
  }, [registry, view]);

  // Files that landed: where they go is the registry's, as soon as it is
  // here — with where they were released, so a release on a drop sheet whose
  // engine had not arrived yet is that sheet's to decide (`deliverFiles`).
  const deliver = useCallback(
    (files: File[], via: DropVia, at?: Element | null) => {
      if (files.length === 0) return;
      setUnreachable(false);
      void registry()
        .then(settled)
        .then(
          (mod) => mod.deliverFiles(files, via, at),
          // Offline, or a deploy replaced the chunk: the files went nowhere,
          // and the page says so rather than nothing.
          () => setUnreachable(true),
        );
    },
    [registry],
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
      void view().catch(() => {});
      void registry()
        .then(settled)
        .then(
          (mod) => {
            if (depth === 0) return;
            route = mod.routeFor(kinds);
            if (route.to === "target") {
              armed = route.target;
              armed.arm(true);
            } else {
              // The dialog is where this is going: fetch it while the hand moves.
              void view()
                .then((engine) => engine.loadDialog())
                .catch(() => {});
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
      // A zone that takes its own drops, under the pointer, and takes what
      // is held (it marked itself `data-drop-refuses` in its own handler,
      // which runs first, when it does not): the veil clears it and says
      // nothing — a release there is that zone's. A zone that does not take
      // it is not a landing place, and the page's route stands.
      const zone =
        e.target instanceof Element
          ? e.target.closest(
              "[data-drop-sheet]:not([data-page-drop-target]):not([data-drop-refuses])",
            )
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
      deliver(
        Array.from(e.dataTransfer?.files ?? []),
        "drop",
        e.target instanceof Element ? e.target : null,
      );
    };
    const onPaste = (e: ClipboardEvent) => {
      if (editable(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      deliver(files, "paste");
    };

    const listeners = {
      dragenter: onEnter,
      dragleave: onLeave,
      dragover: onOver,
      drop: onDrop,
      dragend: end,
      blur: end,
      paste: onPaste,
    } as unknown as Record<string, EventListener>;
    for (const type in listeners)
      window.addEventListener(type, listeners[type]!);
    // Said on the page, so a test (and anyone debugging) can tell the page
    // is taking its drops before it drops anything.
    html.setAttribute("data-drop-layer", "");
    return () => {
      html.removeAttribute("data-drop-layer");
      for (const type in listeners)
        window.removeEventListener(type, listeners[type]!);
      html.removeAttribute("data-dragging");
    };
  }, [registry, view, deliver]);

  return (
    <>
      {View && (drag || ticket) && (
        <View
          drag={drag}
          ticket={ticket}
          path={path}
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
