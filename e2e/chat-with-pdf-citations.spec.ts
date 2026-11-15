import { test, expect, type Request } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { colourDistance, decodePng, pixelAt } from "../src/lib/png-probe";
import {
  FILLS,
  askThreeFills,
  axeViolations,
  citationBoxes,
  isStaticGet,
  mockChatWorker,
} from "./chat-citations-fixture";

/**
 * Clickable citations through the SERVED page (audit #30, chat-with-pdf#3,
 * 2026-11-15), the worker mocked at the wire (`page.route`):
 *
 * A three-page PDF whose pages are three different solid fills is asked a
 * question; the stubbed job's answer package says "[p.2]". Pressing the
 * marker must show PAGE 2 OF THAT FILE — judged on the decoded pixels of the
 * image the dialog draws, with pages 1 and 3 as the controls a wrong index
 * would land on — and must send nothing: after the press, no request to
 * /api/, nothing with a body, only same-origin static GETs (the dialog's and
 * pdfjs's chunks, pdfjs's wasm/cmap assets) and Next's RSC prefetches.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const QUESTION = "What does page 2 say?";
const ANSWER = "Page 2 holds the green section [p.2].";

test("pressing [p.2] shows page 2 of the chosen file, and sends nothing", async ({
  page,
}) => {
  await mockChatWorker(page, QUESTION, ANSWER, [2]);
  const before: Request[] = [];
  const recordBefore = (request: Request) => before.push(request);
  page.on("request", recordBefore);
  await askThreeFills(page, QUESTION);

  const cite = page.getByRole("button", { name: "Show page 2 of your PDF" });
  await expect(cite).toBeVisible({ timeout: 20_000 });
  await expect(cite).toHaveText("[p.2]");

  const origin = new URL(page.url()).origin;
  page.off("request", recordBefore);
  const after: Request[] = [];
  const record = (request: Request) => after.push(request);
  page.on("request", record);
  await cite.click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Page 2 of 3" }),
  ).toBeVisible();
  const image = dialog.getByRole("img", { name: "Page 2" });
  await expect(image).toBeVisible({ timeout: 20_000 });
  page.off("request", record);

  // The page's CSP keeps blob: out of connect-src, so the blob URL cannot be
  // fetched back. The image the dialog decoded is re-encoded instead, at its
  // natural size, and that PNG decoded in node: the pixels judged are the
  // ones the visitor was shown.
  const base64 = await image.evaluate(async (node) => {
    const img = node as HTMLImageElement;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const png = decodePng(new Uint8Array(Buffer.from(base64, "base64")));
  // Health check: a real raster, not a placeholder.
  expect(png.width).toBeGreaterThan(100);
  const centre = pixelAt(
    png,
    Math.floor(png.width / 2),
    Math.floor(png.height / 2),
  );
  const [one, two, three] = FILLS.map((fill) => colourDistance(centre, fill));
  expect(
    two,
    `centre ${JSON.stringify(centre)} is not page 2's fill`,
  ).toBeLessThan(40);
  // Positive controls: the pages an off-by-one would have shown.
  expect(one).toBeGreaterThan(100);
  expect(three).toBeGreaterThan(100);

  // The network property: nothing carrying the file, nothing to /api/.
  // Health checks for the property below, so it cannot pass on nothing:
  // the press DID fetch something (the dialog's chunk at least, on a first
  // press), and the predicate DOES reject what a question sends — the
  // upload reservation and the job POST made before the press.
  expect(after.length, "no request after the press: vacuous").toBeGreaterThan(
    0,
  );
  const sent = before.filter((r) =>
    new URL(r.url()).pathname.startsWith("/api/"),
  );
  expect(sent.some((r) => r.method() === "POST")).toBe(true);
  for (const request of sent) expect(isStaticGet(request, origin)).toBe(false);
  for (const request of after) {
    const where = `${request.method()} ${request.url()}`;
    expect(request.method(), where).toBe("GET");
    expect(request.postDataBuffer(), where).toBeNull();
    expect(isStaticGet(request, origin), where).toBe(true);
  }
});

/**
 * Every shape the worker's parser counts, beside shapes it does not, on one
 * answer: the review's own (2026-11-15). Two markers a few pixels apart are
 * common ("[p.2] [p.3]"), so each button must be a 24px target on its own —
 * axe's target-size rule found "[p.3]" too small beside its neighbour before
 * the buttons were given a box.
 */
const MULTI_Q = "Where is the rent?";
const MULTI =
  "Forms: [p.2] and [p.1, p.3] and [p.3, 2] and [pp. 2-3]. Close: [p.2] [p.3]. Not: [p.0] [p.999] [p.x] [Page 2].";

for (const scheme of ["light", "dark"] as const) {
  test(`an answer full of citations passes axe, every button a 24px target (${scheme})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: scheme });
    await context.addInitScript((key) => {
      window.localStorage.setItem(key, "denied");
    }, CONSENT_STORAGE_KEY);
    const page = await context.newPage();
    await mockChatWorker(page, MULTI_Q, MULTI, [1, 2, 3]);
    await askThreeFills(page, MULTI_Q);
    await expect(
      page.getByRole("button", { name: "Show page 2 of your PDF" }).first(),
    ).toBeVisible({ timeout: 20_000 });

    const boxes = await citationBoxes(page);
    // Exactly the counted shapes, in order; nothing in "Not:" is a button.
    expect(boxes.map((b) => b.text)).toEqual([
      "[p.2]",
      "[p.1, p.3]",
      "[p.3, 2]",
      "[pp. 2-3]",
      "[p.2]",
      "[p.3]",
    ]);
    for (const box of boxes) {
      expect(box.height, box.text).toBeGreaterThanOrEqual(24);
      expect(box.width, box.text).toBeGreaterThanOrEqual(24);
    }
    expect(await axeViolations(page)).toEqual([]);

    // The dialog too, opened from the close pair.
    await page.getByRole("button", { name: "Show page 3 of your PDF" }).click();
    await expect(
      page.getByRole("heading", { name: "Page 3 of 3" }),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await context.close();
  });
}

test("the dialog works from the keyboard and gives focus back to the marker", async ({
  page,
}) => {
  await mockChatWorker(page, MULTI_Q, MULTI, [1, 2, 3]);
  await askThreeFills(page, MULTI_Q);
  const cite = page.getByRole("button", { name: "Show page 3 of your PDF" });
  await expect(cite).toBeVisible({ timeout: 20_000 });
  await cite.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Page 3 of 3" }),
  ).toBeVisible();
  // Focus moved into the dialog, and Tab never reaches the page behind it.
  // The modal <dialog> makes the page inert; past the last control the
  // browser offers its own toolbar (here: focus on no element, the body),
  // which is not the page — so "inside, or nowhere on the page" is the
  // property, and at least one Tab must land inside (the positive control).
  await expect
    .poll(() => dialog.evaluate((d) => d.contains(document.activeElement)))
    .toBe(true);
  const where: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    where.push(
      await dialog.evaluate((d) => {
        const at = document.activeElement;
        if (at === null || at === document.body) return "browser";
        return d.contains(at) ? "dialog" : `PAGE ${at.outerHTML.slice(0, 80)}`;
      }),
    );
  }
  expect(
    where.filter((w) => w.startsWith("PAGE")),
    where.join(" "),
  ).toEqual([]);
  expect(where).toContain("dialog");
  // Previous walks back; it is the last page, so Next is not offered as live.
  await dialog.getByRole("button", { name: /previous page/i }).click();
  await expect(
    dialog.getByRole("heading", { name: "Page 2 of 3" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(cite).toBeFocused();
});
