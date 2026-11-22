import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";

/**
 * Flatten PDF's "Also flatten comments and markup" (audit flatten-pdf#3), in
 * the served page: a PDF with no form but a stamp, an ink mark and a link.
 * Ticked, the download's page keeps only the link, and the stamp's dark box
 * is now page content (its drawing operator is in the page's resources).
 */

async function markedUpPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const ctx = doc.context;
  const ap = (w: number, h: number) =>
    ctx.register(
      ctx.flateStream(`0 g 0 0 ${w} ${h} re f`, {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, w, h],
      }),
    );
  const refs = [
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Stamp",
        Rect: [40, 400, 160, 440],
        AP: ctx.obj({ N: ap(120, 40) }),
      }),
    ),
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Ink",
        Rect: [200, 400, 260, 440],
        InkList: [[200, 400, 260, 440]],
        AP: ctx.obj({ N: ap(60, 40) }),
      }),
    ),
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [40, 300, 160, 320],
        A: ctx.obj({ S: "URI", URI: PDFString.of("https://example.com/") }),
      }),
    ),
  ];
  page.node.set(PDFName.of("Annots"), ctx.obj(refs));
  return Buffer.from(await doc.save());
}

test("tick Also flatten comments and markup: the download keeps only the link", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/flatten-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: await markedUpPdf(),
  });
  await expect(
    page.getByText("Found 2 comments or markup annotations."),
  ).toBeVisible({
    timeout: 20_000,
  });
  // Off by default: the run would only re-save.
  await expect(page.getByRole("button", { name: "Re-save PDF" })).toBeVisible();
  await page
    .getByRole("checkbox", { name: /Also flatten comments and markup/ })
    .check();
  await page
    .getByRole("button", { name: "Flatten comments and markup" })
    .click();

  const saved = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download flattened PDF" })
    .click({ timeout: 30_000 });
  const download = await saved;
  expect(download.suggestedFilename()).toBe("notes-flattened.pdf");
  const doc = await PDFDocument.load(readFileSync((await download.path())!));
  const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"));
  const kinds =
    annots instanceof PDFArray
      ? annots
          .asArray()
          .map((r) => doc.context.lookup(r) as PDFDict)
          .map((d) => d.get(PDFName.of("Subtype"))!.toString())
      : [];
  expect(kinds).toEqual(["/Link"]);
  // The two appearances are drawn by the page now, as form XObjects.
  const xobjects = doc
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("XObject"), PDFDict);
  expect(
    xobjects.keys().filter((k) => k.asString().startsWith("/FlatWidget")),
  ).toHaveLength(2);
});
