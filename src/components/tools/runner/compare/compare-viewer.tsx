"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  type MouseEvent,
  type Ref,
} from "react";
import type { PdfCompareResult } from "@/lib/pdf/compare-pdf";
import type { ExtractedTextPage } from "@/lib/pdf/text";
import type { ViewerPdf } from "@/lib/pdf/viewer";
import {
  changesByPage,
  placePage,
  readingLinesByPage,
  type PagePlacement,
  type SideChanges,
} from "@/lib/pdf/compare/view-marks";
import {
  mapLR,
  mapRL,
  syncMapOf,
  type SyncMap,
} from "@/lib/pdf/compare/scroll-sync";
import { COLUMN_PAD, currentPage, layoutPages } from "@/lib/pdf/view-layout";
import {
  VIEWER_MAX_TEXT_ITEMS,
  fitZoom,
  liveWindow,
  readingAnchor,
  scaleOf,
  scrollForAnchor,
  scrollForPage,
  visibleRange,
  type PageSize,
  type ReadingAnchor,
} from "@/lib/pdf/viewer-geometry";
import { VIEWER_IMAGE_NOTE } from "@/lib/pdf/viewer-copy";
import { TEXT_LAYER_CSS } from "../viewer/text-layer-css";
import { ViewerPage } from "../viewer/viewer-page";

/**
 * Compare PDF's page view: both PDFs side by side, each changed line marked
 * on its own page — removed text crossed out on the first file's pages,
 * added text underlined on the second's (audit compare-pdf#2, S2,
 * 2026-11-15). Its own lazy chunk, fetched when Show changes on the pages
 * is pressed (or pointed at), never with the comparison: `lazy-chunks.test
 * .ts` holds it off every page's first load by {@link COMPARE_VIEWER_CHUNK},
 * which only this view renders, and apart from the comparison's chunk.
 *
 * WHAT IS BOUNDED. At most {@link COMPARE_LIVE_PAGES_PER_SIDE} pages per
 * side hold a canvas — the two together no more than PDF Viewer's one
 * column — and each document keeps half of one viewer's decoded pages
 * (`compare-docs.ts`). Marks are computed only for live pages.
 *
 * WHAT IS NOT CLAIMED. A changed line is marked only where it can be found
 * on its page without a guess (`view-marks.ts`); otherwise its page says so,
 * and the list of changes, which reads every change as text, stays the
 * accessible equivalent. Scrolling both files together follows unchanged
 * lines' ranks, not their geometry, so it is approximate.
 *
 * A page drawn as an image-budget note (its images over the page budget)
 * still gets its selectable text, so its marks sit at the text's place
 * over the note; the note names itself to a screen reader (`ViewerPage`).
 */
export const COMPARE_VIEWER_CHUNK = "pdfxyz:lazy:compare-viewer";

/** Pages per side that hold a canvas at once: two sides, one viewer's worth. */
export const COMPARE_LIVE_PAGES_PER_SIDE = 4;

/** Empty sheets mounted either side of the view, as PDF Viewer mounts them. */
const MOUNTED_AROUND = 6;

/** Below this width one file is shown at a time (as PDF Viewer's own query). */
const PHONE_QUERY = "(max-width: 639px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq =
      typeof window !== "undefined" ? window.matchMedia?.(PHONE_QUERY) : null;
    if (!mq) return;
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return phone;
}

/**
 * The marks, the columns and the notes: inline in this chunk, so the site's
 * stylesheet (paid on every page) carries none of it. The colours of every
 * line and outline hold 3:1 or more against white, and the fills stay
 * translucent so the glyphs under them read (compare-viewer.test.tsx). The
 * text layer's glyphs are transparent, so each decoration names its colour.
 */
export const COMPARE_LAYER_CSS = `
[data-compare-viewer] [data-compare-columns]{display:grid;grid-template-columns:minmax(0,1fr)}
@media (min-width:640px){[data-compare-viewer] [data-compare-columns]{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
[data-compare-viewer] [data-viewer-scroller]{height:min(70vh,44rem);min-height:18rem;overflow:auto;position:relative}
[data-compare-viewer] .textLayer mark[data-viewer-hit][data-mark-kind]{color:transparent;border-radius:1px;margin:0;padding:0;outline:none;text-decoration-skip-ink:none}
[data-compare-viewer] .textLayer mark[data-viewer-hit][data-mark-kind="removed"]{background:rgb(220 38 38 / 0.28);text-decoration-line:line-through;text-decoration-thickness:2px;text-decoration-color:#b91c1c}
[data-compare-viewer] .textLayer mark[data-viewer-hit][data-mark-kind="added"]{background:rgb(22 163 74 / 0.28);text-decoration-line:underline;text-decoration-thickness:2px;text-decoration-color:#15803d}
[data-compare-viewer] .textLayer mark[data-viewer-hit][data-mark-kind="line"]{background:transparent;outline:1px dashed #4b5563}
[data-compare-viewer] .textLayer mark[data-viewer-hit="active"][data-mark-kind]{outline:3px solid #1d4ed8;outline-offset:1px}
@media (forced-colors: active){[data-compare-viewer] .textLayer mark[data-viewer-hit][data-mark-kind]{background:Mark;text-decoration-color:CanvasText;forced-color-adjust:none}[data-compare-viewer] .textLayer mark[data-viewer-hit="active"][data-mark-kind]{outline-color:Highlight}}
`;

/** Said on a page past the text-item cap that holds changes: none is marked there. */
export const COMPARE_CAPPED_NOTE = `This page has more than ${VIEWER_MAX_TEXT_ITEMS.toLocaleString("en-US")} pieces of text, so its changes are not marked here. They are in the list of changes.`;

/** Said on a page with no selectable text: nothing on it was compared. */
export const COMPARE_NO_TEXT_NOTE =
  "No selectable text on this page, so it was not compared.";

/** Said where changed lines could not be placed on their page. */
export function compareUnplacedNote(n: number): string {
  return n === 1
    ? "1 changed line on this page could not be placed on the page. It is in the list of changes."
    : `${n.toLocaleString("en-US")} changed lines on this page could not be placed on the page. They are in the list of changes.`;
}

type Side = "left" | "right";

interface ColumnHandle {
  goToPage(index: number): void;
  goToAnchor(u: number): void;
}

/** A position as `index + fraction`, and back. */
const toU = (a: ReadingAnchor) => a.index + a.fraction;
function toAnchor(u: number, pages: number): ReadingAnchor {
  const index = Math.max(0, Math.min(pages - 1, Math.floor(u)));
  return { index, fraction: Math.max(0, Math.min(1, u - index)) };
}

interface ColumnProps {
  side: Side;
  doc: ViewerPdf;
  title: string;
  name: string;
  changes: SideChanges;
  reading: Map<number, string[]>;
  noText: ReadonlySet<number>;
  current: number;
  /** 0-based page a move to the current change shows on this side. */
  target: number;
  token: number;
  initialU: number;
  ref?: Ref<ColumnHandle>;
  onScrolled: (side: Side, u: number, byUser: boolean) => void;
  onUnplaced: (side: Side, token: number, sentence: string) => void;
}

function CompareColumn({
  side,
  doc,
  title,
  name,
  changes,
  reading,
  noText,
  current,
  target,
  token,
  initialU,
  ref,
  onScrolled,
  onUnplaced,
}: ColumnProps) {
  const total = doc.numPages;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // Page sizes: page 1's for every page at first, then each page's own.
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      let first: PageSize = { width: 612, height: 792 };
      try {
        first = await doc.pageSize(0);
      } catch {
        // Kept at Letter; the page says so when drawn.
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
        if (!live) return;
        if ((i % 50 === 0 || i === total - 1) && changed) {
          setSizes(all.slice());
          changed = false;
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

  const widest = useMemo(
    () =>
      (sizes ?? []).reduce<PageSize>(
        (w, s) => (s.width > w.width ? s : w),
        sizes?.[0] ?? { width: 612, height: 792 },
      ),
    [sizes],
  );
  const scale = scaleOf(
    view.width > 0 ? fitZoom("width", view.width, view.height, widest) : 1,
  );
  const layout = useMemo(() => layoutPages(sizes ?? [], scale), [sizes, scale]);
  const viewHeight = view.height || 600;
  const [top, setTop] = useState(0);
  const anchor = useRef<ReadingAnchor>(toAnchor(initialU, total));
  /** The last scroll was ours (a move, the other side, a reveal), not the reader's. */
  const ours = useRef(true);

  const write = useCallback(
    (to: number) => {
      const el = scrollerRef.current;
      const max = Math.max(0, layout.height - viewHeight);
      const t = Math.min(Math.max(0, to), max);
      ours.current = true;
      if (el && Math.abs(el.scrollTop - t) > 1) el.scrollTop = t;
      setTop(t);
    },
    [layout.height, viewHeight],
  );

  // A new layout (the view's width, the page sizes) puts the position back.
  useLayoutEffect(() => {
    if (layout.slots.length === 0) return;
    write(scrollForAnchor(layout.slots, anchor.current));
    // viewHeight is read through `write`, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useImperativeHandle(
    ref,
    () => ({
      goToPage: (index) => {
        const i = Math.max(0, Math.min(total - 1, index));
        anchor.current = { index: i, fraction: 0 };
        if (layout.slots.length > 0) write(scrollForPage(layout.slots, i));
      },
      goToAnchor: (u) => {
        anchor.current = toAnchor(u, total);
        if (layout.slots.length > 0)
          write(scrollForAnchor(layout.slots, anchor.current));
      },
    }),
    [layout.slots, total, write],
  );

  // Input on the scroller is the reader's: the next scroll is theirs.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const mine = () => {
      ours.current = false;
    };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const e of events) el.addEventListener(e, mine, { passive: true });
    return () => {
      for (const e of events) el.removeEventListener(e, mine);
    };
  }, []);

  const frame = useRef(0);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scrollerRef.current;
      if (!el) return;
      const t = el.scrollTop;
      setTop((s) => {
        // The scroll a move made is not the reader moving away from it.
        if (Math.abs(s - t) <= 2) return s;
        anchor.current = readingAnchor(layout.slots, t);
        onScrolled(side, toU(anchor.current), !ours.current);
        return t;
      });
    });
  }, [layout.slots, onScrolled, side]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const cur = !sizes ? 0 : currentPage(layout.slots, top, viewHeight);
  const live = useMemo(
    () =>
      new Set(
        liveWindow(
          layout.slots,
          top,
          viewHeight,
          cur,
          COMPARE_LIVE_PAGES_PER_SIDE,
        ),
      ),
    [layout.slots, top, viewHeight, cur],
  );
  const mounted = useMemo(() => {
    const r = visibleRange(layout.slots, top, viewHeight);
    if (!r) return [];
    return layout.slots.slice(
      Math.max(0, r.first - MOUNTED_AROUND),
      r.last + MOUNTED_AROUND + 1,
    );
  }, [layout.slots, top, viewHeight]);

  // Marks: placed for live pages with changes only, dropped as they leave.
  const [placed, setPlaced] = useState<{
    changes: SideChanges;
    pages: Map<number, PagePlacement & { capped: boolean }>;
  }>({ changes, pages: new Map() });
  const placedNow = placed.changes === changes ? placed.pages : null;
  const liveKey = [...live].join(",");
  useEffect(() => {
    let alive = true;
    const keep = new Map<number, PagePlacement & { capped: boolean }>();
    const have = placed.changes === changes ? placed.pages : new Map();
    for (const [i, p] of have) if (live.has(i)) keep.set(i, p);
    if (keep.size !== have.size || placed.changes !== changes)
      queueMicrotask(() => {
        if (alive) setPlaced({ changes, pages: keep });
      });
    for (const i of live) {
      const list = changes.byPage.get(i + 1);
      if (!list || keep.has(i)) continue;
      void doc.text(i).then((text) => {
        if (!alive) return;
        const p = placePage(
          text.items,
          reading.get(i + 1) ?? [],
          list,
          text.capped,
        );
        setPlaced((prev) =>
          prev.changes !== changes
            ? prev
            : {
                changes,
                pages: new Map(prev.pages).set(i, {
                  ...p,
                  capped: text.capped,
                }),
              },
        );
      });
    }
    return () => {
      alive = false;
    };
    // `live` is followed through its key; `placed` is read, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, doc, changes, reading]);

  // The move's page, once placed: say what could not be marked on it.
  const told = useRef(0);
  useEffect(() => {
    const p = placedNow?.get(target);
    if (!p || told.current === token) return;
    const mine = p.flagged.filter((c) => c.hunk === current).length;
    told.current = token;
    if (p.capped && mine > 0) onUnplaced(side, token, COMPARE_CAPPED_NOTE);
    else if (mine > 0) onUnplaced(side, token, compareUnplacedNote(mine));
  }, [placedNow, target, token, current, side, onUnplaced]);

  // Reveal tokens: the move's page scrolls its mark into view ONCE per
  // move. ViewerPage reveals whenever the token it is handed differs from
  // the last it revealed for, so a page keeps the token it was given for as
  // long as it stays mounted (a drop to 0 would reveal again), a newly
  // mounted page gets 0, and the move's page gets the move's token until it
  // has left the mounted window once (a remount must not scroll again).
  const [reveal, setReveal] = useState<{
    sticky: Map<number, number>;
    seen: number;
    gone: number;
  }>({ sticky: new Map(), seen: 0, gone: 0 });
  const mountedKey = mounted.map((s) => s.index).join(",");
  useEffect(() => {
    const on = mountedKey === "" ? [] : mountedKey.split(",").map(Number);
    queueMicrotask(() =>
      setReveal((prev) => {
        const sticky = new Map<number, number>();
        for (const i of on) {
          const t =
            i === target && prev.gone !== token
              ? token
              : (prev.sticky.get(i) ?? 0);
          if (t) sticky.set(i, t);
        }
        let { seen, gone } = prev;
        if (on.includes(target)) seen = token;
        else if (seen === token) gone = token;
        return { sticky, seen, gone };
      }),
    );
  }, [mountedKey, target, token]);
  const tokenFor = (i: number): number =>
    i === target && reveal.gone !== token ? token : (reveal.sticky.get(i) ?? 0);

  const goToPage = useCallback(
    (i: number) => {
      anchor.current = { index: i, fraction: 0 };
      write(scrollForPage(layout.slots, i));
    },
    [layout.slots, write],
  );
  const pixelRatio =
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const columnWidth = Math.max(layout.width, view.width);

  return (
    <div className="border-line flex min-w-0 flex-col">
      <div className="border-line flex flex-col gap-1 border-b px-3 py-2">
        <p
          id={headingId}
          data-compare-column-title=""
          className="text-fg text-sm font-semibold wrap-anywhere"
        >
          {`${title} · ${name}`}
        </p>
        {doc.imageTooLarge && (
          <p
            role="note"
            data-viewer-image-note=""
            className="text-warn text-xs"
          >
            {VIEWER_IMAGE_NOTE}
          </p>
        )}
      </div>
      <div
        ref={scrollerRef}
        role="region"
        aria-label={`${title}: ${name}`}
        aria-describedby={headingId}
        tabIndex={0}
        data-viewer-scroller=""
        data-compare-side={side}
        onScroll={onScroll}
        className="bg-wash min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <div
          className="relative"
          style={{ height: layout.height, width: columnWidth }}
        >
          {sizes &&
            mounted.map((slot) => {
              const p = placedNow?.get(slot.index);
              const isLive = live.has(slot.index);
              const left = Math.max(COLUMN_PAD, (columnWidth - slot.width) / 2);
              const hasChanges = changes.byPage.has(slot.index + 1);
              const unplaced = p && !p.capped ? p.flagged.length : 0;
              const active = p ? p.hunkOfMatch.indexOf(current) : -1;
              return (
                <div key={slot.index} style={{ display: "contents" }}>
                  <ViewerPage
                    doc={doc}
                    index={slot.index}
                    top={slot.top}
                    left={left}
                    width={slot.width}
                    height={slot.height}
                    scale={scale}
                    turn={0}
                    live={isLive}
                    pixelRatio={pixelRatio}
                    hits={p?.matches}
                    activeHit={active}
                    revealToken={tokenFor(slot.index)}
                    onPage={goToPage}
                    textCappedNote={
                      hasChanges ? COMPARE_CAPPED_NOTE : undefined
                    }
                  />
                  {((isLive && unplaced > 0) || noText.has(slot.index + 1)) && (
                    <p
                      role="note"
                      data-compare-page-note=""
                      className="bg-wash/95 text-fg absolute px-2 py-1 text-xs"
                      style={{
                        top: slot.top,
                        left,
                        width: slot.width,
                        zIndex: 4,
                      }}
                    >
                      {noText.has(slot.index + 1)
                        ? COMPARE_NO_TEXT_NOTE
                        : compareUnplacedNote(unplaced)}
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

export interface CompareViewerProps {
  left: ViewerPdf;
  right: ViewerPdf;
  result: PdfCompareResult;
  /** Each file's extracted pages: the lines the comparison read, per page. */
  leftPages: readonly Pick<ExtractedTextPage, "text" | "pageNumber">[];
  rightPages: readonly Pick<ExtractedTextPage, "text" | "pageNumber">[];
  /** The change Previous and Next are on. */
  current: number;
  /** Bumped by every move to a change; both files go to it. */
  navToken: number;
}

export function CompareViewer({
  left,
  right,
  result,
  leftPages,
  rightPages,
  current,
  navToken,
}: CompareViewerProps) {
  const phone = usePhone();
  const panel = useRef<HTMLDivElement>(null);
  const descId = useId();
  const [shown, setShown] = useState<Side>("left");
  const [sync, setSync] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const index = useMemo(() => changesByPage(result), [result]);
  const reading = useMemo(
    () => ({
      left: readingLinesByPage(leftPages),
      right: readingLinesByPage(rightPages),
    }),
    [leftPages, rightPages],
  );
  const noText = useMemo(
    () => ({
      left: new Set(result.pagesWithoutText.left),
      right: new Set(result.pagesWithoutText.right),
    }),
    [result.pagesWithoutText],
  );
  const map: SyncMap = useMemo(
    () => syncMapOf(result, left.numPages, right.numPages),
    [result, left.numPages, right.numPages],
  );
  const leftHandle = useRef<ColumnHandle>(null);
  const rightHandle = useRef<ColumnHandle>(null);
  /** Where each file was last read (`index + fraction`). */
  const lastU = useRef({ left: 0, right: 0 });
  /** Where a column mounted by the phone switch opens. */
  const [startU, setStartU] = useState({ left: 0, right: 0 });
  const targets = {
    left: Math.max(0, (index.left.target[current] ?? 1) - 1),
    right: Math.max(0, (index.right.target[current] ?? 1) - 1),
  };

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  // Every move takes both files to the change's first page on each side.
  useEffect(() => {
    lastU.current = { left: targets.left, right: targets.right };
    leftHandle.current?.goToPage(targets.left);
    rightHandle.current?.goToPage(targets.right);
    queueMicrotask(() => setAnnouncement(""));
    // Followed through the token: one move, one jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navToken]);

  // Only the reader's own scrolling is followed; the other file's write is
  // ours, so it does not echo back (`CompareColumn`'s `ours`).
  const onScrolled = useCallback(
    (side: Side, u: number, byUser: boolean) => {
      lastU.current[side] = u;
      if (!byUser || !sync || phone) return;
      const v = side === "left" ? mapLR(map, u) : mapRL(map, u);
      const other = side === "left" ? rightHandle : leftHandle;
      lastU.current[side === "left" ? "right" : "left"] = v;
      other.current?.goToAnchor(v);
    },
    [map, sync, phone],
  );

  const onUnplaced = useCallback(
    (_side: Side, token: number, sentence: string) => {
      if (token !== navToken) return;
      setAnnouncement((a) =>
        a.includes(sentence) ? a : `${a} ${sentence}`.trim(),
      );
    },
    [navToken],
  );

  const switchTo = useCallback(
    (side: Side) => {
      if (side === shown) return;
      // The file switched to opens where the other was being read.
      const u =
        side === "right"
          ? mapLR(map, lastU.current.left)
          : mapRL(map, lastU.current.right);
      lastU.current[side] = u;
      setStartU((s) => ({ ...s, [side]: u }));
      setShown(side);
    },
    [map, shown],
  );

  const onSwitch = useCallback(
    (e: MouseEvent<HTMLButtonElement>) =>
      switchTo(
        e.currentTarget.dataset.compareShow === "right" ? "right" : "left",
      ),
    [switchTo],
  );

  const columns: { side: Side; doc: ViewerPdf; title: string; name: string }[] =
    [
      { side: "left", doc: left, title: "Original", name: result.leftName },
      { side: "right", doc: right, title: "Revised", name: result.rightName },
    ];
  const pressed =
    "border-line text-fg hover:bg-wash rounded-ctl inline-flex min-h-11 items-center border px-4 text-sm aria-pressed:bg-accent/15 aria-pressed:text-accent";

  return (
    <div
      ref={panel}
      role="group"
      aria-label="Changes on the pages"
      aria-describedby={descId}
      tabIndex={-1}
      data-compare-viewer=""
      data-pdf-viewer=""
      data-chunk={COMPARE_VIEWER_CHUNK}
      className="flex flex-col outline-none"
    >
      <style>{TEXT_LAYER_CSS + COMPARE_LAYER_CSS}</style>
      <p id={descId} className="sr-only">
        Removed text is crossed out on the original&apos;s pages and added text
        underlined on the revised file&apos;s. The list of changes reads every
        change as text.
      </p>
      <div className="border-line flex flex-wrap items-center gap-2 border-b p-3">
        {phone ? (
          columns.map((c) => (
            <button
              key={c.side}
              type="button"
              aria-pressed={shown === c.side}
              data-compare-show={c.side}
              onClick={onSwitch}
              className={pressed}
            >
              {c.title}
            </button>
          ))
        ) : (
          <label className="text-fg inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={sync}
              onChange={(e) => setSync(e.target.checked)}
            />
            Scroll both files together
          </label>
        )}
      </div>
      <div data-compare-columns="">
        {columns.map((c) =>
          phone && shown !== c.side ? null : (
            <CompareColumn
              key={c.side}
              side={c.side}
              doc={c.doc}
              title={c.title}
              name={c.name}
              changes={index[c.side]}
              reading={reading[c.side]}
              noText={noText[c.side]}
              current={current}
              target={targets[c.side]}
              token={navToken}
              initialU={startU[c.side]}
              ref={c.side === "left" ? leftHandle : rightHandle}
              onScrolled={onScrolled}
              onUnplaced={onUnplaced}
            />
          ),
        )}
      </div>
      <p
        role="status"
        aria-live="polite"
        data-compare-viewer-announce=""
        className="sr-only"
      >
        {announcement}
      </p>
    </div>
  );
}
