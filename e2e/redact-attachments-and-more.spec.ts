import { test, expect, type Page } from "@playwright/test";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { captureDownload, pdfPageTexts } from "./client-proof/artifacts";

/**
 * Redact PDF's "Remove text under boxes" through the served page, every
 * claim read back from the DOWNLOADED file:
 *
 *  - audit redact-pdf#1: a name in the page text AND inside an attached
 *    notes.txt is refused, the attachment named, and nothing downloads; the
 *    control, an attachment without the name, is kept byte for byte while
 *    the name leaves the page.
 *  - audit redact-pdf#4: 1,200 email addresses, past the 500 a Detect
 *    lists: "Find more from page N" twice reaches them all, and pdf.js finds
 *    none of the 1,200 in the download.
 */

const NAME = "Jane Q. Example";

async function nameWithAttachment(attached: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 300]);
  page.drawText(`Patient: ${NAME}`, { x: 24, y: 260, size: 12, font });
  page.drawText("Keep this line exactly.", { x: 24, y: 236, size: 12, font });
  await doc.attach(new TextEncoder().encode(attached), "notes.txt", {
    mimeType: "text/plain",
  });
  return Buffer.from(await doc.save());
}

/** Every embedded file in `bytes`, inflated, by name. */
async function attachments(bytes: Buffer): Promise<Map<string, string>> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = new Map<string, string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const ef = obj.lookup(PDFName.of("EF"));
    if (!(ef instanceof PDFDict)) continue;
    const stream = ef.lookup(PDFName.of("F"));
    if (!(stream instanceof PDFRawStream)) continue;
    const name = obj.lookup(PDFName.of("UF")) ?? obj.lookup(PDFName.of("F"));
    out.set(
      (name as unknown as { decodeText(): string }).decodeText(),
      Buffer.from(decodePDFRawStream(stream).decode()).toString("utf8"),
    );
  }
  return out;
}

async function open(page: Page, name: string, buffer: Buffer) {
  await page.goto("/tools/redact-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({ name, mimeType: "application/pdf", buffer });
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function findName(page: Page) {
  await page.getByLabel(/search the text/i).fill(NAME);
  await page.getByRole("button", { name: /^find$/i }).click();
  await expect(page.getByText(/1 of 1 will be redacted/i)).toBeVisible();
  await page.getByRole("radio", { name: "Remove text under boxes" }).click();
}

test("redact: a name inside an attached file stops the save, and names the file", async ({
  page,
}) => {
  await open(
    page,
    "chart.pdf",
    await nameWithAttachment(`Call ${NAME} on Monday.\n`),
  );
  await findName(page);
  await page.getByRole("button", { name: /^redact pdf$/i }).click();
  await expect(
    page.getByText(
      `“${NAME}” is still in the attached file “notes.txt”, so the file was not saved.`,
      { exact: false },
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: /download redacted pdf/i }),
  ).toHaveCount(0);
});

test("redact: control — an attachment without the name is kept, byte for byte", async ({
  page,
}) => {
  const kept = "Appointment on Monday at 10.\n";
  const source = await nameWithAttachment(kept);
  expect((await attachments(source)).get("notes.txt")).toBe(kept);
  await open(page, "chart.pdf", source);
  await findName(page);
  await page.getByRole("button", { name: /^redact pdf$/i }).click();
  await expect(
    page.getByText(/the contents of any attached file/i),
  ).toBeVisible({ timeout: 30_000 });
  const out = await captureDownload(
    page,
    page.getByRole("button", { name: /download redacted pdf/i }),
  );
  const files = await attachments(out);
  expect([...files.keys()]).toEqual(["notes.txt"]);
  expect(files.get("notes.txt")).toBe(kept);
  const [text = ""] = await pdfPageTexts(out);
  expect(text).not.toContain(NAME);
  expect(text).toContain("Keep this line exactly.");
});

test("redact: 1,200 addresses — Find more reaches them all, and the download holds none", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const PER_PAGE = 40;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let start = 0; start < 1200; start += PER_PAGE) {
    const p = doc.addPage([595, 842]);
    for (let i = start; i < start + PER_PAGE; i++)
      p.drawText(`person${i}@mail.test`, {
        x: 56,
        y: 800 - (i - start) * 19,
        size: 11,
        font,
      });
  }
  const source = Buffer.from(await doc.save());
  const count = (texts: string[]) =>
    texts.join(" ").match(/person\d+@mail\.test/g)?.length ?? 0;
  // Health: the fixture holds every address, as pdf.js reads it.
  expect(count(await pdfPageTexts(source))).toBe(1200);

  await open(page, "export.pdf", source);
  await page.getByRole("button", { name: /^detect$/i }).click();
  await expect(page.getByText("500 of 500 will be redacted")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Find more from page 13" }).click();
  await expect(page.getByText("1000 of 1000 will be redacted")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /^Find more from page / }).click();
  await expect(page.getByText(/That is all of them\./)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("1200 of 1200 will be redacted")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Find more/ })).toHaveCount(0);

  await page.getByRole("radio", { name: "Remove text under boxes" }).click();
  await page.getByRole("button", { name: /^redact pdf$/i }).click();
  await expect(page.getByText(/all 1200 chosen text matches/i)).toBeVisible({
    timeout: 120_000,
  });
  const out = await captureDownload(
    page,
    page.getByRole("button", { name: /download redacted pdf/i }),
  );
  expect(count(await pdfPageTexts(out))).toBe(0);
});
