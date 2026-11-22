import { test, expect, type Page, type Route } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { translateAlreadyInLanguageMessage } from "../src/lib/jobs/translate-script";

/**
 * translate-pdf#1 through the SERVED page. An English PDF with the defaults
 * (Auto-detect into English) used to be uploaded and charged for an
 * English-to-English copy. The page now reads the PDF's common words in the
 * browser and stops before anything is sent: no upload and no job request,
 * counted at the wire. A Spanish PDF into English still runs (control).
 */

const ENGLISH = [
  "This agreement is made between the company and the tenant.",
  "The tenant will pay the rent on the first day of each month.",
  "The company will repair the roof when it is needed.",
  "If either party wants to end this agreement, they should give notice.",
];
const SPANISH = [
  "Este contrato se firma entre la empresa y el inquilino.",
  "El inquilino pagará el alquiler el primer día de cada mes.",
  "La empresa reparará el techo cuando sea necesario.",
  "Si una de las partes quiere terminar el contrato, debe avisar por escrito.",
];

async function linesPdf(lines: readonly string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) =>
    page.drawText(line, { x: 20, y: 360 - i * 20, size: 10, font }),
  );
  return doc.save();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Counts every upload and job request; the job fails at once when sent. */
async function mockWorker(page: Page) {
  const sent = { uploads: 0, jobs: 0 };
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", (route) => {
    sent.uploads += 1;
    return json(route, 500, { error: { code: "internal_error" } });
  });
  await page.route("**/api/jobs", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.jobs += 1;
    return json(route, 500, { error: { code: "internal_error" } });
  });
  return sent;
}

async function choose(page: Page, bytes: Uint8Array, name: string) {
  await page.goto("/tools/translate-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  return page.getByRole("button", { name: "Translate PDF" });
}

test("an English PDF with the defaults stops before upload, with the message shown", async ({
  page,
}) => {
  const sent = await mockWorker(page);
  const run = await choose(page, await linesPdf(ENGLISH), "lease.pdf");
  await expect(
    page.getByText(translateAlreadyInLanguageMessage("en")),
  ).toBeVisible();
  await expect(run).toHaveAttribute("aria-disabled", "true");
  // Pressed anyway: still nothing leaves the browser.
  await run.click({ force: true });
  await expect(
    page.getByText(translateAlreadyInLanguageMessage("en")),
  ).toBeVisible();
  expect(sent).toEqual({ uploads: 0, jobs: 0 });
});

test("CONTROL: a Spanish PDF into English still runs", async ({ page }) => {
  const sent = await mockWorker(page);
  const run = await choose(page, await linesPdf(SPANISH), "contrato.pdf");
  // Proof the check ran on this file: into Spanish it stops...
  await page.getByLabel("Translate into").selectOption("es");
  await expect(
    page.getByText(translateAlreadyInLanguageMessage("es")),
  ).toBeVisible();
  // ...and into English, the default, it does not.
  await page.getByLabel("Translate into").selectOption("en");
  await expect(page.getByText(/looks like it is already in/)).toHaveCount(0);
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await run.click();
  await expect.poll(() => sent.uploads + sent.jobs).toBeGreaterThan(0);
});
