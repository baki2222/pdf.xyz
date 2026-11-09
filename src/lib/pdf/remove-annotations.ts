import type { PDFDict, PDFDocument, PDFObject, PDFRef } from "pdf-lib";
import {
  ANNOT_HIDDEN,
  ANNOT_NO_VIEW,
  isDynamicXfa,
  readXfa,
} from "./annot-flags";
import {
  ANNOTATION_GROUPS,
  NO_ANNOTATIONS_MESSAGE,
  groupOfSubtype,
  type AnnotationGroupId,
} from "./annotation-groups";
import { countDigitalSignatures } from "./digital-signatures";
import { loadPdf, pdfLoadError, PdfEngineError, stamp } from "./engine";
import { MAX_FIELD_DEPTH, pruneFields } from "./field-prune";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { pruneUnreachable } from "./prune-unreachable";

/**
 * Remove Annotations — list a PDF's annotations by kind, and save a copy
 * without the kinds the reader chose.
 *
 * REMOVED, NOT HIDDEN. Taking an entry out of a page's /Annots is not
 * removing the annotation: pdf-lib's `save()` writes every object it parsed,
 * so the comment's text, its appearance stream, its pop-up and an attached
 * file's bytes would all still be in the file, readable by anyone who looks.
 * So a run:
 *
 *  1. sorts every annotation on every page (and every form field reached
 *     only from `/AcroForm /Fields`) into the groups of `annotation-groups.ts`;
 *  2. decides what goes, with {@link planRemoval} — the same function the
 *     panel runs to say how many will go: each annotation of a chosen
 *     group, and any reply (/IRT, followed at most {@link MAX_REPLY_HOPS}
 *     hops) to one that goes, on a page or not, whatever its group. Then
 *     pop-ups: one goes with the annotation it belongs to, found from
 *     either side (its /Parent, or a /Popup naming it). A signature
 *     field's widget never goes, whatever is chosen;
 *  3. gives each page that lost one a new direct /Annots array holding
 *     what it keeps. The old array is not edited; when nothing else lists
 *     it, step 5 drops it. Editing it in place would give the same file:
 *     every page sharing an array loses the same entries;
 *  4. with Form fields chosen, takes every non-signature field out of the
 *     field tree (`./field-prune`), deletes /AcroForm when nothing is left,
 *     and drops a hybrid form's XFA, which would otherwise bring the form
 *     back in readers that prefer it;
 *  5. CUTS what went (`pruneUnreachable`): dropped even if a structure-tree
 *     /OBJR, the /ParentTree or a reply still names it, with everything only
 *     it reaches — /Contents, /AP streams, the pop-up, the attached file.
 *     The one exception is an object that something KEPT still uses: a kept
 *     page's /Contents or /Resources, a kept annotation (its /AP, /Popup or
 *     /Parent), or a kept form field. That object is unlisted but not cut,
 *     so a kept page still renders. In a tagged PDF the structure tree's
 *     pointers to what is cut go too, and an element left empty loses its
 *     /Alt and /ActualText (`detachFromStructure`);
 *  6. saves, re-opens the SAVED bytes and counts again: every number the
 *     result reports is read from the output, never the plan — and an
 *     annotation is counted removed only when its object is ABSENT from
 *     the copy. One taken off every page that something kept still holds
 *     is reported as `stillInFile`, and a removed pin's file is judged by
 *     its embedded-file streams, not by which filespec names them.
 *
 * Bounded against hostile files: every walk keeps a seen-set, the reply
 * chain and the field tree stop at a fixed depth, and an annotation listed
 * many times (by one page or by several) is one annotation.
 * `remove-annotations.test.ts` proves the removal on the saved bytes with a
 * reader that parses objects and DECODES every stream, object streams
 * included.
 */

/** How many /IRT hops a reply is followed to the comment it answers. */
export const MAX_REPLY_HOPS = 64;

export { NO_ANNOTATIONS_MESSAGE, removedOutputName } from "./annotation-groups";

export type RemoveAnnotationsRefusalReason =
  "no-annotations" | "nothing-selected" | "dynamic-xfa" | "field-tree";

export const NOTHING_SELECTED_MESSAGE =
  "None of the kinds you ticked are in this PDF. Tick at least one kind it has.";

export const DYNAMIC_XFA_REMOVE_MESSAGE =
  "This is a dynamic XFA form: its fields exist only in a format browsers can't edit, and removing them here would leave just its placeholder page. Untick Form fields to remove the other annotations.";

export const FIELD_TREE_MESSAGE =
  "This PDF's form fields are nested too deeply to remove safely. Untick Form fields to remove the other annotations.";

/** A refusal made before anything in the document changed. */
export class RemoveAnnotationsRefusal extends PdfEngineError {
  readonly reason: RemoveAnnotationsRefusalReason;
  constructor(reason: RemoveAnnotationsRefusalReason, message: string) {
    super(message);
    this.name = "RemoveAnnotationsRefusal";
    this.reason = reason;
  }
}

export type GroupCounts = Record<AnnotationGroupId, number>;

export interface PageAnnotations {
  /** 1-based page number. */
  page: number;
  /** Annotations first listed on this page, by group (absent = none). */
  groups: Partial<GroupCounts>;
}

/**
 * One annotation as the plan sees it: what the closure (replies) needs, and
 * nothing of pdf-lib, so the panel can run {@link planRemoval} on the
 * inventory and show the run's own numbers before it runs.
 */
export interface AnnotationNode {
  /** `null` for a Popup. */
  group: AnnotationGroupId | null;
  /** 1-based page it is first listed on; `null` when on no page. */
  page: number | null;
  signature: boolean;
  /**
   * On a page or in the field tree, so counted. `false` for an annotation
   * reached only as a link in a reply chain (/IRT): it goes with the chain
   * but is in no count.
   */
  listed: boolean;
  /** Index of the node this one answers (/IRT); -1 for none. */
  irt: number;
}

export interface AnnotationInventory {
  /** Every annotation a group can remove, counted once. */
  total: number;
  groups: GroupCounts;
  /** Pages with any annotation, in order; each counted on its first page. */
  pages: PageAnnotations[];
  /** Form fields reached only from the form, on no page's list. */
  unplaced: number;
  /** Annotations a reader does not show (Hidden or NoView). */
  hidden: number;
  /** Signature fields: listed, never removed. */
  signatureFields: number;
  /** Whether any signature field holds a signature. */
  signed: boolean;
  xfa: boolean;
  dynamicXfa: boolean;
  /** The field tree goes deeper than the walk follows. */
  fieldTreeTooDeep: boolean;
  /** Every annotation and reply-chain link, for {@link planRemoval}. */
  annotations: readonly AnnotationNode[];
}

export interface PlannedPage {
  /** 1-based. */
  page: number;
  total: number;
  groups: Partial<GroupCounts>;
}

/** What a run with `chosen` removes, counted the way its result counts. */
export interface RemovalPlan {
  /** Per node of `inventory.annotations`: whether it goes. Popups excluded. */
  goes: readonly boolean[];
  total: number;
  groups: GroupCounts;
  /** Only pages something goes from, in order. */
  pages: PlannedPage[];
  /** Replies kept because their chain runs past {@link MAX_REPLY_HOPS}. */
  repliesUntraced: number;
}

/**
 * The run's closure, as one function the engine runs and the panel shows:
 * every listed annotation of a chosen group (never a signature field), and
 * every reply whose /IRT chain reaches one of those within
 * {@link MAX_REPLY_HOPS} hops, whatever group the reply is in — a reply to a
 * highlight is a Text annotation, so ticking only markup removes a comment.
 * A chain that closes on itself without reaching one is traced completely
 * and kept; only a chain past the hop limit is untraced.
 */
export function planRemoval(
  inventory: Pick<AnnotationInventory, "annotations">,
  chosen: ReadonlySet<AnnotationGroupId>,
): RemovalPlan {
  const nodes = inventory.annotations;
  const base = nodes.map(
    (n) => n.listed && n.group !== null && !n.signature && chosen.has(n.group),
  );
  const goes = [...base];
  let repliesUntraced = 0;
  nodes.forEach((n, i) => {
    if (base[i] || n.signature || n.group === null || n.irt < 0) return;
    const seen = new Set<number>([i]);
    let cur = i;
    for (let hop = 0; hop < MAX_REPLY_HOPS; hop += 1) {
      const target = nodes[cur]!.irt;
      if (target < 0 || seen.has(target)) return; // the chain ends: kept
      if (base[target]) {
        goes[i] = true;
        return;
      }
      seen.add(target);
      cur = target;
    }
    if (n.listed) repliesUntraced += 1;
  });
  const groups = emptyCounts();
  const perPage = new Map<number, PlannedPage>();
  nodes.forEach((n, i) => {
    if (!goes[i] || !n.listed || n.group === null) return;
    groups[n.group] += 1;
    if (n.page === null) return;
    const p = perPage.get(n.page) ?? { page: n.page, total: 0, groups: {} };
    p.total += 1;
    p.groups[n.group] = (p.groups[n.group] ?? 0) + 1;
    perPage.set(n.page, p);
  });
  return {
    goes,
    total: Object.values(groups).reduce((a, b) => a + b, 0),
    groups,
    pages: [...perPage.values()].sort((a, b) => a.page - b.page),
    repliesUntraced,
  };
}

export interface RemoveAnnotationsResult {
  bytes: Uint8Array;
  /**
   * Per group, read from the saved copy: the input's count, less what the
   * copy still lists, less what it no longer lists but still HOLDS
   * ({@link stillInFile}). Absent from the file, not merely off the page.
   */
  removed: GroupCounts;
  /** What the saved copy still lists, per group. */
  kept: GroupCounts;
  removedTotal: number;
  keptTotal: number;
  /**
   * Annotations taken off every page whose object is still in the saved
   * copy, because something kept refers to it (a kept annotation pointing at
   * it, say). Counted in neither `removed` nor `kept`.
   */
  stillInFile: number;
  /**
   * Replies whose chain runs past {@link MAX_REPLY_HOPS} hops before it
   * reaches anything: kept, and counted here.
   */
  repliesKept: number;
  /** Signature fields in the saved copy. */
  signatureFieldsKept: number;
  /**
   * Files attached through a removed pin whose bytes (the /EF embedded-file
   * streams) are still in the saved copy, because something else in the PDF
   * holds them: its own attachment list, an associated-file (/AF) entry, or
   * another filespec sharing the stream. Read from the copy.
   */
  attachmentsStillEmbedded: number;
  /** The input carried a digital signature, which the copy no longer verifies. */
  signed: boolean;
  /** A hybrid form's XFA layer was dropped with its fields. */
  droppedXfa: boolean;
}

function emptyCounts(): GroupCounts {
  return Object.fromEntries(
    ANNOTATION_GROUPS.map((g) => [g.id, 0]),
  ) as GroupCounts;
}

interface Found {
  dict: PDFDict;
  ref: PDFRef | undefined;
  /** `null` for a Popup. */
  group: AnnotationGroupId | null;
  signature: boolean;
  /** 0-based page it is first listed on; `null` for an unplaced field. */
  page: number | null;
}

interface Census {
  inventory: AnnotationInventory;
  found: Map<PDFDict, Found>;
  /** Parallel to `inventory.annotations`. */
  dicts: PDFDict[];
  refs: (PDFRef | undefined)[];
}

/** Sort every annotation and unplaced field of `doc`. Reads, never writes. */
function census(lib: PdfLibModule, doc: PDFDocument): Census {
  const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef } = lib;
  const ctx = doc.context;
  const name = (n: string) => PDFName.of(n);
  const found = new Map<PDFDict, Found>();

  /** /FT, inherited up the /Parent chain — bounded and cycle-safe. */
  const fieldType = (dict: PDFDict): PDFObject | undefined => {
    const seen = new Set<PDFDict>();
    for (let d: unknown = dict, i = 0; i <= MAX_FIELD_DEPTH; i += 1) {
      if (!(d instanceof PDFDict) || seen.has(d)) return undefined;
      seen.add(d);
      const ft = d.get(name("FT"));
      if (ft) return ft;
      d = ctx.lookup(d.get(name("Parent")));
    }
    return undefined;
  };

  const record = (entry: PDFObject, page: number | null) => {
    const dict = ctx.lookup(entry);
    if (!(dict instanceof PDFDict) || found.has(dict)) return;
    const subtype = dict.get(name("Subtype"));
    // /Subtype is required, but a field's widget written without it is still
    // a field — and a signature field's must never be sorted into a group
    // that removes it.
    const kind =
      subtype instanceof PDFName
        ? subtype.decodeText()
        : page === null || fieldType(dict) !== undefined
          ? "Widget"
          : undefined;
    const group = groupOfSubtype(kind);
    const signature =
      group === "form-fields" && fieldType(dict) === name("Sig");
    found.set(dict, {
      dict,
      ref: entry instanceof PDFRef ? entry : undefined,
      group,
      signature,
      page,
    });
  };

  doc.getPages().forEach((page, index) => {
    const annots = page.node.lookup(name("Annots"));
    if (!(annots instanceof PDFArray)) return;
    for (const entry of annots.asArray()) record(entry, index);
  });

  // The field tree: a terminal field on no page's list is still a field.
  let fieldCount = 0;
  let fieldTreeTooDeep = false;
  const fieldSeen = new Set<PDFDict>();
  const walkFields = (entries: PDFObject | undefined, depth: number) => {
    const arr = ctx.lookup(entries);
    if (!(arr instanceof PDFArray)) return;
    if (depth > MAX_FIELD_DEPTH) {
      fieldTreeTooDeep = true;
      return;
    }
    for (const entry of arr.asArray()) {
      const dict = ctx.lookup(entry);
      if (!(dict instanceof PDFDict) || fieldSeen.has(dict)) continue;
      fieldSeen.add(dict);
      const kids = dict.lookupMaybe(name("Kids"), PDFArray);
      if (kids && kids.size() > 0) {
        if (dict.has(name("T"))) fieldCount += 1;
        walkFields(kids, depth + 1);
      } else {
        if (dict.has(name("T"))) fieldCount += 1;
        record(entry, null);
      }
    }
  };
  const acroForm = doc.catalog.lookupMaybe(name("AcroForm"), PDFDict);
  walkFields(acroForm?.get(name("Fields")), 0);

  const groups = emptyCounts();
  const perPage = new Map<number, Partial<GroupCounts>>();
  let unplaced = 0;
  let hidden = 0;
  let signatureFields = 0;
  let signed = false;
  for (const f of found.values()) {
    if (f.signature) {
      signatureFields += 1;
      if (ctx.lookup(f.dict.get(name("V"))) instanceof PDFDict) signed = true;
      else {
        // A widget's value lives on its field, which may be its parent.
        const parent = ctx.lookup(f.dict.get(name("Parent")));
        if (
          parent instanceof PDFDict &&
          ctx.lookup(parent.get(name("V"))) instanceof PDFDict
        ) {
          signed = true;
        }
      }
      continue;
    }
    if (f.group === null) continue;
    groups[f.group] += 1;
    if (f.page === null) unplaced += 1;
    else {
      const counts = perPage.get(f.page) ?? {};
      counts[f.group] = (counts[f.group] ?? 0) + 1;
      perPage.set(f.page, counts);
    }
    const flags = ctx.lookup(f.dict.get(name("F")));
    if (
      flags instanceof PDFNumber &&
      (flags.asNumber() & (ANNOT_HIDDEN | ANNOT_NO_VIEW)) !== 0
    ) {
      hidden += 1;
    }
  }
  // The plan's nodes: every annotation found, then every dictionary that
  // answers another (/IRT) or is answered, wherever it is — a reply no page
  // lists still goes with the note it answers, and a listed reply's chain
  // can run through one.
  const nodes: AnnotationNode[] = [];
  const dicts: PDFDict[] = [];
  const refs: (PDFRef | undefined)[] = [];
  const index = new Map<PDFDict, number>();
  const node = (
    dict: PDFDict,
    ref: PDFRef | undefined,
    n: Omit<AnnotationNode, "irt">,
  ) => {
    index.set(dict, nodes.length);
    nodes.push({ ...n, irt: -1 });
    dicts.push(dict);
    refs.push(ref);
  };
  for (const f of found.values()) {
    node(f.dict, f.ref, {
      group: f.group,
      page: f.page === null ? null : f.page + 1,
      signature: f.signature,
      listed: true,
    });
  }
  const unlisted = (dict: PDFDict, ref: PDFRef | undefined) => {
    const subtype = dict.get(name("Subtype"));
    node(dict, ref, {
      group: groupOfSubtype(
        subtype instanceof PDFName ? subtype.decodeText() : undefined,
      ),
      page: null,
      signature: false,
      listed: false,
    });
  };
  const IRT = name("IRT");
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.has(IRT) && !index.has(obj)) {
      unlisted(obj, ref);
    }
  }
  for (let i = 0; i < nodes.length; i += 1) {
    const raw = dicts[i]!.get(IRT);
    const target = ctx.lookup(raw);
    if (!(target instanceof PDFDict)) continue;
    if (!index.has(target)) {
      unlisted(target, raw instanceof PDFRef ? raw : undefined);
    }
    nodes[i]!.irt = index.get(target)!;
  }

  const xfa = readXfa(doc, lib);
  return {
    found,
    dicts,
    refs,
    inventory: {
      annotations: nodes,
      total: Object.values(groups).reduce((a, b) => a + b, 0),
      groups,
      pages: [...perPage.entries()]
        .sort(([a], [b]) => a - b)
        .map(([page, counts]) => ({ page: page + 1, groups: counts })),
      unplaced,
      hidden,
      signatureFields,
      signed,
      xfa: xfa.xfa,
      dynamicXfa: isDynamicXfa(xfa, fieldCount),
      fieldTreeTooDeep,
    },
  };
}

/** List a PDF's annotations by group, without changing anything. */
export async function inventoryAnnotations(
  bytes: Uint8Array,
): Promise<AnnotationInventory> {
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  return census(lib, doc).inventory;
}

/** The same count, of a document already open (tests read outputs with it). */
export function inventoryDoc(
  lib: PdfLibModule,
  doc: PDFDocument,
): AnnotationInventory {
  return census(lib, doc).inventory;
}

/**
 * Save a copy of `bytes` without the annotations of the chosen groups. Every
 * refusal is thrown before the document is changed.
 */
export async function removeAnnotations(
  bytes: Uint8Array,
  chosen: ReadonlySet<AnnotationGroupId>,
): Promise<RemoveAnnotationsResult> {
  const lib = await loadPdfLib();
  const { PDFArray, PDFDict, PDFName, PDFRef, PDFStream } = lib;
  const doc = await loadPdf(bytes);
  const ctx = doc.context;
  const name = (n: string) => PDFName.of(n);
  const { inventory: before, found, dicts, refs } = census(lib, doc);

  if (before.total === 0) {
    throw new RemoveAnnotationsRefusal(
      "no-annotations",
      NO_ANNOTATIONS_MESSAGE,
    );
  }
  if (!ANNOTATION_GROUPS.some((g) => chosen.has(g.id) && before.groups[g.id])) {
    throw new RemoveAnnotationsRefusal(
      "nothing-selected",
      NOTHING_SELECTED_MESSAGE,
    );
  }
  const fields = chosen.has("form-fields") && before.groups["form-fields"] > 0;
  if (fields && before.dynamicXfa) {
    throw new RemoveAnnotationsRefusal(
      "dynamic-xfa",
      DYNAMIC_XFA_REMOVE_MESSAGE,
    );
  }
  if (fields && before.fieldTreeTooDeep) {
    throw new RemoveAnnotationsRefusal("field-tree", FIELD_TREE_MESSAGE);
  }

  // 2. What goes: the plan the panel showed, one function for both.
  const plan = planRemoval(before, chosen);
  const repliesKept = plan.repliesUntraced;
  const goes = new Set<PDFDict>();
  plan.goes.forEach((g, i) => {
    if (g) goes.add(dicts[i]!);
  });

  // A pop-up goes with the annotation it belongs to — found from EITHER
  // side: its /Parent (optional on a Popup), or an annotation whose /Popup
  // names it — or, with comments chosen, when no annotation on any page
  // owns it; unless an annotation that stays opens it.
  const keptPopups = new Set<PDFDict>();
  const openedByGone = new Set<PDFDict>();
  const opened = new Set<PDFDict>();
  before.annotations.forEach((n, i) => {
    if (n.group === null) return;
    const popup = ctx.lookup(dicts[i]!.get(name("Popup")));
    if (!(popup instanceof PDFDict)) return;
    if (n.listed) opened.add(popup);
    if (goes.has(dicts[i]!)) openedByGone.add(popup);
    else if (n.listed) keptPopups.add(popup);
  });
  for (const f of found.values()) {
    if (f.group !== null || keptPopups.has(f.dict)) continue;
    const parent = ctx.lookup(f.dict.get(name("Parent")));
    const owned =
      (parent instanceof PDFDict && found.has(parent)) || opened.has(f.dict);
    if (
      (parent instanceof PDFDict && goes.has(parent)) ||
      openedByGone.has(f.dict) ||
      (!owned && chosen.has("comments"))
    ) {
      goes.add(f.dict);
    }
  }
  // Refs to cut: what goes (a reply no page lists included), and the pop-up
  // a removed one opens even when no page lists it.
  const cut = new Set<PDFRef>();
  const refOf = new Map<PDFDict, PDFRef>();
  dicts.forEach((dict, i) => {
    const ref = refs[i];
    if (ref) refOf.set(dict, ref);
  });
  for (const dict of goes) {
    const ref = refOf.get(dict);
    if (ref) cut.add(ref);
    const popup = dict.get(name("Popup"));
    const target = ctx.lookup(popup);
    if (
      popup instanceof PDFRef &&
      !(target instanceof PDFDict && keptPopups.has(target))
    ) {
      cut.add(popup);
    }
  }
  // The files a removed pin carried: the embedded-file STREAMS its filespec
  // (indirect or direct) names under /EF, asked about in the copy later. A
  // filespec object is not the file: another filespec can share the stream.
  const pinnedFiles: string[][] = [];
  for (const dict of goes) {
    if (dict.get(name("Subtype")) !== name("FileAttachment")) continue;
    const fs = ctx.lookup(dict.get(name("FS")));
    const ef = fs instanceof PDFDict ? ctx.lookup(fs.get(name("EF"))) : null;
    if (!(ef instanceof PDFDict)) continue;
    const streams = ef
      .values()
      .filter((v): v is PDFRef => v instanceof PDFRef)
      .map((r) => r.toString());
    if (streams.length) pinnedFiles.push(streams);
  }

  // 3. Each page that lost one gets a new direct array.
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(name("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    const entries = annots.asArray();
    const keep = entries.filter((entry) => {
      const dict = ctx.lookup(entry);
      return !(dict instanceof PDFDict && goes.has(dict));
    });
    if (keep.length === entries.length) continue;
    if (keep.length === 0) page.node.delete(name("Annots"));
    else page.node.set(name("Annots"), ctx.obj(keep));
  }

  // 4. The form.
  let droppedXfa = false;
  if (fields) {
    const pruned = pruneFields(lib, doc, () => true, { keepSignatures: true });
    for (const entry of pruned.removed) {
      if (entry instanceof PDFRef) cut.add(entry);
    }
    const acroForm = doc.catalog.lookupMaybe(name("AcroForm"), PDFDict);
    if (acroForm) {
      if (acroForm.has(name("XFA"))) {
        acroForm.delete(name("XFA"));
        doc.catalog.delete(name("NeedsRendering"));
        droppedXfa = true;
      }
      const left = acroForm.lookupMaybe(name("Fields"), PDFArray);
      if (!left || left.size() === 0) doc.catalog.delete(name("AcroForm"));
    }
  }

  // 5. Spare what something kept still uses, then cut the rest.
  const used = new Set<string>();
  const queue: PDFObject[] = [];
  for (const page of doc.getPages()) {
    for (const key of ["Contents", "Resources"]) {
      const value = page.node.get(name(key));
      if (value) queue.push(value);
    }
    const inherited = page.node.Resources();
    if (inherited) queue.push(inherited);
    const annots = page.node.lookup(name("Annots"));
    if (annots instanceof PDFArray) queue.push(...annots.asArray());
  }
  const form = doc.catalog.get(name("AcroForm"));
  if (form) queue.push(form);
  // A page reached from a kept object (a link's destination) is walked as
  // one of the pages above already. On an annotation, a reply's /IRT and
  // its page's /P are back-references, not uses, and so is a POP-UP's
  // /Parent: the pop-up belongs to its annotation, not the other way round,
  // so a pop-up a kept highlight opens must not keep a removed note alive.
  // An annotation's /AP and /Popup, and a widget's /Parent (its field), are
  // uses.
  const BACK = new Set(["IRT", "P"].map((k) => name(k)));
  const PARENT = name("Parent");
  const POPUP = name("Popup");
  const SUBTYPE = name("Subtype");
  const TYPE = name("Type");
  while (queue.length) {
    const o = queue.pop()!;
    if (o instanceof PDFRef) {
      const k = o.toString();
      if (used.has(k)) continue;
      used.add(k);
      const v = ctx.lookup(o);
      if (v) queue.push(v);
    } else if (o instanceof PDFDict) {
      const type = o.get(TYPE);
      if (type === name("Page") || type === name("Pages")) continue;
      const annot = o.has(name("Rect"));
      const popup = annot && o.get(SUBTYPE) === POPUP;
      for (const [key, value] of o.entries()) {
        if (annot && BACK.has(key)) continue;
        if (popup && key === PARENT) continue;
        queue.push(value);
      }
    } else if (o instanceof PDFArray) {
      queue.push(...o.asArray());
    } else if (o instanceof PDFStream) {
      queue.push(o.dict);
    }
  }
  for (const ref of [...cut]) if (used.has(ref.toString())) cut.delete(ref);
  detachFromStructure(lib, doc, new Set([...cut].map((r) => r.toString())));
  pruneUnreachable(lib, doc, cut);

  stamp(doc);
  const out = await doc.save({ updateFieldAppearances: false });

  // 6. Count the copy. pdf-lib keeps object numbers on save, so an object
  // is asked about in the copy by its number.
  let saved: PDFDocument;
  try {
    saved = await lib.PDFDocument.load(out, { updateMetadata: false });
  } catch (err) {
    throw await pdfLoadError(err, out);
  }
  const afterCensus = census(lib, saved);
  const after = afterCensus.inventory;
  const inCopy = new Set(
    saved.context.enumerateIndirectObjects().map(([r]) => r.toString()),
  );
  const listedInCopy = new Set(
    afterCensus.refs.flatMap((r, i) =>
      r && after.annotations[i]!.listed ? [r.toString()] : [],
    ),
  );
  // Off every page, yet still in the file: not removed, and said so.
  const stillThere = emptyCounts();
  before.annotations.forEach((n, i) => {
    const ref = refs[i]?.toString();
    if (!n.listed || n.group === null || n.signature || !ref) return;
    if (goes.has(dicts[i]!) && inCopy.has(ref) && !listedInCopy.has(ref)) {
      stillThere[n.group] += 1;
    }
  });
  const removed = emptyCounts();
  for (const g of ANNOTATION_GROUPS) {
    removed[g.id] = before.groups[g.id] - after.groups[g.id] - stillThere[g.id];
  }
  const stillInFile = Object.values(stillThere).reduce((a, b) => a + b, 0);
  // A pin's file is still in the copy when any of its streams is.
  const filesLeft = new Set<string>();
  for (const streams of pinnedFiles) {
    const left = streams.find((s) => inCopy.has(s));
    if (left) filesLeft.add(left);
  }
  return {
    bytes: out,
    removed,
    kept: after.groups,
    removedTotal: before.total - after.total - stillInFile,
    keptTotal: after.total,
    stillInFile,
    repliesKept,
    signatureFieldsKept: after.signatureFields,
    attachmentsStillEmbedded: filesLeft.size,
    signed: before.signed || countDigitalSignatures(bytes) > 0,
    droppedXfa,
  };
}

/**
 * In a tagged PDF, take every pointer (an /OBJR in some element's /K) to a
 * cut annotation out of the structure tree, and, from an element left with
 * no content at all, its text: /Alt, /ActualText, /T and /E. A tagging
 * producer often copies a note's text into its element's /Alt, so cutting
 * the annotation alone left that text in the file. An element that still
 * holds page content (a Link element's marked text, say) keeps its text,
 * which describes that content. Bounded by a seen-set; nothing is added.
 */
function detachFromStructure(
  lib: PdfLibModule,
  doc: PDFDocument,
  gone: ReadonlySet<string>,
): void {
  if (gone.size === 0) return;
  const { PDFArray, PDFDict, PDFName, PDFRef } = lib;
  const ctx = doc.context;
  const K = PDFName.of("K");
  const OBJ = PDFName.of("Obj");
  const TEXT = ["Alt", "ActualText", "T", "E"].map((k) => PDFName.of(k));
  const root = doc.catalog.lookup(PDFName.of("StructTreeRoot"));
  if (!(root instanceof PDFDict)) return;
  const pointsAtGone = (kid: PDFObject): boolean => {
    const d = ctx.lookup(kid);
    if (!(d instanceof PDFDict)) return false;
    const obj = d.get(OBJ);
    return obj instanceof PDFRef && gone.has(obj.toString());
  };
  const seen = new Set<PDFDict>();
  const stack: PDFDict[] = [root];
  while (stack.length) {
    const elem = stack.pop()!;
    if (seen.has(elem)) continue;
    seen.add(elem);
    const k = elem.get(K);
    if (k === undefined) continue;
    const value = ctx.lookup(k);
    let kids: PDFObject[];
    let emptied = false;
    if (value instanceof PDFArray) {
      kids = value.asArray();
      const left = kids.filter((kid) => !pointsAtGone(kid));
      if (left.length !== kids.length) {
        // A new direct array: the old one may be shared.
        if (left.length === 0) {
          elem.delete(K);
          emptied = true;
        } else elem.set(K, ctx.obj(left));
        kids = left;
      }
    } else if (pointsAtGone(k)) {
      elem.delete(K);
      emptied = true;
      kids = [];
    } else {
      kids = [k];
    }
    if (emptied && elem !== root) for (const key of TEXT) elem.delete(key);
    for (const kid of kids) {
      const d = ctx.lookup(kid);
      if (d instanceof PDFDict) stack.push(d);
    }
  }
}
