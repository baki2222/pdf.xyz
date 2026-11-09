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
 *  2. decides what goes: each annotation of a chosen group, its /Popup and
 *     any Popup whose parent goes, and any reply (/IRT, followed at most
 *     {@link MAX_REPLY_HOPS} hops) to one that goes. A signature field's
 *     widget never goes, whatever is chosen;
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
 *     so a kept page still renders;
 *  6. saves, re-opens the SAVED bytes and counts again: every number the
 *     result reports is the output's inventory against the input's, never
 *     the plan's.
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
}

export interface RemoveAnnotationsResult {
  bytes: Uint8Array;
  /** Input count minus output count, per group, read from the saved copy. */
  removed: GroupCounts;
  /** What the saved copy still has, per group. */
  kept: GroupCounts;
  removedTotal: number;
  keptTotal: number;
  /**
   * Replies whose chain could not be followed to its end (a cycle, or more
   * than {@link MAX_REPLY_HOPS} hops): kept, and counted here.
   */
  repliesKept: number;
  /** Signature fields in the saved copy. */
  signatureFieldsKept: number;
  /**
   * Files attached through a removed pin that the PDF also lists as an
   * attachment of its own (/Names /EmbeddedFiles), so they are still in the
   * copy — read from the copy.
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
    const kind =
      subtype instanceof PDFName
        ? subtype.decodeText()
        : page === null
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
  const xfa = readXfa(doc, lib);
  return {
    found,
    inventory: {
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
  const { inventory: before, found } = census(lib, doc);

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

  // 2. What goes.
  const goes = new Set<PDFDict>();
  for (const f of found.values()) {
    if (f.group !== null && !f.signature && chosen.has(f.group)) {
      goes.add(f.dict);
    }
  }
  // Replies to what goes go too; a chain that loops or runs too long is kept.
  let repliesKept = 0;
  const answers = (dict: PDFDict): "goes" | "kept" | "unknown" => {
    const seen = new Set<PDFDict>([dict]);
    let cur = dict;
    for (let hop = 0; hop < MAX_REPLY_HOPS; hop += 1) {
      const target = ctx.lookup(cur.get(name("IRT")));
      if (!(target instanceof PDFDict)) return "kept";
      if (goes.has(target)) return "goes";
      if (seen.has(target)) return "unknown";
      seen.add(target);
      cur = target;
    }
    return "unknown";
  };
  const replies: PDFDict[] = [];
  for (const f of found.values()) {
    if (goes.has(f.dict) || f.signature || f.group === null) continue;
    if (!f.dict.has(name("IRT"))) continue;
    const verdict = answers(f.dict);
    if (verdict === "goes") replies.push(f.dict);
    else if (verdict === "unknown") repliesKept += 1;
  }
  for (const dict of replies) goes.add(dict);

  // A pop-up goes with its parent, or, with comments chosen, when it has no
  // parent left on any page — unless an annotation that stays opens it.
  const keptPopups = new Set<PDFObject>();
  for (const f of found.values()) {
    if (f.group === null || goes.has(f.dict)) continue;
    const popup = ctx.lookup(f.dict.get(name("Popup")));
    if (popup instanceof PDFDict) keptPopups.add(popup);
  }
  for (const f of found.values()) {
    if (f.group !== null || keptPopups.has(f.dict)) continue;
    const parent = ctx.lookup(f.dict.get(name("Parent")));
    const orphan = !(parent instanceof PDFDict) || !found.has(parent);
    if (
      (parent instanceof PDFDict && goes.has(parent)) ||
      (orphan && chosen.has("comments"))
    ) {
      goes.add(f.dict);
    }
  }
  // Refs to cut: what goes, and the pop-up a removed one opens even when no
  // page lists it.
  const cut = new Set<PDFRef>();
  const refOf = new Map<PDFDict, PDFRef>();
  for (const f of found.values()) if (f.ref) refOf.set(f.dict, f.ref);
  for (const dict of goes) {
    const ref = refOf.get(dict);
    if (ref) cut.add(ref);
    const popup = dict.get(name("Popup"));
    if (popup instanceof PDFRef && !keptPopups.has(ctx.lookup(popup)!)) {
      cut.add(popup);
    }
  }
  // Attachments a removed pin carried, to ask the copy about afterwards.
  const pinnedFiles = new Set<string>();
  for (const dict of goes) {
    if (dict.get(name("Subtype")) !== name("FileAttachment")) continue;
    const fs = dict.get(name("FS"));
    if (fs instanceof PDFRef) pinnedFiles.add(fs.toString());
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
  // its page's /P are back-references, not uses; its /AP, /Popup and
  // /Parent (a pop-up's annotation, a widget's field) are uses.
  const BACK = new Set(["IRT", "P"].map((k) => name(k)));
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
      for (const [key, value] of o.entries()) {
        if (annot && BACK.has(key)) continue;
        queue.push(value);
      }
    } else if (o instanceof PDFArray) {
      queue.push(...o.asArray());
    } else if (o instanceof PDFStream) {
      queue.push(o.dict);
    }
  }
  for (const ref of [...cut]) if (used.has(ref.toString())) cut.delete(ref);
  pruneUnreachable(lib, doc, cut);

  stamp(doc);
  const out = await doc.save({ updateFieldAppearances: false });

  // 6. Count the copy.
  let saved: PDFDocument;
  try {
    saved = await lib.PDFDocument.load(out, { updateMetadata: false });
  } catch (err) {
    throw await pdfLoadError(err, out);
  }
  const after = census(lib, saved).inventory;
  const removed = emptyCounts();
  for (const g of ANNOTATION_GROUPS) {
    removed[g.id] = before.groups[g.id] - after.groups[g.id];
  }
  return {
    bytes: out,
    removed,
    kept: after.groups,
    removedTotal: before.total - after.total,
    keptTotal: after.total,
    repliesKept,
    signatureFieldsKept: after.signatureFields,
    attachmentsStillEmbedded: embeddedAmong(lib, saved, pinnedFiles),
    signed: before.signed || countDigitalSignatures(bytes) > 0,
    droppedXfa,
  };
}

/** How many of `refs` the document lists in /Names /EmbeddedFiles. */
function embeddedAmong(
  lib: PdfLibModule,
  doc: PDFDocument,
  refs: ReadonlySet<string>,
): number {
  if (refs.size === 0) return 0;
  const { PDFArray, PDFDict, PDFName, PDFRef } = lib;
  const ctx = doc.context;
  const listed = new Set<string>();
  const seen = new Set<PDFDict>();
  const walk = (node: PDFObject | undefined, depth: number) => {
    const dict = ctx.lookup(node);
    if (!(dict instanceof PDFDict) || seen.has(dict) || depth > 64) return;
    seen.add(dict);
    const pairs = dict.lookupMaybe(PDFName.of("Names"), PDFArray);
    for (let i = 1; pairs && i < pairs.size(); i += 2) {
      const v = pairs.get(i);
      if (v instanceof PDFRef) listed.add(v.toString());
    }
    const kids = dict.lookupMaybe(PDFName.of("Kids"), PDFArray);
    for (const kid of kids?.asArray() ?? []) walk(kid, depth + 1);
  };
  walk(
    doc.catalog
      .lookupMaybe(PDFName.of("Names"), PDFDict)
      ?.get(PDFName.of("EmbeddedFiles")),
    0,
  );
  let n = 0;
  for (const ref of refs) if (listed.has(ref)) n += 1;
  return n;
}
