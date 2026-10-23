import { expect, test, type Page } from "@playwright/test";
import { uploadFiles, waitForHydration, writeTempPdf } from "./helpers";

/**
 * The motion layer in a real browser (spec WP-12, F.1). Four properties:
 *
 * WORDS STAY. No running animation may move, fade, blur or clip an element
 * that carries text, or an ancestor of text — the server rendered those words
 * for readers and crawlers, and a word that arrives late is a word a reader
 * waited for. Ink moves instead: marks, rules, squares, the parts of a glyph.
 * Transient UI inside `[data-motion-ui]` (dialogs, the ticket) is exempt.
 * Sampled while each page is scrolled to its end, so a scroll-driven motion
 * is seen where it runs.
 *
 * THE SIGNATURE IS FED BY THE RUN (composed chain): a merge in the page moves
 * the masthead logo's P through `busy` to `done` — runner → `useAsyncRun` →
 * bus → header — and the same run finishing in a hidden tab puts "Done · " on
 * the tab's title until the tab is shown again.
 *
 * A TILE TURNS THE SHORT WAY (M25): "Right" from 270° passes through 315°,
 * not back through 135°.
 *
 * THE VIEW-TRANSITION GATE runs only on a build made with
 * `PDFXYZ_VIEW_TRANSITIONS=1`; see the block at the end.
 */

/** The transform family, plus the three properties that hide words. */
const MOVING = [
  "opacity",
  "transform",
  "translate",
  "rotate",
  "scale",
  "filter",
  "clipPath",
];

/** Running animations that move words, described; and how many ran at all. */
async function wordsMoved(
  page: Page,
): Promise<{ moved: string[]; running: number }> {
  return page.evaluate((moving) => {
    const running = document
      .getAnimations()
      .filter((a) => a.playState === "running");
    const moved: string[] = [];
    for (const a of running) {
      const effect = a.effect as KeyframeEffect | null;
      const target = effect?.target as Element | null | undefined;
      if (!effect || !target) continue;
      // A ::before/::after carries no text of the page's.
      if (effect.pseudoElement) continue;
      const props = new Set(
        effect.getKeyframes().flatMap((k) => Object.keys(k)),
      );
      const hit = moving.filter((p) => props.has(p));
      if (hit.length === 0) continue;
      if (target.closest("[data-motion-ui]")) continue;
      if (!(target.textContent ?? "").trim()) continue;
      const name =
        (a as CSSAnimation).animationName ??
        (a as CSSTransition).transitionProperty ??
        a.id ??
        "script";
      moved.push(
        `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ""} "${(target.textContent ?? "").trim().slice(0, 40)}" — ${name}: ${hit.join(", ")}`,
      );
    }
    return { moved, running: running.length };
  }, MOVING);
}

/** Scroll to the end in steps, sampling at each. */
async function sampleWhileScrolling(
  page: Page,
): Promise<{ moved: string[]; running: number }> {
  const all = new Set<string>();
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    const { moved, running } = await wordsMoved(page);
    moved.forEach((m) => all.add(m));
    peak = Math.max(peak, running);
    const atEnd = await page.evaluate(() => {
      window.scrollBy(0, Math.round(window.innerHeight * 0.6));
      return (
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2
      );
    });
    await page.waitForTimeout(120);
    if (atEnd) break;
  }
  const last = await wordsMoved(page);
  last.moved.forEach((m) => all.add(m));
  return { moved: [...all], running: Math.max(peak, last.running) };
}

/** The first guide the index links. */
async function firstGuide(page: Page): Promise<string> {
  await page.goto("/guides");
  const href = await page
    .locator('main a[href^="/guides/"]')
    .first()
    .getAttribute("href");
  expect(href, "the guides index links no guide").toMatch(/^\/guides\/.+/);
  return href!;
}

test.describe("words stay", () => {
  test("no running animation moves words on the home page, the catalogue, a tool or a guide", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const guide = await firstGuide(page);
    const report: string[] = [];
    for (const route of ["/", "/tools", "/tools/merge-pdf", guide]) {
      await page.goto(route);
      await waitForHydration(page.locator("header a").first());
      const { moved } = await sampleWhileScrolling(page);
      report.push(...moved.map((m) => `${route}: ${m}`));
    }
    expect(report).toEqual([]);
  });

  test("positive control: the home page runs motion, and a fading word is caught", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHydration(page.locator("header a").first());
    // The masthead lift and the stats rule are scroll-linked and exist from
    // load: a page with motion that this reader cannot see would read zero.
    const { running } = await sampleWhileScrolling(page);
    expect(running).toBeGreaterThanOrEqual(1);
    // The detector itself: a word faded in is reported; the same fade inside
    // `[data-motion-ui]`, or on a mark with no text, is not.
    await page.evaluate(() => {
      const add = (html: string) => {
        const div = document.createElement("div");
        div.innerHTML = html;
        document.body.append(div);
        return div;
      };
      const fade = [{ opacity: 0 }, { opacity: 1 }];
      add('<p id="ws-word">words</p>')
        .querySelector("p")!
        .animate(fade, { duration: 10_000 });
      add('<div data-motion-ui><p id="ws-ui">dialog</p></div>')
        .querySelector("p")!
        .animate(fade, { duration: 10_000 });
      add('<span id="ws-mark"></span>')
        .querySelector("span")!
        .animate([{ transform: "scaleX(0)" }, { transform: "none" }], {
          duration: 10_000,
        });
    });
    const { moved } = await wordsMoved(page);
    expect(moved.map((m) => m.split(" ")[0])).toEqual(["p#ws-word"]);
  });
});

/**
 * Lets a test read the run's length as long. `performance.now()` gains 4s the
 * moment the masthead logo's P says `busy`, which is AFTER the bus took the
 * run's start time — so the run ends "4s later" without the test waiting or
 * the product carrying a hook for it. And a hidden tab, on request.
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    let offset = 0;
    performance.now = () => realNow() + offset;
    const w = window as unknown as {
      __activity: string[];
      __setHidden: (h: boolean) => void;
    };
    w.__activity = [];
    let hidden = false;
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    Object.defineProperty(Document.prototype, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    w.__setHidden = (h) => {
      hidden = h;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    const watch = () => {
      const mark = document.querySelector("header [data-activity]");
      if (!mark) return void requestAnimationFrame(watch);
      w.__activity.push(mark.getAttribute("data-activity")!);
      new MutationObserver(() => {
        const state = mark.getAttribute("data-activity")!;
        w.__activity.push(state);
        if (state === "busy") offset += 4000;
      }).observe(mark, {
        attributes: true,
        attributeFilter: ["data-activity"],
      });
    };
    document.addEventListener("DOMContentLoaded", watch);
  });
}

async function mergeTwo(page: Page) {
  await uploadFiles(page, [
    await writeTempPdf("alpha.pdf", 2),
    await writeTempPdf("beta.pdf", 1),
  ]);
  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
}

test("a merge moves the masthead logo's P through busy to done", async ({
  page,
}) => {
  await instrument(page);
  await page.goto("/tools/merge-pdf");
  await mergeTwo(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __activity: string[] }).__activity,
      ),
    )
    .toEqual(expect.arrayContaining(["busy", "done"]));
  const seen = await page.evaluate(
    () => (window as unknown as { __activity: string[] }).__activity,
  );
  expect(seen[0], "the P renders idle before any run").toBe("idle");
  expect(seen.indexOf("busy")).toBeLessThan(seen.lastIndexOf("done"));
});

test("a run that finishes in a hidden tab says so in the title, until the tab is shown", async ({
  page,
}) => {
  await instrument(page);
  await page.goto("/tools/merge-pdf");
  const title = await page.title();
  expect(title).not.toMatch(/^Done · /);
  await page.evaluate(() =>
    (window as unknown as { __setHidden: (h: boolean) => void }).__setHidden(
      true,
    ),
  );
  await mergeTwo(page);
  await expect.poll(() => page.title()).toBe(`Done · ${title}`);
  const icon = page.locator('link[rel~="icon"][type="image/svg+xml"]');
  await expect(icon).toHaveAttribute("href", /^data:image\/svg\+xml,/);
  await page.evaluate(() =>
    (window as unknown as { __setHidden: (h: boolean) => void }).__setHidden(
      false,
    ),
  );
  await expect.poll(() => page.title()).toBe(title);
  await expect(icon).not.toHaveAttribute("href", /^data:/);
});

test("Right from 270° turns the tile forward through 315°, not back through 135°", async ({
  page,
}) => {
  await page.goto("/tools/rotate-pdf");
  await uploadFiles(page, await writeTempPdf("turn.pdf", 1));
  const left = page.getByRole("button", { name: "Left", exact: true });
  await expect(left).toBeEnabled();
  await left.click();
  // Settled at 270° (−90° drawn), with the transition finished.
  await page.waitForTimeout(700);
  const angle = await page.evaluate(async () => {
    const sheet = document.querySelector<HTMLElement>('[style*="rotate("]')!;
    const right = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Right",
    )!;
    right.click();
    await new Promise((r) => setTimeout(r, 110));
    const m = new DOMMatrix(getComputedStyle(sheet).transform);
    const deg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    return (deg + 360) % 360;
  });
  expect(angle).toBeGreaterThan(270);
  expect(angle).toBeLessThan(360);
});

/**
 * THE VIEW-TRANSITION GATE (spec WP-12 "Flag"). The sheet-travel transition
 * and the catalogue's refilter ship only on a build made with
 * `PDFXYZ_VIEW_TRANSITIONS=1`, and the flag's default flips only once this
 * block is green in CI. Its sharpest test is the one the transition could
 * break: a click on the destination's add-more control, 30ms into the
 * navigation, must land — a transition that holds the old page's snapshot
 * over the new one eats it.
 */
test.describe("view transitions (flag on)", () => {
  test.skip(
    process.env.PDFXYZ_VIEW_TRANSITIONS !== "1",
    "a build without PDFXYZ_VIEW_TRANSITIONS=1 ships no view transitions",
  );

  async function spy(page: Page) {
    await page.addInitScript(() => {
      const w = window as unknown as { __vt: { types: string[] }[] };
      w.__vt = [];
      const start = document.startViewTransition?.bind(document);
      if (!start) return;
      document.startViewTransition = ((arg: unknown) => {
        const types =
          arg && typeof arg === "object" && "types" in arg
            ? [...((arg as { types?: Iterable<string> }).types ?? [])]
            : [];
        w.__vt.push({ types });
        const t = start(arg as never);
        // React adds its types to the transition after starting it.
        queueMicrotask(() => {
          const set = (t as unknown as { types?: Set<string> }).types;
          if (set) w.__vt.at(-1)!.types.push(...set);
        });
        return t;
      }) as typeof document.startViewTransition;
    });
  }
  const calls = (page: Page) =>
    page.evaluate(
      () => (window as unknown as { __vt: { types: string[] }[] }).__vt,
    );

  test("the hand-off launch travels as `handoff`, and Add more lands 30ms into it", async ({
    page,
  }) => {
    await spy(page);
    await page.goto("/");
    await uploadFiles(page, [
      await writeTempPdf("first.pdf", 1),
      await writeTempPdf("second.pdf", 2),
    ]);
    const ticket = page.getByRole("region", {
      name: "What you can do with these files",
    });
    const merge = ticket.getByRole("link", {
      name: /^Open Merge PDF with 2 files$/,
    });
    await expect(merge).toBeVisible();
    const chooser = page.waitForEvent("filechooser", { timeout: 15_000 });
    await merge.click();
    await page.waitForTimeout(30);
    const addMore = page.getByText(/add more pdfs/i).first();
    await addMore.click({ timeout: 15_000 });
    await chooser;
    const vt = await calls(page);
    expect(vt.some((c) => c.types.includes("handoff"))).toBe(true);
  });

  test("a chip on /tools refilters with a transition, and typing does not", async ({
    page,
  }) => {
    await spy(page);
    await page.goto("/tools");
    const search = page.getByRole("searchbox").first();
    await waitForHydration(search);
    await search.fill("merge");
    await page.waitForTimeout(300);
    expect(await calls(page)).toEqual([]);
    await search.fill("");
    const chip = page
      .getByRole("group", { name: "Filter tools by category" })
      .getByRole("button")
      .nth(1);
    await chip.click();
    await expect
      .poll(async () => (await calls(page)).length)
      .toBeGreaterThanOrEqual(1);
  });
});
