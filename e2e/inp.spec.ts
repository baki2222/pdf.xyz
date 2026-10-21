import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { waitForHydration } from "./helpers";

/**
 * The desk measures a PDF on the page's own thread (decision D-4: pdf-lib
 * parses with `ParseSpeeds.Slow`, yielding every 100 objects, rather than in
 * a worker that would download pdf-lib a second time). That is only sound if
 * the page still answers while it does — so this drops a 2,000-page PDF on
 * the desk and, WHILE it is being read, presses Clear, drops it again and
 * opens a task. Every interaction's Event Timing duration must stay under
 * 200 ms (the INP "good" bound).
 *
 * If this fails, the plan says so (spec G.2): move `probePdf` into a module
 * worker and record the extra pdf-lib download.
 */
const PAGES = 2000;
const BUDGET_MS = 200;

declare global {
  interface Window {
    __events?: { name: string; duration: number; target: string }[];
  }
}

test("the page answers within 200 ms while a 2,000-page PDF is measured", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const doc = await PDFDocument.create();
  for (let i = 0; i < PAGES; i++) doc.addPage([200, 200]);
  const b64 = Buffer.from(await doc.save()).toString("base64");

  await page.addInitScript(() => {
    window.__events = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        if (!e.interactionId) continue;
        window.__events!.push({
          name: e.name,
          duration: e.duration,
          target:
            (e.target as Element | null)?.tagName?.toLowerCase() ?? "(gone)",
        });
      }
    }).observe({
      type: "event",
      buffered: true,
      // Event Timing's own option, not yet in the DOM typings.
      durationThreshold: 16,
    } as PerformanceObserverInit);
  });
  await page.goto("/");
  const desk = page.locator("[data-desk]");
  await waitForHydration(desk);

  const drop = async () => {
    const dataTransfer = await page.evaluateHandle((data) => {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "long.pdf", { type: "application/pdf" }));
      return dt;
    }, b64);
    await desk.dispatchEvent("dragenter", { dataTransfer });
    await desk.dispatchEvent("drop", { dataTransfer });
  };

  const ticket = page.getByRole("region", {
    name: "What you can do with these files",
  });
  await drop();
  await expect(ticket).toBeVisible();
  // At once — the pages are still being counted (a 2,000-page parse takes
  // far longer than a frame): Clear, a real click.
  await ticket.getByRole("button", { name: /^clear/i }).click();
  await expect(ticket).toHaveCount(0);

  await drop();
  await expect(ticket).toBeVisible();
  await ticket.getByRole("button", { name: /^clear/i }).click();
  // A tool, opened while the first measurement may still be finishing. WAS
  // the desk's "Combine PDFs" task link, retired 2026-10-21; its tool's card
  // is the same link to the same page.
  await page.locator('section#tools a[href="/tools/merge-pdf"]').click();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);

  const events = await page.evaluate(() => window.__events ?? []);
  // Health: the observer saw the clicks it was meant to time.
  expect(
    events.filter((e) => e.name === "click" || e.name === "pointerup").length,
  ).toBeGreaterThanOrEqual(2);
  const slow = events.filter((e) => e.duration >= BUDGET_MS);
  expect(
    slow.map((e) => `${e.name} on ${e.target}: ${Math.round(e.duration)} ms`),
  ).toEqual([]);
});
