import { expect, test, type Page } from "@playwright/test";
import { makePdfBytes, waitForHydration } from "./helpers";

/**
 * The command palette in a real browser (WP-09): the shortcut from the page,
 * the lazy chunk, a native modal `<dialog>`, a real file chooser, and the
 * ticket dialog behind it. The combobox contract itself — roles, names,
 * which option is active — is `command-palette.test.tsx`; this file holds
 * what only a browser can: that the keys reach it from the page, that focus
 * comes back, that a picked or dropped file arrives in the ticket.
 */

const trigger = (page: Page) =>
  page.getByRole("button", { name: "Find a tool or guide" });
const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Find a tool or guide" });
const combobox = (page: Page) =>
  palette(page).getByRole("combobox", { name: "Find a tool or guide" });
const ticketDialog = (page: Page) =>
  page.getByRole("dialog", { name: "What you can do with these files" });

/** The header is live: React has claimed the trigger. */
async function headerLive(page: Page) {
  await waitForHydration(trigger(page));
}

/** The option the combobox says is active. */
async function activeOption(page: Page) {
  const id = await combobox(page).getAttribute("aria-activedescendant");
  expect(id, "no active option").toBeTruthy();
  return page.locator(`[id="${id}"]`);
}

test("Ctrl+K opens it; 'shrink', the arrows, Enter lands on Compress PDF", async ({
  page,
}) => {
  await page.goto("/tools");
  await headerLive(page);
  await page.locator("main h1").click();
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await expect(combobox(page)).toBeFocused();
  await combobox(page).pressSequentially("shrink");
  await expect(await activeOption(page)).toHaveAttribute(
    "data-href",
    "/tools/compress-pdf",
  );
  // The arrows move the active option, and back.
  const first = await combobox(page).getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  await expect(combobox(page)).not.toHaveAttribute(
    "aria-activedescendant",
    first!,
  );
  await page.keyboard.press("ArrowUp");
  await expect(combobox(page)).toHaveAttribute("aria-activedescendant", first!);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);
  await expect(palette(page)).toHaveCount(0);
});

test("Escape closes it and returns focus to the trigger", async ({ page }) => {
  await page.goto("/");
  await headerLive(page);
  await trigger(page).click();
  await expect(combobox(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  // And the shortcut opens it from wherever focus is.
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger(page)).toBeFocused();
});

test("'Open a file…' opens a picker whose files open the ticket dialog", async ({
  page,
}) => {
  // /tools has no drop target of its own (E.5), so the page's picker is the
  // drop layer's, and what it picks goes to the ticket dialog.
  await page.goto("/tools");
  await headerLive(page);
  await page.locator("html[data-drop-layer]").waitFor({ state: "attached" });
  await page.keyboard.press("Control+k");
  await combobox(page).pressSequentially("open a file");
  await expect(await activeOption(page)).toContainText("Open a file");
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const picker = await chooser;
  await expect(palette(page)).toHaveCount(0);
  await picker.setFiles({
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await makePdfBytes("report", 2)),
  });
  await expect(ticketDialog(page)).toBeVisible();
  await expect(ticketDialog(page)).toContainText("report.pdf");
});

test("a file dropped on the open palette closes it and shows the ticket", async ({
  page,
}) => {
  await page.goto("/tools");
  await headerLive(page);
  await page.locator("html[data-drop-layer]").waitFor({ state: "attached" });
  await trigger(page).click();
  await expect(palette(page)).toBeVisible();
  const bytes = Buffer.from(await makePdfBytes("dropped", 1)).toString(
    "base64",
  );
  const dataTransfer = await page.evaluateHandle((b64) => {
    const dt = new DataTransfer();
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    dt.items.add(new File([buf], "dropped.pdf", { type: "application/pdf" }));
    return dt;
  }, bytes);
  await palette(page).dispatchEvent("dragenter", { dataTransfer });
  await palette(page).dispatchEvent("dragover", { dataTransfer });
  await palette(page).dispatchEvent("drop", { dataTransfer });
  await expect(palette(page)).toHaveCount(0);
  await expect(ticketDialog(page)).toBeVisible();
  await expect(ticketDialog(page)).toContainText("dropped.pdf");
});

test("on /tools?category=ai only AI tools is current in the header", async ({
  page,
}) => {
  await page.goto("/tools?category=ai");
  const primary = page.getByRole("navigation", { name: "Primary" });
  const ai = primary.getByRole("link", { name: "AI tools" });
  await waitForHydration(ai);
  await expect(ai).toHaveAttribute("aria-current", "page");
  await expect(primary.locator("[aria-current]")).toHaveCount(1);
  await expect(
    primary.getByRole("link", { name: "All tools" }),
  ).not.toHaveAttribute("aria-current", /.*/);
});

test("the /tools explorer's AI chip makes AI tools current in the header, in place", async ({
  page,
}) => {
  // The chain: the chip rewrites the query with replaceState (no
  // navigation), announces it, and the header's links read it again.
  await page.goto("/tools");
  const chip = page.getByRole("button", { name: /^AI/ });
  await waitForHydration(chip);
  const primary = page.getByRole("navigation", { name: "Primary" });
  await expect(primary.locator("[aria-current]")).toHaveText(["All tools"]);
  await chip.click();
  await expect(page).toHaveURL(/[?&]category=ai/);
  await expect(primary.locator("[aria-current]")).toHaveText(["AI tools"]);
});

test("the header renders no file input", async ({ page }) => {
  await page.goto("/");
  await headerLive(page);
  await expect(page.getByRole("banner").locator("input")).toHaveCount(0);
});

test.describe("at 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the palette is full-screen, with a Cancel that closes it", async ({
    page,
  }) => {
    await page.goto("/");
    await headerLive(page);
    await trigger(page).click();
    await expect(palette(page)).toBeVisible();
    const box = (await palette(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(390);
    expect(box.height).toBe(844);
    const cancel = palette(page).getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(palette(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });

  test("the menu closes on Escape and on a route change, returning focus", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Open menu" });
    await waitForHydration(toggle);
    await toggle.click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();

    await toggle.click();
    await expect(menu).toBeVisible();
    await menu
      .getByRole("navigation", { name: "Menu" })
      .getByRole("link", { name: "Guides" })
      .click();
    await expect(page).toHaveURL(/\/guides$/);
    await expect(menu).toBeHidden();
  });
});
