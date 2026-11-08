import {
  PdfEngineError,
  UNREADABLE_PDF_MESSAGE,
  pdfjsLoadError,
} from "./engine-errors";
import {
  DICT_SEARCH_WINDOW,
  DictMatcher,
  type DictValue,
  RefCounter,
  ascii,
  dictEntries,
  indexOfWord,
  isDelimiter,
  isWhite,
  namesOf,
  numericObjects,
  streamObjectNumber,
  valuesOf,
} from "./pdf-scan-bytes";
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
 * The scan cannot tell which streams one page concatenates, so it bounds
 * every page from above ({@link PdfStreamScan.maxQReach}):
 *
 *  - every `q` a content stream leaves open, times the number of times the
 *    file NAMES that stream (`num gen R`, in object text and in decoded
 *    object streams): a /Contents array may list one stream again and
 *    again, and pdf.js reads it each time (second review: one 1,000-q stream
 *    listed 24 times reached 24,000 and read for 4.6 s; the first repair
 *    counted it once);
 *  - plus the largest (deepest point - left open) of any non-form stream;
 *  - plus what Form XObjects add: pdf.js paints a form on a clone of its
 *    caller's state, so depths stack through `Do` (measured on base: three
 *    forms painting each other, each balanced 12,000 deep, 11.9 s; the first
 *    repair saw 12,000). A chain is every form that calls `Do`, plus the
 *    deepest form, each once (pdf.js refuses a circular chain).
 *
 * One stream 16,384 deep reads; 32 streams of 1,020 (32,640) do not; a
 * document whose pages leak `q` passes while the leaks sum to 16,384 or less
 * (4,000 pages leaking 4 each).
 *
 * Depth is not the whole cost: a nest that climbs to 16,000 and comes back
 * costs ~3 s EACH time it climbs, which this bound does not see. See
 * {@link MAX_GRAPHICS_STATE_WORK}.
 */
export const MAX_GRAPHICS_STATE_DEPTH = 16_384;

/**
 * The most `q` work a file may make pdf.js do: 268,451,840 (16,384 x
 * 16,385, twice the work of one climb to {@link MAX_GRAPHICS_STATE_DEPTH}),
 * counted as the sum, over every `q` pdf.js executes, of the depth it reaches.
 *
 * What costs time is CLIMBING: measured on base (2026-11-08, `extractPdfText`,
 * Node, ~0.5 s start-up included), 16,000 q then one text op 2.8 s, and the
 * same plus 2,000 text ops at that depth 2.6 s (text ops at depth are free);
 * 16,000 q then 16,000 `Q q` pairs 2.7 s (re-entering a depth is free); a
 * balanced 16,000 climb repeated 5 times 22 s, 15 times 52 s; one form
 * holding it, painted 30 times, 157 s (the second review's case, which the
 * depth bound alone admitted). The sum of depths at each `q` is an upper
 * bound on the climbing, and it is what is held here, with each paint and
 * each listing multiplied in (see `judgeGraphicsState`).
 *
 * At the budget, measured on base: two balanced 16,384 climbs 4.2-4.3 s; four
 * of 11,585 4.6-5.1 s. Twice the work of one nest to the depth bound, because
 * a form painted once is counted twice (once as possible page content, since
 * a page's /Contents may be labelled /Subtype /Form, and once per `Do`), and
 * that form must still read.
 *
 * Only judged past {@link GRAPHICS_STATE_WORK_FLOOR}: below it, every `q`
 * runs shallow, and the multipliers (how often a form is painted) are the
 * ordinary cost of any repeated content, not a `q` cost.
 */
export const MAX_GRAPHICS_STATE_WORK =
  MAX_GRAPHICS_STATE_DEPTH * (MAX_GRAPHICS_STATE_DEPTH + 1);

/**
 * The depth below which `q` is not a cost multiplier: 256. Measured on base,
 * an 800 KB content stream of 200,000 `q` in balanced climbs: 2 deep 1.25 s,
 * 64 deep 2.0 s, 256 deep 2.4 s, 1,024 deep 3.3 s. Nine times Acrobat's limit
 * of 28 (ISO 32000-1 Annex C); the legit corpus nests at most 2.
 */
export const GRAPHICS_STATE_WORK_FLOOR = 256;

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
  /**
   * `q` left open at the end of each content stream, times the number of
   * times the file names that stream (see `RefCounter`), summed.
   */
  unclosedQ: number;
  /**
   * An upper bound on the deepest any page reaches: {@link unclosedQ} + the
   * largest (deepest point - left open) of a non-form stream + the depth a
   * chain of Form XObjects can add. See {@link MAX_GRAPHICS_STATE_DEPTH}.
   */
  maxQReach: number;
  /**
   * An upper bound on the `q` work pdf.js does (the sum, over every `q` it
   * executes, of the depth it reaches) when {@link maxQReach} is past
   * {@link GRAPHICS_STATE_WORK_FLOOR}; 0 at or below it. See
   * {@link MAX_GRAPHICS_STATE_WORK}.
   */
  qWork: number;
  /** Largest image XObject, in pixels (Width x Height). */
  maxImagePixels: number;
  /**
   * The fewest pixels of any image over its raster budget
   * ({@link RASTER_MAX_IMAGE_PIXELS}, or {@link RASTER_MAX_BILEVEL_PIXELS}
   * for a bilevel one); null when every image is within budget.
   */
  smallestOverBudgetImage: number | null;
  /**
   * Images whose size the scan cannot read: a /Width or /Height that refers
   * to an object the scan cannot see (one held in an object stream), or is
   * not a number. pdf.js resolves those; the scan treats the image as over
   * budget.
   */
  unknownSizeImages: number;
  /** The first bound the scan stopped at, or null. */
  exceeded:
    "stream-bytes" | "total-bytes" | "scan-work" | "q-depth" | "q-work" | null;
}

const latin1 = new TextDecoder("latin1");

/** A byte after which an operator may start: whitespace or a closing delimiter. */
function endsToken(b: number): boolean {
  return isWhite(b) || b === 0x29 || b === 0x5d || b === 0x3e || b === 0x7d;
}

/** A byte that may follow an operator: whitespace or any delimiter. */
function startsToken(b: number): boolean {
  return isWhite(b) || isDelimiter(b);
}

const Q_LOWER = 0x71;
const Q_UPPER = 0x51;
const D_UPPER = 0x44;
const O_LOWER = 0x6f;

/**
 * A streaming operator counter for one content stream, fed chunk by chunk:
 * the running nesting of standalone `q` and `Q` tokens, the deepest it
 * reached, how many `q` it executed and the sum of the depths they reached
 * (its work), and how many `Do` it executed. A `Q` with nothing open is
 * ignored, as pdf.js ignores it.
 */
class ContentOps {
  depth = 0;
  max = 0;
  pushes = 0;
  work = 0;
  dos = 0;
  private prevEnds = true;
  private pending = 0;
  /** 1 after a token-initial `D`, 2 after `Do`. */
  private doState = 0;
  feed(chunk: Uint8Array): void {
    let { depth, max, pushes, work, dos, prevEnds, pending, doState } = this;
    for (let i = 0; i < chunk.length; i += 1) {
      const b = chunk[i]!;
      if (pending !== 0) {
        if (startsToken(b)) {
          if (pending === Q_LOWER) {
            depth += 1;
            pushes += 1;
            work += depth;
            if (depth > max) max = depth;
          } else if (depth > 0) depth -= 1;
        }
        pending = 0;
      }
      if (doState === 2) {
        if (startsToken(b)) dos += 1;
        doState = 0;
      } else if (doState === 1) {
        doState = b === O_LOWER ? 2 : 0;
      }
      if (prevEnds) {
        if (b === Q_LOWER || b === Q_UPPER) pending = b;
        else if (b === D_UPPER) doState = 1;
      }
      prevEnds = endsToken(b);
    }
    Object.assign(this, {
      depth,
      max,
      pushes,
      work,
      dos,
      prevEnds,
      pending,
      doState,
    });
  }
  end(): void {
    this.feed(Uint8Array.of(0x20));
  }
}

/** What one content stream contributes to the page-level `q` bounds. */
interface ContentRecord {
  /** Its object number, or null when no `num gen obj` header was found. */
  num: number | null;
  /** /Subtype /Form: painted by `Do` (or, if mislabelled, as page content). */
  form: boolean;
  max: number;
  left: number;
  pushes: number;
  work: number;
  dos: number;
}

const STREAM = ascii("stream");
const ENDSTREAM = ascii("endstream");

/** The filter names of a stream dictionary, in decode order. */
function filtersOf(entries: Map<string, DictValue[]>): string[] {
  const all = valuesOf(entries, "Filter");
  const v = all[all.length - 1]; // pdf.js keeps a repeated key's last value
  if (v === undefined) return [];
  if (v.kind === "name") return [v.name];
  if (v.kind === "array") {
    return [...v.raw.matchAll(/\/([^\s/<>[\]()]+)/g)].map((m) =>
      m[1]!.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) =>
        String.fromCharCode(parseInt(h, 16)),
      ),
    );
  }
  // An indirect filter list: not resolved here, so not decoded.
  return ["?"];
}

function lengthOf(entries: Map<string, DictValue[]>): number | null {
  const all = valuesOf(entries, "Length");
  const v = all[all.length - 1];
  return v?.kind === "number" && Number.isInteger(v.value) && v.value >= 0
    ? v.value
    : null;
}

/** Streams whose bytes are not page content: fonts, xref, object streams. */
function isContentLike(entries: Map<string, DictValue[]>): boolean {
  if (["Length1", "Length2", "Length3"].some((k) => entries.has(k))) {
    return false;
  }
  const notContent = ["XRef", "ObjStm", "Metadata", "EmbeddedFile"];
  if (namesOf(entries, "Type").some((t) => notContent.includes(t))) {
    return false;
  }
  return namesOf(entries, "Subtype").every((s) => s === "Form");
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
 * bit per sample in ONE gray component named in the dictionary itself
 * (pdf.js takes GRAYSCALE_1BPP only when `colorSpace.name === "DeviceGray"`).
 * Read from the dictionary's TOP level, and every value of a key must agree;
 * pdf.js reads the abbreviated key first, so `/IM`, `/BPC` and `/CS` count
 * too. An Indexed, ICC, CalGray or colour 1-bit image is expanded to RGBA
 * like any other, so it is not bilevel here; nor is a colour space by
 * reference.
 */
function isBilevel(entries: Map<string, DictValue[]>): boolean {
  const masks = valuesOf(entries, "IM", "ImageMask");
  if (
    masks.length > 0 &&
    masks.every((v) => v.kind === "word" && v.word === "true")
  ) {
    return true;
  }
  const bpc = valuesOf(entries, "BPC", "BitsPerComponent");
  const cs = valuesOf(entries, "CS", "ColorSpace");
  return (
    bpc.length > 0 &&
    bpc.every((v) => v.kind === "number" && v.value === 1) &&
    cs.length > 0 &&
    cs.every(
      (v) => v.kind === "name" && (v.name === "DeviceGray" || v.name === "G"),
    )
  );
}

/**
 * An image's pixels: the largest /W or /Width times the largest /H or
 * /Height (pdf.js reads `dict.get("W", "Width")`, the abbreviation first), a
 * reference resolved when the scan can see the number it names. Null when a
 * value is anything else; 0 when a dimension is missing (pdf.js refuses such
 * an image).
 */
function imagePixels(
  entries: Map<string, DictValue[]>,
  numberObject: (num: number) => number | undefined,
): number | null {
  const side = (...keys: string[]): number | null => {
    let best = 0;
    for (const v of valuesOf(entries, ...keys)) {
      const n =
        v.kind === "number"
          ? v.value
          : v.kind === "ref"
            ? numberObject(v.num)
            : undefined;
      if (n === undefined || !Number.isFinite(n)) return null;
      best = Math.max(best, Math.ceil(Math.abs(n)));
    }
    return best;
  };
  const w = side("W", "Width");
  const h = side("H", "Height");
  return w === null || h === null ? null : w * h;
}

/**
 * One pass over every stream in `bytes`, bounded and LINEAR in the file's
 * size: each non-image stream's leading Flate stages are inflated (counted,
 * never kept) and its `q` and `Do` operators counted; each image's size is
 * read from its dictionary's top level; every `num gen R` outside stream data
 * and inside decoded object streams is counted. Stops at the first byte bound
 * passed; the `q` bounds are judged once every reference has been counted.
 * Streams behind other filters (LZW, ASCII85) are not decoded; their size is
 * not seen.
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
    qWork: 0,
    maxImagePixels: 0,
    smallestOverBudgetImage: null,
    unknownSizeImages: 0,
    exceeded: null,
  };
  const dicts = new DictMatcher(bytes);
  const refs = new RefCounter();
  const records: ContentRecord[] = [];
  /** Stream data, [start, end) pairs in file order: not object text. */
  const dataRanges: number[] = [];
  let opaqueObjectStreams = 0;
  let numeric: Map<number, number> | null = null;
  const numberObject = (num: number) =>
    (numeric ??= numericObjects(bytes)).get(num);
  // Every `endstream` before `scannedTo`, each found once.
  const endstreams: number[] = [];
  let scannedTo = 0;
  const endstreamFrom = (from: number): number => {
    let lo = 0;
    let hi = endstreams.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (endstreams[mid]! < from) lo = mid + 1;
      else hi = mid;
    }
    if (lo < endstreams.length) return endstreams[lo]!;
    while (scannedTo < bytes.length) {
      const p = indexOfWord(bytes, ENDSTREAM, scannedTo);
      if (p === -1) {
        scannedTo = bytes.length;
        break;
      }
      endstreams.push(p);
      scannedTo = p + 1;
      if (p >= from) return p;
    }
    return -1;
  };
  // Dictionary text read, in bytes. Real stream dictionaries are disjoint,
  // so this stays under the file's size; only overlapping `<<` soups pass it.
  let dictBytes = 0;
  const dictBudget = 2 * bytes.length + DICT_SEARCH_WINDOW;
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
    const dictStart = dicts.startBefore(back + 1);
    if (dictStart === null) continue;
    dictBytes += back + 1 - dictStart;
    if (dictBytes > dictBudget) {
      scan.exceeded = "scan-work";
      break;
    }
    const entries = dictEntries(
      latin1.decode(bytes.subarray(dictStart, back + 1)),
    );
    scan.streams += 1;

    const length = lengthOf(entries);
    let end =
      length !== null && start + length <= bytes.length ? start + length : -1;
    if (end === -1 || endstreamFrom(end) - end > 4) {
      end = endstreamFrom(start);
      if (end === -1) end = bytes.length;
    }
    at = Math.max(at, end);
    dataRanges.push(start, end);

    if (namesOf(entries, "Subtype").includes("Image")) {
      const pixels = imagePixels(entries, numberObject);
      if (pixels === null) {
        scan.unknownSizeImages += 1;
        continue;
      }
      scan.maxImagePixels = Math.max(scan.maxImagePixels, pixels);
      const budget = isBilevel(entries)
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

    const filters = filtersOf(entries);
    let flateStages = 0;
    while (flateStages < filters.length && FLATE.has(filters[flateStages]!)) {
      flateStages += 1;
    }
    const decodable = flateStages === filters.length;
    const objectStream = namesOf(entries, "Type").includes("ObjStm");
    if (objectStream && !decodable) opaqueObjectStreams += 1;
    const ops = isContentLike(entries) && decodable ? new ContentOps() : null;
    const data = bytes.subarray(start, end);
    refs.reset();
    const sink: ((chunk: Uint8Array) => void) | null = ops
      ? (c) => ops.feed(c)
      : objectStream && decodable
        ? (c) => refs.feed(c)
        : null;
    let decoded: number;
    if (flateStages > 0) {
      const limit = Math.min(
        MAX_DECODED_STREAM_BYTES,
        MAX_DECODED_TOTAL_BYTES - scan.totalBytes,
      );
      decoded = await inflateCounting(data, flateStages, limit, sink);
      scan.inflated += 1;
    } else {
      decoded = data.length;
      if (filters.length === 0) sink?.(data);
    }
    scan.maxStreamBytes = Math.max(scan.maxStreamBytes, decoded);
    scan.totalBytes += decoded;
    if (ops) {
      ops.end();
      scan.maxQDepth = Math.max(scan.maxQDepth, ops.max);
      if (ops.pushes > 0 || ops.dos > 0) {
        records.push({
          num: streamObjectNumber(bytes, dictStart),
          form: namesOf(entries, "Subtype").includes("Form"),
          max: ops.max,
          left: ops.depth,
          pushes: ops.pushes,
          work: ops.work,
          dos: ops.dos,
        });
      }
    }
    if (decoded > MAX_DECODED_STREAM_BYTES) scan.exceeded = "stream-bytes";
    else if (scan.totalBytes > MAX_DECODED_TOTAL_BYTES)
      scan.exceeded = "total-bytes";
    if (scan.exceeded) break;
  }
  if (scan.exceeded) return scan;

  // References in the file's object text: everything outside stream data.
  refs.reset();
  let from = 0;
  for (let k = 0; k < dataRanges.length; k += 2) {
    if (dataRanges[k]! > from) refs.countIn(bytes, from, dataRanges[k]!);
    from = Math.max(from, dataRanges[k + 1]!);
  }
  refs.countIn(bytes, from, bytes.length);
  judgeGraphicsState(scan, records, refs.counts, opaqueObjectStreams);
  return scan;
}

/**
 * The page-level `q` bounds, from every content stream's counts and how
 * often the file names it. See {@link MAX_GRAPHICS_STATE_DEPTH} and
 * {@link MAX_GRAPHICS_STATE_WORK} for the model; each step is an upper
 * bound, never an estimate.
 */
function judgeGraphicsState(
  scan: PdfStreamScan,
  records: ContentRecord[],
  counts: Map<number, number>,
  opaqueObjectStreams: number,
): void {
  let mostNamed = 1;
  for (const c of counts.values()) mostNamed = Math.max(mostNamed, c);
  // How many times pdf.js can read a stream as page content: once per time
  // the file names it (a /Contents array may list it again and again). A
  // stream with no header could be any object: the most-named one.
  const times = (r: ContentRecord) =>
    r.num === null ? mostNamed : Math.max(1, counts.get(r.num) ?? 0);
  let unclosed = 0;
  let excess = 0;
  let doCalls = 0;
  let chainOfCallers = 0;
  let deepestForm = 0;
  let paths = 1;
  for (const r of records) {
    const t = times(r);
    unclosed += r.left * t;
    doCalls += r.dos * t;
    if (r.form) {
      // pdf.js paints a form on a clone of its caller's state, so a form's
      // depth adds to its caller's. Every form between the page and the
      // innermost one calls `Do`, and each appears once in a chain (pdf.js
      // refuses a circular one).
      deepestForm = Math.max(deepestForm, r.max);
      if (r.dos > 0) {
        chainOfCallers += r.max;
        paths *= 1 + r.dos;
      }
    } else {
      excess = Math.max(excess, r.max - r.left);
    }
  }
  scan.unclosedQ = unclosed;
  scan.maxQReach = unclosed + excess + chainOfCallers + deepestForm;
  if (scan.maxQReach > MAX_GRAPHICS_STATE_DEPTH) {
    scan.exceeded = "q-depth";
    return;
  }
  if (scan.maxQReach <= GRAPHICS_STATE_WORK_FLOOR) return;
  const reach = scan.maxQReach;
  // A stream's `q` run at most (reach - its own deepest) above the depths it
  // counted itself, whatever calls it.
  const once = (r: ContentRecord) => r.work + r.pushes * (reach - r.max);
  let work = 0;
  let deepestFormWork = 0;
  for (const r of records) {
    work += once(r) * times(r);
    if (r.form) deepestFormWork = Math.max(deepestFormWork, once(r));
  }
  // Form paints: every `Do` read as page content starts a chain, and each
  // calling form in a chain picks one of its `Do` or stops there.
  const paints = doCalls * paths;
  if (deepestFormWork > 0 && paints > 0) work += paints * deepestFormWork;
  // An object stream the scan cannot decode may name a stream any number of
  // times: past the floor, nothing then bounds the work.
  scan.qWork = opaqueObjectStreams > 0 ? Infinity : work;
  if (scan.qWork > MAX_GRAPHICS_STATE_WORK) scan.exceeded = "q-work";
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
 * bounds above, or whose content nests past {@link MAX_GRAPHICS_STATE_DEPTH}
 * or works past {@link MAX_GRAPHICS_STATE_WORK}.
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
  if (scan.exceeded === "q-depth" || scan.exceeded === "q-work") {
    throw new PdfEngineError(PDF_NESTED_TOO_DEEPLY_MESSAGE);
  }
  if (scan.exceeded) throw new PdfEngineError(PDF_EXPANDS_TOO_FAR_MESSAGE);
  // An image whose size the scan cannot read is held to the colour budget:
  // pdf.js skips anything past it in a preview, and an output refuses.
  const unknown =
    scan.unknownSizeImages > 0 ? RASTER_MAX_IMAGE_PIXELS + 1 : null;
  const smallest = Math.min(
    scan.smallestOverBudgetImage ?? Infinity,
    unknown ?? Infinity,
  );
  if (smallest === Infinity) {
    return { previewOptions: {}, overBudgetImage: false };
  }
  return {
    previewOptions: { maxImageSize: smallest - 1 },
    overBudgetImage: true,
  };
}

/** The output paths' refusal of a file holding an over-budget image. */
export function refuseOverBudgetImages(preflight: PdfjsPreflight): void {
  if (preflight.overBudgetImage) {
    throw new PdfEngineError(PDF_IMAGE_TOO_LARGE_MESSAGE);
  }
}
