import { test, expect, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";
import {
  askThreeFills,
  axeViolations,
  mockChatWorker,
} from "./chat-citations-fixture";
import {
  clipboardText,
  expectNoSidewaysScroll,
  grantClipboard,
  mockCompletedJob,
  summaryPackage,
  textPdf,
} from "./ai-results-fixture";

/**
 * The summary and the chat answer drawn as formatted Markdown (competitor
 * audit #4, 2026-11-17), through the SERVED pages with the worker mocked at
 * the wire: headings that continue the page's outline, lists, bold, code and
 * links; a hostile answer that stays inert in a real browser; Copy still
 * copying the Markdown source; axe; and a 375x812 pass.
 */

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const unix = (text: string) => text.split(CR).join("");

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
    // A script that ran would say so here; a dialog is caught below too.
    (window as unknown as { __ran: string[] }).__ran = [];
    window.alert = (m?: unknown) => {
      (window as unknown as { __ran: string[] }).__ran.push(String(m));
    };
  }, CONSENT_STORAGE_KEY);
  await grantClipboard(page);
});

/**
 * Every heading inside a formatted text, against the page's own outline: the
 * first is one level under the nearest heading before it outside the text,
 * and none is shallower than that or deeper than h6. Read in document order
 * from the served page, so the base each caller passes is checked where the
 * reader gets it.
 */
async function outlineBreaks(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    let outside = 1;
    let firstIn = new Set<Element>();
    for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const level = Number(h.tagName[1]);
      const root = h.closest("[data-markdown]");
      if (!root) {
        outside = level;
        continue;
      }
      const label = `${h.tagName} "${h.textContent}" under h${outside}`;
      if (!firstIn.has(root)) {
        firstIn = new Set([...firstIn, root]);
        if (level !== outside + 1) found.push(`first ${label}`);
      }
      if (level <= outside || level > 6) found.push(label);
    }
    return found;
  });
}

/** The page's state a hostile text must leave untouched. */
async function inertness(page: Page) {
  return page.evaluate(() => ({
    ran: (window as unknown as { __ran: string[] }).__ran,
    scriptHrefs: [...document.querySelectorAll("[href]")]
      .map((el) => el.getAttribute("href")!)
      .filter((href) => /^\s*(?:javascript|vbscript|data):/i.test(href)),
    inText: [...document.querySelectorAll("[data-markdown]")].map((root) => ({
      scripts: root.querySelectorAll("script, img, iframe, svg, style").length,
      onAttributes: [...root.querySelectorAll("*")].flatMap((el) =>
        el.getAttributeNames().filter((n) => n.startsWith("on")),
      ),
    })),
  }));
}

const SUMMARY = [
  "# Lease summary",
  "",
  "The lease runs for **three years** and the *tenant* pays `rent` monthly.",
  "",
  "## Key points",
  "",
  "1. Rent is due on the first",
  "   - paid by transfer",
  "2. Notice is ninety days",
  "",
  "| Item | Amount |",
  "| :--- | -----: |",
  "| Rent | 1,200 |",
  "",
  "Read the [terms](https://example.com/terms) or https://example.com/a-very-long-address-that-must-wrap-on-a-phone-screen-without-scrolling-sideways-at-all.",
].join(LF);

async function summarize(page: Page, summary: string) {
  await mockCompletedJob(
    page,
    "summarize-pdf",
    "report-summary.zip",
    await summaryPackage(summary),
  );
  await page.goto("/tools/summarize-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: await textPdf([["A lease agreement with selectable text."]]),
  });
  const run = page.getByRole("button", { name: "Summarize PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await run.click();
  const box = page.getByRole("region", { name: "Summary" });
  await expect(box).toBeVisible({ timeout: 20_000 });
  return box;
}

test("Summarize PDF: the summary is formatted, its headings fit the outline, Copy copies the source", async ({
  page,
}) => {
  const box = await summarize(page, SUMMARY);
  // The derived check first, so a wrong base fails HERE, not on a tag name.
  await expect(box.locator("h4, h3, h5").first()).toBeVisible();
  expect(await outlineBreaks(page)).toEqual([]);
  await expect(box.locator("h4")).toHaveText("Lease summary");
  await expect(box.locator("h5")).toHaveText("Key points");
  await expect(box.locator("strong")).toHaveText("three years");
  await expect(box.locator("em")).toHaveText("tenant");
  await expect(box.locator("p code")).toHaveText("rent");
  await expect(box.locator("ol > li")).toHaveCount(2);
  await expect(box.locator("ol ul > li")).toHaveText("paid by transfer");
  await expect(box.getByRole("table").locator("tbody tr")).toHaveCount(1);
  const terms = box.getByRole("link", { name: "terms" });
  await expect(terms).toHaveAttribute("href", "https://example.com/terms");
  await expect(terms).toHaveAttribute("target", "_blank");
  await expect(terms).toHaveAttribute("rel", "noopener noreferrer nofollow");
  // No mark is left in what the reader sees.
  const shown = (await box.textContent()) ?? "";
  for (const mark of ["**", "# ", "](", "| :---"])
    expect(shown, mark).not.toContain(mark);
  expect(await outlineBreaks(page)).toEqual([]);

  await page.getByRole("button", { name: "Copy summary" }).click();
  await expect.poll(async () => unix(await clipboardText(page))).toBe(SUMMARY);

  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(200);
  await expectNoSidewaysScroll(page);
  await expect(box.locator("h4")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

const ANSWER = [
  "## Rent",
  "",
  "- Due on the **first** [p.2]",
  "- Paid by `transfer` [p.3]",
  "",
  "See the [landlord's site](https://example.com/rent).",
].join(LF);

test("Chat with PDF: the answer is formatted, its page buttons work, Copy copies the source", async ({
  page,
}) => {
  await mockChatWorker(page, "Where is the rent?", ANSWER, [2, 3]);
  await askThreeFills(page, "Where is the rent?");
  const answer = page.locator("[data-markdown]");
  await expect(answer).toBeVisible({ timeout: 20_000 });
  expect(await outlineBreaks(page)).toEqual([]);
  await expect(answer.locator("h3")).toHaveText("Rent");
  await expect(answer.locator("ul > li")).toHaveCount(2);
  await expect(answer.locator("strong")).toHaveText("first");
  await expect(answer.locator("code")).toHaveText("transfer");
  const link = answer.getByRole("link", { name: "landlord's site" });
  await expect(link).toHaveAttribute("href", "https://example.com/rent");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await expect(answer.getByRole("button")).toHaveText(["[p.2]", "[p.3]"]);
  expect(await outlineBreaks(page)).toEqual([]);

  await page.getByRole("button", { name: "Copy answer" }).click();
  await expect.poll(async () => unix(await clipboardText(page))).toBe(ANSWER);

  // A page button inside a list item still opens its page.
  await answer.getByRole("button", { name: "Show page 3 of your PDF" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Page 3 of 3" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(200);
  await expectNoSidewaysScroll(page);
  expect(await axeViolations(page)).toEqual([]);
});

const HOSTILE = [
  "<script>alert('script')</script>",
  "<img src=x onerror=\"alert('img')\">",
  "[a](javascript:alert('a')) [b](JaVaScRiPt:alert('b')) [c](&#106;avascript:alert('c'))",
  "[d](data:text/html,<script>alert('d')</script>) [e](vbscript:msgbox('e'))",
  "<javascript:alert('f')> [[[g](javascript:alert('g'))]]",
  "**unclosed *marks `everywhere [p.2]",
].join(LF + LF);

test("Chat with PDF: a hostile answer stays inert in the browser", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await mockChatWorker(page, "Anything?", HOSTILE, [2]);
  await askThreeFills(page, "Anything?");
  const answer = page.locator("[data-markdown]");
  await expect(answer).toBeVisible({ timeout: 20_000 });
  // The markup is characters on the page.
  await expect(answer).toContainText("<script>alert('script')</script>");
  await expect(answer).toContainText("<img src=x onerror=");
  await expect(answer.getByRole("link")).toHaveCount(0);
  // Health check: the detector sees what it is for (the page button is real).
  await expect(answer.getByRole("button")).toHaveText(["[p.2]"]);
  // Click everything that looks like a link, then look.
  for (const text of ["[a]", "javascript:alert('f')"])
    await answer.getByText(text, { exact: false }).first().click();
  const state = await inertness(page);
  expect(state.ran).toEqual([]);
  expect(dialogs).toEqual([]);
  expect(state.scriptHrefs).toEqual([]);
  expect(state.inText).toEqual([{ scripts: 0, onAttributes: [] }]);

  await page.getByRole("button", { name: "Copy answer" }).click();
  await expect.poll(async () => unix(await clipboardText(page))).toBe(HOSTILE);
  expect(await axeViolations(page)).toEqual([]);
});

test("positive control: the inertness probe sees a script that runs and a javascript: href", async ({
  page,
}) => {
  await page.goto("/tools/chat-with-pdf");
  await page.evaluate(() => {
    const root = document.createElement("div");
    root.setAttribute("data-markdown", "");
    const a = document.createElement("a");
    a.setAttribute("href", "javascript:void 0");
    const img = document.createElement("img");
    img.setAttribute("onerror", "alert('probe')");
    img.src = "data:,x";
    root.append(a, img);
    document.body.append(root);
  });
  await expect.poll(async () => (await inertness(page)).ran).toEqual(["probe"]);
  const state = await inertness(page);
  expect(state.scriptHrefs).toEqual(["javascript:void 0"]);
  expect(state.inText.at(-1)).toEqual({
    scripts: 1,
    onAttributes: ["onerror"],
  });
});
