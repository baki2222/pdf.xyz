import { expect, test, type Page } from "@playwright/test";
import { injectAxe, SETTLE_FRAME_LIMIT } from "./axe-inject";

/**
 * e2e/axe-inject.ts's wait, proved where it is consumed: an `axe.run` on a
 * real page with the site's own smooth scrolling.
 *
 * - A run asked for mid-scroll starts where the scroll ends. Each run's
 *   checks include a built-in control: the position at the moment of the
 *   call, which is where a run without the wait would have read the page.
 * - A page that never stops scrolling fails the run by name, rather than
 *   letting it pass.
 * - Positive control: the wait delays a run and never empties it. Two
 *   undersized targets too close together are still reported, by a run
 *   that also started mid-scroll.
 */

type AxeRun = (
  ctx: Document,
  opts: object,
) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }>;

const TARGET_SIZE = { runOnly: { type: "rule", values: ["target-size"] } };

async function longPage(page: Page): Promise<void> {
  await page.goto("/tools");
  // Health: the site scrolls smoothly here, and there is room to scroll.
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe("smooth");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    ),
  ).toBeGreaterThan(1500);
}

test("a run asked for mid-scroll starts where the scroll ends", async ({
  page,
}) => {
  await longPage(page);
  await page.evaluate(() =>
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    }),
  );
  await injectAxe(page);
  const got = await page.evaluate(async (opts) => {
    const w = window as unknown as {
      axe: { run: AxeRun };
      __axeRunScrollY: number[];
    };
    const from = window.scrollY;
    window.scrollTo({ top: 0 }); // the site's smooth scroll
    const atCall = window.scrollY;
    await w.axe.run(document, opts);
    return { from, atCall, atRun: w.__axeRunScrollY.at(-1) };
  }, TARGET_SIZE);
  expect(got.from).toBeGreaterThan(1500);
  // Without the wait, the run would have read the page here, mid-way:
  expect(got.atCall).toBeGreaterThan(0);
  // With it, the run read the page where the scroll ends.
  expect(got.atRun).toBe(0);
});

test("a page that never stops scrolling fails the run by name", async ({
  page,
}) => {
  await longPage(page);
  await injectAxe(page);
  const message = await page.evaluate(async (opts) => {
    let on = true;
    const tick = () => {
      if (!on) return;
      window.scrollTo({
        top: window.scrollY === 0 ? 400 : 0,
        behavior: "instant",
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      await (window as unknown as { axe: { run: AxeRun } }).axe.run(
        document,
        opts,
      );
      return "the run passed";
    } catch (e) {
      return String(e);
    } finally {
      on = false;
    }
  }, TARGET_SIZE);
  expect(message).toContain(
    `the page was still scrolling after ${SETTLE_FRAME_LIMIT} frames`,
  );
});

test("positive control: a real target-size failure on a still page is still reported", async ({
  page,
}) => {
  await longPage(page);
  // Two 16 px buttons 4 px apart: each is under 24 px, and each one's
  // 24 px circle meets the other, so neither the size nor the spacing
  // exception applies. Planted mid-page, then the page scrolled to them
  // with the site's smooth scroll, so the run starts mid-scroll too.
  await page.evaluate(() => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:4px;margin:600px 0";
    for (const id of ["planted-a", "planted-b"]) {
      const b = document.createElement("button");
      b.id = id;
      b.textContent = "x";
      b.style.cssText = "width:16px;height:16px;padding:0;margin:0";
      row.append(b);
    }
    document.querySelector("main")!.append(row);
  });
  await injectAxe(page);
  const found = await page.evaluate(async (opts) => {
    document.getElementById("planted-a")!.scrollIntoView({ block: "center" });
    const r = await (window as unknown as { axe: { run: AxeRun } }).axe.run(
      document,
      opts,
    );
    return r.violations.flatMap((v) =>
      v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`),
    );
  }, TARGET_SIZE);
  expect(found).toEqual(
    expect.arrayContaining([
      "target-size: #planted-a",
      "target-size: #planted-b",
    ]),
  );
});
