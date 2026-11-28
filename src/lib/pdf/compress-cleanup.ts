/**
 * What Compress PDF's lossless repack drops (audit compress-pdf#6,
 * 2026-11-08): only what no page can show.
 *
 *  - Embedded page thumbnails (`/Thumb` on a page). A viewer draws its page
 *    previews from the page itself; the embedded picture is a second copy.
 *  - Objects nothing in the file refers to. pdf-lib's save writes every
 *    indirect object it parsed, so a file edited by appending (old object
 *    versions), or one whose object streams were unpacked on the way in,
 *    kept carrying them. Reachability is walked from the trailer — the
 *    catalog, the document info and the ID — through every dictionary,
 *    array and stream dictionary; anything not reached is not part of the
 *    document a reader can open.
 *
 * Not dropped by the repack itself: embedded attachments, bookmarks, form
 * fields, annotations and metadata. Those are content someone may want.
 * Attachments, metadata and comments can be removed with the person's say-so:
 * the opt-in "Remove extras" checkboxes below (`removeExtras`, 2026-11-22).
 * Bookmarks and form fields are never removed.
 *
 * pdf-lib's classes come from the caller's lazily loaded module (`lib`), so
 * this leaf adds no static import of the engine to whoever imports it.
 */
import type { PDFDict, PDFDocument, PDFObject, PDFRef } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

export interface RepackRemoved {
  /** Page `/Thumb` entries removed. */
  thumbnails: number;
  /** Indirect objects removed because nothing reached them. */
  unreferenced: number;
}

/** The page's sentence for the cleanup (the content test pins it there). */
export const REPACK_CLEANUP_SENTENCE =
  "The repack also drops objects nothing in the file refers to, and embedded page thumbnails, which a viewer can draw from the page itself; neither changes how a page looks.";

/** The panel's line for one run; `null` when nothing was removed. */
export function removedLine(removed: RepackRemoved): string | null {
  const parts: string[] = [];
  if (removed.unreferenced > 0) {
    parts.push(
      `${removed.unreferenced} unused object${removed.unreferenced === 1 ? "" : "s"}`,
    );
  }
  if (removed.thumbnails > 0) {
    parts.push(
      `${removed.thumbnails} page thumbnail${removed.thumbnails === 1 ? "" : "s"}`,
    );
  }
  return parts.length === 0
    ? null
    : `The repack also dropped ${parts.join(" and ")}.`;
}

/**
 * Remove page thumbnails, then every indirect object the trailer cannot
 * reach. Call after the last change to the document (the producer stamp),
 * right before `save`, so nothing written after it is mistaken for an orphan.
 */
export function dropUnseen(lib: PdfLibModule, doc: PDFDocument): RepackRemoved {
  const { PDFArray, PDFDict, PDFName, PDFRef, PDFStream } = lib;
  const THUMB = PDFName.of("Thumb");
  let thumbnails = 0;
  const thumbValues: PDFObject[] = [];
  for (const page of doc.getPages()) {
    const thumb = page.node.get(THUMB);
    if (thumb) {
      thumbValues.push(thumb);
      page.node.delete(THUMB);
      thumbnails += 1;
    }
  }

  const ctx = doc.context;
  /** Every indirect object reachable from `roots`, skipping those in `stop`. */
  const walk = (roots: PDFObject[], stop: Set<string>): Set<string> => {
    const reached = new Set<string>();
    const stack = [...roots];
    while (stack.length > 0) {
      const obj = stack.pop()!;
      if (obj instanceof PDFRef) {
        const key = obj.toString();
        if (reached.has(key) || stop.has(key)) continue;
        reached.add(key);
        const target = ctx.lookup(obj);
        if (target) stack.push(target);
      } else if (obj instanceof PDFStream) {
        stack.push(obj.dict);
      } else if (obj instanceof PDFDict) {
        for (const [, value] of obj.entries()) stack.push(value);
      } else if (obj instanceof PDFArray) {
        for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
      }
    }
    return reached;
  };
  const t = ctx.trailerInfo;
  const reached = walk(
    [t.Root, t.Info, t.Encrypt, t.ID].filter((r): r is PDFObject => !!r),
    new Set(),
  );
  // What the removed thumbnails alone held (the image stream, an indirect
  // colour space and its lookup): dropped below, but counted as the
  // thumbnail, not again as "unused". Until the review of 36048d58 every
  // thumbnail's stream was counted twice.
  const ofThumbnails = walk(thumbValues, reached);

  let unreferenced = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    const key = ref.toString();
    if (!reached.has(key)) {
      ctx.delete(ref);
      if (!ofThumbnails.has(key)) unreferenced += 1;
    }
  }
  return { thumbnails, unreferenced };
}

/**
 * THE EXTRAS, BY THE PERSON'S SAY-SO (audit compress-pdf#6, 2026-11-22). The
 * repack above drops only what no page shows; these three are content someone
 * may want, so each is a checkbox in the browser pass, OFF by default, and each
 * removes exactly what its label names. `compress-extras.test.ts` decodes the
 * output for every option and for the all-off control.
 */
export interface CleanupExtras {
  /**
   * Files attached to the PDF: the document's EmbeddedFiles, and files
   * attached to a page with the paperclip (FileAttachment annotations).
   */
  attachments: boolean;
  /** The document's title, author and other details (Info and XMP). */
  metadata: boolean;
  /** Comments, sticky notes, highlights and other annotations, except links and form fields. */
  comments: boolean;
}

export const NO_EXTRAS: CleanupExtras = {
  attachments: false,
  metadata: false,
  comments: false,
};

/**
 * The checkboxes, in the order the panel draws them: a list, so the panel maps
 * over it and the tick-label guard reads the labels it renders.
 */
export const CLEANUP_EXTRA_OPTIONS: readonly {
  key: keyof CleanupExtras;
  label: string;
  hint: string;
}[] = [
  {
    key: "attachments",
    label: "Remove attached files",
    hint: "Removes files attached inside the PDF, such as a spreadsheet sent along with a report, including files pinned to a page with a paperclip.",
  },
  {
    key: "metadata",
    label: "Remove document details",
    hint: "Removes the title, author, subject, keywords and dates stored in the file, including its XMP metadata.",
  },
  {
    key: "comments",
    label: "Remove comments",
    hint: "Removes comments, sticky notes, highlights and drawings added on top of pages. Links and form fields stay.",
  },
];

/**
 * What the extras removed in one run, counted in the saved file
 * (`settleExtras`): an attached file or a comment that something else in the
 * PDF still holds is not removed, and is counted in `…Left` instead.
 */
export interface ExtrasRemoved {
  attachments: number;
  /** Attached files the person asked to remove that are still in the file. */
  attachmentsLeft: number;
  metadata: boolean;
  comments: number;
  /** Comments the person asked to remove that are still in the file. */
  commentsLeft: number;
}

export const NOTHING_EXTRA_REMOVED: ExtrasRemoved = {
  attachments: 0,
  attachmentsLeft: 0,
  metadata: false,
  comments: 0,
  commentsLeft: 0,
};

/** True when the run removed anything the person asked to remove. */
export function removedAnyExtra(removed: ExtrasRemoved): boolean {
  return removed.attachments > 0 || removed.metadata || removed.comments > 0;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What each option looks for, named for the "none were found" sentence. */
const NOTHING_FOUND_NAMES: Record<keyof CleanupExtras, string> = {
  attachments: "attached files",
  metadata: "document details",
  comments: "comments",
};

const joinList = (parts: string[], word: string) =>
  parts.length === 1
    ? parts[0]!
    : `${parts.slice(0, -1).join(", ")} ${word} ${parts.at(-1)!}`;

/**
 * The panel's line for what the ticked options removed, with what that saved
 * when it is known (`savedBytes`, the cleaned file against the same pass with
 * every option off), and, for each ticked option (`asked`) that found nothing,
 * a sentence saying so (review of 7b498d92: a ticked box that silently removed
 * nothing read as success). `null` when nothing was asked and nothing removed.
 */
export function extrasLine(
  removed: ExtrasRemoved,
  savedBytes?: number,
  asked: CleanupExtras = NO_EXTRAS,
): string | null {
  // Something left in the file was found too: it is not "none were found".
  const found: Record<keyof CleanupExtras, boolean> = {
    attachments: removed.attachments + removed.attachmentsLeft > 0,
    metadata: removed.metadata,
    comments: removed.comments + removed.commentsLeft > 0,
  };
  const missing = CLEANUP_EXTRA_OPTIONS.filter(
    (o) => asked[o.key] && !found[o.key],
  ).map((o) => NOTHING_FOUND_NAMES[o.key]);
  const none =
    missing.length === 0
      ? null
      : `No ${joinList(missing, "or")} were found, so none were removed.`;
  const sentences = [
    removedSentence(removed, savedBytes),
    leftSentence(removed),
    none,
  ].filter((s): s is string => s !== null);
  return sentences.length === 0 ? null : sentences.join(" ");
}

/** What the person asked to remove that is still in the saved file. */
function leftSentence(removed: ExtrasRemoved): string | null {
  const parts: string[] = [];
  if (removed.attachmentsLeft > 0)
    parts.push(plural(removed.attachmentsLeft, "attached file"));
  if (removed.commentsLeft > 0)
    parts.push(plural(removed.commentsLeft, "comment"));
  if (parts.length === 0) return null;
  const one = removed.attachmentsLeft + removed.commentsLeft === 1;
  return `${joinList(parts, "and")} could not be removed and ${one ? "is" : "are"} still in the file.`;
}

function removedSentence(
  removed: ExtrasRemoved,
  savedBytes?: number,
): string | null {
  const parts: string[] = [];
  if (removed.attachments > 0)
    parts.push(plural(removed.attachments, "attached file"));
  if (removed.metadata) parts.push("the document's metadata");
  if (removed.comments > 0) parts.push(plural(removed.comments, "comment"));
  if (parts.length === 0) return null;
  const list = joinList(parts, "and");
  const saved =
    savedBytes !== undefined && savedBytes > 0
      ? ` That saved ${formatKb(savedBytes)}.`
      : "";
  return `Removed ${list}.${saved}`;
}

/** Whole KB (1 KB = 1,024 bytes), the unit every size on the site uses. */
function formatKb(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Annotation kinds the comments option keeps: they are not comments. A
 * paperclip (`/FileAttachment`) is an attached file, so it is the attachments
 * option's to remove, and counted there.
 */
const KEPT_ANNOTS = new Set(["/Link", "/Widget", "/FileAttachment"]);
const FILE_ATTACHMENT = "/FileAttachment";

/**
 * What `removeExtras` took off, before the sweep: its counts, and what each
 * removed thing was, so `settleExtras` can tell, after the sweep, whether it
 * really left the file.
 */
export interface PendingExtras {
  counted: ExtrasRemoved;
  /** Per attached file counted, the embedded file streams it carried. */
  attachmentStreams: PDFRef[][];
  /** Each removed comment that is an indirect object. */
  commentRefs: PDFRef[];
}

/**
 * Remove what the person ticked. Call before `dropUnseen`, which then sweeps
 * the objects these removals left unreferenced (the attached bytes, the XMP
 * stream, a note's popup), and after the producer stamp, so that removing
 * the metadata removes the stamp too. Then call `settleExtras`, which counts
 * what actually left.
 *
 * Taking an annotation off the page is not enough on its own: anything else
 * that points at it keeps it, and a paperclip's file with it, alive through
 * the sweep (verify of 384a607d: a tagged PDF's structure tree points at its
 * annotations with /OBJR, and a reply points at its note with /IRT; the page
 * said "Removed 1 attached file" and the file was still in the download). So
 * a removed paperclip loses its /FS, and the structure tree's /OBJR and kept
 * annotations' /IRT, /Popup and /Parent entries that point at a removed
 * annotation are dropped.
 */
export function removeExtras(
  lib: PdfLibModule,
  doc: PDFDocument,
  extras: CleanupExtras,
): PendingExtras {
  const { PDFArray, PDFDict, PDFName, PDFRef } = lib;
  const removed: ExtrasRemoved = { ...NOTHING_EXTRA_REMOVED };
  const attachmentStreams: PDFRef[][] = [];
  const commentRefs: PDFRef[] = [];
  /** Every annotation taken off a page, by reference. */
  const gone = new Set<string>();
  const ctx = doc.context;
  const subtypeOf = (annot: PDFDict | undefined) =>
    annot ? String(annot.get(PDFName.of("Subtype"))) : "";
  const parentOf = (annot: PDFDict | undefined) =>
    annot?.lookupMaybe(PDFName.of("Parent"), PDFDict);
  /** The embedded file streams a file specification carries. */
  const streamsOf = (spec: PDFDict | undefined): PDFRef[] => {
    const ef = spec?.lookupMaybe(PDFName.of("EF"), PDFDict);
    const refs: PDFRef[] = [];
    for (const [, value] of ef?.entries() ?? [])
      if (value instanceof PDFRef) refs.push(value);
    return refs;
  };
  const markGone = (value: PDFObject) => {
    if (value instanceof PDFRef) gone.add(value.toString());
  };
  const catalog = doc.catalog;
  if (extras.attachments) {
    const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    const tree = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
    if (names && tree) {
      // The leaves of the name tree: each /Names array holds pairs.
      const stack = [tree];
      while (stack.length > 0) {
        const node = stack.pop()!;
        const leaf = node.lookupMaybe(PDFName.of("Names"), PDFArray);
        for (let i = 1; i < (leaf?.size() ?? 0); i += 2) {
          removed.attachments += 1;
          attachmentStreams.push(streamsOf(leaf!.lookupMaybe(i, PDFDict)));
        }
        const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
        for (let i = 0; i < (kids?.size() ?? 0); i++) {
          const kid = kids!.lookupMaybe(i, PDFDict);
          if (kid) stack.push(kid);
        }
      }
      names.delete(PDFName.of("EmbeddedFiles"));
    }
    // PDF 2.0's associated files point at the same file specifications.
    catalog.delete(PDFName.of("AF"));
    // A file pinned to a page with the paperclip lives on the page, not in
    // the name tree (review of 7b498d92: Acrobat's "Attach File" tool).
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) continue;
      const kept: PDFObject[] = [];
      for (let i = 0; i < annots.size(); i++) {
        const annot = annots.lookupMaybe(i, PDFDict);
        if (subtypeOf(annot) === FILE_ATTACHMENT) {
          removed.attachments += 1;
          attachmentStreams.push(
            streamsOf(annot!.lookupMaybe(PDFName.of("FS"), PDFDict)),
          );
          // Whatever still points at the annotation no longer reaches the file.
          annot!.delete(PDFName.of("FS"));
          annot!.delete(PDFName.of("AF"));
          markGone(annots.get(i));
        }
        // Its popup points back at it (/Parent), so leaving the popup would
        // keep the attached bytes reachable through it.
        else if (subtypeOf(parentOf(annot)) === FILE_ATTACHMENT)
          markGone(annots.get(i));
        else kept.push(annots.get(i));
      }
      if (kept.length === annots.size()) continue;
      if (kept.length === 0) page.node.delete(PDFName.of("Annots"));
      else page.node.set(PDFName.of("Annots"), ctx.obj(kept));
    }
  }
  if (extras.metadata) {
    const hadInfo = !!ctx.trailerInfo.Info;
    const hadXmp = !!catalog.get(PDFName.of("Metadata"));
    delete ctx.trailerInfo.Info;
    catalog.delete(PDFName.of("Metadata"));
    for (const page of doc.getPages()) page.node.delete(PDFName.of("Metadata"));
    removed.metadata = hadInfo || hadXmp;
  }
  if (extras.comments) {
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) continue;
      const kept: PDFObject[] = [];
      for (let i = 0; i < annots.size(); i++) {
        const annot = annots.lookupMaybe(i, PDFDict);
        const subtype = subtypeOf(annot);
        const value = annots.get(i);
        if (KEPT_ANNOTS.has(subtype)) kept.push(value);
        // A popup is a comment's window, not a comment of its own; it stays
        // with a kept paperclip.
        else if (subtype === "/Popup") {
          if (KEPT_ANNOTS.has(subtypeOf(parentOf(annot)))) kept.push(value);
          else markGone(value);
        } else {
          removed.comments += 1;
          if (value instanceof PDFRef) commentRefs.push(value);
          markGone(value);
        }
      }
      if (kept.length === 0) page.node.delete(PDFName.of("Annots"));
      else page.node.set(PDFName.of("Annots"), ctx.obj(kept));
    }
  }
  if (gone.size > 0) unlinkRemovedAnnots(lib, doc, gone);
  return { counted: removed, attachmentStreams, commentRefs };
}

/** Drop every pointer at a removed annotation that would keep it in the file. */
function unlinkRemovedAnnots(
  lib: PdfLibModule,
  doc: PDFDocument,
  gone: Set<string>,
): void {
  const { PDFArray, PDFDict, PDFName, PDFRef } = lib;
  const ctx = doc.context;
  const isGone = (value: PDFObject | undefined) =>
    value instanceof PDFRef && gone.has(value.toString());
  // Kept annotations: a reply's /IRT, a popup's /Parent, a note's /Popup.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const annot = annots!.lookupMaybe(i, PDFDict);
      for (const key of ["IRT", "Parent", "Popup"])
        if (annot && isGone(annot.get(PDFName.of(key))))
          annot.delete(PDFName.of(key));
    }
  }
  // The structure tree: an element's /K holds /OBJR entries naming them.
  const OBJ = PDFName.of("Obj");
  const K = PDFName.of("K");
  const pointsAtGone = (value: PDFObject | undefined) => {
    const kid = ctx.lookup(value);
    return kid instanceof PDFDict && isGone(kid.get(OBJ));
  };
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const root = doc.catalog.get(PDFName.of("StructTreeRoot"));
  if (root) stack.push(root);
  while (stack.length > 0) {
    const value = stack.pop()!;
    if (value instanceof PDFRef) {
      if (seen.has(value.toString())) continue;
      seen.add(value.toString());
    }
    const node = ctx.lookup(value);
    if (!(node instanceof PDFDict) || node.has(OBJ)) continue;
    const kids = node.get(K);
    const resolved = ctx.lookup(kids);
    if (resolved instanceof PDFArray) {
      const kept: PDFObject[] = [];
      for (let i = 0; i < resolved.size(); i++) {
        if (pointsAtGone(resolved.get(i))) continue;
        kept.push(resolved.get(i));
        stack.push(resolved.get(i));
      }
      if (kept.length !== resolved.size()) node.set(K, ctx.obj(kept));
    } else if (pointsAtGone(kids)) node.delete(K);
    else if (kids) stack.push(kids);
  }
}

/**
 * After `dropUnseen`: count what really left the file. An attached file whose
 * bytes are still there, or a comment that is still there, because something
 * this cleanup does not know still points at it, is counted as left, never as
 * removed. The page reports these numbers, not `removeExtras`'s own.
 */
export function settleExtras(
  doc: PDFDocument,
  pending: PendingExtras,
): ExtrasRemoved {
  const stillThere = (ref: PDFRef) => doc.context.lookup(ref) !== undefined;
  const attachmentsLeft = pending.attachmentStreams.filter((streams) =>
    streams.some(stillThere),
  ).length;
  const commentsLeft = pending.commentRefs.filter(stillThere).length;
  return {
    ...pending.counted,
    attachments: pending.counted.attachments - attachmentsLeft,
    attachmentsLeft,
    comments: pending.counted.comments - commentsLeft,
    commentsLeft,
  };
}
