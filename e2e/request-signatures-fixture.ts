import { expect, type Locator, type Page, type Route } from "@playwright/test";
import JSZip from "jszip";
import { PDFDocument, degrees } from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { fileInput, waitForHydration } from "./helpers";

/**
 * The served Request Signatures page with its worker mocked at the wire
 * (`page.route`), shared by the desktop and touch-phone placement specs
 * (audit #21, 2026-11-17). Nothing here reaches a real worker: Request
 * Signatures uploads real names and addresses, so no production job is ever
 * run to test it. Every `/api/jobs` request must be one the mock answered.
 */

export interface SentField {
  signer: number;
  page: number;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}
export interface SentOptions {
  signers: { name: string; email: string }[];
  fields: SentField[];
  message?: string;
}

/**
 * Three US Letter pages; page 3 — the default Signature page — is turned
 * `/Rotate 90` with an inset CropBox, so the sheet shows it landscape and
 * every box placed there goes through the displayed-frame mapping.
 */
export async function threePagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  const third = doc.addPage([612, 792]);
  third.setCropBox(36, 48, 540, 696);
  third.setRotation(degrees(90));
  return Buffer.from(await doc.save());
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Mock the worker; returns the job bodies the page POSTed, as sent. */
export async function mockSignatureWorker(page: Page) {
  const sent: { options: SentOptions }[] = [];
  const unanswered: string[] = [];
  const zip = new JSZip();
  zip.file("README.txt", "mock\n");
  const pkg = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  const now = new Date().toISOString();
  const done = {
    jobId: "job_reqsig00001",
    tool: "request-signatures",
    capability: "secure-worker",
    status: "completed",
    progress: 100,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    artifacts: [
      {
        artifactId: "art_reqsig00001",
        filename: "contract-signature-request.zip",
        contentType: "application/zip",
        bytes: pkg.byteLength,
        url: "/__e2e/reqsig-art/1",
        expiresAt: now,
      },
    ],
  };
  // Any /api/jobs request no route below fulfils is a failure.
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/jobs")) unanswered.push(request.url());
  });
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, 200, {
      sessionId: "ses_reqsig1",
      tool: "request-signatures",
      slots: [
        {
          fileId: "f_reqsig000001",
          filename: "in",
          url: "/__e2e/reqsig-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/reqsig-upload/**", (route) =>
    json(route, 200, {}),
  );
  await page.route("**/api/jobs**", (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/jobs"
    ) {
      sent.push(JSON.parse(request.postData() ?? "{}"));
      return json(route, 200, done);
    }
    if (new URL(request.url()).pathname === `/api/jobs/${done.jobId}`)
      return json(route, 200, done);
    unanswered.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });
  await page.route("**/__e2e/reqsig-art/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/zip" },
      body: pkg,
    }),
  );
  return { sent, unanswered };
}

export async function openWithPdf(page: Page) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/request-signatures");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: await threePagePdf(),
  });
  await page.getByLabel("Signer 1 name").fill("Ada Lovelace");
  await page.getByLabel("Signer 1 email").fill("ada@example.com");
  const sheet = page.getByTestId("signature-page-preview");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.locator("[data-field-box]")).toHaveCount(2);
  return sheet;
}

/**
 * Each box on the sheet as the reader SEES it: its on-screen rectangle
 * relative to the sheet's, converted to the contract's bottom-left fractions.
 */
export async function seenBoxes(sheet: Locator) {
  // One read, in one frame: a page still scrolling between a read of the
  // sheet and a read of a box would skew every fraction (found 2026-11-17:
  // an 11 px gap after a fill scrolled the page).
  return sheet.evaluate((el) => {
    const s = el.getBoundingClientRect();
    const boxes = [...el.querySelectorAll<HTMLElement>("[data-field-box]")].map(
      (box) => {
        const b = box.getBoundingClientRect();
        return {
          kind: box.getAttribute("data-kind") ?? "?",
          x: (b.left - s.left) / s.width,
          y: (s.bottom - b.bottom) / s.height,
          width: b.width / s.width,
          height: b.height / s.height,
        };
      },
    );
    return { sheet: { width: s.width, height: s.height }, boxes };
  });
}

/** The sent fields of one page match what the sheet showed, within half a pixel. */
export function expectSentAsSeen(
  sent: SentField[],
  seen: Awaited<ReturnType<typeof seenBoxes>>,
  page: number,
) {
  const mine = sent.filter((f) => f.page === page);
  expect(mine.length, `boxes on page ${page}`).toBe(seen.boxes.length);
  const order = <T extends { x: number; y: number }>(list: T[]) =>
    [...list].sort((a, b) => a.y - b.y || a.x - b.x);
  const want = order(mine);
  const got = order(seen.boxes);
  const tolX = 0.5 / seen.sheet.width;
  const tolY = 0.5 / seen.sheet.height;
  want.forEach((field, i) => {
    const box = got[i]!;
    expect(box.kind, `page ${page} box ${i}`).toBe(field.type);
    for (const [k, tol] of [
      ["x", tolX],
      ["width", tolX],
      ["y", tolY],
      ["height", tolY],
    ] as const) {
      expect(field[k]).toBeGreaterThanOrEqual(0);
      expect(field[k]).toBeLessThanOrEqual(1);
      expect(
        Math.abs(box[k] - field[k]),
        `page ${page} ${field.type} ${k}: seen ${box[k]}, sent ${field[k]}`,
      ).toBeLessThanOrEqual(tol + 1e-9);
    }
  });
}
