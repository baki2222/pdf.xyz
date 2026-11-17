import { test, expect, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";
import {
  askThreeFills,
  axeViolations,
  mockChatWorker,
} from "./chat-citations-fixture";
import {
  clipboardText,
  expectNoSidewaysScroll,
  extractionPackage,
  grantClipboard,
  mockCompletedJob,
  nextDownload,
  summaryPackage,
  textPdf,
  workbookRows,
} from "./ai-results-fixture";

/**
 * The AI results ON THE PAGE (competitor audit #4 and #16, 2026-11-17),
 * through the served pages with the worker mocked at the wire:
 *
 *  - AI Data Extraction draws the data as a table (markup as text), and
 *    Copy as table, Copy JSON, Download XLSX and Download CSV carry it;
 *  - Chat with PDF copies an answer and the conversation, and saves it as
 *    Markdown, with no request;
 *  - PDF to Text and Summarize PDF cap the box, never the copy.
 *
 * Every output is read where a reader receives it: the clipboard through the
 * page (`navigator.clipboard.readText`, permission granted), the downloaded
 * file decoded. Each result is then held to axe and to a 375x812 width.
 */

const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
/** Clipboard line breaks as text, whichever the platform wrote. */
const lines = (text: string) => text.split(CRLF).join(LF);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await grantClipboard(page);
});

async function atPhoneWidth(page: Page) {
  await page.setViewportSize({ width: 375, height: 812 });
  // Let the layout settle at the new width before measuring it.
  await page.waitForTimeout(200);
  await expectNoSidewaysScroll(page);
}

async function choosePdf(page: Page, path: string, name: string, pdf: Buffer) {
  await page.goto(path);
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({ name, mimeType: "application/pdf", buffer: pdf });
}

test("AI Data Extraction: the table, Copy as table, Copy JSON, Download XLSX and CSV", async ({
  page,
}) => {
  const data = [
    { item: "Widget", amount: "=1+1" },
    { item: "<b>bold</b>", amount: "-4" },
    { item: "Gadget", amount: "12.50" },
  ];
  await mockCompletedJob(
    page,
    "ai-extract",
    "report-extraction.zip",
    await extractionPackage(data),
  );
  await choosePdf(
    page,
    "/tools/ai-extract",
    "report.pdf",
    await textPdf([["Invoice INV-7. Widget =1+1. Gadget 12.50."]]),
  );
  await page.getByRole("textbox", { name: "Field 1 name" }).fill("item");
  const run = page.getByRole("button", { name: "Extract data" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await run.click();

  const region = page.getByRole("region", { name: "Extracted data" });
  await expect(region).toBeVisible({ timeout: 20_000 });
  const table = region.getByRole("table");
  await expect(
    table.getByText("The records the AI extracted, one per row"),
  ).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText(["item", "amount"]);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  // The markup is characters on the page, never an element.
  await expect(table.getByText("<b>bold</b>", { exact: true })).toBeVisible();
  await expect(table.locator("b")).toHaveCount(0);

  await page.getByRole("button", { name: "Copy as table" }).click();
  await expect(
    page.getByText("Copied to your clipboard.").first(),
  ).toBeVisible();
  expect(lines(await clipboardText(page))).toBe(
    ["item\tamount", "Widget\t'=1+1", "<b>bold</b>\t-4", "Gadget\t12.50"].join(
      LF,
    ),
  );

  await page.getByRole("button", { name: "Copy JSON" }).click();
  await expect
    .poll(async () => JSON.parse(await clipboardText(page)))
    .toEqual(data);

  const xlsx = await nextDownload(page, () =>
    page.getByRole("button", { name: "Download XLSX" }).click(),
  );
  expect(xlsx.name).toBe("report-extraction.xlsx");
  const book = await workbookRows(xlsx.bytes);
  expect(book.name).toBe("Extraction");
  expect(book.rows).toEqual([
    ["item", "amount"],
    ["Widget", "=1+1"],
    ["<b>bold</b>", "-4"],
    ["Gadget", "12.50"],
  ]);
  // The formula is a text cell; the amounts are numbers (positive control).
  expect(book.types[1]).toEqual(["text", "text"]);
  expect(book.types[2]).toEqual(["text", "number"]);

  const csv = await nextDownload(page, () =>
    page.getByRole("button", { name: "Download CSV" }).click(),
  );
  expect(csv.name).toBe("report-extraction.csv");
  expect(csv.bytes.toString("utf8")).toContain(`Widget,"'=1+1"`);

  expect(await axeViolations(page)).toEqual([]);
  await atPhoneWidth(page);
  await expect(region).toBeVisible();
});

test("Chat with PDF: Copy answer, Copy conversation and the .md, with no request", async ({
  page,
}) => {
  const question = "Where is the rent?";
  const answer = "The rent is on page two [p.2].";
  await mockChatWorker(page, question, answer, [2]);
  await askThreeFills(page, question);
  const copy = page.getByRole("button", { name: "Copy answer" });
  await expect(copy).toBeVisible({ timeout: 20_000 });

  const requests: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("blob:") && !r.url().startsWith("data:"))
      requests.push(r.url());
  });
  await copy.click();
  await expect.poll(() => clipboardText(page)).toBe(answer);

  await page.getByRole("button", { name: "Copy conversation" }).click();
  await expect
    .poll(async () => lines(await clipboardText(page)))
    .toBe(
      [`Q: ${question}`, "", `A: ${answer}`, "Cited pages: [p.2]"].join(LF),
    );

  const md = await nextDownload(page, () =>
    page.getByRole("button", { name: "Download conversation (.md)" }).click(),
  );
  // The mocked package is named answer.zip (a real one is <stem>-answer.zip,
  // which the unit tests hold to <stem>-conversation.md).
  expect(md.name).toBe("answer-conversation.md");
  expect(md.bytes.toString("utf8")).toBe(
    [
      "# Chat with PDF: answer",
      "## Question 1",
      question,
      "**Answer**",
      answer,
      "Cited pages: [p.2]",
    ].join(LF + LF) + LF,
  );
  // Built in the page: the three presses asked the network for nothing.
  expect(requests).toEqual([]);

  expect(await axeViolations(page)).toEqual([]);
  await atPhoneWidth(page);
  await expect(copy).toBeVisible();
});

test("PDF to Text: the box is capped and says so; Copy text copies every character", async ({
  page,
}) => {
  const TAIL = "END-OF-DOCUMENT";
  const pages = Array.from({ length: 20 }, (_, p) =>
    Array.from(
      { length: 80 },
      (_, i) =>
        `Line ${p + 1}-${i + 1} lorem ipsum dolor sit amet consectetur adipiscing`,
    ),
  );
  pages.at(-1)!.push(TAIL);
  await choosePdf(page, "/tools/pdf-to-text", "book.pdf", await textPdf(pages));
  await page.getByRole("button", { name: "Extract text" }).click();
  const box = page.locator("[data-long-text]");
  await expect(box).toHaveAttribute("data-long-text", "cut", {
    timeout: 30_000,
  });
  const shown = (await box.textContent()) ?? "";
  expect(shown.length).toBeLessThanOrEqual(50_000);
  expect(shown).not.toContain(TAIL);
  await expect(
    page.getByText(
      /^Only the first 50,000 of [\d,]+ characters are shown here\. Copying or downloading gives you all of it\.$/,
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Copy text" }).click();
  await expect
    .poll(async () => (await clipboardText(page)).length)
    .toBeGreaterThan(50_000);
  expect(await clipboardText(page)).toContain(TAIL);

  expect(await axeViolations(page)).toEqual([]);
  await atPhoneWidth(page);
});

test("Summarize PDF: the Summary box is capped and says so; Copy summary copies all of it", async ({
  page,
}) => {
  const TAIL = "END-OF-THE-SUMMARY";
  const summary = `${"The lease runs for three years. ".repeat(1_700)}${TAIL}`;
  expect(summary.length).toBeGreaterThan(50_000);
  await mockCompletedJob(
    page,
    "summarize-pdf",
    "report-summary.zip",
    await summaryPackage(summary),
  );
  await choosePdf(
    page,
    "/tools/summarize-pdf",
    "report.pdf",
    await textPdf([["A lease agreement with selectable text on its page."]]),
  );
  const run = page.getByRole("button", { name: "Summarize PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await run.click();
  const box = page.getByRole("region", { name: "Summary" });
  await expect(box).toBeVisible({ timeout: 20_000 });
  expect(((await box.textContent()) ?? "").length).toBe(50_000);
  await expect(box).not.toContainText(TAIL);
  await expect(page.getByText(/^Only the first 50,000 of /)).toBeVisible();

  await page.getByRole("button", { name: "Copy summary" }).click();
  await expect.poll(() => clipboardText(page)).toContain(TAIL);

  expect(await axeViolations(page)).toEqual([]);
  await atPhoneWidth(page);
});
