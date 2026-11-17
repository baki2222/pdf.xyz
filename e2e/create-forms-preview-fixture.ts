import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";
import { PDFDocument, degrees } from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { PDFJS_DOCUMENT_DEFAULTS } from "../src/lib/pdf/wasm-assets";
import { fileInput, waitForHydration } from "./helpers";

/**
 * Create Fillable Forms' page preview (backlog #17, 2026-11-17), in the
 * served page: shared by the desktop and the 375 px phone spec. Nothing is
 * uploaded — the tool runs in the browser — so the only network is the page.
 */

/**
 * Two US Letter pages; page 2 is turned `/Rotate 90` with an inset CropBox,
 * so the preview shows it landscape and every box placed there goes through
 * the displayed-frame mapping.
 */
export async function twoPagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const second = doc.addPage([612, 792]);
  second.setCropBox(36, 48, 540, 696);
  second.setRotation(degrees(90));
  return Buffer.from(await doc.save());
}

/** Page 2 as displayed: the crop box (540 x 696), turned a quarter. */
export const PAGE_SIZES = [
  { width: 612, height: 792 },
  { width: 696, height: 540 },
] as const;

export async function openWithPdf(page: Page): Promise<Locator> {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/create-forms");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: await twoPagePdf(),
  });
  const sheet = page.getByTestId("form-page-preview");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.locator("[data-field-box]")).toHaveCount(1);
  return sheet;
}

export const card = (page: Page, id: string) =>
  page.locator(`[data-field-card="${id}"]`);

/** A card's number, as the engine will be handed it. */
export async function cardNumber(
  page: Page,
  id: string,
  label: string,
): Promise<number> {
  return Number(
    await card(page, id).getByLabel(label, { exact: true }).inputValue(),
  );
}

/** A point on the sheet, given as shares of it from its top-left, in page px. */
export async function sheetAt(sheet: Locator, fx: number, fy: number) {
  await sheet.scrollIntoViewIfNeeded();
  const s = (await sheet.boundingBox())!;
  return { x: s.x + fx * s.width, y: s.y + fy * s.height, sheet: s };
}

export interface SeenBox {
  of: string;
  kind: string;
  /** Shares of the sheet, from its bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every box on the sheet as the reader SEES it, read in one frame. */
export async function seenBoxes(sheet: Locator) {
  return sheet.evaluate((el) => {
    const s = el.getBoundingClientRect();
    const boxes = [...el.querySelectorAll<HTMLElement>("[data-field-box]")].map(
      (box) => {
        const b = box.getBoundingClientRect();
        return {
          of: box.getAttribute("data-of") ?? "?",
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

export interface ReadWidget {
  name: string;
  page: number;
  /** Shares of the displayed page, from its bottom-left, as pdfjs places it. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The displayed page's size in points. */
  pageWidth: number;
  pageHeight: number;
}

/**
 * Every form widget of the downloaded PDF, where pdfjs (run in the TEST
 * process, not the browser) puts it on the displayed page: its viewport
 * applies `/Rotate` and the CropBox.
 */
export async function widgetsAsViewed(file: string): Promise<ReadWidget[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const task = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(file)),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
    wasmUrl: `${pathToFileURL(join(dir, "wasm")).href}/`,
  });
  try {
    const doc = await task.promise;
    const out: ReadWidget[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const t = vp.transform as number[];
      const at = (x: number, y: number) => [
        t[0]! * x + t[2]! * y + t[4]!,
        vp.height - (t[1]! * x + t[3]! * y + t[5]!),
      ];
      for (const a of await page.getAnnotations()) {
        if (a.subtype !== "Widget") continue;
        const [x0, y0, x1, y1] = a.rect as number[];
        const pts = [at(x0!, y0!), at(x1!, y0!), at(x0!, y1!), at(x1!, y1!)];
        const xs = pts.map((p) => p[0]!);
        const ys = pts.map((p) => p[1]!);
        out.push({
          name: String(a.fieldName),
          page: n,
          x: Math.min(...xs) / vp.width,
          y: Math.min(...ys) / vp.height,
          width: (Math.max(...xs) - Math.min(...xs)) / vp.width,
          height: (Math.max(...ys) - Math.min(...ys)) / vp.height,
          pageWidth: vp.width,
          pageHeight: vp.height,
        });
      }
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/**
 * The widgets of one page match the boxes the sheet showed: half a CSS pixel
 * of drawing, plus pdf-lib's half-point border on every side.
 */
export function expectWidgetsAsSeen(
  widgets: ReadWidget[],
  seen: Awaited<ReturnType<typeof seenBoxes>>,
  page: number,
  names: Record<string, string>,
) {
  const mine = widgets.filter((w) => w.page === page);
  expect(mine.length, `widgets on page ${page}`).toBe(seen.boxes.length);
  expect(mine.length).toBeGreaterThan(0);
  const order = <T extends { x: number; y: number }>(list: T[]) =>
    [...list].sort((a, b) => b.y - a.y || a.x - b.x);
  const want = order(mine);
  const got = order(seen.boxes);
  want.forEach((w, i) => {
    const box = got[i]!;
    expect(names[box.of], `page ${page} box ${i}`).toBe(w.name);
    const tolX = 0.5 / seen.sheet.width + 0.5 / w.pageWidth + 1e-6;
    const tolY = 0.5 / seen.sheet.height + 0.5 / w.pageHeight + 1e-6;
    // Edges, not sizes: a box and a widget that agree on every edge agree.
    const edges = (b: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => [b.x, b.y, b.x + b.width, b.y + b.height];
    const a = edges(box);
    edges(w).forEach((edge, k) => {
      expect(
        Math.abs(a[k]! - edge),
        `page ${page} ${w.name} edge ${k}`,
      ).toBeLessThanOrEqual(k % 2 === 0 ? tolX : tolY);
    });
  });
}
