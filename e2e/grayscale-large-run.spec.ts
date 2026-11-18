import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { encodeGrayJpeg } from "../src/lib/pdf/gray-jpeg";
import { drawRasterImage, embedRasterImage } from "../src/lib/pdf/pdf-lib";
import { uploadFiles } from "./helpers";

/**
 * Grayscale PDF on a long text document (perf sweep 2026-11-18, P3 and P4).
 *
 * P3: on a 1,000-page text PDF the run took about 80 s to "Grayscale PDF
 * ready", against about 33 s for PDF to PNG on the same file — a ratio of
 * about 2.4. Every page was encoded twice, as a JPEG and as a Flate image,
 * and the JPEG (63% of the busy time) lost on every text page.
 *
 * DENSITY. The first fix skipped the JPEG only below a size floor, which
 * nearly blank pages meet and a page of body text does not; this spec then
 * wrote ONE short line a page, the only density where that fix held. Review
 * measured 6 lines a page at 2.78 times PDF to PNG, and 50 lines at 3.15 —
 * worse than the ratio that defined P3. So the ratio is now asserted at three
 * densities, up to a full page of body text.
 *
 * The bound is a RATIO, not a time: PDF to PNG draws the same pages at the
 * same 150 DPI through the same renderer, in the same browser. Grayscale runs
 * FIRST (cold), which only makes it harder for grayscale to pass.
 *
 * BUT MACHINE SPEED DOES NOT CANCEL, and CI said so (PR #382, run
 * 44373418087, Linux runner, 1 worker): 1 line 1.02, 6 lines 1.07, and 50
 * lines 1.53, 1.64, 1.60 over three attempts (grayscale 3,601–3,968 ms, PNG
 * 2,351–2,423 ms) — where Windows (1 worker) measured 1.02, 0.99 and 1.05. CI's PNG
 * times were Windows' own (2,403 ms at 50 lines; 1,898 at 1), so only the
 * grayscale side moved, and only on dense pages. A CPU profile of the 50-line
 * run (Windows) says why: PDF to PNG's main thread is IDLE for 1.3 of its
 * 2.4 s (it waits on the pdf.js worker and on `toBlob`, which encode off the
 * main thread), while grayscale's main thread is busy nearly throughout —
 * readback, luminance, and the JPEG lower bound (`gray-jpeg-bound.ts`), whose
 * per-block DCT took 634 ms of the 40 pages and grows with the ink on the
 * page. So the two runs are bound by different resources: a runner with a
 * slower main thread stretches grayscale and not PNG. Reproduced with CDP
 * CPU throttling on Windows: at 2× the 50-line ratio was 1.60 and PNG's time
 * barely moved at 1 and 6 lines. The JPEG was NOT being encoded and thrown
 * away (the count below is 0 on Windows, and CI prints its own).
 *
 * So the timing bound is set per density from CI's after-numbers with a
 * margin, and the PROPERTY — no JPEG made on a text page — is asserted by
 * counting, which no runner's speed can move (the test after this loop).
 *
 * The bounds, and the mutant they were held against (the builder forced to
 * encode every page's JPEG, `const jpeg = true || grayJpegCanBeat(`; native
 * deflate kept, so it is milder than the original defect):
 *
 *   lines  bound  CI after          Windows mutant  Windows mutant, CPU 2×
 *   1      1.5    1.02              1.64            3.26
 *   6      1.5    1.07              1.64            3.11
 *   50     2.2    1.53, 1.64, 1.60  2.24            3.54
 *
 * (At CPU 2× the fixed build measured 0.85, 1.34 and 1.60: the throttle is
 * where CI's 50-line figure lands.) The 50-line bound is 34% above CI's
 * worst; on Windows it catches the mutant by only 2%, which is why it is not
 * the guard of the property — the count is.
 *
 * P4: those 80 s had no Cancel, although the runner already made an
 * AbortController and passed its signal down to the renderer.
 */

const PAGES = 40;
const LINE =
  "The quick brown fox jumps over the lazy dog, and the contract shall be governed by the laws of the state.";

/**
 * `pages` Letter pages of Helvetica body text, `lines` lines on each — or,
 * given a list, page i gets `lines[i % lines.length]`.
 */
async function textPdf(
  pages: number,
  lines: number | number[],
): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const density = typeof lines === "number" ? [lines] : lines;
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    for (let line = 0; line < density[i % density.length]!; line++) {
      p.drawText(`${i + 1}.${line + 1} ${LINE}`.slice(0, 100), {
        x: 48,
        y: 740 - line * 13.5,
        size: 11,
        font,
      });
    }
  }
  const path = join(
    mkdtempSync(join(tmpdir(), "pdfxyz-e2e-")),
    `text-${density.join("-")}.pdf`,
  );
  writeFileSync(path, await doc.save());
  return path;
}

/**
 * `pages` Letter pages, each one smooth photo-like grey image: the shape
 * where the JPEG is smaller than Flate, so the builder MUST encode it.
 */
async function photoPdf(pages: number): Promise<string> {
  const w = 640;
  const h = 828;
  const plane = new Uint8Array(w * h);
  let seed = 12345;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const wave = 90 * Math.sin(x / 23) * Math.cos(y / 31);
      plane[y * w + x] = Math.max(0, Math.min(255, 128 + wave + (seed % 24)));
    }
  const doc = await PDFDocument.create();
  // Through the one embed/draw boundary (`raster-embedder-boundary.test.ts`).
  const jpeg = encodeGrayJpeg(plane, w, h, 0.9);
  const image = await embedRasterImage(doc, jpeg, "jpg");
  for (let i = 0; i < pages; i++)
    await drawRasterImage(doc.addPage([612, 792]), image, {
      x: 0,
      y: 0,
      width: 612,
      height: 792,
    });
  const path = join(mkdtempSync(join(tmpdir(), "pdfxyz-e2e-")), "photo.pdf");
  writeFileSync(path, await doc.save());
  return path;
}

/** Open `slug`, add the file, press its run button: ms to `heading`. */
async function timedRun(
  page: Page,
  slug: string,
  file: string,
  heading: RegExp,
): Promise<number> {
  await page.goto(`/tools/${slug}`);
  await uploadFiles(page, file);
  const trigger = page.locator("main [data-run-trigger]").first();
  await expect(trigger).toBeEnabled({ timeout: 30_000 });
  await expect(trigger).not.toHaveAttribute("aria-disabled", "true");
  const started = Date.now();
  await trigger.click();
  // `waitFor`, not `expect().toBeVisible()`: the assertion retries on a
  // back-off of up to a second, which rounded these timings to 0.5 s steps.
  await page
    .getByRole("heading", { name: heading })
    .waitFor({ state: "visible", timeout: 240_000 });
  return Date.now() - started;
}

/** Lines a page → the most grayscale may take, as a multiple of PDF to PNG. */
const RATIO_BOUND: [number, number][] = [
  [1, 1.5],
  [6, 1.5],
  [50, 2.2],
];

for (const [lines, bound] of RATIO_BOUND) {
  test(`grayscale of a long text PDF, ${lines} line${lines === 1 ? "" : "s"} a page, takes at most ${bound}x PDF to PNG on the same file`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const file = await textPdf(PAGES, lines);
    const grayMs = await timedRun(
      page,
      "grayscale-pdf",
      file,
      /^Grayscale PDF ready$/,
    );
    const pngMs = await timedRun(
      page,
      "pdf-to-png",
      file,
      new RegExp(`^${PAGES} PNG images ready$`),
    );
    console.log(
      `${lines} lines: grayscale ${grayMs} ms, png ${pngMs} ms, ratio ${(grayMs / pngMs).toFixed(2)}`,
    );
    expect(grayMs).toBeLessThanOrEqual(bound * pngMs);
  });
}

/**
 * The JPEG encoder's own APP0 segment ("JFIF", version 1.01, no thumbnail),
 * as the production minifier prints `gray-jpeg.ts`'s byte list. Only the
 * encoder writes it, so the innermost function around it IS the encoder.
 */
const JFIF_APP0 = "[74,70,73,70,0,1,1,0,0,1,0,1,0,0]";

/**
 * Runs Grayscale PDF on `file` under V8's precise coverage and returns how
 * many times the JPEG encoder ran — counted by V8 from the shipped bundle,
 * so no export, hook or flag is added to the app for it.
 */
async function jpegEncodes(page: Page, file: string): Promise<number> {
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await timedRun(page, "grayscale-pdf", file, /^Grayscale PDF ready$/);
  const scripts = await page.coverage.stopJSCoverage();
  let found = 0;
  let calls = 0;
  for (const script of scripts) {
    const at = script.source?.indexOf(JFIF_APP0) ?? -1;
    if (at < 0) continue;
    // The innermost function around the marker.
    const around = script.functions
      .map((f) => f.ranges[0]!)
      .filter((r) => r.startOffset <= at && at < r.endOffset)
      .sort(
        (a, b) => a.endOffset - a.startOffset - (b.endOffset - b.startOffset),
      )[0]!;
    const body = script.source!.slice(around.startOffset, around.endOffset);
    // HEALTH: the function found is the encoder, not the chunk or module
    // around it (an uncompiled function missing from the report would leave
    // the module wrapper innermost): it writes SOI (0xFFD8 = 65496) and EOI
    // (0xFFD9 = 65497), and is far smaller than a module.
    expect(body, script.url).toContain("65496");
    expect(body, script.url).toContain("65497");
    expect(body.length, script.url).toBeLessThan(8_000);
    found++;
    calls += around.count;
  }
  // HEALTH: the encoder was loaded on this page, so a zero is a count.
  expect(found, "scripts carrying the JPEG encoder").toBeGreaterThanOrEqual(1);
  return calls;
}

/**
 * THE PROPERTY, deterministically: on a text page no JPEG is made at all
 * (the Flate image was always going to win), at every density the timings
 * above use. CI-independent — it counts, it does not time — and it is what
 * the timing bound alone could not be. Against the mutant in the docblock
 * above it read "text 12 of 12 pages, photo 3 of 3" and failed (Expected: 0,
 * Received: 12); on the fixed build, 0 of 12 and 3 of 3.
 */
test("Grayscale PDF encodes no JPEG on text pages, at 1, 6 and 50 lines a page, and one per page on photos", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const text = await jpegEncodes(page, await textPdf(12, [1, 6, 50]));
  const photo = await jpegEncodes(page, await photoPdf(3));
  // For the record (PR #382): the builder deflates with CompressionStream
  // where the browser has one, and falls back to pako, about half as fast.
  const native = await page.evaluate(() => typeof CompressionStream);
  console.log(
    `JPEG encodes: text ${text} of 12 pages, photo ${photo} of 3; CompressionStream ${native}`,
  );
  // POSITIVE CONTROL: where the JPEG wins it must be made, so the counter
  // sees the encoder run on this page, once a page.
  expect(photo).toBe(3);
  expect(text).toBe(0);
});

/**
 * Counts every canvas the page creates. pdf.js draws each page on a fresh
 * one (`capturePdfPages`), so the count is how many pages have been drawn.
 */
async function countCanvases(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __canvases: number };
    w.__canvases = 0;
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (
      this: Document,
      tag: string,
      options?: ElementCreationOptions,
    ) {
      if (String(tag).toLowerCase() === "canvas") w.__canvases++;
      return create.call(this, tag, options);
    } as typeof Document.prototype.createElement;
  });
}

const canvases = (page: Page) =>
  page.evaluate(() => (window as unknown as { __canvases: number }).__canvases);

test("Cancel stops a grayscale run: no more pages are drawn, no result, no error, and focus stays on the run button", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await countCanvases(page);
  // Long enough that the run is still going when Cancel is pressed, however
  // fast the encoder gets.
  const file = await textPdf(400, 6);
  await page.goto("/tools/grayscale-pdf");
  await uploadFiles(page, file);
  const run = page.getByRole("button", { name: /convert to grayscale/i });
  await expect(run).toBeEnabled({ timeout: 30_000 });
  const before = await canvases(page);
  await run.click();

  const busy = page.locator('main [aria-busy="true"]');
  await expect(busy.first()).toBeVisible();
  // POSITIVE CONTROL for the counter: the run is drawing pages.
  await expect
    .poll(async () => (await canvases(page)) - before, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(3);

  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeEnabled();
  // From the keyboard, as the review did: focus it and press Enter.
  await cancel.focus();
  await page.keyboard.press("Enter");
  const atCancel = await canvases(page);

  await expect(busy).toHaveCount(0);
  await expect(run).toBeVisible();
  await expect(run).toBeEnabled();
  await expect(run).toBeFocused();
  await expect(cancel).toHaveCount(0);
  // Long enough for many more pages: a run that went on would draw them.
  // (It would NOT land a result: `reset` drops it, so the heading below
  // cannot see a run that keeps going. The canvas count can.)
  await page.waitForTimeout(3_000);
  expect(await canvases(page)).toBeLessThanOrEqual(atCancel + 1);
  await expect(
    page.getByRole("heading", { name: /grayscale pdf ready/i }),
  ).toHaveCount(0);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
});

const fromRoot = createRequire(join(process.cwd(), "package.json"));
const AXE = fromRoot.resolve("axe-core/axe.min.js");

/**
 * `e2e/axe.spec.ts` checks landing pages at rest. The busy state, where the
 * Cancel button and the progress bar appear, is only seen here (review: axe
 * found aria-progressbar-name on it, already on main).
 */
test("axe WCAG 2.x A/AA finds nothing on Grayscale PDF while it is converting", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const file = await textPdf(400, 6);
  await page.goto("/tools/grayscale-pdf");
  await uploadFiles(page, file);
  const run = page.getByRole("button", { name: /convert to grayscale/i });
  await expect(run).toBeEnabled({ timeout: 30_000 });
  await run.click();
  // Health check: the state under test is on screen while axe runs.
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            opts: object,
          ) => Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return r.violations.map((v) => `${v.id}:${v.nodes.length}`);
  });
  await expect(page.getByRole("progressbar")).toBeVisible();
  expect(found).toEqual([]);
});
