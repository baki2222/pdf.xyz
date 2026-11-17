import { test, expect, type Page } from "@playwright/test";
import { axeViolations } from "./chat-citations-fixture";
import {
  expectSentAsSeen,
  mockSignatureWorker,
  openWithPdf,
  seenBoxes,
} from "./request-signatures-fixture";

/**
 * Request Signatures' placement editor on a 375 x 812 touch phone (audit
 * #21, 2026-11-17): a box dragged with a FINGER (real touch events through
 * the DevTools protocol, so Chromium makes the pointer events, pointerType
 * "touch"), the resize handle and the add buttons at least 44 px, every box
 * a 24 px target, and the page never wider than the phone.
 */
test.use({ viewport: { width: 375, height: 812 } });

async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [
    { x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(from.x, from.y),
  });
  for (let i = 1; i <= steps; i += 1)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
      ),
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

test("a finger drags a box; handles and add buttons are 44 px, boxes 24 px; the page does not widen", async ({
  page,
}) => {
  const { sent, unanswered } = await mockSignatureWorker(page);
  const sheet = await openWithPdf(page);
  await sheet.scrollIntoViewIfNeeded();
  const sig = sheet.getByRole("button", { name: /Signature box, page 3/ });
  const s0 = (await sheet.boundingBox())!;
  const b0 = (await sig.boundingBox())!;
  // Every box's button is a 24 px target, however small the page draws it.
  for (const button of await sheet.locator("button[data-box-id]").all()) {
    const r = (await button.boundingBox())!;
    expect(r.width).toBeGreaterThanOrEqual(24 - 0.01);
    expect(r.height).toBeGreaterThanOrEqual(24 - 0.01);
  }

  // A finger drags it 40 px right and 60 px up.
  await touchDrag(
    page,
    { x: b0.x + b0.width / 2, y: b0.y + b0.height / 2 },
    { x: b0.x + b0.width / 2 + 40, y: b0.y + b0.height / 2 - 60 },
  );
  await expect(sig).toHaveAttribute("aria-pressed", "true");
  const s1 = (await sheet.boundingBox())!;
  const b1 = (await sig.boundingBox())!;
  expect(b1.x - s1.x - (b0.x - s0.x)).toBeGreaterThan(30);
  expect(b0.y - s0.y - (b1.y - s1.y)).toBeGreaterThan(45);

  // The selected box's resize handle, and the add buttons, are 44 px.
  const handle = sheet.getByRole("button", {
    name: "Resize Signer 1 Signature box",
  });
  const h = (await handle.boundingBox())!;
  expect(h.width).toBeGreaterThanOrEqual(44 - 0.01);
  expect(h.height).toBeGreaterThanOrEqual(44 - 0.01);
  for (const name of ["Signature", "Initials", "Date", "Name", "Text"]) {
    const r = (await page
      .getByRole("button", { name, exact: true })
      .boundingBox())!;
    expect(r.height, name).toBeGreaterThanOrEqual(44 - 0.01);
  }

  // The page never scrolls sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await axeViolations(page)).toEqual([]);

  const seen = await seenBoxes(sheet);
  await page.getByRole("button", { name: "Prepare signature request" }).click();
  await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
  expectSentAsSeen(sent[0]!.options.fields, seen, 3);
  expect(unanswered).toEqual([]);
});

// Review 2026-11-17: Initials then Date on a phone overlapped their 24 px
// buttons (axe target-size), because new boxes were spaced by a fixed 40 pt
// and a phone draws a page smaller. The first test ran axe before any box
// was added, so it never saw this.
test("two boxes added back to back keep their buttons and the resize handle apart; axe stays clean", async ({
  page,
}) => {
  const { unanswered } = await mockSignatureWorker(page);
  const sheet = await openWithPdf(page);
  await sheet.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Initials", exact: true }).click();
  await page.getByRole("button", { name: "Date", exact: true }).click();
  const buttons = await sheet.locator("button[data-box-id]").all();
  expect(buttons.length).toBe(4);
  const rects = await Promise.all(
    buttons.map(async (b) => (await b.boundingBox())!),
  );
  const handle = (await sheet.locator("[data-resize-handle]").boundingBox())!;
  const apart = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x + a.width <= b.x + 0.5 ||
    b.x + b.width <= a.x + 0.5 ||
    a.y + a.height <= b.y + 0.5 ||
    b.y + b.height <= a.y + 0.5;
  for (let i = 0; i < rects.length; i += 1)
    for (let j = i + 1; j < rects.length; j += 1)
      expect(apart(rects[i]!, rects[j]!), `buttons ${i} and ${j}`).toBe(true);
  // The new Date box is selected; its 44 px handle reaches no other button.
  const selected = await sheet
    .locator('button[data-box-id][aria-pressed="true"]')
    .getAttribute("data-box-id");
  for (const [i, b] of buttons.entries()) {
    if ((await b.getAttribute("data-box-id")) === selected) continue;
    expect(apart(handle, rects[i]!), `handle and button ${i}`).toBe(true);
  }
  // The list's bins and the signer row's bin are 44 px on touch, like Show.
  const bins = [
    ...(await page.getByRole("button", { name: /^Remove box \d+,/ }).all()),
    page.getByRole("button", { name: "Remove signer 1" }),
  ];
  expect(bins.length).toBe(5);
  for (const bin of bins) {
    const r = (await bin.boundingBox())!;
    expect(r.width).toBeGreaterThanOrEqual(44 - 0.01);
    expect(r.height).toBeGreaterThanOrEqual(44 - 0.01);
  }
  expect(await axeViolations(page)).toEqual([]);
  expect(unanswered).toEqual([]);
});
