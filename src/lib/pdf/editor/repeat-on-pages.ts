import { clampRectToPage } from "./geometry";
import {
  cloneObject,
  moveObject,
  objectBounds,
  type EditorObject,
  type Rect,
} from "./model";
import { parsePageList } from "../ranges";

/**
 * "Repeat on" for a placed signature, initials, name or date (audit
 * sign-pdf#6, 2026-11-06): copies of the selection at the same spot on all
 * pages, the last page, or pages typed in the shared page-range syntax
 * (`parsePageList`, the parser every page-picking tool uses). The copies
 * are ordinary objects — each can be moved or deleted on its own page — and
 * the whole repeat is one undoable step.
 *
 * Feature-scoped: imported by the editor's lazy chunk (the Repeat on
 * control and the editor that applies it) and by the server-rendered copy
 * that names its choices (`content/sign-pdf.ts`, `guides/catalog.ts`).
 */

export const REPEAT_TARGETS = ["all", "last", "custom"] as const;
export type RepeatTarget = (typeof REPEAT_TARGETS)[number];

export const REPEAT_TARGET_LABEL: Record<RepeatTarget, string> = {
  all: "All pages",
  last: "Last page",
  custom: "Custom pages",
};

/**
 * The 0-based pages a copy goes to, never the page it is on. Custom pages
 * are 1-based as typed ("2-4, 7"); a bad expression throws the parser's
 * `PageRangeError`, whose message says what is wrong.
 */
export function repeatPages(
  target: RepeatTarget,
  custom: string,
  pageCount: number,
  from: number,
): number[] {
  const pages =
    target === "all"
      ? Array.from({ length: pageCount }, (_, i) => i)
      : target === "last"
        ? [pageCount - 1]
        : parsePageList(custom, pageCount);
  return pages.filter((p) => p !== from);
}

/**
 * May this selection be repeated? Objects on one page, none of them a form
 * field (a copy would need a name of its own) or an edit of the page's own
 * text (which belongs to its run).
 */
export function canRepeat(selection: readonly EditorObject[]): boolean {
  if (selection.length === 0) return false;
  const page = selection[0]!.page;
  return selection.every(
    (o) => o.page === page && o.kind !== "field" && o.kind !== "textedit",
  );
}

/** A text box's height without a font kit: its lines at its line height. */
function roughBounds(obj: EditorObject): Rect {
  return objectBounds(
    obj,
    (t) => t.size * t.lineHeight * t.text.split("\n").length,
  );
}

/**
 * Fresh copies of `objects` on each of `pages`, at the same displayed-frame
 * position, pulled in where a smaller page would cut them off.
 */
export function repeatCopies(
  objects: readonly EditorObject[],
  pages: readonly number[],
  frames: readonly { width: number; height: number }[],
  boundsOf: (obj: EditorObject) => Rect = roughBounds,
): EditorObject[] {
  const out: EditorObject[] = [];
  for (const page of pages) {
    const frame = frames[page];
    if (!frame) continue;
    for (const o of objects) {
      let copy: EditorObject = { ...cloneObject(o), page };
      const fix = clampRectToPage(boundsOf(copy), frame.width, frame.height);
      copy = moveObject(copy, fix.dx, fix.dy);
      out.push(copy);
    }
  }
  return out;
}
