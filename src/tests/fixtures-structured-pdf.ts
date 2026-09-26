import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  rgb,
} from "pdf-lib";
// Relative, not `@/`: the Playwright client proof imports this file too.
import { assertFormFieldTextDrawable } from "../lib/pdf/unicode-font";

/**
 * A PDF that carries the DOCUMENT-level structure a real file has and a
 * generated test page does not — and a reader that says, member by member,
 * what an operation lost of it.
 *
 * Why this exists: `rotate-pdf` shipped through `organizePages`, which rebuilds the document with `PDFDocument.create()` +
 * `copyPages`. Only page objects survive that. Every proof of the tool built
 * its input with `PDFDocument.create()` + `addPage`, which has no bookmarks,
 * no form, no title and no language to lose — so every proof was green on a
 * tool that deleted all four from every real document it touched. A fixture
 * with nothing to lose cannot see loss.
 *
 * The reader does not name the members it checks. It WALKS the catalog, the
 * Info dictionary and every page dictionary of the input and asks the output
 * for each one it finds, so adding a member here (or a real file carrying one
 * this list never thought of) is checked without touching the predicate.
 */

/** Values an operation may legitimately rewrite — the producer stamp. */
const STAMPED_INFO_KEYS = new Set(["/Producer", "/Creator", "/ModDate"]);

/** Page keys an operation may legitimately rewrite: the rotation itself, and
 * the back-pointer into a page tree that a rebuild necessarily replaces. */
const PAGE_KEYS_ALLOWED_TO_CHANGE = new Set(["/Rotate", "/Parent"]);

/**
 * Links not followed: `/Parent`, `/P` and `/Prev` point back into a structure
 * already being walked, and `/Last` repeats a node the `/First` → `/Next`
 * chain reaches anyway. Everything else is followed to the leaves.
 */
const BACK_POINTERS = new Set(["/Parent", "/P", "/Prev", "/Last"]);

export const STRUCTURED_FIELD_NAME = "customer.name";
export const STRUCTURED_FIELD_VALUE = "Jane Doe";
export const STRUCTURED_OUTLINE_TITLE = "Chapter 1 — Findings";

/**
 * Add a title/author/subject/keywords Info dictionary, a document language,
 * page labels, a one-entry outline pointing at page 1, a filled AcroForm text
 * field on page 1, tagged-PDF markers and viewer preferences.
 */
export async function addDocumentStructure(doc: PDFDocument): Promise<void> {
  const { context, catalog } = doc;
  const pages = doc.getPages();
  const first = pages[0];
  if (!first) throw new Error("addDocumentStructure needs at least one page");

  doc.setTitle("Quarterly Report", { showInWindowTitleBar: true });
  doc.setAuthor("Jane");
  doc.setSubject("Q3 results");
  doc.setKeywords(["quarterly", "report"]);

  catalog.set(PDFName.of("Lang"), PDFString.of("en-GB"));
  catalog.set(
    PDFName.of("PageLabels"),
    context.obj({ Nums: [0, { S: "r" }, 1, { S: "D", St: 1 }] }),
  );
  catalog.set(PDFName.of("MarkInfo"), context.obj({ Marked: true }));
  catalog.set(
    PDFName.of("StructTreeRoot"),
    context.register(context.obj({ Type: "StructTreeRoot" })),
  );

  const outlinesRef = context.nextRef();
  const itemRef = context.nextRef();
  context.assign(
    itemRef,
    context.obj({
      Title: PDFString.of(STRUCTURED_OUTLINE_TITLE),
      Parent: outlinesRef,
      Dest: [first.ref, "Fit"],
    }),
  );
  context.assign(
    outlinesRef,
    context.obj({ Type: "Outlines", First: itemRef, Last: itemRef, Count: 1 }),
  );
  catalog.set(PDFName.of("Outlines"), outlinesRef);

  // The same refusal every product AcroForm writer makes before `setText`
  // (`text-drawing-call-sites.test.ts` holds all of `src/` to it).
  assertFormFieldTextDrawable([STRUCTURED_FIELD_VALUE]);
  const field = doc.getForm().createTextField(STRUCTURED_FIELD_NAME);
  field.setText(STRUCTURED_FIELD_VALUE);
  field.addToPage(first, { x: 20, y: 20, width: 120, height: 18 });
}

/** A fresh `pageCount`-page PDF carrying {@link addDocumentStructure}. */
export async function makeStructuredPdf(
  pageCount: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    // Page content is not what this fixture is about; a distinct block per
    // page keeps the pages non-empty and distinguishable.
    const page = doc.addPage([300, 200]);
    page.drawRectangle({
      x: 20 + i * 10,
      y: 100,
      width: 40,
      height: 40,
      color: rgb(0.2, 0.2, 0.2),
    });
  }
  await addDocumentStructure(doc);
  return doc.save();
}

export interface DocumentStructure {
  /** Serialized value of every catalog member except the page tree. */
  catalog: Map<string, string>;
  /** Serialized value of every Info member except the producer stamp. */
  info: Map<string, string>;
  /** Per page: serialized value of every member except Rotate/Parent. */
  pages: Map<string, string>[];
  /** Each page's /Rotate, normalized to 0..270. */
  rotations: number[];
  /** Fully qualified AcroForm field names with their values. */
  fields: Map<string, string>;
}

/**
 * Canonical text for a PDF object. References to a PAGE become `page#N`, so an
 * outline or a widget that still points at the same page compares equal across
 * a save, while one that points nowhere (or at a different page) does not.
 */
function serialize(
  obj: PDFObject | undefined,
  doc: PDFDocument,
  pageIndex: Map<string, number>,
  seen: Set<string>,
): string {
  if (obj === undefined) return "undefined";
  if (obj instanceof PDFRef) {
    const key = obj.toString();
    const page = pageIndex.get(key);
    if (page !== undefined) return `page#${page}`;
    if (seen.has(key)) return "cycle";
    const next = new Set(seen).add(key);
    return serialize(doc.context.lookup(obj), doc, pageIndex, next);
  }
  if (obj instanceof PDFDict) {
    const entries = [...obj.entries()]
      .map(([k, v]) => [k.toString(), v] as const)
      .filter(([k]) => !BACK_POINTERS.has(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${serialize(v, doc, pageIndex, seen)}`);
    return `<<${entries.join(" ")}>>`;
  }
  if (obj instanceof PDFStream) {
    const length =
      obj instanceof PDFRawStream ? obj.contents.length : obj.getContentsSize();
    return `stream(${serialize(obj.dict, doc, pageIndex, seen)},${length})`;
  }
  if (obj instanceof PDFArray) {
    return `[${obj
      .asArray()
      .map((v) => serialize(v, doc, pageIndex, seen))
      .join(" ")}]`;
  }
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return JSON.stringify(obj.decodeText());
  }
  if (obj instanceof PDFNumber) return String(obj.asNumber());
  if (obj instanceof PDFName || obj instanceof PDFBool) return obj.toString();
  if (obj === PDFNull) return "null";
  return obj.toString();
}

/** Read everything {@link addDocumentStructure} (or a real file) carries. */
export async function readDocumentStructure(
  bytes: Uint8Array,
): Promise<DocumentStructure> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const pageIndex = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const ser = (obj: PDFObject | undefined) =>
    serialize(obj, doc, pageIndex, new Set());

  const catalog = new Map<string, string>();
  for (const [key, value] of doc.catalog.entries()) {
    if (key.toString() === "/Pages") continue;
    catalog.set(key.toString(), ser(value));
  }

  const info = new Map<string, string>();
  const infoObj = doc.context.lookup(doc.context.trailerInfo.Info);
  if (infoObj instanceof PDFDict) {
    for (const [key, value] of infoObj.entries()) {
      if (STAMPED_INFO_KEYS.has(key.toString())) continue;
      info.set(key.toString(), ser(value));
    }
  }

  const pageMaps = pages.map((page) => {
    const members = new Map<string, string>();
    for (const [key, value] of page.node.entries()) {
      if (PAGE_KEYS_ALLOWED_TO_CHANGE.has(key.toString())) continue;
      members.set(key.toString(), ser(value));
    }
    return members;
  });

  const fields = new Map<string, string>();
  if (doc.catalog.has(PDFName.of("AcroForm"))) {
    for (const field of doc.getForm().getFields()) {
      const value =
        "getText" in field && typeof field.getText === "function"
          ? String(field.getText() ?? "")
          : field.constructor.name;
      fields.set(field.getName(), value);
    }
  }

  return {
    catalog,
    info,
    pages: pageMaps,
    rotations: pages.map(
      (p) => (((p.getRotation().angle % 360) + 360) % 360) as number,
    ),
    fields,
  };
}

/**
 * Every member of `before` that `after` lost or changed, as readable paths
 * (`catalog/Outlines`, `info/Title`, `page1/Annots`, `field/customer.name`).
 * Empty means nothing the input carried was lost.
 */
export function lostStructure(
  before: DocumentStructure,
  after: DocumentStructure,
): string[] {
  const lost: string[] = [];
  const compare = (
    prefix: string,
    a: Map<string, string>,
    b: Map<string, string> | undefined,
  ) => {
    for (const [key, value] of a) {
      if (b?.get(key) !== value) lost.push(`${prefix}${key}`);
    }
  };
  compare("catalog", before.catalog, after.catalog);
  compare("info", before.info, after.info);
  before.pages.forEach((page, i) =>
    compare(`page${i + 1}`, page, after.pages[i]),
  );
  if (after.pages.length !== before.pages.length) {
    lost.push(`pageCount:${before.pages.length}->${after.pages.length}`);
  }
  compare("field/", before.fields, after.fields);
  return lost;
}
