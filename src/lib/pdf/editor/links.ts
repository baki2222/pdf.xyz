import type { PDFDocument, PDFPage, PDFRef } from "pdf-lib";
import type { PdfLibModule } from "../pdf-lib";
import { PdfEngineError } from "../engine";
import {
  contentToViewer,
  viewerRectToContent,
  type ExportFrame,
} from "./geometry";
import {
  linkUntouched,
  sameTarget,
  type LinkObject,
  type LinkTarget,
  type Rect,
} from "./model";
import { sourcePageId } from "./pages";

/**
 * Links: what a person may type as a target, how a link already in the
 * file is read into the editor, and how links are written back — as real
 * `/Link` annotations with a `/URI` or `/GoTo` action, never drawn into the
 * page.
 *
 * `editor-export.test.ts` re-opens the export and reads each annotation's
 * `/Rect` and target, on a rotated page too.
 */

/** The schemes a link may use. Anything else (javascript:, file:, data:) is refused. */
export const LINK_SCHEMES = ["http:", "https:", "mailto:", "tel:"] as const;

export type LinkInput =
  { ok: true; uri: string } | { ok: false; message: string };

const EMAIL =
  /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ().-]{3,}$/;

const REFUSED =
  "A link can go to a web address (http or https), an email address or a phone number.";

/**
 * What a typed target becomes. A bare address gets `https://`, an email
 * address `mailto:`, a phone number `tel:` (separators dropped). A scheme
 * other than the four in {@link LINK_SCHEMES} is refused, as is anything
 * that does not parse as one of them.
 */
export function parseLinkInput(raw: string): LinkInput {
  const text = raw.trim();
  if (!text)
    return {
      ok: false,
      message: "Type a web address, an email address or a phone number.",
    };
  // "example.com:8080" is an address with a port, not a scheme.
  const scheme = /^([a-z][a-z0-9+-]*):/i.exec(text)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === "mailto") {
      const address = text.slice(7).split("?")[0] ?? "";
      return EMAIL.test(decodeURIComponent(address))
        ? { ok: true, uri: `mailto:${address}` }
        : { ok: false, message: "That email address doesn't look right." };
    }
    if (scheme === "tel") {
      const number = text.slice(4).replace(/[\s().-]/g, "");
      return /^\+?[0-9]{3,}$/.test(number)
        ? { ok: true, uri: `tel:${number}` }
        : { ok: false, message: "That phone number doesn't look right." };
    }
    if (scheme === "http" || scheme === "https") return web(text);
    return { ok: false, message: REFUSED };
  }
  if (EMAIL.test(text)) return { ok: true, uri: `mailto:${text}` };
  if (PHONE.test(text) && /\d{3}/.test(text.replace(/\D/g, ""))) {
    return { ok: true, uri: `tel:${text.replace(/[\s().-]/g, "")}` };
  }
  return web(`https://${text}`);
}

function web(text: string): LinkInput {
  if (/\s/.test(text))
    return { ok: false, message: "A web address has no spaces." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: "That web address doesn't look right." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: REFUSED };
  }
  if (!url.hostname.includes(".") && url.hostname !== "localhost") {
    return { ok: false, message: "That web address doesn't look right." };
  }
  return { ok: true, uri: url.href };
}

/** Is this a target the editor may write? (A link read from a file may hold anything.) */
export function isWritableUri(uri: string): boolean {
  const lower = uri.toLowerCase();
  return LINK_SCHEMES.some((s) => lower.startsWith(s));
}

// Leaf helpers live in the model, so the editor's state (in the tool page's
// own chunk) can ask them without pulling this module along.
export { linkUntouched, sameTarget } from "./model";

export function refKey(ref: PDFRef): string {
  return `${ref.objectNumber} ${ref.generationNumber}`;
}

/* ------------------------------- reading ------------------------------- */

function textOf(lib: PdfLibModule, value: unknown): string | null {
  if (value instanceof lib.PDFString || value instanceof lib.PDFHexString) {
    return value.decodeText();
  }
  return null;
}

/**
 * Every `/Link` annotation in the file, as editor objects on the page it
 * sits on, in viewer points. Links held directly in `/Annots` (no object
 * of their own) are not offered: they are left in the file as they are.
 */
export function readFileLinks(
  lib: PdfLibModule,
  doc: PDFDocument,
  frames: readonly ExportFrame[],
): LinkObject[] {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFNumber } = lib;
  const pages = doc.getPages();
  const pageIndex = new Map(pages.map((p, i) => [refKey(p.ref), i]));
  const destOf = (dest: unknown): LinkTarget => {
    const resolved = dest instanceof PDFRef ? doc.context.lookup(dest) : dest;
    const arr =
      resolved instanceof PDFDict ? resolved.lookup(PDFName.of("D")) : resolved;
    if (arr instanceof PDFArray && arr.size() > 0) {
      const first = arr.get(0);
      if (first instanceof PDFRef) {
        const i = pageIndex.get(refKey(first));
        if (i !== undefined) return { type: "page", pageId: sourcePageId(i) };
      }
      if (first instanceof PDFNumber) {
        const i = first.asNumber();
        if (Number.isInteger(i) && i >= 0 && i < pages.length) {
          return { type: "page", pageId: sourcePageId(i) };
        }
      }
    }
    return { type: "other", label: "a named place in this document" };
  };
  const out: LinkObject[] = [];
  pages.forEach((page, index) => {
    const frame = frames[index];
    const annots = page.node.Annots();
    if (!frame || !annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const ref = annots.get(i);
      if (!(ref instanceof PDFRef)) continue;
      const dict = doc.context.lookup(ref);
      if (!(dict instanceof PDFDict)) continue;
      if (dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Link")) continue;
      const rect = dict.lookup(PDFName.of("Rect"));
      if (!(rect instanceof PDFArray) || rect.size() !== 4) continue;
      const n = [0, 1, 2, 3].map((k) => {
        const v = rect.lookup(k);
        return v instanceof PDFNumber ? v.asNumber() : NaN;
      });
      if (!n.every(Number.isFinite)) continue;
      const a = contentToViewer(n[0]!, n[1]!, frame);
      const b = contentToViewer(n[2]!, n[3]!, frame);
      const box: Rect = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      };
      let target: LinkTarget = {
        type: "other",
        label: "an action this editor doesn't change",
      };
      const action = dict.lookup(PDFName.of("A"));
      if (action instanceof PDFDict) {
        const s = action.lookup(PDFName.of("S"));
        if (s === PDFName.of("URI")) {
          const uri = textOf(lib, action.lookup(PDFName.of("URI")));
          if (uri && isWritableUri(uri)) target = { type: "uri", uri };
          else if (uri) target = { type: "other", label: uri.slice(0, 60) };
        } else if (s === PDFName.of("GoTo")) {
          target = destOf(action.get(PDFName.of("D")));
        }
      } else {
        const dest = dict.get(PDFName.of("Dest"));
        if (dest) target = destOf(dest);
      }
      const key = refKey(ref);
      out.push({
        id: `link-${key.replace(" ", "-")}`,
        kind: "link",
        page: index,
        ...box,
        target,
        origin: { ref: key, rect: box, target },
      });
    }
  });
  return out;
}

/* ------------------------------- writing ------------------------------- */

/** A content-space `/Rect` for a viewer box: what the annotation covers. */
export function linkRect(rect: Rect, frame: ExportFrame): number[] {
  const c = viewerRectToContent(rect, frame);
  return [c.x0, c.y0, c.x1, c.y1];
}

function findAnnot(
  lib: PdfLibModule,
  pages: readonly PDFPage[],
  key: string,
): { page: PDFPage; ref: PDFRef } | null {
  for (const page of pages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const ref = annots.get(i);
      if (ref instanceof lib.PDFRef && refKey(ref) === key)
        return { page, ref };
    }
  }
  return null;
}

/**
 * Write the links: remove the file's links that were deleted, rewrite the
 * ones that were moved or re-aimed (in place, so their border, highlight
 * mode and other entries are kept), and add the new ones. `pageIds[i]` is
 * the id of the page now at index i, so a "go to page" target resolves to
 * the page it named however the pages were reordered.
 */
export function writeLinks(
  lib: PdfLibModule,
  doc: PDFDocument,
  frames: readonly ExportFrame[],
  links: readonly LinkObject[],
  removed: readonly string[],
  pageIds: readonly string[],
): number {
  const { PDFName, PDFString, PDFDict } = lib;
  const pages = doc.getPages();
  const action = (target: LinkTarget, where: number) => {
    if (target.type === "uri") {
      if (!target.uri) {
        throw new PdfEngineError(
          `A link on page ${where + 1} has no address yet. Select it and type where it goes, or remove it.`,
        );
      }
      if (!isWritableUri(target.uri)) {
        throw new PdfEngineError(
          `A link on page ${where + 1} has an address this editor can't write.`,
        );
      }
      return doc.context.obj({
        S: "URI",
        URI: PDFString.of(target.uri),
      });
    }
    if (target.type === "page") {
      const i = pageIds.indexOf(target.pageId);
      const page = pages[i];
      if (i < 0 || !page) {
        throw new PdfEngineError(
          `A link on page ${where + 1} goes to a page you deleted. Choose another page or remove the link.`,
        );
      }
      return doc.context.obj({ S: "GoTo", D: [page.ref, "Fit"] });
    }
    return null;
  };
  for (const key of removed) {
    const at = findAnnot(lib, pages, key);
    if (at) at.page.node.removeAnnot(at.ref);
  }
  let written = 0;
  for (const link of links) {
    const frame = frames[link.page];
    const page = pages[link.page];
    if (!frame || !page) continue;
    if (link.origin) {
      if (linkUntouched(link)) continue;
      const at = findAnnot(lib, pages, link.origin.ref);
      const dict = at ? doc.context.lookup(at.ref) : null;
      if (!(dict instanceof PDFDict)) continue;
      dict.set(PDFName.of("Rect"), doc.context.obj(linkRect(link, frame)));
      if (!sameTarget(link.target, link.origin.target)) {
        const a = action(link.target, link.page);
        if (a) {
          dict.delete(PDFName.of("Dest"));
          dict.set(PDFName.of("A"), a);
        }
      }
      written += 1;
      continue;
    }
    const a = action(link.target, link.page);
    if (!a) continue;
    const annot = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: linkRect(link, frame),
      Border: [0, 0, 0],
      F: 4,
      P: page.ref,
      A: a,
    });
    page.node.addAnnot(doc.context.register(annot));
    written += 1;
  }
  return written;
}
