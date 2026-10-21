import { test, expect, type Page } from "@playwright/test";
import {
  bring,
  DESK_SETS,
  dropOnDesk,
  LOCKED,
  ticketSettled,
  TICKET_NAME,
} from "./desk-files";
import { makePdfBytes, waitForHydration } from "./helpers";

/**
 * The home desk on a phone (390×844, touch — this project's device): the
 * thing a visitor can use is on the first screen, whole, in both its states.
 *
 * Measured, not assumed: the desk's top edge under 320px and its bottom
 * under 750px (redesign WP-05), with the files' ticket in the SAME box as the
 * empty desk — the swap changes what is drawn, not the height, so nothing
 * under the desk moves when files arrive.
 *
 * WAS one file set (two PDFs), the one whose ticket fitted: twenty-three PDFs
 * made the desk 484px tall and put its bottom at 768, past the bound this
 * file states, and nothing here dropped them (WP-05 review). Every set in
 * {@link DESK_SETS} is brought to the desk now.
 *
 * INVERTED 2026-10-21 (review of PR #199), history kept: on a phone the desk
 * no longer reserves the ticket's height — that reserve was the empty space
 * that pushed the tool chips to 1,083px — so the files' ticket opens in the
 * full-screen ticket dialog instead of in the box. What this file holds is
 * the same property from the other side: the box keeps its size and place
 * when files arrive (nothing under it moves), and the ticket is whole, in
 * the dialog, on the screen.
 */

const box = (page: Page) =>
  page.locator("[data-desk-stack] > [data-live]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top + window.scrollY),
      bottom: Math.round(r.bottom + window.scrollY),
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

async function idleDesk(page: Page) {
  await page.goto("/");
  await waitForHydration(page.locator("[data-desk]"));
  const idle = await box(page);
  // Health: the phone viewport applied.
  expect(idle.width).toBe(390);
  expect(
    idle.top,
    "the desk starts below the first screen's top third",
  ).toBeLessThan(320);
  expect(idle.bottom, "the desk runs off the first screen").toBeLessThan(750);
  return idle;
}

test("the desk is on the first screen, and touch is not offered a drop", async ({
  page,
}) => {
  await idleDesk(page);
  // Touch: no "drop them anywhere" — there is no pointer to drag with.
  await expect(
    page.getByText("or drop them anywhere on this page"),
  ).toBeHidden();
});

test("health: the corpus holds every shape the ticket lays out differently", () => {
  expect(DESK_SETS.length).toBeGreaterThanOrEqual(10);
});

for (const set of DESK_SETS) {
  test(`${set.name}: the ticket opens in the full-screen dialog, and the desk keeps its size and place`, async ({
    page,
  }) => {
    const idle = await idleDesk(page);
    await bring(page, set);
    await ticketSettled(page);
    const dialog = page.locator("dialog[data-ticket-dialog]");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("region", { name: TICKET_NAME }),
    ).toBeVisible();
    const sheet = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(sheet, "the dialog fills the phone's screen").toEqual({
      w: 390,
      h: 844,
    });
    const withFiles = await box(page);
    expect(withFiles).toEqual(idle);
    expect(
      withFiles.scrollWidth,
      "the page scrolls sideways",
    ).toBeLessThanOrEqual(withFiles.width);
  });
}

/**
 * What a row SHOWS — not its accessible name, which was always right — says
 * what its click carries, uncut, at 390px.
 *
 * WAS the end of a single truncated line: Merge PDF's "opens 2 of your 3
 * files" behind "2 PDFs · 15 pages · open…", Sign PDF's "takes one file —
 * contract.pdf" behind "2 PDFs · 15 pages · tak…" (read as if both files went
 * there), and Unlock PDF's reason behind "you'll add the file there ·
 * uploads only when …", with 150px of the ticket blank (WP-05 review).
 */
test.describe("each row shows what its click carries, uncut", () => {
  /** The lead of `row`'s line: its words, and whether it is cut. */
  async function lead(page: Page, slug: string) {
    const el = page
      .getByRole("region", { name: TICKET_NAME })
      .locator(`a[data-suggestion="${slug}"] [data-lead]`)
      .first();
    await expect(el).toBeVisible();
    return el.evaluate((node) => {
      const link = node.closest("a")!.getBoundingClientRect();
      const r = node.getBoundingClientRect();
      return {
        text: (node as HTMLElement).innerText,
        // An ellipsis cuts a line whose content is wider than its box.
        cut: node.scrollWidth > node.clientWidth,
        inside: r.left >= link.left && r.right <= link.right,
        rowY: Math.round(link.top),
      };
    });
  }
  const pdf = async (name: string, pages: number) => ({
    name,
    type: "application/pdf",
    b64: Buffer.from(await makePdfBytes(name, pages)).toString("base64"),
  });

  test("a Word file and two PDFs: Merge PDF, first, says it opens 2 of the 3", async ({
    page,
  }) => {
    await idleDesk(page);
    await dropOnDesk(page, [
      {
        name: "report.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        b64: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64"),
      },
      await pdf("contract.pdf", 12),
      await pdf("annex.pdf", 3),
    ]);
    const ticket = await ticketSettled(page);
    await expect(
      ticket.locator('[data-slot="suggestions"] a[data-suggestion]').first(),
    ).toHaveAttribute("data-suggestion", "merge-pdf");
    expect(await lead(page, "merge-pdf")).toMatchObject({
      text: "opens 2 of your 3 files",
      cut: false,
      inside: true,
    });
  });

  test("two PDFs: a one-file tool says which file it takes", async ({
    page,
  }) => {
    await idleDesk(page);
    await dropOnDesk(page, [
      await pdf("contract.pdf", 12),
      await pdf("annex.pdf", 3),
    ]);
    const ticket = await ticketSettled(page);
    const sign = ticket.getByRole("link", {
      name: /^Open Sign PDF with contract\.pdf$/,
    });
    await expect(sign).toBeVisible();
    expect(await lead(page, "sign-pdf")).toMatchObject({
      text: "takes one file — contract.pdf",
      cut: false,
      inside: true,
    });
  });

  // WAS "…Unlock PDF, first, says the click carries nothing": its lead read
  // "you'll add locked.pdf there". Unlock PDF stages a carried file since
  // WP-10, so the click carries it and the lead says when it moves.
  test("a PDF that needs a password: Unlock PDF, first, takes the file — and why it is first, in full", async ({
    page,
  }) => {
    await idleDesk(page);
    await dropOnDesk(page, [LOCKED]);
    const ticket = await ticketSettled(page);
    await expect(
      ticket.locator('[data-slot="suggestions"] a[data-suggestion]').first(),
    ).toHaveAttribute("data-suggestion", "unlock-pdf");
    expect(await lead(page, "unlock-pdf")).toMatchObject({
      text: "uploads only when you start it",
      cut: false,
      inside: true,
    });
    // The reason, in the note slot, wrapped and whole (the spec's sentence:
    // the lock, and that the other tools open it after Unlock PDF).
    const note = ticket.locator('[data-slot="note"]');
    await expect(note).toHaveText(
      /^locked\.pdf needs a password to open — \d+ other tools open it after Unlock PDF\.$/,
    );
    const clamp = await note
      .locator(".line-clamp-2")
      .evaluate((el) => el.scrollHeight <= el.clientHeight);
    expect(clamp, "the reason is cut at two lines").toBe(true);
  });
});

/*
 * INVERTED 2026-10-21, history kept. This was "each task shows where its tool
 * runs, and the legend says what the shapes mean": the desk's six "Start
 * from a task" links, each named with its mode word ("Make a scan
 * searchable, Secure worker") and drawn with two glyphs. The owner's plain
 * redesign took the task list out of the desk — every tool is now a card
 * under the hero, its badge in plain words — so the list must be GONE, and
 * where a tool runs is said on its card, visibly, on a phone too.
 */
test("the desk carries no task list; each card says where its tool runs, in plain words", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("list", { name: "Start from a task" }),
  ).toHaveCount(0);
  const card = page
    .locator("section#tools ul[data-tool-grid] > li")
    .filter({ has: page.locator('a[href="/tools/ocr-pdf"]') });
  await expect(card).toBeVisible();
  await expect(card.getByText("Secure server", { exact: true })).toBeVisible();
  await expect(card).not.toContainText(/worker/i);
});
