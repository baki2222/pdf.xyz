import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import {
  BOOKMARK_DEPTH_MAX,
  BOOKMARK_EDIT_MAX,
  BOOKMARK_TITLE_MAX,
} from "./bookmark-labels";
import {
  indent,
  outdent,
  move,
  remove,
  rename,
  retarget,
  setOpen,
  insertChild,
  type BookmarkNode,
} from "./bookmark-tree";
import {
  BookmarksRefusal,
  OUTLINE_WALK_MAX,
  TooManyBookmarksError,
  readOutlineTree,
  writePdfBookmarks,
} from "./bookmarks";
import { loadPdfLib } from "./pdf-lib";
import { pruneUnreachable } from "./prune-unreachable";
import {
  action,
  addOutline,
  blankPages,
  fitDest,
  lit,
  xyzDest,
} from "@/tests/bookmark-fixtures";
import { decodedScan, markersFound } from "@/tests/pdf-decoded-scan";

/**
 * Edit PDF Bookmarks' engine, read back from the SAVED bytes: by its own
 * reader, by a structural check of the raw outline objects (every link both
 * ways, every /Count), and — for "deleted means gone" — by a reader that
 * parses objects and decodes every stream, object streams included
 * (`pdf-decoded-scan.ts`), which does not trust pdf-lib. pdf.js's reading of
 * the same files is in `bookmarks.pdfjs.test.ts`.
 */

const N = (n: string) => PDFName.of(n);

/** A three-level outline over six pages, with every kind of target. */
async function richFixture() {
  const doc = await blankPages(6);
  const ctx = doc.context;
  // A /Names tree destination (keyed by string) and a catalog /Dests one
  // (keyed by name).
  doc.catalog.set(
    N("Names"),
    ctx.obj({
      Dests: ctx.obj({
        Names: ctx.obj([lit("sec.tree"), xyzDest(doc, 2, 72, 700, 1.5)]),
      }),
    }),
  );
  doc.catalog.set(
    N("Dests"),
    ctx.obj({ CatalogName: ctx.obj({ D: fitDest(doc, 4) }) }),
  );
  const built = addOutline(doc, [
    {
      title: "Intro",
      dest: xyzDest(doc, 0, 10, 780, 0),
      open: true,
      extra: { C: ctx.obj([1, 0, 0]), F: PDFNumber.of(2) },
      kids: [
        { title: "Tree name", dest: lit("sec.tree") },
        {
          title: "Catalog name",
          action: action(doc, { S: N("GoTo"), D: N("CatalogName") }),
          kids: [
            {
              title: "Page number",
              dest: ctx.obj([PDFNumber.of(5), N("Fit")]),
            },
          ],
        },
      ],
    },
    {
      title: "Links",
      kids: [
        {
          title: "Website",
          action: action(doc, {
            S: N("URI"),
            URI: lit("https://example.com/"),
          }),
        },
        {
          title: "Next page",
          action: action(doc, { S: N("Named"), N: N("NextPage") }),
        },
        {
          title: "Script",
          action: action(doc, { S: N("JavaScript"), JS: lit("app.alert(1)") }),
          kids: [{ title: "Under script", dest: fitDest(doc, 1) }],
        },
        {
          title: "Launcher",
          action: action(doc, { S: N("Launch"), F: lit("calc.exe") }),
        },
      ],
    },
  ]);
  return { bytes: await doc.save({ useObjectStreams: false }), built };
}

interface Shape {
  title: string;
  target: string;
  open?: boolean;
  kids?: Shape[];
}

function shape(items: readonly BookmarkNode[]): Shape[] {
  return items.map((n) => {
    const t = n.target;
    const target =
      t.kind === "page"
        ? `page ${t.page}`
        : t.kind === "uri"
          ? `uri ${t.uri}`
          : t.kind === "named"
            ? `named ${t.action}`
            : "none";
    return {
      title: n.title,
      target,
      ...(n.open ? { open: true } : {}),
      ...(n.children.length ? { kids: shape(n.children) } : {}),
    };
  });
}

/**
 * The raw outline, checked as the spec lays it out: each item's /Parent is
 * the node that lists it, /Prev and /Next agree both ways, /First and /Last
 * are the ends of the chain, and /Count is (±) the items visible when it is
 * open — positive exactly when the reader said it is open.
 */
async function checkStructure(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const rootRef = doc.catalog.get(N("Outlines"));
  if (rootRef === undefined) return { items: 0 };
  expect(rootRef).toBeInstanceOf(PDFRef);
  const root = ctx.lookup(rootRef, PDFDict);
  let items = 0;
  /** Returns the number of items visible below `node` when it is open. */
  const check = (nodeRef: PDFRef, node: PDFDict, isRoot: boolean): number => {
    const first = node.get(N("First"));
    const last = node.get(N("Last"));
    if (first === undefined) {
      expect(last).toBeUndefined();
      expect(isRoot ? true : node.get(N("Count")) === undefined).toBe(true);
      return 0;
    }
    let ref = first as PDFRef;
    let prev: PDFRef | undefined;
    let visible = 0;
    for (;;) {
      items += 1;
      const item = ctx.lookup(ref, PDFDict);
      expect(item.get(N("Parent"))).toBe(nodeRef);
      expect(item.get(N("Prev"))).toBe(prev);
      const below = check(ref, item, false);
      const count = item.get(N("Count")) as PDFNumber | undefined;
      visible += 1 + (count && count.asNumber() > 0 ? below : 0);
      if (count) expect(Math.abs(count.asNumber())).toBe(below);
      const next = item.get(N("Next")) as PDFRef | undefined;
      if (!next) {
        expect(last).toBe(ref);
        break;
      }
      prev = ref;
      ref = next;
    }
    if (isRoot) {
      expect((node.get(N("Count")) as PDFNumber).asNumber()).toBe(visible);
    }
    return visible;
  };
  check(rootRef as PDFRef, root, true);
  return { items };
}

describe("reading an outline", () => {
  it("classifies every kind of target, and keeps an item whose action is dropped", async () => {
    const { bytes } = await richFixture();
    const r = await readOutlineTree(bytes);
    expect(shape(r.items)).toEqual([
      {
        title: "Intro",
        target: "page 1",
        open: true,
        kids: [
          { title: "Tree name", target: "page 3" },
          {
            title: "Catalog name",
            target: "page 5",
            kids: [{ title: "Page number", target: "page 6" }],
          },
        ],
      },
      {
        title: "Links",
        target: "none",
        kids: [
          { title: "Website", target: "uri https://example.com/" },
          { title: "Next page", target: "named NextPage" },
          {
            title: "Script",
            target: "none",
            kids: [{ title: "Under script", target: "page 2" }],
          },
          { title: "Launcher", target: "none" },
        ],
      },
    ]);
    expect(r.total).toBe(10);
    expect(r.depth).toBe(3);
    expect(r.pageCount).toBe(6);
    expect(r.droppedActions).toBe(2);
    expect(r.brokenTargets).toBe(0);
    expect(r.cutLinks).toBe(0);
    expect(r.pageMode).toBe("none");
  });

  it("an empty or absent outline reads as no bookmarks", async () => {
    const doc = await blankPages(2);
    const r = await readOutlineTree(await doc.save());
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    addOutline(doc, []);
    expect((await readOutlineTree(await doc.save())).total).toBe(0);
  });
});

describe("saving an edited outline", () => {
  it("rename, retarget, delete a subtree, move, indent, outdent and open: read back as edited, structure sound", async () => {
    const { bytes } = await richFixture();
    const before = await readOutlineTree(bytes);
    const id = (title: string) =>
      [...flat(before.items)].find((n) => n.title === title)!.id;
    let items: readonly BookmarkNode[] = before.items;
    items = rename(items, id("Tree name"), "Methods");
    items = retarget(items, id("Website"), { kind: "page", page: 4 });
    items = remove(items, id("Script"));
    items = move(items, id("Links"), -1);
    items = indent(items, id("Next page"));
    items = outdent(items, id("Page number"));
    items = setOpen(items, id("Intro"), false);
    items = insertChild(items, id("Launcher"), {
      id: "new-1",
      title: "Ελληνικά — 日本語",
      target: { kind: "page", page: 2 },
      open: false,
      children: [],
    });
    const result = await writePdfBookmarks(bytes, { items, showPanel: true });
    expect(shape(result.saved.items)).toEqual([
      {
        title: "Links",
        target: "none",
        kids: [
          {
            title: "Website",
            target: "page 4",
            kids: [{ title: "Next page", target: "named NextPage" }],
            open: true,
          },
          {
            title: "Launcher",
            target: "none",
            open: true,
            kids: [{ title: "Ελληνικά — 日本語", target: "page 2" }],
          },
        ],
      },
      {
        title: "Intro",
        target: "page 1",
        kids: [
          { title: "Methods", target: "page 3" },
          { title: "Catalog name", target: "page 5" },
          { title: "Page number", target: "page 6" },
        ],
      },
    ]);
    expect((await checkStructure(result.bytes)).items).toBe(9);
    expect(result.droppedActions).toBe(2);
    expect(result.saved.pageMode).toBe("outlines");
  });

  it("writes a closed parent's /Count negative and an open one's positive, and new items closed", async () => {
    const doc = await blankPages(3);
    addOutline(doc, [
      {
        title: "A",
        dest: fitDest(doc, 0),
        open: true,
        kids: [
          { title: "A1", dest: fitDest(doc, 1) },
          { title: "A2", dest: fitDest(doc, 2) },
        ],
      },
    ]);
    const bytes = await doc.save();
    const before = await readOutlineTree(bytes);
    const a = before.items[0]!;
    // A child added under A2: A2 is new-parent, opened by insertChild; then
    // closed by hand.
    let items: readonly BookmarkNode[] = insertChild(
      before.items,
      a.children[1]!.id,
      {
        id: "n1",
        title: "A2a",
        target: { kind: "page", page: 3 },
        open: false,
        children: [],
      },
    );
    items = setOpen(items, a.children[1]!.id, false);
    const out = await writePdfBookmarks(bytes, { items, showPanel: false });
    const saved = await PDFDocument.load(out.bytes);
    const ctx = saved.context;
    const root = saved.catalog.lookup(N("Outlines"), PDFDict);
    const A = ctx.lookup(root.get(N("First")), PDFDict);
    expect((A.get(N("Count")) as PDFNumber).asNumber()).toBe(2);
    const A2 = ctx.lookup(A.get(N("Last")), PDFDict);
    expect((A2.get(N("Count")) as PDFNumber).asNumber()).toBe(-1);
    // Root: A, A1, A2 visible.
    expect((root.get(N("Count")) as PDFNumber).asNumber()).toBe(3);
    await checkStructure(out.bytes);
  });

  it("an unchanged item keeps its view and named destination; a retargeted one is [page /Fit]; nothing old is written", async () => {
    const { bytes, built } = await richFixture();
    const before = await readOutlineTree(bytes);
    const intro = before.items[0]!;
    const items = retarget(before.items, intro.children[1]!.id, {
      kind: "page",
      page: 2,
    });
    const out = await writePdfBookmarks(bytes, { items, showPanel: false });
    const doc = await PDFDocument.load(out.bytes);
    const ctx = doc.context;
    const root = doc.catalog.lookup(N("Outlines"), PDFDict);
    const first = ctx.lookup(root.get(N("First")), PDFDict);
    const dest = ctx.lookup(first.get(N("Dest")), PDFArray);
    expect(dest.get(0)).toBe(doc.getPage(0).ref);
    expect(dest.asArray().slice(1).map(String)).toEqual([
      "/XYZ",
      "10",
      "780",
      "0",
    ]);
    const tree = ctx.lookup(first.get(N("First")), PDFDict);
    const treeDest = tree.get(N("Dest"));
    expect(treeDest).toBeInstanceOf(PDFString);
    expect((treeDest as PDFString).decodeText()).toBe("sec.tree");
    const moved = ctx.lookup(tree.get(N("Next")), PDFDict);
    expect(moved.get(N("A"))).toBeUndefined();
    const movedDest = ctx.lookup(moved.get(N("Dest")), PDFArray);
    expect(movedDest.get(0)).toBe(doc.getPage(1).ref);
    expect(movedDest.get(1)).toBe(N("Fit"));
    // Every old item object is gone: the outline is new objects only.
    const present = new Set(
      ctx.enumerateIndirectObjects().map(([ref]) => ref.toString()),
    );
    const stale = [built.root, ...built.order]
      .map(String)
      .filter((r) => present.has(r));
    expect(stale).toEqual([]);
    expect(built.order.length).toBe(10);
  });

  it("a GoTo whose /Next chains JavaScript keeps its page; no /JS or /JavaScript reaches the copy", async () => {
    const doc = await blankPages(2);
    addOutline(doc, [
      {
        title: "Chained",
        action: action(doc, {
          S: N("GoTo"),
          D: fitDest(doc, 1),
          Next: action(doc, { S: N("JavaScript"), JS: lit("app.alert(2)") }),
        }),
      },
      {
        title: "Script",
        action: action(doc, { S: N("JavaScript"), JS: lit("app.alert(3)") }),
      },
    ]);
    const bytes = await doc.save({ useObjectStreams: false });
    // Positive control: the input carries both.
    expect(markersFound(bytes, ["/JavaScript", "/JS", "app.alert"])).toEqual([
      "/JavaScript",
      "/JS",
      "app.alert",
    ]);
    const before = await readOutlineTree(bytes);
    expect(shape(before.items)).toEqual([
      { title: "Chained", target: "page 2" },
      { title: "Script", target: "none" },
    ]);
    const out = await writePdfBookmarks(bytes, {
      items: before.items,
      showPanel: false,
    });
    expect(out.droppedActions).toBeGreaterThanOrEqual(1);
    expect(out.droppedActions).toBe(2);
    expect(
      markersFound(out.bytes, ["/JavaScript", "/JS", "app.alert"]),
    ).toEqual([]);
    expect(shape(out.saved.items)).toEqual(shape(before.items));
  });

  it("a 2,000-character unedited title survives an unrelated edit byte for byte", async () => {
    const doc = await blankPages(2);
    const long = "Ж".repeat(1000) + "Lorem ipsum ".repeat(84).slice(0, 1000);
    expect(long.length).toBe(2000);
    const original = PDFHexString.fromText(long);
    addOutline(doc, [
      { title: original, dest: fitDest(doc, 0) },
      { title: "Other", dest: fitDest(doc, 1) },
    ]);
    const bytes = await doc.save();
    const before = await readOutlineTree(bytes);
    expect(before.items[0]!.title).toBe(long);
    const items = rename(before.items, before.items[1]!.id, "Renamed");
    const out = await writePdfBookmarks(bytes, { items, showPanel: false });
    const saved = await PDFDocument.load(out.bytes);
    const root = saved.catalog.lookup(N("Outlines"), PDFDict);
    const first = saved.context.lookup(root.get(N("First")), PDFDict);
    const title = first.get(N("Title")) as PDFHexString;
    expect([...title.asBytes()]).toEqual([...original.asBytes()]);
    expect(out.saved.items.map((n) => n.title)).toEqual([long, "Renamed"]);
  });

  it("a typed title is ASCII text when plain, UTF-16BE otherwise, and over the limit is refused", async () => {
    const doc = await blankPages(1);
    addOutline(doc, [{ title: "x", dest: fitDest(doc, 0) }]);
    const bytes = await doc.save();
    const before = await readOutlineTree(bytes);
    const node = before.items[0]!;
    const out = await writePdfBookmarks(bytes, {
      items: [
        { ...node, title: "Plain (ASCII)" },
        {
          id: "n",
          title: "Бангла বাংলা",
          target: { kind: "page", page: 1 },
          open: false,
          children: [],
        },
      ],
      showPanel: false,
    });
    const saved = await PDFDocument.load(out.bytes);
    const root = saved.catalog.lookup(N("Outlines"), PDFDict);
    const a = saved.context.lookup(root.get(N("First")), PDFDict);
    const b = saved.context.lookup(root.get(N("Last")), PDFDict);
    expect(a.get(N("Title"))).toBeInstanceOf(PDFHexString);
    expect(b.get(N("Title"))).toBeInstanceOf(PDFHexString);
    expect(out.saved.items.map((n) => n.title)).toEqual([
      "Plain (ASCII)",
      "Бангла বাংলা",
    ]);
    const plain = await writePdfBookmarks(bytes, {
      items: [{ ...node, title: "Plain text" }],
      showPanel: false,
    });
    const p = await PDFDocument.load(plain.bytes);
    const pr = p.catalog.lookup(N("Outlines"), PDFDict);
    expect(
      p.context.lookup(pr.get(N("First")), PDFDict).get(N("Title")),
    ).toBeInstanceOf(PDFString);
    await expect(
      writePdfBookmarks(bytes, {
        items: [{ ...node, title: "y".repeat(BOOKMARK_TITLE_MAX + 1) }],
        showPanel: false,
      }),
    ).rejects.toMatchObject({ reason: "title-too-long" });
  });

  it("sets, keeps or deletes /PageMode, and removes /Outlines when the list is emptied", async () => {
    const doc = await blankPages(2);
    addOutline(doc, [{ title: "Only", dest: fitDest(doc, 0) }]);
    doc.catalog.set(N("PageMode"), N("UseOutlines"));
    const bytes = await doc.save();
    const before = await readOutlineTree(bytes);
    expect(before.pageMode).toBe("outlines");
    const off = await writePdfBookmarks(bytes, {
      items: before.items,
      showPanel: false,
    });
    expect(off.saved.pageMode).toBe("none");
    const on = await writePdfBookmarks(bytes, {
      items: before.items,
      showPanel: true,
    });
    expect(on.saved.pageMode).toBe("outlines");
    const empty = await writePdfBookmarks(bytes, {
      items: [],
      showPanel: true,
    });
    const e = await PDFDocument.load(empty.bytes);
    expect(e.catalog.get(N("Outlines"))).toBeUndefined();
    expect(e.catalog.get(N("PageMode"))).toBeUndefined();
    expect(markersFound(empty.bytes, ["Only"])).toEqual([]);
    // Another mode is the file's own: kept when the panel is not asked for.
    doc.catalog.set(N("PageMode"), N("UseThumbs"));
    const thumbs = await doc.save();
    const kept = await writePdfBookmarks(thumbs, {
      items: (await readOutlineTree(thumbs)).items,
      showPanel: false,
    });
    const k = await PDFDocument.load(kept.bytes);
    expect(k.catalog.get(N("PageMode"))).toBe(N("UseThumbs"));
  });

  it("a page past the end is refused, typed, before anything changes", async () => {
    const doc = await blankPages(2);
    addOutline(doc, [{ title: "A", dest: fitDest(doc, 0) }]);
    const bytes = await doc.save();
    const before = await readOutlineTree(bytes);
    const items = retarget(before.items, before.items[0]!.id, {
      kind: "page",
      page: 3,
    });
    const err = await writePdfBookmarks(bytes, {
      items,
      showPanel: false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BookmarksRefusal);
    expect((err as BookmarksRefusal).reason).toBe("bad-page");
    expect((err as Error).message).toContain("page 3");
  });
});

describe("deleted bookmarks leave no title in the saved file", () => {
  const GONE_ASCII = "Secret-Ledger-Section";
  const GONE_UTF16 = "Μυστικό-κεφάλαιο";
  const KEPT = "Kept-Overview-Chapter";

  /**
   * The deleted items are ALSO named by things that stay: a link
   * annotation's vendor key, and a /Names tree entry. Without the cut they
   * would survive as reachable objects.
   */
  async function referencedFixture() {
    const doc = await blankPages(2);
    const built = addOutline(doc, [
      { title: KEPT, dest: fitDest(doc, 0) },
      {
        title: GONE_ASCII,
        dest: fitDest(doc, 1),
        kids: [{ title: GONE_UTF16, dest: fitDest(doc, 1) }],
      },
    ]);
    const ctx = doc.context;
    const link = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [0, 0, 10, 10],
        Dest: fitDest(doc, 0),
        VendorOutlineItem: built.refs.get(GONE_ASCII)!,
      }),
    );
    doc.getPage(0).node.set(N("Annots"), ctx.obj([link]));
    doc.catalog.set(
      N("Names"),
      ctx.obj({
        JavaScript: ctx.obj({
          Names: ctx.obj([lit("x"), built.refs.get(GONE_UTF16)!]),
        }),
      }),
    );
    return { bytes: await doc.save({ useObjectStreams: false }), built };
  }

  it("positive control: the input carries all three titles, and the fixture needs the cut", async () => {
    const { bytes } = await referencedFixture();
    expect(markersFound(bytes, [GONE_ASCII, GONE_UTF16, KEPT])).toEqual([
      GONE_ASCII,
      GONE_UTF16,
      KEPT,
    ]);
    // Without a cut, dropping /Outlines and pruning keeps both: something
    // still names each deleted item.
    const lib = await loadPdfLib();
    const doc = await PDFDocument.load(bytes);
    doc.catalog.delete(N("Outlines"));
    pruneUnreachable(lib, doc);
    expect(markersFound(await doc.save(), [GONE_ASCII, GONE_UTF16])).toEqual([
      GONE_ASCII,
      GONE_UTF16,
    ]);
  });

  it("deleted ASCII and UTF-16BE titles are in no parsed or decoded object; the kept title is", async () => {
    const { bytes } = await referencedFixture();
    const before = await readOutlineTree(bytes);
    const gone = before.items.find((n) => n.title === GONE_ASCII)!;
    const out = await writePdfBookmarks(bytes, {
      items: remove(before.items, gone.id),
      showPanel: false,
    });
    const scan = decodedScan(out.bytes);
    // Health check: the reader read objects and decoded streams, object
    // streams included (pdf-lib saves with them).
    expect(scan.stats.objects).toBeGreaterThanOrEqual(2);
    expect(scan.stats.strings).toBeGreaterThan(3);
    expect(scan.stats.decoded).toBeGreaterThan(0);
    expect(scan.stats.objectStreams).toBeGreaterThan(0);
    expect(scan.stats.overBudget).toBe(0);
    expect(scan.corpus.includes(KEPT)).toBe(true);
    expect(scan.corpus.includes(GONE_ASCII)).toBe(false);
    expect(scan.corpus.includes(GONE_UTF16)).toBe(false);
    expect(out.saved.items.map((n) => n.title)).toEqual([KEPT]);
    // The link that named the deleted item is still on its page.
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPage(0).node.lookup(N("Annots"), PDFArray).size()).toBe(1);
  });

  it("a renamed item's old title is gone too", async () => {
    const { bytes } = await referencedFixture();
    const before = await readOutlineTree(bytes);
    const gone = before.items.find((n) => n.title === GONE_ASCII)!;
    const out = await writePdfBookmarks(bytes, {
      items: rename(before.items, gone.id, "Public section"),
      showPanel: false,
    });
    expect(markersFound(out.bytes, [GONE_ASCII, "Public section"])).toEqual([
      "Public section",
    ]);
  });
});

describe("hostile outlines", () => {
  it("a /Next cycle is cut and counted; nothing is read twice", async () => {
    const doc = await blankPages(2);
    const built = addOutline(doc, [
      { title: "One", dest: fitDest(doc, 0) },
      { title: "Two", dest: fitDest(doc, 1) },
    ]);
    const two = doc.context.lookup(built.refs.get("Two")!, PDFDict);
    two.set(N("Next"), built.refs.get("One")!);
    const r = await readOutlineTree(await doc.save());
    expect(r.items.map((n) => n.title)).toEqual(["One", "Two"]);
    expect(r.cutLinks).toBe(1);
  });

  it("a /First naming an ancestor is cut; the result is a sound outline", async () => {
    const doc = await blankPages(2);
    const built = addOutline(doc, [
      {
        title: "Parent",
        dest: fitDest(doc, 0),
        kids: [{ title: "Child", dest: fitDest(doc, 1) }],
      },
    ]);
    const child = doc.context.lookup(built.refs.get("Child")!, PDFDict);
    child.set(N("First"), built.refs.get("Parent")!);
    child.set(N("Count"), PDFNumber.of(5));
    const bytes = await doc.save();
    const r = await readOutlineTree(bytes);
    expect(shape(r.items)).toEqual([
      {
        title: "Parent",
        target: "page 1",
        kids: [{ title: "Child", target: "page 2" }],
      },
    ]);
    expect(r.cutLinks).toBe(1);
    const out = await writePdfBookmarks(bytes, {
      items: r.items,
      showPanel: false,
    });
    await checkStructure(out.bytes);
    expect(out.saved.cutLinks).toBe(0);
  });

  it("a /First naming a page is cut, and the page is not touched", async () => {
    const doc = await blankPages(2);
    const built = addOutline(doc, [{ title: "A", dest: fitDest(doc, 0) }]);
    doc.context
      .lookup(built.refs.get("A")!, PDFDict)
      .set(N("First"), doc.getPage(1).ref);
    const bytes = await doc.save();
    const r = await readOutlineTree(bytes);
    expect(r.cutLinks).toBe(1);
    const out = await writePdfBookmarks(bytes, {
      items: r.items,
      showPanel: false,
    });
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(2);
  });

  it("/Count that lies is read for its sign only", async () => {
    const doc = await blankPages(2);
    addOutline(doc, [
      {
        title: "P",
        dest: fitDest(doc, 0),
        count: 99999,
        kids: [{ title: "C", dest: fitDest(doc, 1) }],
      },
      { title: "Leaf", dest: fitDest(doc, 1), count: 7 },
    ]);
    const bytes = await doc.save();
    const r = await readOutlineTree(bytes);
    expect(r.total).toBe(3);
    expect(r.items[0]!.open).toBe(true);
    expect(r.items[1]!.open).toBe(false);
    const out = await writePdfBookmarks(bytes, {
      items: r.items,
      showPanel: false,
    });
    await checkStructure(out.bytes);
  });

  it(`nesting past ${BOOKMARK_DEPTH_MAX} levels is refused as a damaged outline`, async () => {
    const doc = await blankPages(1);
    let spec = { title: "leaf", dest: fitDest(doc, 0) } as Parameters<
      typeof addOutline
    >[1][number];
    for (let i = 0; i < BOOKMARK_DEPTH_MAX; i += 1) {
      spec = { title: `L${i}`, dest: fitDest(doc, 0), kids: [spec] };
    }
    addOutline(doc, [spec]);
    const err = await readOutlineTree(await doc.save()).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BookmarksRefusal);
    expect((err as BookmarksRefusal).reason).toBe("damaged-outline");
    // Exactly the cap reads.
    const ok = await blankPages(1);
    let at = { title: "leaf", dest: fitDest(ok, 0) } as Parameters<
      typeof addOutline
    >[1][number];
    for (let i = 0; i < BOOKMARK_DEPTH_MAX - 1; i += 1) {
      at = { title: `L${i}`, kids: [at] };
    }
    addOutline(ok, [at]);
    expect((await readOutlineTree(await ok.save())).depth).toBe(
      BOOKMARK_DEPTH_MAX,
    );
  });

  /** `n` top-level items, written fast: no per-item spec objects. */
  async function manyItems(n: number): Promise<Uint8Array> {
    const doc = await blankPages(1);
    const ctx = doc.context;
    const root = ctx.nextRef();
    const refs = Array.from({ length: n }, () => ctx.nextRef());
    const page = doc.getPage(0).ref;
    refs.forEach((ref, i) => {
      const entries: Record<string, unknown> = {
        Title: PDFString.of(`B${i}`),
        Parent: root,
        Dest: [page, "Fit"],
      };
      if (i > 0) entries.Prev = refs[i - 1];
      if (i < n - 1) entries.Next = refs[i + 1];
      ctx.assign(ref, ctx.obj(entries as never));
    });
    ctx.assign(
      root,
      ctx.obj({
        Type: "Outlines",
        First: refs[0]!,
        Last: refs.at(-1)!,
        Count: 3,
      }),
    );
    doc.catalog.set(N("Outlines"), root);
    return doc.save({ useObjectStreams: false });
  }

  it(`more than ${BOOKMARK_EDIT_MAX} bookmarks is refused with the count, never truncated`, async () => {
    const at = await readOutlineTree(await manyItems(BOOKMARK_EDIT_MAX));
    expect(at.total).toBe(BOOKMARK_EDIT_MAX);
    const err = await readOutlineTree(
      await manyItems(BOOKMARK_EDIT_MAX + 1),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TooManyBookmarksError);
    expect(err).toMatchObject({
      reason: "too-many-bookmarks",
      count: BOOKMARK_EDIT_MAX + 1,
      max: BOOKMARK_EDIT_MAX,
      atLeast: false,
    });
    expect((err as Error).message).toContain("5,001");
    expect((err as Error).message).toContain("5,000");
  }, 120_000);

  it("100,000+ bookmarks stop the count at the walk limit and say 'more than'", async () => {
    const err = await readOutlineTree(
      await manyItems(OUTLINE_WALK_MAX + 5),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({
      reason: "too-many-bookmarks",
      count: OUTLINE_WALK_MAX,
      atLeast: true,
    });
    expect((err as Error).message).toContain("more than 100,000");
    // No time bound here: the walk itself is milliseconds, and the ~12 s
    // alone (60-74 s under a parallel load, measured 2026-11-10) is pdf-lib
    // parsing 100,000 objects, which a wall-clock assertion would only make
    // flaky. The budget below is vitest's, not a claim.
  }, 300_000);

  it("a writer asked for more than the limit refuses too", async () => {
    const doc = await blankPages(1);
    const bytes = await doc.save();
    const items: BookmarkNode[] = Array.from(
      { length: BOOKMARK_EDIT_MAX + 1 },
      (_, i) => ({
        id: `n${i}`,
        title: "t",
        target: { kind: "page", page: 1 },
        open: false,
        children: [],
      }),
    );
    await expect(
      writePdfBookmarks(bytes, { items, showPanel: false }),
    ).rejects.toMatchObject({
      reason: "too-many-bookmarks",
      count: BOOKMARK_EDIT_MAX + 1,
    });
  });

  it("a non-string /Title reads as an empty title; a malformed UTF-16 one is readable and survives unedited", async () => {
    const doc = await blankPages(2);
    // A BOM and an odd byte count: half a code unit at the end.
    const odd = PDFHexString.of("FEFF0041D800");
    addOutline(doc, [
      { title: PDFNumber.of(42), dest: fitDest(doc, 0) },
      { title: odd, dest: fitDest(doc, 1) },
    ]);
    const bytes = await doc.save();
    const r = await readOutlineTree(bytes);
    expect(r.items[0]!.title).toBe("");
    expect(r.items[1]!.title.startsWith("A")).toBe(true);
    expect(r.items[1]!.title).not.toMatch(/[\uD800-\uDFFF]/);
    const out = await writePdfBookmarks(bytes, {
      items: r.items,
      showPanel: false,
    });
    const saved = await PDFDocument.load(out.bytes);
    const root = saved.catalog.lookup(N("Outlines"), PDFDict);
    const second = saved.context.lookup(root.get(N("Last")), PDFDict);
    expect([...(second.get(N("Title")) as PDFHexString).asBytes()]).toEqual([
      ...odd.asBytes(),
    ]);
  });

  it("a destination to a missing page or a non-page is kept with no page, and counted", async () => {
    const doc = await blankPages(2);
    const ctx = doc.context;
    const notAPage = ctx.register(ctx.obj({ Foo: 1 }));
    addOutline(doc, [
      { title: "Past end", dest: ctx.obj([PDFNumber.of(9), N("Fit")]) },
      { title: "Not a page", dest: ctx.obj([notAPage, N("Fit")]) },
      { title: "Unknown name", dest: N("Nowhere") },
      { title: "Good", dest: fitDest(doc, 1) },
    ]);
    const bytes = await doc.save();
    const r = await readOutlineTree(bytes);
    expect(shape(r.items)).toEqual([
      { title: "Past end", target: "none" },
      { title: "Not a page", target: "none" },
      { title: "Unknown name", target: "none" },
      { title: "Good", target: "page 2" },
    ]);
    expect(r.brokenTargets).toBe(3);
    const out = await writePdfBookmarks(bytes, {
      items: r.items,
      showPanel: false,
    });
    expect(out.saved.brokenTargets).toBe(0);
    expect(shape(out.saved.items)).toEqual(shape(r.items));
  });
});

describe("a damaged link never cuts what the rest of the file uses", () => {
  /**
   * Review round 1: the walk took any typeless dictionary a damaged /Next or
   * /First reached for an outline item, and CUT it at save, whatever else
   * named it. An AcroForm and a page's /Resources have no /Type.
   */
  async function formFixture() {
    const doc = await blankPages(2);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.getPage(0).drawText("Drawn text", { x: 20, y: 300, font, size: 12 });
    doc.getForm().createTextField("kept.field").addToPage(doc.getPage(1));
    const ctx = doc.context;
    // Both as indirect objects, so a link can name them.
    const page0 = doc.getPage(0).node;
    const resources = ctx.register(page0.lookup(N("Resources"), PDFDict));
    page0.set(N("Resources"), resources);
    let acro = doc.catalog.get(N("AcroForm"))!;
    if (!(acro instanceof PDFRef)) {
      acro = ctx.register(ctx.lookup(acro, PDFDict));
      doc.catalog.set(N("AcroForm"), acro);
    }
    const built = addOutline(doc, [
      { title: "A", dest: fitDest(doc, 0) },
      { title: "B", dest: fitDest(doc, 1) },
    ]);
    ctx.lookup(built.refs.get("B")!, PDFDict).set(N("Next"), acro);
    ctx.lookup(built.refs.get("A")!, PDFDict).set(N("First"), resources);
    return doc.save({ useObjectStreams: false });
  }

  it("a /Next to the AcroForm and a /First to a page's /Resources are cut and counted, and both survive the save", async () => {
    const bytes = await formFixture();
    // Health check: the input has the form, the field and the resources.
    const src = await PDFDocument.load(bytes);
    expect(src.getForm().getFields().length).toBe(1);
    expect(src.getPage(0).node.get(N("Resources"))).toBeInstanceOf(PDFRef);
    const r = await readOutlineTree(bytes);
    expect(shape(r.items)).toEqual([
      { title: "A", target: "page 1" },
      { title: "B", target: "page 2" },
    ]);
    expect(r.cutLinks).toBe(2);
    const out = await writePdfBookmarks(bytes, {
      items: r.items,
      showPanel: false,
    });
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.catalog.lookup(N("AcroForm"))).toBeInstanceOf(PDFDict);
    expect(
      doc
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(["kept.field"]);
    const res = doc.getPage(0).node.lookup(N("Resources"));
    expect(res).toBeInstanceOf(PDFDict);
    expect((res as PDFDict).lookup(N("Font"))).toBeInstanceOf(PDFDict);
    await checkStructure(out.bytes);
  });

  it("an item carrying /Type is read with its children and the siblings after it, and kept", async () => {
    const doc = await blankPages(3);
    const built = addOutline(doc, [
      { title: "First", dest: fitDest(doc, 0) },
      {
        title: "Typed",
        dest: fitDest(doc, 1),
        extra: { Type: N("Outlines") },
        kids: [{ title: "Typed kid", dest: fitDest(doc, 1) }],
      },
      { title: "After", dest: fitDest(doc, 2) },
    ]);
    expect(built.order.length).toBe(4);
    const bytes = await doc.save();
    const r = await readOutlineTree(bytes);
    expect(shape(r.items)).toEqual([
      { title: "First", target: "page 1" },
      {
        title: "Typed",
        target: "page 2",
        kids: [{ title: "Typed kid", target: "page 2" }],
      },
      { title: "After", target: "page 3" },
    ]);
    expect(r.cutLinks).toBe(0);
    const out = await writePdfBookmarks(bytes, {
      items: r.items,
      showPanel: false,
    });
    expect(shape(out.saved.items)).toEqual(shape(r.items));
  });

  it("positive control: an item with no /Parent that nothing else names is still read as an item", async () => {
    const doc = await blankPages(2);
    const built = addOutline(doc, [
      { title: "One", dest: fitDest(doc, 0) },
      { title: "Orphan", dest: fitDest(doc, 1), extra: { Type: N("Page") } },
    ]);
    doc.context.lookup(built.refs.get("Orphan")!, PDFDict).delete(N("Parent"));
    const r = await readOutlineTree(await doc.save());
    expect(r.items.map((n) => n.title)).toEqual(["One", "Orphan"]);
    expect(r.cutLinks).toBe(0);
  });
});

describe("what a deleted bookmark leaves, and what the page says it leaves", () => {
  it("a named destination a deleted bookmark used stays; the page discloses exactly that", async () => {
    const doc = await blankPages(2);
    const ctx = doc.context;
    const NAME = "Project Falcon";
    doc.catalog.set(
      N("Names"),
      ctx.obj({
        Dests: ctx.register(
          ctx.obj({ Names: ctx.obj([lit(NAME), fitDest(doc, 1)]) }),
        ),
      }),
    );
    addOutline(doc, [
      { title: "Intro", dest: fitDest(doc, 0) },
      { title: NAME, dest: lit(NAME) },
    ]);
    const bytes = await doc.save({ useObjectStreams: false });
    const r = await readOutlineTree(bytes);
    expect(shape(r.items)).toEqual([
      { title: "Intro", target: "page 1" },
      { title: NAME, target: "page 2" },
    ]);
    const out = await writePdfBookmarks(bytes, {
      items: r.items.slice(0, 1),
      showPanel: false,
    });
    expect(out.saved.items.map((n) => n.title)).toEqual(["Intro"]);
    // The title string is gone from the outline; the destination's key, the
    // same words, is not.
    const survives = markersFound(out.bytes, [NAME]).length > 0;
    expect(survives).toBe(true);
    // The relationship, not a string: while the name survives, every place
    // the page promises a deleted title is gone also says a named
    // destination stays. Drop the name tree entry, and this must change.
    const page = await import("@/lib/tools/content/edit-pdf-bookmarks");
    const promises = [
      ...page.default.intro,
      ...page.default.useCases.map((u) => u.body),
      ...page.default.faqs.map((f) => f.a),
    ].filter((t) => /title is (gone|not in)|with its title/.test(t));
    expect(promises.length).toBeGreaterThanOrEqual(3);
    for (const t of promises)
      expect(/named destination/.test(t), t).toBe(survives);
    expect(page.default.metaDescription).not.toMatch(/no title behind/);
  });
});

describe("what the reading counts and decodes", () => {
  it("a JavaScript /A beside a /Dest is counted as dropped, and is not in the copy", async () => {
    const doc = await blankPages(2);
    addOutline(doc, [
      {
        title: "Both",
        dest: fitDest(doc, 1),
        action: action(doc, { S: N("JavaScript"), JS: lit("app.alert(1)") }),
      },
    ]);
    const bytes = await doc.save({ useObjectStreams: false });
    expect(markersFound(bytes, ["app.alert"])).toEqual(["app.alert"]);
    const r = await readOutlineTree(bytes);
    expect(shape(r.items)).toEqual([{ title: "Both", target: "page 2" }]);
    expect(r.droppedActions).toBe(1);
    const out = await writePdfBookmarks(bytes, {
      items: r.items,
      showPanel: false,
    });
    expect(out.droppedActions).toBe(1);
    expect(decodedScan(out.bytes).corpus.includes("app.alert")).toBe(false);
  });

  it("titles stored as UTF-8 with a BOM, or UTF-16LE with a BOM, read as text and survive unedited byte for byte", async () => {
    const text = "Café ক";
    const hex = (bytes: Iterable<number>) =>
      [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const utf8 = "efbbbf" + hex(new TextEncoder().encode(text));
    const le: number[] = [0xff, 0xfe];
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      le.push(c & 0xff, c >> 8);
    }
    const doc = await blankPages(1);
    addOutline(doc, [
      { title: PDFHexString.of(utf8), dest: fitDest(doc, 0) },
      { title: PDFHexString.of(hex(le)), dest: fitDest(doc, 0) },
      { title: "Plain", dest: fitDest(doc, 0) },
    ]);
    const bytes = await doc.save();
    const r = await readOutlineTree(bytes);
    expect(r.items.map((n) => n.title)).toEqual([text, text, "Plain"]);
    const out = await writePdfBookmarks(bytes, {
      items: r.items,
      showPanel: false,
    });
    const saved = await PDFDocument.load(out.bytes);
    const first = saved.catalog
      .lookup(N("Outlines"), PDFDict)
      .lookup(N("First"), PDFDict);
    expect((first.lookup(N("Title")) as PDFHexString).asString()).toBe(utf8);
    expect(out.saved.items.map((n) => n.title)).toEqual([text, text, "Plain"]);
  });
});

/** Every node, depth first. */
function* flat(items: readonly BookmarkNode[]): Generator<BookmarkNode> {
  for (const n of items) {
    yield n;
    yield* flat(n.children);
  }
}
