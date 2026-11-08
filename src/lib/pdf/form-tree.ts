import type { PDFArray, PDFDict, PDFDocument, PDFObject } from "pdf-lib";
import { PdfEngineError, UNREADABLE_PDF_MESSAGE } from "./engine-errors";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Make a document's AcroForm field tree safe for pdf-lib's form API, which
 * walks it by plain recursion in BOTH directions: down `/Kids`
 * (`PDFAcroForm.getAllFields`) and up `/Parent` (`ascend`,
 * `getFullyQualifiedName`). A field whose `/Kids` names itself, or whose
 * `/Parent` climbs back into its own chain, recursed until the stack ran out,
 * and every form tool showed the user "Maximum call stack size exceeded"
 * (EDIT-02). pdf.js renders such a page, so the file is not refused: the edge
 * that closes the loop is cut and the rest of the form works.
 *
 *  - A `/Kids` entry that names a field already on the path from the root (a
 *    cycle), or a field the walk has already reached (a second parent, which
 *    the spec does not allow: `/Parent` names one), is removed. The second
 *    case is also what keeps a "diamond" tree — each level naming the next
 *    twice — from costing pdf-lib 2^levels visits.
 *  - A `/Parent` chain that returns to a field it has passed is cut: a field
 *    reached through a parent's `/Kids` is given that parent, and a root
 *    field loses the `/Parent` that closed the loop.
 *
 * A tree deeper than {@link MAX_FIELD_DEPTH} is refused with the loader's
 * unreadable-file message: pdf-lib's recursion overflows a default 1 MB stack
 * between 2,000 and 4,000 levels (measured), and no real form comes near.
 *
 * Mutates `doc` in memory only; a caller that saves keeps the repair. A tree
 * with no cycle, no shared field and normal depth is left exactly as it was.
 */
export function repairFieldTree(
  lib: Pick<PdfLibModule, "PDFArray" | "PDFDict" | "PDFName">,
  doc: PDFDocument,
): void {
  const { PDFArray: ArrayT, PDFDict: DictT, PDFName: Name } = lib;
  const acroForm = doc.catalog.lookup(Name.of("AcroForm"));
  if (!(acroForm instanceof DictT)) return;
  const roots = acroForm.lookup(Name.of("Fields"));
  if (!(roots instanceof ArrayT)) return;
  const KIDS = Name.of("Kids");
  const PARENT = Name.of("Parent");

  const tooDeep = () =>
    new PdfEngineError(UNREADABLE_PDF_MESSAGE, { kind: "unreadable" });

  // Down: an iterative depth-first walk. `seen` cuts both shapes: an
  // ancestor still open on the path (a cycle) was seen, and so was a field
  // another /Kids already named.
  // Each reached field remembers the field whose /Kids it came from, and the
  // entry (usually a ref) that names that field, to repair /Parent below.
  const reached: Reached[] = [];
  const seen = new Set<PDFDict>();
  // /Fields is walked twice: true roots first, then entries that name a
  // /Parent. A widget some producer lists in /Fields AND in its parent's
  // /Kids is then kept where its /Parent says it belongs, not as a root.
  const parented = (d: PDFDict) => d.lookup(PARENT) instanceof DictT;
  const stack: Frame[] = [
    { list: roots, at: 0, level: 0, only: parented },
    { list: roots, at: 0, level: 0, only: (d) => !parented(d) },
  ];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.at >= top.list.size()) {
      stack.pop();
      continue;
    }
    const entry = top.list.get(top.at);
    const kid = top.list.lookup(top.at);
    if (top.only && kid instanceof DictT && !top.only(kid)) {
      top.at += 1;
      continue;
    }
    if (kid instanceof DictT && seen.has(kid)) {
      top.list.remove(top.at);
      continue;
    }
    top.at += 1;
    if (!(kid instanceof DictT)) continue;
    seen.add(kid);
    reached.push({ node: kid, owner: top.owner });
    const kids = kid.lookup(KIDS);
    if (kids instanceof ArrayT) {
      if (top.level + 1 >= MAX_FIELD_DEPTH) throw tooDeep();
      const owner = { node: kid, entry };
      stack.push({ list: kids, owner, at: 0, level: top.level + 1 });
    }
  }

  // Up: each reached field's /Parent chain, remembering verified depths so a
  // whole tree costs one pass. A chain may leave the tree (an orphan parent).
  // A chain that loops is cut where it can be repaired best: a field reached
  // through a parent's /Kids gets that parent back (what a viewer and
  // pdf-lib's flatten expect); a root just loses the /Parent that closes it.
  const depth = new Map<PDFDict, number>();
  for (const { node: start, owner } of reached) {
    const chain: PDFDict[] = [];
    const inChain = new Set<PDFDict>();
    let node: PDFDict | undefined = start;
    let base = 0;
    let closing: PDFDict | undefined;
    while (node) {
      const known = depth.get(node);
      if (known !== undefined) {
        base = known;
        break;
      }
      chain.push(node);
      inChain.add(node);
      const parent: unknown = node.lookup(PARENT);
      if (!(parent instanceof DictT)) break;
      if (inChain.has(parent)) {
        closing = node;
        break;
      }
      node = parent;
    }
    if (closing && owner) {
      start.set(PARENT, owner.entry);
      const own = (depth.get(owner.node) ?? 0) + 1;
      if (own > MAX_FIELD_DEPTH) throw tooDeep();
      depth.set(start, own);
      continue;
    }
    closing?.delete(PARENT);
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      base += 1;
      if (base > MAX_FIELD_DEPTH) throw tooDeep();
      depth.set(chain[i]!, base);
    }
  }
}

interface Reached {
  node: PDFDict;
  owner?: { node: PDFDict; entry: PDFObject };
}

interface Frame {
  list: PDFArray;
  owner?: { node: PDFDict; entry: PDFObject };
  at: number;
  /** Depth of `owner` in the tree; the roots' list is level 0. */
  level: number;
  /** For the two passes over /Fields: which roots this pass walks. */
  only?: (field: PDFDict) => boolean;
}

/**
 * The deepest field tree accepted, counted in fields from a root to a leaf.
 * Real forms nest a handful of levels (an XFA-derived `form1[0].page1[0].
 * subform[0].field[0]` is 4); the legit corpus's deepest is pinned in the
 * test. pdf-lib's recursive walks overflow a default Node stack between 2,000
 * and 4,000 levels, so 256 leaves roughly 8x headroom below that even for a
 * smaller browser stack, and 256 levels work through every form entry point
 * (pinned in `edit02-field-cycles.test.ts`).
 */
export const MAX_FIELD_DEPTH = 256;
