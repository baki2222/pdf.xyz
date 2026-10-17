import { test, expect, type Locator, type Page } from "@playwright/test";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
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

/**
 * A guide's desk is live: the page's drop target. It arrives after the page
 * (`GuideDeskSlot` swaps it in over the server's shell), so a row that drops
 * on a guide waits for it, as a person's hand would arrive after it does.
 */
async function deskLive(page: Page) {
  await expect(
    page.locator("[data-guide-desk] [data-page-drop-target]"),
  ).toHaveCount(1);
}

const ticketDialog = (page: Page) =>
  page.getByRole("dialog", { name: "What you can do with these files" });

/**
 * Answer `/api/worker/status` as a ready deployment, in the page (no
 * `page.route`, which turns the HTTP cache off): a worker panel shows its
 * drop zone only then, and this server has no worker.
 */
async function readyWorker(page: Page) {
  await page.addInitScript((ready) => {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        location.href,
      );
      if (url.pathname !== "/api/worker/status") return real(input, init);
      return new Response(ready, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, JSON.stringify(READY_WORKER_STATUS));
}

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

/**
 * WAS (WP-07 review, on the built page at 1440): released ON Rotate PDF's
 * own drop zone — where a person is most likely to let go — a JPG lit the
 * zone while the veil said "Rotate PDF can't open this file / Release to
 * see what can", and the release showed the runner's error ("photo.jpg
 * isn't a PDF") instead of what the veil promised.
 */
test("/tools/rotate-pdf: a JPG released ON the drop zone is not lit for, and opens the dialog saying so — no runner error", async ({
  page,
}) => {
  await page.goto("/tools/rotate-pdf");
  await layerLive(page);
  const zone = page.locator("[data-page-drop-target]");
  await expect(zone).toHaveCount(1);
  const dataTransfer = await transfer(page, [JPG]);
  await zone.dispatchEvent("dragenter", { dataTransfer });
  await expect(page.locator("[data-drop-veil][data-open]")).toContainText(
    "Rotate PDF can't open this file",
  );
  await expect(zone).not.toHaveAttribute("data-armed", /.*/);
  await zone.dispatchEvent("dragover", { dataTransfer });
  await zone.dispatchEvent("drop", { dataTransfer });
  const dialog = ticketDialog(page);
  await expect(dialog).toContainText("Rotate PDF can't open it.");
  await expect(
    page.locator('[data-single-pdf-runner="empty"] [role="alert"]'),
  ).toHaveCount(0);
  await expect(page.getByText(/isn't a PDF/)).toHaveCount(0);
  // Control: a PDF released on the same zone is the zone's.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await dropOn(zone, [await pdf("on-the-zone.pdf")]);
  await expect(page.locator('[data-single-pdf-runner="loaded"]')).toContainText(
    "on-the-zone.pdf",
  );
});

/**
 * WAS (WP-07 review, worker status mocked as available): once a worker
 * panel had a file, its drop zone was gone and the page had no target — a
 * second PDF dropped on Protect PDF opened the ticket dialog, which never
 * offers the page's own tool, and led with Compress, Sign and Edit.
 */
for (const slug of ["protect-pdf", "ocr-pdf"]) {
  test(`/tools/${slug}, a file chosen: a second PDF dropped on the page replaces it in the tool`, async ({
    page,
  }) => {
    await readyWorker(page);
    await page.goto(`/tools/${slug}`);
    await layerLive(page);
    // The worker answered ready: the panel's zone is the page's target.
    await expect(page.locator("[data-page-drop-target]")).toHaveCount(1);
    const input = fileInput(page);
    await waitForHydration(input);
    await input.setInputFiles({
      name: "first.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await makePdfBytes("first", 1)),
    });
    await expect(page.getByText("first.pdf")).toBeVisible();
    // The chip took the zone's place, and its place as the page's target.
    await expect(page.locator("[data-page-drop-target]")).toHaveCount(1);
    await expect(page.locator("[data-page-drop-target]")).toContainText(
      "first.pdf",
    );
    const dataTransfer = await transfer(page, [await pdf("second.pdf")]);
    await heading(page).dispatchEvent("dragenter", { dataTransfer });
    await expect(page.locator("[data-drop-veil][data-open]")).toContainText(
      "Release to replace first.pdf in",
    );
    await heading(page).dispatchEvent("dragover", { dataTransfer });
    await heading(page).dispatchEvent("drop", { dataTransfer });
    const chosen = page.locator("[data-page-drop-target]");
    await expect(chosen).toContainText("second.pdf");
    await expect(chosen).not.toContainText("first.pdf");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // And it was said, by both names.
    await expect(
      page.getByRole("status").filter({ hasText: "Replaced first.pdf" }),
    ).toHaveText(/^Replaced first\.pdf with second\.pdf in /);
    await expect(page).toHaveURL(new RegExp(`/tools/${slug}$`));
  });
}

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
  await deskLive(page);
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

/**
 * WAS (WP-07 review): every guide desk took everything, so a JPG held over
 * the Merge PDF guide made the veil say "Release to open in Merge PDF" —
 * and the release opened the dialog saying "Merge PDF can't open it."
 */
test("a guide: a JPG held over the page is said to be one Merge PDF can't open, and the release says the same", async ({
  page,
}) => {
  await page.goto("/guides/how-to-merge-pdf-files");
  await layerLive(page);
  await deskLive(page);
  const dataTransfer = await transfer(page, [JPG]);
  await heading(page).dispatchEvent("dragenter", { dataTransfer });
  const veil = page.locator("[data-drop-veil][data-open]");
  await expect(veil).toContainText("Merge PDF can't open this file");
  await expect(veil).not.toContainText("Release to open in Merge PDF");
  await heading(page).dispatchEvent("drop", { dataTransfer });
  await expect(ticketDialog(page)).toContainText("Merge PDF can't open it.");
  await expect(page).toHaveURL(/\/guides\/how-to-merge-pdf-files$/);
});

test.describe("a guide's desk at 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** Every chunk fetched from here on arrives late. */
  const slowChunks = (page: Page) =>
    page.route(/\/_next\/static\/chunks\/.+\.js(\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

  /** The desk's height, and the top of what follows it: its Open button. */
  const measure = async (page: Page) => {
    const desk = page.locator("[data-guide-desk]");
    const next = page.getByRole("link", { name: "Open Merge PDF" }).first();
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      height: round((await desk.boundingBox())!.height),
      next: round((await next.boundingBox())!.y),
    };
  };

  /** Layout shifts from here on that no input caused. */
  const watchShifts = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as { __shifts: number[] };
      w.__shifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[])
          if (!entry.hadRecentInput) w.__shifts.push(entry.value);
      }).observe({ type: "layout-shift", buffered: false });
    });
  const shifts = (page: Page) =>
    page.evaluate(() => (window as unknown as { __shifts: number[] }).__shifts);

  test("the live desk arrives over its shell and moves nothing (chunks slowed)", async ({
    page,
  }) => {
    await slowChunks(page);
    await page.goto("/guides/how-to-merge-pdf-files");
    const desk = page.locator("[data-guide-desk]");
    await desk.scrollIntoViewIfNeeded();
    // The shell, measured while it is the one on the page.
    await expect(desk.locator("[data-drop-sheet-shell]")).toHaveCount(1);
    const shell = await measure(page);
    expect(shell.height).toBeGreaterThan(60);
    await watchShifts(page);
    await expect(desk.locator("[data-page-drop-target]")).toHaveCount(1, {
      timeout: 20_000,
    });
    expect(await measure(page), "the live desk, over its shell").toEqual(shell);
    expect(await shifts(page)).toEqual([]);
  });

  /**
   * WAS (WP-07 review, launch chunks slowed): "Opening … with your file…"
   * was a paragraph mounted under the drop sheet with the launch. It grew
   * the desk 122 -> 146px and moved everything under it 24px: CLS 0.0167 at
   * 390 with the desk in view, hadRecentInput false (a drop is not input,
   * and a pick resolves long after the click).
   */
  test("a drop moves nothing: the desk's height, what follows it, and no layout shift (launch chunks slowed)", async ({
    page,
  }) => {
    await page.goto("/guides/how-to-merge-pdf-files");
    await layerLive(page);
    await deskLive(page);
    const desk = page.locator("[data-guide-desk]");
    await desk.scrollIntoViewIfNeeded();
    const before = await measure(page);
    await watchShifts(page);
    // The launch's chunks arrive late: its state is on screen to measure.
    await slowChunks(page);
    await dropOn(desk.locator("[data-drop-sheet]"), [
      await pdf("chapter-1.pdf"),
      await pdf("chapter-2.pdf"),
    ]);
    // By its role, so the measure is of whatever says it is opening.
    const status = desk.getByRole("status");
    await expect(status).not.toBeEmpty();
    expect(await measure(page), "the desk, saying it is opening").toEqual(
      before,
    );
    await expect(status).toHaveText("Opening Merge PDF with your 2 files…");
    expect(
      await shifts(page),
      "layout shifts while the desk said it was opening",
    ).toEqual([]);
    await expect(page).toHaveURL(/\/tools\/merge-pdf$/, { timeout: 20_000 });
  });
});

test("a guide whose tool has no in-browser runner offers what opens the file, and promises nothing else", async ({
  page,
}) => {
  await page.goto("/guides/how-to-convert-pdf-to-word");
  await layerLive(page);
  await deskLive(page);
  const desk = page.locator("[data-guide-desk]");
  await expect(desk).toContainText("Drop a PDF to see which tools open it");
  await expect(desk).not.toContainText("open PDF to Word");
  await dropOn(heading(page), [await pdf("report.pdf")]);
  const dialog = ticketDialog(page);
  await expect(dialog).toContainText("report.pdf");
  // The tool the guide teaches comes first — WAS about 26th of 42, under
  // "More", below Compress, Sign and Edit (WP-07 review).
  const first = dialog.locator("[data-suggestion]").first();
  await expect(first).toHaveAttribute("data-suggestion", "pdf-to-word");
  await expect(first).toHaveAccessibleName(
    "Open PDF to Word — you'll add report.pdf there",
  );
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

/**
 * The page's first file input — the one `fileInput` hands every spec, and
 * the one a pick through it reaches: whether it is inside <main>, and
 * whether it is the page's own drop target's.
 *
 * Read AS IT STAYS: once the page's own target is live (each page this is
 * asked of has exactly one, "at most one page target" above) — a guide's
 * desk replaces its server-drawn shell after the page is live — and in ONE
 * question to the page, so the node read is the node asked. WAS
 * `fileInput(page).evaluate(...)`, two round trips: it could resolve the
 * shell's input and ask it after the desk had replaced it, and a detached
 * node is in no <main> (the control below).
 */
async function firstFileInput(page: Page) {
  await expect(
    page.locator("[data-page-drop-target]"),
    "the page's own target never went live",
  ).toHaveCount(1);
  return page.evaluate(() => {
    const input = document.querySelector('input[type="file"]');
    return input
      ? {
          inMain: !!input.closest("main"),
          inTarget: !!input.closest("[data-page-drop-target]"),
        }
      : null;
  });
}

/**
 * Holds every script that carries a guide's live desk — found by what it
 * draws (`data-guide-desk`) and what it says while it opens a tool
 * ("Opening "), not by its hashed name — until `release()`. `held` lists
 * what was held: empty, the instrument saw nothing.
 */
async function holdGuideDesk(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const held: string[] = [];
  await page.route("**/_next/static/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.includes("data-guide-desk") && body.includes("Opening ")) {
      held.push(new URL(route.request().url()).pathname);
      await gate;
    }
    await route.fulfill({ response, body });
  });
  return { held, release };
}

test("the first file input on a page is inside <main>, and is the page's own target's", async ({
  page,
}) => {
  for (const path of [
    "/",
    "/tools/rotate-pdf",
    "/workspace",
    "/guides/how-to-merge-pdf-files",
  ]) {
    await page.goto(path);
    await layerLive(page);
    expect(await firstFileInput(page), path).toEqual({
      inMain: true,
      inTarget: true,
    });
  }
});

/**
 * WHY THE GUIDE WAS FLAKY (failed once in a full run, 4/4 alone). A
 * guide's desk is lazy: the server draws a shell with its own native
 * picker, and the live desk REPLACES it when its chunk arrives
 * (`GuideDeskSlot`) — after the page is hydrated and the drop layer is
 * listening, which is all `layerLive` waits for. A read that resolved the
 * first file input and then asked it a question in a second round trip
 * (Playwright's `locator.evaluate`) could resolve the shell's input and ask
 * after the swap: `closest("main")` of a detached node is null. Replayed
 * step by step with the desk's chunk held between the two steps:
 * "evaluate on the resolved node: inside main = false, connected = false",
 * while the page asked in one question said true. The page itself never
 * had a first file input outside <main>: watched after every mutation and
 * every frame on all four pages, the guide went "shell's, in main" ->
 * "the desk's, in main" in one commit.
 *
 * So the condition the test means is the page's input AS IT STAYS: read
 * once the page's own target is live, in one question. Here the desk is
 * held until a second after the page is live, so a read that does not wait
 * for it reads the shell's picker, which is no drop target.
 */
test("a guide whose desk arrives late: its first file input is read once the desk is live — never the shell the desk replaces", async ({
  page,
}) => {
  const desk = await holdGuideDesk(page);
  try {
    // Not to "load": the desk's chunk is a script the page inserted, and a
    // held one can hold the load event with it (it did, once in 25 runs).
    await page.goto("/guides/how-to-merge-pdf-files", {
      waitUntil: "domcontentloaded",
    });
    await layerLive(page);
    // Health: the page is live, its desk's chunk was asked for and is held,
    // and the desk is not live — the shell's picker is the page's first
    // file input now.
    await expect
      .poll(() => desk.held.length, {
        message: "the desk's chunk was never seen",
      })
      .toBe(1);
    await expect(
      page.locator("[data-guide-desk] [data-drop-sheet-shell]"),
    ).toHaveCount(1);
    await expect(page.locator("[data-page-drop-target]")).toHaveCount(0);
    setTimeout(desk.release, 1000);
    expect(await firstFileInput(page)).toEqual({
      inMain: true,
      inTarget: true,
    });
  } finally {
    desk.release();
  }
});
