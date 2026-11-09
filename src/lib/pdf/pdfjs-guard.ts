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
  isWhite,
  namesOf,
  numericObjects,
  streamObjectNumber,
  valuesOf,
} from "./pdf-scan-bytes";
import {
  ContentsRefs,
  arrayObjectRefs,
  findObjectHeaders,
  nameObjects,
  parseObjectAt,
} from "./pdf-scan-objects";
import { MAX_DECODED_PIXELS } from "./pixel-ceiling";
import { prescanXref } from "./xref-prescan";

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
 * The most bytes one stream read as content may inflate to: 400,000,000.
 * "Read as content" is every stream except an image nothing's /Contents
 * names (see {@link scanPdfStreams}): fonts, metadata and attachments are
 * inflated and counted as they always were.
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
 * The most bytes all of a file's streams read as content may inflate to
 * together: 1,600,000,000. It bounds the PREFLIGHT's own time (each byte is inflated
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
 * DCT (JPEG) RGB 50 MP 12-18 s. Half the product's pixel ceiling keeps ONE
 * image inside ~20 s. 50 MP still takes a 600-dpi A4 scan (4,960 x 7,016 =
 * 34.8 MP) and a 300-dpi A2 (34.8 MP).
 *
 * It is a budget per IMAGE, not per page. OPEN (hostile review, 2026-11-09):
 * a page painting several distinct images within budget pays for each, and
 * nothing here sums them: ten 7,000 x 7,000 RGB images on one page drew in
 * 105.7 s in the editor (one: 24.9 s; four: 57.0 s). The byte scan cannot
 * tell which page paints which image (resources are inherited, shared and
 * may sit in object streams), and a sum over the whole file would refuse
 * every long scanned document.
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
  /** Streams read as content whose stages were decoded (counted). */
  inflated: number;
  /** Largest single decoded stream read as content, in bytes. */
  maxStreamBytes: number;
  /** All decoded streams read as content together, in bytes. */
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
  /** Largest image XObject, in pixels (Width x Height), painted or not. */
  maxImagePixels: number;
  /**
   * The fewest pixels (its own /Width x /Height, what pdf.js's
   * `maxImageSize` is compared with) of any image pdf.js may paint that is
   * over its raster budget ({@link RASTER_MAX_IMAGE_PIXELS}, or
   * {@link RASTER_MAX_BILEVEL_PIXELS} for a bilevel one); null when every
   * such image is within budget. See {@link judgeImages} for which images
   * pdf.js may paint and what each one costs.
   */
  smallestOverBudgetImage: number | null;
  /**
   * Images pdf.js may paint whose size the scan cannot read: a /Width or
   * /Height that refers to an object the scan cannot see (one held in an
   * object stream), or is not a number; or an inline image's dictionary the
   * scan could not finish. pdf.js resolves those; the scan treats the image
   * as over budget.
   */
  unknownSizeImages: number;
  /** The first bound the scan stopped at, or null. */
  exceeded:
    "stream-bytes" | "total-bytes" | "scan-work" | "q-depth" | "q-work" | null;
}

const latin1 = new TextDecoder("latin1");

/**
 * The command names pdf.js's content lexer knows: the keys of
 * `EvaluatorPreprocessor.opMap` in pdfjs-dist 6 (the prefixes of `true`,
 * `false` and `null` included, as pdf.js keeps them there). Its lexer uses
 * them to cut a run of regular characters into commands: a command it knows
 * ends as soon as the next character would make one it does not, so `qqqq`
 * is four `q` and `cmq` is `cm` then `q`. `pdfjs-guard-lexer.test.ts` reads
 * the table out of the shipped worker and holds this set equal to it.
 */
export const PDFJS_CONTENT_COMMANDS: ReadonlySet<string> = new Set([
  ...["w", "J", "j", "M", "d", "ri", "i", "gs", "q", "Q", "cm"],
  ...["m", "l", "c", "v", "y", "h", "re", "S", "s", "f", "F", "f*"],
  ...["B", "B*", "b", "b*", "n", "W", "W*", "BT", "ET", "Tc", "Tw"],
  ...["Tz", "TL", "Tf", "Tr", "Ts", "Td", "TD", "Tm", "T*", "Tj", "TJ"],
  ...["'", '"', "d0", "d1", "CS", "cs", "SC", "SCN", "sc", "scn", "G"],
  ...["g", "RG", "rg", "K", "k", "sh", "BI", "ID", "EI", "Do", "MP"],
  ...["DP", "BMC", "BDC", "EMC", "BX", "EX", "BM", "BD", "true", "fa"],
  ...["fal", "fals", "false", "nu", "nul", "null"],
]);

/** The longest name in {@link PDFJS_CONTENT_COMMANDS}. */
const LONGEST_COMMAND = 5;

/** pdf.js's `specialChars`: 1 whitespace, 2 a delimiter, 0 regular. */
const SPECIAL = new Uint8Array(256);
for (const c of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) SPECIAL[c] = 1;
for (const c of "%()/<>[]{}") SPECIAL[c.charCodeAt(0)] = 2;

// Lexer states, named for the token the next byte continues.
const BETWEEN = 0;
const NUMBER = 1;
const NAME = 2;
const COMMAND = 3;
/** After a byte outside 0x20-0x7f that starts a command (see `step`). */
const HIGH = 4;
const STRING = 5;
const HEX = 6;
const COMMENT = 7;
/** After `<`: a dictionary if the next byte is `<`, else a hex string. */
const AFTER_LT = 8;
/** Inside an inline image's data, after its `ID`. */
const IMAGE_DATA = 9;

/** Each byte as a one-character string, so the lexer allocates none. */
const CHAR = Array.from({ length: 256 }, (_, b) => String.fromCharCode(b));

const isNumberStart = (b: number) =>
  (b >= 0x30 && b <= 0x39) || b === 0x2b || b === 0x2d || b === 0x2e;

/** {@link ContentOps.emit}: an image's `ID` ended, its data follows. */
const DATA = 1;
/** {@link ContentOps.emit}: the exact reading's `BI` ended, a dictionary follows. */
const DICT = 2;

/**
 * The longest inline image dictionary read: 65,536 bytes. A real one is a
 * few dozen; one longer is an image of unknown size, held to the colour
 * budget (see `preflightPdfjsBytes`).
 */
const INLINE_DICT_BYTES = 65_536;
/** Characters of a name the loose reading keeps: `/Height` with escapes. */
const NAME_CHARS = 24;
/** Characters of a number the loose reading keeps; longer is "the largest". */
const NUMBER_CHARS = 32;

/**
 * Which inline image side a name is, as pdf.js reads names (`#xx` escapes
 * decoded): 1 for /W or /Width, 2 for /H or /Height, else 0. A name longer
 * than the loose reading keeps is none of them.
 */
function sideKey(raw: string): number {
  if (raw.length > NAME_CHARS) return 0;
  const name = raw.includes("#")
    ? raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) =>
        String.fromCharCode(parseInt(h, 16)),
      )
    : raw;
  return name === "W" || name === "Width"
    ? 1
    : name === "H" || name === "Height"
      ? 2
      : 0;
}

/**
 * The inline images one content stream paints, as {@link ContentOps} read
 * them. The exact reading sizes an image from its own dictionary, read as
 * pdf.js reads it (`sized`; at most the stream's first, since the reading
 * turns loose after the first `EI`). Past that point, and in a loose
 * re-reading, where an image's dictionary begins and ends is not known, so
 * every `BI` is counted (`loose`) and bounded by the largest /W (or /Width)
 * times the largest /H (or /Height) the loose reading saw anywhere in the
 * stream: it reads every token pdf.js may (strings, comments and data
 * included), so no value pdf.js sizes an image by is missed. Within the
 * colour budget, every loose image is; past it, they are images of unknown
 * size (see `judgeImages`).
 */
export interface InlineImages {
  sized: { pixels: number; bilevel: boolean }[];
  /** Dictionaries the exact reading could not finish (cut short, or open at the end). */
  unknown: number;
  loose: number;
  looseW: number;
  looseH: number;
}

/**
 * A streaming operator counter for one content stream, fed chunk by chunk:
 * the running nesting of `q` and `Q`, the deepest it reached, how many `q`
 * it executed and the sum of the depths they reached (its work), and how many
 * `Do` it executed. A `Q` with nothing open is ignored, as pdf.js ignores it.
 *
 * It reads the stream with pdf.js's own lexer rules (`Lexer.getObj` in
 * pdfjs-dist 6): numbers, names and commands, with commands cut at
 * {@link PDFJS_CONTENT_COMMANDS}, so a `q` glued to a number or a command is
 * counted (the counter before this one required whitespace on both sides of
 * a `q`, and missed `qqqq`, which pdf.js executes four times). Literal strings
 * (nested parentheses, backslash escapes), hex strings, comments and inline
 * image data are skipped, as pdf.js skips them, so a document whose sentences
 * say "q" is not refused for them (lane res1, item 4).
 *
 * The property it keeps is an UPPER bound: it may count more `q` than pdf.js
 * executes, never fewer. Two readings cannot be made exact, and each turns
 * the counter to a "loose" reading that skips nothing:
 *
 *  - pdf.js ends an inline image's data at the first `EI` that its own checks
 *    accept, which may not be the first `EI` in the data. Skipping from `ID`
 *    to the FIRST `EI` is safe (pdf.js's end is never earlier), but from
 *    there on a `(` may be data to pdf.js and a string to us, and a string
 *    that ran past pdf.js's real end would hide the `q` after it. So the
 *    rest of that stream is read loose.
 *  - pdf.js reads a page's /Contents ARRAY as one stream, joined with no
 *    separator, so a stream that ends inside a string, a comment, an image or
 *    a `<` hands its state to the next one. Each stream is read here on its
 *    own, so {@link cleanEnd} says whether it ended where pdf.js would start
 *    the next stream fresh; the scan reads every stream a /Contents array may
 *    list loose when any of them does not (`judgeGraphicsState`).
 *
 * The loose reading (`new ContentOps(false)`) is the same lexer with every
 * delimiter a token of its own: no string, comment, hex string or image is
 * skipped. pdf.js only leaves those at a delimiter, a whitespace byte, or
 * (an image) right after `EI` and one more byte, which the loose reading
 * treats as the end of a token too; so wherever pdf.js starts a token, so
 * does the loose reading, and every `q` pdf.js executes is counted.
 */
export class ContentOps {
  depth = 0;
  max = 0;
  pushes = 0;
  work = 0;
  dos = 0;
  /**
   * Set by {@link end}: the stream ended where pdf.js would read the next
   * stream of a /Contents array as a fresh start (not inside a string, a
   * comment, a hex string or an image, not after `<`, nor on a `B` or `I`
   * that the next stream could make `BI` or `ID`), and was read exactly.
   */
  cleanEnd = true;
  private state = BETWEEN;
  private command = "";
  private strDepth = 0;
  private escaped = false;
  private inlineDict = false;
  private sawE = false;
  /** Bytes until a forced token end (the loose reading's `EI` rule). */
  private force = 0;
  /**
   * Inline images (`BI` ... `ID`), as pdf.js would size them: see
   * {@link InlineImages}. Their dictionaries name no object, so the byte
   * scan's image budget never saw them (hostile review, 2026-11-09: a
   * 10,000 x 10,000 inline image drew in 32.6 s in the editor, unflagged).
   */
  readonly inline: InlineImages = {
    sized: [],
    unknown: 0,
    loose: 0,
    looseW: 0,
    looseH: 0,
  };
  /** The exact reading's bytes since `BI`, while its dictionary is open. */
  private dict: number[] | null = null;
  /** The loose reading's current name, number, and the key a number is for. */
  private name = "";
  private num = "";
  private key = 0;

  constructor(private exact = true) {}

  feed(chunk: Uint8Array): void {
    // One loop over locals: this runs on every decoded byte of every stream
    // that may be content (up to MAX_DECODED_TOTAL_BYTES), so the state is
    // read into locals and written back once per chunk.
    let { state, command, strDepth, escaped, sawE, force, exact } = this;
    let { dict, name, num, key } = this;
    for (let i = 0; i < chunk.length; i += 1) {
      const b = chunk[i]!;
      // An inline image's dictionary, kept whole (and bounded) to be read
      // at its `ID` as pdf.js reads it.
      if (dict !== null && dict.length < INLINE_DICT_BYTES) dict.push(b);
      // The common bytes, without the state machine: whitespace between
      // tokens, and the inside of a string.
      if (exact) {
        if (state === BETWEEN) {
          if (SPECIAL[b] === 1) continue;
        } else if (state === STRING) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (b !== 0x28 && b !== 0x29 && b !== 0x5c) continue;
        }
      }
      // `continue lex` reads `b` again in the state just entered.
      lex: for (;;) {
        switch (state) {
          case BETWEEN: {
            const special = SPECIAL[b]!;
            if (special === 1) break lex;
            if (special === 2) {
              if (b === 0x2f) {
                state = NAME;
                name = "";
              } else if (exact) {
                if (b === 0x28) {
                  state = STRING;
                  strDepth = 1;
                  escaped = false;
                } else if (b === 0x25) state = COMMENT;
                else if (b === 0x3c) state = AFTER_LT;
              }
            } else if (isNumberStart(b)) {
              state = NUMBER;
              if (!exact) num = CHAR[b]!;
            } else if (b < 0x20 || b > 0x7f) state = HIGH;
            else {
              state = COMMAND;
              command = CHAR[b]!;
            }
            break lex;
          }
          case NUMBER:
            // pdf.js's getNumber: digits, one `.`, and a stray `-` it warns of.
            if ((b >= 0x30 && b <= 0x39) || b === 0x2e || b === 0x2d) {
              if (!exact && num.length <= NUMBER_CHARS) num += CHAR[b]!;
              break lex;
            }
            if (!exact && key !== 0) {
              this.looseSide(key, num);
              key = 0;
            }
            state = BETWEEN;
            continue lex;
          case NAME:
            if (SPECIAL[b] === 0) {
              if (!exact && name.length <= NAME_CHARS) name += CHAR[b]!;
              break lex;
            }
            if (!exact) key = sideKey(name);
            state = BETWEEN;
            continue lex;
          case HIGH:
            // pdf.js: a byte outside 0x20-0x7f followed by a printable one is
            // a command of its own; otherwise it starts a command that runs on.
            if (b >= 0x20 && b <= 0x7f) state = BETWEEN;
            else {
              state = COMMAND;
              command = "\u0080"; // a command no table knows
            }
            continue lex;
          case COMMAND: {
            let ends = SPECIAL[b] !== 0;
            if (!ends && command.length <= LONGEST_COMMAND) {
              const longer = command + CHAR[b]!;
              ends =
                PDFJS_CONTENT_COMMANDS.has(command) &&
                !PDFJS_CONTENT_COMMANDS.has(longer);
              if (!ends) command = longer;
            }
            if (!ends) break lex;
            const ended = command;
            command = "";
            state = BETWEEN;
            const emitted = this.emit(ended);
            if (emitted === DATA) {
              // pdf.js's data starts after the byte that ended `ID`.
              dict = null;
              state = IMAGE_DATA;
              sawE = false;
              break lex;
            }
            // A dictionary starts at the byte that ended `BI` (`BI/W` is
            // `BI`, then `/W`): it is read again below, so keep it.
            if (emitted === DICT) dict = this.dict = [b];
            continue lex;
          }
          case STRING:
            if (escaped) escaped = false;
            else if (b === 0x5c) escaped = true;
            else if (b === 0x28) strDepth += 1;
            else if (b === 0x29 && --strDepth === 0) state = BETWEEN;
            break lex;
          case HEX:
            if (b === 0x3e) state = BETWEEN;
            break lex;
          case COMMENT:
            if (b === 0x0a || b === 0x0d) state = BETWEEN;
            break lex;
          case AFTER_LT:
            if (b === 0x3c) {
              state = BETWEEN;
              break lex;
            }
            state = HEX;
            continue lex;
          default: // IMAGE_DATA
            if (sawE && b === 0x49) {
              // The earliest end pdf.js can choose: read the rest loose, and
              // end a token after the next byte (below).
              exact = false;
              this.exact = false;
              state = BETWEEN;
              sawE = false;
              force = 2;
            } else sawE = b === 0x45;
            break lex;
        }
      }
      if (!exact) {
        // pdf.js may resume right after `EI` and ONE more byte (an image it
        // ended by its marker: it skips to `EI`, then reads one byte more).
        if (force > 0 && --force === 0) {
          if (state === COMMAND) this.emit(command);
          state = BETWEEN;
          command = "";
        }
        if (sawE && b === 0x49) force = 1;
        sawE = b === 0x45;
      }
    }
    Object.assign(this, { state, command, strDepth, escaped, sawE, force });
    Object.assign(this, { dict, name, num, key });
  }

  end(): void {
    const { state, command } = this;
    if (!this.exact && state === NUMBER && this.key !== 0) {
      this.looseSide(this.key, this.num);
    }
    const dataStarts = state === COMMAND && this.emit(command) === DATA;
    // A dictionary still open at the end may be closed by the next stream
    // of a /Contents array: its size is not known here.
    if (this.inlineDict) this.inline.unknown += 1;
    this.dict = null;
    this.key = 0;
    this.cleanEnd =
      this.exact &&
      !this.inlineDict &&
      !dataStarts &&
      (state === BETWEEN ||
        state === NUMBER ||
        state === NAME ||
        state === HIGH ||
        (state === COMMAND && command !== "B" && command !== "I"));
    this.state = BETWEEN;
    this.command = "";
  }

  /**
   * A command ended. {@link DATA} when it was an image's `ID` (data follows),
   * {@link DICT} when it was the exact reading's `BI` (a dictionary follows).
   */
  private emit(command: string): number {
    if (command === "q") {
      this.depth += 1;
      this.pushes += 1;
      this.work += this.depth;
      if (this.depth > this.max) this.max = this.depth;
    } else if (command === "Q") {
      if (this.depth > 0) this.depth -= 1;
    } else if (command === "Do") {
      this.dos += 1;
    } else if (this.exact) {
      if (command === "BI") {
        this.inlineDict = true;
        return DICT;
      } else if (command === "ID" && this.inlineDict) {
        this.inlineDict = false;
        this.sizeInline(this.dict ?? []);
        this.dict = null;
        return DATA;
      }
    } else if (command === "BI") {
      this.inline.loose += 1;
    }
    return 0;
  }

  /**
   * The exact reading's inline image, from its dictionary's bytes (`BI` to
   * the byte after `ID`): pdf.js reads /W (or /Width) and /H (or /Height)
   * and paints nothing unless both are numbers, so a dictionary without them
   * is no image. One past {@link INLINE_DICT_BYTES} was cut short here, and
   * its size is unknown.
   */
  private sizeInline(bytes: number[]): void {
    if (bytes.length >= INLINE_DICT_BYTES) {
      this.inline.unknown += 1;
      return;
    }
    const text = latin1.decode(new Uint8Array(bytes));
    const entries = dictEntries(
      text.slice(0, Math.max(0, text.lastIndexOf("ID"))),
    );
    const side = (...keys: string[]) =>
      Math.max(
        0,
        ...valuesOf(entries, ...keys).map((v) =>
          v.kind === "number" ? Math.ceil(Math.abs(v.value)) : 0,
        ),
      );
    const pixels = side("W", "Width") * side("H", "Height");
    if (pixels > 0) {
      this.inline.sized.push({ pixels, bilevel: isBilevel(entries) });
    }
  }

  /**
   * The loose reading's /W or /H value: the largest of each, anywhere in the
   * stream (see {@link InlineImages}). A number too long to keep is taken as
   * the largest there is.
   */
  private looseSide(key: number, num: string): void {
    const n =
      num.length > NUMBER_CHARS
        ? Number.MAX_SAFE_INTEGER
        : Math.ceil(Math.abs(parseFloat(num)));
    if (!Number.isFinite(n)) return;
    const v = Math.min(n, Number.MAX_SAFE_INTEGER);
    if (key === 1) this.inline.looseW = Math.max(this.inline.looseW, v);
    else this.inline.looseH = Math.max(this.inline.looseH, v);
  }
}

/** One reading's operator counts for a content stream. */
interface OpCounts {
  max: number;
  left: number;
  pushes: number;
  work: number;
  dos: number;
  inline: InlineImages;
}

/** What one content stream contributes to the page-level `q` bounds. */
interface ContentRecord extends OpCounts {
  /** Its object number, or null when no `num gen obj` header was found. */
  num: number | null;
  /** /Subtype /Form: painted by `Do` (or, if mislabelled, as page content). */
  form: boolean;
}

/** A content stream as read, both ways (see {@link ContentOps}). */
interface ReadRecord {
  num: number | null;
  form: boolean;
  /** Read with strings, comments and images skipped. */
  exact: OpCounts;
  /**
   * Read with nothing skipped: what it counts if its context is unknown.
   * Decodes the stream again, so it is asked only when needed.
   */
  loose: () => Promise<OpCounts>;
  /** {@link ContentOps.cleanEnd} of the exact reading. */
  cleanEnd: boolean;
}

const countsOf = (ops: ContentOps): OpCounts => ({
  max: ops.max,
  left: ops.depth,
  pushes: ops.pushes,
  work: ops.work,
  dos: ops.dos,
  inline: ops.inline,
});

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

/**
 * What a filter is to the scan. pdf.js's `Parser.makeFilter` decodes
 * Flate, ASCIIHex and ASCII85 (and their abbreviations), which the scan
 * decodes too; it passes a stream through UNCHANGED for /Crypt without a key
 * and for any name it does not know ("identity"); the rest it decodes with
 * code the scan does not have ("opaque").
 */
type Stage = "flate" | "ahx" | "a85" | "identity" | "opaque";

const FLATE = new Set(["FlateDecode", "Fl"]);
const AHX = new Set(["ASCIIHexDecode", "AHx"]);
const A85 = new Set(["ASCII85Decode", "A85"]);
const OPAQUE = new Set([
  ...["LZWDecode", "LZW", "DCTDecode", "DCT", "JPXDecode", "JPX"],
  ...["CCITTFaxDecode", "CCF", "RunLengthDecode", "RL", "JBIG2Decode"],
  "BrotliDecode",
  "?", // an indirect filter list, which the scan does not resolve
]);

function stageOf(name: string): Stage {
  if (FLATE.has(name)) return "flate";
  if (AHX.has(name)) return "ahx";
  if (A85.has(name)) return "a85";
  return OPAQUE.has(name) ? "opaque" : "identity";
}

/** pdf.js's AsciiHexStream, streaming: two digits a byte, `>` ends it. */
function asciiHexDecoder(): TransformStream<Uint8Array, Uint8Array> {
  let first = -1;
  let done = false;
  return new TransformStream({
    transform(chunk, controller) {
      if (done) return;
      const out = new Uint8Array((chunk.length >> 1) + 2);
      let n = 0;
      for (const ch of chunk) {
        let digit: number;
        if (ch >= 0x30 && ch <= 0x39) digit = ch & 0x0f;
        else if ((ch >= 0x41 && ch <= 0x46) || (ch >= 0x61 && ch <= 0x66))
          digit = (ch & 0x0f) + 9;
        else if (ch === 0x3e) {
          done = true;
          break;
        } else continue;
        if (first < 0) first = digit;
        else {
          out[n++] = (first << 4) | digit;
          first = -1;
        }
      }
      if (done && first >= 0) out[n++] = first << 4;
      if (n > 0) controller.enqueue(out.subarray(0, n));
    },
  });
}

/**
 * pdf.js's Ascii85Stream, streaming: five characters make four bytes, `z`
 * at a group's start is four zeros, `~` ends it, and a short last group of
 * k characters makes k - 1 bytes. The arithmetic is pdf.js's, overflow and
 * all, so the bytes are the ones pdf.js reads.
 */
function ascii85Decoder(): TransformStream<Uint8Array, Uint8Array> {
  const group = new Uint8Array(5);
  let size = 0;
  let done = false;
  const emit = (out: Uint8Array, at: number): number => {
    group.fill(0x21 + 84, size, 5);
    let t = 0;
    for (let i = 0; i < 5; i += 1) t = t * 85 + (group[i]! - 0x21);
    const bytes = new Uint8Array(4);
    for (let i = 3; i >= 0; i -= 1) {
      bytes[i] = t & 0xff;
      t >>= 8;
    }
    out.set(bytes.subarray(0, size - 1), at);
    const wrote = size - 1;
    size = 0;
    return at + wrote;
  };
  return new TransformStream({
    transform(chunk, controller) {
      if (done) return;
      // A `z` makes four bytes of one: at most 4 per byte in.
      const out = new Uint8Array(chunk.length * 4 + 4);
      let n = 0;
      for (const ch of chunk) {
        if (ch === 0x20 || ch === 0x09 || ch === 0x0d || ch === 0x0a) continue;
        if (ch === 0x7e) {
          done = true;
          break;
        }
        if (ch === 0x7a && size === 0) {
          n += 4; // already zero
          continue;
        }
        group[size++] = ch;
        if (size === 5) n = emit(out, n);
      }
      if (done && size > 0) n = emit(out, n);
      if (n > 0) controller.enqueue(out.subarray(0, n));
    },
    flush(controller) {
      if (done || size === 0) return;
      const out = new Uint8Array(4);
      const n = emit(out, 0);
      if (n > 0) controller.enqueue(out.subarray(0, n));
    },
  });
}

/**
 * Decode `data` through `stages` (Flate, ASCIIHex, ASCII85; identity stages
 * already dropped), counting the output and feeding it to `onChunk`, and stop
 * once it passes `limit` bytes. Nothing is kept. Returns the bytes produced
 * (limit + something when it stopped early). A stream that is not valid zlib
 * (encrypted, damaged) stops where it breaks, as pdf.js would.
 */
async function decodeCounting(
  data: Uint8Array,
  stages: readonly Stage[],
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
  for (const stage of stages) {
    const step =
      stage === "ahx"
        ? asciiHexDecoder()
        : stage === "a85"
          ? ascii85Decoder()
          : (new DecompressionStream("deflate") as unknown as TransformStream<
              Uint8Array,
              Uint8Array
            >);
    stream = stream.pipeThrough(step);
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

/**
 * An image pdf.js paints through its cheap 1-bit path: an /ImageMask, or 1
 * bit per sample in ONE gray component named in the dictionary itself
 * (pdf.js takes GRAYSCALE_1BPP only when `colorSpace.name === "DeviceGray"`).
 * Read from the dictionary's TOP level, and every value of a key must agree;
 * pdf.js reads the abbreviated key first, so `/IM`, `/BPC` and `/CS` count
 * too. An Indexed, ICC, CalGray or colour 1-bit image is expanded to RGBA
 * like any other, so it is not bilevel here; nor is a colour space by
 * reference. Nor is a gray image with a /Mask or an /SMask: pdf.js takes the
 * 1-bit path only when `!this.smask && !this.mask`, and expands it to RGBA
 * otherwise (hostile review, 2026-11-09: a 380 MP 1-bit image with a
 * colour-key /Mask took the RGBA path, 6.9 s and ~4.7 GB, on a 400 MP
 * budget).
 */
function isBilevel(entries: Map<string, DictValue[]>): boolean {
  const masks = valuesOf(entries, "IM", "ImageMask");
  if (
    masks.length > 0 &&
    masks.every((v) => v.kind === "word" && v.word === "true")
  ) {
    return true;
  }
  if (entries.has("Mask") || entries.has("SMask")) return false;
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
 * A stream's /Subtype values as pdf.js would see them: a name, a reference
 * resolved to the name object it points at, or "?" when the scan cannot say
 * (a reference it cannot resolve, anything else).
 */
function subtypesOf(
  entries: Map<string, DictValue[]>,
  nameObject: (num: number) => string | undefined,
): string[] {
  return valuesOf(entries, "Subtype").map((v) =>
    v.kind === "name"
      ? v.name
      : v.kind === "ref"
        ? (nameObject(v.num) ?? "?")
        : "?",
  );
}

/** A stream the scan has found: its dictionary and its data. */
interface FoundStream {
  entries: Map<string, DictValue[]>;
  start: number;
  end: number;
  /** Its object number, or null when no header was read. */
  num: number | null;
  /** May pdf.js paint it as a Form XObject (its /Subtype says so, or might). */
  form: boolean;
  /**
   * Its labels say it is not content (a font program, metadata, an xref or
   * object stream, an attachment) and nothing but a page's /Contents could
   * read it as content: its `q` count is kept aside until the scan knows
   * what /Contents names. Font programs are binary and hold `q` bytes (the
   * legit corpus: up to 14 unclosed per file), which must not add up across
   * a document's fonts.
   */
  labelledNotContent: boolean;
}

/**
 * The labels that say a stream is not content, as the first fix read them:
 * /Length1-3 (font programs), /Type /XRef, /ObjStm, /Metadata, /EmbeddedFile,
 * or a /Subtype that is neither /Form nor /Image (/Type1C, /XML, /PS). pdf.js
 * reads none of them; they only decide which streams' `q` the scan holds
 * back (see {@link FoundStream.labelledNotContent}).
 */
function labelledNotContent(
  entries: Map<string, DictValue[]>,
  subtypes: readonly string[],
): boolean {
  if (["Length1", "Length2", "Length3"].some((k) => entries.has(k))) {
    return true;
  }
  const notContent = ["XRef", "ObjStm", "Metadata", "EmbeddedFile"];
  if (namesOf(entries, "Type").some((t) => notContent.includes(t))) {
    return true;
  }
  return entries.has("First") || subtypes.some((t) => t !== "Form");
}

/**
 * One pass over every stream in `bytes`, bounded and LINEAR in the file's
 * size (work past that is charged to a budget and refused): every stream
 * pdf.js may read as content has its leading Flate, ASCIIHex and ASCII85
 * stages decoded (counted, never kept) and its `q` and `Do` operators
 * counted; every stream pdf.js may decode as an image has its size read from
 * its dictionary's top level; every `num gen R` outside stream data and
 * inside decoded object streams is counted. Stops at the first byte bound
 * passed; the `q` bounds are judged once every reference has been counted.
 *
 * Before lane res1 only LEADING Flate stages were inflated, so an ASCIIHex
 * stage in front of a Flate bomb hid it. A stage pdf.js does not know is
 * no stage to pdf.js, and is none here. What the scan still cannot decode
 * (LZW, RunLength, Brotli, the image codecs) is counted at its stored size
 * when it is the last stage; a Flate stage AFTER one of them is refused,
 * since its output cannot be seen and pdf.js inflates it.
 *
 * What may be content is decided WITHOUT trusting labels (third review):
 * pdf.js reads a page's /Contents, a pattern, a glyph procedure or an
 * appearance whatever the stream's /Type, /Length1 or /Subtype say, so every
 * stream is q-counted except one whose /Subtype is only ever /Image. Such an
 * image is counted as content too when anything's /Contents names it (or
 * when the scan cannot see everything /Contents names). Images are not
 * inflated otherwise, so a real file's images cost the scan nothing.
 *
 * Where a stream starts is read as pdf.js reads it: from each object's
 * `num gen obj` header, through a parser that skips strings and comments
 * ({@link parseObjectAt}); a `stream` keyword no header reaches (a damaged
 * file, a header the parser does not know) falls back to the byte-wise
 * {@link DictMatcher}. Every reading of a stream is scanned, so a disagreement
 * can only add work, never hide a stream.
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
  const refs = new RefCounter();
  const contents = new ContentsRefs();
  const records: ReadRecord[] = [];
  /** Stream data, [start, end) pairs: not object text. */
  const dataRanges: [number, number][] = [];
  /** Object numbers of every stream found. */
  const streamNums = new Set<number>();
  /** Streams whose /Subtype is only /Image: content only if /Contents names them. */
  const imagesOnly: FoundStream[] = [];
  /** Streams pdf.js may decode as an image (see {@link judgeImages}). */
  const images: StreamImage[] = [];
  /** Each numbered stream's pixels; null when a size cannot be read. */
  const streamPixels = new Map<number, number | null>();
  let unnumberedStreams = 0;
  let opaqueObjectStreams = 0;
  const headers = findObjectHeaders(bytes);
  let numeric: Map<number, number> | null = null;
  const numberObject = (num: number) =>
    (numeric ??= numericObjects(bytes)).get(num);
  let names: Map<number, string> | null = null;
  const nameObject = (num: number) =>
    (names ??= nameObjects(bytes, headers)).get(num);
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
  // Dictionary text read, in bytes. Real objects are disjoint, so this stays
  // under the file's size; only overlapping `<<` soups pass it.
  let dictBytes = 0;
  const dictBudget = 2 * bytes.length + DICT_SEARCH_WINDOW;

  // Every object the file declares, parsed as pdf.js parses it: the `stream`
  // keyword each dictionary really ends at, with every header that reaches it.
  const parsed = new Map<
    number,
    { dictStart: number; dictEnd: number; num: number | null }[]
  >();
  for (const h of headers) {
    const o = parseObjectAt(bytes, h.objAt, dictBudget - dictBytes);
    dictBytes += o.cost;
    if (dictBytes > dictBudget) {
      scan.exceeded = "scan-work";
      return scan;
    }
    if (o.streamKw === -1) continue;
    const list = parsed.get(o.streamKw) ?? [];
    list.push({
      dictStart: o.dictStart,
      dictEnd: o.dictEnd,
      num: Number.isInteger(h.num) ? h.num : null,
    });
    parsed.set(o.streamKw, list);
  }

  /** q counts of streams labelled as not content, until /Contents is known. */
  const heldBack: ReadRecord[] = [];
  const keep = (r: ReadRecord, labelled: boolean) => {
    if (labelled) heldBack.push(r);
    else records.push(r);
  };
  /**
   * Decode `s` through `decoding` (or hand its stored bytes on, when nothing
   * needs decoding and pdf.js reads them as they are), feeding `sink`; the
   * bytes produced, up to `limit` and something.
   */
  const decodeInto = async (
    s: FoundStream,
    decoding: readonly Stage[],
    decodable: boolean,
    limit: number,
    sink: (chunk: Uint8Array) => void,
  ): Promise<number> => {
    const data = bytes.subarray(s.start, s.end);
    if (decoding.length > 0) {
      return decodeCounting(data, decoding, limit, sink);
    }
    if (decodable) sink(data);
    return data.length;
  };
  /** Decode and q-count one stream that pdf.js may read as content. */
  const readAsContent = async (
    s: FoundStream,
    labelled = s.labelledNotContent,
  ): Promise<void> => {
    const { entries } = s;
    const stages = filtersOf(entries).map(stageOf);
    let known = 0;
    while (known < stages.length && stages[known] !== "opaque") known += 1;
    const decodable = known === stages.length;
    // pdf.js inflates a Flate stage that follows one the scan cannot decode
    // (LZW, RunLength, ...), and nothing here can see how far: refuse.
    const hiddenFlate = stages.slice(known).includes("flate");
    // pdf.js reads an object stream by its /First and /N, not its /Type.
    const objectStream =
      namesOf(entries, "Type").includes("ObjStm") || entries.has("First");
    if (objectStream && !decodable) opaqueObjectStreams += 1;
    const ops = decodable ? new ContentOps() : null;
    const objects = objectStream && decodable;
    refs.reset();
    contents.reset();
    const sink = (c: Uint8Array) => {
      ops?.feed(c);
      if (objects) {
        refs.feed(c);
        contents.feed(c);
      }
    };
    const decoding = stages
      .slice(0, known)
      .filter((stage) => stage !== "identity");
    const decoded = await decodeInto(
      s,
      decoding,
      decodable,
      Math.min(
        MAX_DECODED_STREAM_BYTES,
        MAX_DECODED_TOTAL_BYTES - scan.totalBytes,
      ),
      sink,
    );
    if (decoding.length > 0) scan.inflated += 1;
    scan.maxStreamBytes = Math.max(scan.maxStreamBytes, decoded);
    scan.totalBytes += decoded;
    if (ops) {
      ops.end();
      keep(
        {
          num: s.num,
          form: s.form,
          exact: countsOf(ops),
          cleanEnd: ops.cleanEnd,
          // Read again, loose, only if the judgement needs it.
          loose: async () => {
            const again = new ContentOps(false);
            await decodeInto(s, decoding, true, decoded, (c) => again.feed(c));
            again.end();
            return countsOf(again);
          },
        },
        labelled,
      );
    }
    if (hiddenFlate || decoded > MAX_DECODED_STREAM_BYTES)
      scan.exceeded = "stream-bytes";
    else if (scan.totalBytes > MAX_DECODED_TOTAL_BYTES)
      scan.exceeded = "total-bytes";
  };

  /** Read one stream whose dictionary is [dictStart, dictEnd); its data end. */
  const found = async (
    dictStart: number,
    dictEnd: number,
    kw: number,
    num: number | null,
  ): Promise<number> => {
    const entries = dictEntries(
      latin1.decode(bytes.subarray(dictStart, dictEnd)),
    );
    scan.streams += 1;
    if (num !== null) streamNums.add(num);
    let start = kw + STREAM.length;
    if (bytes[start] === 0x0d) start += 1;
    if (bytes[start] === 0x0a) start += 1;
    const length = lengthOf(entries);
    let end =
      length !== null && start + length <= bytes.length ? start + length : -1;
    if (end === -1 || endstreamFrom(end) - end > 4) {
      end = endstreamFrom(start);
      if (end === -1) end = bytes.length;
    }
    dataRanges.push([start, end]);

    const subtypes = subtypesOf(entries, nameObject);
    const objectStream =
      namesOf(entries, "Type").includes("ObjStm") || entries.has("First");
    const maybeImage = subtypes.some((t) => t === "Image" || t === "?");
    const maybeOther =
      subtypes.length === 0 || subtypes.some((t) => t !== "Image");
    const form = subtypes.some((t) => t === "Form" || t === "?");
    const stream: FoundStream = {
      entries,
      start,
      end,
      num,
      form,
      // A form may be painted by `Do`, a tiling pattern as a fill: pdf.js
      // reads both as content whatever else the dictionary says.
      labelledNotContent:
        !form &&
        !entries.has("PatternType") &&
        labelledNotContent(entries, subtypes),
    };
    // Every stream's size, for an image whose /SMask or /Mask names it
    // (a soft mask has no /Subtype to say it is an image).
    const pixels = imagePixels(entries, numberObject);
    if (num === null) unnumberedStreams += 1;
    else if (streamPixels.has(num)) {
      const was = streamPixels.get(num)!;
      streamPixels.set(
        num,
        was === null || pixels === null ? null : Math.max(was, pixels),
      );
    } else streamPixels.set(num, pixels);
    if (maybeImage) {
      if (pixels !== null) {
        scan.maxImagePixels = Math.max(scan.maxImagePixels, pixels);
      }
      images.push({
        num,
        pixels,
        bilevel: isBilevel(entries),
        masks: valuesOf(entries, "SMask", "Mask").flatMap((v) =>
          v.kind === "ref" ? [v.num] : [],
        ),
      });
    }
    if (maybeOther || objectStream) await readAsContent(stream);
    else imagesOnly.push(stream);
    return end;
  };

  // Every `stream` keyword in file order. One a header reaches is read with
  // that header's dictionary (each, if several reach it); any other, after
  // a `>>`, with the byte-wise matcher's.
  const dicts = new DictMatcher(bytes);
  const done = new Set<number>();
  let at = 0;
  for (;;) {
    const kw = indexOfWord(bytes, STREAM, at);
    if (kw === -1) break;
    at = kw + STREAM.length;
    const readings = parsed.get(kw);
    if (readings) {
      done.add(kw);
      for (const r of readings) {
        at = Math.max(at, await found(r.dictStart, r.dictEnd, kw, r.num));
        if (scan.exceeded) return scan;
      }
      continue;
    }
    // `endstream` contains `stream`; only a keyword after `>>` starts data.
    let back = kw - 1;
    while (back >= 0 && isWhite(bytes[back]!)) back -= 1;
    if (!(bytes[back] === 0x3e && bytes[back - 1] === 0x3e)) continue;
    const dictStart = dicts.startBefore(back + 1);
    if (dictStart === null) continue;
    dictBytes += back + 1 - dictStart;
    if (dictBytes > dictBudget) {
      scan.exceeded = "scan-work";
      return scan;
    }
    at = Math.max(
      at,
      await found(
        dictStart,
        back + 1,
        kw,
        streamObjectNumber(bytes, dictStart),
      ),
    );
    if (scan.exceeded) return scan;
  }
  // A keyword the loop jumped over (inside data a misread /Length or a
  // byte-wise reading spanned) is still read with every header's dictionary.
  for (const [kw, readings] of parsed) {
    if (done.has(kw)) continue;
    for (const r of readings) {
      await found(r.dictStart, r.dictEnd, kw, r.num);
      if (scan.exceeded) return scan;
    }
  }

  // Images that a page's /Contents names are page content.
  contents.reset();
  contents.feed(bytes);
  contents.reset();
  const named = new Set<number>(contents.arrays);
  /** Streams a /Contents ARRAY lists: pdf.js reads them joined. */
  const inArrays = new Set<number>(contents.arrays);
  let unseen = opaqueObjectStreams > 0;
  const indirect = new Set(
    [...contents.direct].filter((n) => !streamNums.has(n)),
  );
  for (const n of contents.direct) named.add(n);
  const arrays = arrayObjectRefs(bytes, headers, indirect);
  for (const n of indirect) {
    const held = arrays.get(n);
    // An array object in an object stream, or a name of nothing: the scan
    // cannot see what it lists, so every image may be content.
    if (held === undefined) unseen = true;
    else
      for (const m of held) {
        named.add(m);
        inArrays.add(m);
      }
  }
  const isNamed = (num: number | null) =>
    unseen || num === null || named.has(num);
  for (const r of heldBack) if (isNamed(r.num)) keep(r, false);
  for (const s of imagesOnly) {
    if (isNamed(s.num)) {
      await readAsContent(s, false);
      if (scan.exceeded) return scan;
    }
  }

  // References in the file's object text: everything outside stream data.
  dataRanges.sort((a, b) => a[0] - b[0]);
  refs.reset();
  let from = 0;
  for (const [start, end] of dataRanges) {
    if (start > from) refs.countIn(bytes, from, start);
    from = Math.max(from, end);
  }
  refs.countIn(bytes, from, bytes.length);

  // pdf.js reads the streams of a /Contents array as one, so a stream that
  // ends inside a string, a comment or an image hands that state to the
  // stream after it, which this scan read from a fresh start. Every stream an
  // array may list is then judged by its loose reading, which skips nothing
  // (see ContentOps), except the unclean stream itself when nothing else is
  // unclean and the file names it once: then nothing can come before it. A
  // stream read alone (a single /Contents, a form, a pattern) always starts
  // fresh in pdf.js.
  const inArray = (num: number | null) =>
    unseen || num === null || inArrays.has(num);
  const unclean = records.filter((r) => !r.cleanEnd && inArray(r.num));
  const startsUnknown = (r: ReadRecord) =>
    inArray(r.num) &&
    unclean.some(
      (u) => u !== r || u.num === null || (refs.counts.get(u.num) ?? 0) > 1,
    );
  const judged: ContentRecord[] = [];
  const inline: { num: number | null; images: InlineImages }[] = [];
  for (const r of records) {
    const c = startsUnknown(r) ? await r.loose() : r.exact;
    scan.maxQDepth = Math.max(scan.maxQDepth, c.max);
    if (c.pushes > 0 || c.dos > 0)
      judged.push({ num: r.num, form: r.form, ...c });
    const i = c.inline;
    if (i.sized.length > 0 || i.unknown > 0 || i.loose > 0) {
      inline.push({ num: r.num, images: i });
    }
  }
  judgeGraphicsState(scan, judged, refs.counts, opaqueObjectStreams);
  if (scan.exceeded) return scan;
  // pdf.js paints an image stream only through a reference to it: one that
  // nothing names (an orphan object, a leftover of an edit) is never drawn.
  // Counted over the WHOLE file, stream data included, so a reference the
  // scan read as data is still seen; that can only add references.
  let everywhere: RefCounter | null = null;
  const referenced = (num: number | null): boolean => {
    if (num === null || opaqueObjectStreams > 0 || refs.counts.has(num)) {
      return true;
    }
    if (everywhere === null) {
      everywhere = new RefCounter();
      everywhere.countIn(bytes, 0, bytes.length);
    }
    return everywhere.counts.has(num);
  };
  judgeImages(scan, images, inline, referenced, (num) =>
    streamPixels.has(num)
      ? streamPixels.get(num)!
      : unnumberedStreams > 0
        ? null
        : 0,
  );
  return scan;
}

/** An image stream as the scan read its dictionary. */
interface StreamImage {
  num: number | null;
  /** Its own /Width x /Height; null when the scan cannot read them. */
  pixels: number | null;
  bilevel: boolean;
  /** The streams its /SMask and /Mask name. */
  masks: number[];
}

/**
 * The image budget, over every image pdf.js may paint: image streams that
 * something references (`referenced`; an orphan is never drawn), and the
 * inline images of the content streams that something references.
 *
 * What an image COSTS is what pdf.js decodes to paint it: its own samples,
 * and those of its /SMask and /Mask streams, each at ITS own size. What
 * pdf.js's `maxImageSize` is compared with is the image's own /Width x
 * /Height alone (`buildPaintImageXObject`), so an image over budget is
 * recorded by its OWN size: a preview set just below that skips the image,
 * masks and all, before decoding any of it.
 *
 * History (hostile review, 2026-11-09): masks were not charged, so a
 * 10 x 10 image with a 10,000 x 10,000 soft mask that has no /Subtype drew
 * unflagged (a 380 MP one: 7.9 s, ~4.7 GB), and one whose mask has
 * /Subtype /Image set `maxImageSize` to the MASK's size, which the 100-pixel
 * image passes, so the mask was decoded and the notice was false. Orphans
 * were counted, so an unreferenced 64 MP object hid a page's own 144 MP
 * bilevel scan. Inline images were not seen at all (see {@link InlineImages}).
 *
 * `maskPixels(num)` is a mask stream's size: 0 when no stream has that
 * number (pdf.js ignores a mask that is not a stream), null when unknown.
 */
function judgeImages(
  scan: PdfStreamScan,
  images: readonly StreamImage[],
  inline: readonly { num: number | null; images: InlineImages }[],
  referenced: (num: number | null) => boolean,
  maskPixels: (num: number) => number | null,
): void {
  const judge = (own: number, cost: number | null, bilevel: boolean) => {
    // pdf.js paints nothing of an image with a zero side.
    if (own <= 0) return;
    const budget = bilevel
      ? RASTER_MAX_BILEVEL_PIXELS
      : RASTER_MAX_IMAGE_PIXELS;
    if (
      (cost === null || cost > budget) &&
      (scan.smallestOverBudgetImage === null ||
        own < scan.smallestOverBudgetImage)
    ) {
      scan.smallestOverBudgetImage = own;
    }
  };
  for (const image of images) {
    if (!referenced(image.num)) continue;
    if (image.pixels === null) {
      scan.unknownSizeImages += 1;
      continue;
    }
    // A bilevel image is an /ImageMask (a stencil: pdf.js decodes no mask
    // for it) or has no mask at all (see isBilevel).
    let cost: number | null = image.pixels;
    if (!image.bilevel) {
      for (const m of image.masks) {
        const px = maskPixels(m);
        cost = px === null || cost === null ? null : Math.max(cost, px);
      }
    }
    judge(image.pixels, cost, image.bilevel);
  }
  for (const { num, images: i } of inline) {
    if (!referenced(num)) continue;
    for (const one of i.sized) judge(one.pixels, one.pixels, one.bilevel);
    scan.unknownSizeImages += i.unknown;
    // The loose charge bounds every loose image from ABOVE, so it cannot be
    // the size a preview skips at: an over-budget image smaller than it
    // would pass under it. Past the colour budget it is an image of unknown
    // size, which the preview skips at the budget itself.
    if (i.loose > 0 && i.looseW * i.looseH > RASTER_MAX_IMAGE_PIXELS) {
      scan.unknownSizeImages += 1;
    }
  }
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
 * or works past {@link MAX_GRAPHICS_STATE_WORK}. Readers call it through
 * {@link preflightPdfjsOpen}, which runs the xref pre-scan first and keeps
 * the answer per file.
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

/** Each file's preflight, by the bytes it was asked of (see below). */
const preflights = new WeakMap<
  Uint8Array,
  { length: number; result: Promise<PdfjsPreflight> }
>();

/**
 * The checks EVERY pdf.js open in the browser runs first, in this order:
 *
 *  1. `prescanXref`: cross-reference rows pdf.js would walk past every bound
 *     (zero bytes wide over an /Index of two billion entries runs it out of
 *     memory at the open itself, SIB-03) are refused as unreadable;
 *  2. {@link preflightPdfjsBytes}: streams that inflate past the memory
 *     bounds, an object stream among them (pdf.js inflates the one holding
 *     the catalog during the open), and page content nested or worked past
 *     the `q` bounds.
 *
 * Before lane res1 only the text and raster readers ran (2), and only the
 * access probe ran (1): the upload board of every pdf.js tool, Compare's
 * cards, Auto-crop and the editor canvas ran neither.
 * `pdfjs-open-preflight.test.ts` finds every pdf.js open in the browser
 * code and requires it to await this first.
 *
 * The answer is kept for the same `Uint8Array` object at the same length: a
 * file is opened by the page board, then its thumbnails, then the run, and
 * the scan is a pass over the whole file, so it runs once. A typed refusal is kept
 * too, and is the same refusal. The key is the object, not its contents: a
 * caller that wrote new bytes into an array it had already opened would get
 * the first answer. The readers hand pdf.js a copy and never write into the
 * array they were given; the length check only catches a detached buffer.
 */
export function preflightPdfjsOpen(bytes: Uint8Array): Promise<PdfjsPreflight> {
  const kept = preflights.get(bytes);
  if (kept && kept.length === bytes.length) return kept.result;
  const result = (async () => {
    if (prescanXref(bytes).unbounded) {
      throw new PdfEngineError(UNREADABLE_PDF_MESSAGE, { kind: "unreadable" });
    }
    return preflightPdfjsBytes(bytes);
  })();
  preflights.set(bytes, { length: bytes.length, result });
  // Only answers about the FILE are kept: a result, or a typed refusal. A
  // failure of the scan itself (an exception from `DecompressionStream`, say)
  // says nothing about these bytes, so the next open asks again.
  result.catch((err: unknown) => {
    if (
      !(err instanceof PdfEngineError) &&
      preflights.get(bytes)?.result === result
    ) {
      preflights.delete(bytes);
    }
  });
  return result;
}

/** The output paths' refusal of a file holding an over-budget image. */
export function refuseOverBudgetImages(preflight: PdfjsPreflight): void {
  if (preflight.overBudgetImage) {
    throw new PdfEngineError(PDF_IMAGE_TOO_LARGE_MESSAGE);
  }
}
