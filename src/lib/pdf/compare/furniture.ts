import { diffIds, intern, type Op } from "./diff";
import { runningLines } from "./running-lines";
import { drain, PAUSE, type Steps } from "./steps";

/**
 * "Ignore page headers and numbers": what the comparison sets aside, decided
 * against BOTH documents.
 *
 * The documents are diffed whole, every line in — aligned on their body
 * lines first ({@link alignAroundFurniture}). A line is then set aside only
 * when all of this holds:
 *
 * - the diff left it unmatched (a line matched to an equal line changes
 *   nothing, so it stays, as context);
 * - it is a running line of its own document (`running-lines.ts`: a page
 *   number that tracks the pages, or a line repeated at the page edges);
 * - an unmatched running line of the OTHER document has the same key — the
 *   same text, or the same page number's distance from its page — and is
 *   set aside with it, one for one: within the same run of changes first
 *   (a footer renumbered in place), else anywhere, but only between runs
 *   made of nothing but running lines (furniture a re-pagination moved);
 * - or, with no partner, it is a copy of a line running in BOTH files, in a
 *   run of nothing but running lines, on a file with more pages than the
 *   other — at most one copy per extra page (the head and the number of the
 *   page the other file does not have).
 *
 * So what goes is the same furniture on both sides: a running head that a
 * re-pagination moved, "Page 3 of 40" against "Page 3 of 41". A header that
 * differs between the files has no partner and is listed: a renamed party
 * in "Agreement between Acme and Beta", a changed account number, a figure
 * on a slide. A repeated line edited on one page leaves its old copy in a
 * run with the new text, which is no furniture, so the old value is listed
 * as removed beside the new one — even when another page repeats the old
 * value somewhere else.
 *
 * Until 2026-11-14 each document's running lines were dropped from it on
 * their own, before the diff (history kept): a header repeated on every page
 * of both files was dropped from both even when its words differed, and the
 * comparison said identical — seven ways, from a renamed party to a 2-page
 * letter's changed date (`furniture.test.ts`, "never hides a line whose
 * words differ"). Dropping one side's copies and not the other's turned an
 * edit into a bare addition and listed unchanged lines as added.
 */

/** One side's lines, as `diffWithFurniture` reads them. */
export interface KeyedLine {
  /** What the diff matches on: the text, case-folded under "ignore case". */
  key: string;
  page: number;
}

export interface FurnitureDiff {
  /** The edit script over the KEPT lines (indices into `keptLeft`/`keptRight`). */
  ops: Op[];
  /** Indices into the inputs of the lines kept, in order. */
  keptLeft: number[];
  keptRight: number[];
  /** How many lines were set aside from each side. */
  dropped: { left: number; right: number };
}

/**
 * The unmatched running lines to set aside, as two index sets. Within each
 * run of changes a line is paired with a same-key line of that run first, so
 * a footer changed in place goes with its own counterpart; what is left is
 * paired across the document, in order.
 */
export function furnitureToSetAside(
  ops: readonly Op[],
  leftRunning: ReadonlyMap<number, string>,
  rightRunning: ReadonlyMap<number, string>,
  extraPages: { left: number; right: number } = { left: 0, right: 0 },
): { left: Set<number>; right: Set<number> } {
  const left = new Set<number>();
  const right = new Set<number>();
  const restLeft = new Map<string, number[]>();
  const restRight = new Map<string, number[]>();
  const push = (pool: Map<string, number[]>, key: string, i: number) => {
    const list = pool.get(key);
    if (list) list.push(i);
    else pool.set(key, [i]);
  };

  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.k === "same") {
      i += 1;
      continue;
    }
    const removed = new Map<string, number[]>();
    const added: [string, number][] = [];
    // A run of nothing but running lines is furniture a re-pagination moved;
    // a run with anything else in it is an edit, and what is left of it
    // after same-key pairs is listed.
    let pure = true;
    for (; i < ops.length && ops[i]!.k !== "same"; i += 1) {
      const op = ops[i]!;
      const key =
        op.k === "removed"
          ? leftRunning.get(op.a)
          : op.k === "added"
            ? rightRunning.get(op.b)
            : undefined;
      if (key === undefined) pure = false;
      else if (op.k === "removed") push(removed, key, op.a);
      else if (op.k === "added") added.push([key, op.b]);
    }
    for (const [key, b] of added) {
      const partner = removed.get(key)?.shift();
      if (partner !== undefined) {
        left.add(partner);
        right.add(b);
      } else if (pure) push(restRight, key, b);
    }
    if (pure)
      for (const [key, list] of removed)
        for (const a of list) push(restLeft, key, a);
  }

  // Moved furniture, paired across the document by key, one for one.
  for (const [key, list] of restLeft) {
    const partners = restRight.get(key) ?? [];
    const n = Math.min(list.length, partners.length);
    for (let k = 0; k < n; k += 1) {
      left.add(list[k]!);
      right.add(partners[k]!);
    }
    list.splice(0, n);
    partners.splice(0, n);
  }
  // The furniture of the pages one file has and the other has not: a copy
  // of a line that is running in BOTH files, up to one per extra page.
  const surplus = (
    pool: Map<string, number[]>,
    otherRunning: ReadonlyMap<number, string>,
    allowance: number,
    into: Set<number>,
  ) => {
    if (allowance <= 0) return;
    const otherKeys = new Set(otherRunning.values());
    for (const [key, list] of pool)
      if (otherKeys.has(key))
        for (const at of list.slice(0, allowance)) into.add(at);
  };
  surplus(restLeft, rightRunning, extraPages.left, left);
  surplus(restRight, leftRunning, extraPages.right, right);
  return { left, right };
}

/**
 * The diff of two documents' lines, with page furniture set aside when
 * `ignoreFurniture` is on (see the module comment). With it off, every line
 * is kept and the script is the plain diff of the keys.
 */
export function diffWithFurniture(
  left: readonly KeyedLine[],
  right: readonly KeyedLine[],
  ignoreFurniture: boolean,
): FurnitureDiff {
  return drain(diffWithFurnitureSteps(left, right, ignoreFurniture));
}

/** {@link diffWithFurniture}, pausing between its diffs (`steps.ts`). */
export function* diffWithFurnitureSteps(
  left: readonly KeyedLine[],
  right: readonly KeyedLine[],
  ignoreFurniture: boolean,
): Steps<FurnitureDiff> {
  const ids = new Map<string, number>();
  const every = (n: number) => Array.from({ length: n }, (_, i) => i);
  if (!ignoreFurniture)
    return {
      ops: diffIds(
        intern(
          ids,
          left.map((l) => l.key),
        ),
        intern(
          ids,
          right.map((l) => l.key),
        ),
      ),
      keptLeft: every(left.length),
      keptRight: every(right.length),
      dropped: { left: 0, right: 0 },
    };

  const asText = (lines: readonly KeyedLine[]) =>
    lines.map((l) => ({ text: l.key, page: l.page }));
  const leftRunning = runningLines(asText(left));
  const rightRunning = runningLines(asText(right));
  yield;
  const pages = (lines: readonly KeyedLine[]) =>
    new Set(lines.map((l) => l.page)).size;
  const extra = pages(left) - pages(right);
  const all = yield* alignAroundFurnitureSteps(
    left,
    right,
    leftRunning,
    rightRunning,
    ids,
  );
  const aside = furnitureToSetAside(all, leftRunning, rightRunning, {
    left: Math.max(0, extra),
    right: Math.max(0, -extra),
  });
  const renumber = (n: number, gone: Set<number>) => {
    const kept: number[] = [];
    const at = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i += 1)
      if (!gone.has(i)) {
        at[i] = kept.length;
        kept.push(i);
      }
    return { kept, at };
  };
  const a = renumber(left.length, aside.left);
  const b = renumber(right.length, aside.right);
  const ops: Op[] = [];
  for (const op of all) {
    if (op.k === "same")
      ops.push({ k: "same", a: a.at[op.a]!, b: b.at[op.b]! });
    else if (op.k === "removed") {
      if (!aside.left.has(op.a)) ops.push({ k: "removed", a: a.at[op.a]! });
    } else if (!aside.right.has(op.b)) ops.push({ k: "added", b: b.at[op.b]! });
  }
  return {
    ops,
    keptLeft: a.kept,
    keptRight: b.kept,
    dropped: { left: aside.left.size, right: aside.right.size },
  };
}

/**
 * The diff of every line, aligned on the lines that are NOT running first.
 * The body is diffed alone, and only then is each gap between its matched
 * lines that holds a running line diffed again whole, furniture and all (a
 * gap with none is the body diff's own). Without that, a running head was
 * an equal candidate for the LCS: after a re-pagination it was matched in
 * place of the body line beside it, and that unmoved body line was listed
 * as removed and added (furniture.test.ts, "a re-paginated report").
 */
export function alignAroundFurniture(
  left: readonly KeyedLine[],
  right: readonly KeyedLine[],
  leftRunning: ReadonlyMap<number, string>,
  rightRunning: ReadonlyMap<number, string>,
): Op[] {
  return drain(
    alignAroundFurnitureSteps(left, right, leftRunning, rightRunning),
  );
}

function* alignAroundFurnitureSteps(
  left: readonly KeyedLine[],
  right: readonly KeyedLine[],
  leftRunning: ReadonlyMap<number, string>,
  rightRunning: ReadonlyMap<number, string>,
  ids: Map<string, number> = new Map(),
): Steps<Op[]> {
  const bodyOf = (
    lines: readonly KeyedLine[],
    running: ReadonlyMap<number, string>,
  ) => lines.flatMap((_, i) => (running.has(i) ? [] : [i]));
  const bodyLeft = bodyOf(left, leftRunning);
  const bodyRight = bodyOf(right, rightRunning);
  yield PAUSE;
  const body = diffIds(
    intern(
      ids,
      bodyLeft.map((i) => left[i]!.key),
    ),
    intern(
      ids,
      bodyRight.map((j) => right[j]!.key),
    ),
  );
  yield;
  const out: Op[] = [];
  let pi = 0;
  let pj = 0;
  // The body diff's changes since the last match, in original indices.
  let pending: Op[] = [];
  function* fill(iEnd: number, jEnd: number): Steps<void> {
    // A gap holds only body lines exactly when it is as long as the body
    // changes in it: then the body diff already is its diff.
    if (
      iEnd - pi === countSide(pending, "a") &&
      jEnd - pj === countSide(pending, "b")
    ) {
      for (const op of pending) out.push(op);
    } else {
      if ((iEnd - pi) * (jEnd - pj) > 1_000_000) yield PAUSE;
      const gap = diffIds(
        intern(
          ids,
          left.slice(pi, iEnd).map((l) => l.key),
        ),
        intern(
          ids,
          right.slice(pj, jEnd).map((l) => l.key),
        ),
      );
      for (const op of gap)
        out.push(
          op.k === "same"
            ? { k: "same", a: op.a + pi, b: op.b + pj }
            : op.k === "removed"
              ? { k: "removed", a: op.a + pi }
              : { k: "added", b: op.b + pj },
        );
      yield;
    }
    pending = [];
    pi = iEnd;
    pj = jEnd;
  }
  for (const op of body) {
    if (op.k === "removed") pending.push({ k: "removed", a: bodyLeft[op.a]! });
    else if (op.k === "added")
      pending.push({ k: "added", b: bodyRight[op.b]! });
    else {
      const i = bodyLeft[op.a]!;
      const j = bodyRight[op.b]!;
      yield* fill(i, j);
      out.push({ k: "same", a: i, b: j });
      pi = i + 1;
      pj = j + 1;
    }
  }
  yield* fill(left.length, right.length);
  return out;
}

/** How many of `ops` hold a line of side `a` (removed) or `b` (added). */
function countSide(ops: readonly Op[], side: "a" | "b"): number {
  let n = 0;
  for (const op of ops)
    if (side === "a" ? op.k === "removed" : op.k === "added") n += 1;
  return n;
}
