// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFName, PDFNumber } from "pdf-lib";
import {
  indent,
  insertAfter,
  outdent,
  remove,
  rename,
  retarget,
  type BookmarkNode,
} from "./bookmark-tree";
import { readOutlineTree, writePdfBookmarks } from "./bookmarks";
import { PdfEncryptedError } from "./engine";
import { loadPdfjs } from "./pdfjs";
import {
  action,
  addOutline,
  blankPages,
  fitDest,
  lit,
  xyzDest,
} from "@/tests/bookmark-fixtures";
import { ownerOnlyEncryptedPdf } from "@/tests/encrypted-pdf-fixture";

/**
 * Edit PDF Bookmarks' saved copy as a VIEWER reads it: pdf.js's
 * `getOutline()`, each destination resolved to a page the way the viewer
 * resolves a click (`getDestination` for a name, `getPageIndex` for a page
 * reference). Nothing here goes through the engine's own reader, so the
 * reader cannot certify itself.
 */

interface ViewerItem {
  title: string;
  page: number | null;
  url?: string;
  open?: boolean;
  kids?: ViewerItem[];
}

async function viewerOutline(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const pageOf = async (dest: unknown): Promise<number | null> => {
      const explicit =
        typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit)) return null;
      const target: unknown = explicit[0];
      if (typeof target === "number") return target + 1;
      if (!target || typeof target !== "object") return null;
      try {
        return (await pdf.getPageIndex(target as never)) + 1;
      } catch {
        return null;
      }
    };
    interface Item {
      title: string;
      dest: unknown;
      url?: string | null;
      count?: number;
      items?: Item[];
    }
    const walk = async (items: Item[]): Promise<ViewerItem[]> =>
      Promise.all(
        items.map(async (item) => ({
          title: item.title,
          page: item.dest ? await pageOf(item.dest) : null,
          ...(item.url ? { url: item.url } : {}),
          ...(item.count !== undefined && item.count > 0 ? { open: true } : {}),
          ...(item.items?.length ? { kids: await walk(item.items) } : {}),
        })),
      );
    return {
      outline: await walk(((await pdf.getOutline()) ?? []) as Item[]),
      pageMode: await pdf.getPageMode(),
    };
  } finally {
    await task.destroy();
  }
}

const N = (n: string) => PDFName.of(n);

describe("the saved outline as pdf.js reads it", () => {
  it("rename, delete, add, nest, outdent and retarget: titles, nesting and target pages", async () => {
    const doc = await blankPages(5);
    const ctx = doc.context;
    doc.catalog.set(
      N("Names"),
      ctx.obj({
        Dests: ctx.obj({ Names: ctx.obj([lit("ch2"), fitDest(doc, 1)]) }),
      }),
    );
    addOutline(doc, [
      { title: "Cover", dest: xyzDest(doc, 0, 0, 800, 0) },
      {
        title: "Chapter 2",
        dest: lit("ch2"),
        open: true,
        kids: [
          { title: "Section 2.1", dest: ctx.obj([PDFNumber.of(2), N("Fit")]) },
          { title: "Obsolete", dest: fitDest(doc, 3) },
        ],
      },
      {
        title: "Site",
        action: action(doc, { S: N("URI"), URI: lit("https://example.org/") }),
      },
    ]);
    const bytes = await doc.save();
    // Positive control: pdf.js reads the input the engine read.
    expect((await viewerOutline(bytes)).outline).toEqual([
      { title: "Cover", page: 1 },
      {
        title: "Chapter 2",
        page: 2,
        open: true,
        kids: [
          { title: "Section 2.1", page: 3 },
          { title: "Obsolete", page: 4 },
        ],
      },
      { title: "Site", page: null, url: "https://example.org/" },
    ]);

    const before = await readOutlineTree(bytes);
    const all = (items: readonly BookmarkNode[]): BookmarkNode[] =>
      items.flatMap((n) => [n, ...all(n.children)]);
    const id = (t: string) => all(before.items).find((n) => n.title === t)!.id;
    let items: readonly BookmarkNode[] = before.items;
    items = rename(items, id("Cover"), "Title page");
    items = remove(items, id("Obsolete"));
    items = insertAfter(items, id("Chapter 2"), {
      id: "n1",
      title: "Appendix — 付録",
      target: { kind: "page", page: 5 },
      open: false,
      children: [],
    });
    items = indent(items, id("Site"));
    items = outdent(items, id("Section 2.1"));
    items = retarget(items, id("Section 2.1"), { kind: "page", page: 4 });

    const out = await writePdfBookmarks(bytes, { items, showPanel: true });
    const viewer = await viewerOutline(out.bytes);
    expect(viewer.pageMode).toBe("UseOutlines");
    expect(viewer.outline).toEqual([
      { title: "Title page", page: 1 },
      { title: "Chapter 2", page: 2 },
      { title: "Section 2.1", page: 4 },
      {
        title: "Appendix — 付録",
        page: 5,
        open: true,
        kids: [{ title: "Site", page: null, url: "https://example.org/" }],
      },
    ]);
  });

  it("an encrypted PDF is refused with PdfEncryptedError", async () => {
    const err = await readOutlineTree(ownerOnlyEncryptedPdf()).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
  });
});
