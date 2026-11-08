import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { JPEG_30X20 } from "@/tests/jpeg-fixtures";
import { tiffOf } from "@/tests/tiff-fixtures";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  type ImagePageOptions,
} from "./image-page-layout";
import { buildImagePdf, imagesToPdf, imagesToPdfs } from "./image-to-pdf";
import { compareFileNames } from "./image-bookmarks";

/*
 * Audit png-to-pdf#6 (2026-11-08): one bookmark per image, titled with its
 * file name and pointing at its first page. Read back from the saved PDF's
 * /Outlines, the way a viewer's bookmark panel reads it.
 */

const ON: ImagePageOptions = {
  ...DEFAULT_IMAGE_PAGE_OPTIONS,
  bookmarks: "per-image",
};
const jpg = (name: string) => ({ name, type: "image/jpeg", bytes: JPEG_30X20 });

/** Each bookmark's title and the 0-based page it opens. */
async function outline(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const pageRefs = doc.getPages().map((p) => p.ref.toString());
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const out: { title: string; page: number }[] = [];
  let ref = root?.get(PDFName.of("First"));
  while (ref instanceof PDFRef) {
    const item = doc.context.lookup(ref, PDFDict);
    const title = item.lookup(PDFName.of("Title"), PDFHexString).decodeText();
    const dest = item.lookup(PDFName.of("Dest")) as unknown as {
      get(i: number): PDFRef;
    };
    out.push({ title, page: pageRefs.indexOf(dest.get(0).toString()) });
    ref = item.get(PDFName.of("Next"));
  }
  const mode = doc.catalog.get(PDFName.of("PageMode"))?.toString();
  return { items: out, mode };
}

describe("a bookmark per image (audit png-to-pdf#6)", () => {
  it("health check: by default the PDF has no outline", async () => {
    const pdf = await imagesToPdf("jpg", [jpg("a.jpg"), jpg("b.jpg")]);
    expect((await outline(pdf)).items).toEqual([]);
  });

  it("One per image titles each bookmark with its file and opens its page", async () => {
    const pdf = await imagesToPdf(
      "jpg",
      [jpg("cover.jpg"), jpg("Ünïcode café.jpg"), jpg("last.jpg")],
      ON,
    );
    const { items, mode } = await outline(pdf);
    expect(items).toEqual([
      { title: "cover.jpg", page: 0 },
      { title: "Ünïcode café.jpg", page: 1 },
      { title: "last.jpg", page: 2 },
    ]);
    expect(mode).toBe("/UseOutlines");
  });

  it("a multi-page TIFF's bookmark opens its FIRST page, and the next image follows it", async () => {
    const page = {
      width: 4,
      height: 4,
      bits: [8],
      photometric: 1,
      rows: new Uint8Array(16).fill(128),
    };
    const tiff = tiffOf([page, page, page]);
    const pdf = await imagesToPdf(
      "png",
      [
        jpg("before.jpg"),
        { name: "scan.tif", type: "image/tiff", bytes: tiff },
        jpg("after.jpg"),
      ],
      ON,
    );
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(5);
    const { items } = await outline(pdf);
    expect(items.map((i) => i.page)).toEqual([0, 1, 4]);
  });

  it("one image gets no outline; nor do the per-image PDFs", async () => {
    expect(
      (await outline(await imagesToPdf("jpg", [jpg("a.jpg")], ON))).items,
    ).toEqual([]);
    const zip = await imagesToPdfs("jpg", [jpg("a.jpg"), jpg("b.jpg")], ON);
    for (const f of zip) expect((await outline(f.bytes)).items).toEqual([]);
  });

  it("the size-limit builder writes it too", async () => {
    const pdf = await buildImagePdf("jpg", [jpg("a.jpg"), jpg("b.jpg")], ON);
    expect((await outline(pdf)).items.map((i) => i.title)).toEqual([
      "a.jpg",
      "b.jpg",
    ]);
  });
});

describe("sort by name", () => {
  it("puts numbers in number order and ignores case", () => {
    const names = ["shot 10.png", "Shot 2.png", "shot 1.png", "alpha.png"];
    expect([...names].sort(compareFileNames)).toEqual([
      "alpha.png",
      "shot 1.png",
      "Shot 2.png",
      "shot 10.png",
    ]);
  });
});
