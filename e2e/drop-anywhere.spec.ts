import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  attachConsoleGuard,
  fileInput,
  makePdfBytes,
  waitForHydration,
} from "./helpers";

/**
 * Drop and paste anywhere (redesign WP-07): a file that lands on ANY page
 * lands somewhere it can be used — the page's own target, or the ticket
 * dialog — and never in a browser tab of its own.
 *
 * WHAT WAS THERE BEFORE: the home desk listened to its page's drops, and no
 * other page did. A file released beside a tool's drop zone, on a guide, or
 * on /tools was opened by the browser IN THE TAB (the visitor's page became
 * their PDF), and a paste did nothing anywhere. Each row below fails on
 * that tree: the file is not where the row looks for it.
 *
 * Synthetic `DataTransfer`s built in the page (a real browser object, with
 * "Files" among its types and each item's kind and type, as Chromium
 * reports a real drag), dispatched on an element outside every drop zone.
 * Fixtures are generated per run (pdf-lib), never committed.
 */

interface DropFile {
  readonly name: string;
  readonly type: string;
  readonly b64: string;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const pdf = async (name: string, pages = 1): Promise<DropFile> => ({
  name,
  type: "application/pdf",
  b64: b64(await makePdfBytes(name, pages)),
});
/** A PNG's signature and nothing past it: enough to be read as a PNG. */
const PNG: DropFile = {
  name: "signature.png",
  type: "image/png",
  b64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
};
const JPG: DropFile = {
  name: "photo.jpg",
  type: "image/jpeg",
  b64: b64(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])),
};

/**
 * The page is live: hydrated, and the drop layer listening (it marks
 * `<html data-drop-layer>` once it is). The mark is waited for briefly and
 * not required, so a build without a layer fails each row on what the row
 * checks — the file is not where it should be — not on this wait.
 */
async function layerLive(page: Page) {
  await waitForHydration(page.locator("main h1").first());
  await page
    .locator("html[data-drop-layer]")
    .waitFor({ state: "attached", timeout: 3000 })
    .catch(() => {});
}

async function transfer(page: Page, files: readonly DropFile[]) {
  return page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const { name, type, b64 } of list) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], name, { type }));
    }
    return dt;
  }, files);
}

/** A whole drag: enter, over, release — on `target`. */
async function dropOn(target: Locator, files: readonly DropFile[]) {
  const dataTransfer = await transfer(target.page(), files);
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
}

/** Somewhere on the page that is no drop zone: its heading. */
const heading = (page: Page) => page.locator("main h1").first();

/** Every URL the tab's main frame went to — a blob: or file: one is the defect. */
function watchNavigations(page: Page) {
  const urls: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  return urls;
}

const ticketDialog = (page: Page) =>
  page.getByRole("dialog", { name: "What you can do with these files" });

test("/tools: a drop opens the ticket dialog, and Rotate PDF opens with the file", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/tools");
  await layerLive(page);
  // What the veil says before the release.
  const dataTransfer = await transfer(page, [await pdf("scan.pdf")]);
  await heading(page).dispatchEvent("dragenter", { dataTransfer });
  await expect(page.locator("[data-drop-veil][data-open]")).toContainText(
    "Release to see what opens this file",
  );
  await heading(page).dispatchEvent("dragover", { dataTransfer });
  await heading(page).dispatchEvent("drop", { dataTransfer });

  const dialog = ticketDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("scan.pdf");
  await dialog.getByRole("button", { name: /^More/ }).click();
  await dialog
    .getByRole("link", { name: "Open Rotate PDF with scan.pdf" })
    .click();
  await expect(page).toHaveURL(/\/tools\/rotate-pdf$/);
  await expect(page.getByText(/loaded 1 file you added/i)).toBeVisible();
  await expect(page.locator('[data-single-pdf-runner="loaded"]')).toContainText(
    "scan.pdf",
  );
  // Navigating closed it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("/tools/rotate-pdf: a file dropped anywhere on the page opens in Rotate PDF", async ({
  page,
}) => {
  const navigations = watchNavigations(page);
  await page.goto("/tools/rotate-pdf");
  await layerLive(page);
  const dataTransfer = await transfer(page, [await pdf("anywhere.pdf", 2)]);
  await heading(page).dispatchEvent("dragenter", { dataTransfer });
  await expect(page.locator("[data-drop-veil][data-open]")).toContainText(
    "Release to open in Rotate PDF",
  );
  // The zone the file will land in is armed.
  await expect(page.locator("[data-page-drop-target][data-armed]")).toHaveCount(
    1,
  );
  await heading(page).dispatchEvent("dragover", { dataTransfer });
  await heading(page).dispatchEvent("drop", { dataTransfer });
  await expect(page.locator('[data-single-pdf-runner="loaded"]')).toContainText(
    "anywhere.pdf",
  );
  expect(navigations.filter((u) => /^(blob|file):/.test(u))).toEqual([]);
  // …and once the editor is open, a second PDF replaces the first.
  await dropOn(heading(page), [await pdf("second.pdf", 1)]);
  await expect(page.locator('[data-single-pdf-runner="loaded"]')).toContainText(
    "second.pdf",
  );
});

test("/tools/rotate-pdf: a JPG is not opened in Rotate PDF — the dialog says so and offers what opens it", async ({
  page,
}) => {
  await page.goto("/tools/rotate-pdf");
  await layerLive(page);
  const dataTransfer = await transfer(page, [JPG]);
  await heading(page).dispatchEvent("dragenter", { dataTransfer });
  await expect(page.locator("[data-drop-veil][data-open]")).toContainText(
    "Rotate PDF can't open this file",
  );
  await heading(page).dispatchEvent("drop", { dataTransfer });
  const dialog = ticketDialog(page);
  await expect(dialog).toContainText("Rotate PDF can't open it.");
  await expect(
    dialog.getByRole("link", { name: /^Open JPG to PDF with photo\.jpg$/ }),
  ).toBeVisible();
  // Rotate PDF is never offered back to its own page.
  await expect(dialog.locator('[data-suggestion="rotate-pdf"]')).toHaveCount(0);
  await expect(page.locator('[data-single-pdf-runner="empty"]')).toBeVisible();
});

test("/tools/merge-pdf: a drop on the add-more tile adds files, and the tab never leaves for the file", async ({
  page,
}) => {
  const navigations = watchNavigations(page);
  await page.goto("/tools/merge-pdf");
  await layerLive(page);
  await dropOn(heading(page), [await pdf("one.pdf")]);
  await expect(page.getByText("one.pdf")).toBeVisible();
  // The empty zone has become the add-more tile: the page's target still.
  const tile = page.locator("[data-page-drop-target]");
  await expect(tile).toHaveCount(1);
  await expect(tile).toContainText("Add more PDFs");
  await dropOn(tile, [await pdf("two.pdf")]);
  await expect(page.getByText("two.pdf")).toBeVisible();
  // A drop anywhere else adds too.
  await dropOn(heading(page), [await pdf("three.pdf")]);
  await expect(page.getByText("three.pdf")).toBeVisible();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  expect(navigations.filter((u) => /^(blob|file):/.test(u))).toEqual([]);
});

test("a guide: dropping the files on its desk opens Merge PDF with them — G.7, guide row", async ({
  page,
}) => {
  // G.7 "Guide: merge": the actions a person takes, counted. WAS: open the
  // tool (1), pick the files again (2), merge (3), download (4).
  let actions = 0;
  await page.goto("/guides/how-to-merge-pdf-files");
  await layerLive(page);
  const desk = page.locator("[data-guide-desk]");
  await expect(desk).toContainText(
    "Drop your PDFs to open Merge PDF with them, or browse",
  );
  await dropOn(desk.locator("[data-drop-sheet]"), [
    await pdf("chapter-1.pdf"),
    await pdf("chapter-2.pdf", 2),
  ]);
  actions++;
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  await expect(page.getByText("chapter-1.pdf")).toBeVisible();
  await expect(page.getByText("chapter-2.pdf")).toBeVisible();
  await expect(page.getByText(/loaded 2 files you added/i)).toBeVisible();
  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  actions++;
  await expect(
    page.getByRole("button", { name: /download merged pdf/i }),
  ).toBeVisible();
  actions++;
  expect(actions).toBeLessThanOrEqual(3);
});

test("a guide whose tool has no in-browser runner offers what opens the file, and promises nothing else", async ({
  page,
}) => {
  await page.goto("/guides/how-to-convert-pdf-to-word");
  await layerLive(page);
  const desk = page.locator("[data-guide-desk]");
  await expect(desk).toContainText("Drop a PDF to see which tools open it");
  await expect(desk).not.toContainText("open PDF to Word");
  await dropOn(heading(page), [await pdf("report.pdf")]);
  await expect(ticketDialog(page)).toContainText("report.pdf");
  await expect(page).toHaveURL(/\/guides\/how-to-convert-pdf-to-word$/);
});

test("a category page has no target: a drop opens the ticket dialog", async ({
  page,
}) => {
  await page.goto("/tools/category/organize");
  await layerLive(page);
  await expect(page.locator("[data-page-drop-target]")).toHaveCount(0);
  await dropOn(heading(page), [await pdf("loose.pdf")]);
  await expect(ticketDialog(page)).toContainText("loose.pdf");
});

test("/workspace: Ctrl+V with a file stages it", async ({ page }) => {
  await page.goto("/workspace");
  await layerLive(page);
  const clipboard = await transfer(page, [await pdf("pasted.pdf")]);
  await page.evaluate((dt) => {
    document.body.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, clipboard);
  await expect(
    page.getByRole("list", { name: /staged files/i }).getByText("pasted.pdf"),
  ).toBeVisible();
});

test("Ctrl+V inside a text field is the field's: Text to PDF's editor takes no file from it, the page around it does", async ({
  page,
}) => {
  await page.goto("/tools/text-to-pdf");
  await layerLive(page);
  const txt: DropFile = {
    name: "pasted-note-4127.txt",
    type: "text/plain",
    b64: Buffer.from("pasted words").toString("base64"),
  };
  const clipboard = await transfer(page, [txt]);
  const field = page.locator("main textarea").first();
  await field.waitFor();
  const pasteOn = (selector: "textarea" | "body") =>
    page.evaluate(
      ([dt, where]) => {
        const target =
          where === "body"
            ? document.body
            : document.querySelector("main textarea")!;
        target.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [clipboard, selector] as const,
    );
  // A file the runner reads lands in the editor as its text.
  await expect(field).toHaveValue("");
  await pasteOn("textarea");
  // Give a wrong delivery every chance to land; it must not.
  await page.waitForTimeout(300);
  await expect(field).toHaveValue("");
  await pasteOn("body");
  await expect(field).toHaveValue("pasted words");
});

test("Sign PDF: with the signature-image zone shown, a drop on the page replaces the PDF, and a drop on the zone is the zone's", async ({
  page,
}) => {
  await page.goto("/tools/sign-pdf");
  await layerLive(page);
  await dropOn(heading(page), [await pdf("contract.pdf")]);
  const editor = page.locator('[data-single-pdf-runner="loaded"]');
  await expect(editor).toContainText("contract.pdf");
  await page.getByRole("radio", { name: "Upload" }).click();
  const zone = page
    .locator("[data-drop-sheet]")
    .filter({ hasText: "Drop a signature image, or" });
  // Positive control: the secondary zone is there…
  await expect(zone).toBeVisible();
  // …and the page still has one target, the editor.
  await expect(page.locator("[data-page-drop-target]")).toHaveCount(1);
  await dropOn(heading(page), [await pdf("countersigned.pdf")]);
  await expect(editor).toContainText("countersigned.pdf");
  // Control: a drop ON the zone is a signature image, and the PDF stays.
  await page.getByRole("radio", { name: "Upload" }).click();
  await dropOn(zone, [PNG]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toContainText("countersigned.pdf");
});

test("Overlay PDF: with the overlay zone shown, a drop on the page replaces the base PDF, and a drop on the zone loads the overlay", async ({
  page,
}) => {
  await page.goto("/tools/overlay-pdf");
  await layerLive(page);
  await dropOn(heading(page), [await pdf("base.pdf")]);
  const editor = page.locator('[data-single-pdf-runner="loaded"]');
  await expect(editor).toContainText("base.pdf");
  const zone = page
    .locator("[data-drop-sheet]")
    .filter({ hasText: "Drop the overlay PDF here, or" });
  await expect(zone).toBeVisible();
  await expect(page.locator("[data-page-drop-target]")).toHaveCount(1);
  await dropOn(heading(page), [await pdf("base-2.pdf")]);
  await expect(editor).toContainText("base-2.pdf");
  await expect(zone).toBeVisible();
  // Control: on the zone, it is the overlay.
  await dropOn(zone, [await pdf("letterhead.pdf")]);
  await expect(editor).toContainText("letterhead.pdf");
  await expect(editor).toContainText("base-2.pdf");
});

test("at most one page target on every page, and none where a drop belongs to the dialog", async ({
  page,
}) => {
  // A worker tool's panel shows its drop zone once the worker reports in,
  // so there the count is 0 (this server has no worker) or 1 — never more.
  for (const [path, expected] of [
    ["/", 1],
    ["/tools/rotate-pdf", 1],
    ["/tools/merge-pdf", 1],
    ["/tools/ocr-pdf", "at most 1"],
    ["/workspace", 1],
    ["/guides/how-to-merge-pdf-files", 1],
    ["/tools", 0],
    ["/tools/category/organize", 0],
    ["/guides", 0],
  ] as const) {
    await page.goto(path);
    await layerLive(page);
    const targets = page.locator("[data-page-drop-target]");
    if (expected === "at most 1")
      expect(
        await targets.count(),
        `${path}: page targets`,
      ).toBeLessThanOrEqual(1);
    else await expect(targets, `${path}: page targets`).toHaveCount(expected);
  }
});

test("the first file input on a page is inside <main>", async ({ page }) => {
  for (const path of [
    "/",
    "/tools/rotate-pdf",
    "/workspace",
    "/guides/how-to-merge-pdf-files",
  ]) {
    await page.goto(path);
    await layerLive(page);
    await expect(fileInput(page), `${path}: a file input`).toBeAttached();
    const insideMain = await fileInput(page).evaluate(
      (el) => !!el.closest("main"),
    );
    expect(insideMain, path).toBe(true);
  }
});
