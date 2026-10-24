import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import {
  attachConsoleGuard,
  fileInput,
  makePdfBytes,
  placeEditorText,
  uploadFiles,
  waitForHydration,
  writeTempPdf,
} from "./helpers";
import {
  captureDownload,
  downloadBytesOf,
  pdfPageTexts,
  pdfRotations,
} from "./client-proof/artifacts";
import {
  positionsFrom,
  recordedShifts,
  startFrames,
  stopFrames,
  throttle,
  type Shift,
} from "./frames";
import { CASES } from "./client-proof/cases";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { RESULT_ENDING_CHUNK } from "../src/components/intent/result-ending-chunk";
import { supportedToolSlugs } from "../src/lib/pdf/registry";
import { RECENTS_STORAGE_KEY } from "../src/lib/intent/recents-key";
import { USER_PASSWORD_PDF_BASE64 } from "../src/tests/fixtures-encrypted";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * Every ending is a fork (redesign WP-08), proved through the page — a real
 * browser, the production build, the files a visitor downloads:
 *
 *  - the receipt's page count is the FILE's: a merge of 3 + 2 pages says
 *    "5 pages", and an independent count of the downloaded bytes (pdfjs, in
 *    this process) says the same — so an off-by-one in the receipt's
 *    re-count, or a merge that drops a page, turns this red;
 *  - "Continue with" carries the result to the next tool with where it came
 *    from, and the job's steps follow it; a chain of three ends in a file
 *    that holds the first tool's pages with the second tool's numbers;
 *  - Back to adjust returns to the settings as they were;
 *  - the control: a browser that will not store the file is told so, and
 *    nothing navigates;
 *  - a known refusal offers its fix once; unapplied edits are asked about
 *    before a link leaves the page;
 *  - G.7, counted: "Merge 3 PDFs, then compress" in five actions with no
 *    file picked twice, ending in a file this process opens; and the half
 *    of "Encrypted PDF in Rotate" that exists before WP-10;
 *  - the result is drawn WITH its ending, and nothing in it moves once
 *    painted (`e2e/continue-chain.mobile.spec.ts` holds the phone's half).
 *
 * The consent banner is answered first: it is fixed to the bottom of the
 * screen, where it would sit over a receipt's last rows.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

async function mergeAlphaBeta(page: Page) {
  const [alpha, beta] = await Promise.all([
    writeTempPdf("alpha.pdf", 3),
    writeTempPdf("beta.pdf", 2),
  ]);
  await page.goto("/tools/merge-pdf");
  await uploadFiles(page, [alpha, beta]);
  await expect(page.getByText("beta.pdf")).toBeVisible();
  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
}

const continueRow = (page: Page) =>
  page.getByRole("group", { name: "Continue with" });

/**
 * The receipt's page count, as its one statement reads: "5, re-opened and
 * counted in this browser" — the figure its own re-count put there, read
 * once it has settled.
 */
async function receiptCount(page: Page, scope = page.locator("main")) {
  const counted = scope
    .locator('[data-receipt] [data-settles="counted"] > [data-current]')
    .first();
  await expect(counted).toBeVisible({ timeout: 20_000 });
  const text = ((await counted.textContent()) ?? "").replace(/\s+/g, " ");
  const m = /^(\d+), re-opened and counted in this browser$/.exec(text.trim());
  expect(m, `the receipt reads "${text}"`).not.toBeNull();
  return Number(m![1]);
}

/**
 * A PDF whose pages are mostly a picture: an uncompressed 120 px RGB noise
 * image (incompressible, so no repack can shrink it) and a line of text
 * naming the page. Merged, it is what Compress PDF calls image-heavy: the
 * in-browser repack has nothing to remove, and the secure worker's image
 * downsampling is the step that makes it smaller.
 */
async function writeImagePdf(name: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([320, 240]);
    const image = doc.context.register(
      doc.context.stream(randomBytes(120 * 120 * 3), {
        Type: "XObject",
        Subtype: "Image",
        Width: 120,
        Height: 120,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
      }),
    );
    const tag = page.node.newXObject("Scan", image);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(120, 0, 0, 120, 180, 20),
      drawObject(tag),
      popGraphicsState(),
    );
    page.drawText(`${name} — page ${i + 1}`, { x: 24, y: 200, size: 16, font });
  }
  const dir = mkdtempSync(join(tmpdir(), "pdfxyz-e2e-"));
  const path = join(dir, name);
  writeFileSync(path, await doc.save());
  return path;
}

/**
 * What the secure worker's deep compression does to such a file, done here:
 * every image replaced by an 8 px one, the pages and their text untouched.
 */
async function downsampleImages(bytes: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFRawStream &&
      object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
    )
      doc.context.assign(
        ref,
        doc.context.stream(new Uint8Array(8 * 8 * 3).fill(128), {
          Type: "XObject",
          Subtype: "Image",
          Width: 8,
          Height: 8,
          ColorSpace: "DeviceRGB",
          BitsPerComponent: 8,
        }),
      );
  }
  return doc.save();
}

/**
 * The secure worker, answered by this process (no worker runs here): the
 * status a ready deployment reports, an upload slot, the job, and its
 * artifact — {@link downsampleImages} of exactly the bytes the page
 * uploaded. Returns what was uploaded, for the test to read.
 */
async function mockCompressWorker(page: Page) {
  const uploads: Buffer[] = [];
  let output: Uint8Array | null = null;
  const now = new Date().toISOString();
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/api/worker/status", (route) =>
    route.fulfill(json(READY_WORKER_STATUS)),
  );
  await page.route("**/api/uploads", (route) =>
    route.fulfill(
      json(
        {
          sessionId: "s_e2e",
          tool: "compress-pdf",
          slots: [
            {
              fileId: "f_e2e00000000000001",
              filename: "input.pdf",
              url: "/api/uploads/e2e/f_e2e00000000000001",
              method: "PUT",
              headers: {},
            },
          ],
          expiresAt: now,
          retention: {},
        },
        201,
      ),
    ),
  );
  await page.route("**/api/uploads/e2e/**", async (route) => {
    const body = route.request().postDataBuffer();
    if (body) uploads.push(body);
    output = await downsampleImages(body ?? Buffer.alloc(0));
    await route.fulfill(json({}));
  });
  await page.route("**/api/jobs", (route) =>
    route.fulfill(
      json(
        {
          jobId: "job_e2ecompress",
          tool: "compress-pdf",
          capability: "worker",
          status: "completed",
          progress: 100,
          artifacts: [
            {
              artifactId: "a_e2e",
              filename: "alpha-merged-compressed.pdf",
              contentType: "application/pdf",
              bytes: output?.byteLength ?? 0,
              url: "/api/e2e-artifacts/a_e2e",
              expiresAt: now,
            },
          ],
          createdAt: now,
          updatedAt: now,
          expiresAt: now,
          retention: {},
        },
        201,
      ),
    ),
  );
  await page.route("**/api/e2e-artifacts/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: Buffer.from(output ?? new Uint8Array()),
    }),
  );
  return { uploads };
}

test("the merged file's receipt is its own count: 5 pages, re-opened here and in this process", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await mergeAlphaBeta(page);
  const counted = await receiptCount(page);
  // The merge meant to write 5, and the receipt found 5: no warning.
  expect(counted).toBe(5);
  // ONE statement of the count, with one ring: the receipt does not say it
  // again in a line of its own (WP-08 review, 2026-10-10).
  const receipt = page.locator("[data-receipt]");
  await expect(receipt.getByText(/counted in this browser/)).toHaveCount(1);
  await expect(receipt.locator("svg circle")).toHaveCount(1);
  await expect(page.getByText(/expected \d+ pages?, counted/i)).toHaveCount(0);

  const merged = await captureDownload(
    page,
    page.getByRole("button", { name: /download merged pdf/i }),
  );
  // Independent of the browser: pdfjs in this process opens what was saved.
  const pages = await pdfPageTexts(merged);
  expect(pages).toHaveLength(counted);
  expect(pages[0]).toContain("alpha.pdf — page 1");
  expect(pages[3]).toContain("beta.pdf — page 1");
  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("Continue with carries the result, says where it came from, and the job's steps follow it", async ({
  page,
}) => {
  await mergeAlphaBeta(page);
  const row = continueRow(page);
  await expect(row).toBeVisible();
  // Compress PDF is offered first after a merge (`Tool.next`), and the row
  // says what it carries.
  const compress = row.getByRole("link", { name: /compress pdf/i });
  await expect(compress).toContainText("carries alpha-merged.pdf");
  await expect(row.getByRole("link")).toHaveCount(4);
  await compress.click();

  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();
  // The file that arrived is the merge's output, by its name.
  await expect(
    page.getByText("alpha-merged.pdf", { exact: true }).first(),
  ).toBeVisible();
  const rail = page.getByRole("navigation", { name: "Job steps" });
  await expect(rail.getByRole("listitem")).toHaveText([
    "Merge PDF (done)",
    "Compress PDF",
  ]);
  await expect(rail.locator('[aria-current="step"]')).toHaveText(
    "Compress PDF",
  );
});

/**
 * EVERY ENDING IS A FORK, ON THE PATH WP-08 MADE MOST LIKELY (2026-10-17).
 * Compress PDF is the first row Merge PDF offers, and a merge is written by
 * the writer Compress PDF's repack uses, so a text merge is "already lean"
 * by construction (see G.7 row 2 below). Until this date that analysis drew
 * no Download and no ending at all — both were inside `canDownload &&` —
 * and the stage ended at "Analyze another file": the merged PDF, never
 * downloaded, could go nowhere (batch C review, 36702d2c: zero
 * `[data-continue-with]` rows, the only control "Analyze another file").
 *
 * Now a result with nothing saved still ends: the file as it is, said to be
 * unchanged, to download — and Continue with carrying it. Read through the
 * page: the bytes downloaded are the merge's five pages, and the rows carry
 * the merged file by its name.
 *
 * Mutation-checked on the build (2026-10-17): the no-saving ending switched
 * off in the Compress runner — "the lean result has no Continue with", as
 * on 94dc2b22. Restored from a copy, no diff.
 */
test("a lean merge carried to Compress PDF still ends in a fork: the file as it is to download, and Continue with carrying it", async ({
  page,
}) => {
  await mergeAlphaBeta(page);
  await continueRow(page)
    .getByRole("link", { name: /compress pdf/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();
  // Health: this is the stranded path — nothing for the repack to remove.
  await expect(
    page.getByRole("heading", { name: "This PDF is already lean" }),
  ).toBeVisible({ timeout: 20_000 });
  const stage = page.locator("[data-runner-stage]");
  await expect(stage.getByText("No change", { exact: true })).toBeVisible();

  // The fork: Continue with, carrying the merged file — and not back to
  // the step the job came from.
  const rows = continueRow(page);
  await expect(rows, "the lean result has no Continue with").toBeVisible();
  const links = rows.getByRole("link");
  expect(await links.count()).toBeGreaterThan(0);
  await expect(links.first()).toContainText("carries alpha-merged.pdf");
  await expect(rows.getByRole("link", { name: /merge pdf/i })).toHaveCount(0);
  // The receipt counts the file it carries.
  expect(await receiptCount(page)).toBe(5);

  // And the file as it is, said plainly to be unchanged.
  const download = stage.getByRole("button", { name: /download.*unchanged/i });
  await expect(download, "the lean result offers no download").toBeVisible();
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    download.click(),
  ]);
  expect(saved.suggestedFilename()).toBe("alpha-merged.pdf");
  const pages = await pdfPageTexts(await downloadBytesOf(saved));
  expect(pages).toHaveLength(5);
  expect(pages[0]).toContain("alpha.pdf — page 1");
  expect(pages[3]).toContain("beta.pdf — page 1");
});

/**
 * WHAT A SCREEN READER HEARS OF THE ENDING (2026-10-17), read as the
 * browser computes it (PR #180 review):
 *  - a Continue row was "Continue with Delete Pages In-browsercarries
 *    alpha-merged.pdf" — the " · " between where it runs and what it
 *    carries is drawn aria-hidden, so the two words ran together. The
 *    row's own comment promised "Continue with Compress PDF · In-browser ·
 *    carries merged.pdf"; that is now its name;
 *  - the receipt's count was "5 , re-opened and counted in this browser":
 *    the comma heard after the figure sat in a box of its own.
 */
test("the ending as it is heard: each Continue row by its words with their separators, and the count without a stray space", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mergeAlphaBeta(page);
  const rows = continueRow(page).getByRole("link");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  // Soft: both halves are read and reported, whichever fails.
  for (let i = 0; i < count; i++)
    await expect
      .soft(rows.nth(i))
      .toHaveAccessibleName(
        /^Continue with [^·]+ · [^·]+ · carries alpha-merged\.pdf$/,
      );
  await expect
    .soft(rows.first())
    .toHaveAccessibleName(/^Continue with Compress PDF · /);
  await receiptCount(page);
  const facts = await page.locator("[data-receipt] dl").first().ariaSnapshot();
  expect(facts).toContain(
    "definition: 5, re-opened and counted in this browser",
  );
});

/**
 * WHERE FOCUS GOES WHEN A CONTINUE ROW IS TAKEN BY KEYBOARD (2026-10-17).
 * Enter on a row navigates; the row is gone with its page, and focus fell
 * to <body> (PR #180 review) — a keyboard reader started the next tool
 * from the top of the document. Now, as a replaced file does
 * (`replaceOpenFile`), focus moves to what arrived: the file's header in
 * the new tool, its name and pages.
 */
test("Enter on a Continue row: focus arrives on the carried file's header in the next tool, not on <body>", async ({
  page,
}) => {
  await mergeAlphaBeta(page);
  // To an editor (a single-PDF runner, nothing of its own to focus as it
  // opens — Compress PDF's analysis takes an orphaned focus itself).
  const numbers = continueRow(page).getByRole("link", {
    name: /add page numbers/i,
  });
  await numbers.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tools\/page-numbers$/);
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const a = document.activeElement;
          return a && a !== document.body
            ? `${a.tagName.toLowerCase()}${a.hasAttribute("data-file-header") ? "[data-file-header]" : ""}: ${(a.textContent ?? "").replace(/\s+/g, " ").trim()}`
            : "body";
        }),
      { timeout: 10_000 },
    )
    .toMatch(/\[data-file-header\]: .*alpha-merged\.pdf/);
});

test("a job of three: merge, then page numbers, and the file holds both", async ({
  page,
}) => {
  await mergeAlphaBeta(page);
  await continueRow(page)
    .getByRole("link", { name: /add page numbers/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/page-numbers$/);
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();

  await page.getByRole("button", { name: /^add page numbers$/i }).click();
  await expect(
    page.getByRole("heading", { name: /page numbers added/i }),
  ).toBeVisible();
  expect(await receiptCount(page)).toBe(5);
  // This step is ticked now its result is on screen.
  const rail = page.getByRole("navigation", { name: "Job steps" });
  await expect(rail.getByRole("listitem")).toHaveText([
    "Merge PDF (done)",
    "Add Page Numbers (done)",
  ]);
  // A step the job already took is not offered again.
  const row = continueRow(page);
  await expect(row).toBeVisible();
  await expect(row.getByRole("link", { name: /merge pdf/i })).toHaveCount(0);

  const numbered = await captureDownload(
    page,
    page.getByRole("button", { name: /download numbered pdf/i }),
  );
  const pages = await pdfPageTexts(numbered);
  expect(pages).toHaveLength(5);
  expect(pages[0]).toContain("alpha.pdf — page 1");
  expect(pages[0]).toContain("Page 1 of 5");
  expect(pages[4]).toContain("beta.pdf — page 2");
  expect(pages[4]).toContain("Page 5 of 5");
});

test("Back to adjust returns to Rotate's settings as they were, with the same file", async ({
  page,
}) => {
  const file = await writeTempPdf("spin.pdf", 2);
  await page.goto("/tools/rotate-pdf");
  await uploadFiles(page, file);
  await page.getByRole("button", { name: /^right$/i }).click();
  await page.getByRole("button", { name: /apply rotation/i }).click();
  await expect(page.getByText(/2 pages rotated/)).toBeVisible();

  await page.getByRole("button", { name: "Back to adjust" }).click();
  // Focus is on the run trigger, and the rotation chosen before is still
  // there: Apply is live without touching anything.
  const apply = page.getByRole("button", { name: /apply rotation/i });
  await expect(apply).toBeFocused();
  await expect(apply).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("spin.pdf", { exact: true })).toBeVisible();

  // A second quarter turn on top of the first: the file ends at 180°.
  await page.getByRole("button", { name: /^right$/i }).click();
  await apply.click();
  const rotated = await captureDownload(
    page,
    page.getByRole("button", { name: /download rotated pdf/i }),
  );
  expect(await pdfRotations(rotated)).toEqual([180, 180]);
});

test("CONTROL: a browser that will not store the file is told so, and nothing navigates", async ({
  page,
}) => {
  // Every IndexedDB open fails, as in a browser with site storage blocked:
  // the hand-off cannot be stashed.
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException("blocked for this test", "SecurityError");
    };
  });
  await mergeAlphaBeta(page);
  await continueRow(page)
    .getByRole("link", { name: /compress pdf/i })
    .click();
  const alert = continueRow(page).getByRole("alert");
  await expect(alert).toContainText(
    "Couldn't carry the file — this browser's storage is unavailable. Download it, then open Compress PDF",
  );
  await expect(
    alert.getByRole("link", { name: "Compress PDF" }),
  ).toHaveAttribute("href", "/tools/compress-pdf");
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
});

test("a password-protected PDF in Rotate offers Unlock PDF once, and says which password — G.7 row 4, its first half", async ({
  page,
}) => {
  // G.7 "Encrypted PDF in Rotate", its first half. WAS a dead end. Now:
  // pick, then the remedy's link — two actions to the tool that fixes the
  // file. The rest of the row (Unlock receiving the file as a remedy, then
  // "Continue with Rotate PDF") needs a worker, so it is counted against a
  // mocked one in e2e/worker-panels.spec.ts (WP-10): five actions in all.
  let actions = 0;
  await page.goto("/tools/rotate-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "locked.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(USER_PASSWORD_PDF_BASE64, "base64"),
  });
  actions++;
  // Not the router's own (empty) announcer, which is an alert too.
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "This PDF is password-protected." });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("link")).toHaveCount(1);
  await expect(alert.getByRole("link")).toHaveText("Open Unlock PDF");
  await expect(alert).toContainText("with the password that opens it.");
  await expect(alert).toContainText(
    "it uploads to the secure worker only when you start it",
  );

  await alert.getByRole("link", { name: "Open Unlock PDF" }).click();
  actions++;
  await expect(page).toHaveURL(/\/tools\/unlock-pdf$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /unlock pdf/i }),
  ).toBeVisible();
  expect(actions).toBe(2);
});

/**
 * G.7 row 2, "Merge 3 PDFs, then compress": WAS six actions and a trip
 * through the downloads folder (merge, download, open Compress PDF, pick the
 * merged file again, compress, download). The target is five, with no file
 * picked twice. COUNTED here, to a file this process opens:
 *
 *   pick the three PDFs (1) → Merge 3 PDFs (2) → Continue with Compress PDF
 *   (3) → Compress images on the worker (4) → Download compressed PDF (5).
 *
 * The files are image-heavy on purpose. A merge's output is written by the
 * same writer Compress PDF's in-browser repack uses, after the same garbage
 * collection, so for a merge the repack is a fixed point: measured
 * 2026-10-10 on the engine, three generated PDFs merged to 1,854 bytes and
 * repacked to 1,854 — with object streams in the inputs and without. A
 * text-only merge is therefore "already lean" in the browser, by
 * construction, and the step that shrinks a merge is the worker's image
 * downsampling. The worker is answered by this process
 * (`mockCompressWorker`): what this proves is the CHAIN — the merge's own
 * bytes, carried without a pick, uploaded as they are, and a smaller file
 * with every page back — not the worker's compression, which its own
 * proofs hold.
 */
test("G.7 row 2: merge 3 PDFs, then compress — five actions, no file picked twice, a smaller file with every page", async ({
  page,
}) => {
  const worker = await mockCompressWorker(page);
  let actions = 0;
  let picks = 0;
  const [a, b, c] = await Promise.all([
    writeImagePdf("alpha.pdf", 2),
    writeImagePdf("beta.pdf", 2),
    writeImagePdf("gamma.pdf", 1),
  ]);
  await page.goto("/tools/merge-pdf");
  await uploadFiles(page, [a, b, c]);
  actions++;
  picks++;
  await expect(page.getByText("gamma.pdf")).toBeVisible();
  await page.getByRole("button", { name: /merge 3 pdfs/i }).click();
  actions++;
  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
  expect(await receiptCount(page)).toBe(5);

  await continueRow(page)
    .getByRole("link", { name: /compress pdf/i })
    .click();
  actions++;
  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();
  // The browser's repack has nothing to take from a merge of pictures.
  await expect(
    page.getByRole("heading", { name: "This PDF is image-heavy" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /compress images on the worker/i })
    .click();
  actions++;
  // What reached the worker is the merge's output, as it was made: its five
  // pages, each file's in order — the file was carried, not picked again.
  await expect.poll(() => worker.uploads.length).toBe(1);
  const merged = worker.uploads[0]!;
  const mergedPages = await pdfPageTexts(merged);
  expect(mergedPages).toHaveLength(5);
  expect(mergedPages[0]).toContain("alpha.pdf — page 1");
  expect(mergedPages[2]).toContain("beta.pdf — page 1");
  expect(mergedPages[4]).toContain("gamma.pdf — page 1");

  const card = page.getByRole("group", { name: /compression finished/i });
  await expect(card).toBeVisible();
  // The card's receipt re-counts the worker's file here, before it is taken.
  const counted = await receiptCount(page, card);
  const compressed = await captureDownload(
    page,
    card.getByRole("button", { name: /download compressed pdf/i }),
  );
  actions++;

  const pages = await pdfPageTexts(compressed);
  expect(pages).toHaveLength(mergedPages.length);
  expect(counted).toBe(pages.length);
  expect(pages[4]).toContain("gamma.pdf — page 1");
  expect(compressed.byteLength).toBeLessThan(merged.byteLength);
  // G.7: five actions, one pick, no trip through the downloads folder.
  expect({ actions, picks }).toEqual({ actions: 5, picks: 1 });
});

/**
 * Holds the result's ending — the script that carries `RESULT_ENDING_CHUNK`,
 * found by its content, not by its hashed name — until `release()`. Every
 * other script passes as it is. Compress PDF fetches the ending the moment
 * a file arrives, so left alone it is here long before the analysis is, and
 * the run's wait for it (`endingReady`) is never used;
 * held, it comes after the analysis is worked out, which is what that wait
 * is for. `held` lists what was held: empty, the instrument saw nothing.
 */
async function holdEnding(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const held: string[] = [];
  await page.route("**/_next/static/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.includes(RESULT_ENDING_CHUNK)) {
      held.push(new URL(route.request().url()).pathname);
      await gate;
    }
    await route.fulfill({ response, body });
  });
  return { held, release };
}

/**
 * Compress PDF after a pick, 1280 x 900, 4x CPU, every shift outside an
 * input's window summed (2026-10-11):
 *
 *   4de768a2, the re-review's run    0.1531  0.0174 "Analyzing…" + 0.1357
 *   4de768a2, this test              0.1357  the About section thrown
 *                                            648 px by the analysis and
 *                                            its ending in one commit
 *   the stage held, this test        0       one shift, in the frame the
 *                                            file arrives
 *   the first screen held            0       no shift: nothing under the
 *                                            runner is on screen
 *
 * A file set through the input the way the system dialog sets it
 * (`setInputFiles` with a path) opens an input window in this Chromium, and
 * the held stage's one shift fell inside it. One set from memory and
 * dispatched by script does not, and then the pick's own shifts count too:
 * 0.1685 at 4de768a2, 0.0587 held — so this ceiling was 0.075 while the
 * stage was held. The first screen held (`data-first-screen`), a pick moves
 * nothing either way, and both ceilings are the page's: FROM THE PICK, the
 * whole path, `PAGE_CLS_CEILING` (and from memory at eight sizes, below);
 * FROM THE ANALYSIS'S FIRST FRAME, its arrival, which is to cost nothing.
 */
const PICK_CLS_CEILING = 0.01;
const ARRIVAL_CLS_CEILING = 0.001;
/** Past a pick's 500 ms input window, with a frame or two to spare. */
const OUTSIDE_THE_PICK = 600;

/**
 * What the page's layout shifts add up to, outside an input's window, from
 * `since` on — EVERY source, named or not: the figure a visit's CLS is made
 * of. `listed` says each one and which named elements it moved.
 */
function shiftSum(shifts: readonly Shift[], since: number) {
  const counted = shifts.filter((s) => !s.input && s.t >= since);
  return {
    sum: counted.reduce((total, s) => total + s.value, 0),
    listed: counted
      .map((s) => `${s.value.toFixed(4)} [${s.hits.join(", ") || "unnamed"}]`)
      .join(" + "),
  };
}

/**
 * The result is drawn WITH its ending, into room on screen. Compress PDF
 * analyses a file the moment it is picked, and on any real connection the
 * analysis is drawn long after the pick's input window has closed, so every
 * shift it causes counts.
 *
 * - At 50b2a243 the receipt and Continue with arrived ~330 ms after the
 *   analysis, pushing the worker card off screen (+0.032; WP-08 review,
 *   2026-10-10).
 * - At 4de768a2 they came in one commit with it, which moved the worker card
 *   no more — and threw the About section under the runner 648 px, 0.1357
 *   on its own: the page's CLS after a pick went UP, 0.1234 -> 0.1531
 *   (WP-08 re-review, 2026-10-11). The guard then counted only shifts that
 *   moved the two elements it named, so the one that grew passed it.
 *
 * So the page is read whole first: the SUM of every layout shift outside
 * an input's window, whatever moved — from the pick, and from the
 * analysis's first frame (`PICK_CLS_CEILING`, `ARRIVAL_CLS_CEILING`). Then
 * the named elements frame by frame, neither of which may move once painted.
 *
 * The ending is held until the analysis is worked out — its completion is
 * recorded (the page's recents) as the work ends, before the wait — so the
 * run's wait for it is what is under test, not a race the early fetch on
 * the file's arrival now always wins (`holdEnding`). And no sooner than
 * `OUTSIDE_THE_PICK` after the pick: a pick opens an input window, and a
 * result drawn inside it has every shift it causes forgiven — the sums would
 * pass whatever it moved. On the re-review's slow network it was drawn 8.4 s
 * after the pick; held here, it is drawn after the window has closed, as on
 * any connection slower than this machine's loopback.
 *
 * Mutation-checked on the production build, 2026-10-11. The stage not held
 * (`stageHoldPx` in the Compress runner): "CLS after the pick: 0.1357",
 * and the same from the analysis's first frame. The run's wait for its
 * ending removed (`endingReady` in the runner kit): "CLS from the
 * analysis's first frame: 0.0325 [worker]" — the ending drawn into the
 * analysis after it painted, the WP-08 review's own +0.032, back. And the
 * first screen's reservation removed from the page (the same day, the
 * stage hold already gone): "CLS after the pick: 0.1310 [unnamed]", 4 of 4
 * alone — but GREEN once in a 252-test run under twelve workers. This test
 * leans on a path pick's input window and a release timed against it, so
 * load can move what it reads; the from-memory guards below at eight
 * sizes lean on neither, and were red at all eight on that build.
 */
test("Compress PDF's analysis draws with its ending, and after a pick nothing on the page moves", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tools/compress-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  const ending = await holdEnding(page);
  await throttle(page, { cpu: 4, latencyMs: 300, kbps: 200 });
  await startFrames(page, {
    tops: {
      download: {
        selector: "[data-tool-panel] button",
        text: "Download optimized PDF",
      },
      // The worker's card, by its title — its top, not the title's: the
      // card's own badge arrives with the worker's status and nudges the
      // title inside it, which is the card, not this package.
      worker: {
        selector: "[data-tool-panel] span",
        text: "Deep image compression (secure",
        closest: "div.bg-panel",
      },
    },
    present: {
      analysis: '[aria-label^="Analysis complete"]',
      receipt: "[data-receipt]",
      counted: '[data-receipt] [data-settles="counted"]',
    },
  });
  const ownAt = await shiftOfOurOwn(page);
  const pickedAt = await page.evaluate(() => performance.now());
  // A file the repack shrinks a little: the Download and the receipt show.
  await input.setInputFiles(await writeTempPdf("report.pdf", 6));
  // Worked out: the run's completion is recorded as its work ends.
  await page.waitForFunction(
    ([key, slug]) => (localStorage.getItem(key) ?? "").includes(`"${slug}"`),
    [RECENTS_STORAGE_KEY, "compress-pdf"] as const,
    { polling: "raf", timeout: 20_000 },
  );
  const early = pickedAt + OUTSIDE_THE_PICK;
  await page.waitForFunction((t) => performance.now() >= t, early, {
    polling: "raf",
  });
  const releasedAt = await page.evaluate(() => performance.now());
  ending.release();
  await expect(
    page.locator('[data-receipt] [data-settles="counted"]'),
  ).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const shifts = await recordedShifts(page);
  const frames = await stopFrames(page);

  // Health: the ending was seen and held, the browser reported the page's
  // shifts at all, and the analysis painted. WAS "the pick moves what is
  // under the runner" (`shifts.length > 0`): with the first screen held
  // the pick moves nothing, so the instrument's own shift is the proof it
  // is listening (`shiftOfOurOwn`).
  expect(ending.held, "the ending's chunk was never seen").not.toEqual([]);
  expect(
    shiftsBetween(shifts, ownAt, pickedAt).length,
    "the instrument saw no shift of its own making",
  ).toBeGreaterThan(0);
  const painted = frames.findIndex((f) => f.present.analysis);
  expect(painted, "the analysis never painted").toBeGreaterThanOrEqual(0);

  // THE PAGE: everything that moved outside an input's window, whatever it
  // was — after the pick, and after the analysis's first frame.
  const fromPick = shiftSum(shifts, pickedAt);
  expect(
    fromPick.sum,
    `CLS after the pick: ${fromPick.listed}`,
  ).toBeLessThanOrEqual(PICK_CLS_CEILING);
  const fromArrival = shiftSum(shifts, frames[painted]!.t);
  expect(
    fromArrival.sum,
    `CLS from the analysis's first frame: ${fromArrival.listed}`,
  ).toBeLessThanOrEqual(ARRIVAL_CLS_CEILING);

  for (const name of ["download", "worker"]) {
    const { first, tops } = positionsFrom(frames, name);
    expect(first, `${name} appeared before the analysis`).toBe(painted);
    expect(
      new Set(tops),
      `${name} moved after it was painted: ${tops.join(" → ")}`,
    ).toEqual(new Set([tops[0]]));
  }
  // Drawn in one frame with its receipt — not into it later — and after
  // the ending came: the wait was used. So drawn after the pick's input
  // window had closed, where the sums above see what it moved. (Checked
  // after them, not before: a run that does not wait draws its analysis
  // inside the window, and is named by the sum its late ending fails —
  // mutation-checked, 2026-10-11.)
  expect(frames[painted]!.present.receipt).toBe(true);
  expect(frames[painted]!.t).toBeGreaterThan(releasedAt);
  expect(frames[painted]!.t - pickedAt).toBeGreaterThan(500);
  expect(frames.at(-1)!.present.counted).toBe(true);
});

/**
 * The screens the page's CLS after a pick is held at: two phones, a tablet,
 * and the desktops from the shortest to the tallest the review measured.
 */
const SCREENS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 720 },
  { width: 1280, height: 900 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;
type Screen = (typeof SCREENS)[number];

/** Google's line for a "good" CLS is 0.1; this page is held to a tenth of it. */
const PAGE_CLS_CEILING = 0.01;

/**
 * A layout shift the test makes itself, before the file arrives: a fixed
 * box with words in it, moved down a quarter of the screen by script. Seen
 * in the record (`shiftsBetween`), it proves the browser is reporting this
 * page's shifts at this size at all — a sum of nothing is the strongest
 * possible pass, and a dead observer would read 0 at every screen.
 * Returns when it was made.
 */
async function shiftOfOurOwn(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const box = document.createElement("div");
        box.textContent = "instrument check";
        box.style.cssText =
          "position:fixed;left:0;top:0;width:40vw;height:20vh;z-index:9999;background:Canvas;color:CanvasText";
        document.body.append(box);
        const at = performance.now();
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        void frame()
          .then(frame)
          .then(() => {
            box.style.top = "25vh";
          })
          .then(frame)
          .then(frame)
          .then(() => {
            box.remove();
            resolve(at);
          });
      }),
  );
}

/** Every shift outside an input's window in [from, to). */
function shiftsBetween(shifts: readonly Shift[], from: number, to: number) {
  return shifts.filter((s) => !s.input && s.t >= from && s.t < to);
}

/**
 * A file set on the page's picker FROM MEMORY: built in the page and
 * dispatched by script, the way a drop, a paste or a hand-off delivers one.
 * Unlike a file the system dialog sets, it opens no input window, so every
 * shift it causes is counted — the worst case for a pick (WP-08 repair,
 * 2026-10-11).
 */
async function pickFromMemory(page: Page, name: string, bytes: Uint8Array) {
  await fileInput(page).evaluate(
    (input, { name, b64 }) => {
      const bin = atob(b64);
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([data], name, { type: "application/pdf" }));
      (input as HTMLInputElement).files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { name, b64: Buffer.from(bytes).toString("base64") },
  );
}

/** A stylesheet in every document of the page, proven landed by the caller. */
async function injectStyle(page: Page, css: string) {
  await page.addInitScript((text) => {
    const add = () => {
      const style = document.createElement("style");
      style.dataset.probe = "";
      style.textContent = text;
      document.head.append(style);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  }, css);
}

/**
 * What the CONTROLS take away: the first screen's reservation — the tool's
 * name, its facts and its panel held to the bottom of the screen from the
 * first paint, so nothing that follows the runner is on screen to be moved.
 */
const UNRESERVED = "[data-first-screen]{min-height:0 !important}";

/** Health of a control: the reservation exists, and the injection took it away. */
async function reservationRemoved(page: Page) {
  await expect(page.locator("style[data-probe]")).toHaveCount(1);
  const first = page.locator("[data-first-screen]");
  await expect(
    first,
    "no first screen to take the reservation from",
  ).toHaveCount(1);
  expect(
    await first.evaluate((el) => getComputedStyle(el).minHeight),
    "the control's stylesheet did not take the reservation away",
  ).toBe("0px");
}

/** The section after the runner: About this tool, by its heading. */
const ABOUT = {
  selector: "main h2",
  text: "About this tool",
  closest: "div.grid",
} as const;

/** Where the About section's top was, against the bottom of the screen. */
const aboutTop = (page: Page) =>
  page.locator("main h2", { hasText: "About this tool" }).evaluate((h2) => {
    const grid = h2.closest("div.grid") ?? h2;
    return {
      top: Math.round(grid.getBoundingClientRect().top),
      fold: window.innerHeight,
    };
  });

/**
 * Compress PDF after a pick, as the WP-08 repair measured it: the
 * production build, 4x CPU, 300 ms and 200 KB/s, a 6-page PDF set from
 * memory, and everything that moved outside an input's window from the pick
 * until the receipt has counted and the worker's card has answered.
 */
async function compressAfterPick(page: Page, screen: Screen) {
  await page.setViewportSize(screen);
  await page.goto("/tools/compress-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await page.evaluate(() => document.fonts.ready);
  await throttle(page, { cpu: 4, latencyMs: 300, kbps: 200 });
  await startFrames(page, {
    tops: { about: ABOUT },
    present: {
      analysis: '[aria-label^="Analysis complete"]',
      counted: '[data-receipt] [data-settles="counted"]',
    },
  });
  const before = await aboutTop(page);
  const ownAt = await shiftOfOurOwn(page);
  const pickedAt = await page.evaluate(() => performance.now());
  await pickFromMemory(page, "report.pdf", await makePdfBytes("report.pdf", 6));
  await expect(
    page.locator('[data-receipt] [data-settles="counted"]'),
  ).toBeVisible({ timeout: 30_000 });
  // The worker's card answers after the analysis on a slow line; its answer
  // is part of what a visit pays.
  await expect(
    page.getByText("Checking whether a secure worker is available…"),
  ).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(500);
  const shifts = await recordedShifts(page);
  const frames = await stopFrames(page);
  const counted = shiftsBetween(shifts, pickedAt, Infinity);
  return {
    before,
    own: shiftsBetween(shifts, ownAt, pickedAt),
    cls: counted.reduce((sum, s) => sum + s.value, 0),
    listed:
      counted
        .map(
          (s) =>
            `${s.value.toFixed(4)} @${Math.round(s.t - pickedAt)}ms [${s.hits.join(", ")} :: ${s.sources.join(" | ")}]`,
        )
        .join(" + ") || "none",
    frames,
  };
}

/**
 * THE PAGE AFTER A PICK, AT EVERY SCREEN (2026-10-11). The held stage
 * (`stageHoldPx`, a cap fitted to the analysis's copy) moved the content
 * under the runner once, at the pick — and a pick from memory opens no
 * input window, so that move was counted. Measured on 06ecd2da, this
 * function at each screen:
 *
 *   360 x 800 0.0321    390 x 844 0.0613    768 x 1024 0.1212 (over 0.1)
 *   1280 x 720 0.0121   1280 x 900 0.0567   1366 x 768 0.0211
 *   1920 x 1080 0.0557  2560 x 1440 0.0530
 *
 * every one of them the About section, which sat on screen under the drop
 * sheet at all eight. The bound is the property, at every screen: a tenth
 * of Google's "good" line, whatever moved. With the first screen held
 * (`data-first-screen`), 0 at all eight.
 *
 * Mutation-checked on the build (2026-10-11): the first screen's
 * min-height taken out of the page, all eight red — 0.1944, 0.2684,
 * 0.2553, 0.0656, 0.1638, 0.0845, 0.1019, 0.0779, the About section moved
 * three or four times (by "Reading…", "Analyzing…" and the analysis). The
 * controls below do the same through a stylesheet, on every run.
 */
for (const screen of SCREENS) {
  test(`Compress PDF at ${screen.width} x ${screen.height}: from a pick from memory to the counted receipt, page CLS ≤ ${PAGE_CLS_CEILING}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const m = await compressAfterPick(page, screen);
    // Health: the browser reported a shift we made, at this size; the
    // analysis painted; the receipt counted.
    expect(
      m.own.length,
      "the instrument saw no shift of its own making",
    ).toBeGreaterThan(0);
    expect(m.frames.some((f) => f.present.analysis)).toBe(true);
    expect(m.frames.at(-1)!.present.counted).toBe(true);
    expect(
      m.cls,
      `CLS after the pick at ${screen.width} x ${screen.height}: ${m.listed} (About at ${m.before.top} on a ${m.before.fold} px screen)`,
    ).toBeLessThanOrEqual(PAGE_CLS_CEILING);
  });
}

/**
 * POSITIVE CONTROL, through the same measurement: the reservation taken
 * away, the About section is on screen under the runner and the pick moves
 * it — at the two screens where it cost the most.
 */
for (const screen of [
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
] as const) {
  test(`CONTROL: Compress PDF at ${screen.width} x ${screen.height}, the first screen unreserved — the bound sees the About section move`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await injectStyle(page, UNRESERVED);
    const m = await compressAfterPick(page, screen);
    await reservationRemoved(page);
    expect(m.before.top, "the About section was not on screen").toBeLessThan(
      m.before.fold,
    );
    expect(m.cls, m.listed).toBeGreaterThan(PAGE_CLS_CEILING);
    expect(m.listed).toContain("about");
  });
}

/**
 * THE SAME SHIFT ON EVERY TOOL WITH AN ENDING. Derived, never listed: every
 * tool the registry dispatches to an in-browser runner
 * (`supportedToolSlugs`, what `/tools/[slug]` calls `getRunnerKind`
 * against), each driven to its result by its own proof case
 * (`./client-proof/cases`) — and each held, AT THE POINT OF CONSUMPTION, to
 * having drawn the ending this is about: a result whose receipt is on the
 * page (`[data-receipt]`).
 *
 * The ending's chunk arrives `ENDING_LATE_MS` after it is asked for, so the
 * result is drawn after the Run press's input window has closed, as on any
 * connection slower than loopback: on loopback it is drawn inside it, and
 * every shift it causes is forgiven.
 *
 * Each run is read in two parts, split at the reader's last Run press:
 *
 *  - FROM THE PRESS TO THE ENDING: everything that moved, whatever it was.
 *    The reader is wherever the case's own steps left the page — a tall
 *    editor is scrolled to reach Run, and then what follows the runner IS
 *    on screen. Measured on the first-screen build before the stage was
 *    held from the press (`./stage-hold`): Sign PDF 0.2765 at 1280 x 720,
 *    Edit PDF 0.8974 at 390 x 844 (a tall editor replaced by a short
 *    result: the About section thrown up the screen); Merge PDF 0.1221 at
 *    390 x 844 (a short editor, a taller result: About pushed down) — 103 of
 *    240 over the bound, every one of them a run read while scrolled.
 *  - FROM THE PICK TO THE PRESS: the shifts that moved the About section —
 *    the runner moving what follows it, which the first screen holds still.
 *    What moved INSIDE an editor as it opened (its file rows filling in, a
 *    page drawn) moved nothing outside the runner, is not this shift, and
 *    is reported in the test's annotations rather than held here.
 *
 * Mutation-checked on the build (2026-10-11): `holdRunnerStage` returning
 * at once — 96 of the 240 red, every one on the Run press's part; the
 * first screen's min-height taken out of the page — 216 red, 208 of them
 * on the pick's part.
 */
const ENDING_LATE_MS = 700;
const ENDING_SET = [...supportedToolSlugs].sort();

async function lateEnding(page: Page) {
  const late: string[] = [];
  await page.route("**/_next/static/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.includes(RESULT_ENDING_CHUNK)) {
      late.push(new URL(route.request().url()).pathname);
      await new Promise((resolve) => setTimeout(resolve, ENDING_LATE_MS));
    }
    await route.fulfill({ response, body });
  });
  return late;
}

interface RunWatch {
  /** Each press of a live Run button: when, and how far down the page. */
  runs: { t: number; y: number }[];
  /** Each height the page held the runner's stage at, and what it computed to. */
  holds: { inline: string; computed: string }[];
}

async function runToEnding(page: Page, slug: string, screen: Screen) {
  await page.setViewportSize(screen);
  const late = await lateEnding(page);
  await page.goto(`/tools/${slug}`);
  await waitForHydration(fileInput(page));
  await page.evaluate(() => document.fonts.ready);
  await startFrames(page, {
    tops: { about: ABOUT },
    present: { receipt: "[data-receipt]" },
  });
  const before = await aboutTop(page);
  await page.evaluate(() => {
    const w = window as unknown as { __watch: RunWatch };
    w.__watch = { runs: [], holds: [] };
    document.addEventListener(
      "click",
      (event) => {
        const trigger = (event.target as Element | null)?.closest?.(
          "[data-run-trigger]",
        );
        if (trigger && trigger.getAttribute("aria-disabled") !== "true")
          w.__watch.runs.push({ t: performance.now(), y: Math.round(scrollY) });
      },
      true,
    );
    const stage = document.querySelector<HTMLElement>("[data-runner-stage]");
    if (stage)
      new MutationObserver(() => {
        if (stage.style.minHeight)
          w.__watch.holds.push({
            inline: stage.style.minHeight,
            computed: getComputedStyle(stage).minHeight,
          });
      }).observe(stage, { attributes: true, attributeFilter: ["style"] });
  });
  const ownAt = await shiftOfOurOwn(page);
  const startedAt = await page.evaluate(() => performance.now());
  await CASES[slug]!.run({ page, data: {} });
  await page.waitForTimeout(300);
  const shifts = await recordedShifts(page);
  const frames = await stopFrames(page);
  const watch = await page.evaluate(
    () => (window as unknown as { __watch: RunWatch }).__watch,
  );
  // Compress PDF has no Run press: its run starts with its file.
  const ranAt = watch.runs.at(-1)?.t ?? startedAt;
  const sum = (list: readonly Shift[]) =>
    list.reduce((total, s) => total + s.value, 0);
  const describe = (list: readonly Shift[]) =>
    list
      .map(
        (s) =>
          `${s.value.toFixed(4)} @${Math.round(s.t - startedAt)}ms [${s.hits.join(", ") || s.sources.join(" | ")}]`,
      )
      .join(" + ") || "none";
  const picking = shiftsBetween(shifts, startedAt, ranAt);
  const pickAbout = picking.filter((s) => s.hits.includes("about"));
  const running = shiftsBetween(shifts, ranAt, Infinity);
  return {
    late,
    before,
    watch,
    scrolled: watch.runs.at(-1)?.y ?? 0,
    own: shiftsBetween(shifts, ownAt, startedAt),
    running: sum(running),
    runListed: describe(running),
    pickAbout: sum(pickAbout),
    pickAboutListed: describe(pickAbout),
    pickInside: sum(picking.filter((s) => !s.hits.includes("about"))),
    pickListed: describe(picking),
    frames,
  };
}

test("health: the set of tools with an ending is the registry's, every one has a case, and it is not implausibly small", () => {
  expect(ENDING_SET.length).toBeGreaterThanOrEqual(25);
  expect(ENDING_SET.filter((slug) => !(slug in CASES))).toEqual([]);
});

for (const slug of ENDING_SET) {
  for (const screen of SCREENS) {
    test(`${slug} at ${screen.width} x ${screen.height}: from Run to its ending page CLS ≤ ${PAGE_CLS_CEILING}, and the pick moves nothing after the runner`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      const m = await runToEnding(page, slug, screen);
      testInfo.annotations.push({
        type: "inside the editor as it opened",
        description: `${m.pickInside.toFixed(4)}: ${m.pickListed}`,
      });
      // Health: our own shift was seen, the ending's chunk was the one
      // held back, and the result drew its ending — the receipt.
      expect(
        m.own.length,
        "the instrument saw no shift of its own making",
      ).toBeGreaterThan(0);
      expect(m.late, "the ending's chunk was never asked for").not.toEqual([]);
      expect(
        m.frames.some((f) => f.present.receipt),
        `${slug} drew no receipt: not a tool with an ending`,
      ).toBe(true);
      expect(
        m.running,
        `CLS from the Run press to ${slug}'s ending at ${screen.width} x ${screen.height}, scrolled ${m.scrolled} px: ${m.runListed}`,
      ).toBeLessThanOrEqual(PAGE_CLS_CEILING);
      expect(
        m.pickAbout,
        `CLS from the pick to the Run press that moved what follows ${slug}'s runner at ${screen.width} x ${screen.height}: ${m.pickAboutListed} (About at ${m.before.top} on a ${m.before.fold} px screen)`,
      ).toBeLessThanOrEqual(PAGE_CLS_CEILING);
    });
  }
}

/**
 * POSITIVE CONTROLS, through the same measurement, each taking one
 * mechanism away: the stage's hold from the Run press, where a scrolled
 * reader's result moved the most; and the first screen, where a pick moved
 * the About section.
 */
test("CONTROL: Sign PDF at 1280 x 720, the stage not held from the press — the bound sees the result move what is on screen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await injectStyle(page, "[data-runner-stage]{min-height:0 !important}");
  const m = await runToEnding(page, "sign-pdf", { width: 1280, height: 720 });
  await expect(page.locator("style[data-probe]")).toHaveCount(1);
  // Health: the page did hold the stage, and the control took it away.
  expect(m.watch.holds, "the page never held the stage").not.toEqual([]);
  expect(new Set(m.watch.holds.map((h) => h.computed))).toEqual(
    new Set(["0px"]),
  );
  expect(m.scrolled, "the run was not read scrolled").toBeGreaterThan(0);
  expect(m.running, m.runListed).toBeGreaterThan(PAGE_CLS_CEILING);
});

test("CONTROL: Merge PDF at 1280 x 900, the first screen unreserved — the bound sees the pick move what follows the runner", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await injectStyle(page, UNRESERVED);
  const m = await runToEnding(page, "merge-pdf", {
    width: 1280,
    height: 900,
  });
  await reservationRemoved(page);
  expect(m.before.top, "the About section was not on screen").toBeLessThan(
    m.before.fold,
  );
  expect(m.pickAbout, m.pickListed).toBeGreaterThan(PAGE_CLS_CEILING);
});

/**
 * A PDF Compress PDF's repack cannot shrink: already written the way the
 * repack writes (object streams, the site's producer), so the analysis says
 * "already lean" and has nothing smaller to offer — the shortest analysis
 * there is. Since 2026-10-17 it still ends: the file unchanged to download,
 * its receipt and Continue with (the lean-merge test above).
 */
async function writeLeanPdf(name: string): Promise<string> {
  const doc = await PDFDocument.load(await makePdfBytes(name, 2));
  doc.setProducer("pdf.xyz");
  doc.setCreator("pdf.xyz");
  const dir = mkdtempSync(join(tmpdir(), "pdfxyz-e2e-"));
  const path = join(dir, name);
  writeFileSync(path, await doc.save({ useObjectStreams: true }));
  return path;
}

/**
 * INVERTED 2026-10-11 — this was "the shortest analysis fills the stage
 * held for it: no blank band under a result", and its history is kept:
 *
 *   The stage is held no taller than what is drawn in it (`STAGE_HOLD_REM`):
 *   the shortest analysis — nothing to download, the worker's card still
 *   asking, the widest layout, one line to a sentence — fills it, so a held
 *   stage never shows as a blank band under a result. Mutation-checked: at
 *   30 rem, "a 480 px stage left 18 px blank under its analysis". And caught
 *   for real on the merge of main: #178 shortened the worker card's
 *   sentence by a line at this width, and this read "a 448 px stage left
 *   8.75 px blank under its analysis" while every other guard stayed green.
 *   Its other side was the arrival test above: the cap lowered to 27 rem put
 *   the top of the About grid on screen under the held stage. Between the
 *   two, 439 px — a constant fitted to copy on both sides.
 *
 * The hold is gone (the history is in the Compress runner, above
 * `CompressSingle`): sized at the pick, it moved the About section at the
 * pick, where a file dropped or handed over opens no input window. The page
 * holds the first screen instead (`data-first-screen`), and the stage grows
 * into it. So the shortest analysis draws from the stage's top, and what is
 * under it on screen is the panel's own surface, to the panel's edge at the
 * bottom of the screen — with the About section below the screen, where no
 * line gained or lost in the analysis can bring it into view, because
 * nothing is fitted to the analysis any more. What this reads: the stage is
 * not held by script, it fills the panel, the panel ends at the bottom of
 * the screen, and nothing follows the runner on it.
 */
test("the shortest analysis: an unheld stage fills the panel to the bottom of the screen, and nothing follows the runner on screen", async ({
  page,
}) => {
  // 1280 wide, where the shortest analysis was measured: 439.25 px on
  // Windows, then 756 px once it carried its ending (2026-10-17: the
  // unchanged download, the receipt and Continue with — at 1080 tall it
  // read "lastBottom 1157.75" against a stage ending at 1052, longer than
  // the room). 1440 tall, so the room under the stage (about 1,010 px)
  // clears it with ~250 px to spare on both platforms — Linux Chromium sets
  // text taller, which both lengthens the analysis and moves the stage down.
  await page.setViewportSize({ width: 1280, height: 1440 });
  // Never answered: the worker's card stays at its shortest, "Checking…".
  await page.route("**/api/worker/status", () => {});
  await page.goto("/tools/compress-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(await writeLeanPdf("lean.pdf"));
  await expect(
    page.getByRole("heading", { name: "This PDF is already lean" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: /download optimized pdf/i }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Checking whether a secure worker is available…"),
  ).toBeVisible();

  const stageBox = page.locator("[data-compress-stage]");
  await expect(stageBox, "the file's stage is not drawn").toHaveCount(1);
  const m = await stageBox.evaluate((el) => {
    const last = [...el.querySelectorAll("button")].at(-1)!;
    const panel = el.closest<HTMLElement>("[data-tool-panel]")!;
    const box = getComputedStyle(panel);
    const pad =
      Number.parseFloat(box.paddingBottom) +
      Number.parseFloat(box.borderBottomWidth);
    const about = [...document.querySelectorAll("main h2")]
      .find((h) => h.textContent === "About this tool")
      ?.closest("div.grid");
    return {
      held: (el as HTMLElement).style.minHeight,
      last: last.textContent,
      lastBottom: last.getBoundingClientRect().bottom,
      stageBottom: el.getBoundingClientRect().bottom,
      panelInner: panel.getBoundingClientRect().bottom - pad,
      panelBottom: panel.getBoundingClientRect().bottom,
      aboutTop: about ? about.getBoundingClientRect().top : null,
      fold: window.innerHeight,
    };
  });
  // For CI's Linux, where text sets taller: what this read, in full.
  console.log(`FIRST_SCREEN shortest-analysis 1280x1440 ${JSON.stringify(m)}`);
  // Health: this is the shortest analysis, and it is shorter than the room
  // — the case where a band of panel shows under it at all.
  expect(m.last).toBe("Analyze another file");
  expect(m.lastBottom).toBeLessThan(m.stageBottom);
  expect(m.aboutTop, "no About section to keep off the screen").not.toBeNull();
  // Not held by script: no height of its own.
  expect(m.held, "the stage was held by script").toBe("");
  // It fills the panel, the panel ends at the bottom of the screen, and
  // the About section starts below it. (A pixel past it, measured: the
  // header's 1 px rule is outside `--sf-header-h`.)
  expect(
    Math.abs(m.panelInner - m.stageBottom),
    `the stage ends ${m.panelInner - m.stageBottom} px short of the panel`,
  ).toBeLessThanOrEqual(0.5);
  expect(
    m.panelBottom,
    `the panel ends at ${m.panelBottom}, short of a ${m.fold} px screen`,
  ).toBeGreaterThanOrEqual(m.fold - 0.5);
  expect(
    m.panelBottom,
    `the panel ends at ${m.panelBottom}, past a ${m.fold} px screen`,
  ).toBeLessThanOrEqual(m.fold + 1.5);
  expect(
    m.aboutTop!,
    `the About section is on screen, at ${m.aboutTop}`,
  ).toBeGreaterThanOrEqual(m.fold);
});

test("unapplied edits are asked about before a header link leaves the page", async ({
  page,
}) => {
  // A Letter page: the editor's default position for new text is inside
  // it (on the small default fixture it would be refused as off the page).
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "revise.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await placeEditorText(page, "E2E-EDIT-MARK");
  const placed = page
    .locator('[data-object-kind="text"] text')
    .filter({ hasText: "E2E-EDIT-MARK" });
  await expect(placed).toBeAttached();

  const header = page.getByRole("navigation", { name: "Primary" }).first();
  const messages: string[] = [];
  page.once("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  await header.getByRole("link", { name: "All tools" }).click();
  await expect
    .poll(() => messages)
    .toEqual([
      "You have unsaved changes: your edits in Edit PDF. Discard them?",
    ]);
  // "Cancel": the page and the edit stay.
  await expect(page).toHaveURL(/\/tools\/edit-pdf$/);
  await expect(placed).toBeAttached();

  // "OK": the link goes where it goes.
  page.once("dialog", (dialog) => void dialog.accept());
  await header.getByRole("link", { name: "All tools" }).click();
  await expect(page).toHaveURL(/\/tools$/);
});
