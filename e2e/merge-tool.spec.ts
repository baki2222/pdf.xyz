import { test, expect, type Page } from "@playwright/test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import {
  attachConsoleGuard,
  fileInput,
  uploadFiles,
  waitForHydration,
  writeTempPdf,
} from "./helpers";
import { makeTextPdf } from "./client-proof/fixtures";
import {
  captureDownload,
  pdfPageTexts,
  zipEntries,
} from "./client-proof/artifacts";

/**
 * End-to-end proof that a "client" tool really runs in the browser: we generate
 * two PDFs, stage them, merge, and get a downloadable result — with the
 * production CSP active (the merge also spins up the pdfjs worker + wasm for
 * cover thumbnails, so a broken policy surfaces here).
 */
test("merge combines uploaded PDFs client-side and yields a download", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const [alpha, beta] = await Promise.all([
    writeTempPdf("alpha.pdf", 2),
    writeTempPdf("beta.pdf", 3),
  ]);

  await page.goto("/tools/merge-pdf");

  await uploadFiles(page, [alpha, beta]);

  await expect(page.getByText("alpha.pdf")).toBeVisible();
  await expect(page.getByText("beta.pdf")).toBeVisible();

  const mergeButton = page.getByRole("button", { name: /merge 2 pdfs/i });
  await expect(mergeButton).toBeEnabled();
  await mergeButton.click();

  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /download merged pdf/i }),
  ).toBeVisible();

  // The finished run has to reach someone who cannot see it appear. Assert on
  // the NAMED group rather than on ":focus" containing some text — <body> also
  // satisfies the loose version, so it would pass on the broken build.
  const outcome = page.getByRole("group", { name: /pdfs merged/i });
  await expect(outcome).toBeFocused();

  // From the outcome, the download must be one Tab away, and that click has to
  // land. jsdom can verify neither: it implements no smooth scrolling, so every
  // unit test passes with or without `preventScroll`, while a real browser
  // glides — and this repo has already lost clicks to exactly that glide, press
  // and release resolving to different elements. Clicking here is the only place
  // that hazard is actually observed.
  await page.keyboard.press("Tab");
  const download = page.getByRole("button", { name: /download merged pdf/i });
  await expect(download).toBeFocused();
  await download.click();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});

/* ------------------------------------------------------------------ *
 *  Non-default options, read from the DOWNLOADED bytes.
 *  Each test moves one option away from its default and asserts a property
 *  the default run does not have, so the default would fail each.
 * ------------------------------------------------------------------ */

type Payload = { name: string; mimeType: string; buffer: Buffer };
const pdfPayload = (name: string, bytes: Uint8Array): Payload => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(bytes),
});

async function stage(page: Page, files: Payload[]): Promise<void> {
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(files);
}

/** Each page's marker ("label::page-N"), read by pdf.js. */
async function markers(buf: Buffer): Promise<string[]> {
  const texts = await pdfPageTexts(buf);
  return texts.map((t) => /\S+::page-\d+/.exec(t)?.[0] ?? "?");
}

/** Top-level outline entries: title and the 0-based page each opens. */
async function topOutline(buf: Buffer): Promise<[string, number][]> {
  const doc = await PDFDocument.load(buf);
  const ctx = doc.context;
  const pageIndex = new Map(
    doc.getPages().map((p, i) => [p.ref.toString(), i]),
  );
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const out: [string, number][] = [];
  let cur = root ? ctx.lookup(root.get(PDFName.of("First"))) : undefined;
  while (cur instanceof PDFDict && out.length < 100) {
    const title = ctx.lookup(cur.get(PDFName.of("Title")));
    const dest = ctx.lookup(cur.get(PDFName.of("Dest")));
    const head = dest instanceof PDFArray ? dest.get(0) : undefined;
    out.push([
      title instanceof PDFString || title instanceof PDFHexString
        ? title.decodeText()
        : "",
      head instanceof PDFRef ? (pageIndex.get(head.toString()) ?? -1) : -1,
    ]);
    const next = cur.get(PDFName.of("Next"));
    cur = next ? ctx.lookup(next) : undefined;
  }
  return out;
}

test("merge options: sort A–Z, per-file pages and a bookmark per file, at 375 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/tools/merge-pdf");
  // beta is added first, so "Name A–Z" has something to change.
  await stage(page, [
    pdfPayload("beta.pdf", await makeTextPdf("beta.pdf", { pages: 2 })),
    pdfPayload("alpha.pdf", await makeTextPdf("alpha.pdf", { pages: 3 })),
  ]);
  await expect(page.getByText("alpha.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("beta.pdf", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Name A–Z" }).click();
  await page.getByLabel(/pages of alpha\.pdf to merge/i).fill("1, 3");
  await page.getByLabel(/add a bookmark for each file/i).check();
  await expect(page.getByText(/2 files · 4 pages/)).toBeVisible();

  // The row's page box must not push the page sideways on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /download merged pdf/i }),
  );
  expect(await markers(buf)).toEqual([
    "alpha.pdf::page-1",
    "alpha.pdf::page-3",
    "beta.pdf::page-1",
    "beta.pdf::page-2",
  ]);
  expect(await topOutline(buf)).toEqual([
    ["alpha", 0],
    ["beta", 2],
  ]);
});

/** A text PDF with hand-written top-level bookmarks at `starts` (0-based). */
async function bookmarkedPdf(
  label: string,
  pages: number,
  starts: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makeTextPdf(label, { pages }));
  const ctx = doc.context;
  const pageRefs = doc.getPages().map((p) => p.ref);
  const rootRef = ctx.nextRef();
  const refs = starts.map(() => ctx.nextRef());
  starts.forEach((start, i) => {
    ctx.assign(
      refs[i]!,
      ctx.obj({
        Title: PDFString.of(`Chapter ${i + 1}`),
        Parent: rootRef,
        ...(i > 0 ? { Prev: refs[i - 1]! } : {}),
        ...(i < refs.length - 1 ? { Next: refs[i + 1]! } : {}),
        Dest: [pageRefs[start]!, PDFName.of("Fit")],
      }),
    );
  });
  ctx.assign(
    rootRef,
    ctx.obj({
      Type: "Outlines",
      First: refs[0]!,
      Last: refs[refs.length - 1]!,
      Count: refs.length,
    }),
  );
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
  return doc.save();
}

/** Each ZIP entry's page markers, entries in name order. */
async function partsOf(zip: Buffer): Promise<string[][]> {
  const entries = [...(await zipEntries(zip)).entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return Promise.all(entries.map(([, bytes]) => markers(bytes)));
}

test("split options: by bookmarks cuts at each top-level bookmark's page", async ({
  page,
}) => {
  await page.goto("/tools/split-pdf");
  await stage(page, [
    pdfPayload("book.pdf", await bookmarkedPdf("book.pdf", 5, [1, 3])),
  ]);
  await expect(page.getByText("book.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "By bookmarks" }).click();
  await expect(page.getByText("Chapter 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /split into 3 files/i }).click();
  await expect(page.getByRole("heading", { name: /pdf split/i })).toBeVisible();
  const zip = await captureDownload(
    page,
    page.getByRole("button", { name: /download zip \(3 files\)/i }),
  );
  expect(await partsOf(zip)).toEqual([
    ["book.pdf::page-1"],
    ["book.pdf::page-2", "book.pdf::page-3"],
    ["book.pdf::page-4", "book.pdf::page-5"],
  ]);
});

test("split options: a PDF without bookmarks greys the mode out with a reason", async ({
  page,
}) => {
  await page.goto("/tools/split-pdf");
  await stage(page, [
    pdfPayload("plain.pdf", await makeTextPdf("plain.pdf", { pages: 3 })),
  ]);
  await expect(
    page.getByText(/this pdf has no top-level bookmarks/i),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "By bookmarks" }),
  ).toHaveAttribute("aria-disabled", "true");
});

test("split options: merge selected ranges into one file", async ({ page }) => {
  await page.goto("/tools/split-pdf");
  await stage(page, [
    pdfPayload("deck.pdf", await makeTextPdf("deck.pdf", { pages: 4 })),
  ]);
  await expect(page.getByText("deck.pdf", { exact: true })).toBeVisible();
  await page.getByPlaceholder("e.g. 1-3, 4-6, 7-").fill("3-4, 1");
  await page.getByLabel(/merge selected ranges into one file/i).check();
  await page.getByRole("button", { name: /split into 1 file/i }).click();
  await expect(page.getByRole("heading", { name: /pdf split/i })).toBeVisible();
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /^download pdf$/i }),
  );
  expect(await markers(buf)).toEqual([
    "deck.pdf::page-3",
    "deck.pdf::page-4",
    "deck.pdf::page-1",
  ]);
});

test("split options: by file size keeps every part under the target", async ({
  page,
}) => {
  await page.goto("/tools/split-pdf");
  const lines = Array.from(
    { length: 40 },
    (_, i) => `line ${i} ${(i * 7919 + 104729).toString(36).repeat(4)}`,
  );
  const source = await makeTextPdf("big.pdf", {
    pages: 8,
    bodyLines: lines,
    unoptimized: true,
  });
  await stage(page, [pdfPayload("big.pdf", source)]);
  await expect(page.getByText("big.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "By file size" }).click();
  const targetMb = (source.byteLength / 3 / (1024 * 1024)).toFixed(4);
  await page.getByLabel(/maximum size per file/i).fill(targetMb);
  await page.getByRole("button", { name: /split by size/i }).click();
  await expect(page.getByRole("heading", { name: /pdf split/i })).toBeVisible();
  const zip = await captureDownload(
    page,
    page.getByRole("button", { name: /download zip/i }),
  );
  const entries = await zipEntries(zip);
  // Health: the target really forced several parts.
  expect(entries.size).toBeGreaterThan(1);
  const limit = Number(targetMb) * 1024 * 1024;
  for (const [name, bytes] of entries) {
    expect(bytes.byteLength, name).toBeLessThanOrEqual(limit);
  }
  expect((await partsOf(zip)).flat()).toEqual(
    Array.from({ length: 8 }, (_, i) => `big.pdf::page-${i + 1}`),
  );
});

/** Each Link annotation on page `index`: the 0-based page its /Dest opens. */
async function linkTargets(buf: Buffer, index: number): Promise<number[]> {
  const doc = await PDFDocument.load(buf);
  const pageIndex = new Map(
    doc.getPages().map((p, i) => [p.ref.toString(), i]),
  );
  const annots = doc
    .getPage(index)
    .node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  return (annots?.asArray() ?? []).map((ref) => {
    const annot = doc.context.lookup(ref) as PDFDict;
    const dest = annot.lookupMaybe(PDFName.of("Dest"), PDFArray);
    const head = dest?.get(0);
    return head instanceof PDFRef ? (pageIndex.get(head.toString()) ?? -1) : -1;
  });
}

test("merge options: a contents page lists each file at its start page, linked, at 375 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/tools/merge-pdf");
  await stage(page, [
    pdfPayload("beta.pdf", await makeTextPdf("beta.pdf", { pages: 2 })),
    pdfPayload("alpha.pdf", await makeTextPdf("alpha.pdf", { pages: 3 })),
  ]);
  await expect(page.getByText("alpha.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Name A–Z" }).click();
  await page.getByLabel(/pages of alpha\.pdf to merge/i).fill("1, 3");
  await page.getByLabel(/add a bookmark for each file/i).check();
  await page.getByLabel(/add a contents page/i).check();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
  // The receipt counts the contents page with the merged ones.
  await expect(page.getByText(/5 pages \(1 contents\)/)).toBeVisible();
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /download merged pdf/i }),
  );
  const texts = await pdfPageTexts(buf);
  const toc = texts[0]!.replace(/[ .]{3,}/g, " … ");
  expect(toc).toContain("Contents");
  expect(toc).toMatch(/alpha … 2/);
  expect(toc).toMatch(/beta … 4/);
  expect(await markers(buf)).toEqual([
    "?",
    "alpha.pdf::page-1",
    "alpha.pdf::page-3",
    "beta.pdf::page-1",
    "beta.pdf::page-2",
  ]);
  expect(await linkTargets(buf, 0)).toEqual([1, 3]);
  expect(await topOutline(buf)).toEqual([
    ["alpha", 1],
    ["beta", 3],
  ]);
});

/** A PDF whose pages carry their marker and, on `flagged` pages, "Invoice". */
async function invoicePdf(
  label: string,
  pages: number,
  flagged: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([320, 240]);
    p.drawText(`${label}::page-${i + 1}`, { x: 20, y: 200, size: 14, font });
    if (flagged.includes(i)) {
      p.drawText("Invoice number 1000", { x: 20, y: 170, size: 12, font });
    }
  }
  return doc.save();
}

test("split options: by text starts a file at every page containing the phrase", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/tools/split-pdf");
  await stage(page, [
    pdfPayload("batch.pdf", await invoicePdf("batch.pdf", 5, [1, 3])),
  ]);
  await expect(page.getByText("batch.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "By text" }).click();
  await page.getByPlaceholder("e.g. Invoice number").fill("invoice NUMBER");
  await expect(
    page.getByRole("button", { name: /split into 3 files/i }),
  ).toBeEnabled();
  // Match case: the typed capitals no longer match the page.
  await page.getByLabel("Match case").check();
  await expect(page.getByText(/no page contains/i)).toBeVisible();
  await page.getByLabel("Match case").uncheck();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: /split into 3 files/i }).click();
  await expect(page.getByRole("heading", { name: /pdf split/i })).toBeVisible();
  const zip = await captureDownload(
    page,
    page.getByRole("button", { name: /download zip \(3 files\)/i }),
  );
  expect(await partsOf(zip)).toEqual([
    ["batch.pdf::page-1"],
    ["batch.pdf::page-2", "batch.pdf::page-3"],
    ["batch.pdf::page-4", "batch.pdf::page-5"],
  ]);
});

/* ------------------------------------------------------------------ *
 *  Arrange pages (audit backlog #9, 2026-11-17): every page of every
 *  file in one grid, driven by pointer, keyboard and touch, read back
 *  from the DOWNLOADED bytes.
 * ------------------------------------------------------------------ */

const pageGrid = (page: Page) =>
  page.getByRole("list", { name: /^Pages of every file/ });

/** The grid's tiles, as their accessible names, in order. */
async function tileNames(page: Page): Promise<string[]> {
  return pageGrid(page)
    .locator('[role="listitem"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
}

const tile = (page: Page, file: string, n: number) =>
  pageGrid(page).getByRole("listitem", {
    name: new RegExp(`^Page ${n} of ${file.replace(".", "\\.")},`),
  });

/** "1, 3" or "1-3" for 1-based pages, as the Pages box writes them. */
function listText(pages: number[]): string {
  const runs: [number, number][] = [];
  for (const p of [...pages].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else runs.push([p, p]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
}

/**
 * The typed Pages box of every file says exactly which of its pages the grid
 * keeps: empty when all, else the kept set in page-number order.
 */
async function boxesAgreeWithGrid(
  page: Page,
  files: Record<string, number>,
): Promise<void> {
  const names = await tileNames(page);
  for (const [file, count] of Object.entries(files)) {
    const kept = names
      .filter((n) => n.includes(` of ${file}, page `))
      .map((n) => Number(/^Page (\d+) of /.exec(n)![1]));
    const want = kept.length === count ? "" : listText(kept);
    await expect(
      page.getByLabel(
        new RegExp(`pages of ${file.replace(".", "\\.")} to merge`, "i"),
      ),
      `${file}: grid keeps ${kept.join(",")}`,
    ).toHaveValue(want);
  }
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Each page's /Rotate, read back with pdf-lib. */
async function turns(buf: Buffer): Promise<number[]> {
  const doc = await PDFDocument.load(buf);
  return doc.getPages().map((p) => p.getRotation().angle);
}

test("merge page mode: drag, keyboard move, rotate and leave out across files", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/tools/merge-pdf");
  await stage(page, [
    pdfPayload("alpha.pdf", await makeTextPdf("alpha.pdf", { pages: 3 })),
    pdfPayload("beta.pdf", await makeTextPdf("beta.pdf", { pages: 3 })),
  ]);
  await expect(page.getByText("beta.pdf", { exact: true })).toBeVisible();
  const counts = { "alpha.pdf": 3, "beta.pdf": 3 };

  await page.getByRole("radio", { name: "Arrange pages" }).click();
  await expect(pageGrid(page)).toBeVisible();
  expect(await tileNames(page)).toHaveLength(6);
  await boxesAgreeWithGrid(page, counts);

  // Leave out alpha's page 2.
  await page
    .getByRole("button", { name: "Leave out page 2 of alpha.pdf" })
    .click();
  await boxesAgreeWithGrid(page, counts);
  await expect(page.getByLabel(/pages of alpha\.pdf to merge/i)).toHaveValue(
    "1, 3",
  );

  // Pointer: drag beta's page 1 onto alpha's page 3, between alpha's pages.
  await tile(page, "beta.pdf", 1).dragTo(tile(page, "alpha.pdf", 3));
  await expect(tile(page, "beta.pdf", 1)).toHaveAttribute(
    "aria-label",
    /page 2 of 5 in the merged PDF/,
  );
  await boxesAgreeWithGrid(page, counts);

  // Keyboard only: beta's page 3 to the very front.
  const grip = page.getByRole("button", {
    name: /^Reorder page 3 of beta\.pdf/,
  });
  await grip.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(tile(page, "beta.pdf", 3)).toHaveAttribute(
    "aria-label",
    /page 1 of 5 in the merged PDF/,
  );
  await boxesAgreeWithGrid(page, counts);

  // View a page larger: the dialog names the page, its file and its place.
  await page.getByRole("button", { name: "View page 1 larger" }).click();
  await expect(
    page.getByRole("dialog", {
      name: "Page 3 of beta.pdf, page 1 of 5 in the merged PDF",
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Turn beta's page 2.
  await page
    .getByRole("button", { name: "Rotate page 2 of beta.pdf right" })
    .click();
  await boxesAgreeWithGrid(page, counts);

  await expect(page.getByText(/2 files · 5 pages/)).toBeVisible();
  await expect(page.getByText(/^Your files' pages are mixed/)).toBeVisible();
  await expect(
    page.getByLabel(/add a bookmark for each file/i),
  ).toHaveAttribute("aria-disabled", "true");

  // Leave to One after another and back: the arrangement is kept.
  const before = await tileNames(page);
  await page.getByRole("radio", { name: "One after another" }).click();
  await expect(page.getByText(/Your page arrangement is kept/)).toBeVisible();
  await page.getByRole("radio", { name: "Arrange pages" }).click();
  await expect(pageGrid(page)).toBeVisible();
  expect(await tileNames(page)).toEqual(before);
  await boxesAgreeWithGrid(page, counts);

  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /download merged pdf/i }),
  );
  expect(await markers(buf)).toEqual([
    "beta.pdf::page-3",
    "alpha.pdf::page-1",
    "beta.pdf::page-1",
    "alpha.pdf::page-3",
    "beta.pdf::page-2",
  ]);
  expect(await turns(buf)).toEqual([0, 0, 0, 0, 90]);
  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});

test.describe("merge page mode on a 375 x 812 touch screen", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });

  test("the move buttons reorder across files by tap, with no sideways scroll", async ({
    page,
  }) => {
    await page.goto("/tools/merge-pdf");
    await stage(page, [
      pdfPayload("alpha.pdf", await makeTextPdf("alpha.pdf", { pages: 3 })),
      pdfPayload("beta.pdf", await makeTextPdf("beta.pdf", { pages: 3 })),
    ]);
    await expect(page.getByText("beta.pdf", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Arrange pages" }).tap();
    await expect(pageGrid(page)).toBeVisible();
    await noSidewaysScroll(page);
    // Beta's page 1 sits at slot 4; three taps of "earlier" put it first.
    const earlier = page.getByRole("button", {
      name: "Move page 1 of beta.pdf earlier",
    });
    for (let i = 0; i < 3; i++) await earlier.tap();
    await expect(tile(page, "beta.pdf", 1)).toHaveAttribute(
      "aria-label",
      /page 1 of 6 in the merged PDF/,
    );
    // Every tile button is a thumb's target.
    const box = await earlier.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page
      .getByRole("button", { name: "Rotate page 3 of alpha.pdf left" })
      .tap();
    await page
      .getByRole("button", { name: "Leave out page 3 of beta.pdf" })
      .tap();
    await boxesAgreeWithGrid(page, { "alpha.pdf": 3, "beta.pdf": 3 });
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: /merge 2 pdfs/i }).tap();
    await expect(
      page.getByRole("heading", { name: /pdfs merged/i }),
    ).toBeVisible();
    const buf = await captureDownload(
      page,
      page.getByRole("button", { name: /download merged pdf/i }),
    );
    expect(await markers(buf)).toEqual([
      "beta.pdf::page-1",
      "alpha.pdf::page-1",
      "alpha.pdf::page-2",
      "alpha.pdf::page-3",
      "beta.pdf::page-2",
    ]);
    expect(await turns(buf)).toEqual([0, 0, 0, 270, 0]);
  });
});

test("merge page mode passes axe with files mixed", async ({ page }) => {
  const { createRequire } = await import("node:module");
  const { join } = await import("node:path");
  const axePath = createRequire(join(process.cwd(), "package.json")).resolve(
    "axe-core/axe.min.js",
  );
  await page.goto("/tools/merge-pdf");
  await stage(page, [
    pdfPayload("alpha.pdf", await makeTextPdf("alpha.pdf", { pages: 2 })),
    pdfPayload("beta.pdf", await makeTextPdf("beta.pdf", { pages: 2 })),
  ]);
  await expect(page.getByText("beta.pdf", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Arrange pages" }).click();
  await expect(pageGrid(page)).toBeVisible();
  await page
    .getByRole("button", { name: "Move page 1 of beta.pdf earlier" })
    .click();
  await expect(page.getByText(/^Your files' pages are mixed/)).toBeVisible();
  await page.addScriptTag({ path: axePath });
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
    return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
  });
  expect(found).toEqual([]);
});

test("merge page mode stays responsive with a 300-page file: thumbnails load as tiles near the screen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/tools/merge-pdf");
  await stage(page, [
    pdfPayload("big.pdf", await makeTextPdf("big.pdf", { pages: 300 })),
    pdfPayload("small.pdf", await makeTextPdf("small.pdf", { pages: 2 })),
  ]);
  await expect(page.getByText("small.pdf", { exact: true })).toBeVisible();
  const t0 = Date.now();
  await page.getByRole("radio", { name: "Arrange pages" }).click();
  await expect(pageGrid(page)).toBeVisible();
  await expect(pageGrid(page).locator('[role="listitem"]')).toHaveCount(302);
  const openMs = Date.now() - t0;
  // Give the near-screen thumbnails time to draw, then count them.
  await page.waitForTimeout(3_000);
  const drawn = await pageGrid(page).locator("img").count();
  // A keyboard move to the far end of the list, timed to its announcement.
  const grip = page.getByRole("button", {
    name: /^Reorder page 1 of small\.pdf/,
  });
  await grip.focus();
  const t1 = Date.now();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(tile(page, "small.pdf", 1)).toHaveAttribute(
    "aria-label",
    /page 1 of 302 in the merged PDF/,
  );
  const moveMs = Date.now() - t1;
  console.log(
    `[300-page] grid open ${openMs} ms, thumbnails drawn ${drawn}/302 after 3 s, keyboard move ${moveMs} ms`,
  );
  // Lazy: far fewer than every page has a picture.
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(150);
  expect(moveMs).toBeLessThan(3_000);
});

test("merge page mode: Tab leaves the grid in a few presses, arrows go from page to page, Escape puts a page back", async ({
  page,
}) => {
  await page.goto("/tools/merge-pdf");
  await stage(page, [
    pdfPayload("alpha.pdf", await makeTextPdf("alpha.pdf", { pages: 3 })),
    pdfPayload("beta.pdf", await makeTextPdf("beta.pdf", { pages: 3 })),
  ]);
  await expect(page.getByText("beta.pdf", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Arrange pages" }).click();
  await expect(pageGrid(page)).toBeVisible();
  // Health check: the grid HAS its buttons, six tiles of at least six each,
  // so a short Tab walk is the roving tab stop, not missing tiles.
  expect(await pageGrid(page).locator("button").count()).toBeGreaterThanOrEqual(
    36,
  );

  // Tab from the grid's first control to the Merge button, counted.
  await page
    .getByRole("button", { name: /^Reorder page 1 of alpha\.pdf/ })
    .focus();
  const merge = page.getByRole("button", { name: /merge 2 pdfs/i });
  let presses = 0;
  while (presses < 60) {
    if (await merge.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
    presses += 1;
  }
  console.log(`[tab walk] grid to Merge in ${presses} presses`);
  expect(presses).toBeLessThanOrEqual(20);

  // Arrows: the same button, one tile on; the order does not change.
  const before = await tileNames(page);
  await page
    .getByRole("button", { name: "Rotate page 1 of alpha.pdf right" })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Rotate page 2 of alpha.pdf right" }),
  ).toBeFocused();
  expect(await tileNames(page)).toEqual(before);

  // Escape after a keyboard move: the page goes back to its slot.
  const grip = page.getByRole("button", {
    name: /^Reorder page 1 of beta\.pdf/,
  });
  await grip.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowLeft");
  await expect(tile(page, "beta.pdf", 1)).toHaveAttribute(
    "aria-label",
    /page 3 of 6 in the merged PDF/,
  );
  await page.keyboard.press("Escape");
  await expect(tile(page, "beta.pdf", 1)).toHaveAttribute(
    "aria-label",
    /page 4 of 6 in the merged PDF/,
  );
  expect(await tileNames(page)).toEqual(before);
});

test("merge page mode at 1280 wide: each tile's buttons sit on one row, greyed options look greyed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tools/merge-pdf");
  await stage(page, [
    pdfPayload("alpha.pdf", await makeTextPdf("alpha.pdf", { pages: 3 })),
    pdfPayload("beta.pdf", await makeTextPdf("beta.pdf", { pages: 3 })),
  ]);
  await expect(page.getByText("beta.pdf", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Arrange pages" }).click();
  await expect(pageGrid(page)).toBeVisible();
  // Every action button of a tile shares one row (its top edge).
  const rows = await pageGrid(page)
    .locator('[role="listitem"]')
    .evaluateAll((tiles) =>
      tiles.map((t) => {
        const tops = [...t.querySelectorAll("button")]
          .slice(1) // the grip sits in the corner
          .map((b) => Math.round(b.getBoundingClientRect().top));
        return new Set(tops).size;
      }),
    );
  expect(rows).toEqual(rows.map(() => 1));
  // Mixed: the greyed options are drawn greyed, the offered one is not.
  await page
    .getByRole("button", { name: "Move page 1 of beta.pdf earlier" })
    .click();
  await expect(page.getByText(/^Your files' pages are mixed/)).toBeVisible();
  const opacity = (re: RegExp) =>
    page
      .getByLabel(re)
      .evaluate((el) => getComputedStyle(el.closest("label")!).opacity);
  expect(await opacity(/add a bookmark for each file/i)).toBe("0.5");
  expect(await opacity(/print each file's name/i)).toBe("1");
});

test("merge page mode with 1,300 pages: scrolling stays smooth and the tiles on screen get their pictures", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/tools/merge-pdf");
  await stage(page, [
    pdfPayload("big.pdf", await makeTextPdf("big.pdf", { pages: 1000 })),
    pdfPayload("more.pdf", await makeTextPdf("more.pdf", { pages: 300 })),
  ]);
  await expect(page.getByText("more.pdf", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.longTasks.push(e.duration);
    }).observe({ type: "longtask", buffered: false });
  });
  const longTasks = () =>
    page.evaluate(
      () => (window as unknown as { longTasks: number[] }).longTasks,
    );
  // Positive control: the observer sees a task it must see, so a count of
  // none below is the page's, not a blind instrument's.
  // A task of the page's own: one run inside the evaluate call itself is
  // DevTools' task and the observer never sees it (measured: 0 entries).
  await page.evaluate(() => {
    setTimeout(() => {
      const end = performance.now() + 120;
      while (performance.now() < end);
    }, 0);
  });
  await expect.poll(async () => (await longTasks()).length).toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as unknown as { longTasks: number[] }).longTasks = [];
  });
  const t0 = Date.now();
  await page.getByRole("radio", { name: "Arrange pages" }).click();
  await expect(pageGrid(page).locator('[role="listitem"]')).toHaveCount(1300, {
    timeout: 30_000,
  });
  const openMs = Date.now() - t0;
  await page.waitForTimeout(1_500);
  const opening = await longTasks();

  // A scroll pass end to end, half a screen at a time, frames logged. The
  // grid itself on screen first: a tile's picture is asked for when it
  // nears the WINDOW, not merely the grid's own scroll box.
  await pageGrid(page).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    (window as unknown as { longTasks: number[] }).longTasks = [];
  });
  const frames = await pageGrid(page).evaluate(async (grid) => {
    const gaps: number[] = [];
    let last = performance.now();
    let on = true;
    const tick = (t: number) => {
      gaps.push(t - last);
      last = t;
      if (on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    while (grid.scrollTop + grid.clientHeight < grid.scrollHeight - 2) {
      grid.scrollTop += grid.clientHeight / 2;
      await new Promise((r) => setTimeout(r, 30));
    }
    on = false;
    return gaps.slice(1).sort((a, b) => a - b);
  });
  const scrolling = await longTasks();
  // Health check: the pass really went end to end, frame by frame.
  expect(frames.length).toBeGreaterThan(200);
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;

  // At the end: the tiles on screen get pictures, not after every tile the
  // pass went by.
  const imagesNow = () => pageGrid(page).locator("img").count();
  const drawnAtEnd = await imagesNow();
  const t1 = Date.now();
  const visibleWithImages = async () =>
    pageGrid(page).evaluate((grid) => {
      const box = grid.getBoundingClientRect();
      const seen = [...grid.querySelectorAll('[role="listitem"]')].filter(
        (t) => {
          const r = t.getBoundingClientRect();
          return r.bottom > box.top && r.top < box.bottom;
        },
      );
      return {
        seen: seen.length,
        drawn: seen.filter((t) => t.querySelector("img")).length,
      };
    });
  await expect
    .poll(
      async () => {
        const v = await visibleWithImages();
        return v.seen > 0 && v.drawn === v.seen;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const fillMs = Date.now() - t1;
  // Pictures drawn between the end of the pass and the screen being full:
  // newest first, about a screen's worth; in request order, every page the
  // pass went by that was still queued (the clock-free measure: a FIFO
  // queue took 3.2 s here and 40 s on the reviewer's machine).
  const drawnBeforeScreen = (await imagesNow()) - drawnAtEnd;

  // A move: the main thread's longest task while it lands. Pressed and
  // awaited inside the page, because a role locator's own search of 9,000
  // buttons runs on the page's main thread too and would be counted.
  const later = page.getByRole("button", {
    name: "Move page 300 of more.pdf earlier",
  });
  await later.scrollIntoViewIfNeeded();
  const moving = await later.evaluate(async (button) => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    (button as HTMLButtonElement).click();
    for (let i = 0; i < 10; i++)
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 300));
    return w.longTasks;
  });
  await expect(tile(page, "more.pdf", 300)).toHaveAttribute(
    "aria-label",
    /page 1299 of 1300 in the merged PDF/,
  );
  const moveMs = Math.round(Math.max(0, ...moving));
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
  console.log(
    `[1,300 pages] open ${openMs} ms; opening long tasks ${opening.length} (max ${Math.round(max(opening))} ms); scroll frames ${frames.length}, p95 ${p95.toFixed(1)} ms, max ${max(frames).toFixed(1)} ms; scroll long tasks ${scrolling.length} (max ${Math.round(max(scrolling))} ms); visible tiles drawn in ${fillMs} ms (${drawnBeforeScreen} pictures drawn to fill them); move: ${moving.length} long tasks, max ${moveMs} ms`,
  );
  expect(max(scrolling)).toBeLessThan(BUDGET.scrollLongTaskMs);
  expect(p95).toBeLessThan(BUDGET.scrollFrameP95Ms);
  expect(fillMs).toBeLessThan(BUDGET.fillMs);
  expect(drawnBeforeScreen).toBeLessThan(BUDGET.drawnBeforeScreen);
  expect(moveMs).toBeLessThan(BUDGET.moveMs);
});

/**
 * The 1,300-page budget (review of 2026-11-17 measured, before the fix:
 * scroll p95 133 ms with long tasks to 183 ms, visible tiles blank after
 * 40 s, a move click with a 185 ms task).
 */
const BUDGET = {
  scrollLongTaskMs: 100,
  scrollFrameP95Ms: 50,
  fillMs: 8_000,
  drawnBeforeScreen: 60,
  moveMs: 100,
} as const;
