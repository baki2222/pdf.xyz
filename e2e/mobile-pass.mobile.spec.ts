import { expect, test, type Page, type Route } from "@playwright/test";
import { tools } from "../src/lib/tools";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { USER_PASSWORD_PDF_BASE64 } from "../src/tests/fixtures-encrypted";
import { encodePng } from "./client-proof/fixtures";
import { fileInput, makePdfBytes, waitForHydration } from "./helpers";

/**
 * The popular tools on the narrowest phone we design for (360x800), with a
 * file in: nothing wider than the screen, and every control a thumb has to
 * hit on the way to a result at least 44px — the header's three buttons,
 * the run, and the option chips between them.
 *
 * WHAT SHIPPED (production audit, 2026-10-29, Android Chrome UA at 360 and
 * 390): no page overflowed, but the header's search, Open files and menu
 * buttons were 42x40 and 40x40 on every page; the option chips every tool
 * draws through `ChipButton`, `SegmentedControl`, the OCR language and
 * output pickers, Split's modes, Sign's source tabs and lettering styles
 * and Protect's encryption strength were 26-30px tall (37 of them on OCR
 * PDF: 34 languages and 3 outputs); A4/A3/A5 41-42px wide; the /tools and
 * home filter chips 36px. This file holds the popular tools' chips and the
 * filter rows; OCR PDF's pickers share the classes but not a test here,
 * since OCR is not a popular tool. (The worker
 * panels' Remove, 45x16, and "What happens to your file", 168x20, became
 * 32px without moving anything around them — the CSS ceiling had no room
 * for the negative-margin rule 44px needed. The second pass, 2026-10-30,
 * found the room: they are 44px now and held below, with Merge's file-row
 * buttons and Rotate's and Organize's page-tile buttons, 28x28 and 24x24
 * until then, and the footer's links, 20px tall.)
 *
 * And on the worker tools the result was off the screen: a tap on Unlock
 * left focus on the button (it is never disabled, #46), so the result card
 * was announced but not scrolled to — its Download sat at y=1162 of an
 * 800px screen and the button the user was looking at simply went back to
 * its idle label. The last test runs that job against a mocked worker and
 * fails if the result is not on the screen.
 *
 * The tools are DISCOVERED — every catalogue tool badged "popular", the
 * ones the home page and /tools lead with — not typed, and the set is
 * bounded so a catalogue change that empties it fails here. Each predicate
 * is run once against a control it must reject, so a predicate that has gone
 * blind (a selector that matches nothing reports the strongest pass) is red.
 */

const MIN = 44;
const SCREEN = 360;

test.use({ viewport: { width: SCREEN, height: 800 } });

const POPULAR = tools.filter((t) => t.badge === "popular");

/** The header controls, the run, and the option chips in the tool's panel. */
const TARGETS = [
  "header button",
  "[data-tool-panel] [data-run-trigger]",
  "[data-tool-panel] [data-run-dock] button",
  "[data-tool-panel] button[aria-pressed]",
  '[data-tool-panel] [role="radiogroup"] [role="radio"]',
  '[data-tool-panel] [role="tablist"] [role="tab"]',
].join(", ");

interface Measured {
  /** Every visible target, `name WxH`. */
  seen: string[];
  /** The ones under the minimum. */
  small: string[];
  /** Elements past either edge of the screen (not inside a scroller). */
  overflow: string[];
  scrollWidth: number;
}

/** One reading of the page: what is too small, what is past the edge. */
function measure(page: Page, selector = TARGETS): Promise<Measured> {
  return page.evaluate(
    ({ selector, min, width }) => {
      // The SCREEN, not `innerWidth`: on a touch phone the layout viewport
      // widens to fit overflowing content (401px for a 400px box at 360),
      // so measured against itself nothing would ever be past the edge.
      const label = (el: Element) =>
        (el.getAttribute("aria-label") ?? el.textContent ?? "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 40);
      const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
      };
      const seen: string[] = [];
      const small: string[] = [];
      for (const el of document.querySelectorAll(selector)) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        const entry = `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`;
        seen.push(entry);
        // Half a pixel of rounding is not a defect.
        if (r.width < min - 0.5 || r.height < min - 0.5) small.push(entry);
      }
      // Inside a box that SCROLLS sideways (the filter row) is by design.
      // Inside one that merely clips is not: the first version of this
      // predicate excused `hidden`/`clip` too, and the control below showed
      // it blind to a 400px box in <main> — the page clips, so content past
      // the edge is cut off rather than scrollable, which is the same defect
      // with no scrollbar to give it away.
      const scrolled = (el: Element) => {
        for (
          let p = el.parentElement;
          p && p !== document.body;
          p = p.parentElement
        )
          if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
        return false;
      };
      const overflow: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        if (!shown(el) || getComputedStyle(el).position === "fixed") continue;
        const r = el.getBoundingClientRect();
        if ((r.right > width + 1 || r.left < -1) && !scrolled(el))
          overflow.push(`${el.tagName.toLowerCase()} "${label(el)}"`);
      }
      return {
        seen,
        small,
        overflow,
        scrollWidth: document.documentElement.scrollWidth,
      };
    },
    { selector, min: MIN, width: SCREEN },
  );
}

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** A ready worker that runs one job and serves `artifact`. */
async function mockWorker(page: Page, artifact: Uint8Array): Promise<void> {
  const jobId = "job_mobilepass";
  let tool = "";
  let polls = 0;
  const job = (status: string) => {
    const now = new Date().toISOString();
    return {
      jobId,
      tool,
      capability: "secure-worker",
      status,
      progress: status === "completed" ? 100 : 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
      ...(status === "completed"
        ? {
            artifacts: [
              {
                artifactId: "art_mobilepass",
                filename: "locked-unlocked.pdf",
                contentType: "application/pdf",
                bytes: artifact.byteLength,
                url: "/__e2e/artifact/art_mobilepass",
                expiresAt: now,
              },
            ],
          }
        : {}),
    };
  };
  await page.route("**/api/worker/status", (route) =>
    json(route, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", async (route) => {
    tool = (route.request().postDataJSON() as { tool: string }).tool;
    await json(route, {
      sessionId: "ses_mobilepass",
      tool,
      slots: [
        {
          fileId: "file_mobilepass",
          filename: "in",
          url: "/__e2e/upload/file_mobilepass",
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/upload/**", (route) => json(route, {}));
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    polls = 0;
    await json(route, job("queued"));
  });
  await page.route(`**/api/jobs/${jobId}`, async (route) => {
    polls += 1;
    await json(route, job(polls < 2 ? "processing" : "completed"));
  });
  await page.route("**/__e2e/artifact/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/pdf" },
      body: Buffer.from(artifact),
    }),
  );
}

/** A file each popular tool takes, by what its catalogue entry accepts. */
async function fileFor(accept: readonly string[]) {
  if (accept.includes("PDF"))
    return {
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await makePdfBytes("report", 3)),
    };
  if (accept.includes("PNG"))
    return {
      name: "photo.png",
      mimeType: "image/png",
      buffer: encodePng(Buffer.alloc(16 * 16 * 3, 0x80), 16, 16),
    };
  return {
    name: "letter.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(
      "PK\u0003\u0004 a document, as far as a picker can tell",
    ),
  };
}

test.beforeEach(async ({ page }) => {
  // The banner is fixed over the bottom of the screen; its own buttons are
  // measured by the control below, not here.
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

test(`health: the popular set is the catalogue's, and plausibly sized (${POPULAR.length})`, () => {
  expect(POPULAR.length).toBeGreaterThanOrEqual(8);
  expect(POPULAR.length).toBeLessThanOrEqual(20);
  // Both kinds of panel are in it, so neither run trigger goes unmeasured.
  expect(POPULAR.some((t) => t.slug === "merge-pdf")).toBe(true);
  expect(POPULAR.some((t) => t.slug === "protect-pdf")).toBe(true);
});

for (const tool of POPULAR) {
  test(`/tools/${tool.slug} at 360 with a file in: no overflow, every control on the way to Run is ${MIN}px`, async ({
    page,
  }) => {
    await page.route("**/api/worker/status", (route) =>
      json(route, READY_WORKER_STATUS),
    );
    await page.goto(`/tools/${tool.slug}`);
    const input = fileInput(page);
    await waitForHydration(input);
    await input.setInputFiles(await fileFor(tool.accept));
    const trigger = page.locator(
      "[data-tool-panel] [data-run-trigger], [data-tool-panel] [data-run-dock] button",
    );
    await expect(trigger.first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const m = await measure(page);
    // The header's three and at least one run control were measured.
    expect(
      m.seen.length,
      `too few targets found: ${m.seen.join(" | ")}`,
    ).toBeGreaterThanOrEqual(4);
    expect(m.small, `under ${MIN}px: ${m.small.join(" | ")}`).toEqual([]);
    expect(m.overflow, `past the screen: ${m.overflow.join(" | ")}`).toEqual(
      [],
    );
    expect(m.scrollWidth).toBeLessThanOrEqual(SCREEN);
  });
}

for (const path of ["/", "/tools"]) {
  test(`${path} at 360: the filter chips are ${MIN}px tall, and nothing is past the screen`, async ({
    page,
  }) => {
    await page.goto(path);
    const chips = page.locator("main button[aria-pressed]");
    await expect(chips.first()).toBeVisible();
    const heights = await chips.evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => Math.round(el.getBoundingClientRect().height)),
    );
    // Health: the row is there (one chip per family and "All").
    expect(heights.length).toBeGreaterThanOrEqual(5);
    expect(heights.filter((h) => h < MIN)).toEqual([]);
    const m = await measure(page);
    expect(m.small, `under ${MIN}px: ${m.small.join(" | ")}`).toEqual([]);
    expect(m.overflow, `past the screen: ${m.overflow.join(" | ")}`).toEqual(
      [],
    );
  });
}

test("negative control: the predicates reject a 30px chip and a 400px-wide box", async ({
  page,
}) => {
  await page.route("**/api/worker/status", (route) =>
    json(route, READY_WORKER_STATUS),
  );
  await page.goto("/tools/merge-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(await fileFor(["PDF"]));
  await expect(
    page.locator("[data-tool-panel] [data-run-dock] button").first(),
  ).toBeVisible();
  const before = await measure(page);
  expect(before.small).toEqual([]);
  expect(before.overflow).toEqual([]);

  // The shipped chip, as it was before this pass: `py-1.5 text-xs`, 30px.
  await page.evaluate(() => {
    const panel = document.querySelector("[data-tool-panel]")!;
    const chip = document.createElement("button");
    chip.setAttribute("aria-pressed", "false");
    chip.textContent = "control chip";
    chip.style.cssText = "height:30px;padding:0 12px;font-size:12px";
    panel.prepend(chip);
    const wide = document.createElement("div");
    wide.textContent = "control box";
    wide.style.cssText = "width:400px;height:10px";
    document.querySelector("main")!.append(wide);
  });
  const after = await measure(page);
  expect(after.small.some((s) => s.startsWith("control chip"))).toBe(true);
  expect(after.overflow).toContain('div "control box"');
  expect(after.scrollWidth).toBeGreaterThan(SCREEN);
});

/** Is any part of `selector`'s first match inside the screen, below the header? */
async function onScreen(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      const header = document.querySelector("header")!.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > header.bottom;
    });
}

test("Unlock PDF at 360: a tap on Run ends with the result on the screen", async ({
  page,
}) => {
  await mockWorker(page, await makePdfBytes("unlocked", 1));
  await page.goto("/tools/unlock-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "locked.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(USER_PASSWORD_PDF_BASE64, "base64"),
  });
  await page.getByLabel("Current password").fill("user-pass");
  const run = page.getByRole("button", { name: "Unlock PDF" });
  await run.tap();
  const card = page.getByRole("group", {
    name: "Your PDF is unlocked and ready.",
  });
  await expect(card).toBeVisible({ timeout: 20_000 });
  // The tap left focus on the trigger — the case that used to scroll nothing.
  await expect(run).toBeFocused();
  await expect
    .poll(() =>
      onScreen(
        page,
        '[role="group"][aria-label="Your PDF is unlocked and ready."]',
      ),
    )
    .toBe(true);
  // Control: the predicate says no for something that is off the screen.
  expect(await onScreen(page, "footer")).toBe(false);
});

/*
 * THE SECOND PASS (2026-10-30): the icon buttons on the way to a result, the
 * footer's links, and the worker panels' two text buttons. Each is drawn at
 * its own size and given a 44px target on a touch screen (`tap`, `tap-row`,
 * `tap-y` in globals.css) — so this project, a touch phone, is the one that
 * can see them.
 */

/** Merge's file-row buttons; the page tiles' actions and drag handle. */
const ICON_TARGETS = [
  '[data-tool-panel] li button[aria-label^="Move "]',
  '[data-tool-panel] li button[aria-label^="Remove "]',
  "[data-tool-panel] button[title]",
  '[data-tool-panel] [aria-roledescription="Draggable page"]',
].join(", ");

/** The `WxH` entries of a reading under the minimum HEIGHT. */
const tooShort = (m: Measured) =>
  m.seen.filter((s) => Number(s.split("x").pop()) < MIN - 0.5);

for (const { slug, files, least } of [
  // Two files: every row has all three buttons.
  { slug: "merge-pdf", files: 2, least: 6 },
  // Three pages, two rotate buttons each.
  { slug: "rotate-pdf", files: 1, least: 6 },
  // Three pages, four actions and a drag handle each.
  { slug: "organize-pages", files: 1, least: 15 },
]) {
  test(`/tools/${slug} at 360: every icon button is ${MIN}px, and nothing is past the screen`, async ({
    page,
  }) => {
    await page.goto(`/tools/${slug}`);
    const input = fileInput(page);
    await waitForHydration(input);
    await input.setInputFiles(
      await Promise.all(
        Array.from({ length: files }, async (_, i) => ({
          name: `part-${i + 1}.pdf`,
          mimeType: "application/pdf",
          buffer: Buffer.from(await makePdfBytes(`part ${i + 1}`, 3)),
        })),
      ),
    );
    await expect
      .poll(async () => (await measure(page, ICON_TARGETS)).seen.length, {
        timeout: 20_000,
      })
      .toBeGreaterThanOrEqual(least);
    const m = await measure(page, ICON_TARGETS);
    expect(m.small, `under ${MIN}px: ${m.small.join(" | ")}`).toEqual([]);
    expect(m.overflow, `past the screen: ${m.overflow.join(" | ")}`).toEqual(
      [],
    );
  });
}

test(`the footer at 360: every link it shows is a ${MIN}px row`, async ({
  page,
}) => {
  await page.goto("/");
  const m = await measure(page, "footer a");
  // Health: the brand, the four columns' links and the bottom row.
  expect(m.seen.length, m.seen.join(" | ")).toBeGreaterThanOrEqual(15);
  // Height only: a link is as wide as its words, and a row of them is a
  // 44px-tall line a thumb lands on anywhere along it.
  expect(
    tooShort(m),
    `under ${MIN}px tall: ${tooShort(m).join(" | ")}`,
  ).toEqual([]);
});

test(`OCR PDF at 360 with a file in: Remove and "What happens to your file" are ${MIN}px tall`, async ({
  page,
}) => {
  await page.route("**/api/worker/status", (route) =>
    json(route, READY_WORKER_STATUS),
  );
  await page.goto("/tools/ocr-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(await fileFor(["PDF"]));
  const panel = page.locator("[data-tool-panel]");
  for (const name of ["Remove", "What happens to your file"]) {
    const button = panel.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(MIN - 0.5);
  }
});

test("negative control: the icon and footer predicates reject a 28px button and a 20px link", async ({
  page,
}) => {
  await page.goto("/tools/merge-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles(await fileFor(["PDF"]));
  await expect
    .poll(async () => (await measure(page, ICON_TARGETS)).seen.length)
    .toBeGreaterThanOrEqual(3);
  expect((await measure(page, ICON_TARGETS)).small).toEqual([]);
  expect(tooShort(await measure(page, "footer a"))).toEqual([]);
  // The file-row button as it shipped (`size-7`), and a footer link as it
  // shipped (an inline `text-sm` link, 20px tall).
  await page.evaluate(() => {
    const row = document.querySelector("[data-tool-panel] li")!;
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Move control up");
    button.style.cssText = "width:28px;height:28px;display:grid";
    row.append(button);
    const link = document.createElement("a");
    link.href = "/";
    link.textContent = "control link";
    link.style.cssText = "font-size:14px;line-height:20px";
    document.querySelector("footer p")!.append(link);
  });
  const icons = await measure(page, ICON_TARGETS);
  expect(icons.small.some((s) => s.startsWith("Move control up"))).toBe(true);
  const footer = tooShort(await measure(page, "footer a"));
  expect(footer.some((s) => s.startsWith("control link"))).toBe(true);
});
