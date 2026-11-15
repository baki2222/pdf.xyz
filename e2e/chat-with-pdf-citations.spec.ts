import {
  test,
  expect,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import {
  colourDistance,
  decodePng,
  pixelAt,
  type Rgb,
} from "../src/lib/png-probe";

/**
 * Clickable citations through the SERVED page (audit #30, chat-with-pdf#3,
 * 2026-11-15), the worker mocked at the wire (`page.route`):
 *
 * A three-page PDF whose pages are three different solid fills is asked a
 * question; the stubbed job's answer package says "[p.2]". Pressing the
 * marker must show PAGE 2 OF THAT FILE — judged on the decoded pixels of the
 * image the dialog draws, with pages 1 and 3 as the controls a wrong index
 * would land on — and must send nothing: after the press, no request to
 * /api/, nothing with a body, only same-origin static GETs (the dialog's and
 * pdfjs's chunks, pdfjs's wasm/cmap assets) and Next's RSC prefetches.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const FILLS: Rgb[] = [
  { r: 220, g: 40, b: 40 },
  { r: 40, g: 180, b: 60 },
  { r: 40, g: 70, b: 220 },
];

const QUESTION = "What does page 2 say?";
const ANSWER = "Page 2 holds the green section [p.2].";

/** Three pages, each a solid fill, each with a line of text so it counts. */
async function threeFills(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  FILLS.forEach((fill, i) => {
    const page = doc.addPage([300, 400]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 300,
      height: 400,
      color: rgb(fill.r / 255, fill.g / 255, fill.b / 255),
    });
    page.drawText(`Section ${i + 1}`, {
      x: 12,
      y: 380,
      size: 10,
      font,
      color: rgb(1, 1, 1),
    });
  });
  return Buffer.from(await doc.save());
}

/** The package a completed chat job ships, as the engine lays it out. */
async function answerPackage(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("answer.txt", `Q: ${QUESTION}\n\nA: ${ANSWER}\n`);
  zip.file("answer.md", `# ${QUESTION}\n\n${ANSWER}\n`);
  zip.file(
    "manifest.json",
    JSON.stringify({ schema: "pdfxyz.chat/v1", answer: { citedPages: [2] } }),
  );
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function mockChatWorker(page: Page) {
  const pkg = await answerPackage();
  const now = new Date().toISOString();
  const done = {
    jobId: "job_cite1",
    tool: "chat-with-pdf",
    capability: "secure-worker",
    status: "completed",
    progress: 100,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    artifacts: [
      {
        artifactId: "art_cite1",
        filename: "answer.zip",
        contentType: "application/zip",
        bytes: pkg.byteLength,
        url: "/__e2e/chat-art/1",
        expiresAt: now,
      },
    ],
  };
  await page.route("**/api/worker/status", (route) =>
    json(route, 200, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", (route) =>
    json(route, 200, {
      sessionId: "ses_cite1",
      tool: "chat-with-pdf",
      slots: [
        {
          fileId: "f_cite0000001",
          filename: "in",
          url: "/__e2e/chat-upload/1",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    }),
  );
  await page.route("**/__e2e/chat-upload/**", (route) => json(route, 200, {}));
  await page.route("**/api/jobs", (route) =>
    route.request().method() === "POST"
      ? json(route, 200, done)
      : route.fallback(),
  );
  await page.route("**/api/jobs/job_cite1", (route) => json(route, 200, done));
  await page.route("**/__e2e/chat-art/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/zip" },
      body: pkg,
    }),
  );
}

/** Same-origin static assets a first press may fetch, and nothing else. */
function isStaticGet(request: Request, origin: string): boolean {
  const url = new URL(request.url());
  if (url.protocol === "blob:" || url.protocol === "data:") return true;
  if (url.origin !== origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.searchParams.has("_rsc")) return true;
  return /^\/(?:_next\/static\/|pdfjs-wasm\/|pdfjs-cmaps\/)/.test(url.pathname);
}

test("pressing [p.2] shows page 2 of the chosen file, and sends nothing", async ({
  page,
}) => {
  await mockChatWorker(page);
  const before: Request[] = [];
  const recordBefore = (request: Request) => before.push(request);
  page.on("request", recordBefore);
  await page.goto("/tools/chat-with-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "fills.pdf",
    mimeType: "application/pdf",
    buffer: await threeFills(),
  });
  await page.getByRole("textbox").fill(QUESTION);
  const ask = page.getByRole("button", { name: "Ask the PDF" });
  await expect(ask).not.toHaveAttribute("aria-disabled", "true");
  await ask.click();

  const cite = page.getByRole("button", { name: "Show page 2 of your PDF" });
  await expect(cite).toBeVisible({ timeout: 20_000 });
  await expect(cite).toHaveText("[p.2]");

  const origin = new URL(page.url()).origin;
  page.off("request", recordBefore);
  const after: Request[] = [];
  const record = (request: Request) => after.push(request);
  page.on("request", record);
  await cite.click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Page 2 of 3" }),
  ).toBeVisible();
  const image = dialog.getByRole("img", { name: "Page 2" });
  await expect(image).toBeVisible({ timeout: 20_000 });
  page.off("request", record);

  // The page's CSP keeps blob: out of connect-src, so the blob URL cannot be
  // fetched back. The image the dialog decoded is re-encoded instead, at its
  // natural size, and that PNG decoded in node: the pixels judged are the
  // ones the visitor was shown.
  const base64 = await image.evaluate(async (node) => {
    const img = node as HTMLImageElement;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const png = decodePng(new Uint8Array(Buffer.from(base64, "base64")));
  // Health check: a real raster, not a placeholder.
  expect(png.width).toBeGreaterThan(100);
  const centre = pixelAt(
    png,
    Math.floor(png.width / 2),
    Math.floor(png.height / 2),
  );
  const [one, two, three] = FILLS.map((fill) => colourDistance(centre, fill));
  expect(
    two,
    `centre ${JSON.stringify(centre)} is not page 2's fill`,
  ).toBeLessThan(40);
  // Positive controls: the pages an off-by-one would have shown.
  expect(one).toBeGreaterThan(100);
  expect(three).toBeGreaterThan(100);

  // The network property: nothing carrying the file, nothing to /api/.
  // Health checks for the property below, so it cannot pass on nothing:
  // the press DID fetch something (the dialog's chunk at least, on a first
  // press), and the predicate DOES reject what a question sends — the
  // upload reservation and the job POST made before the press.
  expect(after.length, "no request after the press: vacuous").toBeGreaterThan(
    0,
  );
  const sent = before.filter((r) =>
    new URL(r.url()).pathname.startsWith("/api/"),
  );
  expect(sent.some((r) => r.method() === "POST")).toBe(true);
  for (const request of sent) expect(isStaticGet(request, origin)).toBe(false);
  for (const request of after) {
    const where = `${request.method()} ${request.url()}`;
    expect(request.method(), where).toBe("GET");
    expect(request.postDataBuffer(), where).toBeNull();
    expect(isStaticGet(request, origin), where).toBe(true);
  }
});
