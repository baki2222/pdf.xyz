"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import {
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ImageOff,
  Maximize,
  Minimize,
  Minus,
  PanelLeft,
  Plus,
  Printer,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import type { ViewerPdf } from "@/lib/pdf/viewer";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  fitZoom,
  liveWindow,
  printPlan,
  quarterTurn,
  readingAnchor,
  scaleOf,
  scrollForAnchor,
  scrollForPage,
  stepZoom,
  turnedSize,
  visibleRange,
  type FitMode,
  type PageSize,
  type QuarterTurn,
  type ReadingAnchor,
} from "@/lib/pdf/viewer-geometry";
import { COLUMN_PAD, currentPage, layoutPages } from "@/lib/pdf/view-layout";
import {
  VIEWER_IMAGE_NOTE,
  VIEWER_LABELS,
  VIEWER_ROTATE_NOTE,
  viewerPrintNote,
} from "@/lib/pdf/viewer-copy";
import {
  findInItems,
  hasSearchableText,
  searchStatus,
  viewerSearchPattern,
  type SearchMatch,
  type SearchTally,
} from "@/lib/pdf/viewer-search";
import {
  VIEWER_MAX_MATCHES,
  VIEWER_MAX_QUERY,
} from "@/lib/pdf/viewer-geometry";
import { downloadBlob } from "@/lib/pdf/browser";
import { outputFile } from "@/lib/intent/run-output";
import { causeOf } from "@/lib/pdf/remedies";
import { cn } from "@/lib/utils";
import { ErrorNote, Spinner, errorMessage } from "../runner-kit";
import { FileHeader } from "../single-pdf-runner";
import type { LoadedPdf } from "../use-single-pdf";
import { OCR_TOOL_HREF, OCR_TOOL_NAME } from "../no-text-note";
import { TEXT_LAYER_CSS } from "./text-layer-css";
import { ViewerPage } from "./viewer-page";
// Static, not a chunk of its own: it is ~1 KB, and each lazy chunk is an
// entry in the webpack runtime every page of the site loads.
import { printPages } from "./viewer-print";
import { ViewerSidebar, type SidebarTab } from "./viewer-sidebar";

/** "Continue with", from the result-ending chunk every runner shares. */
const ContinueWith = lazy(() =>
  import("@/components/intent/result-ending").then((m) => ({
    default: m.ContinueWith,
  })),
);

const ROTATE_TOOL_HREF = "/tools/rotate-pdf";

/** Empty sheets mounted either side of the view, ahead of a scroll. */
const MOUNTED_AROUND = 6;

/** The search's state, page by page as it runs. */
interface SearchState {
  query: string;
  matchCase: boolean;
  byPage: Map<number, SearchMatch[]>;
  /** Every match in reading order: its page and its index on that page. */
  order: { page: number; at: number }[];
  tally: SearchTally;
}

/**
 * The PDF Viewer: one PDF, every page in a continuous column, drawn only
 * where the reader is looking.
 *
 * WHAT IS BOUNDED. Only the visible pages and one each side hold a canvas
 * (`liveWindow`, at most VIEWER_LIVE_PAGES); every canvas is capped in
 * device pixels (`viewerRenderScale`); a draw that leaves the window is
 * aborted. The text layer reads at most VIEWER_MAX_TEXT_ITEMS items per
 * page, a search stops at VIEWER_MAX_MATCHES, bookmarks at
 * VIEWER_MAX_OUTLINE_ITEMS, print at its page and pixel caps — and each
 * stop is said where it happens.
 *
 * KEYS work while focus is inside the viewer and never in its fields:
 * Page Up / Page Down and the left and right arrows step a page, Home and
 * End go to the first and last, + and - zoom, Ctrl+F (Cmd+F) opens Search.
 * Ctrl+P is the browser's, never taken.
 *
 * `opening` is the document being opened, started by the runner beside
 * this chunk's fetch (`acquireViewerPdf`), which also owns its release. A
 * test hands in a resolved `ViewerPdf` (not `vi.mock`: under
 * `isolate: false` a module evaluated under a mock stays bound to the stub
 * for the next file).
 */
export function PdfViewer({
  pdf,
  onReset,
  opening,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
  opening: Promise<ViewerPdf> | null;
}) {
  const [doc, setDoc] = useState<ViewerPdf | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (!opening) return;
    let live = true;
    opening.then(
      (d) => {
        if (live) setDoc(d);
      },
      (err: unknown) => {
        if (live) setFailure(err ?? new Error("The PDF could not be opened."));
      },
    );
    return () => {
      live = false;
    };
  }, [opening]);

  return (
    <div className="flex flex-col gap-4">
      <FileHeader pdf={pdf} />
      {failure ? (
        <ErrorNote
          message={errorMessage(failure)}
          cause={{ ...causeOf(failure), file: pdf.file }}
        />
      ) : doc ? (
        <ViewerShell pdf={pdf} doc={doc} />
      ) : (
        <div
          aria-busy="true"
          className="border-line bg-wash text-muted rounded-panel flex h-[min(78vh,56rem)] min-h-[28rem] items-center justify-center gap-2 border text-sm"
        >
          <Spinner />
          Opening {pdf.file.name}…
        </div>
      )}
      <button
        type="button"
        onClick={onReset}
        className="text-muted hover:text-fg self-start text-xs font-medium"
      >
        Open another PDF
      </button>
      <section
        aria-label={VIEWER_LABELS.doMore}
        className="flex flex-col gap-2"
      >
        <h3 className="text-fg text-sm font-semibold">
          {VIEWER_LABELS.doMore}
        </h3>
        <Suspense fallback={null}>
          <ContinueWith output={outputFile(pdf.bytes, pdf.file.name)} />
        </Suspense>
      </section>
    </div>
  );
}

function ViewerShell({ pdf, doc }: { pdf: LoadedPdf; doc: ViewerPdf }) {
  const total = doc.numPages;
  const regionRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchFieldRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  // Page sizes: page 1's for every page at first, then each page's own as
  // they are read (the column re-lays out with the reading position kept).
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      let first: PageSize = { width: 612, height: 792 };
      try {
        first = await doc.pageSize(0);
      } catch {
        // A page that cannot be read keeps a Letter sheet; it says so when drawn.
      }
      if (!live) return;
      const all: PageSize[] = new Array(total).fill(first);
      setSizes(all.slice());
      let changed = false;
      for (let i = 1; i < total && live; i++) {
        try {
          const s = await doc.pageSize(i);
          if (s.width !== all[i]!.width || s.height !== all[i]!.height) {
            all[i] = s;
            changed = true;
          }
        } catch {
          // Kept at page 1's size.
        }
        if (changed && (i % 50 === 0 || i === total - 1)) {
          changed = false;
          if (live) setSizes(all.slice());
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [doc, total]);

  const [view, setView] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () =>
      setView((v) =>
        v.width === el.clientWidth && v.height === el.clientHeight
          ? v
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A fit zoom is recomputed as the view resizes; Fit page fits the page
  // that was being read when it was chosen.
  const [zoom, setZoom] = useState<{
    value: number;
    fit: FitMode | null;
    page: number;
  }>({ value: 1, fit: "width", page: 0 });
  const [turn, setTurn] = useState<QuarterTurn>(0);
  // Where the column is scrolled to, and the page a jump asked for: shown as
  // the current page until the reader scrolls away, so the last page reads
  // "Page N" even when the column cannot scroll its top to the view's top.
  const [scroll, setScroll] = useState<{ top: number; pinned: number | null }>({
    top: 0,
    pinned: null,
  });
  const anchor = useRef<ReadingAnchor>({ index: 0, fraction: 0 });
  const [announcement, setAnnouncement] = useState("");

  const turned = useMemo(
    () => (sizes ?? []).map((s) => turnedSize(s, turn)),
    [sizes, turn],
  );
  const widest = useMemo(
    () =>
      turned.reduce<PageSize>(
        (w, s) => (s.width > w.width ? s : w),
        turned[0] ?? { width: 612, height: 792 },
      ),
    [turned],
  );

  const effectiveZoom = useMemo(() => {
    if (!zoom.fit || view.width === 0) return zoom.value;
    const subject =
      zoom.fit === "width" ? widest : (turned[zoom.page] ?? widest);
    return fitZoom(zoom.fit, view.width, view.height, subject);
  }, [zoom, view, widest, turned]);

  const scale = scaleOf(effectiveZoom);
  const layout = useMemo(() => layoutPages(turned, scale), [turned, scale]);
  const viewHeight = view.height || 800;
  const current = !sizes
    ? 0
    : scroll.pinned !== null
      ? scroll.pinned
      : Math.min(total - 1, currentPage(layout.slots, scroll.top, viewHeight));
  const live = useMemo(
    () => new Set(liveWindow(layout.slots, scroll.top, viewHeight, current)),
    [layout.slots, scroll.top, viewHeight, current],
  );
  // Sheets are mounted only near the view (the column's height is set by
  // the layout, so the rest need no element at all): a 5,000-page file is
  // a few dozen elements, not 5,000.
  const mounted = useMemo(() => {
    const r = visibleRange(layout.slots, scroll.top, viewHeight);
    if (!r) return [];
    return layout.slots.slice(
      Math.max(0, r.first - MOUNTED_AROUND),
      r.last + MOUNTED_AROUND + 1,
    );
  }, [layout.slots, scroll.top, viewHeight]);

  // A new layout (zoom, fit, turn, page sizes) puts the reading position back.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || layout.slots.length === 0) return;
    const top = Math.min(
      scrollForAnchor(layout.slots, anchor.current),
      Math.max(0, layout.height - viewHeight),
    );
    if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
    setScroll((s) => (s.top === top ? s : { top, pinned: s.pinned }));
    // viewHeight is read, not followed: a resize re-lays out through `view`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const frame = useRef(0);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scrollerRef.current;
      if (!el) return;
      const top = el.scrollTop;
      setScroll((s) => {
        // The scroll a jump made is not the reader moving away from it.
        if (Math.abs(s.top - top) <= 2) return s;
        anchor.current = readingAnchor(layout.slots, top);
        return { top, pinned: null };
      });
    });
  }, [layout.slots]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const goTo = useCallback(
    (index: number, announce = true) => {
      const el = scrollerRef.current;
      const i = Math.min(Math.max(0, index), total - 1);
      const top = Math.min(
        scrollForPage(layout.slots, i),
        Math.max(0, layout.height - viewHeight),
      );
      anchor.current = { index: i, fraction: 0 };
      if (el) el.scrollTop = top;
      setScroll({ top, pinned: i });
      if (announce) setAnnouncement(`Page ${i + 1} of ${total}`);
    },
    [layout.slots, layout.height, viewHeight, total],
  );

  const zoomTo = (value: number, fit: FitMode | null = null) =>
    setZoom({ value, fit, page: current });
  const zoomStep = (dir: 1 | -1) => zoomTo(stepZoom(effectiveZoom, dir));

  // ── Page field ──────────────────────────────────────────────────────
  const [pageField, setPageField] = useState<string | null>(null);
  const commitPage = () => {
    if (pageField === null) return;
    const n = Number.parseInt(pageField, 10);
    setPageField(null);
    if (Number.isFinite(n)) goTo(n - 1);
  };

  // ── Sidebar ─────────────────────────────────────────────────────────
  const [sidebar, setSidebar] = useState<SidebarTab | null>(null);
  const toggleSidebar = (tab: SidebarTab) =>
    setSidebar((s) => (s === tab ? null : tab));

  // ── Search ──────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [activeMatch, setActiveMatch] = useState(-1);
  const [reveal, setReveal] = useState(0);
  const searchRun = useRef(0);
  // The latest jump: a search runs across renders (page sizes refine, the
  // zoom may change), and must jump with the layout of when it jumps.
  const goToNow = useRef(goTo);
  useEffect(() => {
    goToNow.current = goTo;
  }, [goTo]);

  const runSearch = useCallback(
    async (q: string, mc: boolean) => {
      const run = ++searchRun.current;
      const pattern = viewerSearchPattern(q, { matchCase: mc });
      setActiveMatch(-1);
      if (!pattern) {
        setSearch(null);
        return;
      }
      const byPage = new Map<number, SearchMatch[]>();
      const order: SearchState["order"] = [];
      const tally: SearchTally = {
        matches: 0,
        pagesWithMatches: 0,
        searched: 0,
        total,
        pagesWithoutText: 0,
        pagesCapped: 0,
        stoppedAtCap: false,
      };
      const publish = () =>
        setSearch({
          query: q,
          matchCase: mc,
          byPage: new Map(byPage),
          order: order.slice(),
          tally: { ...tally },
        });
      publish();
      let lastPublish = Date.now();
      let revealed = false;
      for (let i = 0; i < total; i++) {
        const text = await doc.text(i);
        if (run !== searchRun.current) return;
        tally.searched = i + 1;
        if (!hasSearchableText(text.items)) {
          tally.pagesWithoutText += 1;
        } else {
          if (text.capped) tally.pagesCapped += 1;
          const found = findInItems(
            text.items,
            pattern,
            VIEWER_MAX_MATCHES - tally.matches,
          );
          if (found.length > 0) {
            byPage.set(i, found);
            found.forEach((_, at) => order.push({ page: i, at }));
            tally.matches += found.length;
            tally.pagesWithMatches += 1;
          }
        }
        if (tally.matches >= VIEWER_MAX_MATCHES) {
          tally.stoppedAtCap = true;
        }
        // The first match is shown as soon as it is found.
        if (!revealed && order.length > 0) {
          revealed = true;
          publish();
          setActiveMatch(0);
          setReveal((r) => r + 1);
          goToNow.current(order[0]!.page, false);
          lastPublish = Date.now();
        } else if (Date.now() - lastPublish > 120 || i === total - 1) {
          publish();
          lastPublish = Date.now();
        }
        if (tally.stoppedAtCap) break;
      }
      publish();
    },
    [doc, total],
  );

  // Typing searches after a pause; Enter searches (or moves) at once.
  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => {
      if (
        search === null
          ? query.trim() !== ""
          : search.query !== query || search.matchCase !== matchCase
      ) {
        void runSearch(query, matchCase);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, matchCase, searchOpen, search, runSearch]);

  const moveMatch = (dir: 1 | -1) => {
    if (!search || search.order.length === 0) return;
    const n = search.order.length;
    const next = activeMatch < 0 ? 0 : (activeMatch + dir + n) % n;
    setActiveMatch(next);
    setReveal((r) => r + 1);
    goTo(search.order[next]!.page, false);
  };

  const closeSearch = () => {
    searchRun.current += 1;
    setSearchOpen(false);
    setSearch(null);
    setActiveMatch(-1);
    searchButtonRef.current?.focus();
  };

  useEffect(() => {
    if (searchOpen) searchFieldRef.current?.focus();
  }, [searchOpen]);

  const active = search && activeMatch >= 0 ? search.order[activeMatch] : null;

  // ── Full screen ─────────────────────────────────────────────────────
  const [canFullScreen, setCanFullScreen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    queueMicrotask(() =>
      setCanFullScreen(
        typeof document !== "undefined" &&
          document.fullscreenEnabled === true &&
          typeof regionRef.current?.requestFullscreen === "function",
      ),
    );
    const onChange = () =>
      setFullScreen(document.fullscreenElement === regionRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void regionRef.current?.requestFullscreen().catch(() => {});
  };

  // ── Print ───────────────────────────────────────────────────────────
  const plan = useMemo(() => (sizes ? printPlan(sizes) : null), [sizes]);
  const [printing, setPrinting] = useState<{ done: number } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const printAbort = useRef<AbortController | null>(null);
  useEffect(() => () => printAbort.current?.abort(), []);
  const print = async () => {
    if (!plan || printing) return;
    setPrintError(null);
    const controller = new AbortController();
    printAbort.current?.abort();
    printAbort.current = controller;
    setPrinting({ done: 0 });
    const result = await printPages(
      doc,
      plan,
      (done) => setPrinting({ done }),
      controller.signal,
    );
    setPrinting(null);
    if (result === "failed") {
      setPrintError(
        "A page could not be drawn for printing. Download the PDF and print it from a PDF reader.",
      );
    }
  };
  const printNote = plan ? viewerPrintNote(plan, total) : null;

  const download = () =>
    downloadBlob(
      new Blob([pdf.bytes as BlobPart], { type: "application/pdf" }),
      pdf.file.name,
    );

  // ── Keys ────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const inField =
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA";
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      setSearchOpen(true);
      searchFieldRef.current?.focus();
      return;
    }
    if (inField || mod || e.altKey) return;
    switch (e.key) {
      case "PageDown":
      case "ArrowRight":
        e.preventDefault();
        goTo(current + 1);
        break;
      case "PageUp":
      case "ArrowLeft":
        e.preventDefault();
        goTo(current - 1);
        break;
      case "Home":
        e.preventDefault();
        goTo(0);
        break;
      case "End":
        e.preventDefault();
        goTo(total - 1);
        break;
      case "+":
      case "=":
        e.preventDefault();
        zoomStep(1);
        break;
      case "-":
        e.preventDefault();
        zoomStep(-1);
        break;
    }
  };

  const pixelRatio =
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const zoomLabel = `${Math.round(effectiveZoom * 100)}%`;
  const zoomValue = zoom.fit
    ? `fit-${zoom.fit}`
    : ZOOM_STEPS.includes(zoom.value)
      ? String(zoom.value)
      : "custom";
  const iconButton =
    "rounded-ctl text-fg hover:bg-wash inline-grid size-11 shrink-0 place-items-center aria-disabled:opacity-40 sm:size-9 aria-pressed:bg-accent/15 aria-pressed:text-accent";
  const columnWidth = Math.max(layout.width, view.width);

  return (
    <div
      ref={regionRef}
      role="region"
      aria-labelledby={headingId}
      aria-busy={sizes === null || printing !== null}
      data-pdf-viewer=""
      onKeyDown={onKeyDown}
      className={cn(
        "border-line bg-panel flex flex-col overflow-hidden border",
        !fullScreen && "rounded-panel",
      )}
    >
      <style>{TEXT_LAYER_CSS}</style>
      <h3 id={headingId} className="sr-only">
        PDF viewer: {pdf.file.name}
      </h3>
      <div
        role="toolbar"
        aria-label="Viewer controls"
        className="border-line flex flex-wrap items-center gap-x-1 gap-y-1 border-b px-2 py-1.5"
      >
        <button
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.thumbnails}
          title={VIEWER_LABELS.thumbnails}
          aria-pressed={sidebar === "thumbnails"}
          onClick={() => toggleSidebar("thumbnails")}
        >
          <PanelLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.bookmarks}
          title={VIEWER_LABELS.bookmarks}
          aria-pressed={sidebar === "bookmarks"}
          onClick={() => toggleSidebar("bookmarks")}
        >
          <Bookmark className="size-4" aria-hidden />
        </button>
        <span aria-hidden className="bg-line mx-1 h-6 w-px max-sm:hidden" />
        <button
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.previous}
          title={VIEWER_LABELS.previous}
          aria-disabled={current <= 0}
          onClick={() => goTo(current - 1)}
        >
          <ChevronUp className="size-4" aria-hidden />
        </button>
        <label className="text-muted flex items-center gap-1.5 text-sm">
          <span>Page</span>
          <input
            aria-label={VIEWER_LABELS.pageNumber}
            inputMode="numeric"
            className="border-line bg-canvas text-fg rounded-ctl h-11 w-14 border px-2 text-center text-sm sm:h-9"
            value={pageField ?? String(current + 1)}
            onFocus={(e) => {
              setPageField(String(current + 1));
              e.currentTarget.select();
            }}
            onChange={(e) => setPageField(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setPageField(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitPage();
              } else if (e.key === "Escape") {
                setPageField(null);
              }
            }}
          />
          <span data-viewer-page-count="">of {total}</span>
        </label>
        <button
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.next}
          title={VIEWER_LABELS.next}
          aria-disabled={current >= total - 1}
          onClick={() => goTo(current + 1)}
        >
          <ChevronDown className="size-4" aria-hidden />
        </button>
        <span aria-hidden className="bg-line mx-1 h-6 w-px max-sm:hidden" />
        <button
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.zoomOut}
          title={VIEWER_LABELS.zoomOut}
          aria-disabled={effectiveZoom <= MIN_ZOOM + 0.001}
          onClick={() => zoomStep(-1)}
        >
          <Minus className="size-4" aria-hidden />
        </button>
        <select
          aria-label={VIEWER_LABELS.zoom}
          className="border-line bg-canvas text-fg rounded-ctl h-11 border px-2 text-sm sm:h-9"
          value={zoomValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "fit-width") zoomTo(effectiveZoom, "width");
            else if (v === "fit-page") zoomTo(effectiveZoom, "page");
            else if (v !== "custom") zoomTo(Number(v));
          }}
        >
          <option value="fit-width">
            {VIEWER_LABELS.fitWidth}
            {zoom.fit === "width" ? ` (${zoomLabel})` : ""}
          </option>
          <option value="fit-page">
            {VIEWER_LABELS.fitPage}
            {zoom.fit === "page" ? ` (${zoomLabel})` : ""}
          </option>
          {zoomValue === "custom" && (
            <option value="custom">{zoomLabel}</option>
          )}
          {ZOOM_STEPS.map((z) => (
            <option key={z} value={String(z)}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
        <button
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.zoomIn}
          title={VIEWER_LABELS.zoomIn}
          aria-disabled={effectiveZoom >= MAX_ZOOM - 0.001}
          onClick={() => zoomStep(1)}
        >
          <Plus className="size-4" aria-hidden />
        </button>
        <span aria-hidden className="bg-line mx-1 h-6 w-px max-sm:hidden" />
        <button
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.rotate}
          title={VIEWER_LABELS.rotate}
          onClick={() => setTurn((t) => quarterTurn(t, 1))}
        >
          <RotateCw className="size-4" aria-hidden />
        </button>
        <button
          ref={searchButtonRef}
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.search}
          title={VIEWER_LABELS.search}
          aria-pressed={searchOpen}
          aria-expanded={searchOpen}
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        >
          <Search className="size-4" aria-hidden />
        </button>
        <span className="flex-1" />
        {canFullScreen && (
          <button
            type="button"
            className={iconButton}
            aria-label={
              fullScreen
                ? VIEWER_LABELS.exitFullScreen
                : VIEWER_LABELS.fullScreen
            }
            title={
              fullScreen
                ? VIEWER_LABELS.exitFullScreen
                : VIEWER_LABELS.fullScreen
            }
            onClick={toggleFullScreen}
          >
            {fullScreen ? (
              <Minimize className="size-4" aria-hidden />
            ) : (
              <Maximize className="size-4" aria-hidden />
            )}
          </button>
        )}
        <button
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.print}
          title={VIEWER_LABELS.print}
          aria-disabled={!plan || printing !== null}
          onClick={() => void print()}
        >
          <Printer className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={VIEWER_LABELS.download}
          title={VIEWER_LABELS.download}
          onClick={download}
        >
          <Download className="size-4" aria-hidden />
        </button>
      </div>

      {searchOpen && (
        <div
          role="search"
          aria-label="Search the PDF"
          className="border-line bg-wash flex flex-col gap-1.5 border-b px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeSearch();
            }
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={searchFieldRef}
              type="search"
              aria-label={VIEWER_LABELS.searchField}
              placeholder={VIEWER_LABELS.searchField}
              maxLength={VIEWER_MAX_QUERY}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (
                  search &&
                  search.query === query &&
                  search.matchCase === matchCase
                ) {
                  moveMatch(e.shiftKey ? -1 : 1);
                } else {
                  void runSearch(query, matchCase);
                }
              }}
              className="border-line bg-canvas text-fg rounded-ctl h-11 min-w-0 flex-1 border px-3 text-sm sm:h-9"
            />
            <label className="text-fg flex min-h-11 items-center gap-1.5 text-sm sm:min-h-9">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
                className="size-4"
              />
              Match case
            </label>
            <button
              type="button"
              className={iconButton}
              aria-label={VIEWER_LABELS.previousMatch}
              title={VIEWER_LABELS.previousMatch}
              aria-disabled={!search || search.order.length === 0}
              onClick={() => moveMatch(-1)}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className={iconButton}
              aria-label={VIEWER_LABELS.nextMatch}
              title={VIEWER_LABELS.nextMatch}
              aria-disabled={!search || search.order.length === 0}
              onClick={() => moveMatch(1)}
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className={iconButton}
              aria-label="Close search"
              title="Close search"
              onClick={closeSearch}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <p
            role="status"
            aria-live="polite"
            data-viewer-search-status=""
            className="text-muted text-xs"
          >
            {search && (
              <>
                {active && search.order.length > 0 && (
                  <span data-viewer-match-position="">
                    Match {activeMatch + 1} of{" "}
                    {search.order.length.toLocaleString("en-US")}.{" "}
                  </span>
                )}
                {searchStatus(search.tally)}
                {search.tally.pagesWithoutText > 0 && (
                  <>
                    {" "}
                    To make scanned pages searchable, use{" "}
                    <Link
                      href={OCR_TOOL_HREF}
                      className="font-medium underline underline-offset-2"
                    >
                      {OCR_TOOL_NAME}
                    </Link>
                    .
                  </>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {(turn !== 0 ||
        doc.imageTooLarge ||
        printNote ||
        printing ||
        printError) && (
        <div className="border-line flex flex-col gap-1 border-b px-3 py-2 text-xs">
          {turn !== 0 && (
            <p data-viewer-rotate-note="" className="text-muted">
              {VIEWER_ROTATE_NOTE} To save a rotation, use{" "}
              <Link
                href={ROTATE_TOOL_HREF}
                className="font-medium underline underline-offset-2"
              >
                Rotate PDF
              </Link>
              .
            </p>
          )}
          {doc.imageTooLarge && (
            <p
              role="note"
              data-viewer-image-note=""
              className="text-warn flex items-start gap-1.5"
            >
              <ImageOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {VIEWER_IMAGE_NOTE}
            </p>
          )}
          {printing ? (
            <p role="status" className="text-muted">
              Preparing pages for printing: {printing.done} of{" "}
              {plan?.pages.length ?? 0}…
            </p>
          ) : (
            printNote && (
              <p data-viewer-print-note="" className="text-muted">
                {printNote}
              </p>
            )
          )}
          {printError && (
            <p role="alert" className="text-err">
              {printError}
            </p>
          )}
        </div>
      )}

      <div
        className={cn(
          "relative flex",
          fullScreen ? "min-h-0 flex-1" : "h-[min(78vh,56rem)] min-h-[28rem]",
        )}
      >
        {sidebar && (
          <ViewerSidebar
            tab={sidebar}
            bytes={pdf.bytes}
            doc={doc}
            current={current}
            onPage={(i) => {
              goTo(i);
              // On a phone the sheet covers the pages: close it on a pick.
              if (
                typeof window !== "undefined" &&
                window.matchMedia?.("(max-width: 639px)").matches
              ) {
                setSidebar(null);
              }
            }}
            onClose={() => setSidebar(null)}
          />
        )}
        <div
          ref={scrollerRef}
          tabIndex={0}
          aria-label={`Pages of ${pdf.file.name}`}
          data-viewer-scroller=""
          onScroll={onScroll}
          className="bg-wash min-w-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <div
            className="relative"
            style={{ height: layout.height, width: columnWidth }}
          >
            {sizes &&
              mounted.map((slot) => (
                <ViewerPage
                  key={slot.index}
                  doc={doc}
                  index={slot.index}
                  top={slot.top}
                  left={Math.max(COLUMN_PAD, (columnWidth - slot.width) / 2)}
                  width={slot.width}
                  height={slot.height}
                  scale={scale}
                  turn={turn}
                  live={live.has(slot.index)}
                  pixelRatio={pixelRatio}
                  hits={search?.byPage.get(slot.index)}
                  activeHit={active?.page === slot.index ? active.at : -1}
                  revealToken={active?.page === slot.index ? reveal : 0}
                  onPage={goTo}
                />
              ))}
          </div>
        </div>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
