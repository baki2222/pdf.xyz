import { test, expect, type Page } from "@playwright/test";
import { captureDownload, pdfPageCount } from "./client-proof/artifacts";
import {
  attachConsoleGuard,
  makePdfBytes,
  uploadFiles,
  waitForHydration,
  writeTempPdf,
} from "./helpers";
import { USER_PASSWORD_PDF_BASE64 } from "../src/tests/fixtures-encrypted";

/**
 * The home page is a desk: a file dropped or picked there is measured in this
 * tab, the ticket says what it found, and one press opens the tool that fits
 * with the file already in it (redesign WP-05).
 *
 * WHAT WAS THERE BEFORE: the drop zone already carried files (WP-04 —
 * `upload-zone.tsx` kept the `File`s and `staged-file-actions.tsx` handed
 * them off), so "the files are dropped" is NOT the defect these tests fail
 * on (addendum WP-05 #8). What the home page could not do was say what it
 * found: no file was measured there, no evidence line counted the pages, and
 * the offers were buttons with no address — a modifier-click or a page
 * without JavaScript went nowhere. The first test fails on exactly those:
 * the ticket's "2 PDFs · 3 pages", and a LINK named for what it carries.
 *
 * Fixtures are generated per run (pdf-lib), never committed.
 */

/**
 * Every request the page makes while the desk works, so the privacy claim
 * ("checked in this tab") is read off the wire: nothing to `/api/*`, nothing
 * to another origin, and no request carrying a body over 1 KB — a file's
 * bytes cannot leave without one of the three.
 */
function watchRequests(page: Page) {
  const seen: { url: string; method: string; body: number }[] = [];
  page.on("request", (request) => {
    seen.push({
      url: request.url(),
      method: request.method(),
      body: request.postDataBuffer()?.length ?? 0,
    });
  });
  return {
    count: () => seen.length,
    offences(origin: string, from = 0) {
      return seen
        .slice(from)
        .filter(({ url, body }) => {
          if (url.startsWith("data:") || url.startsWith("blob:")) return false;
          const u = new URL(url);
          return (
            u.origin !== origin || u.pathname.startsWith("/api/") || body > 1024
          );
        })
        .map(({ url, method, body }) => `${method} ${url} (${body} B)`);
    },
  };
}

/** The ticket, once the desk has swapped to it. */
const ticketOf = (page: Page) =>
  page.getByRole("region", { name: "What you can do with these files" });

/** A file the desk receives by a real drop event, not the picker. */
async function dropOnDesk(
  page: Page,
  files: { name: string; type: string; bytes: Uint8Array }[],
) {
  const desk = page.locator("[data-desk]");
  await waitForHydration(desk);
  const dataTransfer = await page.evaluateHandle(
    (list) => {
      const dt = new DataTransfer();
      for (const { name, type, b64 } of list) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], name, { type }));
      }
      return dt;
    },
    files.map((f) => ({
      name: f.name,
      type: f.type,
      b64: Buffer.from(f.bytes).toString("base64"),
    })),
  );
  await desk.dispatchEvent("dragenter", { dataTransfer });
  await desk.dispatchEvent("dragover", { dataTransfer });
  await desk.dispatchEvent("drop", { dataTransfer });
}

test("two PDFs on the desk: the ticket counts them, Merge PDF opens with both, and the merge has every page", async ({
  page,
  baseURL,
}) => {
  const guard = attachConsoleGuard(page);
  const net = watchRequests(page);
  // G.7, "Home: merge two PDFs": the actions a person takes, counted.
  let actions = 0;
  let picks = 0;

  await page.goto("/");
  const from = net.count();
  await uploadFiles(page, [
    await writeTempPdf("first.pdf", 1),
    await writeTempPdf("second.pdf", 2),
  ]);
  actions++;
  picks++;

  const ticket = ticketOf(page);
  await expect(ticket).toBeVisible();
  // What this tab measured, as the ticket states it.
  await expect(ticket).toContainText(/2 PDFs\s·\s3 pages/);
  // The offer is a LINK to the tool, named for what it carries.
  const merge = ticket.getByRole("link", {
    name: /^Open Merge PDF with 2 files$/,
  });
  await expect(merge).toHaveAttribute("href", "/tools/merge-pdf");

  // Nothing left the tab while it measured and ranked.
  expect(net.offences(new URL(baseURL!).origin, from)).toEqual([]);

  await merge.click();
  actions++;
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  await expect(page.getByText("first.pdf")).toBeVisible();
  await expect(page.getByText("second.pdf")).toBeVisible();
  await expect(page.getByText(/loaded 2 files you added/i)).toBeVisible();
  await expect(page.getByText(/from your workspace/i)).toHaveCount(0);

  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  actions++;
  const merged = await captureDownload(
    page,
    page.getByRole("button", { name: /download merged pdf/i }),
  );
  actions++;
  expect(await pdfPageCount(merged)).toBe(3);

  // Pick, open, merge, download: no second pick, no trip through a folder.
  expect({ actions, picks }).toEqual({ actions: 4, picks: 1 });

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("a file dropped on the desk is received the same way as one picked", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/");
  await dropOnDesk(page, [
    {
      name: "dropped.pdf",
      type: "application/pdf",
      bytes: await makePdfBytes("dropped.pdf", 2),
    },
  ]);
  const ticket = ticketOf(page);
  await expect(ticket).toContainText(/1 PDF\s·\s2 pages/);
  await expect(ticket.getByText("dropped.pdf")).toBeVisible();

  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("Open in workspace carries the desk's files there", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/");
  await uploadFiles(page, [
    await writeTempPdf("one.pdf", 1),
    await writeTempPdf("two.pdf", 3),
  ]);
  await ticketOf(page)
    .getByRole("button", { name: /open in workspace/i })
    .click();
  await expect(page).toHaveURL(/\/workspace$/);
  const staged = page.getByRole("list", { name: /staged files/i });
  await expect(staged.getByText("one.pdf")).toBeVisible();
  await expect(staged.getByText("two.pdf")).toBeVisible();
  await expect(page.getByText(/loaded 2 files you added/i)).toBeVisible();

  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("a PDF that needs a password: Unlock PDF comes first, and says why", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/");
  await dropOnDesk(page, [
    {
      name: "locked.pdf",
      type: "application/pdf",
      bytes: Uint8Array.from(Buffer.from(USER_PASSWORD_PDF_BASE64, "base64")),
    },
  ]);
  const ticket = ticketOf(page);
  const first = ticket.getByRole("listitem").first().getByRole("link");
  await expect(first).toHaveAccessibleName(/^Open Unlock PDF/);
  await expect(ticket).toContainText(/locked\.pdf needs a password to open/);

  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("a HEIC photo: the ticket says no tool opens it, and what to do instead", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/");
  // The ISO-BMFF header a HEIC file starts with; nothing here decodes past it.
  const heic = Uint8Array.from([
    0,
    0,
    0,
    24,
    ...Buffer.from("ftypheic", "latin1"),
    0,
    0,
    0,
    0,
    ...Buffer.from("mif1heic", "latin1"),
  ]);
  await dropOnDesk(page, [
    { name: "photo.heic", type: "image/heic", bytes: heic },
  ]);
  const ticket = ticketOf(page);
  await expect(ticket).toContainText(/No tool here opens HEIC photos\./);
  await expect(ticket).toContainText(/JPG to PDF takes JPG and PNG/);

  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("Try a sample PDF: marked as the site's, measured, and Fill forms first for its two fields", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const net = watchRequests(page);
  await page.goto("/");
  const sample = page.getByRole("button", { name: /try a sample pdf/i });
  await waitForHydration(sample);
  await sample.click();

  const ticket = ticketOf(page);
  await expect(ticket.getByText("pdfxyz-sample.pdf")).toBeVisible();
  // Marked as pdf.xyz's own, never mistaken for a file of the visitor's.
  await expect(ticket).toContainText(/pdf\.xyz's sample/);
  const first = ticket.getByRole("listitem").first().getByRole("link");
  await expect(first).toHaveAccessibleName(
    /^Open Fill forms with pdfxyz-sample\.pdf$/i,
  );
  await expect(ticket).toContainText(/pdfxyz-sample\.pdf has 2 form fields/);

  // Built in the page, not fetched: no request carried a file either way.
  expect(net.offences(new URL(page.url()).origin)).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("Clear returns the desk to where it started", async ({ page }) => {
  await page.goto("/");
  await uploadFiles(page, await writeTempPdf("gone.pdf", 1));
  const ticket = ticketOf(page);
  await expect(ticket).toBeVisible();
  await ticket.getByRole("button", { name: /^clear/i }).click();
  await expect(ticket).toHaveCount(0);
  await expect(
    page.locator("[data-desk]").getByText("Choose files"),
  ).toBeVisible();
});

test("the first file input on the page is the desk's, inside main", async ({
  page,
}) => {
  await page.goto("/");
  const inMain = await page
    .locator('input[type="file"]')
    .first()
    .evaluate((el) => !!el.closest("main") && !!el.closest("[data-desk]"));
  expect(inMain).toBe(true);
});

/**
 * G.7, "Home: compress one PDF": counted, not estimated. The plan's target
 * was 3 actions and 1 pick (drop → Compress PDF → Download); WP-04's
 * re-measure put the zone it replaced at about 4. Compress analyses the file
 * on arrival and offers the optimized copy itself, so there is no Run step.
 */
test("one PDF, compressed from the home page: pick, Compress PDF, download — three actions", async ({
  page,
}) => {
  let actions = 0;
  await page.goto("/");
  await uploadFiles(page, await writeTempPdf("big-report.pdf", 6));
  actions++;
  const ticket = ticketOf(page);
  const compress = ticket.getByRole("link", {
    name: /^Open Compress PDF with big-report\.pdf$/,
  });
  await expect(compress).toBeVisible();
  // Ranked first: the ticket's primary row.
  await expect(
    ticket.locator('[data-slot="suggestions"] ol > li').first(),
  ).toContainText("Compress PDF");
  await compress.click();
  actions++;
  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);
  const optimized = await captureDownload(
    page,
    page.getByRole("button", { name: /download optimized pdf/i }),
  );
  actions++;
  expect(await pdfPageCount(optimized)).toBe(6);
  expect(actions).toBe(3);
});
