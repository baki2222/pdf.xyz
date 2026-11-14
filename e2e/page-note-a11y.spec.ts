import { expect, test, type Page } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { PAGE_IMAGES_NOTE } from "../src/lib/pdf/pdfjs-guard";
import { rawPdf } from "../src/tests/hostile/conversion-out.fixtures";

/**
 * The note drawn in place of a page past the page budget, as a SCREEN
 * READER gets it: Playwright's role queries compute accessible names as the
 * browser exposes them, so `aria-hidden` and buttons (whose contents are
 * presentational) are honoured. Page 1 paints three 25 MP images (75 MP,
 * past the 50 MP a page may draw); page 2 paints nothing.
 *
 * History (review r3, 2026-11-14): drawPageNote named its canvas, then the
 * Viewer and the editor set `aria-hidden` on it, and the rail's and the
 * Viewer sidebar's buttons named only the page number: the Viewer read
 * "Page 1" and nothing else. The unit guard (src/lib/pdf/page-note.test.ts)
 * read `<img alt>` in source and saw none of it.
 */

function overBudgetPdf(): Buffer {
  const stub = {
    dict: "/Type /XObject /Subtype /Image /Width 5000 /Height 5000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode",
    stream: new Uint8Array([0x78, 0x9c]),
  };
  return Buffer.from(
    rawPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 8 0 R] /Count 2 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /A 5 0 R /B 6 0 R /C 7 0 R >> >> /Contents 4 0 R >>",
      {
        dict: "",
        stream:
          "q 100 0 0 100 50 50 cm /A Do Q q 100 0 0 100 200 50 cm /B Do Q q 100 0 0 100 350 50 cm /C Do Q",
      },
      stub,
      stub,
      stub,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 9 0 R >>",
      { dict: "", stream: "BT /F1 12 Tf ET" },
    ]),
  );
}

async function open(page: Page, slug: string) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto(`/tools/${slug}`);
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "over.pdf",
    mimeType: "application/pdf",
    buffer: overBudgetPdf(),
  });
}

test.describe("the note drawn in place of a page is heard by a screen reader", () => {
  test("Viewer: page 1's surface is an image named by the note; page 2's is not", async ({
    page,
  }) => {
    await open(page, "pdf-viewer");
    const first = page.getByRole("group", { name: "Page 1", exact: true });
    await expect(
      first.getByRole("img", { name: PAGE_IMAGES_NOTE, exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    // Control: the drawn page has no note to read.
    const second = page.getByRole("group", { name: "Page 2", exact: true });
    await expect(second).toBeAttached();
    await expect(
      second.getByRole("img", { name: PAGE_IMAGES_NOTE }),
    ).toHaveCount(0);
  });

  test("editor: page 1's surface names the note, and so does its rail button", async ({
    page,
  }) => {
    await open(page, "edit-pdf");
    const first = page.getByRole("group", { name: "Page 1 of 2", exact: true });
    await expect(
      first.getByRole("img", { name: PAGE_IMAGES_NOTE, exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    // A button's contents are presentational: its own name carries the note.
    await expect(
      page.getByRole("button", {
        name: `Go to page 1 of 2. ${PAGE_IMAGES_NOTE}`,
        exact: true,
      }),
    ).toBeAttached({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Go to page 2 of 2", exact: true }),
    ).toBeAttached();
  });
});
