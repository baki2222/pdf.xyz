import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * Compress PDF's "Remove extras" (audit compress-pdf#6) on the served build.
 * One fixture carries an attached file, Info + XMP metadata, a sticky note, a
 * link and a form field. Each option is ticked alone, the optimized PDF is
 * DOWNLOADED and decoded: what the option names is gone and the rest is
 * there. With every option off (the default) all three are kept.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 400]);
  page.drawText("Page text that must stay", { x: 20, y: 350, size: 12, font });
  doc.setTitle("pdfxyz-info-title");
  await doc.attach(new TextEncoder().encode("x".repeat(20_000)), "notes.txt", {
    mimeType: "text/plain",
  });
  const ctx = doc.context;
  doc.catalog.set(
    PDFName.of("Metadata"),
    ctx.register(ctx.stream(XMP, { Type: "Metadata", Subtype: "XML" })),
  );
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

async function decode(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const annots = doc
    .getPage(0)
    .node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  const subtypes: string[] = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++)
    subtypes.push(
      String(annots!.lookup(i, PDFDict).get(PDFName.of("Subtype"))),
    );
  return {
    embeddedFiles: !!names?.get(PDFName.of("EmbeddedFiles")),
    info: !!doc.context.trailerInfo.Info,
    xmp: !!doc.catalog.get(PDFName.of("Metadata")),
    annots: subtypes.sort(),
  };
}

async function open(page: Page, bytes?: Uint8Array) {
  await page.goto("/tools/compress-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "extras.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes ?? (await fixture())),
  });
  await expect(page.getByText("Current size", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

async function download(page: Page) {
  const button = page.getByRole("button", {
    name: /download (optimized|unchanged) pdf/i,
  });
  await expect(button).toBeVisible({ timeout: 20_000 });
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    button.click(),
  ]);
  return decode(new Uint8Array(await readFile((await file.path())!)));
}

const extras = (page: Page) =>
  page.getByRole("group", { name: "Remove extras" });

test("CONTROL: with every option off, the attachment, metadata and comment are kept", async ({
  page,
}) => {
  await open(page);
  for (const box of await extras(page).getByRole("checkbox").all())
    await expect(box).not.toBeChecked();
  expect(await download(page)).toEqual({
    embeddedFiles: true,
    info: true,
    xmp: true,
    annots: ["/Link", "/Text", "/Widget"],
  });
});

for (const [label, expected] of [
  [
    "Remove attached files",
    {
      embeddedFiles: false,
      info: true,
      xmp: true,
      annots: ["/Link", "/Text", "/Widget"],
    },
  ],
  [
    "Remove document details",
    {
      embeddedFiles: true,
      info: false,
      xmp: false,
      annots: ["/Link", "/Text", "/Widget"],
    },
  ],
  [
    "Remove comments",
    {
      embeddedFiles: true,
      info: true,
      xmp: true,
      annots: ["/Link", "/Widget"],
    },
  ],
] as const) {
  test(`${label}: the downloaded PDF loses only that, and the saving is shown`, async ({
    page,
  }) => {
    await open(page);
    await extras(page)
      .getByRole("checkbox", { name: new RegExp(label) })
      .check();
    await expect(page.locator("[data-extras-removed]")).toHaveText(
      /^Removed /,
      {
        timeout: 20_000,
      },
    );
    if (label === "Remove attached files")
      await expect(page.locator("[data-extras-removed]")).toHaveText(
        /That saved \d+ KB\./,
      );
    expect(await download(page)).toEqual(expected);
  });
}

/**
 * A file pinned to a page with the paperclip (a /FileAttachment annotation
 * with its popup), and no name tree: the shape Acrobat's "Attach File" tool
 * writes. Review of 7b498d92 (findings 2 and 9): "Remove attached files" kept
 * it, and the panel said nothing.
 *
 * `tagged`: a structure tree points at the paperclip with /OBJR, as Acrobat
 * tags its annotations (verify of 384a607d: the page said "Removed 1 attached
 * file" and the file was still in the download). `pinned`: a key the cleanup
 * knows nothing about holds the file, so it cannot leave and must be reported
 * as still in the file.
 */
async function paperclip(
  shape: { tagged?: boolean; pinned?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 400]);
  page.drawText("Page text that must stay", { x: 20, y: 350, size: 12, font });
  const ctx = doc.context;
  const file = ctx.flateStream("s".repeat(30_000), { Type: "EmbeddedFile" });
  const spec = ctx.obj({
    Type: "Filespec",
    F: PDFString.of("salaries.csv"),
    EF: { F: ctx.register(file) },
  });
  const specRef = ctx.register(spec);
  const clip = ctx.obj({
    Type: "Annot",
    Subtype: "FileAttachment",
    Rect: [20, 300, 40, 320],
    FS: specRef,
  });
  const clipRef = ctx.register(clip);
  const popupRef = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Popup",
      Rect: [40, 300, 140, 360],
      Parent: clipRef,
    }),
  );
  clip.set(PDFName.of("Popup"), popupRef);
  page.node.set(PDFName.of("Annots"), ctx.obj([clipRef, popupRef]));
  if (shape.tagged) {
    const rootRef = ctx.nextRef();
    const elem = ctx.register(
      ctx.obj({
        Type: "StructElem",
        S: "Annot",
        P: rootRef,
        Pg: page.ref,
        K: [{ Type: "OBJR", Obj: clipRef, Pg: page.ref }],
      }),
    );
    ctx.assign(rootRef, ctx.obj({ Type: "StructTreeRoot", K: elem }));
    doc.catalog.set(PDFName.of("StructTreeRoot"), rootRef);
  }
  if (shape.pinned) doc.catalog.set(PDFName.of("PdfxyzKeep"), specRef);
  return doc.save({ useObjectStreams: false });
}

const embeddedFileBytes = (bytes: Uint8Array) =>
  new TextDecoder("latin1").decode(bytes).split("/Type /EmbeddedFile").length -
  1;

for (const tagged of [false, true])
  test(`a ${tagged ? "tagged " : ""}paperclip attachment: Remove attached files takes it out of the downloaded PDF`, async ({
    page,
  }) => {
    const input = await paperclip({ tagged });
    // Health: the fixture's file stream is there to be found.
    expect(embeddedFileBytes(input)).toBeGreaterThan(0);
    await open(page, input);
    await extras(page)
      .getByRole("checkbox", { name: /Remove attached files/ })
      .check();
    await expect(page.locator("[data-extras-removed]")).toHaveText(
      /^Removed 1 attached file\./,
      { timeout: 20_000 },
    );
    const button = page.getByRole("button", {
      name: /download (optimized|unchanged) pdf/i,
    });
    await expect(button).toBeVisible({ timeout: 20_000 });
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      button.click(),
    ]);
    const out = new Uint8Array(await readFile((await file.path())!));
    const decoded = await decode(out);
    expect(decoded.annots).toEqual([]);
    const doc = await PDFDocument.load(out);
    let streams = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects())
      if (
        "dict" in obj &&
        obj.dict instanceof PDFDict &&
        String(obj.dict.get(PDFName.of("Type"))) === "/EmbeddedFile"
      )
        streams += 1;
    expect(streams).toBe(0);
  });

test("a file something else in the PDF still holds is reported as still in the file", async ({
  page,
}) => {
  const input = await paperclip({ pinned: true });
  await open(page, input);
  await extras(page)
    .getByRole("checkbox", { name: /Remove attached files/ })
    .check();
  await expect(page.locator("[data-extras-removed]")).toHaveText(
    "1 attached file could not be removed and is still in the file.",
    { timeout: 20_000 },
  );
  const button = page.getByRole("button", {
    name: /download (optimized|unchanged) pdf/i,
  });
  await expect(button).toBeVisible({ timeout: 20_000 });
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    button.click(),
  ]);
  const out = new Uint8Array(await readFile((await file.path())!));
  expect(embeddedFileBytes(out)).toBeGreaterThan(0);
});

test("a ticked option that finds nothing says so", async ({ page }) => {
  await open(page, await paperclip());
  await extras(page)
    .getByRole("checkbox", { name: /Remove comments/ })
    .check();
  await expect(page.locator("[data-extras-removed]")).toHaveText(
    "No comments were found, so none were removed.",
    { timeout: 20_000 },
  );
});
