import { expect, type Page, type Request, type Route } from "@playwright/test";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import type { Rgb } from "../src/lib/png-probe";
import { injectAxe } from "./axe-inject";

/**
 * The served chat page with its worker mocked at the wire (`page.route`),
 * shared by the desktop and the touch-phone citation specs (audit #30,
 * 2026-11-15). Nothing here reaches a real worker or AI provider.
 */

export const FILLS: Rgb[] = [
  { r: 220, g: 40, b: 40 },
  { r: 40, g: 180, b: 60 },
  { r: 40, g: 70, b: 220 },
];

/** Three pages, each a solid fill, each with a line of text so it counts. */
export async function threeFills(): Promise<Buffer> {
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
async function answerPackage(
  question: string,
  answer: string,
  citedPages: number[],
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("answer.txt", `Q: ${question}\n\nA: ${answer}\n`);
  zip.file("answer.md", `# ${question}\n\n${answer}\n`);
  zip.file(
    "manifest.json",
    JSON.stringify({ schema: "pdfxyz.chat/v1", answer: { citedPages } }),
  );
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export async function mockChatWorker(
  page: Page,
  question: string,
  answer: string,
  citedPages: number[],
) {
  const pkg = await answerPackage(question, answer, citedPages);
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

/** Pick the three-fill PDF, ask `question`, and wait for the answer. */
export async function askThreeFills(page: Page, question: string) {
  await page.goto("/tools/chat-with-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "fills.pdf",
    mimeType: "application/pdf",
    buffer: await threeFills(),
  });
  await page.getByRole("textbox").fill(question);
  const ask = page.getByRole("button", { name: "Ask the PDF" });
  await expect(ask).not.toHaveAttribute("aria-disabled", "true");
  await ask.click();
}

/** Same-origin static assets a first press may fetch, and nothing else. */
export function isStaticGet(request: Request, origin: string): boolean {
  const url = new URL(request.url());
  if (url.protocol === "blob:" || url.protocol === "data:") return true;
  if (url.origin !== origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.searchParams.has("_rsc")) return true;
  return /^\/(?:_next\/static\/|pdfjs-wasm\/|pdfjs-cmaps\/)/.test(url.pathname);
}

/**
 * Every citation button's box, in answer order: its text, and its size. The
 * set is DISCOVERED (every button whose name starts "Show page"), and the
 * caller bounds its length, so a selector that finds nothing cannot pass.
 */
export async function citationBoxes(page: Page) {
  return page
    .getByRole("button", { name: /^Show pages? / })
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return {
          text: node.textContent ?? "",
          width: r.width,
          height: r.height,
        };
      }),
    );
}

/** axe-core's WCAG 2.x A/AA rules on the page as it stands, as axe.spec.ts runs them. */
export async function axeViolations(page: Page): Promise<string[]> {
  await injectAxe(page);
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            opts: object,
          ) => Promise<{
            violations: { id: string; nodes: { target: string[] }[] }[];
          }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return r.violations.flatMap((v) =>
      v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`),
    );
  });
}
