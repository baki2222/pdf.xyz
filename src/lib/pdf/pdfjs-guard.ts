import {
  PdfEngineError,
  UNREADABLE_PDF_MESSAGE,
  pdfjsLoadError,
} from "./engine-errors";
import { MAX_DECODED_PIXELS } from "./pixel-ceiling";

/**
 * What every pdf.js consumer (text, Markdown, Compare, has-text, the
 * rasterizer, page counts) checks around pdf.js, because pdf.js does not.
 *
 * A hostile-input matrix (2026-11) found four ways a file pdf.js accepts
 * reaches a user as a wrong answer or a stalled tab:
 *
 *  - `numPages` is whatever the root /Pages /Count says when it is 0 or
 *    negative (pdf.js 6 skips its own last-page check for counts <= 1), so a
 *    `1..numPages` loop runs zero times and a page that has text reports
 *    "-1 pages, no text" (CO-03, PS-11). {@link pdfjsPageCount}.
 *  - a page-walk failure (`getPage` on a /Kids cycle) arrives AFTER the open,
 *    outside the open's error translation, as raw pdf.js text (CO-11).
 *    {@link pdfjsPageError}.
 *  - pdf.js's FlateStream has no output cap: a 2.5 KB chained-Flate content
 *    stream inflates to 1 GiB in memory (CO-06); 100,000 unclosed `q` make
 *    `getTextContent` superlinear, 8 minutes for one page (STAMP-14); a
 *    100-megapixel image decodes 300 MB of samples to paint a 72-dpi
 *    thumbnail (CO-08). {@link preflightPdfjsBytes} reads the file's streams
 *    once, bounded, BEFORE pdf.js sees them.
 *
 * Its own module, loaded with `import()` by its callers: `text.ts` and
 * `pdfjs.ts` sit in tool pages' first load, and none of this is needed until
 * a document is actually opened.
 */

/**
 * The most bytes one non-image stream may inflate to: 400,000,000.
 *
 * The same figure the product already allows for the largest decoded thing it
 * accepts from a stranger — one TIFF page, `MAX_DECODED_PIXELS * 4`
 * (`tiff.ts`, MAX_TIFF_PAGE_BYTES). pdf.js keeps a decoded stream whole in
 * memory (and doubles its buffer while growing it), so this is a memory
 * bound. Measured headroom: the largest decoded non-image stream in the legit
 * corpus is under 0.1 MB; a 300-page text document's content streams are a
 * few hundred KB each. The CO-06 fixture inflates to 1,073,741,824.
 */
export const MAX_DECODED_STREAM_BYTES = MAX_DECODED_PIXELS * 4;

/**
 * The most bytes all of a file's non-image streams may inflate to together:
 * 1,600,000,000. It bounds the PREFLIGHT's own time (each byte is inflated
 * once more than pdf.js would), and pdf.js's text path inflates every one of
 * them anyway. Four per-stream ceilings: a document of a few streams just
 * under the per-stream bound still opens, and a file of hundreds of
 * medium-sized bombs stops after ~1.6 GB of inflate (about 3-5 s) rather than
 * after 100 MB x 1,032.
 */
export const MAX_DECODED_TOTAL_BYTES = MAX_DECODED_STREAM_BYTES * 4;

/**
 * The deepest `q` nesting any one page may reach: 16,384.
 *
 * pdf.js chains every saved state onto the last one's prototype, so each `q`
 * makes every later state read slower. `extractPdfText` on one page, text
 * before and after the `q`s, measured on base (2026-11-08, pdfjs-dist
 * 6.2.108, Node, tsx start-up of ~0.6 s included): 5k 1.5 s, 10k 2.8 s,
 * 16,384 2.8-3.2 s, 24,576 5.7-5.9 s, 32,640 (32 streams) 66 s, 100k 493 s
 * (STAMP-14). The cost falls off a cliff between 24k and 32k, so the bound
 * sits at half the cliff: a page at the bound reads in about 3 s.
 *
 * ISO 32000-1 Annex C (Table C.1) lists 28 as Acrobat's graphics-state
 * nesting limit, so a file real viewers draw sits far below this.
 *
 * The scan cannot tell which streams one page concatenates (a /Contents
 * array, the forms it paints), so it bounds every page from above: a page
 * that ends in stream i was at most (what every OTHER stream leaves open) +
 * (stream i's own deepest point) deep. {@link PdfStreamScan.maxQReach} is the
 * largest of those, and it is this figure that is held to the bound. One
 * stream 16,384 deep reads; 32 streams of 1,020 (32,640) do not; a document
 * whose pages leak `q` passes while the leaks sum to 16,384 or less (4,000
 * pages leaking 4 each).
 */
export const MAX_GRAPHICS_STATE_DEPTH = 16_384;

/**
 * The most pixels one colour or 8-bit image may have on the RASTER path
 * (thumbnails, PDF to JPG/PNG, Grayscale, Redact): 50,000,000.
 *
 * pdf.js decodes an image at full size before it scales it to the page, as
 * one step `renderTask.cancel()` cannot interrupt, and the cost is per PIXEL
 * for anything above 1 bit (every sample becomes RGBA). One 72-dpi page
 * holding one Flate image, measured through `rasterizePdf` on base (Node,
 * `@napi-rs/canvas`): RGB 9 MP 1.2 s, 25 MP 4.6 s, 50 MP 12-22 s, 100 MP
 * 43.5 s (CO-08 saw 42 s and 1.5 GB); 8-bit GRAY 50 MP 12.2 s, 150 MP 86 s;
 * DCT (JPEG) RGB 50 MP 12-18 s. Half the product's pixel ceiling keeps a page
 * inside ~20 s. 50 MP still takes a 600-dpi A4 scan (4,960 x 7,016 = 34.8 MP)
 * and a 300-dpi A2 (34.8 MP).
 */
export const RASTER_MAX_IMAGE_PIXELS = MAX_DECODED_PIXELS / 2;

/**
 * The most pixels one BILEVEL image (1 bit per sample, one gray component or
 * an /ImageMask) may have on the raster path: 400,000,000.
 *
 * pdf.js paints 1-bpc gray through its packed GRAYSCALE_1BPP path, 20-50x
 * cheaper per pixel than colour: Flate 1-bit, measured on base, 69.6 MP (a
 * 600-dpi A3 scan) 0.38-0.45 s, 248 MP (a 400-dpi A0) 1.2-2.8 s. Four times
 * the product's pixel ceiling admits both measured scans with room; past it
 * nothing was measured, so nothing is admitted. CCITT and JBIG2 bilevel
 * images decode through other code (pdf.js's CCITT decoder, its JBIG2
 * decoder) whose cost was not measured; they are held to the same figure.
 */
export const RASTER_MAX_BILEVEL_PIXELS = MAX_DECODED_PIXELS * 4;

/** Copy for a file whose streams expand past the bounds above. */
export const PDF_EXPANDS_TOO_FAR_MESSAGE =
  "This PDF expands to more data than can be processed in your browser.";

/** Copy for a file whose page content nests past MAX_GRAPHICS_STATE_DEPTH. */
export const PDF_NESTED_TOO_DEEPLY_MESSAGE =
  "This PDF's page content is nested too deeply to read safely.";

/**
 * Copy for an image over its raster budget, on a path that writes pixels.
 * "Over 50 megapixels" is true of every image refused: both budgets are at
 * least {@link RASTER_MAX_IMAGE_PIXELS}.
 */
export const PDF_IMAGE_TOO_LARGE_MESSAGE =
  "This PDF contains an image too large to render in your browser (over 50 megapixels).";

export { pdfjsPageCount } from "./pdfjs-num-pages";

/** pdf.js's names for a failure that is about the document's structure. */
const PDFJS_PAGE_WALK_FAILURES = new Set([
  "UnknownErrorException",
  "FormatError",
  "InvalidPDFException",
  "MissingPDFException",
]);

/**
 * Translate a failure from a page walk (`getPage`, `getTextContent`) — the
 * part after the open that `awaitPdfjsDocument` never sees. The open's own
 * translation runs first (a password or an unknown security handler), then
 * pdf.js's structure failures (a /Kids cycle: "Pages tree contains circular
 * reference.", which crosses the worker boundary as UnknownErrorException)
 * and its "Invalid page request" become the unreadable-file copy. A
 * cancellation, or anything not raised by the document, passes unchanged.
 */
export function pdfjsPageError(err: unknown): unknown {
  if (err instanceof PdfEngineError) return err;
  const mapped = pdfjsLoadError(err);
  if (mapped !== err) return mapped;
  const name = (err as { name?: unknown } | null)?.name;
  const message = (err as { message?: unknown } | null)?.message;
  if (
    (typeof name === "string" && PDFJS_PAGE_WALK_FAILURES.has(name)) ||
    message === "Invalid page request."
  ) {
    return new PdfEngineError(UNREADABLE_PDF_MESSAGE, {
      kind: "unreadable",
      cause: err,
    });
  }
  return err;
}

/* ------------------------------------------------------------------ *
 *  The preflight: one bounded pass over the file's streams
 * ------------------------------------------------------------------ */

/** What {@link scanPdfStreams} found; exported for its tests. */
export interface PdfStreamScan {
  /** Streams seen (every `stream` keyword after a dictionary). */
  streams: number;
  /** Non-image streams whose Flate stages were inflated (counted). */
  inflated: number;
  /** Largest single decoded non-image stream, in bytes. */
  maxStreamBytes: number;
  /** All decoded non-image streams together, in bytes. */
  totalBytes: number;
  /** Deepest `q` nesting reached inside any one content stream. */
  maxQDepth: number;
  /** `q` left open at the end of each content stream, summed over the file. */
  unclosedQ: number;
  /**
   * The deepest any page could reach: the largest, over content streams, of
   * (what every other stream leaves open) + (this stream's deepest point).
   */
  maxQReach: number;
  /** Largest image XObject, in pixels (Width x Height). */
  maxImagePixels: number;
  /**
   * The fewest pixels of any image over its raster budget
   * ({@link RASTER_MAX_IMAGE_PIXELS}, or {@link RASTER_MAX_BILEVEL_PIXELS}
   * for a bilevel one); null when every image is within budget.
   */
  smallestOverBudgetImage: number | null;
  /** The first bound the scan stopped at, or null. */
  exceeded: "stream-bytes" | "total-bytes" | "q-depth" | null;
}

const latin1 = new TextDecoder("latin1");

/** PDF whitespace: NUL, TAB, LF, FF, CR, SPACE. */
function isWhite(b: number): boolean {
  return (
    b === 0x20 ||
    b === 0x0a ||
    b === 0x0d ||
    b === 0x09 ||
    b === 0x0c ||
    b === 0x00
  );
}

/** A byte after which an operator may start: whitespace or a closing delimiter. */
function endsToken(b: number): boolean {
  return isWhite(b) || b === 0x29 || b === 0x5d || b === 0x3e || b === 0x7d;
}

/** A byte that may follow an operator: whitespace or any delimiter. */
function startsToken(b: number): boolean {
  return (
    isWhite(b) ||
    b === 0x28 || // (
    b === 0x29 ||
    b === 0x3c || // <
    b === 0x3e ||
    b === 0x5b || // [
    b === 0x5d ||
    b === 0x7b ||
    b === 0x7d ||
    b === 0x2f || // /
    b === 0x25 // %
  );
}

const Q_LOWER = 0x71;
const Q_UPPER = 0x51;

/**
 * A streaming `q`/`Q` depth counter: fed chunk by chunk, it tracks the running
 * nesting of standalone `q` and `Q` tokens and the deepest it reached. A `Q`
 * with nothing open is ignored, as pdf.js ignores it.
 */
class QDepth {
  depth = 0;
  max = 0;
  private prevEnds = true;
  private pending = 0;
  feed(chunk: Uint8Array): void {
    let { depth, max, prevEnds, pending } = this;
    for (let i = 0; i < chunk.length; i += 1) {
      const b = chunk[i]!;
      if (pending !== 0) {
        if (startsToken(b)) {
          if (pending === Q_LOWER) {
            depth += 1;
            if (depth > max) max = depth;
          } else if (depth > 0) depth -= 1;
        }
        pending = 0;
      }
      if ((b === Q_LOWER || b === Q_UPPER) && prevEnds) pending = b;
      prevEnds = endsToken(b);
    }
    Object.assign(this, { depth, max, prevEnds, pending });
  }
  end(): void {
    this.feed(Uint8Array.of(0x20));
  }
}

/** The dictionary text that ends at `end` (exclusive, just past `>>`). */
function dictBefore(bytes: Uint8Array, end: number): string | null {
  let depth = 0;
  const floor = Math.max(0, end - 65_536);
  for (let i = end - 1; i > floor; i -= 1) {
    if (bytes[i] === 0x3e && bytes[i - 1] === 0x3e) {
      depth += 1;
      i -= 1;
    } else if (bytes[i] === 0x3c && bytes[i - 1] === 0x3c) {
      depth -= 1;
      i -= 1;
      if (depth === 0) return latin1.decode(bytes.subarray(i, end));
    }
  }
  return null;
}

const STREAM = Uint8Array.from("stream", (c) => c.charCodeAt(0));
const ENDSTREAM = Uint8Array.from("endstream", (c) => c.charCodeAt(0));

function matchesAt(bytes: Uint8Array, at: number, word: Uint8Array): boolean {
  if (at < 0 || at + word.length > bytes.length) return false;
  for (let k = 0; k < word.length; k += 1) {
    if (bytes[at + k] !== word[k]) return false;
  }
  return true;
}

function indexOfWord(
  bytes: Uint8Array,
  word: Uint8Array,
  from: number,
): number {
  const first = word[0]!;
  for (
    let i = bytes.indexOf(first, from);
    i !== -1;
    i = bytes.indexOf(first, i + 1)
  ) {
    if (matchesAt(bytes, i, word)) return i;
  }
  return -1;
}

/** The filter names of a stream dictionary, in decode order. */
function filtersOf(dict: string): string[] {
  const m = /\/Filter\s*(\/[^\s/<>[\]()]+|\[([^\]]*)\])/.exec(dict);
  if (!m) return [];
  if (m[2] === undefined) return [m[1]!.slice(1)];
  return m[2]
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

const intEntry = (dict: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s+(\\d+)(?![\\d.]|\\s+\\d+\\s+R)`).exec(dict);
  return m ? Number(m[1]) : null;
};

/** Streams whose bytes are not page content: fonts, xref, object streams. */
function isContentLike(dict: string): boolean {
  if (/\/Length[123]\b/.test(dict)) return false;
  if (/\/Type\s*\/(?:XRef|ObjStm|Metadata|EmbeddedFile)\b/.test(dict))
    return false;
  const subtype = /\/Subtype\s*\/([^\s/<>[\]()]+)/.exec(dict)?.[1];
  return subtype === undefined || subtype === "Form";
}

/**
 * Inflate `data` through `stages` Flate passes, counting the output and
 * feeding it to `onChunk`, and stop once it passes `limit` bytes. Returns the
 * bytes produced (limit + something when it stopped early). A stream that is
 * not valid zlib (encrypted, damaged) stops where it breaks, as pdf.js would.
 */
async function inflateCounting(
  data: Uint8Array,
  stages: number,
  limit: number,
  onChunk: ((chunk: Uint8Array) => void) | null,
): Promise<number> {
  // A plain ReadableStream, not `Blob.stream()`: jsdom's Blob has no stream.
  let stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  for (let s = 0; s < stages; s += 1) {
    stream = stream.pipeThrough(
      new DecompressionStream("deflate") as unknown as TransformStream<
        Uint8Array,
        Uint8Array
      >,
    );
  }
  const reader = stream.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      onChunk?.(value);
      if (total > limit) break;
    }
  } catch {
    // Not zlib, truncated, or a bad checksum: count what came out.
  } finally {
    reader.cancel().catch(() => {});
  }
  return total;
}

const FLATE = new Set(["FlateDecode", "Fl"]);

/**
 * An image pdf.js paints through its cheap 1-bit path: an /ImageMask, or 1
 * bit per sample in ONE gray component named in the dictionary itself. An
 * Indexed, ICC (by reference) or colour 1-bit image is expanded to RGB like
 * any other, so it is not bilevel here; a missing colour space errs the same
 * way (held to the colour budget).
 */
function isBilevel(dict: string): boolean {
  if (/\/(?:ImageMask|IM)\s+true\b/.test(dict)) return true;
  if (intEntry(dict, "BitsPerComponent") !== 1 && intEntry(dict, "BPC") !== 1)
    return false;
  return /\/(?:ColorSpace|CS)\s*\/(?:DeviceGray|CalGray|G)\b/.test(dict);
}

/**
 * One pass over every stream in `bytes`, bounded: each non-image stream's
 * leading Flate stages are inflated (counted, never kept) and its `q` depth
 * measured; each image's Width x Height is read from its dictionary. Stops at
 * the first bound passed. Streams behind other filters (LZW, ASCII85) are
 * not decoded; their size is not seen.
 */
export async function scanPdfStreams(
  bytes: Uint8Array,
): Promise<PdfStreamScan> {
  const scan: PdfStreamScan = {
    streams: 0,
    inflated: 0,
    maxStreamBytes: 0,
    totalBytes: 0,
    maxQDepth: 0,
    unclosedQ: 0,
    maxQReach: 0,
    maxImagePixels: 0,
    smallestOverBudgetImage: null,
    exceeded: null,
  };
  // max over content streams of (deepest point - left open): see maxQReach.
  let maxQExcess = 0;
  let at = 0;
  for (;;) {
    const kw = indexOfWord(bytes, STREAM, at);
    if (kw === -1) break;
    at = kw + STREAM.length;
    // `endstream` contains `stream`; only a keyword after `>>` starts data.
    let back = kw - 1;
    while (back >= 0 && isWhite(bytes[back]!)) back -= 1;
    if (!(bytes[back] === 0x3e && bytes[back - 1] === 0x3e)) continue;
    let start = at;
    if (bytes[start] === 0x0d) start += 1;
    if (bytes[start] === 0x0a) start += 1;
    const dict = dictBefore(bytes, back + 1);
    if (dict === null) continue;
    scan.streams += 1;

    const length = intEntry(dict, "Length");
    let end =
      length !== null && start + length <= bytes.length ? start + length : -1;
    if (end === -1 || indexOfWord(bytes, ENDSTREAM, end) - end > 4) {
      end = indexOfWord(bytes, ENDSTREAM, start);
      if (end === -1) end = bytes.length;
    }
    at = Math.max(at, end);

    if (/\/Subtype\s*\/Image\b/.test(dict)) {
      const w = intEntry(dict, "Width") ?? 0;
      const h = intEntry(dict, "Height") ?? 0;
      const pixels = w * h;
      scan.maxImagePixels = Math.max(scan.maxImagePixels, pixels);
      const budget = isBilevel(dict)
        ? RASTER_MAX_BILEVEL_PIXELS
        : RASTER_MAX_IMAGE_PIXELS;
      if (
        pixels > budget &&
        (scan.smallestOverBudgetImage === null ||
          pixels < scan.smallestOverBudgetImage)
      ) {
        scan.smallestOverBudgetImage = pixels;
      }
      continue;
    }

    const filters = filtersOf(dict);
    let flateStages = 0;
    while (flateStages < filters.length && FLATE.has(filters[flateStages]!)) {
      flateStages += 1;
    }
    const content = isContentLike(dict) && flateStages === filters.length;
    const q = content ? new QDepth() : null;
    const data = bytes.subarray(start, end);
    let decoded: number;
    if (flateStages > 0) {
      const limit = Math.min(
        MAX_DECODED_STREAM_BYTES,
        MAX_DECODED_TOTAL_BYTES - scan.totalBytes,
      );
      decoded = await inflateCounting(
        data,
        flateStages,
        limit,
        q && ((c) => q.feed(c)),
      );
      scan.inflated += 1;
    } else {
      decoded = data.length;
      if (filters.length === 0) q?.feed(data);
    }
    q?.end();
    scan.maxStreamBytes = Math.max(scan.maxStreamBytes, decoded);
    scan.totalBytes += decoded;
    if (q) {
      scan.maxQDepth = Math.max(scan.maxQDepth, q.max);
      scan.unclosedQ += q.depth;
      maxQExcess = Math.max(maxQExcess, q.max - q.depth);
      scan.maxQReach = scan.unclosedQ + maxQExcess;
    }
    if (decoded > MAX_DECODED_STREAM_BYTES) scan.exceeded = "stream-bytes";
    else if (scan.totalBytes > MAX_DECODED_TOTAL_BYTES)
      scan.exceeded = "total-bytes";
    else if (scan.maxQReach > MAX_GRAPHICS_STATE_DEPTH)
      scan.exceeded = "q-depth";
    if (scan.exceeded) break;
  }
  return scan;
}

/** What {@link preflightPdfjsBytes} found that a raster path acts on. */
export interface PdfjsPreflight {
  /**
   * For a PREVIEW (thumbnails): pdf.js's own `maxImageSize`, set just below
   * the smallest over-budget image, so pdf.js skips that image before it
   * decodes it and paints the rest of the page. Absent when every image is
   * within budget, and pdf.js then behaves exactly as before.
   */
  previewOptions: { maxImageSize?: number };
  /** Whether any image is over its raster budget. */
  overBudgetImage: boolean;
}

/**
 * Refuse, with a typed error, a file pdf.js would inflate past the memory
 * bounds above or whose content nests past {@link MAX_GRAPHICS_STATE_DEPTH}.
 * Call it before `getDocument`.
 *
 * Images are left to the caller, because previews and outputs differ:
 *
 *  - a preview spreads {@link PdfjsPreflight.previewOptions} into
 *    `getDocument`: the page's tile shows the page without the over-budget
 *    image instead of stalling ~40 s on it, and every other page's tile is
 *    unchanged;
 *  - a path that WRITES pixels (PDF to JPG/PNG, Grayscale, Redact) calls
 *    {@link refuseOverBudgetImages}: a page written without its image would
 *    be a wrong document, so the file is refused by name.
 *
 * Why not per page on the output path: pdf.js 6 does not report the skip.
 * Under the default `stopAtErrors: false` it warns and paints without the
 * image; under `stopAtErrors: true` its error reaches `_pumpOperatorList`
 * after the render has started, which ends the operator list early and lets
 * the render RESOLVE on a truncated page (measured: `getOperatorList` on
 * CO-08's file with both options resolves with 0 operators, no error). The
 * byte scan cannot tell which page paints which image (resources are
 * inherited and may sit in object streams), so the refusal is the file's.
 *
 * The refusals carry no `kind`: the file is not unreadable, it is more than
 * this tier will process.
 */
export async function preflightPdfjsBytes(
  bytes: Uint8Array,
): Promise<PdfjsPreflight> {
  const scan = await scanPdfStreams(bytes);
  if (scan.exceeded === "q-depth") {
    throw new PdfEngineError(PDF_NESTED_TOO_DEEPLY_MESSAGE);
  }
  if (scan.exceeded) throw new PdfEngineError(PDF_EXPANDS_TOO_FAR_MESSAGE);
  if (scan.smallestOverBudgetImage === null) {
    return { previewOptions: {}, overBudgetImage: false };
  }
  return {
    previewOptions: { maxImageSize: scan.smallestOverBudgetImage - 1 },
    overBudgetImage: true,
  };
}

/** The output paths' refusal of a file holding an over-budget image. */
export function refuseOverBudgetImages(preflight: PdfjsPreflight): void {
  if (preflight.overBudgetImage) {
    throw new PdfEngineError(PDF_IMAGE_TOO_LARGE_MESSAGE);
  }
}
