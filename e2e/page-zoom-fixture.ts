import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { zoomLabel } from "../src/components/tools/runner/page-zoom-lazy";
import { injectAxe } from "./axe-inject";

/**
 * "View page N larger" on every page board (backlog #9, 2026-11-17): the
 * boards, how each is reached after a file is picked, and a three-page PDF
 * whose pages have different shapes, so the enlarged image's aspect names
 * the page it shows — and, turned a quarter, the page as Rotate will write it.
 */

/** Page n's size in points: portrait, wider portrait, landscape. */
export const PAGE_SIZES: readonly [number, number][] = [
  [200, 400],
  [300, 400],
  [400, 250],
];

export async function writeShapesPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  PAGE_SIZES.forEach(([w, h], i) => {
    const page = doc.addPage([w, h]);
    page.drawText(`Page ${i + 1}`, { x: 20, y: h - 60, size: 36, font });
  });
  const dir = mkdtempSync(join(tmpdir(), "pdfxyz-zoom-"));
  const path = join(dir, "shapes.pdf");
  writeFileSync(path, await doc.save());
  return path;
}

export interface Board {
  slug: string;
  /** What the person presses, after the file loads, to see the tiles. */
  reveal?: (page: Page) => Promise<void>;
}

export const BOARDS: readonly Board[] = [
  { slug: "split-pdf" },
  {
    slug: "pdf-to-png",
    reveal: (page) =>
      page.getByRole("button", { name: /^select pages$/i }).click(),
  },
  {
    slug: "pdf-to-jpg",
    reveal: (page) =>
      page.getByRole("button", { name: /^select pages$/i }).click(),
  },
  {
    slug: "resize-pdf",
    reveal: (page) =>
      page.getByRole("radio", { name: "Selected pages" }).click(),
  },
  { slug: "organize-pages" },
  { slug: "rotate-pdf" },
];

export const zoomButton = (page: Page, n: number) =>
  page.getByRole("button", { name: zoomLabel(n), exact: true });

/** Width / height of the image the open dialog shows, once it has loaded. */
export async function shownAspect(dialog: Locator): Promise<number> {
  const img = dialog.locator("img");
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  return img.evaluate(
    (el: HTMLImageElement) => el.naturalWidth / el.naturalHeight,
  );
}

/** axe WCAG 2.x A/AA on the open dialog only. */
export async function dialogViolations(page: Page): Promise<string[]> {
  await injectAxe(page);
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Element,
            opts: object,
          ) => Promise<{
            violations: { id: string; nodes: { target: string[] }[] }[];
          }>;
        };
      }
    ).axe;
    const dialog = document.querySelector("dialog[open]");
    if (!dialog) return ["no open dialog"];
    const r = await axe.run(dialog, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return r.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
  });
}
