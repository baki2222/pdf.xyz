import { expect, test, type Page } from "@playwright/test";
import { getAllToolSlugs, tools } from "../src/lib/tools";
import { categories } from "../src/lib/tools/categories";
import { getRunnerKind } from "../src/lib/pdf/registry";
import { toolFamilies } from "../src/lib/tools/families";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { encodePng } from "./client-proof/fixtures";
import { panelDispatchArms } from "../src/tests/worker-panel-dispatch";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";

/**
 * The working surface above the fold on a phone (390×844, the `mobile`
 * project). Each number is a page-coordinate measured in a real browser
 * after load, never inferred from class names.
 *
 * Measured on the build before WP-06 (2026-10-10, design/batch-b @ 8d4888a9):
 *
 *     /tools            first tool card at 724px
 *     /                 the toolbox section 3,678px tall
 *     /tools/word-to-pdf  the worker panel at 2,192px (under the whole intro)
 *     /tools/ocr-pdf      the worker panel at 2,511px
 *     /tools/merge-pdf    the runner panel at 342px (already above the fold)
 *
 * The redesign spec also asks for the word-to-pdf panel's DropSheet under
 * 420px. That drop zone does not exist yet: the Office panel mounts its
 * picker only once `/api/worker/status` answers ready, and a local build has
 * no worker. What this package controls is where the PANEL sits — head, then
 * panel, then the details — and that is what is held here; the DropSheet's
 * own position binds with the panel redesign that renders it on the server.
 */

/** Top of the first element matching `selector`, in page coordinates. */
async function topOf(page: Page, selector: string): Promise<number> {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "attached" });
  return el.evaluate((node) =>
    Math.round(node.getBoundingClientRect().top + window.scrollY),
  );
}

test("/tools: the first tool card starts above 560px", async ({ page }) => {
  await page.goto("/tools");
  const top = await page
    .getByRole("main")
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => {
      const first = links.find((a) =>
        /^\/tools\/[a-z0-9-]+$/.test(a.getAttribute("href") ?? ""),
      );
      return first
        ? Math.round(first.getBoundingClientRect().top + window.scrollY)
        : null;
    });
  expect(top, "no tool card found on /tools").not.toBeNull();
  expect(top!).toBeLessThan(560);
});

/*
 * INVERTED 2026-10-21, history kept. Two tests stood here for WP-06's phone
 * toolbox: "/: the toolbox section is at most 1120px tall, and still links
 * every tool" (a two-column grid of category cards, the design target about
 * 1,100px against 3,678px before), and "/: on a phone each toolbox card
 * shows its first three tools and a visible link to all of them" (the rest
 * hidden below `sm`, reached by "All 7 Organize tools →"). The owner's plain
 * redesign made every tool its own card, shown at every width, so a phone
 * no longer hides any tool behind a category link: the height of the whole
 * page is now held instead (`e2e/home-cards.spec.ts`, under 7,000px at 390).
 */
test("/: on a phone every tool is a visible card, and each card is its tool's link", async ({
  page,
}) => {
  await page.goto("/");
  const cards = page.locator("section#tools ul[data-tool-grid] > li");
  await expect(cards).toHaveCount(getAllToolSlugs().length);
  const hidden = await cards.evaluateAll(
    (items) =>
      items.filter((li) => (li as HTMLElement).offsetParent === null).length,
  );
  expect(hidden).toBe(0);
  const hrefs = await cards
    .locator('a[href^="/tools/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(new Set(hrefs)).toEqual(
    new Set(getAllToolSlugs().map((slug) => `/tools/${slug}`)),
  );
  // No card is wider than the screen.
  const widest = await cards.evaluateAll((items) =>
    Math.max(...items.map((li) => li.getBoundingClientRect().right)),
  );
  expect(widest).toBeLessThanOrEqual(390);
});

/**
 * The /tools filter rows on a phone are single lines that scroll sideways.
 * A deep link's choice must be ON SCREEN once the page has applied it.
 *
 * WHAT SHIPPED (review of WP-06, 2026-10-10, 390x844, production build):
 * before WP-06 the chips wrapped, so the pressed one was always in view.
 * WP-06 made each row one sideways-scrolling line and nothing brought the
 * active chip into view: `?runs=ai` left the checked "AI 4" radio at
 * x=680, `?runs=secure-worker` at 516, `?category=ai` the "AI" chip at 884,
 * `?category=security` at 675 — all past the 390px screen. The reader saw
 * "All" and "All tools" looking unselected over a filtered grid.
 *
 * Every choice is a case, derived from the families and the categories,
 * never typed. A choice that is on screen with the row unscrolled must leave
 * the row unscrolled, so its first chip stays in view (the control:
 * `?category=organize`); one that is not must be scrolled to, sideways only,
 * clear of the row's edge fade. The health check below proves both kinds are
 * in the set, so neither half passes for want of a case.
 *
 * 2026-10-23: ONE row. The "Where it runs" radios (a second row, behind a
 * mono label) became a checkbox under the chips, which never scrolls; the
 * category chips became the home page's families. An old link to one
 * convert category (`?category=convert-to`) presses its family's chip, so
 * every category id is still a case beside every family id.
 */
const FILTER_LINKS = [
  ...new Set([
    ...toolFamilies().map((family) => family.id),
    ...categories.map((category) => category.id),
  ]),
].map((id) => ({
  query: `?category=${id}`,
  group: () => ({ role: "group" as const, name: "Filter tools by category" }),
  active: 'button[aria-pressed="true"]',
}));

/** Where the active control sits in its row, read in the browser. */
interface RowReading {
  /** Its edges in the viewport. */
  left: number;
  right: number;
  /** Its start and end in the row's scroll coordinates. */
  start: number;
  end: number;
  scrollLeft: number;
  clientWidth: number;
  /** The row's own inset: its scroll-padding. */
  padLeft: number;
  padRight: number;
  innerWidth: number;
  scrollY: number;
  /** The row's first chip ("All"; its label until 2026-10-23), in the viewport. */
  label: { left: number; right: number } | null;
}

for (const link of FILTER_LINKS) {
  test(`/tools${link.query}: the chosen filter is on screen, and the row scrolls only when it must`, async ({
    page,
  }) => {
    await page.goto(`/tools${link.query}`);
    const { role, name } = link.group();
    const row = page.getByRole(role, { name });
    // Applied: the deep link's choice is the active control.
    await expect(row.locator(link.active)).toHaveCount(1);
    await waitForHydration(row.locator(link.active));
    const read = () =>
      row.evaluate((el, selector): RowReading => {
        const active = el.querySelector(selector)!;
        const box = active.getBoundingClientRect();
        const rowBox = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const label = el.firstElementChild?.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          start: box.left - rowBox.left + el.scrollLeft,
          end: box.right - rowBox.left + el.scrollLeft,
          scrollLeft: el.scrollLeft,
          clientWidth: el.clientWidth,
          padLeft: parseFloat(style.scrollPaddingLeft) || 0,
          padRight: parseFloat(style.scrollPaddingRight) || 0,
          innerWidth: window.innerWidth,
          scrollY: window.scrollY,
          label: label ? { left: label.left, right: label.right } : null,
        };
      }, link.active);
    // The reveal runs after hydration; give it a frame or two to land.
    await expect
      .poll(async () => {
        const r = await read();
        return r.left >= 0 && r.right <= r.innerWidth;
      })
      .toBe(true);
    const r = await read();
    expect(r.innerWidth, "the phone viewport did not apply").toBe(390);
    const fitsUnscrolled = r.end <= r.clientWidth - r.padRight;
    // Never a vertical scroll: revealing a chip must not move the page.
    expect(r.scrollY, "the page scrolled vertically").toBe(0);
    if (fitsUnscrolled) {
      // On screen as served: the row stays put and its first chip stays in
      // view.
      expect(r.scrollLeft, "a choice already in view scrolled the row").toBe(0);
      expect(r.label, "the row has no first chip").not.toBeNull();
      expect(r.label!.left).toBeGreaterThanOrEqual(0);
      expect(r.label!.right).toBeLessThanOrEqual(r.innerWidth);
    } else {
      // Scrolled to, wholly, and clear of the fade at either end.
      expect(r.left, "under the row's left edge").toBeGreaterThanOrEqual(
        r.padLeft - 1,
      );
      expect(r.right, "under the row's right edge").toBeLessThanOrEqual(
        r.clientWidth - r.padRight + 1,
      );
    }
  });
}

test("health: the filter deep links include choices on screen as served and choices that need the row scrolled", async ({
  page,
}) => {
  // Measured here rather than read from the cases above (each runs in its own
  // worker): where every choice sits with the row unscrolled. Both kinds must
  // exist, or one half of the test above is checked over nothing.
  await page.goto("/tools");
  const positions = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="group"][aria-label="Filter tools by category"] button',
      ),
    ].map((el) => {
      const row = el.closest<HTMLElement>('[role="group"]')!;
      return {
        text: el.textContent?.trim() ?? "",
        right: el.getBoundingClientRect().right,
        width: row.clientWidth,
      };
    }),
  );
  expect(positions.length).toBe(toolFamilies().length + 1);
  const offScreen = positions.filter((p) => p.right > p.width);
  const onScreen = positions.filter((p) => p.right <= p.width);
  // The reviewer's case: AI, last in the row, starts off screen.
  expect(offScreen.map((p) => p.text)).toContainEqual(
    expect.stringMatching(/^AI/),
  );
  expect(onScreen).not.toEqual([]);
});

for (const slug of ["merge-pdf", "word-to-pdf", "ocr-pdf"]) {
  test(`/tools/${slug}: the tool's panel starts above 400px`, async ({
    page,
  }) => {
    await page.goto(`/tools/${slug}`);
    expect(await topOf(page, "[data-tool-panel]")).toBeLessThan(400);
  });
}

test("every tool page fits a phone: its facts row never scrolls and the page never scrolls sideways", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const slugs = getAllToolSlugs();
  // Health: both layouts are in the set, so neither is checked vacuously.
  expect(slugs.some((slug) => getRunnerKind(slug))).toBe(true);
  expect(slugs.some((slug) => !getRunnerKind(slug))).toBe(true);
  const overflowing: string[] = [];
  for (const slug of slugs) {
    await page.goto(`/tools/${slug}`, { waitUntil: "domcontentloaded" });
    const fit = await page.evaluate(() => {
      const facts = document.querySelector("[data-tool-facts]");
      return {
        facts: facts ? facts.scrollWidth - facts.clientWidth : null,
        page:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    if (fit.facts === null) overflowing.push(`${slug}: no facts row`);
    else if (fit.facts > 0)
      overflowing.push(`${slug}: facts row ${fit.facts}px too wide`);
    if (fit.page > 0) overflowing.push(`${slug}: page ${fit.page}px too wide`);
  }
  expect(overflowing).toEqual([]);
});

/**
 * Every worker tool's status slot is ONE box on a phone: the same height
 * while it checks, when the check fails, when the worker is not enabled, and
 * when it is ready — so the answer moves nothing under it.
 *
 * Each panel reserves that height with a measured constant
 * (`STATUS_SLOT` in its module, per breakpoint — see `WorkerStatusSlot`). A
 * constant has no relationship to keep it right, so this is its second,
 * independent bound: every slug the registry routes (not one per panel —
 * Protect and Unlock share a panel and differ by a strength picker), at the
 * width each phone reserve was measured for (360) and the one every layout
 * is drawn at (390). A run area that outgrows its reserve fails here by
 * name, with the four heights.
 *
 * The `sm:` and `lg:` reserves are constants too, so they get the same bound:
 * each breakpoint's NARROWEST width (640 for `sm:`, 1024 for `lg:`), where
 * its text wraps most and where each panel's docblock says it was fitted. A
 * wider width (768, 1280) measures the easier case and passes reserves that
 * overflow at 640. Until 2026-10-20 only the two phone widths were measured,
 * so every `sm:`/`lg:` reserve shipped with nothing checking it.
 *
 * WHAT SHIPPED (review of WP-06, 2026-10-10): the checking box was a bare
 * `min-h-32` (128px) and the run area up to 718px, directly under the tool's
 * name on a phone; CLS 0.0582 on Protect PDF at 390 with a ready answer.
 */
const WORKER_SLUGS = panelDispatchArms().flatMap((arm) => arm.slugs);

declare global {
  interface Window {
    __releaseStatus?: () => void;
  }
}

type StatusStep = "hold-then-fail" | "fail" | "local" | "ready";

/** Answer `/api/worker/status` by plan, in the page (no `page.route`). */
async function planStatus(page: Page, plan: StatusStep[]): Promise<void> {
  await page.addInitScript(
    ({ plan, ready }) => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      window.__releaseStatus = () => release();
      let asked = 0;
      const real = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          location.href,
        );
        if (url.pathname !== "/api/worker/status") return real(input, init);
        const step = plan[Math.min(asked++, plan.length - 1)];
        if (step === "hold-then-fail") {
          await held;
          throw new TypeError("Failed to fetch");
        }
        if (step === "fail") throw new TypeError("Failed to fetch");
        if (step === "ready")
          return new Response(ready, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        return real(input, init);
      };
    },
    { plan, ready: JSON.stringify(READY_WORKER_STATUS) },
  );
}

/**
 * The slot's height as reserved, and the height its content needs with the
 * reserve lifted, both read once the fonts have loaded. Without that wait the
 * reading depended on whether the face had arrived: CI read chat-with-pdf's
 * run area 731.5px tall against a 720px reserve on one run, and within the
 * reserve on the run before it. Late-font shift is layout-stability's job.
 */
const slotHeight = (page: Page) =>
  page.locator('[data-slot="worker-status"]').evaluate(async (el) => {
    await document.fonts.ready;
    const box = el as HTMLElement;
    const reserved = box.getBoundingClientRect().height;
    const prev = box.style.minHeight;
    box.style.minHeight = "0px";
    const natural = box.getBoundingClientRect().height;
    box.style.minHeight = prev;
    return {
      reserved: Math.round(reserved * 10) / 10,
      natural: Math.round(natural * 10) / 10,
    };
  });

/**
 * Room a reserve must leave above its content. Linux Chromium sets the same
 * text about 2.2% taller than Windows (measured 2026-10-10 on #176: AI
 * Extract's run area 877 -> 896.5px, chat-with-pdf's 715.5 -> 731.5px at
 * 360). A reserve fitted on Windows with less than that room passed
 * 393/393 here and failed on CI. So off Linux a reserve must clear its
 * content by 3%, which leaves about 1% once Linux adds its 2.2%; on Linux,
 * 1%. Every STATUS_SLOT was refitted to at least 3.5% on Windows the same day.
 *
 * A percentage is the wrong unit when Linux wraps one more LINE: #178's
 * longer Notify-me text set PDF to PowerPoint's off state 327.5px tall on
 * Windows and 366.5px on Linux (+12%), chat-with-pdf 715.5 -> 751px. So the
 * base reserves are fitted to the larger of both platforms' SLOT_NATURAL
 * lines (this test prints them; CI's log is the Linux column), x1.035,
 * rounded up to the half-rem. The off-Linux 3% check is a coarse local
 * alarm; CI's run is the real check.
 */
const SLOT_HEADROOM = process.platform === "linux" ? 1.01 : 1.03;

/** Phone (base: 360, 390), `sm:` (640) and `lg:` (1024) — at least one per reserve. */
const SLOT_WIDTHS = [360, 390, 640, 1024] as const;

for (const width of SLOT_WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test(`health: every routed worker slug is in the set (${WORKER_SLUGS.length})`, () => {
      expect(WORKER_SLUGS.length).toBe(
        getAllToolSlugs().filter((slug) => !getRunnerKind(slug)).length,
      );
    });

    for (const slug of WORKER_SLUGS) {
      test(`/tools/${slug} at ${width}px: the worker status slot is one box — checking, failed, not enabled, ready`, async ({
        page,
      }) => {
        const slot = page.locator('[data-slot="worker-status"]');
        // Checking → failed → (Check again) → this server's answer. The
        // check retries a network failure twice itself (WP-10's one shared
        // check, `use-worker-status.ts`), so "failed" takes three.
        await planStatus(page, ["hold-then-fail", "fail", "fail", "local"]);
        // The consent banner answered first: it is fixed to the bottom of
        // the screen, and "Check again" scrolled into view from just below
        // the fold landed under it (CI, Linux, 360px, 2026-10-23 — a few
        // pixels of taller type above the slot put the button there).
        await page.addInitScript((key) => {
          window.localStorage.setItem(key, "denied");
        }, CONSENT_STORAGE_KEY);
        await page.goto(`/tools/${slug}`);
        await waitForHydration(slot);
        await expect(slot).toHaveAttribute("data-state", "loading");
        const loadingM = await slotHeight(page);
        await page.evaluate(() => window.__releaseStatus?.());
        await expect(slot).toHaveAttribute("data-state", "error");
        const failedM = await slotHeight(page);
        await slot.getByRole("button", { name: /check again/i }).click();
        await expect(slot).toHaveAttribute("data-state", "off");
        // The not-enabled box is its own chunk (2026-10-23): measured once
        // it is drawn, or the reading is the empty slot and passes anything.
        await expect(slot.locator("[data-off]")).toBeVisible();
        const offM = await slotHeight(page);
        // A ready deployment, on a fresh page.
        const ready = await page.context().newPage();
        await planStatus(ready, ["ready"]);
        await ready.goto(`/tools/${slug}`);
        await expect(
          ready.locator('[data-slot="worker-status"]'),
        ).toHaveAttribute("data-state", "run");
        const runM = await slotHeight(ready);
        const widths = await ready.evaluate(() => ({
          inner: window.innerWidth,
          page: document.documentElement.scrollWidth,
        }));
        await ready.close();
        // Health: the width asked for, and a ready run area that fits it
        // (AI Extract's did not: 473px at 390, until this package).
        expect(widths).toEqual({ inner: width, page: width });
        const [loading, failed, off, run] = [loadingM, failedM, offM, runM].map(
          (m) => m.reserved,
        ) as [number, number, number, number];
        const heights = { loading, failed, off, run };
        // Every run prints each state's natural height, so CI's Linux numbers
        // can be read from its log. Fitting a reserve needs both platforms,
        // and Linux is only reachable through CI here (no WSL or Docker).
        console.log(
          `SLOT_NATURAL ${slug} ${width} ${JSON.stringify({
            loading: loadingM.natural,
            failed: failedM.natural,
            off: offM.natural,
            run: runM.natural,
            reserve: loading,
          })}`,
        );
        const content = Math.max(
          loadingM.natural,
          failedM.natural,
          offM.natural,
          runM.natural,
        );
        expect(loading, "no slot on screen").toBeGreaterThan(100);
        expect(
          Math.max(loading, failed, off, run) -
            Math.min(loading, failed, off, run),
          `${slug} at ${width}px: ${JSON.stringify(heights)} — re-measure this panel's STATUS_SLOT`,
        ).toBeLessThanOrEqual(1);
        // Health: the content was measured with the reserve lifted.
        expect(content, "no content height read").toBeGreaterThan(100);
        expect(
          content * SLOT_HEADROOM,
          `${slug} at ${width}px: content ${content}px leaves less than ${Math.round((SLOT_HEADROOM - 1) * 100)}% under the ${loading}px reserve — another platform's text will overflow it; refit this panel's STATUS_SLOT`,
        ).toBeLessThanOrEqual(loading);
      });
    }
  });
}

/**
 * Every tool page still fits a phone once a FILE is on it — a file named the
 * way people name files: 66 characters and no break opportunity in them.
 *
 * WHAT SHIPPED (review of the batch-B merge, 2026-10-10, and on main before
 * it): at 390px, 49 of the 50 tool pages scrolled sideways when such a file
 * was refused — every one but Webpage to PDF, which takes a URL — at 486 to
 * 568px, and Compare PDF did with a file it took (658px). The name sat in a
 * flex item (the refusal note's message, the merge and compress "skipped"
 * lists, Compare's file card) whose `min-width: auto` is the width of its
 * longest word. "Every tool page fits a phone" above stayed green throughout:
 * it never loads a file.
 *
 * THE SET IS DERIVED: every catalogue tool whose formats are files (not a
 * URL). For each, the page is loaded fresh with the worker status answering
 * ready (a worker panel mounts its picker only then), and given, through its
 * first file input: a file it takes (the first of its formats a fixture is
 * made for), a PDF when it does not take PDFs, and a file nothing takes
 * (`.xyz`). Each load must show the name it was given — the load landed —
 * before the page is measured, five times over 0.6s, widest kept.
 */
const LONG_STEM =
  "Quarterly_Financial_Statement_Consolidated_Final_Approved_Version_2026";
/** `<stem>.<ext>`, 66 characters, one unbroken word. */
const longName = (ext: string) =>
  `${LONG_STEM.slice(0, 65 - ext.length)}.${ext}`;

interface Payload {
  name: string;
  mimeType: string;
  buffer: Buffer;
  /** Text a page that reads the file into an editor shows instead of its name. */
  body?: string;
}

const ZIP_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

/** A fixture for one catalogue format, or null when none is made for it. */
async function payloadFor(format: string): Promise<Payload | null> {
  switch (format) {
    case "PDF":
      return {
        name: longName("pdf"),
        mimeType: "application/pdf",
        buffer: Buffer.from(await makePdfBytes("long name", 1)),
      };
    case "PNG":
      return {
        name: longName("png"),
        mimeType: "image/png",
        buffer: encodePng(Buffer.alloc(8 * 8 * 3, 0x80), 8, 8),
      };
    case "DOCX":
      return {
        name: longName("docx"),
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: ZIP_HEAD,
      };
    case "XLSX":
      return {
        name: longName("xlsx"),
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: ZIP_HEAD,
      };
    case "PPTX":
      return {
        name: longName("pptx"),
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: ZIP_HEAD,
      };
    case "HTML":
      return {
        name: longName("html"),
        mimeType: "text/html",
        buffer: Buffer.from("<!doctype html><p>A page.</p>"),
        body: "A page.",
      };
    case "MD":
      return {
        name: longName("md"),
        mimeType: "text/markdown",
        buffer: Buffer.from("# A title\n\nA paragraph.\n"),
        body: "A paragraph.",
      };
    case "TXT":
      return {
        name: longName("txt"),
        mimeType: "text/plain",
        buffer: Buffer.from("A paragraph of plain text.\n"),
        body: "A paragraph of plain text.",
      };
    default:
      return null;
  }
}

const REFUSED: Payload = {
  name: longName("xyz"),
  mimeType: "application/octet-stream",
  buffer: Buffer.from("not a document"),
};

const FILE_TOOLS = tools.filter((t) => !t.accept.includes("URL"));

/** What each page is given: its own format, a PDF if it refuses them, `.xyz`. */
async function loadsFor(
  tool: (typeof tools)[number],
): Promise<{ label: string; payload: Payload }[]> {
  let taken: Payload | null = null;
  for (const format of tool.accept) {
    taken = await payloadFor(format);
    if (taken) break;
  }
  if (!taken)
    throw new Error(
      `${tool.slug}: no fixture is made for any of its formats (${tool.accept.join(", ")}) — add one to payloadFor`,
    );
  const loads = [{ label: `a ${tool.accept[0]} it takes`, payload: taken }];
  if (!tool.accept.includes("PDF"))
    loads.push({
      label: "a PDF it refuses",
      payload: (await payloadFor("PDF"))!,
    });
  loads.push({ label: "a file nothing takes", payload: REFUSED });
  return loads;
}

/**
 * The widest the document is over 0.6s, against the phone it is drawn on.
 * NOT `window.innerWidth`: a phone zooms out to fit a page wider than its
 * layout viewport, so innerWidth grows WITH the overflow (566 for a 566px
 * page at 390 — the positive control below caught it). The layout width is
 * the viewport asked for, and the root's clientWidth must agree with it.
 */
async function widest(page: Page) {
  const phone = page.viewportSize()!.width;
  let worst = { scrollWidth: 0, clientWidth: 0, phone };
  for (let i = 0; i < 5; i++) {
    const now = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    if (now.scrollWidth >= worst.scrollWidth) worst = { ...now, phone };
    await page.waitForTimeout(150);
  }
  // Health: the page is laid out at the phone's width.
  expect(worst.clientWidth).toBe(phone);
  return worst;
}

test("health: the long-name set is every tool that takes a file — at least 45, and only URL tools left out", () => {
  expect(FILE_TOOLS.length).toBeGreaterThanOrEqual(45);
  const left = tools.filter((t) => !FILE_TOOLS.includes(t));
  expect(left.every((t) => t.accept.join() === "URL")).toBe(true);
  expect(left.length).toBeLessThanOrEqual(2);
});

test("positive control: an unbroken name in a row that does not let it break widens the page, and the measure sees it", async ({
  page,
}) => {
  await page.goto("/tools/rotate-pdf");
  const before = await widest(page);
  expect(before.scrollWidth).toBeLessThanOrEqual(before.phone);
  // The shape that shipped: a flex row whose item is as wide as its word.
  await page.evaluate((name) => {
    const row = document.createElement("p");
    row.style.display = "flex";
    const message = document.createElement("span");
    message.textContent = `${name} isn't a PDF.`;
    row.append(message);
    document.querySelector("[data-tool-panel]")!.append(row);
  }, longName("xyz"));
  const after = await widest(page);
  expect(after.scrollWidth).toBeGreaterThan(after.phone);
});

for (const tool of FILE_TOOLS) {
  test(`/tools/${tool.slug}: a 66-character file name never widens the page — taken, and refused`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await planStatus(page, ["ready"]);
    const wide: string[] = [];
    for (const { label, payload } of await loadsFor(tool)) {
      await page.goto(`/tools/${tool.slug}`);
      const input = fileInput(page);
      await waitForHydration(input);
      await input.setInputFiles(payload);
      // The load landed: the page shows the name it was given — or, for a
      // text tool that reads the file into its editor, the file's text.
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ name, body }) =>
                (document.body.textContent?.includes(name) ?? false) ||
                (!!body &&
                  [...document.querySelectorAll("textarea")].some((t) =>
                    t.value.includes(body),
                  )),
              { name: payload.name, body: payload.body },
            ),
          { message: `${label}: the page never showed ${payload.name}` },
        )
        .toBe(true);
      const { scrollWidth, phone } = await widest(page);
      if (scrollWidth > phone)
        wide.push(`${label}: the page is ${scrollWidth}px wide at ${phone}px`);
    }
    expect(wide).toEqual([]);
  });
}
