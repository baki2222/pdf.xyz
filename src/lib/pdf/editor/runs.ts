import { contentToViewer, type ExportFrame } from "./geometry";
import type { EditorFont, Rect, TextEditObject } from "./model";

/**
 * Text runs as the editor offers them: pdf.js's text items (what a viewer
 * selects and searches), each placed on the page in viewer points, plus the
 * pure helpers Edit text and Find & replace share — turning a run into a
 * `TextEditObject`, and finding a string across runs.
 */

/** A pdf.js text item, reduced to what the editor reads. */
export interface PdfjsTextItem {
  str: string;
  /** Text space → user space (pdf.js `transform`), font size included. */
  transform: number[];
  /** Advance along the baseline, user units. */
  width: number;
}

/** How a run looks, from the content-stream reading (`describeRun`). */
export interface RunStyle {
  color: string | null;
  font: EditorFont;
  bold: boolean;
  italic: boolean;
  ownChars: string;
  fontName: string;
  /** Why it cannot be edited, or null. */
  refusal: string | null;
}

export interface TextRun {
  /** Stable within a page: `p<page>r<index>`. */
  key: string;
  page: number;
  index: number;
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  /** Viewer box. */
  rect: Rect;
  baseX: number;
  baseY: number;
  size: number;
  angle: number;
}

const DESCENT = -0.22;
const ASCENT = 0.92;

/** Place pdf.js's items on a page (viewer points). Blank items are dropped. */
export function placeRuns(
  page: number,
  items: readonly PdfjsTextItem[],
  frame: ExportFrame,
): TextRun[] {
  const out: TextRun[] = [];
  items.forEach((item, index) => {
    if (item.str.trim().length === 0) return;
    const t = item.transform;
    if (t.length < 6 || !t.every(Number.isFinite)) return;
    const [a, b, c, d, e, f] = t as [number, number, number, number, number, number];
    const along = Math.hypot(a, b);
    if (!(along > 0) || !(item.width > 0)) return;
    const s = item.width / along;
    const at = (u: number, v: number) =>
      contentToViewer(e + u * a + v * c, f + u * b + v * d, frame);
    const corners = [at(0, DESCENT), at(s, DESCENT), at(0, ASCENT), at(s, ASCENT)];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const base = at(0, 0);
    const ahead = at(1, 0);
    out.push({
      key: `p${page}r${index}`,
      page,
      index,
      str: item.str,
      transform: [a, b, c, d, e, f],
      width: item.width,
      rect: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
      baseX: base.x,
      baseY: base.y,
      size: Math.hypot(c, d),
      angle: (Math.atan2(ahead.y - base.y, ahead.x - base.x) * 180) / Math.PI,
    });
  });
  return out;
}

/** A new edit of `run`, showing `text`. */
export function textEditFromRun(
  id: string,
  run: TextRun,
  style: RunStyle,
  text: string = run.str,
): TextEditObject {
  return {
    id,
    kind: "textedit",
    page: run.page,
    ...run.rect,
    run: { transform: run.transform, width: run.width },
    original: run.str,
    text,
    size: run.size,
    color: style.color ?? "#000000",
    font: style.font,
    bold: style.bold,
    italic: style.italic,
    ownChars: style.ownChars,
    fontName: style.fontName,
    baseX: run.baseX,
    baseY: run.baseY,
    angle: run.angle,
  };
}

/** Is this edit about this run? Same page and the same baseline origin. */
export function editIsForRun(edit: TextEditObject, run: TextRun): boolean {
  const [, , , , e, f] = edit.run.transform;
  return (
    edit.page === run.page &&
    Math.abs(e - run.transform[4]) < 0.01 &&
    Math.abs(f - run.transform[5]) < 0.01 &&
    edit.original === run.str
  );
}

export interface FindMatch {
  page: number;
  /** The run's key. */
  run: string;
  start: number;
  end: number;
}

/** Every occurrence of `query` in `texts` (run key → current text). */
export function findMatches(
  runs: readonly { key: string; page: number; text: string }[],
  query: string,
  matchCase: boolean,
): FindMatch[] {
  if (query.length === 0) return [];
  const q = matchCase ? query : query.toLocaleLowerCase();
  const out: FindMatch[] = [];
  for (const r of runs) {
    const hay = matchCase ? r.text : r.text.toLocaleLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(q, from);
      if (at < 0) break;
      out.push({ page: r.page, run: r.key, start: at, end: at + query.length });
      from = at + Math.max(1, query.length);
    }
  }
  return out;
}

/** `text` with the matches at `starts` (each `length` long) replaced. */
export function replaceAt(
  text: string,
  starts: readonly number[],
  length: number,
  replacement: string,
): string {
  let out = "";
  let at = 0;
  for (const s of [...starts].sort((a, b) => a - b)) {
    if (s < at) continue;
    out += text.slice(at, s) + replacement;
    at = s + length;
  }
  return out + text.slice(at);
}
