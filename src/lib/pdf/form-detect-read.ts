import {
  DETECT,
  bandLines,
  classifyPage,
  emptyCounts,
  type Box,
  type CardPage,
  type CardText,
  type DetectCounts,
  type Excluded,
  type ExclusionRuleId,
  type FieldProposal,
  type Placement,
} from "./form-detect";
import { scanPaths, type ImageBox, type OpsLike } from "./form-detect-paths";
import { awaitPdfjsDocument, loadPdfjs } from "./pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * Create Forms field finder: the reader. Opens a PDF with pdf.js, reads each
 * page's text, drawn lines and boxes, and existing form widgets, hands them
 * to `./form-detect` to classify, and turns what it proposes into the
 * builder's card frame: PDF points from the bottom-left corner of the page AS
 * A READER SEES IT (the CropBox clipped by the MediaBox, turned by
 * `/Rotate`), the unit `NewFieldPlacement` in create-forms.ts takes.
 *
 * Every page is classified in that frame (text, lines, boxes, images and
 * widgets carried over by {@link cardMatrix}), so a label is upright when
 * the READER sees it upright: a landscape form made the common way
 * (`/Rotate 90`, content counter-turned) is searched, and a page whose
 * writing `/Rotate` turns sideways on screen is "turned-content".
 *
 * It proposes and never writes. It reads only what the PDF draws as text,
 * lines and boxes, so a page that is only a picture (a scan with no text
 * layer) reads as "no-text-layer", a page with nothing readable as
 * "nothing-drawn" or "unread", and a page whose writing is turned on screen
 * as "turned-content", never as "no fields here" (all pinned by the outcome
 * cases in src/tests/form-detect-fixtures.ts, run by
 * form-detect.pdfjs.test.ts).
 *
 * The pdf.js open sequence is the one `readPageTextItems` in text.ts uses,
 * copied rather than imported (text.ts is a first-load module that other
 * tools' chunks concatenate): the stream preflight in ./pdfjs-guard first,
 * the shared document defaults, the page-count guard, and per-page error
 * translation.
 */

/** Marker for the lazy chunk the builder will load this through. */
export const CREATE_FORMS_DETECT_READ = "pdfxyz:form-detect-read";

export type PageOutcome =
  | {
      page: number;
      outcome: "found";
      proposals: FieldProposal[];
      /** Proposals the caps left out on this page (60 a page, 300 a run). */
      leftOut?: number;
    }
  /**
   * Something was found, and the caps left ALL of it out (the run's 300
   * were taken by earlier pages). Never "no-candidates": the page is not
   * empty, the run was full (review round 7).
   */
  | { page: number; outcome: "capped"; leftOut: number }
  | { page: number; outcome: "no-candidates" }
  /** No ink and no text: blank OR unreadable, never "no fields". */
  | { page: number; outcome: "nothing-drawn" }
  /** Images cover over half the page and no upright text: likely a scan. */
  | { page: number; outcome: "no-text-layer" }
  /**
   * Nothing proposed, and most of its text is upright in the file but
   * turned on screen by `/Rotate` (see {@link turnedOnScreen}): the reader
   * sees its writing sideways or upside down, and the finder reads upright
   * writing only. Never "no fields here".
   */
  | { page: number; outcome: "turned-content" }
  | { page: number; outcome: "unread"; reason: string }
  | { page: number; outcome: "skipped"; reason: "too-complex" | "page-cap" };

export interface DetectReport {
  pages: PageOutcome[];
  counts: DetectCounts;
  /** Every shape passed over and the rule that decided it, in the card frame. */
  excluded: Excluded[];
}

/** The part of pdf.js the reader uses. */
export type PdfjsLike = Pick<typeof import("pdfjs-dist"), "getDocument"> & {
  OPS: OpsLike;
  AnnotationMode?: { DISABLE: number };
};

export interface DetectOptions {
  signal?: AbortSignal;
  /** Called after each page is read: (pages done, pages to read). */
  onPage?: (done: number, total: number) => void;
  /** Cards already in the builder, in the card frame. */
  drafts?: readonly Placement[];
  disable?: ReadonlySet<ExclusionRuleId>;
  /** pdf.js loader; tests pass the legacy build. */
  loadReader?: () => Promise<PdfjsLike>;
}

/** The part of a pdf.js PageViewport `toCard` reads. */
export interface ViewportLike {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
  convertToPdfPoint?(x: number, y: number): number[];
}

/** Image cover above this, with no upright text, reads as a likely scan. */
export const SCAN_COVER = 0.5;

/**
 * A content-space box in the card frame: its four corners through the
 * viewport (which applies the crop origin and `/Rotate`), then flipped so y
 * grows up from the displayed bottom edge. Not rounded.
 */
export function toCard(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  viewport: ViewportLike,
): Box {
  const pts = [
    viewport.convertToViewportPoint(x0, y0),
    viewport.convertToViewportPoint(x1, y0),
    viewport.convertToViewportPoint(x0, y1),
    viewport.convertToViewportPoint(x1, y1),
  ];
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  const vx0 = Math.min(...xs);
  const vy0 = Math.min(...ys);
  const vx1 = Math.max(...xs);
  const vy1 = Math.max(...ys);
  return {
    x: vx0,
    y: viewport.height - vy1,
    width: vx1 - vx0,
    height: vy1 - vy0,
  };
}

interface RawTextItem {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  dir?: unknown;
  fontName?: unknown;
}

const FAMILIES = new Set(["serif", "sans-serif", "monospace"]);

/**
 * A pdf.js text item in the page frame (content space less the visible box's
 * origin). Upright only when b = c = 0, a > 0, d > 0 and not vertical
 * writing: the refusal in text.ts `itemBox`. Other items keep their bounding
 * box and can never be a label.
 */
export function textItemToCard(
  item: RawTextItem,
  origin: [number, number],
  styles: Record<string, { fontFamily?: string } | undefined> = {},
): CardText | null {
  if (typeof item.str !== "string" || item.str.trim() === "") return null;
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6) return null;
  const [a, b, c, d, e, f] = t as number[];
  if (![a, b, c, d, e, f].every((n) => typeof n === "number" && isFinite(n)))
    return null;
  const width =
    typeof item.width === "number" && isFinite(item.width)
      ? Math.max(0, item.width)
      : 0;
  const style =
    typeof item.fontName === "string" ? styles[item.fontName] : undefined;
  const family =
    style?.fontFamily && FAMILIES.has(style.fontFamily)
      ? (style.fontFamily as CardText["family"])
      : undefined;
  const upright = b === 0 && c === 0 && a! > 0 && d! > 0 && item.dir !== "ttb";
  if (upright) {
    return {
      str: item.str,
      x: e! - origin[0],
      y: f! - origin[1],
      width,
      size: d!,
      upright: true,
      ...(family ? { family } : {}),
    };
  }
  const run = Math.hypot(a!, b!) || 1;
  const size = Math.hypot(c!, d!);
  const ux = (a! / run) * width;
  const uy = (b! / run) * width;
  const xs = [e!, e! + ux, e! + c!, e! + ux + c!];
  const ys = [f!, f! + uy, f! + d!, f! + uy + d!];
  return {
    str: item.str,
    x: Math.min(...xs) - origin[0],
    y: Math.min(...ys) - origin[1],
    width: Math.max(...xs) - Math.min(...xs),
    size,
    upright: false,
  };
}

/** A 2-D affine matrix, as pdf.js writes one: [a, b, c, d, e, f]. */
export type Matrix = [number, number, number, number, number, number];

/**
 * Content space to the card frame, read off `viewport` (which applies the
 * crop origin and `/Rotate`): the viewport's own mapping, flipped so y grows
 * up from the displayed bottom edge. {@link toCard} is this matrix on a box.
 */
export function cardMatrix(viewport: ViewportLike): Matrix {
  const o = viewport.convertToViewportPoint(0, 0);
  const ex = viewport.convertToViewportPoint(1, 0);
  const ey = viewport.convertToViewportPoint(0, 1);
  const snap = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return [
    snap(ex[0]! - o[0]!),
    snap(-(ex[1]! - o[1]!)),
    snap(ey[0]! - o[0]!),
    snap(-(ey[1]! - o[1]!)),
    o[0]!,
    viewport.height - o[1]!,
  ];
}

const applyTo = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** `t`, then `m`. Near-zero rotation terms snap to 0 (the upright test is exact). */
function compose(m: Matrix, t: readonly number[]): number[] {
  const snap = (v: number, scale: number) =>
    Math.abs(v) < 1e-9 * Math.max(1, scale) ? 0 : v;
  const [a, b, c, d, e, f] = t as number[];
  const s = Math.hypot(a!, b!, c!, d!);
  return [
    snap(m[0] * a! + m[2] * b!, s),
    snap(m[1] * a! + m[3] * b!, s),
    snap(m[0] * c! + m[2] * d!, s),
    snap(m[1] * c! + m[3] * d!, s),
    m[0] * e! + m[2] * f! + m[4],
    m[1] * e! + m[3] * f! + m[5],
  ];
}

/**
 * A pdf.js text item as the READER sees it: its transform carried into the
 * card frame by `m` (see {@link cardMatrix}), so "upright" means upright on
 * screen, after `/Rotate`, never merely upright in content space.
 */
export function itemOnScreen(item: RawTextItem, m: Matrix): RawTextItem {
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6) return item;
  return { ...item, transform: compose(m, t) };
}

/**
 * Whether a text item reads upright in content space but not on screen:
 * the page's `/Rotate` turns it sideways or upside down for the reader. The
 * finder classifies what the reader sees (review round 7, 2026-11-19: it
 * used to classify content space, so a `/Rotate 90` page whose labels the
 * reader sees sideways was searched and given fields whose typed text runs
 * across the printed line, while a landscape form made the common way,
 * upright on screen, was refused as "drawn on its side").
 */
export function turnedOnScreen(item: RawTextItem, m: Matrix): boolean {
  const inContent = textItemToCard(item, [0, 0]);
  if (!inContent?.upright) return false;
  return !textItemToCard(itemOnScreen(item, m), [0, 0])?.upright;
}

/** Share of the page box the image boxes cover, sampled on a 50 x 50 grid. */
export function imageCover(
  images: readonly ImageBox[],
  width: number,
  height: number,
  origin: [number, number] = [0, 0],
): number {
  if (images.length === 0 || width <= 0 || height <= 0) return 0;
  const N = 50;
  let hit = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = origin[0] + ((i + 0.5) / N) * width;
      const y = origin[1] + ((j + 0.5) / N) * height;
      if (images.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1))
        hit++;
    }
  }
  return hit / (N * N);
}

interface ReadPage {
  page: number;
  /** The page as the reader sees it: every primitive in the card frame. */
  card: CardPage;
  painted: number;
  textItems: number;
  /** Text items upright in content space that `/Rotate` turns on screen. */
  turned: number;
}

const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

function abortError(): Error {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Read a PDF and propose fields, page by page. Pages are read in order, one
 * at a time; `signal` is checked between pages, while reading and while
 * classifying, and an abort throws an `AbortError`. Pages past {@link DETECT.CAPS.pages} are reported skipped.
 * Classification waits until every page is read, because the band rule
 * compares lines across pages; what is kept meanwhile is each page's
 * primitives, bounded by the walker's caps.
 */
export async function detectFormFields(
  bytes: Uint8Array,
  o: DetectOptions = {},
): Promise<DetectReport> {
  const guard = await import("./pdfjs-guard");
  await guard.preflightPdfjsOpen(bytes);
  const pdfjs = await (
    o.loadReader ?? (loadPdfjs as unknown as () => Promise<PdfjsLike>)
  )();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  const doc = await awaitPdfjsDocument(task);

  const pages: PageOutcome[] = [];
  const counts = emptyCounts();
  const excluded: Excluded[] = [];
  try {
    const total = guard.pdfjsPageCount(doc.numPages);
    const toRead = Math.min(total, DETECT.CAPS.pages);
    const read: ReadPage[] = [];
    const outcome = new Map<number, PageOutcome>();

    for (let n = 1; n <= toRead; n++) {
      if (o.signal?.aborted) throw abortError();
      let page: Awaited<ReturnType<typeof doc.getPage>> | null = null;
      try {
        page = await doc.getPage(n);
        const userUnit =
          typeof (page as { userUnit?: unknown }).userUnit === "number" &&
          (page as { userUnit: number }).userUnit > 0
            ? (page as { userUnit: number }).userUnit
            : 1;
        // The builder's points are the PDF's default user space: undo
        // pdf.js's /UserUnit scaling of the viewport.
        const viewport = page.getViewport({ scale: 1 / userUnit });
        // Everything is classified in the card frame, the page as the
        // reader sees it (crop applied, /Rotate turned): "upright" and
        // "beside" then mean what they mean on screen, and a proposal
        // needs no mapping back.
        const m = cardMatrix(viewport);
        const width = viewport.width;
        const height = viewport.height;
        const content = await page.getTextContent({
          includeMarkedContent: false,
        });
        const styles = (content.styles ?? {}) as Record<
          string,
          { fontFamily?: string }
        >;
        const items = content.items as RawTextItem[];
        const text = items
          .map((it) => textItemToCard(itemOnScreen(it, m), [0, 0], styles))
          .filter((t): t is CardText => t !== null);
        const turned = items.filter((it) => turnedOnScreen(it, m)).length;
        // Page content only: existing widgets are read from the annotations
        // below, and their appearance streams are not lines on the page.
        const ops = await page.getOperatorList(
          pdfjs.AnnotationMode
            ? { annotationMode: pdfjs.AnnotationMode.DISABLE }
            : {},
        );
        const scan = scanPaths(ops.fnArray, ops.argsArray, pdfjs.OPS);
        if (scan.capped) {
          outcome.set(n, {
            page: n,
            outcome: "skipped",
            reason: "too-complex",
          });
        } else {
          // A segment keeps its direction (its ends, each carried over); a
          // box is carried corner by corner and normalised (a quarter turn
          // keeps it axis-aligned).
          const seg = <
            T extends { x0: number; y0: number; x1: number; y1: number },
          >(
            s: T,
          ): T => {
            const [x0, y0] = applyTo(m, s.x0, s.y0);
            const [x1, y1] = applyTo(m, s.x1, s.y1);
            return { ...s, x0, y0, x1, y1 };
          };
          const box = <
            T extends { x0: number; y0: number; x1: number; y1: number },
          >(
            s: T,
          ): T => {
            const b = toCard(s.x0, s.y0, s.x1, s.y1, viewport);
            return {
              ...s,
              x0: b.x,
              y0: b.y,
              x1: b.x + b.width,
              y1: b.y + b.height,
            };
          };
          const widgets: Box[] = [];
          for (const raw of await page.getAnnotations({ intent: "display" })) {
            const a = raw as { subtype?: unknown; rect?: unknown };
            if (a.subtype !== "Widget" || !Array.isArray(a.rect)) continue;
            const [x0, y0, x1, y1] = a.rect as number[];
            widgets.push(toCard(x0!, y0!, x1!, y1!, viewport));
          }
          read.push({
            page: n,
            painted: scan.painted,
            textItems: text.length,
            turned,
            card: {
              page: n,
              width,
              height,
              segs: scan.segs.map(seg),
              rects: scan.rects.map(box),
              text,
              widgets,
              imageCover: imageCover(scan.images.map(box), width, height),
            },
          });
        }
      } catch (err) {
        if ((err as { name?: unknown })?.name === "AbortError") throw err;
        const mapped = guard.pdfjsPageError(err);
        outcome.set(n, {
          page: n,
          outcome: "unread",
          reason: mapped instanceof Error ? mapped.message : String(mapped),
        });
      } finally {
        page?.cleanup();
      }
      o.onPage?.(n, toRead);
      await macrotask();
    }

    // Classify, now that every page's band lines are known. The signal is
    // checked, and a macrotask awaited, between pages here too: a long run
    // could not be cancelled once every page was read.
    const lines = new Map(read.map((r) => [r.page, bandLines(r.card)]));
    let runTotal = 0;
    for (const r of read) {
      await macrotask();
      if (o.signal?.aborted) throw abortError();
      const { card } = r;
      if (r.painted === 0 && r.textItems === 0) {
        outcome.set(r.page, { page: r.page, outcome: "nothing-drawn" });
        continue;
      }
      if (card.imageCover > SCAN_COVER && !card.text.some((t) => t.upright)) {
        outcome.set(r.page, { page: r.page, outcome: "no-text-layer" });
        continue;
      }
      // Cards are in the card frame already, as the page is.
      const drafts = (o.drafts ?? []).filter((d) => d.page === r.page);
      const result = classifyPage(card, {
        disable: o.disable,
        drafts,
        repeatsAcrossPages: read
          .filter((x) => x.page !== r.page)
          .map((x) => lines.get(x.page)!),
      });
      for (const key of Object.keys(counts) as (keyof DetectCounts)[])
        counts[key] += result.counts[key];
      for (const e of result.excluded) excluded.push(e);
      let proposals = result.proposals.map((p) => {
        const b: Box = p;
        const x = Math.round(b.x);
        const y = Math.round(b.y);
        const width = Math.round(b.x + b.width) - x;
        const height = Math.round(b.y + b.height) - y;
        return {
          ...p,
          key: `${p.page}:${p.rule}:${x}:${y}`,
          x,
          y,
          width,
          height,
        };
      });
      const room = DETECT.CAPS.perRun - runTotal;
      let leftOut = result.counts.capped;
      if (proposals.length > room) {
        counts.capped += proposals.length - Math.max(0, room);
        leftOut += proposals.length - Math.max(0, room);
        proposals = proposals.slice(0, Math.max(0, room));
      }
      counts.proposals += proposals.length - result.counts.proposals;
      runTotal += proposals.length;
      // Nothing found on a page drawn turned is not "no fields here".
      const turnedPage =
        result.proposals.length === 0 &&
        r.turned > card.text.filter((t) => t.upright).length;
      outcome.set(
        r.page,
        proposals.length > 0
          ? {
              page: r.page,
              outcome: "found",
              proposals,
              ...(leftOut > 0 ? { leftOut } : {}),
            }
          : leftOut > 0
            ? { page: r.page, outcome: "capped", leftOut }
            : turnedPage
              ? { page: r.page, outcome: "turned-content" }
              : { page: r.page, outcome: "no-candidates" },
      );
    }

    for (let n = 1; n <= total; n++) {
      if (n > toRead) {
        pages.push({ page: n, outcome: "skipped", reason: "page-cap" });
      } else pages.push(outcome.get(n)!);
    }
    counts.pagesNotSearched = pages.filter(
      (p) => p.outcome === "skipped",
    ).length;
    return { pages, counts, excluded };
  } finally {
    try {
      doc.cleanup();
    } catch {
      // best effort
    }
    await task.destroy().catch(() => {});
  }
}
