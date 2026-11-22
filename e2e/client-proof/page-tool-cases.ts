import { expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { addHeaderFooter } from "../../src/lib/pdf/header-footer";
import { fileInput, waitForHydration } from "../helpers";
import { captureDownload, pdfPageTexts } from "./artifacts";
import { makeTextPdf } from "./fixtures";
import type { CaseContext, VariantCase } from "./cases";

/**
 * Option variants of the page tools added by the 2026-11-22 audit wave
 * (lane w1a), each driven through the page and proved on the downloaded
 * file. Run by `client-tools.spec.ts` with every other variant.
 */

/** Pick `bytes` as `name` on the page's drop box. */
export async function uploadPdf(
  page: Page,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText(name, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

/** Press Run, wait for the result, and save the file the CTA downloads. */
export async function runAndSave(
  page: Page,
  runName: RegExp,
  resultHeading: RegExp,
  ctaName: RegExp,
): Promise<Buffer> {
  const run = page.getByRole("button", { name: runName });
  await expect(run).toBeEnabled();
  await waitForHydration(run);
  await run.click();
  await expect(page.getByRole("heading", { name: resultHeading })).toBeVisible({
    timeout: 60_000,
  });
  return captureDownload(page, page.getByRole("button", { name: ctaName }));
}

/** Why the header-footer caret variant rejects an artifact. */
const AT_CARET = "the field landed where the caret was, mid-text";

/** The header typed around the caret: the field goes between the words. */
const HEADER_BEFORE = "Sheet ";
const HEADER_AFTER = " end";

const headerFooterAtCaret: VariantCase = {
  slug: "header-footer",
  name: "{n} inserted at the caret, mid-text",
  kind: "header-footer",
  artifact: "pdf",
  run: async (ctx: CaseContext) => {
    const bytes = await makeTextPdf("caret.pdf", { pages: 2 });
    ctx.data.input = Buffer.from(bytes);
    await uploadPdf(ctx.page, "caret.pdf", bytes);
    const box = ctx.page.getByLabel("Header left", { exact: true });
    await box.fill(HEADER_BEFORE + HEADER_AFTER);
    // The caret goes between the two words, as a person clicks it there.
    await box.focus();
    await box.press("End");
    for (let i = 0; i < HEADER_AFTER.length; i++) await box.press("ArrowLeft");
    await ctx.page
      .getByRole("button", { name: "Insert {n} into Header left" })
      .click();
    await expect(box).toHaveValue(`${HEADER_BEFORE}{n}${HEADER_AFTER}`);
    return runAndSave(
      ctx.page,
      /add header & footer/i,
      /header & footer added/i,
      /^download pdf$/i,
    );
  },
  assert: async (buf) => {
    const texts = await pdfPageTexts(buf);
    expect(texts, AT_CARET).toHaveLength(2);
    expect(texts[1]!.replace(/\s+/g, " "), AT_CARET).toContain(
      `${HEADER_BEFORE}2${HEADER_AFTER}`,
    );
  },
  // The same file stamped with the field appended at the end, as the button
  // did before: every word right but the field's place.
  control: async (ctx) => {
    const appended = await addHeaderFooter(
      new Uint8Array(ctx.data.input as Buffer),
      {
        header: { left: `${HEADER_BEFORE}${HEADER_AFTER}{n}` },
        footer: { center: "Page {n} of {total}" },
      },
    );
    await PDFDocument.load(appended);
    return Buffer.from(appended);
  },
  rejectsBecause: [AT_CARET],
};

export const PAGE_TOOL_VARIANTS: readonly VariantCase[] = [headerFooterAtCaret];
