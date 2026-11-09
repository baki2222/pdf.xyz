import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import { pdfTextPositions } from "./client-proof/artifacts";
import {
  HANDWRITING_STYLES,
  SIGNATURE_STYLES,
  SIGNATURE_STYLE_LABEL,
} from "../src/lib/pdf/offered-kinds";
import {
  DEFAULT_SIGNATURE_STYLE,
  isHandwritingStyle,
} from "../src/lib/pdf/signature-style";
import { HANDWRITING_FACES } from "../src/lib/pdf/handwriting";
import { fontPackUrl } from "../src/lib/pdf/font-packs";
import { cssLineHeightShowing } from "../src/lib/pdf/handwriting-metrics";
import * as fontkit from "fontkit";

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
  // The family the chosen option's preview ACTUALLY uses — read off the
  // element, not built here — is the style's own, and loaded. (Was a check
  // of a family name built separately, which passed while the preview asked
  // for a family nothing registered: review of sign-pdf#1.)
  const previewFamily = () =>
    page.evaluate((s) => {
      const el = document.querySelector<HTMLElement>(
        `[role=radiogroup][aria-label=Style] [data-style="${s}"] > span`,
      )!;
      return getComputedStyle(el).fontFamily;
    }, style);
  const first = (list: string) =>
    (list.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
  expect(first(await previewFamily())).toBe(`pdfxyz-hand-${style}`);
  await expect
    .poll(async () => {
      const list = await previewFamily();
      return page.evaluate(
        (family) => document.fonts.check(`20px ${family}`),
        list.split(",")[0]!.trim(),
      );
    })
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

/*
 * Review of sign-pdf#1: Homemade Apple's preview was cut flat at the bottom
 * of a fixed 1.4 em line (scrollHeight 35 over clientHeight 28), in the
 * Style option and the large preview alike. Every previewed line is now as
 * tall as the tallest face's ink; measured here with every face LOADED and
 * a name full of descenders.
 */
test("no style's preview clips the name, in its option or the large preview", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/tools/sign-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makePdfBytes("contract", 1)),
  });
  await page.getByRole("tab", { name: "Type" }).click();
  await page.getByLabel("Your name").fill("Jágy Pöqfly");
  await expect
    .poll(() =>
      page.evaluate(
        (families) =>
          families.every((f) => document.fonts.check(`20px "${f}"`)),
        HANDWRITING_STYLES.map((s) => `pdfxyz-hand-${s}`),
      ),
    )
    .toBe(true);

  const group = page.getByRole("radiogroup", { name: "Style" });
  const overflow = (selector: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)!;
      return {
        family: getComputedStyle(el).fontFamily,
        over: el.scrollHeight - el.clientHeight,
      };
    }, selector);
  for (const s of SIGNATURE_STYLES) {
    const option = `[role=radiogroup][aria-label=Style] [data-style="${s}"]`;
    const line = await overflow(`${option} > span`);
    expect(line.over, `${s} option preview`).toBeLessThanOrEqual(0);
    expect((await overflow(option)).over, `${s} option`).toBeLessThanOrEqual(0);
    await group
      .getByRole("radio", { name: SIGNATURE_STYLE_LABEL[s], exact: true })
      .click();
    const big = await overflow("[data-signature-preview]");
    expect(big.over, `${s} large preview`).toBeLessThanOrEqual(0);
    // Health check: a handwriting style is measured in its own face.
    if (HANDWRITING_STYLES.includes(s as (typeof HANDWRITING_STYLES)[number]))
      expect(big.family, s).toContain(`pdfxyz-hand-${s}`);
  }

  // Positive control: the instrument sees a clip. The tallest face, given
  // the old 1.4 em line back, overflows.
  const tallest = [...HANDWRITING_STYLES].sort(
    (a, b) => cssLineHeightShowing(b) - cssLineHeightShowing(a),
  )[0]!;
  const clipped = await page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(
      `[role=radiogroup][aria-label=Style] [data-style="${s}"] > span`,
    )!;
    el.style.lineHeight = "1.4em";
    el.style.height = "1.4em";
    return el.scrollHeight - el.clientHeight;
  }, tallest);
  expect(clipped, `${tallest} at 1.4 em`).toBeGreaterThan(0);
});

/*
 * Review of sign-pdf#1: the panel opens on Type, and showing Type fetched
 * all four faces (~197 KB gzipped) the moment a file was opened — for a
 * reader who then only draws too. Now only the picked style's face loads
 * until a name is typed or the options are reached.
 */
test("a reader who goes straight to Draw fetches at most the default style's face", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fetched = handwritingRequests(page);
  await page.goto("/tools/sign-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makePdfBytes("contract", 1)),
  });
  await page.getByRole("tab", { name: "Draw" }).click();
  await expect(page.getByRole("tab", { name: "Draw" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Give any eager fetch time to start.
  await page.waitForTimeout(1500);
  const allowed = isHandwritingStyle(DEFAULT_SIGNATURE_STYLE)
    ? [fontPackUrl(HANDWRITING_FACES[DEFAULT_SIGNATURE_STYLE])]
    : [];
  expect([...new Set(fetched)].filter((u) => !allowed.includes(u))).toEqual([]);
  // Positive control: the recorder sees the faces once a name is typed.
  await page.getByRole("tab", { name: "Type" }).click();
  await page.getByLabel("Your name").fill("Ada");
  await expect
    .poll(() => new Set(fetched).size)
    .toBe(HANDWRITING_STYLES.length);
});

/*
 * Review of sign-pdf#1: every family could have been registered with
 * Dancing Script's bytes and each check above would pass, since they only
 * ask whether SOME face is loaded under the name. Here each family's
 * glyph advances, measured by the browser, are the advances in that face's
 * own TTF.
 */
test("each handwriting family draws with its own face's widths", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/tools/sign-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "contract.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makePdfBytes("contract", 1)),
  });
  await page.getByRole("tab", { name: "Type" }).click();
  await page.getByLabel("Your name").fill("Ada");
  const families = HANDWRITING_STYLES.map((s) => `pdfxyz-hand-${s}`);
  await expect
    .poll(() =>
      page.evaluate(
        (fs) => fs.every((f) => document.fonts.check(`20px "${f}"`)),
        families,
      ),
    )
    .toBe(true);

  const PROBES = ["W", "m", "g", "A", "y"];
  const want: Record<string, number> = {};
  for (const style of HANDWRITING_STYLES) {
    // The TTF the build serves (public/ is what `next start` sends).
    const font = fontkit.create(
      readFileSync(`public${fontPackUrl(HANDWRITING_FACES[style])}`),
    ) as unknown as {
      unitsPerEm: number;
      glyphForCodePoint(cp: number): { advanceWidth: number };
    };
    want[style] = PROBES.reduce(
      (sum, ch) =>
        sum +
        (font.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth * 100) /
          font.unitsPerEm,
      0,
    );
  }
  // Health check: the four faces differ by more than the tolerance, so the
  // comparison can tell one from another.
  const sorted = Object.values(want).sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++)
    expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThan(2);

  const got = await page.evaluate(
    ({ styles, probes }) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      const out: Record<string, number> = {};
      for (const s of styles) {
        ctx.font = `100px "pdfxyz-hand-${s}"`;
        out[s] = probes.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0);
      }
      return out;
    },
    { styles: [...HANDWRITING_STYLES], probes: PROBES },
  );
  for (const style of HANDWRITING_STYLES)
    expect(Math.abs(got[style]! - want[style]!), style).toBeLessThan(1);
});
