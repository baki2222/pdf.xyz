import { expect, test, type Page } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { PDF_IMAGE_TOO_LARGE_MESSAGE } from "../src/lib/pdf/pdfjs-guard";
import {
  deflatedZeros,
  imageBombAtCapPdf,
  simplePdf,
} from "../src/tests/hostile/conversion-out.fixtures";

/**
 * The editor canvas and an image over its raster budget (CO-08), at the
 * point of consumption: the live page, not the opener.
 *
 * History (2026-11-09): `openEditorPdf` dropped the preflight's
 * previewOptions, so Edit, Annotate and Sign PDF decoded a 100 MP image the
 * thumbnails skip (~40 s, 1.5 GB). Now the page is drawn without it and the
 * editor says so. The fixtures place one image of zeros (black) at
 * 50..150 pt on a 300 x 200 pt page, clear of the text; the pixels read
 * there are black when the image is drawn and the white sheet when it is
 * skipped. The 9 MP control is the positive half: drawn, and nothing said.
 */

const SLUGS = ["edit-pdf", "annotate-pdf", "sign-pdf"] as const;

async function open(page: Page, slug: string, buffer: Buffer) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto(`/tools/${slug}`);
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "image.pdf",
    mimeType: "application/pdf",
    buffer,
  });
}

/** Sum of R+G+B at page point (x, y) of page 1's raster, once it is drawn. */
async function inkAt(page: Page, x: number, y: number): Promise<number> {
  const canvas = page.locator(
    '[data-editor-page="0"] [data-page-raster] canvas',
  );
  await expect(canvas).toBeAttached({ timeout: 20_000 });
  return canvas.evaluate(
    (el, [px, py]) => {
      const c = el as HTMLCanvasElement;
      const d = c
        .getContext("2d")!
        .getImageData(
          Math.floor((px! / 300) * c.width),
          Math.floor((1 - py! / 200) * c.height),
          1,
          1,
        ).data;
      return d[0]! + d[1]! + d[2]!;
    },
    [x, y],
  );
}

async function controlPdf(): Promise<Buffer> {
  return Buffer.from(
    simplePdf({
      content: {
        dict: "",
        stream: "q 100 0 0 100 50 50 cm /Im1 Do Q",
      },
      resources: "/XObject << /Im1 6 0 R >>",
      extra: [
        {
          dict: "/Type /XObject /Subtype /Image /Width 3000 /Height 3000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode",
          stream: await deflatedZeros(3000 * 3000 * 3),
        },
      ],
    }),
  );
}

for (const slug of SLUGS) {
  test(`${slug}: a 100 MP image is left out of the page view, in seconds, and the editor says so`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await open(page, slug, Buffer.from(await imageBombAtCapPdf()));
    const notice = page.locator("[data-image-notice]");
    await expect(notice).toContainText(PDF_IMAGE_TOO_LARGE_MESSAGE, {
      timeout: 20_000,
    });
    // Never a page number: pdf.js does not report which page skipped it.
    await expect(notice).not.toContainText(/page \d/i);
    // Drawn, and the image's place is the white sheet.
    expect(await inkAt(page, 140, 60)).toBe(765);
  });
}

test("edit-pdf positive control: a 9 MP image is drawn, and nothing is said", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page, "edit-pdf", await controlPdf());
  await expect
    .poll(() => inkAt(page, 140, 60), { timeout: 20_000 })
    .toBeLessThan(30);
  await expect(page.locator("[data-image-notice]")).toHaveCount(0);
});
