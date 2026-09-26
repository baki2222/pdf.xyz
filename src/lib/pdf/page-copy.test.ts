import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFPageLeaf,
  PDFRawStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  type PDFObject,
} from "pdf-lib";
import {
  deletePages,
  extractPages,
  mergePdfs,
  organizePages,
  splitPdf,
} from "./engine";
import { buildSplitParts, rangesPerPage } from "./ranges";

/**
 * What a page tool's OUTPUT FILE carries — read the way an attacker with a PDF
 * inspector would, not the way a viewer renders it.
 *
 * The defect this pins: `out.copyPages(src, keep)` deep-copies everything a kept
 * page REFERENCES, and a page references other pages through annotations — a
 * table-of-contents Link's `/Dest`, a GoTo action, a form widget's `/Parent`
 * whose `/Kids` hold the widgets of every other page, an article bead's `/P`.
 * Each of those arrives as an orphan page object outside the page tree. It does
 * not render, so every viewer-level check passes; but pdf-lib's writer saves
 * every object in the context, reachable or not, so the page the user split
 * away, extracted around, or DELETED ships inside the file, text and form values
 * included. Measured at 67e8d0f: a 1-page extract of a 3-page filled form
 * carried `SECRET-VALUE-P2` and `SECRET-VALUE-P3`; a 1-page split of a 4-page
 * LiveCycle-shaped form was the size of the whole input.
 *
 * The oracle has to DECODE: pdf-lib writes `drawText` as hex strings inside
 * Flate streams, so a raw-byte `includes()` reports "clean" on a leaking file.
 * Every stream is inflated, every `<hex>` token is decoded, and every string
 * object is read through `decodeText()` (UTF-16BE included). The positive
 * control below proves the oracle can see every marker in the INPUT, so an
 * absence in the output means absence, not blindness.
 */

// --------------------------------------------------------------------------
// The oracle
// --------------------------------------------------------------------------

const latin1 = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join("");

const hexToLatin1 = (hex: string): string => {
  const clean = hex.replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
};

interface Inspection {
  /** Every string and every decoded stream byte in the file, as text. */
  text: string;
  /** Page dictionaries anywhere in the file — inside the tree or orphaned. */
  pageDicts: number;
  /** Pages in the document's page tree. */
  pageCount: number;
  doc: PDFDocument;
}

async function inspect(bytes: Uint8Array): Promise<Inspection> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts: string[] = [];
  const seen = new Set<PDFObject>();
  const visit = (obj: PDFObject | undefined): void => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof PDFString || obj instanceof PDFHexString) {
      parts.push(obj.decodeText());
    } else if (obj instanceof PDFArray) {
      obj.asArray().forEach(visit);
    } else if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) visit(value);
    } else if (obj instanceof PDFRawStream) {
      visit(obj.dict);
      let decoded: string;
      try {
        decoded = latin1(decodePDFRawStream(obj).decode());
      } catch {
        decoded = latin1(obj.getContents());
      }
      parts.push(decoded);
      for (const m of decoded.matchAll(/<([0-9A-Fa-f\s]*)>/g)) {
        parts.push(hexToLatin1(m[1] ?? ""));
      }
    }
  };
  let pageDicts = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (
      obj instanceof PDFPageLeaf ||
      (obj instanceof PDFDict &&
        obj.get(PDFName.of("Type")) === PDFName.of("Page"))
    ) {
      pageDicts += 1;
    }
    visit(obj);
  }
  return {
    text: parts.join("\n"),
    pageDicts,
    pageCount: doc.getPageCount(),
    doc,
  };
}

const bodyMarker = (page: number) => `BODY-TEXT-P${page}`;
const secretMarker = (page: number) => `SECRET-VALUE-P${page}`;

// --------------------------------------------------------------------------
// Fixtures — each a real shape: a clickable TOC, a GoTo action, a LiveCycle-
// style form tree (`topmostSubform.PageN.fN`), and article threads.
// --------------------------------------------------------------------------

async function withBodies(pageCount: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 300]);
    page.drawText(bodyMarker(i + 1), { x: 20, y: 150, size: 12, font });
  }
  return doc;
}

function addAnnot(doc: PDFDocument, pageIndex: number, annot: PDFDict) {
  const page = doc.getPage(pageIndex);
  const ref = doc.context.register(annot);
  const existing = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
  return ref;
}

/** Page 1 carries a TOC: a `/Dest` link to page 3 and a GoTo link to page 2. */
async function linkedDoc(): Promise<Uint8Array> {
  const doc = await withBodies(3);
  const [, p2, p3] = doc.getPages();
  addAnnot(
    doc,
    0,
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 10, 60, 30],
      Border: [0, 0, 0],
      Dest: [p3!.ref, "Fit"],
    }),
  );
  addAnnot(
    doc,
    0,
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 40, 60, 60],
      Border: [0, 0, 0],
      A: { S: "GoTo", D: [p2!.ref, "Fit"] },
    }),
  );
  return doc.save();
}

/**
 * Three pages, one filled field per page under a shared non-terminal root, plus
 * one field whose two widgets sit on pages 1 and 3.
 */
async function formDoc(): Promise<Uint8Array> {
  const doc = await withBodies(3);
  doc.setTitle("Tax Form 2026");
  const form = doc.getForm();
  doc.getPages().forEach((page, i) => {
    const field = form.createTextField(`topmostSubform.Page${i + 1}.f${i + 1}`);
    field.setText(secretMarker(i + 1));
    field.addToPage(page, { x: 20, y: 40, width: 200, height: 24 });
  });
  const shared = form.createTextField("topmostSubform.shared");
  shared.setText("SHARED-VALUE");
  shared.addToPage(doc.getPage(0), { x: 20, y: 80, width: 200, height: 24 });
  shared.addToPage(doc.getPage(2), { x: 20, y: 80, width: 200, height: 24 });
  return doc.save();
}

/** An article thread whose beads run p1 → p3 → p1. */
async function beadDoc(): Promise<Uint8Array> {
  const doc = await withBodies(3);
  const [p1, , p3] = doc.getPages();
  const threadRef = doc.context.nextRef();
  const b1Ref = doc.context.nextRef();
  const b3Ref = doc.context.nextRef();
  doc.context.assign(
    b1Ref,
    doc.context.obj({
      Type: "Bead",
      T: threadRef,
      N: b3Ref,
      V: b3Ref,
      P: p1!.ref,
      R: [0, 0, 100, 100],
    }),
  );
  doc.context.assign(
    b3Ref,
    doc.context.obj({
      Type: "Bead",
      N: b1Ref,
      V: b1Ref,
      P: p3!.ref,
      R: [0, 0, 100, 100],
    }),
  );
  doc.context.assign(threadRef, doc.context.obj({ Type: "Thread", F: b1Ref }));
  p1!.node.set(PDFName.of("B"), doc.context.obj([b1Ref]));
  p3!.node.set(PDFName.of("B"), doc.context.obj([b3Ref]));
  doc.catalog.set(PDFName.of("Threads"), doc.context.obj([threadRef]));
  return doc.save();
}

// --------------------------------------------------------------------------
// Every tool that builds a new document from a SUBSET of the source's pages,
// asked to keep page 1 only. Split and organize are included because they take
// the same path; merge keeps every page and is checked separately below.
// --------------------------------------------------------------------------

const KEEP_FIRST_ONLY: {
  tool: string;
  run: (bytes: Uint8Array) => Promise<Uint8Array>;
}[] = [
  { tool: "extract-pages", run: (b) => extractPages(b, [0]) },
  { tool: "remove-pages", run: (b) => deletePages(b, [1, 2]) },
  {
    tool: "split-pdf",
    run: async (b) =>
      (await splitPdf(b, buildSplitParts("doc", rangesPerPage(3))))[0]!.bytes,
  },
  {
    tool: "organize-pages",
    run: (b) => organizePages(b, [{ sourceIndex: 0, rotation: 0 }]),
  },
];

const FIXTURES: {
  name: string;
  build: () => Promise<Uint8Array>;
  excluded: string[];
}[] = [
  {
    name: "a TOC link (/Dest) and a GoTo action into dropped pages",
    build: linkedDoc,
    excluded: [bodyMarker(2), bodyMarker(3)],
  },
  {
    name: "a form whose field tree spans every page",
    build: formDoc,
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "an article thread (beads) running into a dropped page",
    build: beadDoc,
    excluded: [bodyMarker(3)],
  },
];

describe("page tools ship only the pages the user kept", () => {
  it("POSITIVE CONTROL: the oracle finds every marker in each input", async () => {
    for (const fixture of FIXTURES) {
      const input = await inspect(await fixture.build());
      for (const marker of [bodyMarker(1), ...fixture.excluded]) {
        expect(input.text, `${fixture.name}: ${marker}`).toContain(marker);
      }
    }
  });

  for (const fixture of FIXTURES) {
    for (const op of KEEP_FIRST_ONLY) {
      it(`${op.tool}: ${fixture.name}`, async () => {
        const out = await inspect(await op.run(await fixture.build()));
        expect(out.pageCount).toBe(1);
        // The kept page is really there — the absence below is not an empty file.
        expect(out.text).toContain(bodyMarker(1));
        for (const marker of fixture.excluded) {
          expect(out.text, `${marker} leaked into ${op.tool}`).not.toContain(
            marker,
          );
        }
        // No page object anywhere in the file except the one in the tree.
        expect(out.pageDicts).toBe(out.pageCount);
      });
    }
  }

  it("a link whose target WAS kept still points at that page in the output", async () => {
    const out = await inspect(await extractPages(await linkedDoc(), [0, 2]));
    expect(out.pageCount).toBe(2);
    expect(out.pageDicts).toBe(2);
    const [first, second] = out.doc.getPages();
    const annots = first!.node.lookup(PDFName.of("Annots"), PDFArray);
    const dests = annots
      .asArray()
      .map((ref) => out.doc.context.lookup(ref, PDFDict))
      .map((a) => a.lookupMaybe(PDFName.of("Dest"), PDFArray))
      .filter((d): d is PDFArray => d !== undefined);
    // The /Dest link (→ p3, kept) survives and targets the kept copy of p3; the
    // GoTo link (→ p2, dropped) is gone rather than pointing into nothing.
    expect(dests).toHaveLength(1);
    expect(dests[0]!.get(0)).toBe(second!.ref);
    expect(annots.size()).toBe(1);
  });

  it("merge keeps in-document links on the merged pages, with no duplicate pages", async () => {
    const out = await inspect(
      await mergePdfs([await linkedDoc(), await linkedDoc()]),
    );
    expect(out.pageCount).toBe(6);
    // Before: every internal link dragged in a second, orphan copy of its target.
    expect(out.pageDicts).toBe(6);
    const pages = out.doc.getPages();
    const destOf = (pageIndex: number) =>
      pages[pageIndex]!.node.lookup(PDFName.of("Annots"), PDFArray)
        .asArray()
        .map((ref) => out.doc.context.lookup(ref, PDFDict))
        .map((a) => a.lookupMaybe(PDFName.of("Dest"), PDFArray))
        .find((d) => d !== undefined)!;
    expect(destOf(0).get(0)).toBe(pages[2]!.ref);
    expect(destOf(3).get(0)).toBe(pages[5]!.ref);
  });

  it("a one-page part is sized like one page, not like the document its TOC points into", async () => {
    // Twelve pages of incompressible payload; page 1 links to every other page.
    const doc = await withBodies(12);
    let seed = 7;
    const noise = () => {
      const bytes = new Uint8Array(24_000);
      for (let i = 0; i < bytes.length; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        bytes[i] = seed >>> 24;
      }
      return bytes;
    };
    for (const page of doc.getPages()) {
      const blob = doc.context.register(doc.context.stream(noise()));
      page.node.set(
        PDFName.of("PieceInfo"),
        doc.context.obj({ Payload: { Private: blob } }),
      );
    }
    for (const target of doc.getPages().slice(1)) {
      addAnnot(
        doc,
        0,
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [0, 0, 10, 10],
          Dest: [target.ref, "Fit"],
        }),
      );
    }
    const bytes = await doc.save();
    const parts = await splitPdf(
      bytes,
      buildSplitParts("doc", rangesPerPage(12)),
    );
    const toc = parts[0]!.bytes.byteLength;
    const plain = parts[5]!.bytes.byteLength;
    expect(toc).toBeLessThan(plain * 1.5);
    // And the fixture really is what it claims: the input is ~12 pages of it.
    expect(bytes.byteLength).toBeGreaterThan(plain * 10);
  });
});

describe("page tools keep a fillable form fillable", () => {
  const fieldValues = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    return Object.fromEntries(
      doc
        .getForm()
        .getFields()
        .map((f) => [
          f.getName(),
          doc.getForm().getTextField(f.getName()).getText(),
        ]),
    );
  };

  it("POSITIVE CONTROL: the source form has four fields", async () => {
    expect(Object.keys(await fieldValues(await formDoc()))).toHaveLength(4);
  });

  it("extract-pages keeps the fields on the extracted pages, with their values", async () => {
    const out = await extractPages(await formDoc(), [1, 2]);
    expect(await fieldValues(out)).toEqual({
      "topmostSubform.Page2.f2": secretMarker(2),
      "topmostSubform.Page3.f3": secretMarker(3),
      "topmostSubform.shared": "SHARED-VALUE",
    });
    // The shared field kept exactly its one widget on a kept page.
    const doc = await PDFDocument.load(out);
    expect(
      doc
        .getForm()
        .getTextField("topmostSubform.shared")
        .acroField.getWidgets(),
    ).toHaveLength(1);
  });

  it("remove-pages keeps every field that sits on a remaining page", async () => {
    const out = await deletePages(await formDoc(), [0]);
    expect(Object.keys(await fieldValues(out)).sort()).toEqual([
      "topmostSubform.Page2.f2",
      "topmostSubform.Page3.f3",
      "topmostSubform.shared",
    ]);
  });

  it("split-pdf gives each part its own page's fields", async () => {
    const parts = await splitPdf(
      await formDoc(),
      buildSplitParts("doc", rangesPerPage(3)),
    );
    expect(await fieldValues(parts[1]!.bytes)).toEqual({
      "topmostSubform.Page2.f2": secretMarker(2),
    });
  });

  it("organize-pages keeps the form of the pages it keeps", async () => {
    const out = await organizePages(await formDoc(), [
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 0, rotation: 90 },
    ]);
    expect(Object.keys(await fieldValues(out)).sort()).toEqual([
      "topmostSubform.Page1.f1",
      "topmostSubform.Page3.f3",
      "topmostSubform.shared",
    ]);
  });

  it("a carried field can be filled and saved (its /DA and /DR came along)", async () => {
    const out = await extractPages(await formDoc(), [1]);
    const doc = await PDFDocument.load(out);
    doc.getForm().getTextField("topmostSubform.Page2.f2").setText("NEW");
    const again = await PDFDocument.load(await doc.save());
    expect(
      again.getForm().getTextField("topmostSubform.Page2.f2").getText(),
    ).toBe("NEW");
  });

  it("keeps the document title", async () => {
    for (const out of [
      await extractPages(await formDoc(), [0]),
      await deletePages(await formDoc(), [0]),
      (
        await splitPdf(
          await formDoc(),
          buildSplitParts("doc", rangesPerPage(3)),
        )
      )[2]!.bytes,
      await organizePages(await formDoc(), [{ sourceIndex: 1, rotation: 0 }]),
    ]) {
      const doc = await PDFDocument.load(out);
      expect(doc.getTitle()).toBe("Tax Form 2026");
    }
  });
});

// --------------------------------------------------------------------------
// The set: a copy path that bypasses the clean assembler brings the defect back.
// DISCOVERED by walking src, not named — a new tool that calls pdf-lib's
// copyPages directly is exactly the one a list would not name.
// --------------------------------------------------------------------------

describe("no code path copies pages around the clean assembler", () => {
  const SRC = join(__dirname, "..", "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
        ? [path]
        : [];
    });
  const COPY_CALL = /\.copyPages\s*\(/;
  // Code, not prose: the assembler's docblock names the call it replaces, and
  // a guard that matches prose is guarding the wrong thing.
  const code = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const callsCopyPages = (source: string) => COPY_CALL.test(code(source));

  it("the pattern sees a copyPages call, and not a comment about one (controls)", () => {
    expect(callsCopyPages("const p = await out.copyPages(src, [0]);")).toBe(
      true,
    );
    expect(callsCopyPages("await out\n  .copyPages(\n src, keep)")).toBe(true);
    expect(
      callsCopyPages("/**\n * not `out.copyPages(src)`\n */\nconst a = 1;"),
    ).toBe(false);
    expect(callsCopyPages("  // out.copyPages(src)\nconst a = 1;")).toBe(false);
  });

  it("finds no direct copyPages call in shipped source", () => {
    const files = walk(SRC);
    // Health check: the walk really read the codebase, not an empty directory.
    expect(files.length).toBeGreaterThan(200);
    expect(files.map((f) => relative(SRC, f))).toContain(
      join("lib", "pdf", "engine.ts"),
    );
    const offenders = files
      .filter((f) => callsCopyPages(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
