import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
} from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";

/**
 * Two review findings (2026-11-28), driven through the served pages and
 * read back from the DOWNLOADED files:
 *  - finding 2: a form flagged /NeedAppearances, filled with a Bengali
 *    answer in Fill Forms, then opened in Flatten PDF. Flatten refused the
 *    file Fill Forms had just made; now it flattens both fields.
 *  - finding 1: with "Also flatten comments and markup" ticked, a pending
 *    Redact mark was baked in and deleted while the text stayed. Now it is
 *    kept live, listed with a reason, and only the stamp beside it is drawn.
 */

async function flaggedForm(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 520]);
  const form = doc.getForm();
  form
    .createTextField("applicant.name")
    .addToPage(page, { x: 40, y: 440, width: 300, height: 30 });
  const prior = form.createTextField("applicant.city");
  prior.setText("");
  prior.addToPage(page, { x: 40, y: 380, width: 300, height: 30 });
  await doc.save();
  prior.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("Dhaka"));
  form.markFieldAsClean(prior.ref);
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  return Buffer.from(await doc.save({ updateFieldAppearances: false }));
}

async function denyConsent(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
}

test("a flagged form filled in Bengali in Fill Forms then flattens in Flatten PDF", async ({
  page,
}) => {
  await denyConsent(page);
  await page.goto("/tools/fill-forms");
  let input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: await flaggedForm(),
  });
  const row = page
    .getByTitle("applicant.name", { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]")
    .locator('input[type="text"]');
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.fill("রহিম কিশোর");
  await page.getByRole("button", { name: "Fill form", exact: true }).click();
  const fillDownload = page.getByRole("button", {
    name: "Download filled PDF",
  });
  await expect(fillDownload).toBeVisible({ timeout: 30_000 });
  const filledEvent = page.waitForEvent("download");
  await fillDownload.click();
  const filled = readFileSync((await (await filledEvent).path())!);
  const filledDoc = await PDFDocument.load(filled);
  expect(
    filledDoc.getForm().acroForm.dict.get(PDFName.of("NeedAppearances")),
  ).not.toBe(PDFBool.True);

  await page.goto("/tools/flatten-pdf");
  input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "form-filled.pdf",
    mimeType: "application/pdf",
    buffer: filled,
  });
  await page
    .getByRole("button", { name: "Flatten form fields" })
    .click({ timeout: 20_000 });
  const flatDownload = page.getByRole("button", {
    name: "Download flattened PDF",
  });
  await expect(flatDownload).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("2 form fields flattened")).toBeVisible();
  const flatEvent = page.waitForEvent("download");
  await flatDownload.click();
  const flat = await PDFDocument.load(
    readFileSync((await (await flatEvent).path())!),
  );
  expect(flat.getForm().getFields()).toHaveLength(0);
});

async function redactionPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("SSN 123-45-6789", { x: 50, y: 400, size: 14, font });
  const ctx = doc.context;
  const box = (w: number, h: number) =>
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
        Subtype: "Redact",
        Rect: [45, 395, 200, 418],
        AP: ctx.obj({ N: box(155, 23) }),
      }),
    ),
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Stamp",
        Rect: [40, 200, 160, 240],
        AP: ctx.obj({ N: box(120, 40) }),
      }),
    ),
  ];
  page.node.set(PDFName.of("Annots"), ctx.obj(refs));
  return Buffer.from(await doc.save());
}

test("a pending redaction is kept live and listed; only the stamp is drawn in", async ({
  page,
}) => {
  await denyConsent(page);
  await page.goto("/tools/flatten-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "redact.pdf",
    mimeType: "application/pdf",
    buffer: await redactionPdf(),
  });
  // The redaction is not one of the marks the box acts on.
  await expect(
    page.getByText("Found 1 comment or markup annotation."),
  ).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole("checkbox", { name: /Also flatten comments and markup/ })
    .check();
  await page
    .getByRole("button", { name: "Flatten comments and markup" })
    .click();
  const download = page.getByRole("button", {
    name: "Download flattened PDF",
  });
  await expect(download).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Redact on page 1 \(.*Redact PDF/)).toBeVisible();
  const saved = page.waitForEvent("download");
  await download.click();
  const doc = await PDFDocument.load(
    readFileSync((await (await saved).path())!),
  );
  const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"));
  const kinds =
    annots instanceof PDFArray
      ? annots
          .asArray()
          .map((r) => doc.context.lookup(r) as PDFDict)
          .map((d) => d.get(PDFName.of("Subtype"))!.toString())
      : [];
  expect(kinds).toEqual(["/Redact"]);
});
