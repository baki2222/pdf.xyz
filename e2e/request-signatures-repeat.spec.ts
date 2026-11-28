import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  PDFHexString,
} from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { createRequestSignaturesProcessor } from "../src/lib/workers/processor/request-signatures";
import { signatureRequestDeps } from "../src/lib/workers/request-signatures/native";
import { fileInput, waitForHydration } from "./helpers";
import {
  mockSignatureWorker,
  type SentOptions,
} from "./request-signatures-fixture";

/**
 * Request Signatures: one Initials box repeated on every page in one action
 * (audit request-signatures#3, 2026-11-06), proven at the FILE a user
 * downloads.
 *
 * The worker is mocked at the wire as in the placement specs — no production
 * job is run, since the tool uploads real names and addresses — but the job
 * the page POSTs is run through the REAL processor (`signatureRequestDeps`,
 * pdf-lib, no native binary) in this process, on the very bytes the page
 * uploaded, and its ZIP is what the page downloads. So the chain is the page's
 * Repeat → the options on the wire → the worker's placement → prepared.pdf's
 * AcroForm, read back here.
 */

async function fivePagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 5; i += 1) doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

const text = (v: unknown) =>
  v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : "";

/** Every widget on every page: its page, field name and rectangle. */
async function widgetsOf(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const out: { page: number; name: string; rect: number[] }[] = [];
  doc.getPages().forEach((page, i) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    for (let k = 0; k < (annots?.size() ?? 0); k += 1) {
      const annot = annots!.lookupMaybe(k, PDFDict);
      if (annot?.get(PDFName.of("Subtype")) !== PDFName.of("Widget")) continue;
      const parent = annot.lookupMaybe(PDFName.of("Parent"), PDFDict);
      const name =
        text(annot.lookup(PDFName.of("T"))) ||
        text(parent?.lookup(PDFName.of("T")));
      const rect = annot.lookupMaybe(PDFName.of("Rect"), PDFArray);
      out.push({
        page: i + 1,
        name,
        rect: (rect?.asArray() ?? []).map((n) =>
          n instanceof PDFNumber ? Math.round(n.asNumber() * 100) / 100 : NaN,
        ),
      });
    }
  });
  return out;
}

test("Repeat puts an Initials box on all 5 pages; prepared.pdf has 5 named widgets, one per page, at the same rect", async ({
  page,
}) => {
  const { sent, unanswered } = await mockSignatureWorker(page);
  // Later routes win: capture the upload, and answer the job with the REAL
  // processor's package.
  let uploaded: Uint8Array | null = null;
  let pkg: Buffer | null = null;
  await page.route("**/__e2e/reqsig-upload/**", async (route) => {
    uploaded = new Uint8Array(route.request().postDataBuffer() ?? []);
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  });
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/jobs"
    ) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        options: SentOptions;
      };
      void (async () => {
        const result = await createRequestSignaturesProcessor(
          signatureRequestDeps(),
        ).process({
          tool: "request-signatures",
          options: body.options as unknown as Record<string, unknown>,
          inputs: [
            {
              fileId: "f_reqsig000001",
              filename: "contract.pdf",
              contentType: "application/pdf",
              bytes: uploaded ?? new Uint8Array(),
            },
          ],
        });
        if (result.ok) pkg = Buffer.from(result.artifacts[0]!.bytes);
      })();
    }
  });
  await page.route("**/__e2e/reqsig-art/**", async (route) => {
    await expect.poll(() => pkg !== null, { timeout: 20_000 }).toBe(true);
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/zip" },
      body: pkg!,
    });
  });

  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/request-signatures");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: await fivePagePdf(),
  });
  await page.getByLabel("Signer 1 name").fill("Ada Lovelace");
  await page.getByLabel("Signer 1 email").fill("ada@example.com");
  const sheet = page.getByTestId("signature-page-preview");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Page 5 of 5\./)).toBeVisible();

  // One Initials box on page 5, then Repeat on All pages.
  await page.getByRole("button", { name: "Initials", exact: true }).click();
  const box = page.getByLabel("Box to repeat");
  const initialsOption = box
    .locator("option")
    .filter({ hasText: "Initials, page 5" });
  await expect(initialsOption).toHaveCount(1);
  await box.selectOption({ label: (await initialsOption.textContent())! });
  await page.getByLabel("Repeat on").selectOption("All pages");
  await page.getByRole("button", { name: "Repeat", exact: true }).click();
  await expect(
    page.getByText(/^Repeated Signer 1 Initials box on 4 more pages/),
  ).toBeVisible();
  // Every page now shows its own Initials box.
  for (let p = 4; p >= 1; p -= 1) {
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(
      page.getByText(new RegExp(`^Page ${p} of 5\\.`)),
    ).toBeVisible();
    await expect(
      sheet.locator('[data-field-box][data-kind="initials"]'),
    ).toHaveCount(1);
  }

  await page.getByRole("button", { name: "Prepare signature request" }).click();
  await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
  const initials = sent[0]!.options.fields.filter((f) => f.type === "initials");
  expect(initials.map((f) => f.page).sort()).toEqual([1, 2, 3, 4, 5]);
  expect(initials.every((f) => f.signer === 0)).toBe(true);
  expect(
    new Set(initials.map((f) => `${f.x},${f.y},${f.width},${f.height}`)).size,
  ).toBe(1);

  // The file the reader downloads.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download / }).click();
  const path = await (await download).path();
  const { readFile } = await import("node:fs/promises");
  const zip = await JSZip.loadAsync(await readFile(path!));
  const prepared = await zip.file("prepared.pdf")!.async("uint8array");
  const widgets = await widgetsOf(prepared);
  const mine = widgets.filter((w) => /^Signer1-Initials-\d+$/.test(w.name));
  // Health: the reader saw the other boxes too (a blind reader finds none).
  expect(widgets.some((w) => w.name === "Signer1-Signature-1")).toBe(true);
  expect(mine).toHaveLength(5);
  expect(new Set(mine.map((w) => w.name)).size).toBe(5);
  expect(mine.map((w) => w.page).sort()).toEqual([1, 2, 3, 4, 5]);
  expect(new Set(mine.map((w) => w.rect.join(","))).size).toBe(1);
  expect(unanswered).toEqual([]);
});
