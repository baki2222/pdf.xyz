/**
 * Each of poppler's words, labelled with the formatting the page draws it in
 * — bold, italic, size, colour — for PDF to Word (since 2026-11-15).
 *
 * ── WHERE THE TEXT COMES FROM, AND WHERE THE STYLE DOES ─────────────────────
 *
 * EVERY CHARACTER the .docx holds is poppler's (`../pdf-text/flow`): its
 * reading order, its paragraphs, its words. pdf.js's page reader
 * (`./page-scan`) only LABELS them: each poppler word (a `FlowPiece`, in
 * poppler's frame) is matched by position to the pdf.js run drawn there
 * (mapped into poppler's frame through the page's `mediaFrame`), and takes
 * that run's style. The two readers never agree on the TEXT one to one
 * (ligatures, spacing, reading order), which is why the text is never taken
 * from the run; on a POSITION they agree to a fraction of a point.
 *
 * ── THE MATCH ───────────────────────────────────────────────────────────────
 *
 * Built once per page:
 *  - every visible line that is upright (within half a degree), whose runs
 *    all carry their position along the baseline (`offset`, `extent`) and
 *    none of whose runs is in a right-to-left script, puts its visible runs
 *    in a bucket by their vertical centre ({@link BUCKET_PT} points) — runs
 *    side by side in ONE style joined into one, with their text;
 *  - every other line — turned, right-to-left (a run's offsets run against
 *    the reading direction there), or without offsets — is kept whole, with
 *    the one style ALL its visible runs share, if they share one: its turned
 *    outline (four corners, not the upright box around them) and its text.
 *
 * Per word, a candidate is a run, in the word's bucket or the two beside
 * it, whose box holds the word's vertical centre, overlaps at least half the
 * word's width ({@link MIN_COVER}), AND whose text holds the word's whole
 * text ({@link textHolds}). The word takes the candidates' style if they all
 * have ONE; with none, the whole line whose turned outline holds the word's
 * centre and whose text holds the word's, if every such line has one style;
 * otherwise NOTHING — the word is written in Word's default style, and
 * counted. An unmatched word is never guessed: plain is the default, never
 * a neighbour's bold.
 *
 * The TEXT test is what keeps a style on the characters drawn in it
 * (review of 2026-11-15, round 1, which found each of these labelled wrong
 * by position alone):
 *  - a word whose style changes partway through (`print` blue + `(x)`
 *    black, which poppler keeps as ONE word, a word having one font but no
 *    one colour) is in no single run's text: plain, not the bigger part's;
 *  - a word drawn OVER another line (a stamp, a filled-in value) lies
 *    inside the wide run beneath it too, but only its own run's text holds
 *    it — and where both texts do, two styles is no style;
 *  - words under a turned watermark (the invisible words of an OCR layer,
 *    say) lie inside its outline but not in its text.
 *
 * Invisible runs (an OCR layer) are not drawn in any style, so they label
 * nothing: an OCR'd scan comes through in Word's default style.
 *
 * ── WHAT A STYLE IS ─────────────────────────────────────────────────────────
 *
 * Bold and italic from the run's face; the size, in half-points, rounded and
 * held to Word's range (`HALF_POINTS_RANGE`); the colour, unless it is black,
 * unknown (a pattern fill) or mostly transparent.
 *
 * ── THE TYPEFACE (#28 slice 4, since 2026-11-15, key `docxTypefaces`) ───────
 *
 * Until 2026-11-15 a style was "not the typeface", and every word came out
 * in Word's default font. Now a word also carries an Office family
 * (`typeface`), decided AFTER its style and never changing it:
 *  - the family is `./typeface`'s (`docxTypefaceOf`): a family Office or
 *    Windows ships by its name, a metric clone as the family it clones,
 *    anything else Arial, Times New Roman or Courier New by the PDF font's
 *    class. Only the name: no font is embedded;
 *  - a word takes one only when EVERY candidate that gave it its style has
 *    a member run — a part of the joined run, overlapping half the word,
 *    whose own text holds it (the same two tests a run passes) — and every
 *    such part names the SAME family. A word straddling two faces is in no
 *    part's text, so it keeps its style and takes no typeface;
 *  - a turned, right-to-left or unlocated line gives the family all its
 *    visible runs share, if they share one;
 *  - an invisible run (an OCR layer) and a symbol or dingbat face name none
 *    (poppler's Unicode set in Wingdings would draw the wrong glyphs);
 *  - a word with any letter outside Latin (`WORD_SCRIPT_SAFE`: Bengali,
 *    Greek, Arabic, CJK…) takes none, so Word keeps its own font for that
 *    script; its bold, italics, size and colour are kept.
 * `styleKey` does not see the typeface, so the join, a line's one style and
 * the candidates' agreement are exactly what they were; `runKey` does, and
 * is what keeps two faces in two Word runs. Each sentence here is pinned by
 * `docx-run-style.test.ts` ("the typeface, decided inside the candidates")
 * and by the truth test's "typeface never changes a word's style".
 */
import type { FlowPiece, PdfFlowTextPage } from "../pdf-text/flow";
import { mapBox } from "./media-frame";
import { HALF_POINTS_RANGE } from "./docx-structure";
import type { ScannedPage, ScannedRun, ScannedTextLine } from "./page-scan";
import { docxTypefaceOf, WORD_SCRIPT_SAFE } from "./typeface";

export interface DocxRunStyle {
  bold?: true;
  italic?: true;
  /** Word's `w:sz`: half-points. */
  halfPoints?: number;
  /** "RRGGBB", never black. */
  color?: string;
  /**
   * An Office family (`./typeface`), written as `w:rFonts` ascii, hAnsi and
   * cs; absent when the word's typeface is not certain (module docblock).
   */
  typeface?: string;
}

/**
 * The most words one page's formatting is matched for; a page with more is
 * written in Word's default style, its text whole, and named in the result.
 *
 * MEASURED 2026-11-15 (Node 24, Windows dev host; a fresh process each,
 * `src/tests/docx-run-style-measure.ts`, held to bounds by
 * `docx-run-style.cap.test.ts`): the matcher alone over one page AT this
 * cap — 20,000 words, each its own run — took 12 ms and +2 MB of peak RSS
 * in lines of 20 words, and 9 ms and +2 MB with every word on ONE line
 * (every run in one bucket; 1,297 ms before the buckets were searched by
 * binary search). For scale, a whole 500-page document (41 words a page)
 * through the engine took 2.0 s and +54 MB, of which the check before
 * delivery's structural read-back was 200 ms. The cap is not what makes a
 * page cheap; it bounds the one shape the search is still linear in per
 * word — a single run as wide as the line among thousands of narrow ones in
 * one bucket — which took 640 ms and +3 MB at this count (`match-wide`).
 *
 * RE-MEASURED 2026-11-15 with the text test (review round 1): 25 / 22 / 727
 * ms and +8 / +12 / +9 MB for the three shapes above, and 15 ms and +3 MB
 * for every word on one line in ONE style (`match-one`: the runs join into
 * one of 100,000 characters, searched within {@link TEXT_WINDOW}).
 *
 * RE-MEASURED 2026-11-15 with parts (#28 slice 4, the typeface decided from
 * each joined run's member parts, found by binary search like the buckets),
 * the base build measured beside it in the same session, two fresh runs
 * each: match 44-45 ms / +19-20 MB (base 20 ms / +10-11), match-line 46-49
 * ms / +21 (base 20-21 / +10-13), match-wide 781-1,143 ms / +16-21 (base
 * 773-791 / +7-8), match-one 29-31 ms / +14-15 (base 11-16 / +4). About
 * twice the matcher's time and +10 MB at the cap; the wide-run shape, the
 * cap's reason, is unchanged within its noise.
 */
export const MAX_STYLED_PIECES_PER_PAGE = 20_000;

/** The height of a bucket of run boxes, points. */
export const BUCKET_PT = 4;
/** A run must cover this share of a word's width to label it. */
export const MIN_COVER = 0.5;
/** A line within this many degrees of upright is matched word by word. */
const UPRIGHT_DEG = 0.5;
/** Below this opacity a colour is not what the reader sees. */
const MIN_ALPHA = 0.5;

const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;

type Box = readonly [number, number, number, number];
type Point = readonly [number, number];

/** One visible member run of a joined {@link RunBox}: its box, text, face. */
interface RunPart {
  box: Box;
  /** Its characters, {@link normalText}. */
  text: string;
  /** `docxTypefaceOf` the member run: null for a symbol face. */
  typeface: string | null;
}

interface RunBox {
  box: Box;
  style: DocxRunStyle;
  /** Its characters, {@link normalText}. */
  text: string;
  /** Its member runs, sorted by left edge, and the widest of them. */
  parts: RunPart[];
  widestPart: number;
}

interface LineBox {
  /** The upright box around {@link quad}: which buckets the line is in. */
  box: Box;
  /** The line's turned outline, its corners in order around it. */
  quad: readonly Point[];
  /** The style every visible run shares (a line of several is not kept). */
  style: DocxRunStyle;
  /** Its characters, {@link normalText}. */
  text: string;
  /** The family all its visible runs share (`docxTypefaceOf`), or null. */
  typeface: string | null;
}

/**
 * A text as both readers can agree on it: compatibility forms unfolded (a
 * ligature is its letters), and no white space or soft hyphen, which the
 * two place differently.
 */
export function normalText(text: string): string {
  return text.normalize("NFKC").replace(/[\s­]+/gu, "");
}

/**
 * Up to this many characters of a run's text are searched whole for a word;
 * a longer run (a page-wide line in one style) is searched only near where
 * the word sits along it, by its share of the run's width, so a page of
 * thousands of words on one run is not thousands of searches of all of it.
 */
export const TEXT_WINDOW = 4096;

/**
 * Whether `text` — a run or line spanning `from`..`to` across — holds the
 * word `key` centred at `at`. Missing a word only writes it plain (and
 * counts it); it can never give a word a style it is not drawn in.
 */
export function textHolds(
  text: string,
  key: string,
  at: number,
  from: number,
  to: number,
): boolean {
  if (text.length <= TEXT_WINDOW) return text.includes(key);
  const share = to > from ? (at - from) / (to - from) : 0.5;
  const mid = Math.round(Math.min(1, Math.max(0, share)) * text.length);
  const half = TEXT_WINDOW / 2 + key.length;
  return text
    .slice(Math.max(0, mid - half), Math.min(text.length, mid + half))
    .includes(key);
}

/** Whether `p` lies inside the convex outline `quad` (or on its edge). */
function inside(quad: readonly Point[], p: Point): boolean {
  let sign = 0;
  for (let k = 0; k < quad.length; k++) {
    const [ax, ay] = quad[k]!;
    const [bx, by] = quad[(k + 1) % quad.length]!;
    const cross = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** A point through the page's `mediaFrame` (as `mapBox` maps a box). */
function mapPoint(m: readonly number[] | undefined, [x, y]: Point): Point {
  if (!m) return [x, y];
  return [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
}

/** The style a run is drawn in, as Word writes it. */
export function styleOfRun(run: ScannedRun): DocxRunStyle {
  const halfPoints = Math.min(
    HALF_POINTS_RANGE[1],
    Math.max(HALF_POINTS_RANGE[0], Math.round(run.size * 2)),
  );
  const color =
    run.color !== null &&
    /^[0-9A-Fa-f]{6}$/.test(run.color) &&
    run.color.toUpperCase() !== "000000" &&
    run.alpha >= MIN_ALPHA
      ? run.color.toUpperCase()
      : undefined;
  return {
    ...(run.bold ? { bold: true as const } : {}),
    ...(run.italic ? { italic: true as const } : {}),
    ...(Number.isFinite(halfPoints) ? { halfPoints } : {}),
    ...(color ? { color } : {}),
  };
}

/**
 * Two styles are one style when this is equal: the run join, a line's one
 * style, the candidates' agreement. It does NOT see the typeface, so the
 * matcher's style decision is the one it made before typefaces (2026-11-15).
 */
export function styleKey(style: DocxRunStyle | null): string {
  if (!style) return "-";
  return `${style.bold ? "b" : ""}${style.italic ? "i" : ""}|${style.halfPoints ?? ""}|${style.color ?? ""}`;
}

/** Two styled words are one Word run when this is equal: style AND typeface. */
export function runKey(style: DocxRunStyle | null): string {
  return `${styleKey(style)}|${style?.typeface ?? ""}`;
}

/**
 * `[x, y, w, h]` turned `rotation` degrees clockwise about its centre: its
 * four corners in order around it, mapped through the page's `mediaFrame`.
 */
function turnedQuad(
  line: ScannedTextLine,
  frame: readonly number[] | undefined,
): Point[] {
  const cx = line.x + line.width / 2;
  const cy = line.y + line.height / 2;
  const a = (line.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const w = line.width / 2;
  const h = line.height / 2;
  return (
    [
      [-w, -h],
      [w, -h],
      [w, h],
      [-w, h],
    ] as const
  ).map(([dx, dy]) =>
    mapPoint(frame, [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]),
  );
}

/** The upright box around some points. */
function boxAround(points: readonly Point[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/**
 * One bucket's runs, sorted by their left edge, and the widest of them: a
 * word's candidates are the runs starting between its left edge less that
 * width and its right edge — found by binary search, so a page of every run
 * on one line is not a search of every run per word.
 */
interface Bucket {
  runs: RunBox[];
  widest: number;
}

interface PageIndex {
  buckets: Map<number, Bucket>;
  /** Whole lines, by every bucket their box spans. */
  lines: Map<number, LineBox[]>;
}

/** The first index in `runs` (sorted by left edge) whose left edge is >= x. */
function firstFrom(runs: readonly { box: Box }[], x: number): number {
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid]!.box[0] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The page's runs, indexed for matching (see the module docblock). */
function indexOf(scanned: ScannedPage): PageIndex {
  const byBucket = new Map<number, RunBox[]>();
  const lines = new Map<number, LineBox[]>();
  const frame = scanned.mediaFrame;
  for (const item of scanned.items) {
    if (item.kind !== "text") continue;
    const visible = item.runs.filter((r) => !r.invisible && r.text.trim());
    if (visible.length === 0) continue;
    const upright = Math.min(item.rotation, 360 - item.rotation) < UPRIGHT_DEG;
    const located = item.runs.every(
      (r) => r.offset !== undefined && r.extent !== undefined,
    );
    const rtl = item.runs.some((r) => RTL_SCRIPT.test(r.text));
    if (upright && located && !rtl) {
      // Runs side by side in one style, joined: the page reader splits a
      // run where the FONT changes, which a word's style does not see.
      const joined: {
        from: number;
        to: number;
        style: DocxRunStyle;
        key: string;
        text: string;
        parts: RunPart[];
      }[] = [];
      let previous: ScannedRun | null = null;
      for (const run of item.runs) {
        const shown = !run.invisible && run.text.trim() !== "";
        if (!shown) {
          // An invisible run between two breaks them; a blank one does not.
          if (run.invisible) previous = null;
          continue;
        }
        const style = styleOfRun(run);
        const key = styleKey(style);
        const last = joined.at(-1);
        const part: RunPart = {
          box: mapBox(frame, [
            item.x + run.offset!,
            item.y,
            item.x + run.offset! + run.extent!,
            item.y + item.height,
          ]),
          text: normalText(run.text),
          typeface: docxTypefaceOf(run),
        };
        if (previous && last && last.key === key) {
          last.to = run.offset! + run.extent!;
          last.text += run.text;
          last.parts.push(part);
        } else {
          joined.push({
            from: run.offset!,
            to: run.offset! + run.extent!,
            style,
            key,
            text: run.text,
            parts: [part],
          });
        }
        previous = run;
      }
      for (const run of joined) {
        const box = mapBox(frame, [
          item.x + run.from,
          item.y,
          item.x + run.to,
          item.y + item.height,
        ]);
        const bucket = Math.floor((box[1] + box[3]) / 2 / BUCKET_PT);
        const list = byBucket.get(bucket);
        run.parts.sort((p, q) => p.box[0] - q.box[0]);
        let widestPart = 0;
        for (const p of run.parts)
          widestPart = Math.max(widestPart, p.box[2] - p.box[0]);
        const entry: RunBox = {
          box,
          style: run.style,
          text: normalText(run.text),
          parts: run.parts,
          widestPart,
        };
        if (list) list.push(entry);
        else byBucket.set(bucket, [entry]);
      }
      continue;
    }
    const first = styleOfRun(visible[0]!);
    const key = styleKey(first);
    // A line of several styles labels nothing as a whole: not indexed.
    if (!visible.every((r) => styleKey(styleOfRun(r)) === key)) continue;
    const quad = turnedQuad(item, frame);
    const box = boxAround(quad);
    const faces = new Set(visible.map((r) => docxTypefaceOf(r)));
    const [face] = faces;
    const entry: LineBox = {
      box,
      quad,
      style: first,
      text: normalText(visible.map((r) => r.text).join("")),
      typeface: faces.size === 1 && face ? face : null,
    };
    const top = Math.floor(box[1] / BUCKET_PT);
    const bottom = Math.floor(box[3] / BUCKET_PT);
    for (let b = top; b <= bottom; b++) {
      const list = lines.get(b);
      if (list) list.push(entry);
      else lines.set(b, [entry]);
    }
  }
  const buckets = new Map<number, Bucket>();
  for (const [b, runs] of byBucket) {
    runs.sort((p, q) => p.box[0] - q.box[0]);
    let widest = 0;
    for (const r of runs) widest = Math.max(widest, r.box[2] - r.box[0]);
    buckets.set(b, { runs, widest });
  }
  return { buckets, lines };
}

/** The one style of `found`, or null when it is empty or holds two. */
function oneStyle(found: readonly DocxRunStyle[]): DocxRunStyle | null {
  if (found.length === 0) return null;
  const key = styleKey(found[0]!);
  return found.every((s) => styleKey(s) === key) ? found[0]! : null;
}

/**
 * The one family named by the parts of `found` that hold the word, or
 * null: every candidate needs at least one part overlapping half the word
 * whose own text holds it, and every such part must name the same family.
 */
function oneTypeface(
  found: readonly RunBox[],
  key: string,
  box: Box,
  cx: number,
  width: number,
): string | null {
  let face: string | null = null;
  for (const run of found) {
    let held = false;
    const { parts, widestPart } = run;
    for (
      let k = firstFrom(parts, box[0] - widestPart);
      k < parts.length && parts[k]!.box[0] < box[2];
      k++
    ) {
      const part = parts[k]!;
      const overlap =
        Math.min(box[2], part.box[2]) - Math.max(box[0], part.box[0]);
      if (
        overlap < MIN_COVER * width ||
        !textHolds(part.text, key, cx, part.box[0], part.box[2])
      )
        continue;
      if (part.typeface === null) return null;
      if (face !== null && face !== part.typeface) return null;
      face = part.typeface;
      held = true;
    }
    if (!held) return null;
  }
  return face;
}

/** `style` with `typeface`, when there is one and the word's text is Latin. */
function withTypeface(
  style: DocxRunStyle | null,
  typeface: string | null,
  text: string,
): DocxRunStyle | null {
  if (!style || !typeface || !WORD_SCRIPT_SAFE.test(text)) return style;
  return { ...style, typeface };
}

function matchPiece(piece: FlowPiece, index: PageIndex): DocxRunStyle | null {
  const key = normalText(piece.text);
  if (!key) return null;
  const { box } = piece;
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const width = Math.max(box[2] - box[0], 1e-6);
  const bucket = Math.floor(cy / BUCKET_PT);
  const found: RunBox[] = [];
  for (let b = bucket - 1; b <= bucket + 1; b++) {
    const inBucket = index.buckets.get(b);
    if (!inBucket) continue;
    const { runs, widest } = inBucket;
    for (
      let k = firstFrom(runs, box[0] - widest);
      k < runs.length && runs[k]!.box[0] < box[2];
      k++
    ) {
      const run = runs[k]!;
      if (cy < run.box[1] || cy > run.box[3]) continue;
      const overlap =
        Math.min(box[2], run.box[2]) - Math.max(box[0], run.box[0]);
      if (
        overlap >= MIN_COVER * width &&
        textHolds(run.text, key, cx, run.box[0], run.box[2])
      )
        found.push(run);
    }
  }
  if (found.length > 0) {
    // The style decision is the one made before typefaces, unchanged; the
    // typeface is looked for only inside the candidates that gave it.
    const style = oneStyle(found.map((r) => r.style));
    if (!style) return null;
    return withTypeface(
      style,
      oneTypeface(found, key, box, cx, width),
      piece.text,
    );
  }
  const lines: LineBox[] = [];
  for (const line of index.lines.get(bucket) ?? []) {
    if (
      inside(line.quad, [cx, cy]) &&
      textHolds(line.text, key, cx, line.box[0], line.box[2])
    )
      lines.push(line);
  }
  const faces = new Set(lines.map((l) => l.typeface));
  const [face] = faces;
  return withTypeface(
    oneStyle(lines.map((l) => l.style)),
    faces.size === 1 ? (face ?? null) : null,
    piece.text,
  );
}

export interface PageRunStyles {
  /** Parallel to `page.pieces`: each word's style, or null (Word's default). */
  styles: (DocxRunStyle | null)[][][];
  /** Words given a style. */
  matched: number;
  /** Words on the page. */
  total: number;
  /** The page had more than {@link MAX_STYLED_PIECES_PER_PAGE} words. */
  capped: boolean;
}

/**
 * Every word's style on one page (see the module docblock). All null — and
 * counted by the caller — when the page reader did not read the page's text
 * (`textUnread`), read no page, or the page has more words than the cap.
 * With `typefaces: false` (the engine's size fallback, since 2026-11-15) no
 * style carries a typeface; nothing else changes.
 */
export function runStylesOf(
  page: PdfFlowTextPage,
  scanned: ScannedPage | undefined,
  options: { typefaces?: boolean } = {},
): PageRunStyles {
  const pieces: readonly (readonly (readonly FlowPiece[])[])[] =
    page.pieces ?? [];
  let total = 0;
  for (const paragraph of pieces)
    for (const cell of paragraph) total += cell.length;
  const none = () =>
    pieces.map((paragraph) => paragraph.map((cell) => cell.map(() => null)));
  const capped = total > MAX_STYLED_PIECES_PER_PAGE;
  if (capped || !scanned || scanned.textUnread)
    return { styles: none(), matched: 0, total, capped };
  const index = indexOf(scanned);
  let matched = 0;
  const styles = pieces.map((paragraph) =>
    paragraph.map((cell) =>
      cell.map((piece) => {
        const style = matchPiece(piece, index);
        if (style) matched += 1;
        if (style?.typeface && options.typefaces === false) {
          const { typeface: _dropped, ...rest } = style;
          void _dropped;
          return rest;
        }
        return style;
      }),
    ),
  );
  return { styles, matched, total, capped };
}
