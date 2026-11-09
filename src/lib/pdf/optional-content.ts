import type {
  PDFArray as PDFArrayT,
  PDFDict as PDFDictT,
  PDFDocument,
  PDFObject,
  PDFRef as PDFRefT,
} from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * What a layer configuration needs from the copy that carried a source's
 * pages into the output: the output ref of a source object the pages already
 * reached (`undefined` when nothing copied reached it), and a copy of a small
 * value (a label, a name) to write into the output's configuration.
 *
 * The page assembler's copier (`page-copy.ts`) is one; the sheet tools'
 * embedding (`sheet-embed.ts`), which copies through pdf-lib's own
 * `embedPages`, builds one from the groups it marked before embedding.
 */
export interface LayerCopier {
  copied(ref: PDFRefT): PDFRefT | undefined;
  copy(object: PDFObject): PDFObject;
}

/** One source's layer configuration, read in place: it is never copied whole. */
export interface LayerSource {
  ocProperties: PDFDictT | undefined;
  copier: LayerCopier;
}

const MAX_ORDER_DEPTH = 32;

/**
 * Publish the output's `/OCProperties` (layers) from every source's, listing
 * only the groups (OCGs) the copied pages reached.
 *
 * Without it the kept pages still mark content `/OC /MCx BDC ... EMC` and
 * still name their groups in `/Resources /Properties`, but a viewer with no
 * configuration to read governs nothing and draws EVERY layer — measured at
 * a7aa20cf (audit #1): a layer OFF by default (a print-only watermark, an
 * answer key, an alternate language) became visible after Merge, Extract,
 * Delete, Split and Organize. Pinned by `page-copy-layers.test.ts`, which
 * reads the result through pdf.js. Multiple Pages per Sheet and Booklet had
 * the same defect through `embedSourcePages` (review of feat/booklet-pdf,
 * 2026-11-10: an answer key OFF by default painted 99,225 red pixels on the
 * booklet); `sheet-embed-output.test.ts` pins that path.
 *
 * A group is taken when the copier already copied it — it is reached from a
 * kept page, its content, an XObject or an annotation — so the layers of
 * dropped pages are not listed. Each source's default state (`/D`) is written
 * out per group: `/BaseState` is left at ON and every group the source hid
 * by default, through `/OFF` or a `/BaseState /OFF` it was not listed `/ON`
 * under, goes in `/OFF`, so two merged files that state their defaults
 * opposite ways each keep theirs. `/Order` (the Layers panel), `/RBGroups`,
 * `/Locked` and the `/AS` usage rules (print-only and view-only layers) are
 * filtered to the taken groups and concatenated in source order. NOT
 * carried: alternate configurations (`/Configs`), and the default
 * configuration's `/Name` and `/Creator` in a merge of several layered files.
 */
export function publishOptionalContent(
  lib: PdfLibModule,
  out: PDFDocument,
  sources: LayerSource[],
): void {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString } = lib;
  const ctx = out.context;
  const groups: PDFRefT[] = [];
  const off: PDFRefT[] = [];
  const order: PDFObject[] = [];
  const rbGroups: PDFObject[] = [];
  const locked: PDFRefT[] = [];
  const usage: PDFObject[] = [];
  const configs: { d: PDFDictT; copier: LayerCopier }[] = [];

  for (const { ocProperties, copier } of sources) {
    if (!ocProperties) continue;
    const srcCtx = ocProperties.context;
    const d = ocProperties.lookupMaybe(PDFName.of("D"), PDFDict);
    const listed = (owner: PDFDictT | undefined, key: string): PDFRefT[] => {
      const list = owner?.lookupMaybe(PDFName.of(key), PDFArray);
      const found = (list?.asArray() ?? []).map((value) =>
        value instanceof PDFRef ? copier.copied(value) : undefined,
      );
      return [...new Set(found.filter((r): r is PDFRefT => r !== undefined))];
    };
    const mine = listed(ocProperties, "OCGs");
    if (mine.length === 0) continue;
    const ours = new Set(mine);
    /** A source group ref's output copy, if it is one of this source's taken groups. */
    const group = (value: PDFObject): PDFRefT | undefined => {
      const ref = value instanceof PDFRef ? copier.copied(value) : undefined;
      return ref && ours.has(ref) ? ref : undefined;
    };
    configs.push(...(d ? [{ d, copier }] : []));

    const baseOff = d?.get(PDFName.of("BaseState")) === PDFName.of("OFF");
    const on = new Set(listed(d, "ON"));
    const hidden = new Set(listed(d, "OFF"));
    for (const ref of mine) {
      groups.push(ref);
      // Viewers apply /BaseState, then /ON, then /OFF.
      if (hidden.has(ref) || (baseOff && !on.has(ref))) off.push(ref);
    }

    /** `/Order` filtered: a label stays only in a list that kept a group. */
    const filterOrder = (list: PDFArrayT, depth: number): PDFObject[] => {
      if (depth > MAX_ORDER_DEPTH) return [];
      const kept: PDFObject[] = [];
      let hasGroup = false;
      for (const item of list.asArray()) {
        const ref = group(item);
        const resolved = srcCtx.lookup(item);
        if (ref) {
          kept.push(ref);
          hasGroup = true;
        } else if (resolved instanceof PDFArray) {
          const inner = filterOrder(resolved, depth + 1);
          if (inner.length > 0) {
            kept.push(ctx.obj(inner));
            hasGroup = true;
          }
        } else if (
          resolved instanceof PDFString ||
          resolved instanceof PDFHexString
        ) {
          kept.push(copier.copy(resolved));
        }
      }
      return hasGroup ? kept : [];
    };
    const sourceOrder = d?.lookupMaybe(PDFName.of("Order"), PDFArray);
    if (sourceOrder) order.push(...filterOrder(sourceOrder, 0));

    // Radio-button groups: a set left with one member constrains nothing.
    const rb = d?.lookupMaybe(PDFName.of("RBGroups"), PDFArray);
    for (const entry of rb?.asArray() ?? []) {
      const set = srcCtx.lookup(entry);
      if (!(set instanceof PDFArray)) continue;
      const members = set
        .asArray()
        .map(group)
        .filter((r): r is PDFRefT => r !== undefined);
      if (members.length > 1) rbGroups.push(ctx.obj(members));
    }
    locked.push(...listed(d, "Locked").filter((r) => ours.has(r)));

    // Usage application (/AS): what makes a layer print-only or view-only.
    const as = d?.lookupMaybe(PDFName.of("AS"), PDFArray);
    for (const entry of as?.asArray() ?? []) {
      const rule = srcCtx.lookup(entry);
      if (!(rule instanceof PDFDict)) continue;
      const members = listed(rule, "OCGs").filter((r) => ours.has(r));
      const event = rule.get(PDFName.of("Event"));
      const category = rule.get(PDFName.of("Category"));
      if (members.length === 0 || !event || !category) continue;
      usage.push(
        ctx.obj({
          Event: copier.copy(event),
          Category: copier.copy(srcCtx.lookup(category) ?? category),
          OCGs: members,
        }),
      );
    }
  }
  if (groups.length === 0) return;

  const d = ctx.obj({}) as PDFDictT;
  // One source's label for its default configuration; a merge has none.
  if (configs.length === 1) {
    const { d: source, copier } = configs[0]!;
    for (const key of ["Name", "Creator", "Intent", "ListMode"]) {
      const value = source.get(PDFName.of(key));
      if (value === undefined) continue;
      d.set(
        PDFName.of(key),
        copier.copy(source.context.lookup(value) ?? value),
      );
    }
  }
  if (off.length > 0) d.set(PDFName.of("OFF"), ctx.obj(off));
  if (order.length > 0) d.set(PDFName.of("Order"), ctx.obj(order));
  if (rbGroups.length > 0) d.set(PDFName.of("RBGroups"), ctx.obj(rbGroups));
  if (locked.length > 0) d.set(PDFName.of("Locked"), ctx.obj(locked));
  if (usage.length > 0) d.set(PDFName.of("AS"), ctx.obj(usage));
  out.catalog.set(
    PDFName.of("OCProperties"),
    ctx.register(ctx.obj({ OCGs: groups, D: d })),
  );
}
