"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { readFileBytes } from "@/lib/pdf/browser";
import {
  MAX_EDIT_IMAGE_BYTES,
  checkEditImage,
  sniffImageFormat,
} from "@/lib/pdf/edit";
import { readExportFrames } from "@/lib/pdf/editor-export";
import {
  clampRectToPage,
  clampZoom,
  fitWidthZoom,
  scaleForZoom,
  screenToViewer,
  snapRect,
  typicalPageWidth,
  type ExportFrame,
  type SnapGuide,
} from "@/lib/pdf/editor/geometry";
import { changeOf, type Change } from "@/lib/pdf/editor/history";
import {
  cloneObject,
  describeObject,
  dragHandle,
  handlesFor,
  moveObject,
  newObjectId,
  objectBounds,
  rectFromPoints,
  rectsIntersect,
  resizeObject,
  setLineEndpoint,
  NOTE_PADDING,
  NUDGE_BIG_PT,
  NUDGE_PT,
  type EditorObject,
  type Handle,
  type LineObject,
  type NoteObject,
  type Rect,
  type TextBoxObject,
} from "@/lib/pdf/editor/model";
import { openEditorPdf, type EditorPdf } from "@/lib/pdf/editor/page-render";
import { cn } from "@/lib/utils";
import { ErrorNote, useAnnouncer } from "../runner-kit";
import { PagePreviewPlaceholder } from "../page-preview-placeholder";
import { FileHeader } from "../single-pdf-runner";
import type { LoadedPdf } from "../use-single-pdf";
import {
  type Defaults,
  type EditorAction,
  type EditorState,
  type PendingImage,
  type Tool,
} from "./editor-state";
import { useTextKit, type TextKit } from "./measure";
import { HitArea, ObjectShape } from "./object-svg";
import { PageCanvas } from "./page-canvas";
import { COLUMN_PAD, currentPage, layoutPages, pagesNear } from "./page-layout";
import {
  PropertiesPanel,
  bucketOf,
  bucketOfTool,
  type StylePatch,
} from "./properties";
import { SignaturePanel } from "./signature-panel";
import { ThumbnailRail } from "./thumbnail-rail";
import { EditorToolbar, TOOL_BUTTONS } from "./toolbar";

/**
 * The WYSIWYG editor: every page drawn by pdf.js, an object layer over each
 * in page points, and an export that writes those objects where they were
 * drawn (`@/lib/pdf/editor-export`). Nothing leaves the browser.
 */

type Pt = { x: number; y: number };

type DragBase = {
  /** The latest preview, read at pointer-up (state may not have re-rendered yet). */
  last?: Record<string, EditorObject>;
};

type Drag = DragBase &
  (
    | {
        kind: "move";
        page: number;
        el: HTMLElement;
        start: Pt;
        originals: EditorObject[];
        moved: boolean;
        clickedId: string;
        additive: boolean;
      }
    | {
        kind: "resize";
        page: number;
        el: HTMLElement;
        obj: EditorObject;
        from: Rect;
        handle: Handle;
      }
    | {
        kind: "end";
        page: number;
        el: HTMLElement;
        obj: LineObject;
        end: 1 | 2;
      }
    | {
        kind: "create";
        page: number;
        el: HTMLElement;
        tool: Tool;
        start: Pt;
        current: Pt;
        id: string;
      }
    | { kind: "ink"; page: number; el: HTMLElement; points: Pt[]; id: string }
    | {
        kind: "marquee";
        page: number;
        el: HTMLElement;
        start: Pt;
        current: Pt;
        additive: boolean;
      }
  );

const PLACING: ReadonlySet<Tool> = new Set([
  "rect",
  "ellipse",
  "line",
  "arrow",
  "whiteout",
  "highlight",
]);

const PASTE_OFFSET = 12;
const SNAP_PX = 6;
const MAX_IMAGE_MB = Math.round(MAX_EDIT_IMAGE_BYTES / (1024 * 1024));

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

function unionRect(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function imageSize(
  bytes: Uint8Array,
  format: "png" | "jpg",
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes).buffer], {
        type: format === "png" ? "image/png" : "image/jpeg",
      }),
    );
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 1, height: 1 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** A new object of the kind a placing tool makes, spanning `rect` (or a line from a to b). */
function makeObject(
  tool: Tool,
  page: number,
  rect: Rect,
  a: Pt,
  b: Pt,
  defaults: Defaults,
  id: string,
): EditorObject | null {
  switch (tool) {
    case "rect":
    case "ellipse":
      return {
        id,
        kind: "shape",
        shape: tool,
        page,
        ...rect,
        ...defaults.shape,
      };
    case "line":
    case "arrow":
      return {
        id,
        kind: "line",
        page,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        arrow: tool === "arrow",
        ...defaults.line,
      };
    case "whiteout":
      return { id, kind: "whiteout", page, ...rect };
    case "highlight":
      return { id, kind: "highlight", page, ...rect, ...defaults.highlight };
    default:
      return null;
  }
}

/** The size a click (not a drag) gives a new shape. */
const CLICK_SIZE: Partial<Record<Tool, { width: number; height: number }>> = {
  rect: { width: 120, height: 72 },
  ellipse: { width: 100, height: 72 },
  whiteout: { width: 140, height: 28 },
  highlight: { width: 160, height: 18 },
  line: { width: 120, height: 0 },
  arrow: { width: 120, height: 0 },
};

function applyPatch(obj: EditorObject, patch: StylePatch): EditorObject {
  const next: Record<string, unknown> = { ...obj };
  for (const [key, value] of Object.entries(patch)) {
    if (key in obj) next[key] = value;
  }
  return next as unknown as EditorObject;
}

export function WysiwygEditor({
  pdf,
  state,
  dispatch,
  runBar,
  footer,
}: {
  pdf: LoadedPdf;
  /**
   * The editor's state lives with its RUNNER (`edit-runner.tsx`, which owns
   * the run and its result), so the objects survive the result panel and
   * "adjust" returns to them.
   */
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** The runner's Apply row, drawn under the pages. */
  runBar: ReactNode;
  /** Drawn under the editor while it is open (not under the result). */
  footer?: ReactNode;
}) {
  const kit = useTextKit();
  const [pickError, setError] = useState<string | null>(null);
  const { announce, node: liveRegion } = useAnnouncer();
  const [frames, setFrames] = useState<ExportFrame[] | null>(null);
  const [doc, setDoc] = useState<EditorPdf | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ zoom: number; fit: boolean }>({
    zoom: 1,
    fit: true,
  });
  const [view, setView] = useState({ top: 0, height: 800, width: 0 });
  const [guides, setGuides] = useState<{
    page: number;
    lines: SnapGuide[];
  } | null>(null);
  const [marquee, setMarquee] = useState<{ page: number; rect: Rect } | null>(
    null,
  );
  const [signing, setSigning] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const drag = useRef<Drag | null>(null);
  const clipboard = useRef<EditorObject[]>([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const editorRoot = useRef<HTMLDivElement>(null);
  // Handlers read the latest state through this; render reads `state`.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (state.said.n > 0) announce(state.said.message);
  }, [state.said, announce]);

  // Page frames (pdf-lib — the export's own reading) and the pdf.js document.
  useEffect(() => {
    let alive = true;
    let opened: EditorPdf | null = null;
    readExportFrames(pdf.bytes)
      .then((f) => alive && setFrames(f))
      .catch(
        () => alive && setOpenError("This PDF's pages could not be read."),
      );
    openEditorPdf(pdf.bytes)
      .then((d) => {
        opened = d;
        if (alive) setDoc(d);
        else void d.destroy();
      })
      .catch(
        () => alive && setOpenError("This PDF's pages could not be drawn."),
      );
    return () => {
      alive = false;
      void opened?.destroy();
    };
  }, [pdf.bytes]);

  const sizes = useMemo(
    () => frames?.map((f) => ({ width: f.width, height: f.height })) ?? [],
    [frames],
  );
  const fitPageWidth = useMemo(
    () => typicalPageWidth(sizes.map((s) => s.width)),
    [sizes],
  );
  const scale = scaleForZoom(zoom.zoom);
  const layout = useMemo(() => layoutPages(sizes, scale), [sizes, scale]);
  const near = useMemo(
    () => new Set(pagesNear(layout.slots, view.top, view.height, 900)),
    [layout, view.top, view.height],
  );
  const current = currentPage(layout.slots, view.top, view.height);

  // Fit width, measured before paint so the first frame is the final one.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el || fitPageWidth <= 0) return;
    const measure = () => {
      const width = el.clientWidth;
      setView((v) => ({ ...v, width, height: el.clientHeight }));
      setZoom((z) =>
        z.fit ? { zoom: fitWidthZoom(width - 32, fitPageWidth), fit: true } : z,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitPageWidth]);

  // Keep the point at the centre of the view where it was across a zoom.
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const changeZoom = useCallback((next: number, fit = false) => {
    const el = viewport.current;
    if (el) {
      anchor.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth),
        y: (el.scrollTop + el.clientHeight / 2) / Math.max(1, el.scrollHeight),
      };
    }
    setZoom({ zoom: clampZoom(next), fit });
  }, []);
  useLayoutEffect(() => {
    const el = viewport.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollTop = a.y * el.scrollHeight - el.clientHeight / 2;
    el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2;
  }, [scale]);

  const fitNow = useCallback(() => {
    const el = viewport.current;
    if (!el || fitPageWidth <= 0) return;
    changeZoom(fitWidthZoom(el.clientWidth - 32, fitPageWidth), true);
  }, [fitPageWidth, changeZoom]);

  // Scroll position → virtualisation and the current page.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setView((v) =>
          v.top === el.scrollTop && v.height === el.clientHeight
            ? v
            : { ...v, top: el.scrollTop, height: el.clientHeight },
        ),
      );
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Ctrl/Cmd + wheel and two-finger pinch zoom the pages, not the browser.
  const zoomRef = useRef(zoom.zoom);
  useLayoutEffect(() => {
    zoomRef.current = zoom.zoom;
  }, [zoom.zoom]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      changeZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0025));
    };
    let pinch: { dist: number; zoom: number } | null = null;
    const distance = (t: TouchList) =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch = { dist: distance(e.touches), zoom: zoomRef.current };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      changeZoom((pinch.zoom * distance(e.touches)) / pinch.dist);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [changeZoom]);

  const jumpTo = useCallback(
    (index: number) => {
      const el = viewport.current;
      const slot = layout.slots[index];
      if (el && slot) el.scrollTo({ top: slot.top - 8 });
    },
    [layout],
  );

  /* ------------------------------ objects ------------------------------ */

  const shown = (obj: EditorObject): EditorObject => {
    const p = state.preview?.[obj.id];
    if (p) return p;
    if (state.editing?.id === obj.id) {
      return { ...(obj as TextBoxObject), text: state.editing.text };
    }
    return obj;
  };

  const boundsOf = useCallback(
    (obj: EditorObject): Rect =>
      kit
        ? objectBounds(obj, (o) => kit.height(o))
        : objectBounds(obj, () => 20),
    [kit],
  );

  const commitAdd = useCallback(
    (obj: EditorObject, say: string) => {
      dispatch({
        type: "commit",
        command: {
          label: `Add ${describeObject(obj).split(" on ")[0]!.toLowerCase()}`,
          changes: [
            {
              id: obj.id,
              before: null,
              after: obj,
              at: stateRef.current.objects.length,
            },
          ],
        },
        select: [obj.id],
        say,
      });
    },
    [dispatch],
  );

  const deleteSelected = useCallback(() => {
    const s = stateRef.current;
    const doomed = s.objects.filter((o) => s.selected.includes(o.id));
    if (doomed.length === 0) return;
    dispatch({
      type: "commit",
      command: {
        label: doomed.length === 1 ? "Delete" : `Delete ${doomed.length} items`,
        changes: doomed.map((o) => changeOf(s.objects, o, null)),
      },
      select: [],
      say:
        doomed.length === 1 ? "Item deleted" : `${doomed.length} items deleted`,
    });
  }, [dispatch]);

  const pasteObjects = useCallback(
    (source: EditorObject[], label: string) => {
      if (source.length === 0 || !frames) return;
      const s = stateRef.current;
      const samePage = source.every((o) => o.page === source[0]!.page);
      const target = samePage ? current : null;
      const copies = source.map((o) => {
        let copy = cloneObject(o);
        if (target !== null && target !== o.page)
          copy = { ...copy, page: target };
        copy = moveObject(copy, PASTE_OFFSET, PASTE_OFFSET);
        const f = frames[copy.page];
        if (f) {
          const b = boundsOf(copy);
          const fix = clampRectToPage(b, f.width, f.height);
          copy = moveObject(copy, fix.dx, fix.dy);
        }
        return copy;
      });
      let at = s.objects.length;
      dispatch({
        type: "commit",
        command: {
          label,
          changes: copies.map((c) => ({
            id: c.id,
            before: null,
            after: c,
            at: at++,
          })),
        },
        select: copies.map((c) => c.id),
        say: `${label}: ${copies.length} item${copies.length === 1 ? "" : "s"}`,
      });
    },
    [dispatch, boundsOf, current, frames],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const s = stateRef.current;
      const moving = s.objects.filter((o) => s.selected.includes(o.id));
      if (moving.length === 0 || !frames) return;
      const changes: Change[] = moving.map((o) => {
        let next = moveObject(o, dx, dy);
        const f = frames[o.page];
        if (f) {
          const fix = clampRectToPage(boundsOf(next), f.width, f.height);
          next = moveObject(next, fix.dx, fix.dy);
        }
        return changeOf(s.objects, o, next);
      });
      dispatch({
        type: "commit",
        command: {
          label: "Nudge",
          changes,
          coalesce: `nudge:${s.selected.join(",")}`,
        },
      });
    },
    [dispatch, boundsOf, frames],
  );

  const patchSelection = useCallback(
    (patch: StylePatch, key: string) => {
      const s = stateRef.current;
      const targets = s.objects.filter((o) => s.selected.includes(o.id));
      const bucket = targets[0] ? bucketOf(targets[0]) : bucketOfTool(s.tool);
      // The choice becomes the next object's default too.
      if (bucket && bucket in s.defaults) {
        const k = bucket as keyof Defaults;
        const base = s.defaults[k] as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...base };
        for (const [field, value] of Object.entries(patch)) {
          if (field in base) merged[field] = value;
        }
        dispatch({
          type: "defaults",
          patch: { [k]: merged } as Partial<Defaults>,
        });
      }
      if (targets.length === 0) return;
      const changes = targets
        .map((o) => changeOf(s.objects, o, applyPatch(o, patch)))
        .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
      if (changes.length === 0) return;
      dispatch({
        type: "commit",
        command: {
          label: "Change style",
          changes,
          coalesce: `style:${key}:${s.selected.join(",")}`,
        },
      });
    },
    [dispatch],
  );

  /* ------------------------------ tools ------------------------------ */

  const chooseTool = useCallback(
    (tool: Tool) => {
      dispatch({ type: "tool", tool });
      setSigning(tool === "signature" && !stateRef.current.pending);
      if (tool === "image") imageInput.current?.click();
      const label = TOOL_BUTTONS.find((b) => b.tool === tool)?.label ?? tool;
      dispatch({ type: "say", message: `${label} tool` });
    },
    [dispatch],
  );

  const onPickImage = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const bytes = await readFileBytes(file);
        const format = sniffImageFormat(bytes);
        if (!format || checkEditImage(format, bytes)) {
          throw new Error(
            `"${file.name}" must be a PNG or JPG under ${MAX_IMAGE_MB} MB.`,
          );
        }
        const size = await imageSize(bytes, format);
        const pending: PendingImage = { kind: "image", format, bytes, ...size };
        dispatch({ type: "pending", pending });
        dispatch({ type: "tool", tool: "image" });
        dispatch({
          type: "say",
          message: "Image ready: click on a page to place it",
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "That image can't be used.",
        );
      }
    },
    [dispatch, setError],
  );

  const placePending = useCallback(
    (page: number, at: Pt) => {
      const s = stateRef.current;
      const p = s.pending;
      const f = frames?.[page];
      if (!p || !f) return false;
      const want = p.kind === "signature" ? 160 : 200;
      const width = Math.min(want, f.width * 0.8, p.width);
      const height = (width * p.height) / p.width;
      let rect = { x: at.x - width / 2, y: at.y - height / 2, width, height };
      const fix = clampRectToPage(rect, f.width, f.height);
      rect = { ...rect, x: rect.x + fix.dx, y: rect.y + fix.dy };
      const id = newObjectId();
      const obj: EditorObject =
        p.kind === "signature"
          ? {
              id,
              kind: "signature",
              page,
              ...rect,
              format: p.format,
              bytes: p.bytes,
            }
          : {
              id,
              kind: "image",
              page,
              ...rect,
              format: p.format,
              bytes: p.bytes,
              opacity: 1,
            };
      commitAdd(
        obj,
        p.kind === "signature" ? "Signature placed" : "Image placed",
      );
      dispatch({ type: "tool", tool: "select" });
      dispatch({ type: "select", ids: [id] });
      return true;
    },
    [dispatch, commitAdd, frames],
  );

  const startText = useCallback(
    (kind: "text" | "note", page: number, at: Pt) => {
      const s = stateRef.current;
      const f = frames?.[page];
      if (!f) return;
      const style = kind === "note" ? s.defaults.note : s.defaults.text;
      const width = Math.max(
        48,
        Math.min(kind === "note" ? 160 : 220, f.width - at.x - 4),
      );
      const lineSlot = style.size * style.lineHeight;
      const x = Math.max(0, Math.min(at.x, f.width - width));
      const y = Math.max(
        0,
        at.y - (kind === "note" ? NOTE_PADDING : 0) - lineSlot / 2,
      );
      const id = newObjectId();
      const base: TextBoxObject | NoteObject =
        kind === "note"
          ? {
              id,
              kind: "note",
              page,
              x,
              y,
              width,
              text: "",
              ...s.defaults.note,
            }
          : {
              id,
              kind: "text",
              page,
              x,
              y,
              width,
              text: "",
              ...s.defaults.text,
            };
      dispatch({
        type: "startEdit",
        edit: { id, isNew: true, text: "", base },
      });
    },
    [dispatch, frames],
  );

  const editExisting = useCallback(
    (obj: TextBoxObject | NoteObject) => {
      dispatch({
        type: "startEdit",
        edit: { id: obj.id, isNew: false, text: obj.text, base: obj },
      });
    },
    [dispatch],
  );

  /* ------------------------------ pointer ------------------------------ */

  const pointIn = useCallback(
    (el: HTMLElement, e: { clientX: number; clientY: number }): Pt => {
      const r = el.getBoundingClientRect();
      return screenToViewer(e.clientX - r.left, e.clientY - r.top, scale);
    },
    [scale],
  );

  const onPagePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, page: number) => {
      if (e.button !== 0) return;
      const el = pageEls.current.get(page);
      if (!el || !frames) return;
      const s = stateRef.current;
      const target = e.target as Element;
      const pt = pointIn(el, e);
      const handleEl = target.closest<SVGElement>("[data-handle]");
      const objectEl = target.closest<SVGElement>("[data-object-id]");
      const hit = objectEl
        ? s.objects.find((o) => o.id === objectEl.dataset.objectId)
        : undefined;

      if (s.editing) {
        // A press outside the box being typed in finishes it first.
        if (!(target as HTMLElement).closest("[data-text-editor]")) {
          dispatch({ type: "endEdit" });
        } else return;
      }

      if (s.tool === "select") {
        if (handleEl) {
          const id = handleEl.dataset.handleFor!;
          const obj = s.objects.find((o) => o.id === id);
          if (!obj) return;
          e.preventDefault();
          const h = handleEl.dataset.handle!;
          drag.current =
            h === "p1" || h === "p2"
              ? {
                  kind: "end",
                  page,
                  el,
                  obj: obj as LineObject,
                  end: h === "p1" ? 1 : 2,
                }
              : {
                  kind: "resize",
                  page,
                  el,
                  obj,
                  from: boundsOf(obj),
                  handle: h as Handle,
                };
          return;
        }
        if (hit) {
          e.preventDefault();
          let selected = s.selected;
          if (e.shiftKey) {
            selected = selected.includes(hit.id)
              ? selected.filter((id) => id !== hit.id)
              : [...selected, hit.id];
            dispatch({ type: "select", ids: selected });
          } else if (!selected.includes(hit.id)) {
            selected = [hit.id];
            dispatch({ type: "select", ids: selected });
          }
          const originals = s.objects.filter(
            (o) => selected.includes(o.id) && o.page === page,
          );
          if (originals.length > 0) {
            drag.current = {
              kind: "move",
              page,
              el,
              start: pt,
              originals,
              moved: false,
              clickedId: hit.id,
              additive: e.shiftKey,
            };
          }
          return;
        }
        // Empty page: clear (unless adding) and draw a selection box.
        if (!e.shiftKey && s.selected.length > 0)
          dispatch({ type: "select", ids: [] });
        if (e.pointerType !== "touch") {
          drag.current = {
            kind: "marquee",
            page,
            el,
            start: pt,
            current: pt,
            additive: e.shiftKey,
          };
        }
        return;
      }

      // A placing tool.
      e.preventDefault();
      if (s.tool === "text" || s.tool === "note") {
        if (hit && (hit.kind === "text" || hit.kind === "note"))
          editExisting(hit);
        else startText(s.tool, page, pt);
        return;
      }
      if (s.tool === "image" || s.tool === "signature") {
        if (!placePending(page, pt)) {
          if (s.tool === "image") imageInput.current?.click();
          else setSigning(true);
        }
        return;
      }
      if (s.tool === "ink") {
        drag.current = {
          kind: "ink",
          page,
          el,
          points: [pt],
          id: newObjectId(),
        };
        return;
      }
      if (PLACING.has(s.tool)) {
        drag.current = {
          kind: "create",
          page,
          el,
          tool: s.tool,
          start: pt,
          current: pt,
          id: newObjectId(),
        };
      }
    },
    [
      dispatch,
      boundsOf,
      editExisting,
      frames,
      placePending,
      pointIn,
      startText,
    ],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || !frames) return;
      const f = frames[d.page]!;
      const pt = pointIn(d.el, e);
      const show = (objects: Record<string, EditorObject>) => {
        d.last = objects;
        dispatch({ type: "preview", objects });
      };
      const clampPt = (p: Pt): Pt => ({
        x: Math.min(f.width, Math.max(0, p.x)),
        y: Math.min(f.height, Math.max(0, p.y)),
      });
      switch (d.kind) {
        case "move": {
          let dx = pt.x - d.start.x;
          let dy = pt.y - d.start.y;
          if (!d.moved && Math.hypot(dx, dy) * scale < 3) return;
          d.moved = true;
          const box = unionRect(d.originals.map((o) => boundsOf(o)));
          const moved = { ...box, x: box.x + dx, y: box.y + dy };
          const snap = e.altKey
            ? { dx: 0, dy: 0, guides: [] }
            : snapRect(moved, f.width, f.height, SNAP_PX / scale);
          dx += snap.dx;
          dy += snap.dy;
          const fix = clampRectToPage(
            { ...box, x: box.x + dx, y: box.y + dy },
            f.width,
            f.height,
          );
          dx += fix.dx;
          dy += fix.dy;
          setGuides(
            snap.guides.length ? { page: d.page, lines: snap.guides } : null,
          );
          show(
            Object.fromEntries(
              d.originals.map((o) => [o.id, moveObject(o, dx, dy)]),
            ),
          );
          return;
        }
        case "resize": {
          const p = clampPt(pt);
          const keep =
            d.obj.kind === "image" || d.obj.kind === "signature"
              ? !e.shiftKey
              : e.shiftKey;
          const rect = dragHandle(d.from, d.handle, p.x, p.y, keep);
          show({ [d.obj.id]: resizeObject(d.obj, d.from, rect) });
          return;
        }
        case "end":
          show({ [d.obj.id]: setLineEndpoint(d.obj, d.end, clampPt(pt)) });
          return;
        case "create": {
          d.current = clampPt(pt);
          const obj = makeObject(
            d.tool,
            d.page,
            rectFromPoints(d.start, d.current),
            d.start,
            d.current,
            stateRef.current.defaults,
            d.id,
          );
          if (obj) show({ [d.id]: obj });
          return;
        }
        case "ink": {
          const p = clampPt(pt);
          const last = d.points[d.points.length - 1]!;
          if (Math.hypot(p.x - last.x, p.y - last.y) < 0.75) return;
          d.points.push(p);
          show({
            [d.id]: {
              id: d.id,
              kind: "ink",
              page: d.page,
              points: d.points.slice(),
              ...stateRef.current.defaults.ink,
            },
          });
          return;
        }
        case "marquee":
          d.current = clampPt(pt);
          setMarquee({
            page: d.page,
            rect: rectFromPoints(d.start, d.current),
          });
          return;
      }
    };

    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      if (!d || !frames) return;
      const s = stateRef.current;
      setGuides(null);
      const previewOf = (id: string) => d.last?.[id];
      switch (d.kind) {
        case "move": {
          if (!d.moved) {
            dispatch({ type: "preview", objects: null });
            if (!d.additive && s.selected.length > 1) {
              dispatch({ type: "select", ids: [d.clickedId] });
            }
            return;
          }
          dispatch({
            type: "commit",
            command: {
              label:
                d.originals.length === 1
                  ? "Move"
                  : `Move ${d.originals.length} items`,
              changes: d.originals.map((o) =>
                changeOf(s.objects, o, previewOf(o.id) ?? o),
              ),
            },
            say: "Moved",
          });
          return;
        }
        case "resize":
        case "end": {
          const next = previewOf(d.obj.id);
          if (!next) return dispatch({ type: "preview", objects: null });
          dispatch({
            type: "commit",
            command: {
              label: "Resize",
              changes: [changeOf(s.objects, d.obj, next)],
            },
            say: "Resized",
          });
          return;
        }
        case "create": {
          const dragged =
            Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y) *
              scale >=
            4;
          let obj = previewOf(d.id) ?? null;
          if (!dragged) {
            const size = CLICK_SIZE[d.tool] ?? { width: 100, height: 60 };
            const f = frames[d.page]!;
            const rect = {
              x: Math.max(
                0,
                Math.min(d.start.x - size.width / 2, f.width - size.width),
              ),
              y: Math.max(
                0,
                Math.min(d.start.y - size.height / 2, f.height - size.height),
              ),
              ...size,
            };
            obj = makeObject(
              d.tool,
              d.page,
              rect,
              { x: rect.x, y: rect.y },
              { x: rect.x + rect.width, y: rect.y + rect.height },
              s.defaults,
              d.id,
            );
          }
          if (!obj) return dispatch({ type: "preview", objects: null });
          commitAdd(obj, `${describeObject(obj).split(" on ")[0]} added`);
          dispatch({ type: "tool", tool: "select" });
          dispatch({ type: "select", ids: [obj.id] });
          return;
        }
        case "ink": {
          const obj = previewOf(d.id) ?? {
            id: d.id,
            kind: "ink" as const,
            page: d.page,
            points: d.points.slice(),
            ...s.defaults.ink,
          };
          commitAdd(obj, "Drawing added");
          dispatch({ type: "select", ids: [] });
          return;
        }
        case "marquee": {
          setMarquee(null);
          const box = rectFromPoints(d.start, d.current);
          if (box.width * scale < 3 && box.height * scale < 3) return;
          const hits = s.objects
            .filter(
              (o) => o.page === d.page && rectsIntersect(boundsOf(o), box),
            )
            .map((o) => o.id);
          dispatch({
            type: "select",
            ids: d.additive ? [...new Set([...s.selected, ...hits])] : hits,
          });
          if (hits.length) {
            dispatch({
              type: "say",
              message: `${hits.length} item${hits.length === 1 ? "" : "s"} selected`,
            });
          }
          return;
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dispatch, boundsOf, commitAdd, frames, pointIn, scale]);

  /* ------------------------------ keyboard ------------------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const root = editorRoot.current;
      const active = document.activeElement;
      if (
        root &&
        active &&
        active !== document.body &&
        !root.contains(active)
      ) {
        return;
      }
      const s = stateRef.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (mod && key === "c") {
        const picked = s.objects.filter((o) => s.selected.includes(o.id));
        if (picked.length) {
          clipboard.current = picked;
          dispatch({
            type: "say",
            message: `Copied ${picked.length} item${picked.length === 1 ? "" : "s"}`,
          });
        }
        return;
      }
      if (mod && key === "v") {
        if (clipboard.current.length) {
          e.preventDefault();
          pasteObjects(clipboard.current, "Paste");
        }
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        pasteObjects(
          s.objects.filter((o) => s.selected.includes(o.id)),
          "Duplicate",
        );
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        dispatch({
          type: "select",
          ids: s.objects.filter((o) => o.page === current).map((o) => o.id),
        });
        return;
      }
      if (mod) return;
      if (e.key === "Escape") {
        if (s.tool !== "select") chooseTool("select");
        else if (s.selected.length) dispatch({ type: "select", ids: [] });
        setSigning(false);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selected.length) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      const step = e.shiftKey ? NUDGE_BIG_PT : NUDGE_PT;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (arrows[e.key] && s.selected.length) {
        e.preventDefault();
        nudge(...arrows[e.key]!);
        return;
      }
      if (e.key === "Enter" && s.selected.length === 1) {
        const obj = s.objects.find((o) => o.id === s.selected[0]);
        if (obj && (obj.kind === "text" || obj.kind === "note")) {
          e.preventDefault();
          editExisting(obj);
        }
        return;
      }
      const tool = TOOL_BUTTONS.find((b) => b.key.toLowerCase() === key);
      if (tool && !e.altKey) chooseTool(tool.tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    dispatch,
    chooseTool,
    current,
    deleteSelected,
    editExisting,
    nudge,
    pasteObjects,
  ]);

  /* ------------------------------ render ------------------------------ */

  const selection = state.objects.filter((o) => state.selected.includes(o.id));
  const ready = !!frames && !!kit;
  const panelBucket = bucketOfTool(state.tool);
  const showPanel = selection.length > 0 || panelBucket !== null;
  const panel = showPanel ? (
    <PropertiesPanel
      selection={selection}
      bucket={panelBucket}
      defaults={state.defaults}
      onPatch={patchSelection}
      onDelete={deleteSelected}
      onDuplicate={() => pasteObjects(selection, "Duplicate")}
    />
  ) : (
    <p className="text-muted text-xs leading-relaxed">
      Pick a tool, then click on a page to place it. Select an item to move it,
      resize it from its handles, or change its style here.
    </p>
  );

  return (
    <div
      ref={editorRoot}
      className="flex flex-col gap-3"
      data-wysiwyg-editor=""
    >
      <FileHeader pdf={pdf} />
      {liveRegion}
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        tabIndex={-1}
        aria-label={`Choose a PNG or JPG image (max ${MAX_IMAGE_MB} MB)`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onPickImage(file);
        }}
      />

      <div className="flex flex-col gap-2">
        <div className="border-line bg-panel rounded-panel order-2 border sm:order-1">
          <EditorToolbar
            tool={state.tool}
            onTool={chooseTool}
            canUndo={state.history.past.length > 0}
            canRedo={state.history.future.length > 0}
            onUndo={() => dispatch({ type: "undo" })}
            onRedo={() => dispatch({ type: "redo" })}
            zoom={zoom.zoom}
            fit={zoom.fit}
            onZoom={(z) => changeZoom(z)}
            onFit={fitNow}
          />
        </div>

        {signing && (
          <div className="order-1 sm:order-2">
            <SignaturePanel
              onClose={() => setSigning(false)}
              onReady={(pending) => {
                dispatch({ type: "pending", pending });
                dispatch({ type: "tool", tool: "signature" });
                setSigning(false);
                dispatch({
                  type: "say",
                  message: "Signature ready: click on a page to place it",
                });
              }}
            />
          </div>
        )}

        <div className="order-1 grid gap-3 sm:order-3 lg:grid-cols-[7.25rem_minmax(0,1fr)_15rem]">
          <div className="hidden h-[min(76vh,1100px)] min-h-[420px] lg:block">
            {ready && (
              <ThumbnailRail
                doc={doc}
                sizes={sizes}
                current={current}
                onJump={jumpTo}
              />
            )}
          </div>

          <div
            ref={viewport}
            data-editor-viewport=""
            tabIndex={-1}
            className="bg-wash border-line rounded-panel relative h-[52vh] min-h-[320px] [touch-action:pan-x_pan-y] overflow-auto border outline-none sm:h-[min(76vh,1100px)] sm:min-h-[420px]"
          >
            {openError ? (
              <div className="p-6">
                <ErrorNote message={openError} />
              </div>
            ) : !ready ? (
              <div key="loading" className="flex justify-center p-8">
                <div className="w-[180px]">
                  <PagePreviewPlaceholder pageNumber={1} />
                </div>
              </div>
            ) : (
              <div
                key="pages"
                className="relative mx-auto"
                style={{
                  width: Math.max(layout.width, view.width),
                  height: layout.height,
                }}
              >
                {layout.slots.map((slot) => (
                  <PageSheet
                    key={slot.index}
                    slotTop={slot.top}
                    width={slot.width}
                    height={slot.height}
                    containerWidth={view.width}
                    index={slot.index}
                    count={layout.slots.length}
                    frame={frames![slot.index]!}
                    scale={scale}
                    doc={doc}
                    near={near.has(slot.index)}
                    kit={kit!}
                    objects={state.objects.filter((o) => o.page === slot.index)}
                    pendingNew={
                      state.editing?.isNew &&
                      state.editing.base.page === slot.index
                        ? { ...state.editing.base, text: state.editing.text }
                        : null
                    }
                    previewNew={Object.values(state.preview ?? {}).filter(
                      (o) =>
                        o.page === slot.index &&
                        !state.objects.some((x) => x.id === o.id),
                    )}
                    shown={shown}
                    selected={state.selected}
                    editing={state.editing}
                    tool={state.tool}
                    guides={guides?.page === slot.index ? guides.lines : []}
                    marquee={marquee?.page === slot.index ? marquee.rect : null}
                    boundsOf={boundsOf}
                    registerEl={(el) => {
                      if (el) pageEls.current.set(slot.index, el);
                      else pageEls.current.delete(slot.index);
                    }}
                    onPointerDown={onPagePointerDown}
                    onDoubleClickObject={(obj) => {
                      if (obj.kind === "text" || obj.kind === "note")
                        editExisting(obj);
                    }}
                    onFocusObject={(id) => {
                      if (!stateRef.current.selected.includes(id)) {
                        dispatch({ type: "select", ids: [id] });
                      }
                    }}
                    onEditText={(text) => dispatch({ type: "editText", text })}
                    onEndEdit={() => dispatch({ type: "endEdit" })}
                  />
                ))}
              </div>
            )}
          </div>

          <aside className="border-line bg-panel rounded-panel hidden h-fit border p-3 lg:block">
            {panel}
          </aside>
        </div>

        <div className="border-line bg-panel rounded-panel order-3 border p-3 sm:order-4 lg:hidden">
          {panel}
        </div>
      </div>

      <p className="text-muted text-xs">
        {ready
          ? `Page ${current + 1} of ${sizes.length} · ${Math.round(zoom.zoom * 100)}% · ${state.objects.length} item${state.objects.length === 1 ? "" : "s"} placed`
          : "Reading pages…"}
      </p>

      {pickError && <ErrorNote message={pickError} />}
      {runBar}
      {footer}
    </div>
  );
}

/* ------------------------------ one page ------------------------------ */

const HANDLE_PX = 9;
/** A fingertip needs a bigger target than a cursor. */
const HANDLE_PX_TOUCH = 18;

const coarseQuery = "(pointer: coarse)";
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia === "undefined") return () => {};
      const mq = matchMedia(coarseQuery);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => typeof matchMedia !== "undefined" && matchMedia(coarseQuery).matches,
    () => false,
  );
}

function handlePoint(rect: Rect, h: Handle): Pt {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return {
    x: h.includes("w") ? rect.x : h.includes("e") ? rect.x + rect.width : cx,
    y: h.includes("n") ? rect.y : h.includes("s") ? rect.y + rect.height : cy,
  };
}

const CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

function PageSheet({
  slotTop,
  width,
  height,
  containerWidth,
  index,
  count,
  frame,
  scale,
  doc,
  near,
  kit,
  objects,
  pendingNew,
  previewNew,
  shown,
  selected,
  editing,
  tool,
  guides,
  marquee,
  boundsOf,
  registerEl,
  onPointerDown,
  onDoubleClickObject,
  onFocusObject,
  onEditText,
  onEndEdit,
}: {
  slotTop: number;
  width: number;
  height: number;
  containerWidth: number;
  index: number;
  count: number;
  frame: ExportFrame;
  scale: number;
  doc: EditorPdf | null;
  near: boolean;
  kit: TextKit;
  objects: EditorObject[];
  pendingNew: TextBoxObject | NoteObject | null;
  previewNew: EditorObject[];
  shown: (obj: EditorObject) => EditorObject;
  selected: string[];
  editing: { id: string; text: string } | null;
  tool: Tool;
  guides: SnapGuide[];
  marquee: Rect | null;
  boundsOf: (obj: EditorObject) => Rect;
  registerEl: (el: HTMLDivElement | null) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, page: number) => void;
  onDoubleClickObject: (obj: EditorObject) => void;
  onFocusObject: (id: string) => void;
  onEditText: (text: string) => void;
  onEndEdit: () => void;
}) {
  const drawn = [...objects.map(shown), ...previewNew];
  const editingObj =
    pendingNew ??
    (editing
      ? (drawn.find((o) => o.id === editing.id) as
          TextBoxObject | NoteObject | undefined)
      : undefined);
  if (pendingNew) drawn.push(pendingNew);
  const textsToLoad = drawn
    .filter(
      (o): o is TextBoxObject | NoteObject =>
        o.kind === "text" || o.kind === "note",
    )
    .map((o) => o.text);
  useEffect(() => {
    for (const t of textsToLoad) kit.request(t);
  });

  const placing = tool !== "select";
  const coarse = useCoarsePointer();
  const handleSize = (coarse ? HANDLE_PX_TOUCH : HANDLE_PX) / scale;
  // Centred in the visible width when it fits; a page wider than the view
  // starts at the gutter and the column scrolls sideways.
  const left =
    width + 2 * COLUMN_PAD <= containerWidth
      ? (containerWidth - width) / 2
      : COLUMN_PAD;

  return (
    <div
      ref={registerEl}
      data-editor-page={index}
      data-page-pt={`${frame.width}x${frame.height}`}
      role="group"
      aria-label={`Page ${index + 1} of ${count}`}
      className={cn(
        "absolute bg-white shadow-md ring-1 ring-black/10 select-none",
        placing ? "cursor-crosshair [touch-action:none]" : "cursor-default",
      )}
      style={{ top: slotTop, left, width, height }}
      onPointerDown={(e) => onPointerDown(e, index)}
    >
      <PageCanvas doc={doc} index={index} scale={scale} near={near} />
      {/* Far pages are bare sheets: no raster, no object layer (their
          objects are off screen, and a 500-page file would otherwise draw
          every one of them on every scroll frame). */}
      {(near || editingObj) && (
        <svg
          className="absolute inset-0 overflow-visible"
          width={width}
          height={height}
          viewBox={`0 0 ${frame.width} ${frame.height}`}
          aria-hidden={drawn.length === 0 ? true : undefined}
        >
          {drawn.map((obj) => {
            const isSel = selected.includes(obj.id);
            return (
              <g
                key={obj.id}
                data-object-id={obj.id}
                data-object-kind={obj.kind}
                tabIndex={0}
                role="button"
                aria-label={describeObject(obj)}
                aria-pressed={isSel}
                onFocus={() => onFocusObject(obj.id)}
                onDoubleClick={() => onDoubleClickObject(obj)}
                className={cn(
                  "[touch-action:none] outline-none",
                  tool === "select" ? "cursor-move" : undefined,
                )}
              >
                <ObjectShape
                  obj={obj}
                  kit={kit}
                  hideWords={editing?.id === obj.id}
                />
                <HitArea obj={obj} scale={scale} />
                {/* Invisible box so a press anywhere on a text box or an
                  unfilled shape grabs it. */}
                {obj.kind !== "line" &&
                  obj.kind !== "ink" &&
                  (() => {
                    const b = boundsOf(obj);
                    return (
                      <rect
                        x={b.x}
                        y={b.y}
                        width={Math.max(b.width, 1)}
                        height={Math.max(b.height, 1)}
                        fill="transparent"
                      />
                    );
                  })()}
                {obj.kind === "whiteout" && (
                  <rect
                    {...boundsOf(obj)}
                    fill="none"
                    stroke="#94a3b8"
                    strokeDasharray={`${3 / scale} ${3 / scale}`}
                    strokeWidth={1 / scale}
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          })}

          {drawn
            .filter((o) => selected.includes(o.id) && editing?.id !== o.id)
            .map((obj) => {
              const b = boundsOf(obj);
              if (obj.kind === "line") {
                return (
                  <g key={`sel-${obj.id}`}>
                    {(
                      [
                        ["p1", obj.x1, obj.y1],
                        ["p2", obj.x2, obj.y2],
                      ] as const
                    ).map(([h, x, y]) => (
                      <circle
                        key={h}
                        data-handle={h}
                        data-handle-for={obj.id}
                        cx={x}
                        cy={y}
                        r={handleSize / 1.4}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth={1.5 / scale}
                        style={{ cursor: "crosshair", touchAction: "none" }}
                      />
                    ))}
                  </g>
                );
              }
              return (
                <g key={`sel-${obj.id}`}>
                  <rect
                    x={b.x}
                    y={b.y}
                    width={b.width}
                    height={b.height}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={1.25 / scale}
                    strokeDasharray={`${4 / scale} ${3 / scale}`}
                    pointerEvents="none"
                  />
                  {selected.length === 1 &&
                    handlesFor(obj).map((h) => {
                      const p = handlePoint(b, h);
                      return (
                        <rect
                          key={h}
                          data-handle={h}
                          data-handle-for={obj.id}
                          x={p.x - handleSize / 2}
                          y={p.y - handleSize / 2}
                          width={handleSize}
                          height={handleSize}
                          fill="#ffffff"
                          stroke="#2563eb"
                          strokeWidth={1.5 / scale}
                          style={{ cursor: CURSOR[h], touchAction: "none" }}
                        />
                      );
                    })}
                </g>
              );
            })}

          {guides.map((g, i) =>
            g.axis === "x" ? (
              <line
                key={i}
                data-snap-guide="x"
                x1={g.at}
                y1={0}
                x2={g.at}
                y2={frame.height}
                stroke="#db2777"
                strokeWidth={1 / scale}
                pointerEvents="none"
              />
            ) : (
              <line
                key={i}
                data-snap-guide="y"
                x1={0}
                y1={g.at}
                x2={frame.width}
                y2={g.at}
                stroke="#db2777"
                strokeWidth={1 / scale}
                pointerEvents="none"
              />
            ),
          )}
          {marquee && (
            <rect
              {...marquee}
              fill="#2563eb"
              fillOpacity={0.08}
              stroke="#2563eb"
              strokeWidth={1 / scale}
              pointerEvents="none"
            />
          )}
        </svg>
      )}

      {editingObj && editing && (
        <TextEditor
          obj={editingObj}
          text={editing.text}
          kit={kit}
          scale={scale}
          onChange={onEditText}
          onDone={onEndEdit}
        />
      )}
    </div>
  );
}

function TextEditor({
  obj,
  text,
  kit,
  scale,
  onChange,
  onDone,
}: {
  obj: TextBoxObject | NoteObject;
  text: string;
  kit: TextKit;
  scale: number;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const inset = obj.kind === "note" ? NOTE_PADDING : 0;
  const layout = kit.layout(obj, text);
  const styled = kit.styled(obj, text);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      data-text-editor=""
      aria-label={obj.kind === "note" ? "Note text" : "Text box text"}
      value={text}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (
          e.key === "Escape" ||
          (e.key === "Enter" && (e.ctrlKey || e.metaKey))
        ) {
          e.preventDefault();
          onDone();
        }
      }}
      className="outline-accent absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-2 outline-offset-2 outline-dashed"
      style={{
        left: (obj.x + inset) * scale,
        top: (obj.y + inset) * scale,
        width: (obj.width - inset * 2) * scale,
        height: Math.max(layout.height, obj.size * obj.lineHeight) * scale + 2,
        fontFamily: kit.family(obj, text),
        fontSize: obj.size * scale,
        lineHeight: obj.lineHeight,
        fontWeight: styled && obj.bold ? 700 : 400,
        fontStyle: styled && obj.italic ? "italic" : "normal",
        color: obj.color,
        textAlign: obj.align,
        fontKerning: "none",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    />
  );
}
