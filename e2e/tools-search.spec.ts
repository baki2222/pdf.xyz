import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { attachConsoleGuard, waitForHydration } from "./helpers";

/**
 * `/tools?q=` as a reader receives it: a prerendered page that ranks the
 * query after hydration.
 *
 * The redesign spec asked for "the served HTML of /tools?q=pdf%20jpg" to list
 * PDF to JPG first. That cannot be true and should not be: `/tools` is static
 * (pages-static.test.ts), the query never reaches the server, and the served
 * page is the whole catalogue a crawler reads (ssr-content.test.ts). So this
 * checks the two halves where each lives — the served HTML is the unfiltered
 * catalogue, and the page the reader sees after hydration is ranked.
 */

/** Tool-page links inside the main content, in document order. */
async function toolLinks(page: Page): Promise<string[]> {
  const hrefs = await page
    .getByRole("main")
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.filter((href) => /^\/tools\/[a-z0-9-]+$/.test(href));
}

/**
 * The marker only the search engine's chunk carries (`SEARCH_ENGINE_CHUNK`
 * in `src/lib/tools/search-tools.ts`). Typed here, and checked by
 * {@link holdSearchEngine}'s count: if it ever stops matching, nothing is
 * held and the test that holds it fails on that count, not on the state.
 */
const SEARCH_ENGINE_MARKER = "pdfxyz:lazy:search-engine";

/**
 * Hold back exactly the search engine's chunk — recognised by its content,
 * since its file name is a hash — until `release()`, so the state a reader
 * sees while it is on its way can be looked at in a real browser.
 */
async function holdSearchEngine(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held = 0;
  await page.route(
    /\/_next\/static\/chunks\/.+\.js(?:\?.*)?$/,
    async (route) => {
      try {
        const response = await route.fetch();
        const body = await response.text();
        if (body.includes(SEARCH_ENGINE_MARKER)) {
          held += 1;
          await released;
        }
        await route.fulfill({ response, body });
      } catch {
        // The page closed with a chunk in flight ("Response has been
        // disposed"). A chunk that failed mid-test would fail the test's
        // own assertions; this only keeps teardown from failing it again.
      }
    },
  );
  return {
    held: () => held,
    /** Let the chunk through, and stop intercepting. */
    release: async () => {
      release();
      // A chunk still in flight when the test ends would otherwise throw
      // from its handler ("Response has been disposed") and fail the test.
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  };
}

/** How many distinct tool pages the served `/tools` links: the catalogue. */
async function servedToolCount(request: APIRequestContext): Promise<number> {
  const html = await (await request.get("/tools")).text();
  const slugs = new Set(
    [...html.matchAll(/href="(\/tools\/[a-z0-9-]+)"/g)].map((m) => m[1]),
  );
  return slugs.size;
}

test.describe("the /tools search, after hydration", () => {
  test("?q=pdf%20jpg ranks PDF to JPG first — and the served HTML stays the whole catalogue", async ({
    page,
    request,
  }) => {
    const guard = attachConsoleGuard(page);

    // The served half: the static page, before any script runs.
    const served = await (await request.get("/tools?q=pdf%20jpg")).text();
    expect(served).not.toContain("Best matches for");
    expect(served).toContain('href="/tools/merge-pdf"');
    expect(served).toContain('href="/tools/webpage-to-pdf"');

    // The hydrated half.
    await page.goto("/tools?q=pdf%20jpg");
    await waitForHydration(
      page.getByRole("searchbox", { name: /search tools/i }),
    );
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Best matches for “pdf jpg”",
      }),
    ).toBeVisible();
    expect((await toolLinks(page))[0]).toBe("/tools/pdf-to-jpg");
    // The deep link is left as the reader arrived with it.
    expect(new URL(page.url()).search).toBe("?q=pdf%20jpg");

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });

  test("?q=heic answers that nothing opens HEIC, with the way in, and no Webpage to PDF", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await page.goto("/tools?q=heic");
    await waitForHydration(
      page.getByRole("searchbox", { name: /search tools/i }),
    );
    const answer = page.getByRole("region", {
      name: "No tool here opens HEIC photos.",
    });
    await expect(answer).toBeVisible();
    await expect(answer.getByText("Save a JPG copy first.")).toBeVisible();
    await expect(
      answer.getByRole("link", { name: /JPG to PDF/ }),
    ).toHaveAttribute("href", "/tools/jpg-to-pdf");
    expect(await toolLinks(page)).not.toContain("/tools/webpage-to-pdf");

    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });

  test("while the engine is on its way, ?q=heic says it is searching and claims no count — then answers", async ({
    page,
    request,
  }) => {
    // WAS: the box read "heic", the count beside it "50 tools", and the
    // whole catalogue sat below under its category headings — the served
    // grid presented as the answer, until the chunk landed (review of WP-03,
    // the chunk delayed 4 s on the production build).
    const catalogue = await servedToolCount(request);
    expect(catalogue).toBeGreaterThan(40);
    const hold = await holdSearchEngine(page);
    // Not "load": a chunk held back before the load event holds the event.
    await page.goto("/tools?q=heic", { waitUntil: "domcontentloaded" });
    const box = page.getByRole("searchbox", { name: /search tools/i });
    await waitForHydration(box);
    // Health: the engine is what is being held, and it was asked for.
    await expect.poll(() => hold.held()).toBe(1);
    await expect(box).toHaveValue("heic");

    await expect(
      page.getByRole("heading", { level: 2, name: "Searching for “heic”…" }),
    ).toBeVisible();
    const count = page.locator("[data-result-count]");
    await expect(count).toBeVisible();
    await expect(count).not.toHaveText(/\d/);
    // Every tool link is still on the page while it waits.
    expect(new Set(await toolLinks(page)).size).toBe(catalogue);

    // Positive control: released, the same page answers.
    await hold.release();
    await expect(
      page.getByRole("region", { name: "No tool here opens HEIC photos." }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^Searching for/ }),
    ).toHaveCount(0);
    await expect(count).toHaveText("0 tools");
  });

  /**
   * WAS (review, 2026-10-10): typing drew TWO clear buttons side by side —
   * Chromium's and WebKit's own blue ✕ (`::-webkit-search-cancel-button`,
   * which Tailwind's preflight leaves on) beside the explorer's "Clear
   * search" — at every width, in both themes.
   *
   * Read from the PIXELS, not from `getComputedStyle(box,
   * "::-webkit-search-cancel-button")`: Chromium answers that with the
   * input's own style — "auto" for the cancel button, for
   * `::-webkit-search-decoration` (which preflight sets to none) and for a
   * pseudo-element that does not exist — so it could never say "none". The
   * box is drawn with the explorer's ✕ hidden, and compared with the same
   * box with the native button forced off and forced on; the last two
   * must differ, or the comparison could not see it at all.
   */
  test("one clear control: the browser's own search ✕ is not drawn beside Clear search", async ({
    page,
  }) => {
    await page.goto("/tools");
    const box = page.getByRole("searchbox", { name: /search tools/i });
    await waitForHydration(box);
    await box.fill("compress");
    const clear = page.getByRole("button", { name: "Clear search" });
    await expect(clear).toBeVisible();
    await expect(clear).toHaveCount(1);
    await clear.evaluate((el) => (el.style.visibility = "hidden"));
    const drawn = await box.screenshot();
    const force = async (appearance: "none" | "searchfield-cancel-button") => {
      await page.evaluate((value) => {
        const id = "force-native-cancel";
        document.getElementById(id)?.remove();
        const style = document.createElement("style");
        style.id = id;
        style.textContent = `input[type="search"]::-webkit-search-cancel-button { -webkit-appearance: ${value} !important; appearance: ${value === "none" ? "none" : "auto"} !important; }`;
        document.head.append(style);
      }, appearance);
      return box.screenshot();
    };
    const off = await force("none");
    const on = await force("searchfield-cancel-button");
    // Positive control: the comparison can see the native button.
    expect(on.equals(off), "forcing the native ✕ on changed nothing").toBe(
      false,
    );
    expect(drawn.equals(off), "the native ✕ is drawn as shipped").toBe(true);
  });

  test("typing ranks as you go, and a format filter survives a category click", async ({
    page,
  }) => {
    await page.goto("/tools?accepts=pdf");
    const box = page.getByRole("searchbox", { name: /search tools/i });
    await waitForHydration(box);
    await expect(
      page.getByRole("button", { name: /takes pdf/i }),
    ).toBeVisible();
    await box.fill("flip");
    await expect(
      page.getByRole("heading", { level: 2, name: "Best matches for “flip”" }),
    ).toBeVisible();
    expect((await toolLinks(page))[0]).toBe("/tools/rotate-pdf");
    await page.getByRole("button", { name: /^All tools/ }).click();
    await expect(page).toHaveURL(/accepts=pdf/);
    await expect(page).toHaveURL(/q=flip/);
  });
});

/**
 * A pasted filename, echoed in a heading, at the narrowest common phone.
 *
 * WAS: "Closest matches for “Quarterly_Report_2026_final_v3_signed.pdf”" made
 * `document.documentElement.scrollWidth` 523 at a 360px viewport — the
 * headings that echo the query could not break a long token, so the whole
 * page scrolled sideways (review of WP-03). Each heading that echoes the
 * query is reached here: the empty state, the closest list, and the pending
 * line while the engine is held back.
 */
test.describe("at 360px, a long unbroken query never widens the page", () => {
  // A plain 360px viewport, not phone emulation: with `isMobile` an
  // overflowing page widens the layout viewport to fit (innerWidth read 391,
  // 523 and 537 on the build before this fix), so the width check below
  // could not tell "the viewport did not apply" from the defect itself.
  test.use({ viewport: { width: 360, height: 780 } });

  /** 40 characters with no break opportunity in them. */
  const TOKEN = "QuarterlyReport2026FinalV3SignedCopyAAAA";
  const FILENAME = "Quarterly_Report_2026_final_v3_signed.pdf";

  const CASES: { q: string; heading: string; hold?: true }[] = [
    { q: TOKEN, heading: `Nothing matches “${TOKEN}”` },
    { q: `merge ${TOKEN}`, heading: `Closest matches for “merge ${TOKEN}”` },
    { q: FILENAME, heading: `Closest matches for “${FILENAME}”` },
    { q: TOKEN, heading: `Searching for “${TOKEN}”…`, hold: true },
  ];

  for (const { q, heading, hold } of CASES) {
    test(`“${heading}” wraps inside the viewport`, async ({ page }) => {
      expect(TOKEN).toHaveLength(40);
      const held = hold ? await holdSearchEngine(page) : null;
      await page.goto(`/tools?q=${encodeURIComponent(q)}`, {
        // A chunk held back before the load event holds the event.
        waitUntil: held ? "domcontentloaded" : "load",
      });
      await waitForHydration(
        page.getByRole("searchbox", { name: /search tools/i }),
      );
      // Health: the heading under test is the one on screen, echoing the
      // whole token — a state that never rendered cannot overflow. For the
      // pending line, the engine is first seen held: the line shows from
      // hydration, before the chunk is even asked for.
      if (held) await expect.poll(() => held.held()).toBe(1);
      await expect(
        page.getByRole("heading", { level: 2, name: heading }),
      ).toBeVisible();
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(innerWidth, "the viewport did not apply").toBe(360);
      expect(
        scrollWidth,
        `the page scrolls sideways at ${innerWidth}px`,
      ).toBeLessThanOrEqual(innerWidth);
      await held?.release();
    });
  }
});
