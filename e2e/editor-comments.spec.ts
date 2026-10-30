import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { captureDownload } from "./client-proof/artifacts";
import { attachConsoleGuard, fileInput, waitForHydration } from "./helpers";
import { PDFJS_DOCUMENT_DEFAULTS } from "../src/lib/pdf/wasm-assets";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * "Save markups as comments", driven by hand through the live page and
 * proven on the bytes it downloads: a highlight dragged over a line of
 * text and a typed note, saved as comments, come back from pdf.js (in THIS
 * process) as a /Highlight snapped to the line and a /FreeText holding the
 * words — not page text. On a /Rotate 90 page the comment sits where the
 * overlay showed it, ±1 pt. And the default, Flatten, writes no annotation.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const NOTE = "E2E-COMMENT-NOTE";

async function fixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .addPage([PAGE_W, PAGE_H])
    .drawText("BASE ONE LINE OF TEXT", { x: 72, y: 700, size: 20, font });
  const two = doc.addPage([PAGE_W, PAGE_H]);
  two.drawText("BASE TWO", { x: 72, y: 720, size: 14, font });
  two.setRotation(degrees(90));
  return Buffer.from(await doc.save());
}

interface Annot {
  subtype: string;
  contents: string;
  /** Viewer frame, top-left origin, points. */
  box: { x: number; y: number; width: number; height: number };
  quads: { y: number; height: number }[];
}

async function readAnnotations(
  buf: Buffer,
  pageNumber = 1,
): Promise<{ annots: Annot[]; text: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    const vp = page.getViewport({ scale: 1 });
    const box = (r: number[]) => {
      const [x0, y0] = vp.convertToViewportPoint(r[0]!, r[1]!);
      const [x1, y1] = vp.convertToViewportPoint(r[2]!, r[3]!);
      return {
        x: Math.min(x0!, x1!),
        y: Math.min(y0!, y1!),
        width: Math.abs(x1! - x0!),
        height: Math.abs(y1! - y0!),
      };
    };
    const annots = (
      (await page.getAnnotations()) as Record<string, unknown>[]
    ).map((a) => {
      const q = (a.quadPoints as ArrayLike<number> | undefined) ?? [];
      const quads = [];
      for (let i = 0; i + 8 <= q.length; i += 8) {
        const ys = [q[i + 1]!, q[i + 3]!, q[i + 5]!, q[i + 7]!];
        const xs = [q[i]!, q[i + 2]!, q[i + 4]!, q[i + 6]!];
        const b = box([
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ]);
        quads.push({ y: b.y, height: b.height });
      }
      return {
        subtype: String(a.subtype),
        contents: (a.contentsObj as { str?: string } | undefined)?.str ?? "",
        box: box(a.rect as number[]),
        quads,
      };
    });
    const content = await page.getTextContent();
    const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
    return { annots, text };
  } finally {
    await task.destroy();
  }
}

/** Screen coordinates of a point given in a page's viewer points. */
async function at(page: Page, index: number, x: number, y: number) {
  const sheet = page.locator(`[data-editor-page="${index}"]`);
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  const [w] = (await sheet.getAttribute("data-page-pt"))!
    .split("x")
    .map(Number);
  const scale = box.width / w!;
  return { x: box.x + x * scale, y: box.y + y * scale, scale };
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

const tool = (page: Page, name: string) =>
  page
    .getByRole("toolbar", { name: "Editor tools" })
    .getByRole("button", { name, exact: true });

async function open(page: Page, slug: string) {
  await page.goto(`/tools/${slug}`);
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "two-pages.pdf",
    mimeType: "application/pdf",
    buffer: await fixture(),
  });
  await expect(page.locator('[data-editor-page="1"]')).toBeAttached({
    timeout: 20_000,
  });
  await expect(
    page.locator('[data-editor-page="0"] [data-page-raster] canvas'),
  ).toBeAttached({ timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

test("Annotate PDF: a highlight and a note saved as comments come back as /Highlight and /FreeText", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await open(page, "annotate-pdf");

  // Highlight is the tool Annotate PDF opens on: drag a box taller than the
  // line "BASE ONE…" (baseline at viewer y 92, size 20).
  await drag(page, await at(page, 0, 60, 60), await at(page, 0, 200, 110));
  await tool(page, "Note").click();
  const n = await at(page, 0, 320, 200);
  await page.mouse.click(n.x, n.y);
  await page.keyboard.type(NOTE);
  await page.keyboard.press("Escape");

  const comments = page.getByRole("radio", {
    name: "Save markups as comments (editable in other PDF apps)",
  });
  await expect(
    page.getByRole("radio", { name: "Flatten into the page" }),
  ).toBeChecked();
  await comments.check();
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  await expect(page.getByText("2 saved as comments")).toBeVisible();

  const { annots, text } = await readAnnotations(buf);
  expect(annots.map((a) => a.subtype).sort()).toEqual([
    "FreeText",
    "Highlight",
  ]);
  const note = annots.find((a) => a.subtype === "FreeText")!;
  expect(note.contents).toBe(NOTE);
  expect(text).not.toContain(NOTE);
  // Snapped to the line: one quad, the line's height, not the 50 pt box.
  const hl = annots.find((a) => a.subtype === "Highlight")!;
  expect(hl.quads).toHaveLength(1);
  expect(hl.quads[0]!.height).toBeLessThan(30);
  expect(hl.quads[0]!.y).toBeGreaterThan(65);
  expect(guard.pageErrors).toEqual([]);
  expect(guard.cspViolations()).toEqual([]);
});

test("Edit PDF: a comment on a /Rotate 90 page sits where the overlay showed it; Flatten writes none", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = attachConsoleGuard(page);
  await open(page, "edit-pdf");

  await tool(page, "Highlight").click();
  await drag(page, await at(page, 1, 300, 300), await at(page, 1, 420, 330));
  const rect = page.locator('[data-object-kind="highlight"] > rect').first();
  const shown = {
    x: Number(await rect.getAttribute("x")),
    y: Number(await rect.getAttribute("y")),
    width: Number(await rect.getAttribute("width")),
    height: Number(await rect.getAttribute("height")),
  };

  // The default first: no annotation at all.
  const flat = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  expect((await readAnnotations(flat, 2)).annots).toEqual([]);

  await page
    .getByRole("button", { name: /adjust/i })
    .first()
    .click();
  await page
    .getByRole("radio", {
      name: "Save markups as comments (editable in other PDF apps)",
    })
    .check();
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const { annots } = await readAnnotations(buf, 2);
  expect(annots).toHaveLength(1);
  const got = annots[0]!.box;
  expect(Math.abs(got.x - shown.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(got.y - shown.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(got.width - shown.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(got.height - shown.height)).toBeLessThanOrEqual(1);
  expect(guard.pageErrors).toEqual([]);
});
