"use client";

import {
  useCallback,
  useEffect,
  useId,
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
import { readEditorDocument } from "@/lib/pdf/editor-export";
import type { FieldFill, FileField } from "@/lib/pdf/editor/fields";
import {
  clampRectToPage,
  clampZoom,
  contentToViewer,
  fitWidthZoom,
  MIN_FIT_ZOOM,
  MIN_ZOOM,
  scaleForZoom,
  screenToViewer,
  snapPoint,
  snapRect,
  fitPageWidth,
  type ExportFrame,
  type SnapGuide,
} from "@/lib/pdf/editor/geometry";
import {
  changeOf,
  stackChanges,
  type Change,
  type StackMove,
} from "@/lib/pdf/editor/history";
import {
  deletePage,
  displayFrames,
  insertBlankAfter,
  movePage,
  rotatePage,
  type PageOp,
} from "@/lib/pdf/editor/pages";
import {
  formatDate,
  initialsOf,
  markObject,
  quickTextObject,
} from "@/lib/pdf/editor/quick-fields";
import { readSavedSignatures } from "@/lib/pdf/editor/saved-signatures";
import {
  linkUntouched,
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
  typedSignatureObject,
  NOTE_PADDING,
  NUDGE_BIG_PT,
  NUDGE_PT,
  type EditorFieldType,
  type EditorObject,
  type Handle,
  type LineObject,
  type NoteObject,
  type Rect,
  type TextBoxObject,
  type TextEditObject,
} from "@/lib/pdf/editor/model";
import { openEditorPdf, type EditorPdf } from "@/lib/pdf/editor/page-render";
import {
  openRunStyles,
  type RunStyleReader,
} from "@/lib/pdf/editor/run-styles";
import {
  editIsForRun,
  findMatches,
  ownFontCovers,
  placeRuns,
  replaceAt,
  substituteLabel,
  textEditFromRun,
  type FindMatch,
  type TextRun,
} from "@/lib/pdf/editor/runs";
import { CSS_FONT_STACK, needsUnicodeFace } from "@/lib/pdf/editor/text";
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
import { FindPanel, INITIAL_FIND, type FindState } from "./find-panel";
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
import { ThumbnailRail, type PageOps, type RailPage } from "./thumbnail-rail";
import { EditorToolbar, FIELD_TOOL, TOOL_BUTTONS } from "./toolbar";

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
        /** Where the press was, against the edge it moves (the frame is outset). */
        grab: Pt;
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

/** What a press handler reads of a pointer event; a held touch is replayed from a copy. */
type Press = {
  button: number;
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  pointerType: string;
  preventDefault: () => void;
  /** A held touch, let go before it became a long press. */
  replay?: boolean;
};

const PLACING: ReadonlySet<Tool> = new Set([
  "rect",
  "ellipse",
  "line",
  "arrow",
  "whiteout",
  "redact",
  "highlight",
  "link",
  "field-text",
  "field-checkbox",
  "field-dropdown",
  "field-radio",
  "field-signature",
]);

/** One click places one of these where it lands (and the tool stays on). */
const QUICK: ReadonlySet<Tool> = new Set(["date", "initials", "name", "check"]);

/** A long press (touch) selects what is under the finger, in any tool. */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 8;

const FIELD_NAME_PREFIX: Record<EditorFieldType, string> = {
  text: "Text",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  radio: "Radio",
  signature: "Signature",
};

/** The first `Text1`, `Text2`, … not already taken. */
function freshFieldName(type: EditorFieldType, taken: ReadonlySet<string>) {
  let n = 1;
  while (taken.has(`${FIELD_NAME_PREFIX[type]}${n}`)) n += 1;
  return `${FIELD_NAME_PREFIX[type]}${n}`;
}

const DEFAULT_OPTIONS = ["Option 1", "Option 2", "Option 3"];

const NO_RUNS: Record<number, TextRun[]> = {};

/** Properties-panel keys that change a form field rather than a style. */
const FIELD_KEYS: ReadonlySet<string> = new Set([
  "name",
  "options",
  "value",
  "checked",
  "multiline",
]);

const STACK_LABEL: Record<StackMove, string> = {
  front: "Bring to front",
  forward: "Bring forward",
  backward: "Send backward",
  back: "Send to back",
};

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
    case "redact":
      return { id, kind: "redact", page, ...rect, fill: defaults.redact.fill };
    case "highlight":
      return { id, kind: "highlight", page, ...rect, ...defaults.highlight };
    case "link":
      return {
        id,
        kind: "link",
        page,
        ...rect,
        target: { type: "uri", uri: "" },
      };
    default: {
      const fieldType = FIELD_TOOL[tool];
      if (!fieldType) return null;
      const square = fieldType === "checkbox";
      const side = Math.max(rect.width, rect.height);
      return {
        id,
        kind: "field",
        page,
        ...rect,
        ...(square ? { width: side, height: side } : {}),
        fieldType,
        // Named when committed (`nameField`), against every field there is.
        name: "",
        options:
          fieldType === "dropdown" || fieldType === "radio"
            ? [...DEFAULT_OPTIONS]
            : [],
        value: "",
        checked: false,
        multiline: false,
      };
    }
  }
}

/** The size a click (not a drag) gives a new shape. */
const CLICK_SIZE: Partial<Record<Tool, { width: number; height: number }>> = {
  rect: { width: 120, height: 72 },
  ellipse: { width: 100, height: 72 },
  whiteout: { width: 140, height: 28 },
  redact: { width: 140, height: 20 },
  highlight: { width: 160, height: 18 },
  line: { width: 120, height: 0 },
  arrow: { width: 120, height: 0 },
  link: { width: 140, height: 20 },
  "field-text": { width: 160, height: 22 },
  "field-checkbox": { width: 14, height: 14 },
  "field-dropdown": { width: 140, height: 22 },
  "field-radio": { width: 90, height: 54 },
  "field-signature": { width: 180, height: 44 },
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
  firstStep,
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
  /** One line above the pages: what to do first (Sign PDF says it). */
  firstStep?: ReactNode;
  /** The runner's Apply row, drawn under the pages. */
  runBar: ReactNode;
  /** Drawn under the editor while it is open (not under the result). */
  footer?: ReactNode;
}) {
  const kit = useTextKit();
  // Below `sm` (640 px): docked toolbar and a properties sheet. The editor
  // first renders after a file opens, on the client, so this is read before
  // its first paint and nothing moves between the two layouts.
  const narrow = useMedia(NARROW_QUERY);
  // At `lg` and up the page rail sits beside the pages; below it, the Pages
  // button opens the same list as a sheet.
  const wide = useMedia(WIDE_QUERY);
  const sheetRef = useRef<HTMLElement>(null);
  const [pickError, setError] = useState<string | null>(null);
  const { announce, node: liveRegion } = useAnnouncer();
  // The file's own page frames; the DISPLAYED frames follow the page list.
  const [sourceFrames, setSourceFrames] = useState<ExportFrame[] | null>(null);
  const [fileFields, setFileFields] = useState<FileField[]>([]);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [askName, setAskName] = useState("");
  const askNameId = useId();
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
  // Opened on Sign (Sign PDF), the editor starts with the signature panel.
  const [signing, setSigning] = useState(
    () => state.tool === "signature" && !state.pending,
  );
  // Edit text and Find & replace: pdf.js's text runs per page, read on
  // demand, and the content-stream reading of how each run is drawn.
  // Runs are per DISPLAYED page, so they are kept with the page list they
  // were read under: a page operation renumbers and turns pages, and what
  // was read for the old list is dropped, not shown on the wrong page.
  const [runState, setRunState] = useState<{
    for: EditorState["pages"];
    byPage: Record<number, TextRun[]>;
  }>(() => ({ for: state.pages, byPage: {} }));
  const runs = runState.for === state.pages ? runState.byPage : NO_RUNS;
  const runsRef = useRef(runs);
  useLayoutEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  const runsAsked = useRef(new Set<number>());
  const [styles, setStyles] = useState<RunStyleReader | null>(null);
  const stylesPromise = useRef<Promise<RunStyleReader> | null>(null);
  const [finding, setFinding] = useState(false);
  const [find, setFind] = useState<FindState>(INITIAL_FIND);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const drag = useRef<Drag | null>(null);
  const longPress = useRef<{
    timer: number;
    press: Press;
    page: number;
  } | null>(null);
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

  // The phone's properties sheet closes on a tap outside it: on the page's
  // empty paper (handled by the page itself), or anywhere off the editor.
  const hasSelection = state.selected.length > 0;
  useEffect(() => {
    if (!narrow || !hasSelection) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (
        !t ||
        sheetRef.current?.contains(t) ||
        t.closest("[data-editor-page]") ||
        t.closest("[data-editor-dock]")
      )
        return;
      dispatch({ type: "select", ids: [] });
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [narrow, hasSelection, dispatch]);

  // Page frames, links and form fields (pdf-lib — the export's own
  // reading) and the pdf.js document.
  useEffect(() => {
    let alive = true;
    let opened: EditorPdf | null = null;
    readEditorDocument(pdf.bytes)
      .then((read) => {
        if (!alive) return;
        setSourceFrames(read.frames);
        setFileFields(read.fields);
        // The file's links become objects once (the reducer ignores a
        // second import after "adjust").
        dispatch({ type: "import", links: read.links });
      })
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
  }, [pdf.bytes, dispatch]);

  const pages = state.pages;
  const frames = useMemo(
    () => (sourceFrames ? displayFrames(pages, sourceFrames) : null),
    [pages, sourceFrames],
  );
  const pageIds = useMemo(() => pages.map((p) => p.id), [pages]);
  /** The source page a displayed page draws, or null for a blank one. */
  const sourceOf = useCallback(
    (index: number) => pages[index]?.source ?? null,
    [pages],
  );

  const sizes = useMemo(
    () => frames?.map((f) => ({ width: f.width, height: f.height })) ?? [],
    [frames],
  );
  const fitWidth = useMemo(
    () => fitPageWidth(sizes.map((s) => s.width)),
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
    if (!el || fitWidth <= 0) return;
    const measure = () => {
      const width = el.clientWidth;
      setView((v) => ({ ...v, width, height: el.clientHeight }));
      setZoom((z) =>
        z.fit
          ? {
              zoom: fitWidthZoom(width - 2 * COLUMN_PAD - 1, fitWidth),
              fit: true,
            }
          : z,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitWidth]);

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
    // A fit zoom may go below the manual minimum (`MIN_FIT_ZOOM`). Clamped
    // to 50% here, choosing "Fit width" from the menu left a wide page 18 px
    // past the view's right edge at 1024 px (the e2e fit check's control
    // found it); the first, measured fit never went through this clamp.
    setZoom({ zoom: clampZoom(next, fit ? MIN_FIT_ZOOM : MIN_ZOOM), fit });
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
    if (!el || fitWidth <= 0) return;
    changeZoom(
      fitWidthZoom(el.clientWidth - 2 * COLUMN_PAD - 1, fitWidth),
      true,
    );
  }, [fitWidth, changeZoom]);

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
  const jumpToRef = useRef(jumpTo);
  useLayoutEffect(() => {
    jumpToRef.current = jumpTo;
  }, [jumpTo]);

  /* --------------------------- text on the page --------------------------- */

  const loadStyles = useCallback(() => {
    stylesPromise.current ??= openRunStyles(pdf.bytes).then((reader) => {
      setStyles(reader);
      return reader;
    });
    return stylesPromise.current;
  }, [pdf.bytes]);

  // Which page list the pages asked for so far were asked under.
  const runsAskedFor = useRef(pages);
  const wantRuns = state.tool === "edittext" || finding;
  useEffect(() => {
    if (!wantRuns || !doc || !frames) return;
    if (runsAskedFor.current !== pages) {
      runsAskedFor.current = pages;
      runsAsked.current.clear();
    }
    void loadStyles().catch(() =>
      setRunNotice("This PDF's text could not be read for editing."),
    );
    const wanted = finding ? frames.map((_, i) => i) : [...near];
    const list = pages;
    const store = (i: number, placed: TextRun[]) =>
      setRunState((s) => ({
        for: list,
        byPage: { ...(s.for === list ? s.byPage : {}), [i]: placed },
      }));
    for (const i of wanted) {
      if (runsAsked.current.has(i) || !frames[i]) continue;
      runsAsked.current.add(i);
      const source = list[i]?.source ?? null;
      // A blank page has no text.
      const items =
        source === null ? Promise.resolve([]) : doc.textContent(source);
      void items.then((read) => {
        if (runsAskedFor.current !== list) return;
        store(i, placeRuns(i, read, frames[i]!));
      });
    }
  }, [wantRuns, finding, doc, frames, near, loadStyles, pages]);

  // Runs a person can edit: an invisible OCR layer is not offered.
  const editableRuns = useMemo(() => {
    const out: Record<number, TextRun[]> = {};
    for (const [page, list] of Object.entries(runs)) {
      const index = Number(page);
      const source = sourceOf(index);
      out[index] =
        styles && source !== null
          ? list.filter((run) => !styles.style(source, run).invisible)
          : list;
    }
    return out;
  }, [runs, styles, sourceOf]);

  /** Each edited run's edit, by run key. */
  const editOfRun = useMemo(() => {
    const map = new Map<string, TextEditObject>();
    for (const o of state.objects) {
      if (o.kind !== "textedit") continue;
      const run = editableRuns[o.page]?.find((r) => editIsForRun(o, r));
      if (run) map.set(run.key, o);
    }
    return map;
  }, [state.objects, editableRuns]);

  const matches = useMemo<FindMatch[]>(() => {
    if (!finding || find.query.length === 0) return [];
    const list = Object.values(editableRuns)
      .flat()
      .sort((a, b) => a.page - b.page || a.index - b.index)
      .map((r) => ({
        key: r.key,
        page: r.page,
        text: editOfRun.get(r.key)?.text ?? r.str,
      }));
    return findMatches(list, find.query, find.matchCase);
  }, [finding, find.query, find.matchCase, editableRuns, editOfRun]);
  const matchIndex =
    matches.length === 0 ? 0 : Math.min(find.index, matches.length - 1);
  const pagesReading = finding
    ? (frames?.length ?? 0) - Object.keys(runs).length
    : 0;

  const revealMatch = useCallback(
    (m: FindMatch | undefined) => {
      const el = viewport.current;
      const slot = m ? layout.slots[m.page] : undefined;
      const run = m
        ? runsRef.current[m.page]?.find((r) => r.key === m.run)
        : undefined;
      if (!el || !slot || !run) return;
      el.scrollTo({
        top: Math.max(0, slot.top + run.rect.y * scale - el.clientHeight / 3),
      });
    },
    [layout, scale],
  );

  const stepMatch = useCallback(
    (dir: 1 | -1) => {
      if (matches.length === 0) return;
      const next = (matchIndex + dir + matches.length) % matches.length;
      setFind((f) => ({ ...f, index: next }));
      revealMatch(matches[next]);
    },
    [matches, matchIndex, revealMatch],
  );

  /** Replace `which` (one match, or all of them) as ONE undo step. */
  const replaceMatches = useCallback(
    async (which: FindMatch[], label: string) => {
      if (which.length === 0) return;
      let reader: RunStyleReader;
      try {
        reader = await loadStyles();
      } catch {
        setRunNotice("This PDF's text could not be read for editing.");
        return;
      }
      const s = stateRef.current;
      const byRun = new Map<string, FindMatch[]>();
      for (const m of which) byRun.set(m.run, [...(byRun.get(m.run) ?? []), m]);
      const changes: Change[] = [];
      let at = s.objects.length;
      let refused = 0;
      let replaced = 0;
      for (const [key, ms] of byRun) {
        const page = ms[0]!.page;
        const run = runsRef.current[page]?.find((r) => r.key === key);
        if (!run) continue;
        const existing = s.objects.find(
          (o): o is TextEditObject =>
            o.kind === "textedit" && editIsForRun(o, run),
        );
        const current = existing?.text ?? run.str;
        const next = replaceAt(
          current,
          ms.map((m) => m.start),
          find.query.length,
          find.replacement,
        );
        if (existing) {
          changes.push(
            changeOf(
              s.objects,
              existing,
              next === existing.original ? null : { ...existing, text: next },
            ),
          );
        } else {
          const style = reader.style(sourceOf(page) ?? -1, run);
          if (style.refusal) {
            refused += ms.length;
            continue;
          }
          const added = textEditFromRun(newObjectId(), run, style, next);
          changes.push({ id: added.id, before: null, after: added, at: at++ });
        }
        replaced += ms.length;
      }
      if (refused > 0) {
        setRunNotice(
          `${refused} match${refused === 1 ? "" : "es"} could not be replaced: that text can't be edited here.`,
        );
      }
      if (changes.length === 0) return;
      dispatch({
        type: "commit",
        command: { label, changes },
        say: `${replaced} replaced`,
      });
    },
    [dispatch, find.query, find.replacement, loadStyles, sourceOf],
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

  /** Every form field name in use: the file's and the editor's. */
  const takenNames = useCallback(
    (): Set<string> =>
      new Set([
        ...fileFields.map((f) => f.name),
        ...stateRef.current.objects.flatMap((o) =>
          o.kind === "field" ? [o.name.trim()] : [],
        ),
      ]),
    [fileFields],
  );

  const commitAdd = useCallback(
    (added: EditorObject, say: string) => {
      const obj =
        added.kind === "field" && !added.name
          ? { ...added, name: freshFieldName(added.fieldType, takenNames()) }
          : added;
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
    [dispatch, takenNames],
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
    (all: EditorObject[], label: string) => {
      // An edit of page text belongs to its run: it is never copied.
      const source = all.filter((o) => o.kind !== "textedit");
      if (source.length === 0 || !frames) return;
      const s = stateRef.current;
      const samePage = source.every((o) => o.page === source[0]!.page);
      const target = samePage ? current : null;
      const taken = takenNames();
      const copies = source.map((o) => {
        let copy = cloneObject(o);
        if (copy.kind === "field") {
          // Two fields with one name are one field in a form: a copy gets its own.
          const name = freshFieldName(copy.fieldType, taken);
          taken.add(name);
          copy = { ...copy, name };
        }
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
    [dispatch, boundsOf, current, frames, takenNames],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const s = stateRef.current;
      const moving = s.objects.filter(
        (o) => s.selected.includes(o.id) && o.kind !== "textedit",
      );
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
          label:
            key === "target"
              ? "Change link"
              : FIELD_KEYS.has(key)
                ? "Change field"
                : "Change style",
          changes,
          coalesce: `style:${key}:${s.selected.join(",")}`,
        },
        ...(key === "target" ? { say: "Link updated" } : {}),
      });
    },
    [dispatch],
  );

  /** Z-order: one step, the selection moved within its page's stack. */
  const stack = useCallback(
    (move: StackMove) => {
      const s = stateRef.current;
      const changes = stackChanges(s.objects, s.selected, move);
      const label = STACK_LABEL[move];
      if (changes.length === 0) {
        dispatch({ type: "say", message: `${label}: already there` });
        return;
      }
      dispatch({ type: "commit", command: { label, changes }, say: label });
    },
    [dispatch],
  );

  /* ------------------------------ pages ------------------------------ */

  const runPageOp = useCallback(
    (op: PageOp | null, jump?: number) => {
      if (!op) return;
      const s = stateRef.current;
      dispatch({
        type: "commit",
        command: {
          label: op.label,
          changes: op.changes,
          pages: { before: s.pages, after: op.pages },
        },
        select: [],
        say: op.label,
      });
      if (jump !== undefined) {
        requestAnimationFrame(() => jumpToRef.current(jump));
      }
    },
    [dispatch],
  );

  const pageOps = useMemo<PageOps>(
    () => ({
      onRotate: (i) => {
        const s = stateRef.current;
        if (!frames) return;
        runPageOp(
          rotatePage(s.pages, i, s.objects, frames, (o) =>
            kit ? kit.height(o) : 20,
          ),
        );
      },
      onInsert: (i) => {
        const s = stateRef.current;
        if (!frames) return;
        runPageOp(
          insertBlankAfter(s.pages, i, s.objects, frames, `b${newObjectId()}`),
          i + 1,
        );
      },
      onDelete: (i) => {
        const s = stateRef.current;
        runPageOp(deletePage(s.pages, i, s.objects));
      },
      onMove: (from, to) => {
        const s = stateRef.current;
        runPageOp(movePage(s.pages, from, to, s.objects), to);
      },
    }),
    [frames, runPageOp, kit],
  );

  /* ------------------------------ tools ------------------------------ */

  // A saved typed signature's name, read once (browser storage, opt-in).
  const [savedName] = useState(() => {
    const saved = readSavedSignatures().find((x) => x.kind === "typed");
    return saved && saved.kind === "typed" ? saved.text.trim() : "";
  });
  /** The name Initials and Name write: typed here, or a typed signature's. */
  const personName = useCallback(
    (s: EditorState): string => {
      if (s.defaults.person.name.trim()) return s.defaults.person.name.trim();
      if (s.pending?.kind === "typed" && s.pending.text.trim()) {
        return s.pending.text.trim();
      }
      return savedName;
    },
    [savedName],
  );

  /** Date, Initials, Name or a check mark, where the click landed. */
  const placeQuick = useCallback(
    (tool: Tool, page: number, at: Pt) => {
      const s = stateRef.current;
      const f = frames?.[page];
      if (!f) return;
      const size = { width: f.width, height: f.height };
      const id = newObjectId();
      if (tool === "check") {
        commitAdd(
          markObject(
            id,
            page,
            at,
            s.defaults.mark.glyph,
            s.defaults.mark.color,
            size,
          ),
          s.defaults.mark.glyph === "check"
            ? "Check mark placed"
            : "Cross placed",
        );
        return;
      }
      let text = "";
      if (tool === "date")
        text = formatDate(new Date(), s.defaults.date.format);
      else {
        const name = personName(s);
        if (!name) {
          setError(null);
          dispatch({ type: "say", message: "Type your name first" });
          document.getElementById(askNameId)?.focus();
          return;
        }
        text = tool === "initials" ? initialsOf(name) : name;
      }
      const style = {
        ...s.defaults.text,
        size: Math.min(s.defaults.text.size, 14),
      };
      const measure = (t: string) => {
        if (!kit) return t.length * style.size * 0.55;
        const probe: TextBoxObject = {
          id: "probe",
          kind: "text",
          page,
          x: 0,
          y: 0,
          width: 1e6,
          text: t,
          ...style,
        };
        return Math.max(...kit.layout(probe).lines.map((l) => l.width));
      };
      const label =
        tool === "date" ? "Date" : tool === "initials" ? "Initials" : "Name";
      commitAdd(
        quickTextObject(id, page, at, text, style, measure, size),
        `${label} placed`,
      );
    },
    [commitAdd, dispatch, frames, kit, personName, askNameId],
  );

  const chooseTool = useCallback(
    (tool: Tool) => {
      dispatch({ type: "tool", tool });
      const held = stateRef.current.pending;
      setSigning(tool === "signature" && (!held || held.kind === "image"));
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
      if (p.kind === "typed") {
        // A typed signature is TEXT in its style's face, one line, as wide
        // as the name is set (measured as the export will measure it).
        const probe = typedSignatureObject(
          "probe",
          page,
          0,
          0,
          1e6,
          p.text,
          p.style,
        );
        const natural = kit
          ? Math.max(...kit.layout(probe).lines.map((l) => l.width))
          : p.text.length * probe.size * 0.5;
        const width = Math.min(f.width, Math.ceil(natural) + 2);
        const height = probe.size * probe.lineHeight;
        const x = Math.min(Math.max(0, at.x - width / 2), f.width - width);
        const y = Math.min(Math.max(0, at.y - height / 2), f.height - height);
        const id = newObjectId();
        commitAdd(
          typedSignatureObject(id, page, x, y, width, p.text, p.style),
          "Signature placed",
        );
        dispatch({ type: "tool", tool: "select" });
        dispatch({ type: "select", ids: [id] });
        return true;
      }
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
    [dispatch, commitAdd, frames, kit],
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
    (obj: TextBoxObject | NoteObject | TextEditObject) => {
      dispatch({
        type: "startEdit",
        edit: { id: obj.id, isNew: false, text: obj.text, base: obj },
      });
    },
    [dispatch],
  );

  const startRetext = useCallback(
    async (run: TextRun) => {
      const existing = stateRef.current.objects.find(
        (o): o is TextEditObject =>
          o.kind === "textedit" && editIsForRun(o, run),
      );
      if (existing) {
        editExisting(existing);
        return;
      }
      let reader: RunStyleReader;
      try {
        reader = await loadStyles();
      } catch {
        setRunNotice("This PDF's text could not be read for editing.");
        return;
      }
      const style = reader.style(sourceOf(run.page) ?? -1, run);
      if (style.refusal) {
        setRunNotice(style.refusal);
        dispatch({ type: "say", message: style.refusal });
        return;
      }
      setRunNotice(null);
      const id = newObjectId();
      dispatch({
        type: "startEdit",
        edit: {
          id,
          isNew: true,
          text: run.str,
          base: textEditFromRun(id, run, style),
        },
      });
    },
    [dispatch, editExisting, loadStyles, sourceOf],
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
    (e: Press, page: number) => {
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

      // Touch, with a placing tool, on something already placed: a long
      // press selects it; a tap (or a drag) does what the tool does.
      if (
        e.pointerType === "touch" &&
        !e.replay &&
        s.tool !== "select" &&
        s.tool !== "edittext" &&
        hit &&
        hit.kind !== "textedit" &&
        !handleEl
      ) {
        e.preventDefault();
        const snapshot: Press = {
          button: e.button,
          target: e.target,
          clientX: e.clientX,
          clientY: e.clientY,
          shiftKey: e.shiftKey,
          pointerType: e.pointerType,
          preventDefault: () => {},
          replay: true,
        };
        const timer = window.setTimeout(() => {
          longPress.current = null;
          dispatch({ type: "tool", tool: "select" });
          dispatch({ type: "select", ids: [hit.id] });
          dispatch({
            type: "say",
            message: `Selected: ${describeObject(hit)}`,
          });
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
        longPress.current = { timer, press: snapshot, page };
        return;
      }

      if (s.tool === "edittext") {
        e.preventDefault();
        if (hit && hit.kind === "textedit") {
          editExisting(hit);
          return;
        }
        const key =
          target.closest<SVGElement>("[data-run-key]")?.dataset.runKey;
        const run = key
          ? runsRef.current[page]?.find((r) => r.key === key)
          : undefined;
        if (run) void startRetext(run);
        return;
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
                  grab: (() => {
                    const edge = handlePoint(boundsOf(obj), h as Handle);
                    return { x: pt.x - edge.x, y: pt.y - edge.y };
                  })(),
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
          // Edited page text stays on its run: selectable, not movable.
          const originals = s.objects.filter(
            (o) =>
              selected.includes(o.id) &&
              o.page === page &&
              o.kind !== "textedit",
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
      if (QUICK.has(s.tool)) {
        if (hit && hit.kind !== "textedit" && !e.replay) {
          // A click on something placed picks it up instead.
          dispatch({ type: "tool", tool: "select" });
          dispatch({ type: "select", ids: [hit.id] });
          return;
        }
        placeQuick(s.tool, page, pt);
        return;
      }
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
      placeQuick,
      pointIn,
      startRetext,
      startText,
    ],
  );

  useEffect(() => {
    /** A held touch that was not a long press after all: do what the tool does. */
    const replayPress = () => {
      const lp = longPress.current;
      if (!lp) return;
      window.clearTimeout(lp.timer);
      longPress.current = null;
      onPagePointerDown(lp.press, lp.page);
    };
    const onMove = (e: PointerEvent) => {
      const lp = longPress.current;
      if (
        lp &&
        Math.hypot(e.clientX - lp.press.clientX, e.clientY - lp.press.clientY) >
          LONG_PRESS_SLOP_PX
      ) {
        replayPress();
      }
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
          const moving = new Set(d.originals.map((o) => o.id));
          const others = stateRef.current.objects
            .filter((o) => o.page === d.page && !moving.has(o.id))
            .map((o) => boundsOf(o));
          const snap = e.altKey
            ? { dx: 0, dy: 0, guides: [] }
            : snapRect(moved, f.width, f.height, SNAP_PX / scale, others);
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
          const raw = clampPt({ x: pt.x - d.grab.x, y: pt.y - d.grab.y });
          const others = stateRef.current.objects
            .filter((o) => o.page === d.page && o.id !== d.obj.id)
            .map((o) => boundsOf(o));
          const sx = d.handle.includes("w") || d.handle.includes("e");
          const sy = d.handle.includes("n") || d.handle.includes("s");
          const sn = e.altKey
            ? { ...raw, guides: [] as SnapGuide[] }
            : snapPoint(raw, f.width, f.height, SNAP_PX / scale, others);
          const p = { x: sx ? sn.x : raw.x, y: sy ? sn.y : raw.y };
          const lines = sn.guides.filter((g) => (g.axis === "x" ? sx : sy));
          setGuides(lines.length ? { page: d.page, lines } : null);
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
      replayPress();
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
  }, [
    dispatch,
    boundsOf,
    commitAdd,
    frames,
    pointIn,
    scale,
    onPagePointerDown,
  ]);

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
      if (mod && key === "f") {
        e.preventDefault();
        setFinding(true);
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
        if (finding) {
          setFinding(false);
          return;
        }
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
        if (
          obj &&
          (obj.kind === "text" ||
            obj.kind === "note" ||
            obj.kind === "textedit")
        ) {
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
    finding,
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
      onStack={stack}
      pageIds={pageIds}
    />
  ) : state.tool === "edittext" ? (
    <p className="text-muted text-xs leading-relaxed" data-edit-text-help="">
      Click any text on the page to change it. When you apply, the old words are
      removed from the file and yours are written in their place. A scanned page
      has no text to edit: run OCR PDF on it first.
    </p>
  ) : (
    <p className="text-muted text-xs leading-relaxed">
      Pick a tool, then click on a page to place it. Select an item to move it,
      resize it from its handles, or change its style here.
    </p>
  );

  const railPages: RailPage[] = pages.map((p, i) => ({
    key: p.id,
    source: p.source,
    turn: p.rotate,
    width: sizes[i]?.width ?? 612,
    height: sizes[i]?.height ?? 792,
  }));
  const placed = state.objects.filter(
    (o) => !(o.kind === "link" && linkUntouched(o)),
  ).length;
  /** The file's own form widgets on a displayed page, in viewer points. */
  const widgetsOn = (index: number): PlacedWidget[] => {
    const source = pages[index]?.source;
    const f = frames?.[index];
    if (source === null || source === undefined || !f) return [];
    return fileFields.flatMap((field) =>
      field.widgets.flatMap((w, k) => {
        if (w.source !== source) return [];
        const a = contentToViewer(w.rect.x0, w.rect.y0, f);
        const b = contentToViewer(w.rect.x1, w.rect.y1, f);
        return [
          {
            key: `${field.name}#${k}`,
            field,
            option: w.option,
            rect: {
              x: Math.min(a.x, b.x),
              y: Math.min(a.y, b.y),
              width: Math.abs(b.x - a.x),
              height: Math.abs(b.y - a.y),
            },
          },
        ];
      }),
    );
  };
  const needsName =
    (state.tool === "initials" || state.tool === "name") && !personName(state);

  const toolbar = (
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
      finding={finding}
      onFind={() => setFinding((f) => !f)}
      onPages={wide ? undefined : () => setPagesOpen((o) => !o)}
      pagesOpen={pagesOpen}
    />
  );

  const pagesSheet =
    !wide && pagesOpen && ready ? (
      <section
        role="region"
        aria-label="Pages"
        data-pages-sheet=""
        className={cn(
          "border-line bg-panel overflow-y-auto border p-3",
          narrow
            ? "rounded-t-panel mx-1 max-h-[45dvh] border-b-0 shadow-lg"
            : "rounded-panel max-h-[45dvh]",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-fg text-sm font-semibold">
            {pages.length} page{pages.length === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={() => setPagesOpen(false)}
            className="text-accent text-xs font-semibold"
          >
            Done
          </button>
        </div>
        <ThumbnailRail
          doc={doc}
          pages={railPages}
          current={current}
          onJump={(i) => {
            jumpTo(i);
            if (narrow) setPagesOpen(false);
          }}
          ops={pageOps}
          layout="sheet"
        />
      </section>
    ) : null;

  return (
    <div
      ref={editorRoot}
      className="flex flex-col gap-3"
      data-wysiwyg-editor=""
    >
      <FileHeader pdf={pdf} />
      {firstStep}
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
        {!narrow && (
          <div className="border-line bg-panel rounded-panel border">
            {toolbar}
          </div>
        )}

        {needsName && (
          <form
            data-name-prompt=""
            className="border-line bg-panel rounded-panel flex flex-wrap items-center gap-2 border px-3.5 py-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const name = askName.trim();
              if (!name) return;
              dispatch({ type: "defaults", patch: { person: { name } } });
              dispatch({
                type: "say",
                message: `${state.tool === "initials" ? `Initials ${initialsOf(name)}` : "Name"} ready: click on a page to place`,
              });
            }}
          >
            <label htmlFor={askNameId}>
              {state.tool === "initials"
                ? "Your name, for your initials:"
                : "Your name:"}
            </label>
            <input
              id={askNameId}
              type="text"
              autoComplete="name"
              value={askName}
              onChange={(e) => setAskName(e.target.value)}
              className="border-line bg-canvas text-fg rounded-ctl min-w-0 flex-1 border px-2 py-1 text-sm"
            />
            <button type="submit" className="text-accent text-xs font-semibold">
              Use this name
            </button>
            <span className="text-muted w-full text-[11px]">
              Used only for what you place in this file. It is not stored in
              your browser or sent anywhere.
            </span>
          </form>
        )}

        {!narrow && pagesSheet}

        {!signing &&
          state.tool === "signature" &&
          state.pending &&
          state.pending.kind !== "image" && (
            <p
              data-signature-ready=""
              className="border-line bg-panel rounded-panel flex flex-wrap items-center justify-between gap-2 border px-3.5 py-2 text-sm"
            >
              <span>Click on a page to place your signature.</span>
              <button
                type="button"
                onClick={() => setSigning(true)}
                className="text-accent text-xs font-semibold"
              >
                New signature
              </button>
            </p>
          )}

        {signing && (
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
        )}

        {finding && (
          <FindPanel
            state={{ ...find, index: matchIndex }}
            onChange={(patch) => setFind((f) => ({ ...f, ...patch }))}
            count={matches.length}
            reading={Math.max(0, pagesReading)}
            onStep={stepMatch}
            onReplace={() => {
              const m = matches[matchIndex];
              if (m) void replaceMatches([m], "Replace");
            }}
            onReplaceAll={() => void replaceMatches(matches, "Replace all")}
            onClose={() => setFinding(false)}
          />
        )}

        {runNotice && (
          <p
            role="status"
            data-run-notice=""
            className="border-line bg-panel rounded-panel text-muted border px-3.5 py-2 text-xs"
          >
            {runNotice}
          </p>
        )}

        <div className="grid gap-3 lg:grid-cols-[9rem_minmax(0,1fr)_15rem]">
          <div className="hidden h-[min(76vh,1100px)] min-h-[420px] lg:block">
            {ready && wide && (
              <ThumbnailRail
                doc={doc}
                pages={railPages}
                current={current}
                onJump={jumpTo}
                ops={pageOps}
              />
            )}
          </div>

          <div
            ref={viewport}
            data-editor-viewport=""
            tabIndex={-1}
            // On a phone the page view takes the screen's height less the
            // header, the docked toolbar and the Apply bar under it.
            className="bg-wash border-line rounded-panel relative h-[calc(100dvh-13.5rem)] min-h-[300px] [touch-action:pan-x_pan-y] overflow-auto border outline-none sm:h-[min(76vh,1100px)] sm:min-h-[420px]"
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
                    source={pages[slot.index]?.source ?? null}
                    turn={pages[slot.index]?.rotate ?? 0}
                    widgets={widgetsOn(slot.index)}
                    fills={state.fills}
                    onFill={(name, value) =>
                      dispatch({ type: "fill", name, value })
                    }
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
                    runs={
                      state.tool === "edittext"
                        ? (editableRuns[slot.index]?.filter(
                            (r) => !editOfRun.has(r.key),
                          ) ?? null)
                        : null
                    }
                    findHits={
                      finding
                        ? matches.flatMap((m, i) => {
                            if (m.page !== slot.index) return [];
                            const run = runs[slot.index]?.find(
                              (r) => r.key === m.run,
                            );
                            if (!run) return [];
                            const text =
                              editOfRun.get(run.key)?.text ?? run.str;
                            const len = Math.max(1, text.length);
                            const r = run.rect;
                            const flat = Math.abs(run.angle) < 1;
                            return [
                              {
                                rect: flat
                                  ? {
                                      x: r.x + (r.width * m.start) / len,
                                      y: r.y,
                                      width:
                                        (r.width * (m.end - m.start)) / len,
                                      height: r.height,
                                    }
                                  : r,
                                current: i === matchIndex,
                              },
                            ];
                          })
                        : []
                    }
                    onRunActivate={(run) => void startRetext(run)}
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
                      if (
                        obj.kind === "text" ||
                        obj.kind === "note" ||
                        obj.kind === "textedit"
                      )
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
            {/* One panel in the DOM at a time: two copies had two of every
                control (and two "Link address" fields each taking focus). */}
            {wide && panel}
          </aside>
        </div>

        {!narrow && !wide && (
          <div className="border-line bg-panel rounded-panel border p-3 lg:hidden">
            {panel}
          </div>
        )}
      </div>

      <p className="text-muted text-xs">
        {ready
          ? `Page ${current + 1} of ${sizes.length} · ${Math.round(zoom.zoom * 100)}% · ${placed} item${placed === 1 ? "" : "s"} placed`
          : "Reading pages…"}
      </p>

      {pickError && <ErrorNote message={pickError} />}
      {narrow ? (
        // Phone: the properties sheet (with something selected), the tools
        // and the Apply bar are ONE bar docked at the bottom of the screen,
        // so the page view is never scrolled away to pick a tool.
        <div
          data-editor-dock=""
          className="sticky bottom-[calc(env(safe-area-inset-bottom)+var(--sf-bottom-inset,0px))] z-20 -mx-5 flex flex-col overflow-x-clip"
        >
          {pagesSheet}
          {selection.length > 0 && !pagesOpen && (
            <section
              ref={sheetRef}
              role="region"
              aria-label="Properties"
              data-properties-sheet=""
              className="border-line bg-panel rounded-t-panel mx-1 max-h-[45dvh] overflow-y-auto border border-b-0 p-4 shadow-lg"
            >
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "select", ids: [] })}
                  className="text-accent text-xs font-semibold"
                >
                  Done
                </button>
              </div>
              {panel}
            </section>
          )}
          <div className="border-line bg-panel min-w-0 overflow-x-clip border-t px-1">
            {toolbar}
          </div>
          <div className="[&_[data-run-dock]]:mx-0 [&_[data-run-dock]]:shadow-none">
            {runBar}
          </div>
        </div>
      ) : (
        runBar
      )}
      {footer}
    </div>
  );
}

/* ------------------------------ one page ------------------------------ */

const HANDLE_PX = 9;
/** A fingertip needs a bigger target than a cursor (WCAG 2.5.8: ≥ 24 px). */
const HANDLE_PX_TOUCH = 24;
/** Clear space between an object's own edge and its selection frame. */
const FRAME_GAP_PX = 4;

/**
 * The selection frame, OUTSIDE the object: its gap plus half a handle, so
 * neither the dashed outline nor a handle covers what was selected (a
 * handle once sat on the "A" of a text box's first word).
 */
export function selectionFrame(b: Rect, handlePx: number, scale: number): Rect {
  const off = (FRAME_GAP_PX + handlePx / 2) / scale;
  return {
    x: b.x - off,
    y: b.y - off,
    width: b.width + off * 2,
    height: b.height + off * 2,
  };
}

const COARSE_QUERY = "(pointer: coarse)";
const NARROW_QUERY = "(max-width: 639.98px)";
const WIDE_QUERY = "(min-width: 64rem)";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia === "undefined") return () => {};
      const mq = matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => typeof matchMedia !== "undefined" && matchMedia(query).matches,
    () => false,
  );
}

function useCoarsePointer(): boolean {
  return useMedia(COARSE_QUERY);
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
  source,
  turn,
  widgets,
  fills,
  onFill,
  count,
  frame,
  scale,
  doc,
  near,
  kit,
  objects,
  pendingNew,
  runs,
  findHits,
  onRunActivate,
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
  /** The source page drawn here, or null for an inserted blank page. */
  source: number | null;
  turn: number;
  /** The file's own form fields on this page, to fill in place. */
  widgets: PlacedWidget[];
  fills: Readonly<Record<string, FieldFill>>;
  onFill: (name: string, value: FieldFill | null) => void;
  count: number;
  frame: ExportFrame;
  scale: number;
  doc: EditorPdf | null;
  near: boolean;
  kit: TextKit;
  objects: EditorObject[];
  pendingNew: TextBoxObject | NoteObject | TextEditObject | null;
  /** Edit text: the runs to outline (null when the tool is not active). */
  runs: TextRun[] | null;
  findHits: { rect: Rect; current: boolean }[];
  onRunActivate: (run: TextRun) => void;
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
          TextBoxObject | NoteObject | TextEditObject | undefined)
      : undefined);
  if (pendingNew) drawn.push(pendingNew);
  const textsToLoad = drawn
    .filter(
      (o): o is TextBoxObject | NoteObject | TextEditObject =>
        o.kind === "text" || o.kind === "note" || o.kind === "textedit",
    )
    .map((o) => o.text);
  useEffect(() => {
    for (const t of textsToLoad) kit.request(t);
  });

  const placing = tool !== "select";
  const coarse = useCoarsePointer();
  // The run under the pointer or keyboard focus (Edit text), drawn stronger.
  const [hot, setHot] = useState<string | null>(null);
  const handlePx = coarse ? HANDLE_PX_TOUCH : HANDLE_PX;
  const handleSize = handlePx / scale;
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
      data-source-page={source ?? "blank"}
      data-page-pt={`${frame.width}x${frame.height}`}
      role="group"
      aria-label={`Page ${index + 1} of ${count}`}
      className={cn(
        "absolute bg-white shadow-md ring-1 ring-black/10 select-none",
        tool === "edittext"
          ? undefined
          : placing
            ? "cursor-crosshair [touch-action:none]"
            : "cursor-default",
      )}
      style={{
        top: slotTop,
        left,
        width,
        height,
        ...(tool === "edittext" ? { cursor: "text" } : {}),
      }}
      onPointerDown={(e) => onPointerDown(e, index)}
    >
      {source !== null && (
        <PageCanvas
          doc={doc}
          index={source}
          turn={turn}
          scale={scale}
          near={near}
        />
      )}
      {/* Far pages are bare sheets: no raster, no object layer (their
          objects are off screen, and a 500-page file would otherwise draw
          every one of them on every scroll frame). */}
      {(near || editingObj) && (
        <svg
          className="absolute inset-0 overflow-visible"
          width={width}
          height={height}
          viewBox={`0 0 ${frame.width} ${frame.height}`}
          aria-hidden={drawn.length === 0 && !runs?.length ? true : undefined}
        >
          {findHits.map((h, i) => (
            <rect
              key={`find-${i}`}
              data-find-hit={h.current ? "current" : ""}
              x={h.rect.x}
              y={h.rect.y}
              width={h.rect.width}
              height={h.rect.height}
              fill="#facc15"
              fillOpacity={h.current ? 0.55 : 0.3}
              stroke={h.current ? "#ea580c" : "none"}
              strokeWidth={1.5 / scale}
              pointerEvents="none"
            />
          ))}
          {runs?.map((run) => (
            <rect
              key={run.key}
              data-run-key={run.key}
              role="button"
              tabIndex={0}
              aria-label={`Edit text “${run.str.trim().slice(0, 60)}”`}
              x={run.rect.x}
              y={run.rect.y}
              width={Math.max(run.rect.width, 1)}
              height={Math.max(run.rect.height, 1)}
              fill="#2563eb"
              fillOpacity={hot === run.key ? 0.1 : 0}
              stroke="#2563eb"
              strokeOpacity={hot === run.key ? 1 : 0.5}
              strokeDasharray={`${3 / scale} ${2 / scale}`}
              strokeWidth={1 / scale}
              className="outline-none"
              style={{ cursor: "text" }}
              onPointerEnter={() => setHot(run.key)}
              onPointerLeave={() => setHot((k) => (k === run.key ? null : k))}
              onFocus={() => setHot(run.key)}
              onBlur={() => setHot((k) => (k === run.key ? null : k))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onRunActivate(run);
                }
              }}
            />
          ))}
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
              const f = selectionFrame(b, handlePx, scale);
              return (
                <g key={`sel-${obj.id}`} data-selection-frame="">
                  <rect
                    x={f.x}
                    y={f.y}
                    width={f.width}
                    height={f.height}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={1.25 / scale}
                    strokeDasharray={`${4 / scale} ${3 / scale}`}
                    pointerEvents="none"
                  />
                  {selected.length === 1 &&
                    handlesFor(obj).map((h) => {
                      const p = handlePoint(f, h);
                      // What is drawn is small; what takes the press is the
                      // full target (24 px on a touch screen), transparent,
                      // so neither hides the page around the frame.
                      const seen = (coarse ? 12 : HANDLE_PX) / scale;
                      return (
                        <g key={h}>
                          <rect
                            x={p.x - seen / 2}
                            y={p.y - seen / 2}
                            width={seen}
                            height={seen}
                            fill="#ffffff"
                            stroke="#2563eb"
                            strokeWidth={1.5 / scale}
                            pointerEvents="none"
                          />
                          <rect
                            data-handle={h}
                            data-handle-for={obj.id}
                            x={p.x - handleSize / 2}
                            y={p.y - handleSize / 2}
                            width={handleSize}
                            height={handleSize}
                            fill="transparent"
                            style={{ cursor: CURSOR[h], touchAction: "none" }}
                          />
                        </g>
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

      {widgets.length > 0 && (near || editingObj) && (
        <FormFillLayer
          widgets={widgets}
          fills={fills}
          scale={scale}
          onFill={onFill}
        />
      )}

      {runs && runs.length === 0 && (
        <p
          data-no-text=""
          className="bg-panel text-muted border-line rounded-ctl absolute border px-3 py-2 text-xs shadow-sm"
          style={{ left: 12, right: 12, top: 12 }}
        >
          No editable text on this page. If it is a scan, run OCR PDF on it
          first.
        </p>
      )}

      {editingObj && editing && editingObj.kind === "textedit" && (
        <RunEditor
          obj={editingObj}
          text={editing.text}
          kit={kit}
          scale={scale}
          onChange={onEditText}
          onDone={onEndEdit}
        />
      )}
      {editingObj && editing && editingObj.kind !== "textedit" && (
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

/** One of the file's own form widgets, placed on a displayed page. */
interface PlacedWidget {
  key: string;
  field: FileField;
  /** A radio button's option. */
  option?: string;
  rect: Rect;
}

/**
 * The file's own form fields, filled in place: a real control over each
 * widget, at its box. What is typed is written into the field itself when
 * the file is applied (`editor/fields.ts`), with the field's appearance
 * redrawn; fields this editor cannot fill (signatures, buttons, read-only
 * ones) are outlined and left alone.
 */
function FormFillLayer({
  widgets,
  fills,
  scale,
  onFill,
}: {
  widgets: PlacedWidget[];
  fills: Readonly<Record<string, FieldFill>>;
  scale: number;
  onFill: (name: string, value: FieldFill | null) => void;
}) {
  const group = useId();
  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-form-fill-layer=""
    >
      {widgets.map((w) => {
        const { field, rect } = w;
        const style = {
          left: rect.x * scale,
          top: rect.y * scale,
          width: Math.max(rect.width * scale, 8),
          height: Math.max(rect.height * scale, 8),
          fontSize: Math.max(8, Math.min(rect.height * 0.7, 12) * scale),
        };
        const value = fills[field.name] ?? field.value;
        const set = (next: FieldFill) =>
          onFill(field.name, next === field.value ? null : next);
        const common = {
          "data-file-field": field.name,
          "aria-label": field.name,
          onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
          className:
            "pointer-events-auto absolute border border-info/40 bg-info/10 outline-accent focus:outline-2",
          // Ink on the page's white paper, in either colour scheme.
          style: { ...style, color: "#111827", accentColor: "#1d4ed8" },
        };
        const fillable =
          !field.readOnly &&
          field.type !== "signature" &&
          field.type !== "button";
        if (!fillable) {
          return (
            <span
              key={w.key}
              data-file-field={field.name}
              title={
                field.readOnly
                  ? `${field.name}: read-only`
                  : `${field.name}: can't be filled here`
              }
              className="border-line-strong pointer-events-none absolute border border-dashed"
              style={style}
            />
          );
        }
        if (field.type === "checkbox") {
          const { style: boxStyle, className, ...rest } = common;
          return (
            <label
              key={w.key}
              className="pointer-events-auto absolute flex items-center justify-center"
              style={boxStyle}
              onPointerDown={rest.onPointerDown}
            >
              <input
                type="checkbox"
                checked={value === true}
                onChange={(e) => set(e.target.checked)}
                {...rest}
                className={cn(className, "relative m-0 size-full")}
                style={{
                  color: boxStyle.color,
                  accentColor: boxStyle.accentColor,
                }}
              />
              <span className="sr-only">{field.name}</span>
            </label>
          );
        }
        if (field.type === "radio") {
          return (
            <input
              key={w.key}
              type="radio"
              name={`${group}-${field.name}`}
              value={w.option ?? ""}
              checked={value === w.option}
              onChange={() => set(w.option ?? "")}
              {...common}
              aria-label={`${field.name}: ${w.option ?? ""}`}
              className={cn(common.className, "m-0")}
            />
          );
        }
        if (field.type === "dropdown" || field.type === "optionlist") {
          return (
            <select
              key={w.key}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => set(e.target.value)}
              {...common}
              className={cn(common.className, "rounded-none px-0.5 py-0")}
            >
              <option value="">—</option>
              {field.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        }
        return field.multiline ? (
          <textarea
            key={w.key}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => set(e.target.value)}
            {...common}
            className={cn(common.className, "resize-none p-0.5")}
          />
        ) : (
          <input
            key={w.key}
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => set(e.target.value)}
            {...common}
            className={cn(common.className, "px-0.5")}
          />
        );
      })}
    </div>
  );
}

/**
 * Typing over text that was already on the page: one line, on the run's own
 * baseline, at its size, colour and angle, with a note saying which font
 * the words will be written in.
 */
function RunEditor({
  obj,
  text,
  kit,
  scale,
  onChange,
  onDone,
}: {
  obj: TextEditObject;
  text: string;
  kit: TextKit;
  scale: number;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const noteId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);
  const unicode = needsUnicodeFace(text);
  const family = unicode
    ? kit.family(
        { ...obj, kind: "text", align: "left", lineHeight: 1 } as never,
        text,
      )
    : CSS_FONT_STACK[obj.font];
  const own = text.trim().length > 0 && ownFontCovers(obj.ownChars, text);
  const note = !text.trim()
    ? "The text will be deleted"
    : own
      ? `Own font: ${obj.fontName}`
      : `Font substituted: ${substituteLabel(obj, text)}`;
  const ascent = obj.size * 0.95;
  const lineBox = obj.size * 1.2;
  const width = Math.max(obj.width, text.length * obj.size * 0.62) + obj.size;
  return (
    <div
      className="absolute"
      style={{
        left: obj.baseX * scale,
        top: (obj.baseY - ascent) * scale,
        transform:
          Math.abs(obj.angle) > 0.01 ? `rotate(${obj.angle}deg)` : undefined,
        transformOrigin: `0 ${ascent * scale}px`,
      }}
      data-text-editor=""
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span
        id={noteId}
        data-font-note={!text.trim() ? "deleted" : own ? "own" : "substituted"}
        className="border-line bg-panel text-fg rounded-tag pointer-events-none absolute left-0 border px-1.5 py-0.5 text-[11px] whitespace-nowrap shadow"
        style={{ bottom: "calc(100% + 4px)" }}
      >
        {note}
      </span>
      <input
        ref={ref}
        type="text"
        data-run-editor=""
        aria-label={`Edit text, was “${obj.original}”`}
        aria-describedby={noteId}
        value={text}
        spellCheck
        onChange={(e) => onChange(e.target.value)}
        onBlur={onDone}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") {
            e.preventDefault();
            onDone();
          }
        }}
        className="outline-accent block border-0 bg-white p-0 outline-2 outline-offset-2 outline-dashed"
        style={{
          width: width * scale,
          height: lineBox * scale,
          fontFamily: family,
          fontSize: obj.size * scale,
          lineHeight: `${lineBox * scale}px`,
          paddingTop: 0,
          fontWeight: !unicode && obj.bold ? 700 : 400,
          fontStyle: !unicode && obj.italic ? "italic" : "normal",
          color: obj.color,
          fontKerning: "none",
        }}
      />
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
