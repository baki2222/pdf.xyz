import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  attachConsoleGuard,
  fileInput,
  uploadFiles,
  waitForHydration,
  writeTempPdf,
} from "./helpers";
import { captureDownload, pdfPageTexts } from "./client-proof/artifacts";

/**
 * End-to-end proof that the redaction runner works entirely in the browser: we
 * stage a multi-page PDF, add a redaction box, and run it — which exercises the
 * bundled pdfjs worker + wasm (raster path) and the canvas paint-over under the
 * production CSP, then yields a downloadable rebuilt PDF.
 */
test("redact bakes a box into a rasterized PDF client-side", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const source = await writeTempPdf("secret.pdf", 2);

  await page.goto("/tools/redact-pdf");

  await uploadFiles(page, source);

  // The editor mounts once the PDF is parsed: the file header names the doc.
  await expect(page.getByText("secret.pdf")).toBeVisible();

  // With no areas yet, running is a no-op and stays disabled.
  const redactButton = page.getByRole("button", { name: /^redact pdf$/i });
  await expect(redactButton).toBeDisabled();

  // The default draft box fits the 320×240 pt fixture page — add it once the
  // page sizes have loaded (the button is disabled until then).
  const addButton = page.getByRole("button", { name: /add area/i });
  await addButton.click();

  await expect(
    page.getByRole("button", { name: /remove redaction area 1/i }),
  ).toBeVisible();
  await expect(redactButton).toBeEnabled();
  await redactButton.click();

  await expect(
    page.getByRole("heading", { name: /redacted pdf ready/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /download redacted pdf/i }),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});

/** A one-page statement with personal data, two decoys and a line to keep. */
async function statementPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 300]);
  [
    "Customer: Jane Example",
    "Email: jane.example@mail.test",
    "Card: 4111 1111 1111 1111",
    "Phone: +44 20 7946 0958",
    "Order no. 48213907 placed in 2019",
    "Keep this line exactly.",
  ].forEach((line, i) =>
    page.drawText(line, { x: 24, y: 260 - i * 24, size: 12, font }),
  );
  return doc.save();
}

test("redact: detect personal data, review, remove the text — and the rest stays text, at 375 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const guard = attachConsoleGuard(page);
  await page.goto("/tools/redact-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await statementPdf()),
  });
  await expect(page.getByText("statement.pdf")).toBeVisible();

  await page.getByRole("button", { name: /^detect$/i }).click();
  const review = page.getByRole("list", { name: /text to redact/i });
  await expect(review.getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByText(/3 of 3 will be redacted/i)).toBeVisible();

  // Find text adds a match of its own to the same list.
  // Match case, so the e-mail address's "jane" is not a second hit.
  await page.getByLabel(/search the text/i).fill("Jane");
  await page.getByLabel("Match case").check();
  await page.getByRole("button", { name: /^find$/i }).click();
  await expect(page.getByText(/4 of 4 will be redacted/i)).toBeVisible();
  // ...and unticking one keeps it in the file.
  await review
    .getByRole("checkbox", { name: /redact “Jane” on page 1/i })
    .uncheck();
  await expect(page.getByText(/3 of 4 will be redacted/i)).toBeVisible();

  await page.getByRole("radio", { name: "Remove text under boxes" }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: /^redact pdf$/i }).click();
  await expect(
    page.getByRole("heading", { name: /redacted pdf ready/i }),
  ).toBeVisible();
  await expect(page.getByText(/all 3 chosen text matches/i)).toBeVisible();
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /download redacted pdf/i }),
  );
  const [text = ""] = await pdfPageTexts(buf);
  for (const gone of [
    "jane.example@mail.test",
    "4111 1111 1111 1111",
    "+44 20 7946 0958",
  ]) {
    expect(text).not.toContain(gone);
  }
  expect(text).toContain("Customer: Jane Example");
  expect(text).toContain("Order no. 48213907 placed in 2019");
  expect(text).toContain("Keep this line exactly.");
  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});

test("redact: matches from Detect are flattened by default (the method is unchanged)", async ({
  page,
}) => {
  await page.goto("/tools/redact-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await statementPdf()),
  });
  await expect(page.getByText("statement.pdf")).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Flatten every page" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: /^detect$/i }).click();
  await expect(page.getByText(/3 of 3 will be redacted/i)).toBeVisible();
  await page.getByRole("button", { name: /^redact pdf$/i }).click();
  await expect(
    page.getByRole("heading", { name: /redacted pdf ready/i }),
  ).toBeVisible();
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /download redacted pdf/i }),
  );
  // Flattened: no text at all is left on the page.
  const [text = ""] = await pdfPageTexts(buf);
  expect(text.trim()).toBe("");
});
