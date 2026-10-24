import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
} from "pdf-lib";
import {
  captureDownload,
  pdfAnnotations,
  pdfPageTexts,
  pdfTextPositions,
} from "./client-proof/artifacts";
import { attachConsoleGuard, fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * Edit PDF, Phase 3, driven through the live page and proven on the bytes
 * it downloads — read back by pdfjs in THIS process:
 *
 *  - links: the file's own link is outlined, re-aimed in the panel; a new
 *    email link is drawn on a /Rotate 90 page and a go-to-page link on
 *    page 1; each is a real /Link annotation at the box the editor showed;
 *  - pages: rotate, insert a blank page, delete, drag to reorder in the
 *    rail, undo and redo — and a text box placed on a page moves with it;
 *  - forms: the file's own fields filled in place, new text, dropdown and
 *    checkbox fields drawn and named, a date and a check mark placed.
 *
 * `SHOTS_DIR` set: screenshots of each state are written there.
 */

const W = 612;
const H = 792;
const TOL = 1;

async function fixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const names = ["ONE", "TWO", "THREE"];
  const pages = names.map((n) => {
    const p = doc.addPage([W, H]);
    p.drawText(`PAGE ${n}`, { x: 72, y: 720, size: 14, font });
    return p;
  });
  pages[1]!.setRotation(degrees(90));
  // A link already in the file, on page 1: content (100,600)-(260,620).
  const link = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [100, 600, 260, 620],
      Border: [0, 0, 0],
      A: { S: "URI", URI: PDFString.of("https://old.example.org/") },
    }),
  );
  pages[0]!.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  // Form fields already in the file, on page 1.
  const form = doc.getForm();
  form
    .createTextField("city")
    .addToPage(pages[0]!, { x: 100, y: 500, width: 160, height: 20 });
  form
    .createCheckBox("agree")
    .addToPage(pages[0]!, { x: 100, y: 460, width: 14, height: 14 });
  return Buffer.from(await doc.save());
}

/** Screen point of a viewer-frame point on page `index`. */
async function at(page: Page, index: number, x: number, y: number) {
  const sheet = page.locator(`[data-editor-page="${index}"]`);
  await sheet.scrollIntoViewIfNeeded();
  // A page is taller than the view: bring the POINT to the middle of the
  // page view, not just some part of its page.
  await page.locator("[data-editor-viewport]").scrollIntoViewIfNeeded();
  await page.evaluate(
    ({ index, y }) => {
      const s = document.querySelector(`[data-editor-page="${index}"]`)!;
      const v = document.querySelector("[data-editor-viewport]")!;
      const [w] = s.getAttribute("data-page-pt")!.split("x").map(Number);
      const sb = s.getBoundingClientRect();
      const vb = v.getBoundingClientRect();
      const py = sb.top + (y * sb.width) / w!;
      // Only when it is near an edge, so the two ends of a drag, asked for
      // one after the other, are measured in the same scroll position.
      if (py < vb.top + 120 || py > vb.bottom - 120) {
        v.scrollTop += py - (vb.top + vb.height / 2);
      }
    },
    { index, y },
  );
  const box = (await sheet.boundingBox())!;
  const [w] = (await sheet.getAttribute("data-page-pt"))!
    .split("x")
    .map(Number);
  const scale = box.width / w!;
  return { x: box.x + x * scale, y: box.y + y * scale, scale };
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** A selected object's box as the overlay drew it (viewer points). */
async function boxOf(page: Page, selector: string) {
  const r = page.locator(selector).first();
  const n = async (a: string) => Number(await r.getAttribute(a));
  return {
    x: await n("x"),
    y: await n("y"),
    width: await n("width"),
    height: await n("height"),
  };
}

function expectNear(
  got: { x: number; y: number; width: number; height: number },
  want: { x: number; y: number; width: number; height: number },
) {
  expect(Math.abs(got.x - want.x)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(got.y - want.y)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(got.width - want.width)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(got.height - want.height)).toBeLessThanOrEqual(TOL);
}

const said = (page: Page) =>
  page.locator("[data-wysiwyg-editor] > [role=status]");

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name) });
}

async function open(page: Page) {
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "phase3.pdf",
    mimeType: "application/pdf",
    buffer: await fixture(),
  });
  await expect(page.locator('[data-editor-page="2"]')).toBeAttached({
    timeout: 20_000,
  });
  await expect(
    page.locator('[data-editor-page="0"] [data-page-raster] canvas'),
  ).toBeAttached({ timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

test("links: edit the file's own, draw new ones on a rotated page, download real /Link annotations", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const guard = attachConsoleGuard(page);
  await open(page);

  // The file's link is outlined, at the box pdf.js would give it.
  const existing = page.locator(
    '[data-editor-page="0"] [data-object-kind="link"] [data-link-box]',
  );
  await expect(existing).toHaveCount(1);
  const old = await boxOf(
    page,
    '[data-editor-page="0"] [data-object-kind="link"] [data-link-box]',
  );
  expectNear(old, { x: 100, y: H - 620, width: 160, height: 20 });

  // Select it and send it somewhere else.
  const p = await at(page, 0, old.x + 80, old.y + 10);
  await page.mouse.click(p.x, p.y);
  const address = page.getByLabel("Link address");
  await expect(address).toHaveValue("https://old.example.org/");
  await address.fill("new.example.org/terms");
  await address.press("Enter");
  await expect(said(page)).toContainText("Link updated");

  // A new email link on the rotated page (displayed 792 × 612).
  await page.getByRole("button", { name: "Link", exact: true }).click();
  const a = await at(page, 1, 300, 200);
  const b = await at(page, 1, 460, 230);
  await drag(page, a, b);
  await expect(page.getByLabel("Link address")).toBeFocused();
  await page.keyboard.type("hi@example.com");
  await page.keyboard.press("Enter");
  const mailBox = await boxOf(
    page,
    '[data-editor-page="1"] [data-object-kind="link"] [data-link-box]',
  );
  expectNear(mailBox, { x: 300, y: 200, width: 160, height: 30 });

  // A go-to-page link on page 1, aimed at page 3.
  await page.getByRole("button", { name: "Link", exact: true }).click();
  const c = await at(page, 0, 80, 120);
  const d = await at(page, 0, 200, 150);
  await drag(page, c, d);
  await page.getByRole("radio", { name: "A page" }).click();
  await page
    .getByRole("combobox", { name: "Go to page", exact: true })
    .selectOption({ label: "Page 3" });
  await expect(said(page)).toContainText("Link updated");
  const goToBox = await boxOf(
    page,
    '[data-editor-page="0"] [data-link-box="page"]',
  );
  expect(goToBox.width).toBeCloseTo(120, 0);
  await shot(page, "p3-links.png");

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const read = await pdfAnnotations(buf);
  const links0 = read[0]!.annots.filter((x) => x.subtype === "Link");
  expect(links0).toHaveLength(2);
  const edited = links0.find((x) => x.url)!;
  expect(edited.url).toBe("https://new.example.org/terms");
  expectNear(edited.rect, old);
  const goTo = links0.find((x) => x.destPage !== undefined)!;
  expect(goTo.destPage).toBe(2);
  expectNear(goTo.rect, goToBox);
  expect(read[1]!.rotate).toBe(90);
  const mail = read[1]!.annots.find((x) => x.subtype === "Link")!;
  expect(mail.url).toBe("mailto:hi@example.com");
  expectNear(mail.rect, mailBox);
  // Nothing of a link is drawn: the pages' text is the file's own.
  expect((await pdfPageTexts(buf))[0]).not.toMatch(/example/);
  expect(guard.pageErrors).toEqual([]);
  expect(guard.cspViolations()).toEqual([]);
});

test("page rail: rotate, insert blank, delete, drag to reorder, undo — objects follow their page", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const guard = attachConsoleGuard(page);
  await open(page);

  // A text box on page 3.
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const p = await at(page, 2, 100, 150);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type("ON-THREE");
  await page.keyboard.press("Escape");
  await expect(said(page)).toContainText("Text box added");

  const rail = page.locator('[data-page-rail="rail"]');
  await rail.getByRole("button", { name: "Rotate page 3" }).click();
  await expect(page.locator('[data-editor-page="2"]')).toHaveAttribute(
    "data-page-pt",
    `${H}x${W}`,
  );
  await rail
    .getByRole("button", { name: "Insert a blank page after page 1" })
    .click();
  await expect(page.locator("[data-editor-page]")).toHaveCount(4);
  await expect(page.locator('[data-editor-page="1"]')).toHaveAttribute(
    "data-source-page",
    "blank",
  );
  // Pages: ONE, blank, TWO, THREE. Delete TWO.
  await rail.getByRole("button", { name: "Delete page 3" }).click();
  await expect(page.locator("[data-editor-page]")).toHaveCount(3);
  // Drag THREE (now page 3) to the top: THREE, ONE, blank.
  await rail
    .locator('[data-rail-page="2"]')
    .dragTo(rail.locator('[data-rail-page="0"]'));
  await expect(page.locator('[data-editor-page="0"]')).toHaveAttribute(
    "data-source-page",
    "2",
  );
  // The text box moved with its page.
  await expect(
    page.locator('[data-editor-page="0"] [data-object-kind="text"]'),
  ).toHaveCount(1);

  // Undo the move, redo it.
  await page.locator("[data-editor-viewport]").focus();
  await page.keyboard.press("Control+z");
  await expect(said(page)).toContainText("Undid: Move page 3 to 1");
  await expect(page.locator('[data-editor-page="0"]')).toHaveAttribute(
    "data-source-page",
    "0",
  );
  await page.keyboard.press("Control+Shift+z");
  await expect(said(page)).toContainText("Redid: Move page 3 to 1");
  await shot(page, "p3-pages.png");
  const placed = page
    .locator('[data-editor-page="0"] [data-object-kind="text"] text')
    .first();
  const want = {
    x: Number(await placed.getAttribute("x")),
    y: Number(await placed.getAttribute("y")),
  };

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const texts = await pdfPageTexts(buf);
  expect(texts).toHaveLength(3);
  expect(texts[0]).toContain("PAGE THREE");
  expect(texts[0]).toContain("ON-THREE");
  expect(texts[1]).toContain("PAGE ONE");
  expect(texts[2]!.trim()).toBe("");
  expect(texts.join(" ")).not.toContain("PAGE TWO");
  expect((await pdfAnnotations(buf)).map((x) => x.rotate)).toEqual([90, 0, 0]);
  const [first] = await pdfTextPositions(buf);
  const run = first!.runs.find((r) => r.str === "ON-THREE")!;
  expect(run.upright).toBe(true);
  expect(Math.abs(run.x - want.x)).toBeLessThan(TOL);
  expect(Math.abs(run.y - want.y)).toBeLessThan(TOL);
  expect(guard.pageErrors).toEqual([]);
  expect(guard.cspViolations()).toEqual([]);
});

test("forms: fill the file's own fields, add new ones, a date and a check mark", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const guard = attachConsoleGuard(page);
  await open(page);

  // The file's own fields, filled in place.
  const city = page.locator('[data-file-field="city"]');
  await expect(city).toBeVisible();
  await city.fill("Dhaka");
  await page.locator('[data-file-field="agree"]').check();

  // A new text field, dragged out and named.
  await page.getByRole("button", { name: "Text field", exact: true }).click();
  const a = await at(page, 0, 300, 300);
  const b = await at(page, 0, 480, 324);
  await drag(page, a, b);
  const name = page.getByLabel("Field name");
  await expect(name).toHaveValue("Text1");
  await name.fill("full_name");
  await page.getByLabel("Starting text").fill("Ada Lovelace");
  // Where the overlay drew it (the drag's ends are measured one after the
  // other, so the box is read back rather than assumed).
  const drawnField = await boxOf(
    page,
    '[data-editor-page="0"] [data-field-kind="text"] > rect',
  );
  expect(drawnField.width).toBeGreaterThan(150);

  // A dropdown, placed with a click, its second option chosen.
  await page.getByRole("button", { name: "Dropdown", exact: true }).click();
  let p = await at(page, 0, 380, 380);
  await page.mouse.click(p.x, p.y);
  await page.getByLabel("Chosen option").selectOption("Option 2");

  // A checkbox, ticked to start.
  await page.getByRole("button", { name: "Checkbox", exact: true }).click();
  p = await at(page, 0, 320, 420);
  await page.mouse.click(p.x, p.y);
  await page.getByLabel("Starts ticked").check();

  // Today's date and a check mark.
  await page.getByRole("button", { name: "Date", exact: true }).click();
  p = await at(page, 0, 400, 200);
  await page.mouse.click(p.x, p.y);
  await expect(said(page)).toContainText("Date placed");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  p = await at(page, 0, 120, 250);
  await page.mouse.click(p.x, p.y);
  await expect(said(page)).toContainText("Check mark placed");
  await expect(
    page.locator('[data-editor-page="0"] [data-object-kind="mark"]'),
  ).toHaveCount(1);
  const dateText = (await page
    .locator('[data-editor-page="0"] [data-object-kind="text"] text')
    .first()
    .textContent())!;
  await shot(page, "p3-forms.png");

  const buf = await captureDownload(
    page,
    page.getByRole("button", { name: /apply & download/i }),
  );
  const widgets = (await pdfAnnotations(buf))[0]!.annots.filter(
    (x) => x.subtype === "Widget",
  );
  const field = (n: string) => widgets.find((w) => w.fieldName === n)!;
  expect(field("city").fieldValue).toBe("Dhaka");
  expect(field("agree").fieldValue).not.toBe("Off");
  expect(field("full_name").fieldType).toBe("Tx");
  expect(field("full_name").fieldValue).toBe("Ada Lovelace");
  expectNear(field("full_name").rect, drawnField);
  expect(field("Dropdown1").fieldType).toBe("Ch");
  expect(field("Dropdown1").fieldValue).toEqual(["Option 2"]);
  expect(field("Checkbox1").checkBox).toBe(true);
  expect(field("Checkbox1").fieldValue).not.toBe("Off");
  expect((await pdfPageTexts(buf))[0]).toContain(dateText);
  expect(guard.pageErrors).toEqual([]);
  expect(guard.cspViolations()).toEqual([]);
});

/**
 * Every page's sheet inside the page view's visible width: its right edge
 * at or left of the scroll container's inner right edge. Measured from the
 * DOM after layout, so the rail, the panel and the scrollbar are all in it.
 */
async function pagesFit(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLElement>("[data-editor-viewport]")!;
    const vb = v.getBoundingClientRect();
    const left = vb.left + v.clientLeft;
    const right = left + v.clientWidth;
    const sheets = [...document.querySelectorAll("[data-editor-page]")].map(
      (s) => s.getBoundingClientRect(),
    );
    return {
      count: sheets.length,
      overflow: Math.max(...sheets.map((r) => r.right - right)),
      underflow: Math.max(...sheets.map((r) => left - r.left)),
    };
  });
}

for (const size of [
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
]) {
  test(`Fit width fits every page, a landscape one too, at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(size);
    await open(page);
    // The fixture's page 2 is turned (792 pt wide); turn page 1 as well.
    await page
      .locator('[data-page-rail="rail"]')
      .getByRole("button", { name: "Rotate page 1" })
      .click();
    await expect(page.locator("#editor-zoom")).toHaveValue("fit");
    await expect
      .poll(async () => (await pagesFit(page)).overflow)
      .toBeLessThanOrEqual(0.5);
    const fit = await pagesFit(page);
    expect(fit.count).toBe(3);
    expect(fit.underflow).toBeLessThanOrEqual(0.5);
    // Control: a zoom too large for the view is rejected by the same check.
    await page.locator("#editor-zoom").selectOption("4");
    await expect
      .poll(async () => (await pagesFit(page)).overflow)
      .toBeGreaterThan(100);
    // And Fit width brings every page back inside.
    await page.locator("#editor-zoom").selectOption("fit");
    await expect
      .poll(async () => (await pagesFit(page)).overflow)
      .toBeLessThanOrEqual(0.5);
    await shot(page, `p3-fit-${size.width}.png`);
  });
}
