/**
 * Compress PDF's opt-in "Remove extras" (audit compress-pdf#6, the half the
 * 2026-11-08 cleanup left for the person's say-so): attached files, the
 * document's metadata (Info and XMP) and comments. Each is OFF by default and
 * each removes only what it names.
 *
 * Every check reads the bytes the browser's lossless pass produced,
 * re-parsed: the file the person downloads, not the function's report.
 */
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { analyzePdf } from "./analyze";
import {
  CLEANUP_EXTRA_OPTIONS,
  NO_EXTRAS,
  extrasLine,
  type CleanupExtras,
} from "./compress-cleanup";
import compressContent from "@/lib/tools/content/compress-pdf";

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>pdfxyz-xmp-author</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

/** A PDF with an attachment, Info + XMP, a sticky note, a link and a form field. */
async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 400]);
  page.drawText("Page text that must stay", { x: 20, y: 350, size: 12, font });
  doc.setTitle("pdfxyz-info-title");
  doc.setAuthor("pdfxyz-info-author");
  await doc.attach(new TextEncoder().encode("x".repeat(4000)), "notes.txt", {
    mimeType: "text/plain",
  });
  const ctx = doc.context;
  const xmp = ctx.stream(XMP, {
    Type: "Metadata",
    Subtype: "XML",
  });
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(xmp));
  const note = ctx.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [20, 300, 40, 320],
    Contents: PDFString.of("pdfxyz-sticky-note"),
  });
  const link = ctx.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [20, 200, 120, 220],
    A: { S: "URI", URI: PDFString.of("https://example.com/") },
  });
  page.node.set(
    PDFName.of("Annots"),
    ctx.obj([ctx.register(note), ctx.register(link)]),
  );
  doc
    .getForm()
    .createTextField("pdfxyz.field")
    .addToPage(page, { x: 20, y: 100, width: 120, height: 20 });
  return doc.save({ useObjectStreams: false });
}

interface Decoded {
  embeddedFiles: boolean;
  info: boolean;
  infoTitle: string | undefined;
  xmp: boolean;
  annots: string[];
  text: boolean;
}

async function decode(bytes: Uint8Array): Promise<Decoded> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const annots =
    doc.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray) ??
    undefined;
  const subtypes: string[] = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const a = annots!.lookup(i, PDFDict);
    subtypes.push(String(a.get(PDFName.of("Subtype"))));
  }
  return {
    embeddedFiles: !!names?.get(PDFName.of("EmbeddedFiles")),
    info: !!doc.context.trailerInfo.Info,
    infoTitle: doc.context.trailerInfo.Info ? doc.getTitle() : undefined,
    xmp: !!doc.catalog.get(PDFName.of("Metadata")),
    annots: subtypes.sort(),
    text: new TextDecoder("latin1").decode(bytes).length > 0,
  };
}

const run = async (extras: CleanupExtras) =>
  analyzePdf(await fixture(), extras);

const NOTHING_REMOVED = { attachments: 0, metadata: false, comments: 0 };

/**
 * A file attached to a PAGE with the paperclip (a /FileAttachment annotation,
 * Acrobat's "Attach File" comment tool), and no document-level name tree.
 * Review of 7b498d92 (finding 2/9): the name-tree-only fixture above could not
 * see this shape, and "Remove attached files" left the 30,000 bytes in.
 */
async function paperclipFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  const file = ctx.flateStream("s".repeat(30_000), { Type: "EmbeddedFile" });
  const spec = ctx.obj({
    Type: "Filespec",
    F: PDFString.of("salaries.csv"),
    UF: PDFString.of("salaries.csv"),
    EF: { F: ctx.register(file) },
  });
  const clip = ctx.obj({
    Type: "Annot",
    Subtype: "FileAttachment",
    Rect: [20, 300, 40, 320],
    FS: ctx.register(spec),
    Name: "PushPin",
  });
  const note = ctx.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [60, 300, 80, 320],
    Contents: PDFString.of("pdfxyz-sticky-note"),
  });
  // Acrobat gives the paperclip a popup whose /Parent points back at it: left
  // on the page, that popup alone would keep the file reachable.
  const clipRef = ctx.register(clip);
  const popup = ctx.obj({
    Type: "Annot",
    Subtype: "Popup",
    Rect: [40, 300, 140, 360],
    Parent: clipRef,
  });
  const popupRef = ctx.register(popup);
  clip.set(PDFName.of("Popup"), popupRef);
  page.node.set(
    PDFName.of("Annots"),
    ctx.obj([clipRef, popupRef, ctx.register(note)]),
  );
  return doc.save({ useObjectStreams: false });
}

/** Embedded file streams anywhere in the file, and the page's annot kinds. */
async function decodePaperclip(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let embeddedFileStreams = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (
      obj instanceof PDFRawStream &&
      String(obj.dict.get(PDFName.of("Type"))) === "/EmbeddedFile"
    )
      embeddedFileStreams += 1;
  }
  const annots = doc
    .getPage(0)
    .node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  const subtypes: string[] = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++)
    subtypes.push(
      String(annots!.lookup(i, PDFDict).get(PDFName.of("Subtype"))),
    );
  return { embeddedFileStreams, annots: subtypes.sort() };
}

describe("Remove attached files also removes a page's paperclip attachment", () => {
  it("health: the fixture holds one embedded file stream on a FileAttachment annot", async () => {
    expect(await decodePaperclip(await paperclipFixture())).toEqual({
      embeddedFileStreams: 1,
      annots: ["/FileAttachment", "/Popup", "/Text"],
    });
  });

  it("CONTROL: with every option off, the paperclip and its file stay", async () => {
    const { optimized } = await analyzePdf(await paperclipFixture(), NO_EXTRAS);
    expect(await decodePaperclip(optimized)).toEqual({
      embeddedFileStreams: 1,
      annots: ["/FileAttachment", "/Popup", "/Text"],
    });
  });

  it("attached files: the paperclip and its bytes are gone, counted as an attached file", async () => {
    const { optimized, analysis } = await analyzePdf(await paperclipFixture(), {
      ...NO_EXTRAS,
      attachments: true,
    });
    expect(await decodePaperclip(optimized)).toEqual({
      embeddedFileStreams: 0,
      annots: ["/Text"],
    });
    expect(analysis.extras.attachments).toBe(1);
    expect(analysis.extras.comments).toBe(0);
  });

  it("comments alone keep the paperclip: an attached file is not a comment", async () => {
    const { optimized, analysis } = await analyzePdf(await paperclipFixture(), {
      ...NO_EXTRAS,
      comments: true,
    });
    expect(await decodePaperclip(optimized)).toEqual({
      embeddedFileStreams: 1,
      annots: ["/FileAttachment", "/Popup"],
    });
    expect(analysis.extras.comments).toBe(1);
  });
});

describe("Remove extras: each option removes what it names, and only that", () => {
  it("health: the fixture carries all three, plus a link and a form field", async () => {
    const d = await decode(await fixture());
    expect(d).toMatchObject({
      embeddedFiles: true,
      info: true,
      infoTitle: "pdfxyz-info-title",
      xmp: true,
    });
    expect(d.annots).toEqual(["/Link", "/Text", "/Widget"]);
  });

  it("CONTROL: with every option off (the default), all three are kept", async () => {
    expect(NO_EXTRAS).toEqual({
      attachments: false,
      metadata: false,
      comments: false,
    });
    const { optimized, analysis } = await run(NO_EXTRAS);
    const d = await decode(optimized);
    expect(d).toMatchObject({
      embeddedFiles: true,
      info: true,
      infoTitle: "pdfxyz-info-title",
      xmp: true,
    });
    expect(d.annots).toEqual(["/Link", "/Text", "/Widget"]);
    expect(extrasLine(analysis.extras)).toBeNull();
  });

  it("attached files: no EmbeddedFiles, the rest kept, and the file is smaller", async () => {
    const base = await run(NO_EXTRAS);
    const { optimized, analysis } = await run({
      ...NO_EXTRAS,
      attachments: true,
    });
    const d = await decode(optimized);
    expect(d.embeddedFiles).toBe(false);
    expect(d).toMatchObject({ info: true, xmp: true });
    expect(d.annots).toEqual(["/Link", "/Text", "/Widget"]);
    expect(analysis.extras.attachments).toBe(1);
    expect(optimized.byteLength).toBeLessThan(base.optimized.byteLength);
  });

  it("metadata: no Info and no XMP, the rest kept", async () => {
    const { optimized, analysis } = await run({
      ...NO_EXTRAS,
      metadata: true,
    });
    const d = await decode(optimized);
    expect(d).toMatchObject({ info: false, xmp: false, embeddedFiles: true });
    expect(d.annots).toEqual(["/Link", "/Text", "/Widget"]);
    expect(analysis.extras.metadata).toBe(true);
    expect(new TextDecoder("latin1").decode(optimized)).not.toContain(
      "pdfxyz-xmp-author",
    );
  });

  it("comments: only links and form fields are left on the page", async () => {
    const { optimized, analysis } = await run({
      ...NO_EXTRAS,
      comments: true,
    });
    const d = await decode(optimized);
    expect(d.annots).toEqual(["/Link", "/Widget"]);
    expect(d).toMatchObject({ info: true, xmp: true, embeddedFiles: true });
    expect(analysis.extras.comments).toBe(1);
    // The form field still works: it is still in the form.
    const doc = await PDFDocument.load(optimized);
    expect(
      doc
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(["pdfxyz.field"]);
  });

  it("the line says what each removed and how much smaller the file got", () => {
    expect(
      extrasLine({ attachments: 2, metadata: true, comments: 1 }, 3 * 1024),
    ).toBe(
      "Removed 2 attached files, the document's metadata and 1 comment. That saved 3 KB.",
    );
    expect(extrasLine({ attachments: 0, metadata: false, comments: 0 })).toBe(
      null,
    );
  });

  it("a ticked option that found nothing says so, instead of saying nothing", () => {
    expect(
      extrasLine(NOTHING_REMOVED, undefined, {
        ...NO_EXTRAS,
        attachments: true,
      }),
    ).toBe("No attached files were found, so none were removed.");
    expect(
      extrasLine({ attachments: 0, metadata: false, comments: 2 }, 1024, {
        attachments: true,
        metadata: true,
        comments: true,
      }),
    ).toBe(
      "Removed 2 comments. That saved 1 KB. No attached files or document details were found, so none were removed.",
    );
    // Control: nothing ticked, nothing said.
    expect(extrasLine(NOTHING_REMOVED, undefined, NO_EXTRAS)).toBeNull();
  });

  it("every option says what it removes, and the page describes the choice", () => {
    expect(CLEANUP_EXTRA_OPTIONS.map((o) => o.key).sort()).toEqual(
      Object.keys(NO_EXTRAS).sort(),
    );
    for (const option of CLEANUP_EXTRA_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(5);
      expect(option.hint).toMatch(/remove/i);
    }
    const page = JSON.stringify(compressContent);
    for (const option of CLEANUP_EXTRA_OPTIONS)
      expect(page).toContain(option.label);
  });
});
