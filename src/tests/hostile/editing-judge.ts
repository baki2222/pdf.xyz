import type { BoundedOutcome } from "./editing-cell-pool";
import type { HostileFixture } from "./editing.fixtures";

/**
 * What an editing cell's outcome MEANS, judged against the fixture rather
 * than against the engine's own report:
 *
 *  - refused with our typed, user-facing error ............ acceptable
 *  - refused an encrypted file with the typed encrypted error and the verdict
 *    its encryption deserves ................................ acceptable
 *  - produced output that reloads with the page count a correct reader finds
 *    in the input, finite positive page sizes ............... acceptable
 *  - threw anything else (the raw message reaches the user: `errorMessage()`
 *    in `runner-kit.tsx` shows any Error's message) ......... internal_error
 *  - outlived its bound ..................................... hang
 *  - exhausted the worker heap .............................. memory
 *  - output that is silently wrong (pages lost or invented, a size the
 *    viewer does not show, a signature verdict the bytes contradict) ... wrong
 */

export type Problem =
  | { kind: "internal_error"; detail: string }
  | { kind: "hang"; detail: string }
  | { kind: "memory"; detail: string }
  | { kind: "crash"; detail: string }
  | { kind: "wrong"; detail: string }
  | { kind: "misleading_refusal"; detail: string };

/** Ops whose value is the file's page sizes (or holds them). */
const SIZE_OPS = new Set([
  "edit.getEditPageSizes",
  "annotate.getAnnotatePageSizes",
  "crop.getPageSizes",
  "crop.getUprightPageSizes",
  "editor.readExportFrames",
  "editor.readEditorDocument",
  "edit.checkEditTextFit(sizes)",
  "annotate.findNoteOverflows(sizes)",
  "createForms.readFormContext",
]);

/** Internal helpers whose throws a caller catches (saveSignedEdit). */
const CAUGHT_BY_CALLER = new Set(["append.appendEditsAsUpdate"]);

/** Pure checks that never refuse: they answer for any bytes. */
const ANSWERS_ANY_BYTES = new Set([
  "append.signaturesKept(self)",
  "append.signaturesKept(resaved)",
]);

/**
 * Refusal copy that tells a user their one-page file has no pages (or that
 * THEY failed to pick one) — true of nothing the user did.
 */
const LOST_PAGE_COPY =
  /out of range \(1–0\)|which this PDF does not have|Page 1 is out of range|Select at least one page/;

function sizesIn(op: string, value: unknown): [number, number][] | null {
  if (!SIZE_OPS.has(op)) return null;
  const v = value as Record<string, unknown> | unknown[];
  const list = Array.isArray(v)
    ? v
    : Array.isArray((v as { frames?: unknown }).frames)
      ? (v as { frames: unknown[] }).frames
      : Array.isArray((v as { sizes?: unknown }).sizes)
        ? (v as { sizes: unknown[] }).sizes
        : null;
  if (!list) return null;
  return list.map((s) =>
    Array.isArray(s)
      ? [Number(s[0]), Number(s[1])]
      : [
          Number((s as { width: unknown }).width),
          Number((s as { height: unknown }).height),
        ],
  );
}

const badSize = ([w, h]: [number, number]) =>
  !(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0);

/** What pdf.js — the viewer the product renders with — shows for the file. */
export interface ViewerFacts {
  pages: number;
  /** Page 1, displayed (after /Rotate and /UserUnit). */
  width: number;
  height: number;
  rotate: number;
}

export interface JudgeContext {
  /** pdf.js's reading of the INPUT: the second, independent bound for sizes. */
  viewer?: ViewerFacts;
  /** Override the fixture's page count (a plan cell on the control). */
  expectedPages?: number;
  /**
   * The same op's graphics-state depth on the CONTROL: an engine that wraps
   * the page in q…Q legitimately reports 1. Deeper than the control means the
   * edit inherits the page's leftover state.
   */
  controlQ?: number;
}

export function judge(
  fixture: HostileFixture,
  op: string,
  o: BoundedOutcome,
  ctx: JudgeContext = {},
): Problem | null {
  const pages = ctx.expectedPages ?? fixture.pages;
  switch (o.status) {
    case "hang":
      return { kind: "hang", detail: `no answer within ${o.ms} ms` };
    case "memory":
      return { kind: "memory", detail: o.message };
    case "crash":
      return { kind: "crash", detail: o.message };
    case "threw": {
      if (CAUGHT_BY_CALLER.has(op)) return null;
      if (fixture.encrypted) {
        if (!o.encryptedError)
          return {
            kind: "internal_error",
            detail: `encrypted file, got ${o.name}: ${o.message}`,
          };
        const want =
          fixture.encrypted === "unknown-handler" ? null : fixture.encrypted;
        if ((o.verdict ?? null) !== want)
          return {
            kind: "wrong",
            detail: `verdict ${o.verdict} for a ${fixture.encrypted} file`,
          };
        return null;
      }
      if (!o.engine)
        return { kind: "internal_error", detail: `${o.name}: ${o.message}` };
      if (pages !== undefined && pages >= 1 && LOST_PAGE_COPY.test(o.message))
        return {
          kind: "misleading_refusal",
          detail: `a ${pages}-page file refused as if it had none: "${o.message}"`,
        };
      return null;
    }
    case "ok": {
      if ((o.peakRssGrowthMb ?? 0) > PEAK_RSS_BOUND_MB)
        return {
          kind: "memory",
          detail: `peak resident memory rose ${o.peakRssGrowthMb} MB for a ${(fixture.bytes.length / 1024).toFixed(0)} KB input`,
        };
      if (ANSWERS_ANY_BYTES.has(op)) return null;
      if (CAUGHT_BY_CALLER.has(op)) {
        const v = o.value as { prefixKept?: boolean };
        return v.prefixKept === false
          ? {
              kind: "wrong",
              detail: "an append that rewrote the original bytes",
            }
          : null;
      }
      if (fixture.encrypted)
        return {
          kind: "wrong",
          detail: `an encrypted (${fixture.encrypted}) file produced output instead of a refusal`,
        };
      const sizes = sizesIn(op, o.value);
      if (sizes) {
        if (pages !== undefined && sizes.length !== pages)
          return {
            kind: "wrong",
            detail: `${sizes.length} page size(s) for a ${pages}-page file`,
          };
        const bad = sizes.find(badSize);
        if (bad)
          return {
            kind: "wrong",
            detail: `page size ${bad[0]} x ${bad[1]}; a viewer shows ${viewerText(ctx.viewer)}`,
          };
        const v = ctx.viewer;
        const first = sizes[0];
        if (v && first && v.pages === pages) {
          const upright = op === "crop.getUprightPageSizes";
          const want: [number, number] =
            upright && v.rotate % 180 !== 0
              ? [v.height, v.width]
              : [v.width, v.height];
          if (!near(first[0], want[0]) || !near(first[1], want[1]))
            return {
              kind: "wrong",
              detail: `page 1 is ${first[0]} x ${first[1]}${upright ? " upright" : ""}; a viewer shows ${want[0]} x ${want[1]} (pdf.js, /Rotate ${v.rotate})`,
            };
        }
      }
      const out = o.output;
      if (out) {
        if (!out.reloads)
          return {
            kind: "wrong",
            detail: `output does not reload: ${out.reloadError}`,
          };
        if (pages !== undefined && out.pages !== pages)
          return {
            kind: "wrong",
            detail: `output has ${out.pages} page(s); the input has ${pages}`,
          };
        // Only a resize SETS the page size; every other writer keeps the input's.
        if (op.startsWith("resize.")) {
          const bad = (out.sizes ?? []).find(badSize);
          if (bad)
            return {
              kind: "wrong",
              detail: `output page size ${bad[0]} x ${bad[1]}`,
            };
        }
        // The engines wrap the page's content in one q…Q, so ONE unclosed q
        // in the page is harmless: the wrapper's Q pops it and the edit runs
        // in the wrapper's (identity) state — measured with pdf.js. Two or
        // more leave the page's own state (its `cm`) in force for the edit.
        if (
          DRAWING_OPS.has(op) &&
          (out.qDepthBeforeLastStream ?? 0) > (ctx.controlQ ?? 0) + 1
        )
          return {
            kind: "wrong",
            detail: `the drawn edit runs ${out.qDepthBeforeLastStream} graphics states deep (control: ${ctx.controlQ ?? 0}): it inherits the page's leftover transform`,
          };
      }
      if (fixture.pages === undefined && out)
        return { kind: "wrong", detail: "an unreadable file produced output" };
      return null;
    }
  }
}

/** Above this, one cell's allocation is a finding (the inputs are all < 1.1 MB). */
export const PEAK_RSS_BOUND_MB = 512;

/** Ops that DRAW into the page's content stream (form widgets and resize do not inherit it). */
const DRAWING_OPS = new Set([
  "edit.editPdf",
  "editor.exportEditedPdf",
  "append.saveSignedEdit",
  "annotate.annotatePdf",
]);

const near = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 1e-9);

const viewerText = (v: ViewerFacts | undefined) =>
  v ? `${v.width} x ${v.height} (pdf.js)` : "nothing (pdf.js cannot open it)";

export function describeOutcome(o: BoundedOutcome): string {
  switch (o.status) {
    case "ok":
      return `ok ${JSON.stringify(o.value).slice(0, 120)}${o.output ? ` -> ${o.output.pages}p reloads=${o.output.reloads}` : ""}`;
    case "threw":
      return `${o.engine ? "refused" : "THREW"} ${o.name}: ${o.message}`;
    default:
      return `${o.status}: ${JSON.stringify(o)}`;
  }
}
