import { test, expect } from "@playwright/test";
import { axeViolations } from "./chat-citations-fixture";
import {
  expectSentAsSeen,
  mockSignatureWorker,
  openWithPdf,
  seenBoxes,
} from "./request-signatures-fixture";

/**
 * Request Signatures: place the boxes (audit #21, 2026-11-17), in the served
 * page with the worker mocked at the wire. The reader drags, resizes,
 * nudges, adds every type on pages 1 and 3 (page 3 is turned /Rotate 90 with
 * an inset crop), removes one, writes a two-line message and prepares; the
 * job options the page POSTs are then held to what the sheet SHOWED — each
 * box's on-screen rectangle, as bottom-left fractions, within half a pixel.
 */
test("drag, resize, nudge, add on pages 1 and 3, delete: the request carries exactly the boxes shown", async ({
  page,
}) => {
  const { sent, unanswered } = await mockSignatureWorker(page);
  const sheet = await openWithPdf(page);
  await expect(page.getByText(/^Page 3 of 3\./)).toBeVisible();

  // Drag the signature box toward the top-right.
  const sig = sheet.getByRole("button", { name: /Signature box, page 3/ });
  // Geometry is read off the box's outline, the field as drawn; its button
  // is that rectangle grown to a 24 px target.
  const outline = sheet.locator('[data-field-box][data-kind="signature"]');
  await sheet.scrollIntoViewIfNeeded();
  const b = (await outline.boundingBox())!;
  const s = (await sheet.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 - 80, {
    steps: 6,
  });
  await page.mouse.up();
  // Measured against the sheet: the panel's controls above it change once
  // the layout is the reader's own, so the sheet itself may have moved.
  const s1 = (await sheet.boundingBox())!;
  const moved = (await outline.boundingBox())!;
  expect(moved.x - s1.x).toBeGreaterThan(b.x - s.x + 50);
  expect(moved.y - s1.y).toBeLessThan(b.y - s.y - 70);
  // Shift+ArrowLeft once: 10 pt left (the box kept focus from the drag).
  await expect(sig).toBeFocused();
  await page.keyboard.press("Shift+ArrowLeft");
  const nudged = (await outline.boundingBox())!;
  expect(nudged.x).toBeLessThan(moved.x);
  // Resize from the corner handle: wider and taller, top-left fixed.
  const handle = sheet.getByRole("button", {
    name: "Resize Signer 1 Signature box",
  });
  await sheet.scrollIntoViewIfNeeded();
  const before = (await outline.boundingBox())!;
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 20, h.y + h.height / 2 + 15, {
    steps: 4,
  });
  await page.mouse.up();
  const resized = (await outline.boundingBox())!;
  const s2 = (await sheet.boundingBox())!;
  expect(resized.width).toBeGreaterThan(before.width + 15);
  expect(resized.height).toBeGreaterThan(before.height + 10);
  expect(Math.abs(resized.x - before.x)).toBeLessThan(1);
  expect(Math.abs(resized.y - before.y)).toBeLessThan(1);
  expect(resized.x + resized.width).toBeLessThanOrEqual(s2.x + s2.width + 0.5);

  // Add Initials and Date on page 3.
  await page.getByRole("button", { name: "Initials", exact: true }).click();
  await page.getByRole("button", { name: "Date", exact: true }).click();
  await expect(sheet.locator("[data-field-box]")).toHaveCount(4);
  // Delete a Date box with the keyboard. `.first()` in reading order is
  // the Date just added (centred, id 4), not the starting one (id 2), so
  // the page-1 boxes added below take ids 4, 5 and 6. axe names boxes by
  // id: main's target-size failure on 8f379e1a named box 4, the page-1
  // Name box, not a page-3 one.
  const newDate = sheet
    .getByRole("button", { name: /Date box, page 3/ })
    .first();
  await newDate.focus();
  await page.keyboard.press("Delete");
  await expect(sheet.locator("[data-field-box]")).toHaveCount(3);
  await expect(page.getByText(/^Removed Signer 1 Date box$/)).toBeVisible();

  // Page 1: Name, Text and a Signature.
  await page.getByRole("button", { name: "Previous page" }).click();
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page.getByText(/^Page 1 of 3\./)).toBeVisible();
  for (const name of ["Name", "Text", "Signature"])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(sheet.locator("[data-field-box]")).toHaveCount(3);
  // Label the Text box from the list.
  const rows = page.locator("[data-box-row]");
  // The row reads "Box N, middle dot, Text"; the dot is built from its code point.
  const textRow = rows
    .filter({ hasText: `${String.fromCodePoint(0xb7)} Text` })
    .last();
  await textRow.getByRole("textbox").fill("Witness");

  // A two-line message.
  await page
    .getByLabel(/Message to signers/)
    .fill("Please sign by Friday.\nThank you.");

  // Axe on the editor as it stands.
  expect(await axeViolations(page)).toEqual([]);

  // What the sheet shows, on both pages.
  const page1 = await seenBoxes(sheet);
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText(/^Page 3 of 3\./)).toBeVisible();
  const page3 = await seenBoxes(sheet);

  await page.getByRole("button", { name: "Prepare signature request" }).click();
  await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
  const options = sent[0]!.options;
  expect(options.fields).toHaveLength(6);
  expect(options.fields.every((f) => f.signer === 0)).toBe(true);
  expectSentAsSeen(options.fields, page1, 1);
  expectSentAsSeen(options.fields, page3, 3);
  expect(new Set(options.fields.map((f) => f.type))).toEqual(
    new Set(["signature", "initials", "date", "text"]),
  );
  expect(
    options.fields
      .filter((f) => f.label)
      .map((f) => f.label)
      .sort(),
  ).toEqual(["Name", "Witness"]);
  expect(options.message).toBe("Please sign by Friday. Thank you.");
  expect(options.message).not.toMatch(/[\r\n]/);
  expect(unanswered).toEqual([]);
});
