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
  uploadFiles,
  waitForHydration,
  writeTempPdf,
} from "./helpers";
import {
  captureDownload,
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
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { RESULT_ENDING_CHUNK } from "../src/components/intent/result-ending-chunk";
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
  // G.7 "Encrypted PDF in Rotate": counted as far as it goes before WP-10.
  // WAS a dead end. Now: pick, then the remedy's link — two actions to the
  // tool that fixes the file. The rest of the row (Unlock receiving the file
  // as a remedy, then "Continue with Rotate PDF") needs the worker's stage
  // mode and is WP-10's, counted in this file with a mocked worker then.
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
 *
 * A file set through the input the way the system dialog sets it
 * (`setInputFiles` with a path) opens an input window in this Chromium, and
 * the held stage's one shift falls inside it. One set from memory and
 * dispatched by script does not, and then the pick's own shifts count too:
 * 0.1685 at 4de768a2, 0.0587 held. So two ceilings: FROM THE PICK, the
 * whole path, under 0.1 either way; FROM THE ANALYSIS'S FIRST FRAME, its
 * arrival, which is to cost nothing.
 */
const PICK_CLS_CEILING = 0.075;
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
 * The result is drawn WITH its ending, into space held for it. Compress PDF
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
 * analysis after it painted, the WP-08 review's own +0.032, back.
 */
test("Compress PDF's analysis draws with its ending into space held for it: after a pick the page moves once", async ({
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
  // shifts at all (the pick moves what is under the runner), and the
  // analysis painted.
  expect(ending.held, "the ending's chunk was never seen").not.toEqual([]);
  expect(shifts.length).toBeGreaterThan(0);
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
 * A PDF Compress PDF's repack cannot shrink: already written the way the
 * repack writes (object streams, the site's producer), so the analysis says
 * "already lean" and offers no download — the shortest analysis there is.
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
 * The stage is held no taller than what is drawn in it (`STAGE_HOLD_REM`):
 * the shortest analysis — nothing to download, the worker's card still
 * asking, the widest layout, one line to a sentence — fills it, so a held
 * stage never shows as a blank band under a result. At 1280 x 900 the room
 * left on the screen (499 px) is more than the cap, so it is the cap that
 * is held, and the cap that this reads. Mutation-checked: at 30 rem, "a 480
 * px stage left 18 px blank under its analysis".
 */
test("the shortest analysis fills the stage held for it: no blank band under a result", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
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
  const stage = await stageBox.evaluate((el) => {
    const last = [...el.querySelectorAll("button")].at(-1)!;
    return {
      held: Number.parseFloat((el as HTMLElement).style.minHeight) || 0,
      blank:
        el.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom,
      last: last.textContent,
    };
  });
  // Health: the stage was held, at the cap (the screen had room for more).
  expect(stage.last).toBe("Analyze another file");
  expect(stage.held).toBeGreaterThan(0);
  expect(stage.held).toBeLessThan(900 - 401);
  expect(
    stage.blank,
    `a ${stage.held} px stage left ${stage.blank} px blank under its analysis`,
  ).toBeLessThanOrEqual(0.5);
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
  await page.getByLabel("Text", { exact: true }).fill("E2E-EDIT-MARK");
  await page.getByRole("button", { name: /add to page/i }).click();
  await expect(page.getByRole("list", { name: "Placed edits" })).toBeVisible();

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
  await expect(page.getByRole("list", { name: "Placed edits" })).toBeVisible();

  // "OK": the link goes where it goes.
  page.once("dialog", (dialog) => void dialog.accept());
  await header.getByRole("link", { name: "All tools" }).click();
  await expect(page).toHaveURL(/\/tools$/);
});
