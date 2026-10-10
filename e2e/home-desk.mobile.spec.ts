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
  test(`${set.name}: the ticket takes the desk's place at the same size, on the first screen`, async ({
    page,
  }) => {
    const idle = await idleDesk(page);
    await bring(page, set);
    await ticketSettled(page);
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

  test("a PDF that needs a password: Unlock PDF, first, says the click carries nothing — and why it is first, in full", async ({
    page,
  }) => {
    await idleDesk(page);
    await dropOnDesk(page, [LOCKED]);
    const ticket = await ticketSettled(page);
    await expect(
      ticket.locator('[data-slot="suggestions"] a[data-suggestion]').first(),
    ).toHaveAttribute("data-suggestion", "unlock-pdf");
    expect(await lead(page, "unlock-pdf")).toMatchObject({
      text: "you'll add locked.pdf there",
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

test("each task shows where its tool runs, and the legend says what the shapes mean", async ({
  page,
}) => {
  await page.goto("/");
  const tasks = page.getByRole("list", { name: "Start from a task" });
  const links = tasks.getByRole("link");
  await expect(links).toHaveCount(6);
  // The mode word is not drawn on a phone, but it is in each link's name.
  await expect(
    tasks.getByRole("link", {
      // The sr-only word is a separate box: the name puts a space before it.
      name: /^Make a scan searchable\s?, Secure worker$/,
    }),
  ).toBeVisible();
  for (const link of await links.all())
    expect(
      await link.locator("svg[aria-hidden]").count(),
    ).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("uploads only when you start it")).toBeVisible();
});
