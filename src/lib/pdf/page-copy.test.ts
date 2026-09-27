import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PDFArray,
  PDFBool,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPageLeaf,
  PDFRawStream,
  PDFRef,
  type PDFForm,
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
import { loadPdfjs } from "./pdfjs";
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
  /**
   * Every reference in the file that resolves to no object, as `N G R`. The
   * assembler copies a reference to a dropped page as a sentinel it never
   * assigns; an edge to it that nothing cut ships as exactly this.
   */
  dangling: string[];
  doc: PDFDocument;
}

async function inspect(bytes: Uint8Array): Promise<Inspection> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts: string[] = [];
  const dangling = new Set<string>();
  const seen = new Set<PDFObject>();
  const visit = (obj: PDFObject | undefined): void => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof PDFRef) {
      if (doc.context.lookup(obj) === undefined) dangling.add(obj.toString());
    } else if (obj instanceof PDFString || obj instanceof PDFHexString) {
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
  visit(doc.context.trailerInfo.Root);
  visit(doc.context.trailerInfo.Info);
  return {
    text: parts.join("\n"),
    pageDicts,
    pageCount: doc.getPageCount(),
    dangling: [...dangling],
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

const fieldName = (page: number) => `topmostSubform.Page${page}.f${page}`;

/**
 * Three pages, one filled field per page under a shared non-terminal root, plus
 * one field whose two widgets sit on pages 1 and 3. `decorate` adds to it
 * before saving.
 */
async function formDoc(
  decorate?: (doc: PDFDocument, form: PDFForm) => void,
): Promise<Uint8Array> {
  const doc = await withBodies(3);
  doc.setTitle("Tax Form 2026");
  const form = doc.getForm();
  doc.getPages().forEach((page, i) => {
    const field = form.createTextField(fieldName(i + 1));
    field.setText(secretMarker(i + 1));
    field.addToPage(page, { x: 20, y: 40, width: 200, height: 24 });
  });
  const shared = form.createTextField("topmostSubform.shared");
  shared.setText("SHARED-VALUE");
  shared.addToPage(doc.getPage(0), { x: 20, y: 80, width: 200, height: 24 });
  shared.addToPage(doc.getPage(2), { x: 20, y: 80, width: 200, height: 24 });
  decorate?.(doc, form);
  return doc.save();
}

/** The ref of a field's own dictionary — pdf-lib's fields are not merged. */
const fieldRef = (form: PDFForm, name: string) => form.getField(name).ref;

/**
 * The Acrobat "Submit selected fields" shape: a button on page 1 whose action
 * names fields BY REFERENCE, including the fields that live on pages 2 and 3.
 * `flags` 0 = submit exactly these; 1 = submit everything EXCEPT these.
 */
function submitButton(names: string[], flags = 0) {
  return (doc: PDFDocument, form: PDFForm) => {
    const button = form.createButton("submit");
    button.addToPage("Send", doc.getPage(0), {
      x: 20,
      y: 120,
      width: 80,
      height: 24,
    });
    button.acroField.getWidgets()[0]!.dict.set(
      PDFName.of("A"),
      doc.context.obj({
        S: "SubmitForm",
        F: { FS: "URL", F: PDFString.of("https://example.test/submit") },
        Fields: names.map((n) => fieldRef(form, n)),
        Flags: flags,
      }),
    );
  };
}

/**
 * Acrobat lets "submit selected fields" name a NON-terminal field, meaning all
 * of its descendants: here the `topmostSubform.PageN` node of a dropped page,
 * which has a name and kids but no field type and no value of its own.
 */
function submitSubform(page: number) {
  return (doc: PDFDocument, form: PDFForm) => {
    const subform = form
      .getTextField(fieldName(page))
      .acroField.dict.get(PDFName.of("Parent"));
    const button = form.createButton("submit");
    button.addToPage("Send", doc.getPage(0), {
      x: 20,
      y: 120,
      width: 80,
      height: 24,
    });
    button.acroField
      .getWidgets()[0]!
      .dict.set(
        PDFName.of("A"),
        doc.context.obj({ S: "SubmitForm", Fields: [subform!] }),
      );
  };
}

/**
 * Two legal field shapes pdf-lib never writes, each carrying the value only
 * ONE clause of the output's field-node test can see — pdf-lib's own fields
 * have both a type and a name, so they cannot tell the two clauses apart:
 *  - `untyped-parent`: a non-terminal field with a name and an inherited
 *    `/V` but no `/FT` (the type lives on its kid);
 *  - `unnamed-kid`: a terminal field with a type and a `/V` but no `/T` — the
 *    spec's "same fully qualified name as its parent" shape.
 * Both sit on page 3, and a submit button on kept page 1 names the node that
 * holds the value.
 */
function handBuiltField(shape: "untyped-parent" | "unnamed-kid") {
  return (doc: PDFDocument, form: PDFForm) => {
    const ctx = doc.context;
    const parentRef = ctx.nextRef();
    const kidRef = ctx.nextRef();
    const value = PDFString.of(secretMarker(3));
    ctx.assign(
      parentRef,
      ctx.obj({
        T: PDFString.of("handBuilt"),
        Kids: [kidRef],
        ...(shape === "untyped-parent" ? { V: value } : { FT: "Tx" }),
      }),
    );
    const widgetRef = addAnnot(
      doc,
      2,
      ctx.obj({
        Type: "Annot",
        Subtype: "Widget",
        Rect: [20, 200, 220, 224],
        Parent: kidRef,
      }),
    );
    ctx.assign(
      kidRef,
      ctx.obj({
        Parent: parentRef,
        Kids: [widgetRef],
        ...(shape === "untyped-parent"
          ? { FT: "Tx", T: PDFString.of("kid") }
          : { FT: "Tx", V: value }),
      }),
    );
    const button = form.createButton("submit");
    button.addToPage("Send", doc.getPage(0), {
      x: 20,
      y: 120,
      width: 80,
      height: 24,
    });
    button.acroField.getWidgets()[0]!.dict.set(
      PDFName.of("A"),
      ctx.obj({
        S: "SubmitForm",
        Fields: [shape === "untyped-parent" ? parentRef : kidRef],
      }),
    );
  };
}

/**
 * A key no layer-2 rule knows, on a kept widget, pointing at page 3's field:
 * only layer 3 (cut every edge into a field outside the kept trees) sees it.
 */
function vendorKey(doc: PDFDocument, form: PDFForm) {
  form
    .getTextField(fieldName(1))
    .acroField.getWidgets()[0]!
    .dict.set(PDFName.of("XYZPrivateLink"), fieldRef(form, fieldName(3)));
}

/**
 * The "Reset selected fields" shape and its relatives, each hung where Acrobat
 * hangs them and each naming ONE field whose only widget is on a dropped page,
 * so every owner is pinned on its own:
 *  - `widget-aa`: a kept widget's trigger dictionary (/AA /Bl, on blur);
 *  - `next-chain`: a Hide reached only through a kept action's /Next;
 *  - `field-aa`: a kept FIELD's trigger dictionary (/AA /K), not its widget's.
 */
function resetTrigger(shape: "widget-aa" | "next-chain" | "field-aa") {
  return (doc: PDFDocument, form: PDFForm) => {
    const f1 = form.getTextField(fieldName(1));
    const widget = f1.acroField.getWidgets()[0]!.dict;
    if (shape === "widget-aa") {
      widget.set(
        PDFName.of("AA"),
        doc.context.obj({
          Bl: { S: "ResetForm", Fields: [fieldRef(form, fieldName(3))] },
        }),
      );
    } else if (shape === "next-chain") {
      widget.set(
        PDFName.of("AA"),
        doc.context.obj({
          Fo: {
            S: "ResetForm",
            Fields: [fieldRef(form, fieldName(1))],
            Next: { S: "Hide", T: fieldRef(form, fieldName(2)), H: true },
          },
        }),
      );
    } else {
      f1.acroField.dict.set(
        PDFName.of("AA"),
        doc.context.obj({
          K: { S: "ResetForm", Fields: [fieldRef(form, fieldName(2))] },
        }),
      );
    }
  };
}

const OUTLINE_MARKER = "SECRET-OUTLINE-TITLE";
const METADATA_MARKER = "SECRET-XMP-METADATA";
const ATTACHMENT_MARKER = "SECRET-EMBEDDED-FILE";
/**
 * On a custom `/Info` key, which the output deliberately does not carry. It
 * sat on `/Subject` until the subset tools began carrying the standard four
 * entries (title, author, subject, keywords) on purpose — a removed page does
 * not change what the document is about. What this marker pins is unchanged:
 * the copier never FOLLOWS the source `/Info`, so nothing on it arrives except
 * what `document-structure.ts` writes fresh.
 */
const INFO_MARKER = "SECRET-INFO-CUSTOM-KEY";

/**
 * Document-level state a kept page can reach without going through a page:
 *  - `catalog`: a kept signature whose transform names the source CATALOG —
 *    Acrobat's FieldMDP / DocMDP shape, `/Reference [<< /TransformMethod
 *    /FieldMDP /Data <catalog> >>]`. The catalog roots everything the output
 *    does not carry, so this one edge reaches all of it at once: the whole
 *    `/AcroForm` (every page's field values, pdf-lib's fields being separate
 *    from their widgets), a bookmark titled after page 2, an XMP `/Metadata`
 *    stream and an embedded file. Measured at 7394803: a 1-page extract
 *    shipped the page-2 value and the title; at 59811fd the value was cut and
 *    the title, the XMP stream and the attached file still shipped. The
 *    name tree sits INLINE in the catalog here, so marking only the objects
 *    the catalog names would still let a copy of the catalog carry it.
 *  - `direct`: a key no rule knows, on a kept widget, naming the catalog's own
 *    dictionaries and the trailer's `/Info` directly — so it is the
 *    document-level objects themselves that must be foreign, not only the
 *    catalog that roots them.
 */
function documentLevelReach(shape: "catalog" | "direct") {
  return (doc: PDFDocument) => {
    const ctx = doc.context;
    const catalogRef = ctx.trailerInfo.Root;
    const infoRef = ctx.trailerInfo.Info;
    if (!(catalogRef instanceof PDFRef) || !(infoRef instanceof PDFRef)) {
      throw new Error("catalog or info is not a ref");
    }
    ctx
      .lookup(infoRef, PDFDict)
      .set(PDFName.of("XYZPrivateNote"), PDFString.of(INFO_MARKER));

    const outlinesRef = ctx.nextRef();
    const itemRef = ctx.nextRef();
    ctx.assign(
      itemRef,
      ctx.obj({
        Title: PDFString.of(OUTLINE_MARKER),
        Parent: outlinesRef,
        Dest: [doc.getPage(1).ref, "Fit"],
      }),
    );
    ctx.assign(
      outlinesRef,
      ctx.obj({ Type: "Outlines", First: itemRef, Last: itemRef, Count: 1 }),
    );
    doc.catalog.set(PDFName.of("Outlines"), outlinesRef);

    const metadataRef = ctx.register(
      ctx.stream(`<x:xmpmeta>${METADATA_MARKER}</x:xmpmeta>`, {
        Type: "Metadata",
        Subtype: "XML",
      }),
    );
    doc.catalog.set(PDFName.of("Metadata"), metadataRef);

    const file = ctx.register(
      ctx.stream(ATTACHMENT_MARKER, { Type: "EmbeddedFile" }),
    );
    const spec = ctx.register(
      ctx.obj({
        Type: "Filespec",
        F: PDFString.of("notes.txt"),
        EF: { F: file },
      }),
    );
    const names = ctx.obj({
      EmbeddedFiles: { Names: [PDFString.of("notes.txt"), spec] },
    });
    // Inline in the catalog shape, as many writers put it: then nothing but
    // the catalog itself being foreign keeps it out. Indirect in the direct
    // shape, so a kept object can name it.
    const namesRef = ctx.register(names);
    doc.catalog.set(PDFName.of("Names"), shape === "direct" ? namesRef : names);

    if (shape === "direct") {
      doc
        .getForm()
        .getTextField(fieldName(1))
        .acroField.getWidgets()[0]!
        .dict.set(
          PDFName.of("XYZDocState"),
          ctx.obj([outlinesRef, metadataRef, namesRef, infoRef]),
        );
      return;
    }
    const sig = ctx.register(
      ctx.obj({
        Type: "Sig",
        Filter: "Adobe.PPKLite",
        Reference: [
          {
            Type: "SigRef",
            TransformMethod: "FieldMDP",
            Data: catalogRef,
            TransformParams: { Type: "TransformParams", Action: "All" },
          },
        ],
      }),
    );
    const widget = addAnnot(
      doc,
      0,
      ctx.obj({
        Type: "Annot",
        Subtype: "Widget",
        FT: "Sig",
        T: PDFString.of("approval"),
        Rect: [200, 200, 280, 230],
        V: sig,
      }),
    );
    doc.catalog
      .lookup(PDFName.of("AcroForm"), PDFDict)
      .lookup(PDFName.of("Fields"), PDFArray)
      .push(widget);
  };
}

/**
 * A kept button whose action names an ANNOTATION on dropped page 2 by
 * reference — a Screen annotation, the kind a media button drives:
 *  - `hide`: a Hide action's `/T` (layer 2 knows Hide, and removes it);
 *  - `rendition`: a Rendition action's `/AN`, a key no layer-2 rule knows, so
 *    only the layer-3 backstop cuts the edge to the dropped annotation.
 * Layer 1 copies the reference as the sentinel, which is never assigned: an
 * edge to it that survives ships as a reference to nothing.
 */
function buttonNamingDroppedAnnot(shape: "hide" | "rendition") {
  return (doc: PDFDocument, form: PDFForm) => {
    const screen = addAnnot(
      doc,
      1,
      doc.context.obj({
        Type: "Annot",
        Subtype: "Screen",
        Rect: [20, 200, 220, 280],
        T: PDFString.of("Clip on page 2"),
      }),
    );
    const button = form.createButton("play");
    button.addToPage("Play", doc.getPage(0), {
      x: 20,
      y: 160,
      width: 80,
      height: 24,
    });
    button.acroField
      .getWidgets()[0]!
      .dict.set(
        PDFName.of("A"),
        doc.context.obj(
          shape === "hide"
            ? { S: "Hide", T: screen, H: true }
            : { S: "Rendition", OP: 0, AN: screen },
        ),
      );
  };
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
    name: "a kept button that submits fields on dropped pages (/A SubmitForm /Fields)",
    build: () =>
      formDoc(
        submitButton([
          fieldName(1),
          fieldName(2),
          fieldName(3),
          "topmostSubform.shared",
        ]),
      ),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a kept widget's /AA that resets a field on a dropped page",
    build: () => formDoc(resetTrigger("widget-aa")),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a kept action whose /Next hides a field on a dropped page",
    build: () => formDoc(resetTrigger("next-chain")),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a kept field's /AA that resets a field on a dropped page",
    build: () => formDoc(resetTrigger("field-aa")),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a kept button that submits a dropped page's whole subform (a non-terminal field)",
    build: () => formDoc(submitSubform(2)),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a vendor key on a kept widget pointing at a field on a dropped page (backstop only)",
    build: () => formDoc(vendorKey),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a kept submit naming an untyped parent whose inherited value lives on a dropped page",
    build: () => formDoc(handBuiltField("untyped-parent")),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a kept submit naming a typed, unnamed kid field on a dropped page",
    build: () => formDoc(handBuiltField("unnamed-kid")),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a kept button whose Hide /T names a dropped page's annotation",
    build: () => formDoc(buttonNamingDroppedAnnot("hide")),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a kept button whose Rendition /AN names a dropped page's annotation (backstop only)",
    build: () => formDoc(buttonNamingDroppedAnnot("rendition")),
    excluded: [bodyMarker(2), bodyMarker(3), secretMarker(2), secretMarker(3)],
  },
  {
    name: "a kept signature whose FieldMDP /Data names the source catalog",
    build: () => formDoc(documentLevelReach("catalog")),
    excluded: [
      bodyMarker(2),
      bodyMarker(3),
      secretMarker(2),
      secretMarker(3),
      OUTLINE_MARKER,
      METADATA_MARKER,
      ATTACHMENT_MARKER,
      INFO_MARKER,
    ],
  },
  {
    name: "a vendor key on a kept widget naming the source's outline, XMP, name tree and /Info directly",
    build: () => formDoc(documentLevelReach("direct")),
    excluded: [
      bodyMarker(2),
      bodyMarker(3),
      secretMarker(2),
      secretMarker(3),
      OUTLINE_MARKER,
      METADATA_MARKER,
      ATTACHMENT_MARKER,
      INFO_MARKER,
    ],
  },
  {
    name: "an article thread (beads) running into a dropped page",
    build: beadDoc,
    excluded: [bodyMarker(3)],
  },
];

const isPageDict = (obj: PDFObject) =>
  obj instanceof PDFPageLeaf ||
  (obj instanceof PDFDict &&
    obj.get(PDFName.of("Type")) === PDFName.of("Page"));

/**
 * Run a tool and report, for every document it CREATES, how many page objects
 * were ever registered into it against how many pages it ends with.
 *
 * Layer 1's promise is stronger than the file oracle can see: a dropped page is
 * never COPIED — not copied and then garbage-collected before save, which is
 * what layers 2 and 3 would do to it, and which is exactly as clean on disk.
 * The difference is cost: a per-page split of a form whose field tree spans N
 * pages copies N pages into every part without layer 1, N² in all.
 */
async function pagesRegistered<T>(run: () => Promise<T>) {
  const created: PDFDocument[] = [];
  const assigned: { context: PDFContext; obj: PDFObject }[] = [];
  const create = PDFDocument.create.bind(PDFDocument);
  const assign = PDFContext.prototype.assign;
  const createSpy = vi
    .spyOn(PDFDocument, "create")
    .mockImplementation(async (options) => {
      const doc = await create(options);
      created.push(doc);
      return doc;
    });
  const assignSpy = vi
    .spyOn(PDFContext.prototype, "assign")
    .mockImplementation(function (this: PDFContext, ref, obj) {
      assigned.push({ context: this, obj });
      assign.call(this, ref, obj);
    });
  try {
    const result = await run();
    return {
      result,
      docs: created.map((doc) => ({
        registered: assigned.filter(
          (a) => a.context === doc.context && isPageDict(a.obj),
        ).length,
        pages: doc.getPageCount(),
      })),
    };
  } finally {
    createSpy.mockRestore();
    assignSpy.mockRestore();
  }
}

describe("page tools ship only the pages the user kept", () => {
  it("POSITIVE CONTROL: the oracle finds every marker in each input", async () => {
    for (const fixture of FIXTURES) {
      const input = await inspect(await fixture.build());
      for (const marker of [bodyMarker(1), ...fixture.excluded]) {
        expect(input.text, `${fixture.name}: ${marker}`).toContain(marker);
      }
    }
  });

  it("POSITIVE CONTROL: the oracle reports a reference to nothing", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().node.set(PDFName.of("XYZ"), PDFRef.of(9999));
    const input = await inspect(await doc.save());
    expect(input.dangling).toEqual(["9999 0 R"]);
    // ...and a clean file reports none, so the detector is not always-on.
    expect((await inspect(await linkedDoc())).dangling).toEqual([]);
  });

  it("POSITIVE CONTROL: the page-registration probe sees the tool's own copies", async () => {
    const bytes = await linkedDoc();
    const { docs } = await pagesRegistered(() =>
      splitPdf(bytes, buildSplitParts("doc", rangesPerPage(3))),
    );
    // One created document per part, each with its one page registered: the
    // probe is attached to the contexts the assembler really writes into.
    expect(docs).toEqual([
      { registered: 1, pages: 1 },
      { registered: 1, pages: 1 },
      { registered: 1, pages: 1 },
    ]);
  });

  for (const fixture of FIXTURES) {
    for (const op of KEEP_FIRST_ONLY) {
      it(`${op.tool}: ${fixture.name}`, async () => {
        const bytes = await fixture.build();
        const { result, docs } = await pagesRegistered(() => op.run(bytes));
        const out = await inspect(result);
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
        // Every edge to a dropped object was CUT, not left pointing at nothing.
        expect(out.dangling, `dangling refs in ${op.tool}`).toEqual([]);
        // Layer 1: a dropped page was never copied into any output, not even
        // on its way to the garbage collector.
        expect(docs.length).toBeGreaterThan(0);
        for (const doc of docs) expect(doc.registered).toBe(doc.pages);
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
// Document structure a remaining page still needs: bookmarks, page labels,
// the document's metadata and language, and links that go through a NAMED
// destination. Measured at 74b8c4a: every subset tool dropped all of it but
// the title — the output is a fresh document, and only the pages and the form
// were carried into it — and a link through a named destination (hyperref's
// shape, and Chrome's "Save as PDF") survived as a hot-spot naming a
// destination the output no longer defines. Read the way a viewer reads it:
// through pdfjs.
// --------------------------------------------------------------------------

/**
 * A bookmark whose own page is dropped, with nothing under it but a bookmark
 * that goes to NO page (a URL, a viewer action). Such a child always survives
 * on its own, and at 325da5a it kept its parent alive: the parent shipped with
 * its title and no destination. The parent keeps its title only when a
 * descendant lands on a kept page (Chapter A); these do not, so neither the
 * parent nor what it holds is written.
 */
const PARENT_OVER_URI = "SECRET-PARENT-OF-DROPPED";
const URI_UNDER_DROPPED = "SECRET-URI-UNDER-DROPPED";
const PARENT_OVER_NAMED = "SECRET-PARENT-NAMED-ONLY";
const NAMED_UNDER_DROPPED = "SECRET-NEXT-UNDER-DROPPED";
/**
 * Titles that must not ship: a bookmark to a dropped page, and a bookmark to a
 * dropped page together with everything under it when nothing under it lands
 * on a kept page.
 */
const DROPPED_BOOKMARKS = [
  "SECRET-BOOKMARK-A2",
  "SECRET-BOOKMARK-APPENDIX",
  PARENT_OVER_URI,
  URI_UNDER_DROPPED,
  PARENT_OVER_NAMED,
  NAMED_UNDER_DROPPED,
];
const HANDBOOK_URL = "https://example.test/handbook";
const PAYROLL_URL = "https://example.test/payroll";

interface OutlineSpec {
  title: string;
  target?: Record<string, unknown>;
  open?: boolean;
  kids?: OutlineSpec[];
}

function addOutline(doc: PDFDocument, specs: OutlineSpec[]) {
  const ctx = doc.context;
  const rootRef = ctx.nextRef();
  const write = (items: OutlineSpec[], parent: PDFRef): PDFRef[] => {
    const refs = items.map(() => ctx.nextRef());
    items.forEach((item, i) => {
      const kids = item.kids ? write(item.kids, refs[i]!) : undefined;
      ctx.assign(
        refs[i]!,
        ctx.obj({
          Title: PDFString.of(item.title),
          Parent: parent,
          ...(i > 0 ? { Prev: refs[i - 1]! } : {}),
          ...(i < items.length - 1 ? { Next: refs[i + 1]! } : {}),
          ...(kids
            ? {
                First: kids[0]!,
                Last: kids[kids.length - 1]!,
                Count: item.open ? kids.length : -kids.length,
              }
            : {}),
          ...item.target,
        }),
      );
    });
    return refs;
  };
  const top = write(specs, rootRef);
  ctx.assign(
    rootRef,
    ctx.obj({
      Type: "Outlines",
      First: top[0]!,
      Last: top[top.length - 1]!,
      Count: top.length,
    }),
  );
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}

/**
 * A five-page handbook with the structure real writers emit:
 *  - page labels i, ii, Ch-1, Ch-2, Ch-3 (front matter in roman numerals);
 *  - named destinations in BOTH places the format keeps them — the `/Names`
 *    `/Dests` name tree behind an intermediate `/Kids` node (strings; LaTeX
 *    hyperref, Chrome) and the catalog's `/Dests` dictionary (names, PDF 1.1);
 *  - bookmarks by explicit destination, by named destination through `/Dest`
 *    and through a GoTo action, a URI bookmark, a parent whose own page is
 *    dropped while its child's is kept, two bookmarks to dropped pages, and
 *    two parents on dropped pages whose only child goes to no page (a URL,
 *    a Named viewer action);
 *  - three links on page 1, each through a named destination;
 *  - title, author, subject, keywords, a catalog `/Lang`, and `/PageMode
 *    /UseOutlines` (open with the bookmark panel showing).
 */
async function handbookDoc(): Promise<Uint8Array> {
  const doc = await withBodies(5);
  const ctx = doc.context;
  const [p1, p2, p3, p4, p5] = doc.getPages();
  doc.setTitle("Employee Handbook");
  doc.setAuthor("HR Department");
  doc.setSubject("Policies 2026");
  doc.setKeywords(["handbook", "policy"]);
  doc.catalog.set(PDFName.of("Lang"), PDFString.of("en-GB"));
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  doc.catalog.set(
    PDFName.of("PageLabels"),
    ctx.obj({
      Nums: [0, { S: "r" }, 2, { S: "D", P: PDFString.of("Ch-") }],
    }),
  );
  const leaf = ctx.register(
    ctx.obj({
      Limits: [PDFString.of("sec.a1"), PDFString.of("sec.a2")],
      Names: [
        PDFString.of("sec.a1"),
        [p3!.ref, "Fit"],
        PDFString.of("sec.a2"),
        { D: [p4!.ref, "Fit"] },
      ],
    }),
  );
  doc.catalog.set(
    PDFName.of("Names"),
    ctx.obj({ Dests: ctx.register(ctx.obj({ Kids: [leaf] })) }),
  );
  doc.catalog.set(
    PDFName.of("Dests"),
    ctx.obj({ chapB: [p5!.ref, "XYZ", 0, 300, 0] }),
  );
  addOutline(doc, [
    { title: "Front matter", target: { Dest: [p1!.ref, "XYZ", 0, 300, 0] } },
    {
      title: "Chapter A",
      target: { Dest: [p2!.ref, "Fit"] },
      open: true,
      kids: [
        {
          title: "A.1",
          target: { A: { S: "GoTo", D: PDFString.of("sec.a1") } },
        },
        {
          title: DROPPED_BOOKMARKS[0]!,
          target: { Dest: PDFString.of("sec.a2") },
        },
      ],
    },
    {
      title: "Website",
      target: { A: { S: "URI", URI: PDFString.of(HANDBOOK_URL) } },
    },
    { title: DROPPED_BOOKMARKS[1]!, target: { Dest: [p4!.ref, "Fit"] } },
    {
      title: PARENT_OVER_URI,
      target: { Dest: [p4!.ref, "Fit"] },
      kids: [
        {
          title: URI_UNDER_DROPPED,
          target: { A: { S: "URI", URI: PDFString.of(PAYROLL_URL) } },
        },
      ],
    },
    {
      title: PARENT_OVER_NAMED,
      target: { A: { S: "GoTo", D: [p2!.ref, "Fit"] } },
      kids: [
        {
          title: NAMED_UNDER_DROPPED,
          target: { A: { S: "Named", N: "NextPage" } },
        },
      ],
    },
    { title: "Chapter B", target: { Dest: "chapB" } },
  ]);
  const link = (target: Record<string, unknown>, y: number) =>
    addAnnot(
      doc,
      0,
      ctx.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [10, y, 60, y + 20],
        Border: [0, 0, 0],
        ...target,
      }),
    );
  link({ Dest: PDFString.of("sec.a1") }, 10); // -> page 3
  link({ A: { S: "GoTo", D: "chapB" } }, 40); // -> page 5
  link({ Dest: PDFString.of("sec.a2") }, 70); // -> page 4
  return doc.save();
}

interface ViewerOutline {
  title: string;
  page: number | null;
  url?: string;
  children: ViewerOutline[];
}

/**
 * What a viewer shows: pdfjs's outline (each destination resolved to a page
 * index the way the viewer resolves it on click), page labels, document info,
 * page mode, and where each link on page `linkPage` lands.
 */
async function readAsViewer(bytes: Uint8Array, linkPage = 0) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const pageOf = async (dest: unknown): Promise<number | null> => {
      const explicit =
        typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit)) return null;
      const target: unknown = explicit[0];
      if (typeof target === "number") return target;
      if (!target || typeof target !== "object") return null;
      try {
        return await pdf.getPageIndex(target as never);
      } catch {
        return null;
      }
    };
    interface Item {
      title: string;
      dest: unknown;
      url?: string | null;
      items?: Item[];
    }
    const walk = async (items: Item[]): Promise<ViewerOutline[]> =>
      Promise.all(
        items.map(async (item) => ({
          title: item.title,
          page: item.dest ? await pageOf(item.dest) : null,
          ...(item.url ? { url: item.url } : {}),
          children: await walk(item.items ?? []),
        })),
      );
    const outline = await walk(((await pdf.getOutline()) ?? []) as Item[]);
    const page = await pdf.getPage(linkPage + 1);
    const annotations = (await page.getAnnotations()) as {
      subtype?: string;
      dest?: unknown;
    }[];
    const links = await Promise.all(
      annotations
        .filter((a) => a.subtype === "Link")
        .map((a) => pageOf(a.dest)),
    );
    const { info } = (await pdf.getMetadata()) as unknown as {
      info: Record<string, unknown>;
    };
    return {
      outline,
      labels: await pdf.getPageLabels(),
      pageMode: await pdf.getPageMode(),
      info: {
        Title: info.Title,
        Author: info.Author,
        Subject: info.Subject,
        Keywords: info.Keywords,
      },
      links,
    };
  } finally {
    await task.destroy();
  }
}

/** Every bookmark title in an outline, depth first. */
const titles = (items: ViewerOutline[]): string[] =>
  items.flatMap((item) => [item.title, ...titles(item.children)]);

const catalogLang = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  const lang = doc.context.lookup(doc.catalog.get(PDFName.of("Lang")));
  return lang instanceof PDFString || lang instanceof PDFHexString
    ? lang.decodeText()
    : undefined;
};

describe("page tools keep the document's bookmarks, page labels and metadata", () => {
  const PAGE_COUNT = 5;
  /** Pages 1, 3 and 5 kept; 2 and 4 dropped. */
  const KEPT = [0, 2, 4];
  const SUBSET_TOOLS: Record<
    string,
    (bytes: Uint8Array, kept: number[]) => Promise<Uint8Array>
  > = {
    extractPages: (b, kept) => extractPages(b, kept),
    deletePages: (b, kept) =>
      deletePages(
        b,
        Array.from({ length: PAGE_COUNT }, (_, i) => i).filter(
          (i) => !kept.includes(i),
        ),
      ),
    splitPdf: async (b, kept) =>
      (await splitPdf(b, [{ name: "part.pdf", indices: kept }]))[0]!.bytes,
    organizePages: (b, kept) =>
      organizePages(
        b,
        kept.map((sourceIndex) => ({ sourceIndex, rotation: 0 })),
      ),
  };

  /**
   * The engine's own answer to "which tools carry a subset's document state":
   * every exported function that assembles with `documentState: "subset"`. A
   * new subset tool joins this set without anyone naming it. (Until d4b37dd
   * the option was a boolean, and merge — the one `false` — carried nothing.)
   */
  const carriers = (state: "subset" | "merge") =>
    readFileSync(join(__dirname, "engine.ts"), "utf8")
      .split(/^export async function /m)
      .slice(1)
      .filter((body) => body.includes(`documentState: "${state}"`))
      .map((body) => /^(\w+)/.exec(body)![1]!)
      .sort();

  it("the tools under test are exactly the engine's document-state carriers (derived)", () => {
    // Positive control for the parser: it finds merge as the one that merges.
    expect(carriers("merge")).toEqual(["mergePdfs"]);
    expect(carriers("subset")).toEqual(Object.keys(SUBSET_TOOLS).sort());
  });

  it("POSITIVE CONTROL: a viewer reads the whole structure in the input", async () => {
    const bytes = await handbookDoc();
    const input = await readAsViewer(bytes);
    expect(input.labels).toEqual(["i", "ii", "Ch-1", "Ch-2", "Ch-3"]);
    expect(input.outline).toEqual([
      { title: "Front matter", page: 0, children: [] },
      {
        title: "Chapter A",
        page: 1,
        children: [
          { title: "A.1", page: 2, children: [] },
          { title: DROPPED_BOOKMARKS[0], page: 3, children: [] },
        ],
      },
      { title: "Website", page: null, url: HANDBOOK_URL, children: [] },
      { title: DROPPED_BOOKMARKS[1], page: 3, children: [] },
      {
        title: PARENT_OVER_URI,
        page: 3,
        children: [
          {
            title: URI_UNDER_DROPPED,
            page: null,
            url: PAYROLL_URL,
            children: [],
          },
        ],
      },
      {
        title: PARENT_OVER_NAMED,
        page: 1,
        children: [{ title: NAMED_UNDER_DROPPED, page: null, children: [] }],
      },
      { title: "Chapter B", page: 4, children: [] },
    ]);
    expect(input.links).toEqual([2, 4, 3]);
    expect(input.pageMode).toBe("UseOutlines");
    expect(input.info).toEqual({
      Title: "Employee Handbook",
      Author: "HR Department",
      Subject: "Policies 2026",
      Keywords: "handbook policy",
    });
    expect(await catalogLang(bytes)).toBe("en-GB");
    // The oracle sees the titles that must not ship, so their absence below
    // is absence.
    const inspected = await inspect(bytes);
    for (const title of DROPPED_BOOKMARKS) {
      expect(inspected.text).toContain(title);
    }
  });

  for (const [tool, run] of Object.entries(SUBSET_TOOLS)) {
    describe(tool, () => {
      it("bookmarks to kept pages survive and open the same page; the rest leave no title behind", async () => {
        const bytes = await handbookDoc();
        const input = await readAsViewer(bytes);
        const out = await run(bytes, KEPT);
        const viewer = await readAsViewer(out);
        // The file first, then the viewer: a title can ship without showing.
        const inspected = await inspect(out);
        for (const title of DROPPED_BOOKMARKS) {
          expect(inspected.text, `${title} in ${tool}`).not.toContain(title);
          expect(titles(viewer.outline)).not.toContain(title);
        }
        expect(viewer.outline).toEqual([
          { title: "Front matter", page: 0, children: [] },
          {
            // Its own page (2) is gone; it opens its first surviving child's.
            title: "Chapter A",
            page: 1,
            children: [{ title: "A.1", page: 1, children: [] }],
          },
          { title: "Website", page: null, url: HANDBOOK_URL, children: [] },
          { title: "Chapter B", page: 2, children: [] },
        ]);
        // The relationship, not just the tree: every bookmark that kept its
        // own page opens, in the output, the page it opened in the input.
        const flat = (items: ViewerOutline[]) => [
          ...items,
          ...items.flatMap((i) => i.children),
        ];
        const inputPage = new Map(
          flat(input.outline).map((i) => [i.title, i.page]),
        );
        const checked = flat(viewer.outline).filter(
          (item) => item.page !== null && item.title !== "Chapter A",
        );
        expect(checked.length).toBe(3);
        for (const item of checked) {
          expect(KEPT[item.page!], item.title).toBe(inputPage.get(item.title));
        }
        expect(viewer.pageMode).toBe("UseOutlines");
        expect(inspected.pageDicts).toBe(inspected.pageCount);
        expect(inspected.dangling).toEqual([]);
      });

      it("every kept page keeps its own page label", async () => {
        const bytes = await handbookDoc();
        const input = await readAsViewer(bytes);
        const viewer = await readAsViewer(await run(bytes, KEPT));
        expect(viewer.labels).toEqual(KEPT.map((i) => input.labels![i]));
        expect(viewer.labels).toEqual(["i", "Ch-1", "Ch-3"]);
      });

      it("title, author, subject, keywords and language are kept", async () => {
        const bytes = await handbookDoc();
        const out = await run(bytes, KEPT);
        expect((await readAsViewer(out)).info).toEqual(
          (await readAsViewer(bytes)).info,
        );
        expect(await catalogLang(out)).toBe(await catalogLang(bytes));
      });

      it("a link through a named destination lands on its kept page; one to a dropped page is gone", async () => {
        const viewer = await readAsViewer(await run(await handbookDoc(), KEPT));
        // Input: page 1 links to pages 3, 5 and 4 (indices 2, 4, 3). Page 4 is
        // dropped; the other two land on their pages' new positions.
        expect(viewer.links).toEqual([1, 2]);
      });
    });
  }

  it("organize: bookmarks and labels follow their pages when the order changes", async () => {
    const viewer = await readAsViewer(
      await organizePages(await handbookDoc(), [
        { sourceIndex: 4, rotation: 0 },
        { sourceIndex: 0, rotation: 0 },
      ]),
    );
    expect(viewer.labels).toEqual(["Ch-3", "i"]);
    // Chapter A and everything under it sit on dropped pages 2-4, and so do
    // the two parents whose only child goes to no page.
    expect(viewer.outline).toEqual([
      { title: "Front matter", page: 1, children: [] },
      { title: "Website", page: null, url: HANDBOOK_URL, children: [] },
      { title: "Chapter B", page: 0, children: [] },
    ]);
  });

  it("with every page kept, labels and bookmarks are the input's", async () => {
    const bytes = await handbookDoc();
    const input = await readAsViewer(bytes);
    const viewer = await readAsViewer(
      await extractPages(bytes, [0, 1, 2, 3, 4]),
    );
    expect(viewer.labels).toEqual(input.labels);
    expect(viewer.outline).toEqual(input.outline);
  });

  it("merge: each source's named links land in that source's own pages", async () => {
    const merged = await mergePdfs([await handbookDoc(), await handbookDoc()]);
    expect((await readAsViewer(merged, 0)).links).toEqual([2, 4, 3]);
    expect((await readAsViewer(merged, 5)).links).toEqual([7, 9, 8]);
  });
});

// --------------------------------------------------------------------------
// Merge: every source's form and bookmarks, in one document. Measured at
// d4b37dd (audit at 67e8d0f): a fillable form merged with a cover letter came
// out with its widgets still on the page and NO /AcroForm — fields that look
// filled and can no longer be filled — and every source's bookmarks were gone.
// Merge was the one assembler caller told to carry no document state, and no
// test merged a form or an outlined file and read the result.
// --------------------------------------------------------------------------

/** Every field a viewer finds, by fully qualified name, with its value. */
async function viewerFields(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const objects = ((await pdf.getFieldObjects()) ?? {}) as Record<
      string,
      { value?: unknown; page?: number }[]
    >;
    // pdfjs lists a field's non-terminal parents too (page -1, no value);
    // what a person fills is a widget, which sits on a page.
    const onPage = (o: { page?: number }) =>
      typeof o.page === "number" && o.page >= 0;
    return {
      /** Field name -> the value shown in each of its widgets. */
      values: Object.fromEntries(
        Object.entries(objects)
          .map(([name, list]) => [name, list.filter(onPage)] as const)
          .filter(([, widgets]) => widgets.length > 0)
          .map(([name, widgets]) => [name, widgets.map((o) => o.value)]),
      ),
    };
  } finally {
    await task.destroy();
  }
}

/**
 * How a viewer draws each field's text when it regenerates it, read the way it
 * reads it — each key from the nearest dictionary that has it: the widget, the
 * field, its parents, then the form's default.
 *  - `font`: the `/DA` names a resource, looked up in the form's `/DR /Font`.
 *    `undefined` when that chain breaks — no form, no `/DA`, or a name `/DR`
 *    does not define.
 *  - `q`: the quadding (0 left, 1 centred, 2 right); absent means 0.
 */
async function fieldAppearance(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const fonts = acroForm
    ?.lookupMaybe(PDFName.of("DR"), PDFDict)
    ?.lookupMaybe(PDFName.of("Font"), PDFDict);
  const result: Record<string, { font?: string; q: number }> = {};
  for (const field of doc.getForm().getFields()) {
    const chain: (PDFDict | undefined)[] = [
      field.acroField.getWidgets()[0]?.dict,
    ];
    for (
      let node: PDFDict | undefined = field.acroField.dict;
      node;
      node = node.lookupMaybe(PDFName.of("Parent"), PDFDict)
    ) {
      chain.push(node);
    }
    chain.push(acroForm);
    const nearest = (key: string) =>
      chain
        .map((dict) => dict?.get(PDFName.of(key)))
        .map((value) => (value === undefined ? undefined : ctx.lookup(value)))
        .find((value) => value !== undefined);
    const da = nearest("DA");
    const daText =
      da instanceof PDFString || da instanceof PDFHexString
        ? da.decodeText()
        : "";
    const name = /\/([^\s/]+)\s+[-+]?[\d.]+\s+Tf/.exec(daText)?.[1];
    const font = name
      ? fonts?.lookupMaybe(PDFName.of(name), PDFDict)
      : undefined;
    const base = font?.get(PDFName.of("BaseFont"));
    const q = nearest("Q");
    result[field.getName()] = {
      font: base instanceof PDFName ? base.decodeText() : undefined,
      q: q instanceof PDFNumber ? q.asNumber() : 0,
    };
  }
  return result;
}

/** The resource names in the form's `/DR /Font`. */
async function formFontNames(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const fonts = doc.catalog
    .lookupMaybe(PDFName.of("AcroForm"), PDFDict)
    ?.lookupMaybe(PDFName.of("DR"), PDFDict)
    ?.lookupMaybe(PDFName.of("Font"), PDFDict);
  return (fonts?.keys() ?? []).map((k) => k.decodeText()).sort();
}

/**
 * One text field that takes its font from the form's DEFAULT appearance —
 * `/DA (/Helv 0 Tf 0 g)` on the /AcroForm, `/Helv` defined in its `/DR` as
 * `baseFont` — the shape Acrobat writes. Two such files give one resource name
 * two different fonts. `needAppearances` and `quadding`, when given, are set
 * on the /AcroForm as the form-wide default; `fieldDA`, when given, is the
 * field's OWN `/DA` (Acrobat writes one on most fields) instead of none.
 */
async function defaultFontForm(
  field: string,
  baseFont: string,
  {
    needAppearances,
    quadding,
    fieldDA,
  }: { needAppearances?: boolean; quadding?: number; fieldDA?: string } = {},
) {
  const built = await withBodies(1);
  const created = built.getForm().createTextField(field);
  created.setText(`${field.toUpperCase()}-VALUE`);
  created.addToPage(built.getPage(0), {
    x: 20,
    y: 40,
    width: 200,
    height: 24,
  });
  const doc = await PDFDocument.load(await built.save());
  const ctx = doc.context;
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
  acroForm.set(PDFName.of("DA"), PDFString.of("/Helv 0 Tf 0 g"));
  acroForm.set(
    PDFName.of("DR"),
    ctx.obj({
      Font: {
        Helv: ctx.register(
          ctx.obj({
            Type: "Font",
            Subtype: "Type1",
            BaseFont: baseFont,
            Encoding: "WinAnsiEncoding",
          }),
        ),
      },
    }),
  );
  if (needAppearances !== undefined) {
    acroForm.set(
      PDFName.of("NeedAppearances"),
      needAppearances ? PDFBool.True : PDFBool.False,
    );
  }
  if (quadding !== undefined) {
    acroForm.set(PDFName.of("Q"), PDFNumber.of(quadding));
  }
  for (const f of doc.getForm().getFields()) {
    if (fieldDA === undefined) f.acroField.dict.delete(PDFName.of("DA"));
    else f.acroField.dict.set(PDFName.of("DA"), PDFString.of(fieldDA));
    for (const w of f.acroField.getWidgets()) w.dict.delete(PDFName.of("DA"));
  }
  return doc.save({ updateFieldAppearances: false });
}

/** Every widget annotation on every page, whether or not a form lists it. */
const widgetsOnPages = (doc: PDFDocument) =>
  doc
    .getPages()
    .flatMap(
      (page) =>
        page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.asArray() ?? [],
    )
    .map((ref) => doc.context.lookup(ref))
    .filter(
      (a) =>
        a instanceof PDFDict &&
        a.get(PDFName.of("Subtype")) === PDFName.of("Widget"),
    ).length;

/** An outline as a viewer reads it, every page moved on by `by`. */
const shiftOutline = (items: ViewerOutline[], by: number): ViewerOutline[] =>
  items.map((item) => ({
    ...item,
    page: item.page === null ? null : item.page + by,
    children: shiftOutline(item.children, by),
  }));

describe("merge keeps every source's form fillable and its bookmarks", () => {
  /** A later file's root field whose name an earlier file already uses. */
  const renamedRoot = (name: string) => name.replace(/^[^.]+/, "$&_2");

  it("POSITIVE CONTROL: the readers see each input's fields, fonts and bookmarks", async () => {
    const form = await viewerFields(await formDoc());
    expect(Object.keys(form.values).sort()).toEqual([
      fieldName(1),
      fieldName(2),
      fieldName(3),
      "topmostSubform.shared",
    ]);
    expect(form.values[fieldName(2)]).toEqual([secretMarker(2)]);
    expect(
      await fieldAppearance(
        await defaultFontForm("b", "Courier", { quadding: 1 }),
      ),
    ).toEqual({ b: { font: "Courier", q: 1 } });
    expect(
      (await readAsViewer(await handbookDoc())).outline.length,
    ).toBeGreaterThan(3);
    // ...and the orphan-widget count sees a form's widgets.
    const doc = await PDFDocument.load(await formDoc());
    expect(widgetsOnPages(doc)).toBe(5);
  });

  it("every field of every file is in the merged form, with its value; a name taken by an earlier file is renamed", async () => {
    const form = await formDoc();
    const input = (await viewerFields(form)).values;
    const merged = await mergePdfs([form, await handbookDoc(), form]);
    const out = (await viewerFields(merged)).values;
    // The count is the sum of the inputs, each value where it was: the second
    // copy of the form is a second set of fields, not a second widget on the
    // first set (which would fill both copies with one answer).
    expect(out).toEqual({
      ...input,
      ...Object.fromEntries(
        Object.entries(input).map(([name, v]) => [renamedRoot(name), v]),
      ),
    });
    expect(Object.keys(out)).toHaveLength(2 * Object.keys(input).length);
    // No widget left on a page without a field in the form behind it.
    const doc = await PDFDocument.load(merged);
    const listed = doc
      .getForm()
      .getFields()
      .reduce((n, f) => n + f.acroField.getWidgets().length, 0);
    expect(listed).toBe(widgetsOnPages(doc));
    expect(listed).toBe(10);
    const inspected = await inspect(merged);
    expect(inspected.pageDicts).toBe(inspected.pageCount);
    expect(inspected.dangling).toEqual([]);
  });

  it("a merged field can be filled on its own, and the answer survives a save", async () => {
    const form = await formDoc();
    const doc = await PDFDocument.load(await mergePdfs([form, form]));
    doc
      .getForm()
      .getTextField(renamedRoot(fieldName(1)))
      .setText("NEW");
    const again = (await viewerFields(await doc.save())).values;
    expect(again[renamedRoot(fieldName(1))]).toEqual(["NEW"]);
    expect(again[fieldName(1)]).toEqual([secretMarker(1)]);
  });

  it("every field keeps its own font and alignment, also when two files give one resource name different fonts", async () => {
    // The first file says "no need to regenerate", the second says "do".
    const helvetica = await defaultFontForm("a", "Helvetica", {
      needAppearances: false,
    });
    const courier = await defaultFontForm("b", "Courier", {
      needAppearances: true,
      quadding: 1,
    });
    // A field that names the resource in its own /DA, not through the default.
    const times = await defaultFontForm("c", "Times-Roman", {
      fieldDA: "/Helv 12 Tf 0 g",
    });
    const expected = {
      ...(await fieldAppearance(helvetica)),
      ...(await fieldAppearance(courier)),
      ...(await fieldAppearance(times)),
    };
    expect(expected).toEqual({
      a: { font: "Helvetica", q: 0 },
      b: { font: "Courier", q: 1 },
      c: { font: "Times-Roman", q: 0 },
    });
    const merged = await mergePdfs([helvetica, courier, times]);
    expect(await fieldAppearance(merged)).toEqual(expected);
    expect(await formFontNames(merged)).toEqual(["Helv", "Helv_2", "Helv_3"]);
    // A viewer regenerates appearances when any source asked it to.
    const doc = await PDFDocument.load(merged);
    const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    expect(acroForm.get(PDFName.of("NeedAppearances"))).toBe(PDFBool.True);
  });

  it("the same standard font under the same name is one resource, not two", async () => {
    const merged = await mergePdfs([
      await defaultFontForm("a", "Helvetica"),
      await defaultFontForm("b", "Helvetica"),
    ]);
    expect(await fieldAppearance(merged)).toEqual({
      a: { font: "Helvetica", q: 0 },
      b: { font: "Helvetica", q: 0 },
    });
    expect(await formFontNames(merged)).toEqual(["Helv"]);
  });

  it("every file's bookmarks, in file order, each opening its own page", async () => {
    const handbook = await handbookDoc();
    const form = await formDoc();
    const input = await readAsViewer(handbook);
    const pagesOf = async (b: Uint8Array) =>
      (await PDFDocument.load(b)).getPageCount();
    const offset = (await pagesOf(handbook)) + (await pagesOf(form));
    const merged = await mergePdfs([handbook, form, handbook]);
    const viewer = await readAsViewer(merged);
    expect(viewer.outline).toEqual([
      ...input.outline,
      ...shiftOutline(input.outline, offset),
    ]);
    // Every destination is a page of the merged file, not an orphan copy.
    expect(titles(viewer.outline).length).toBe(
      2 * titles(input.outline).length,
    );
    expect(viewer.pageMode).toBe("UseOutlines");
    const inspected = await inspect(merged);
    expect(inspected.pageDicts).toBe(inspected.pageCount);
    expect(inspected.dangling).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Layer 2, on its own: the leak tests above pass with the layer-3 backstop
// alone, which cuts a dead field out of an action's list but cannot tell what
// the action MEANS without it. An emptied "submit these fields" list reads as
// "submit every field" to a viewer, so the action has to go, not the entry.
// --------------------------------------------------------------------------

describe("form actions name only the fields the output still has", () => {
  const load = (bytes: Uint8Array) => PDFDocument.load(bytes);
  /** The action on the widget of the named field (or button), resolved. */
  const actionOn = (doc: PDFDocument, name: string, key: string[]) => {
    let value: PDFObject | undefined = doc
      .getForm()
      .getField(name)
      .acroField.getWidgets()[0]!.dict;
    for (const k of key) {
      value =
        value instanceof PDFDict
          ? doc.context.lookup(value.get(PDFName.of(k)))
          : undefined;
    }
    return value instanceof PDFDict ? value : undefined;
  };
  /** The names of the fields an action's /Fields lists, via the output form. */
  const listed = (doc: PDFDocument, action: PDFDict | undefined) => {
    const byRef = new Map(
      doc
        .getForm()
        .getFields()
        .map((f) => [f.ref, f.getName()]),
    );
    const list = action?.lookupMaybe(PDFName.of("Fields"), PDFArray);
    return list?.asArray().map((ref) => byRef.get(ref as never) ?? "?");
  };
  const ALL = [
    fieldName(1),
    fieldName(2),
    fieldName(3),
    "topmostSubform.shared",
  ];

  it("POSITIVE CONTROL: with every page kept, the submit list is untouched", async () => {
    const doc = await load(
      await extractPages(await formDoc(submitButton(ALL)), [0, 1, 2]),
    );
    expect(listed(doc, actionOn(doc, "submit", ["A"]))).toEqual(ALL);
  });

  it("a submit list keeps the kept fields and loses the dropped ones", async () => {
    const doc = await load(
      await extractPages(await formDoc(submitButton(ALL)), [0]),
    );
    expect(listed(doc, actionOn(doc, "submit", ["A"]))).toEqual([
      fieldName(1),
      "topmostSubform.shared",
    ]);
  });

  it("a submit whose every listed field was dropped is removed, not emptied", async () => {
    const names = [fieldName(2), fieldName(3)];
    const kept = await load(
      await extractPages(await formDoc(submitButton(names)), [0, 1]),
    );
    // Control: while one listed field survives, the action does too.
    expect(listed(kept, actionOn(kept, "submit", ["A"]))).toEqual([
      fieldName(2),
    ]);
    const doc = await load(
      await extractPages(await formDoc(submitButton(names)), [0]),
    );
    expect(actionOn(doc, "submit", ["A"])).toBeUndefined();
  });

  it("an EXCLUDE list that empties keeps the action and drops the list", async () => {
    const doc = await load(
      await extractPages(
        await formDoc(submitButton([fieldName(2), fieldName(3)], 1)),
        [0],
      ),
    );
    const action = actionOn(doc, "submit", ["A"]);
    expect(action?.get(PDFName.of("S"))).toBe(PDFName.of("SubmitForm"));
    expect(action?.has(PDFName.of("Fields"))).toBe(false);
  });

  it("a trigger whose reset list emptied is removed; kept, it still names its field", async () => {
    const bytes = await formDoc(resetTrigger("widget-aa"));
    const kept = await load(await extractPages(bytes, [0, 2]));
    expect(listed(kept, actionOn(kept, fieldName(1), ["AA", "Bl"]))).toEqual([
      fieldName(3),
    ]);
    const doc = await load(await extractPages(bytes, [0]));
    expect(actionOn(doc, fieldName(1), ["AA"])).toBeDefined();
    expect(actionOn(doc, fieldName(1), ["AA", "Bl"])).toBeUndefined();
  });

  it("a removed step in a /Next chain drops out; the step before it stays", async () => {
    const doc = await load(
      await extractPages(await formDoc(resetTrigger("next-chain")), [0]),
    );
    const focus = actionOn(doc, fieldName(1), ["AA", "Fo"]);
    expect(listed(doc, focus)).toEqual([fieldName(1)]);
    expect(focus?.has(PDFName.of("Next"))).toBe(false);
  });

  it("a removed action hands its slot to the live actions it chained to", async () => {
    const bytes = await formDoc((doc, form) => {
      const step = (name: string) => ({
        S: "ResetForm",
        Fields: [fieldRef(form, name)],
      });
      form
        .getTextField(fieldName(1))
        .acroField.getWidgets()[0]!
        .dict.set(
          PDFName.of("A"),
          doc.context.obj({
            ...step(fieldName(3)),
            Next: [step(fieldName(1)), step("topmostSubform.shared")],
          }),
        );
    });
    const doc = await load(await extractPages(bytes, [0]));
    const head = actionOn(doc, fieldName(1), ["A"]);
    expect(listed(doc, head)).toEqual([fieldName(1)]);
    const next = head?.lookupMaybe(PDFName.of("Next"), PDFArray);
    expect(next?.size()).toBe(1);
    expect(listed(doc, doc.context.lookup(next!.get(0)) as PDFDict)).toEqual([
      "topmostSubform.shared",
    ]);
  });

  it("a Hide that names a kept field BY NAME survives (a string /T is not a field)", async () => {
    const doc = await load(
      await extractPages(
        await formDoc((doc, form) => {
          form
            .getTextField(fieldName(1))
            .acroField.getWidgets()[0]!
            .dict.set(
              PDFName.of("A"),
              doc.context.obj({
                S: "Hide",
                T: PDFString.of("topmostSubform.shared"),
              }),
            );
        }),
        [0],
      ),
    );
    const hide = actionOn(doc, fieldName(1), ["A"]);
    expect(hide?.get(PDFName.of("S"))).toBe(PDFName.of("Hide"));
    expect(hide?.lookup(PDFName.of("T"), PDFString).decodeText()).toBe(
      "topmostSubform.shared",
    );
  });
});

// --------------------------------------------------------------------------
// The set: a copy path that bypasses the clean assembler brings the defect back.
// DISCOVERED by walking the repository, not named — a new tool that calls
// pdf-lib's copyPages directly is exactly the one a list would not name. It
// used to walk src/ only, and the worker's entry points live in scripts/; the
// health check below now derives what MUST be in the set from package.json.
// --------------------------------------------------------------------------

describe("no code path copies pages around the clean assembler", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  // Not ours, or not shipped: VCS/tool state, dependencies, and the e2e
  // harness (test code, which may build fixtures however it likes).
  const SKIP = (name: string) =>
    name.startsWith(".") || name === "node_modules" || name === "e2e";
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      if (SKIP(name)) return [];
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name) &&
        !/\.test\.tsx?$/.test(name)
        ? [path]
        : [];
    });
  /** Every file a package.json script runs with tsx or node. */
  const scriptEntryPoints = (): string[] => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
    };
    return Object.values(pkg.scripts).flatMap((command) =>
      [...command.matchAll(/\b(?:tsx|node)\s+(\S+\.(?:ts|mts|js|mjs))/g)].map(
        (m) => join(ROOT, m[1]!),
      ),
    );
  };
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
    const files = walk(ROOT);
    // Health check: the walk really read the codebase, not an empty directory.
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(join(ROOT, "src", "lib", "pdf", "engine.ts"));
    // ...and every entry point package.json runs (the worker's among them).
    const entries = scriptEntryPoints();
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.filter((e) => !files.includes(e))).toEqual([]);
    const offenders = files
      .filter((f) => callsCopyPages(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
