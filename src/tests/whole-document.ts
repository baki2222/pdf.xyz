import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from "pdf-lib";
import { awaitPdfjsDocument, loadPdfjs } from "@/lib/pdf/pdfjs";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";

/**
 * A document that carries, besides its pages, every kind of document-level
 * state the page assembler deliberately does NOT rebuild
 * (`src/lib/pdf/document-structure.ts`, "Deliberately NOT carried"): an
 * embedded file, an XMP metadata stream, a tag tree, and a custom `/Info`
 * key — plus the ones it does (title, author, `/Lang`).
 *
 * A tool that removes no page has no reason to lose any of it. Rotate PDF
 * sent every page, in order, through the assembler, and measured at 8e270e8
 * it returned the file with the attachment, the XMP stream, the tag tree and
 * the custom key gone. Shared by `page-copy.test.ts` (the engine) and
 * `runner-flows.test.tsx` (the Rotate PDF runner, read at the download).
 */

export const WHOLE_DOCUMENT = {
  pageCount: 3,
  attachmentName: "ledger.csv",
  attachmentText: "ATTACHED-LEDGER-ROW",
  xmpTitle: "XMP-TITLE-MARKER",
  customInfoKey: "Department",
  customInfoValue: "CUSTOM-INFO-MARKER",
} as const;

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${WHOLE_DOCUMENT.xmpTitle}</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

export async function wholeDocumentPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bodies = Array.from(
    { length: WHOLE_DOCUMENT.pageCount },
    (_, i) => `WHOLE-BODY-P${i + 1}`,
  );
  const font = await embedDrawingFont(doc, bodies);
  for (let i = 0; i < WHOLE_DOCUMENT.pageCount; i++) {
    const page = doc.addPage([300, 300]);
    page.drawText(bodies[i]!, { x: 20, y: 150, size: 12, font });
  }
  doc.setTitle("Annual Ledger");
  doc.setAuthor("Finance");
  // The Info dict pdf-lib just made for the title (getInfoDict is private).
  doc.context
    .lookup(doc.context.trailerInfo.Info, PDFDict)
    .set(
      PDFName.of(WHOLE_DOCUMENT.customInfoKey),
      PDFString.of(WHOLE_DOCUMENT.customInfoValue),
    );
  doc.catalog.set(PDFName.of("Lang"), PDFString.of("en-GB"));
  await doc.attach(
    // Re-made in this realm's Uint8Array: under jsdom, TextEncoder returns
    // Node's, and pdf-lib's `instanceof` check refuses it.
    Uint8Array.from(new TextEncoder().encode(WHOLE_DOCUMENT.attachmentText)),
    WHOLE_DOCUMENT.attachmentName,
    { mimeType: "text/csv" },
  );
  doc.catalog.set(
    PDFName.of("Metadata"),
    doc.context.register(
      doc.context.stream(XMP, { Type: "Metadata", Subtype: "XML" }),
    ),
  );
  // A minimal tag tree: one paragraph element on page 1.
  const [first] = doc.getPages();
  const rootRef = doc.context.nextRef();
  const elemRef = doc.context.register(
    doc.context.obj({ Type: "StructElem", S: "P", P: rootRef, Pg: first!.ref }),
  );
  doc.context.assign(
    rootRef,
    doc.context.obj({
      Type: "StructTreeRoot",
      K: [elemRef],
      ParentTree: { Nums: [0, [elemRef]] },
    }),
  );
  first!.node.set(PDFName.of("StructParents"), doc.context.obj(0));
  doc.catalog.set(PDFName.of("StructTreeRoot"), rootRef);
  doc.catalog.set(PDFName.of("MarkInfo"), doc.context.obj({ Marked: true }));
  return doc.save();
}

/** Info keys every tool rewrites on the way out (our producer stamp). */
const RESTAMPED = new Set(["Producer", "Creator", "ModDate", "CreationDate"]);

/**
 * What a file carries at document level, read two ways: the catalog and
 * `/Info` as data (every key, derived — not a typed list), and what a viewer
 * (pdfjs) shows of the attachment, the XMP stream and the tag marker.
 */
export async function documentLevelState(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const text = (value: unknown) =>
    value instanceof PDFString || value instanceof PDFHexString
      ? value.decodeText()
      : String(value);
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  const infoEntries =
    info instanceof PDFDict
      ? info
          .entries()
          .filter(([key]) => !RESTAMPED.has(key.decodeText()))
          .map(
            ([key, value]) =>
              [key.decodeText(), text(doc.context.lookup(value))] as const,
          )
      : [];

  // The attachment's bytes, as data: each embedded file's stream, decoded.
  const contents = new Map<string, string>();
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const files = names
    ?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict)
    ?.lookupMaybe(PDFName.of("Names"), PDFArray);
  for (let i = 0; files && i + 1 < files.size(); i += 2) {
    const spec = doc.context.lookup(files.get(i + 1), PDFDict);
    const stream = doc.context.lookup(
      spec.lookup(PDFName.of("EF"), PDFDict).get(PDFName.of("F")),
    );
    if (!(stream instanceof PDFRawStream)) continue;
    contents.set(
      text(doc.context.lookup(files.get(i))),
      new TextDecoder().decode(decodePDFRawStream(stream).decode()),
    );
  }

  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await awaitPdfjsDocument(task);
  try {
    // What a viewer lists in its attachments panel (pdfjs: a Map by name).
    const listed = (await pdf.getAttachments()) as
      | Map<string, { filename: string }>
      | Record<string, { filename: string }>
      | null;
    const attachments =
      listed instanceof Map
        ? [...listed.values()]
        : Object.values(listed ?? {});
    const { metadata } = (await pdf.getMetadata()) as unknown as {
      metadata: { get(name: string): unknown } | null;
    };
    const rotations: number[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      rotations.push((await pdf.getPage(i)).rotate);
    }
    return {
      catalogKeys: doc.catalog
        .keys()
        .map((k) => k.decodeText())
        .sort(),
      info: Object.fromEntries(infoEntries),
      /** Each attachment a viewer lists -> the text its file holds. */
      attachments: Object.fromEntries(
        attachments.map((a) => [a.filename, contents.get(a.filename) ?? null]),
      ),
      xmpTitle: metadata?.get("dc:title") ?? null,
      marked:
        ((await pdf.getMarkInfo()) as { Marked?: boolean } | null)?.Marked ===
        true,
      rotations,
    };
  } finally {
    await task.destroy();
  }
}
