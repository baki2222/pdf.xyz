import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import { pdfTextPositions } from "./client-proof/artifacts";
import {
  HANDWRITING_STYLES,
  SIGNATURE_STYLE_LABEL,
} from "../src/lib/pdf/offered-kinds";
import { DEFAULT_SIGNATURE_STYLE } from "../src/lib/pdf/signature-style";
import { HANDWRITING_FACES } from "../src/lib/pdf/handwriting";
import { fontPackUrl } from "../src/lib/pdf/font-packs";

/**
 * Audit sign-pdf#1 on the SERVED build: Sign PDF → Type → a handwriting
 * style → place → Apply & download, and the downloaded file read back.
 *
 * The face is picked by DISCOVERY — the first handwriting style that is not
 * the default — so the run proves a reader's choice reaches the file, not
 * merely that the default does. The unit tests embed from the TTF on disk;
 * only this sees the font SERVED from our origin, fetched by the panel, and
 * embedded by the export the browser ran.
 */

const NAME = "Ada Lovelace";

function handwritingRequests(page: Page): string[] {
  const urls = new Set(
    HANDWRITING_STYLES.map((s) => fontPackUrl(HANDWRITING_FACES[s])),
  );
  const seen: string[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (urls.has(path)) seen.push(path);
  });
  return seen;
}

/**
 * Each page-1 font: its `/BaseFont`, and whether its program is embedded.
 * The fixture's own words are in the standard Helvetica, which embeds
 * nothing, so the EMBEDDED fonts are exactly what the signature added.
 */
async function fontsOf(
  bytes: Buffer,
): Promise<{ baseFont: string; embedded: boolean }[]> {
  const doc = await PDFDocument.load(bytes);
  const fonts = doc
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("Font"), PDFDict);
  return fonts.entries().map(([, ref]) => {
    const font = doc.context.lookup(ref) as PDFDict;
    const kids = font.lookup(PDFName.of("DescendantFonts"));
    let embedded = false;
    if (kids instanceof PDFArray) {
      const cid = doc.context.lookup(kids.get(0)) as PDFDict;
      embedded =
        cid
          .lookup(PDFName.of("FontDescriptor"), PDFDict)
          .get(PDFName.of("FontFile2")) !== undefined;
    }
    return { baseFont: String(font.get(PDFName.of("BaseFont"))), embedded };
  });
}

test("a typed signature in a chosen handwriting face is the face in the downloaded PDF", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const style = HANDWRITING_STYLES.find((s) => s !== DEFAULT_SIGNATURE_STYLE)!;
  const face = HANDWRITING_FACES[style];
  const fetched = handwritingRequests(page);

  await page.goto("/tools/sign-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  // Never on page load: no handwriting face has been asked for yet.
  expect(fetched).toEqual([]);

  await input.setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makePdfBytes("contract", 1)),
  });
  await page.getByRole("tab", { name: "Type" }).click();
  await page.getByLabel("Your name").fill(NAME);

  const group = page.getByRole("radiogroup", { name: "Style" });
  const option = group.getByRole("radio", {
    name: SIGNATURE_STYLE_LABEL[style],
    exact: true,
  });
  await option.click();
  await expect(option).toHaveAttribute("aria-checked", "true");

  // The Type tab fetched every face, from our origin, and the preview is
  // drawn in the face itself — the browser reports it loaded.
  await expect
    .poll(() => [...new Set(fetched)].sort())
    .toEqual(
      HANDWRITING_STYLES.map((s) => fontPackUrl(HANDWRITING_FACES[s])).sort(),
    );
  await expect
    .poll(() =>
      page.evaluate(
        (family) => document.fonts.check(`20px "${family}"`),
        `pdfxyz-hand-${style}`,
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Use signature" }).click();
  await expect(page.locator("[data-signature-ready]")).toBeVisible();
  const sheet = page.locator('[data-editor-page="0"]');
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await expect(
    page.locator("[data-wysiwyg-editor] > [role=status]"),
  ).toContainText("Signature placed");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /apply & download/i }).click();
  const file = await download;
  const bytes = readFileSync((await file.path())!);

  const fonts = await fontsOf(bytes);
  // Health check: the fixture's standard font is read, and embeds nothing.
  expect(fonts.filter((f) => !f.embedded).map((f) => f.baseFont)).toEqual([
    "/Helvetica",
  ]);
  const added = fonts.filter((f) => f.embedded);
  expect(added).toHaveLength(1);
  expect(added[0]!.baseFont).toContain(face.postscriptName);
  // pdf.js reads the name back as ONE run: the box the editor placed is as
  // wide as the name is in the file, so the export did not wrap it.
  const runs = (await pdfTextPositions(bytes))[0]!.runs.map((r) => r.str);
  expect(runs).toContain(NAME);
});

test("a name the chosen face cannot draw is said under the styles, and set as Script sets it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // A Latin name with ő: the faces without it are discovered from coverage.
  const { handwritingMissing } = await import("../src/lib/pdf/handwriting");
  const name = "Zoé Łukasz Erdős";
  const style = HANDWRITING_STYLES.find(
    (s) => handwritingMissing(s, name).length > 0,
  )!;
  expect(style).toBeDefined();

  await page.goto("/tools/sign-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makePdfBytes("contract", 1)),
  });
  await page.getByRole("tab", { name: "Type" }).click();
  await page.getByLabel("Your name").fill(name);
  await page
    .getByRole("radiogroup", { name: "Style" })
    .getByRole("radio", { name: SIGNATURE_STYLE_LABEL[style], exact: true })
    .click();
  await expect(page.locator("[data-style-fallback]")).toContainText(
    `${SIGNATURE_STYLE_LABEL[style]} has no ő`,
  );

  await page.getByRole("button", { name: "Use signature" }).click();
  await expect(page.locator("[data-signature-ready]")).toBeVisible();
  const sheet = page.locator('[data-editor-page="0"]');
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /apply & download/i }).click();
  const bytes = readFileSync((await (await download).path())!);
  const added = (await fontsOf(bytes)).filter((f) => f.embedded);
  expect(added).toHaveLength(1);
  expect(added[0]!.baseFont).not.toContain(
    HANDWRITING_FACES[style].postscriptName,
  );
  expect(added[0]!.baseFont).toMatch(/Noto/);
  const runs = (await pdfTextPositions(bytes))[0]!.runs.map((r) => r.str);
  expect(runs).toContain(name);
});
