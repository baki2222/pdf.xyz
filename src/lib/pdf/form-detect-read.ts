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
 * It proposes and never writes. It reads only what the PDF draws as text,
 * lines and boxes, so a scanned page (a picture of a form) reads as
 * "no-text-layer", and a page with nothing readable as "nothing-drawn" or
 * "unread", never as "no fields here" (both pinned by the outcome cases in
 * src/tests/form-detect-fixtures.ts, run by form-detect.pdfjs.test.ts).
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
  | { page: number; outcome: "found"; proposals: FieldProposal[] }
  | { page: number; outcome: "no-candidates" }
  /** No ink and no text: blank OR unreadable, never "no fields". */
  | { page: number; outcome: "nothing-drawn" }
  /** Images cover over half the page and no upright text: likely a scan. */
  | { page: number; outcome: "no-text-layer" }
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

/** A card-frame box back in content space (the inverse of {@link toCard}). */
function fromCard(b: Box, viewport: ViewportLike): Box | null {
  const back = viewport.convertToPdfPoint?.bind(viewport);
  if (!back) return null;
  const H = viewport.height;
  const pts = [
    back(b.x, H - b.y),
    back(b.x + b.width, H - b.y),
    back(b.x, H - b.y - b.height),
    back(b.x + b.width, H - b.y - b.height),
  ];
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
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
  card: CardPage;
  viewport: ViewportLike;
  origin: [number, number];
  painted: number;
  textItems: number;
}

const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

function abortError(): Error {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Read a PDF and propose fields, page by page. Pages are read in order, one
 * at a time; `signal` is checked between pages and an abort throws an
 * `AbortError`. Pages past {@link DETECT.CAPS.pages} are reported skipped.
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
        const view = page.view as number[];
        const origin: [number, number] = [
          Math.min(view[0]!, view[2]!),
          Math.min(view[1]!, view[3]!),
        ];
        const width = Math.abs(view[2]! - view[0]!);
        const height = Math.abs(view[3]! - view[1]!);
        const content = await page.getTextContent({
          includeMarkedContent: false,
        });
        const styles = (content.styles ?? {}) as Record<
          string,
          { fontFamily?: string }
        >;
        const text = (content.items as RawTextItem[])
          .map((it) => textItemToCard(it, origin, styles))
          .filter((t): t is CardText => t !== null);
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
          const shift = <
            T extends { x0: number; y0: number; x1: number; y1: number },
          >(
            s: T,
          ): T => ({
            ...s,
            x0: s.x0 - origin[0],
            y0: s.y0 - origin[1],
            x1: s.x1 - origin[0],
            y1: s.y1 - origin[1],
          });
          const widgets: Box[] = [];
          for (const raw of await page.getAnnotations({ intent: "display" })) {
            const a = raw as { subtype?: unknown; rect?: unknown };
            if (a.subtype !== "Widget" || !Array.isArray(a.rect)) continue;
            const [x0, y0, x1, y1] = a.rect as number[];
            widgets.push({
              x: Math.min(x0!, x1!) - origin[0],
              y: Math.min(y0!, y1!) - origin[1],
              width: Math.abs(x1! - x0!),
              height: Math.abs(y1! - y0!),
            });
          }
          read.push({
            page: n,
            viewport,
            origin,
            painted: scan.painted,
            textItems: text.length,
            card: {
              page: n,
              width,
              height,
              segs: scan.segs.map(shift),
              rects: scan.rects.map(shift),
              text,
              widgets,
              imageCover: imageCover(scan.images, width, height, origin),
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

    // Classify, now that every page's band lines are known.
    const lines = new Map(read.map((r) => [r.page, bandLines(r.card)]));
    let runTotal = 0;
    for (const r of read) {
      const { card, viewport, origin } = r;
      if (r.painted === 0 && r.textItems === 0) {
        outcome.set(r.page, { page: r.page, outcome: "nothing-drawn" });
        continue;
      }
      if (card.imageCover > SCAN_COVER && !card.text.some((t) => t.upright)) {
        outcome.set(r.page, { page: r.page, outcome: "no-text-layer" });
        continue;
      }
      const drafts = (o.drafts ?? [])
        .filter((d) => d.page === r.page)
        .flatMap((d) => {
          const b = fromCard(d, viewport);
          return b
            ? [{ ...b, page: r.page, x: b.x - origin[0], y: b.y - origin[1] }]
            : [];
        });
      const result = classifyPage(card, {
        disable: o.disable,
        drafts,
        repeatsAcrossPages: read
          .filter((x) => x.page !== r.page)
          .map((x) => lines.get(x.page)!),
      });
      for (const key of Object.keys(counts) as (keyof DetectCounts)[])
        counts[key] += result.counts[key];
      const toCardBox = (b: Box): Box =>
        toCard(
          b.x + origin[0],
          b.y + origin[1],
          b.x + b.width + origin[0],
          b.y + b.height + origin[1],
          viewport,
        );
      for (const e of result.excluded)
        excluded.push({ ...e, box: toCardBox(e.box) });
      let proposals = result.proposals.map((p) => {
        const b = toCardBox(p);
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
      if (proposals.length > room) {
        counts.capped += proposals.length - Math.max(0, room);
        proposals = proposals.slice(0, Math.max(0, room));
      }
      counts.proposals += proposals.length - result.counts.proposals;
      runTotal += proposals.length;
      outcome.set(
        r.page,
        proposals.length > 0
          ? { page: r.page, outcome: "found", proposals }
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
