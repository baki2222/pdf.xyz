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
