import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fileInput, waitForHydration } from "./helpers";
import {
  COMPARE_REDLINE_CHUNK,
  REDLINE_CSP,
} from "../src/components/tools/runner/compare/redline-html";

/**
 * Compare PDF's HTML redline at the point of consumption (S4, 2026-11-15):
 * the file a person downloads, opened from disk in a fresh, OFFLINE browser
 * context, the way it is opened after it was saved or sent on.
 *
 * What is proved: the page makes no request but its own `file:` URL, the
 * browser reports no CSP violation (which is how a stylesheet whose hash
 * does not match its policy shows itself), the hashed stylesheet applies
 * (the inserted words' 2px underline, the dark and print backgrounds), it
 * fits 375 px, and the download still arrives when the redline's chunk is
 * slow. Two instrument controls show the request listener and the CSP are
 * each able to see what they are for.
 *
 * RULE: computed styles are read with `page.evaluate`, which Chromium runs
 * whatever the page's CSP says. `bypassCSP` is never set here: a context
 * that bypasses the policy would make the request and violation counts
 * meaningless.
 */

const LINES = [
  "Master services agreement",
  "1. The supplier delivers the goods by the date agreed.",
  "2. The buyer pays within thirty days of the invoice.",
];

async function textPdf(extra: string[] = [], edit = false): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([612, 792]);
    const lines =
      p === 1 && edit
        ? [
            ...LINES.slice(0, 2),
            "2. The buyer pays within sixty days of the invoice.",
            ...extra,
          ]
        : LINES;
    [...lines, `Page ${p + 1}`].forEach((line, i) =>
      page.drawText(line, { x: 60, y: 712 - i * 20, size: 12, font }),
    );
  }
  return Buffer.from(await doc.save());
}

async function compared(page: Page) {
  await page.goto("/tools/compare-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles([
    { name: "draft.pdf", mimeType: "application/pdf", buffer: await textPdf() },
    {
      name: "final.pdf",
      mimeType: "application/pdf",
      buffer: await textPdf(
        [
          "3. A clause added in the final version, long enough to wrap on a phone screen without any help.",
        ],
        true,
      ),
    },
  ]);
  await expect(
    page.locator("[data-tool-panel]").getByText("2/2 selected"),
  ).toBeVisible();
  await page.getByRole("button", { name: /compare pdfs/i }).click();
  await expect(
    page.getByRole("heading", { name: /differences found/i }),
  ).toBeVisible({ timeout: 30_000 });
}

/** Press Download redline (HTML) and save what the browser was handed. */
async function downloadRedline(page: Page, file: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("button", { name: "Download redline (HTML)" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("draft-vs-final-comparison.html");
  await download.saveAs(file);
  return readFileSync(file, "utf8");
}

interface Opened {
  context: BrowserContext;
  page: Page;
  requests: string[];
  finished: string[];
  violations: string[];
  errors: string[];
}

/** Open a file from disk in a fresh offline context, recording everything. */
async function openOffline(
  browser: Browser,
  file: string,
  viewport = { width: 1280, height: 900 },
): Promise<Opened> {
  const context = await browser.newContext({ offline: true, viewport });
  const page = await context.newPage();
  const opened: Opened = {
    context,
    page,
    requests: [],
    finished: [],
    violations: [],
    errors: [],
  };
  page.on("request", (r) => opened.requests.push(r.url()));
  page.on("requestfinished", (r) => opened.finished.push(r.url()));
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text()))
      opened.violations.push(m.text());
    else if (m.type() === "error") opened.errors.push(m.text());
  });
  page.on("pageerror", (e) => opened.errors.push(e.message));
  await page.goto(pathToFileURL(file).href);
  await page.waitForLoadState("load");
  return opened;
}

const nonFile = (urls: string[]) => urls.filter((u) => !u.startsWith("file:"));

test.describe("the HTML redline, opened from disk", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("loads nothing, breaks no policy, and is styled by its own hashed stylesheet", async ({
    page,
    browser,
  }, testInfo) => {
    await compared(page);
    const file = testInfo.outputPath("redline.html");
    const html = await downloadRedline(page, file);
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${REDLINE_CSP}" />`,
    );
    expect(html).toContain(COMPARE_REDLINE_CHUNK);

    const opened = await openOffline(browser, file);
    try {
      const { page: doc } = opened;
      // The only request is the document's own file: URL.
      expect(opened.requests).toEqual([pathToFileURL(file).href]);
      expect(opened.violations, opened.violations.join("\n")).toEqual([]);
      expect(opened.errors, opened.errors.join("\n")).toEqual([]);

      const style = () =>
        doc.evaluate(() => {
          const read = (sel: string) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el) : null;
          };
          const del = read("del");
          const ins = read("ins");
          return {
            del: del?.textDecorationLine ?? "",
            ins: ins?.textDecorationLine ?? "",
            insThickness: ins?.textDecorationThickness ?? "",
            body: getComputedStyle(document.body).backgroundColor,
            sr: read(".sr")?.position ?? "",
          };
        });
      const light = await style();
      expect(light.del).toContain("line-through");
      expect(light.ins).toContain("underline");
      // These two come from REDLINE_CSS alone: the hash matched and applied.
      expect(light.insThickness).toBe("2px");
      expect(light.sr).toBe("absolute");
      expect(light.body).toBe("rgb(255, 255, 255)");

      await doc.emulateMedia({ colorScheme: "dark" });
      const dark = await style();
      expect(dark.body).not.toBe(light.body);

      await doc.emulateMedia({ colorScheme: "dark", media: "print" });
      expect((await style()).body).toBe("rgb(255, 255, 255)");
      // Still nothing requested and nothing refused, in every mode.
      expect(nonFile(opened.requests)).toEqual([]);
      expect(opened.violations).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });

  test("instrument controls: the request listener sees a load, and the CSP is what blocks it", async ({
    page,
    browser,
  }, testInfo) => {
    await compared(page);
    const file = testInfo.outputPath("redline.html");
    const html = await downloadRedline(page, file);
    const img = '<img src="http://127.0.0.1:9/x.png" />';
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${REDLINE_CSP}" />\n`;
    expect(html).toContain(cspMeta);
    const withImg = (source: string) =>
      source.replace("<main>", `<main>${img}`);

    // (a) No CSP, an image: the listener records the request.
    const open = testInfo.outputPath("no-csp.html");
    writeFileSync(open, withImg(html.replace(cspMeta, "")));
    expect(readFileSync(open, "utf8")).not.toContain("Content-Security-Policy");
    const a = await openOffline(browser, open);
    try {
      expect(nonFile(a.requests).length).toBeGreaterThanOrEqual(1);
      expect(a.violations).toEqual([]);
    } finally {
      await a.context.close();
    }

    // (b) The CSP kept, the same image: nothing completes, and the browser
    //     reports the violation.
    const blocked = testInfo.outputPath("csp-blocked.html");
    writeFileSync(blocked, withImg(html));
    expect(readFileSync(blocked, "utf8")).toContain(img);
    const b = await openOffline(browser, blocked);
    try {
      expect(nonFile(b.finished)).toEqual([]);
      expect(b.violations.length).toBeGreaterThanOrEqual(1);
      // Which event Chromium fires for a CSP-blocked load, recorded: the
      // assertion above is pinned to `request`, the event (a) proved fires.
      testInfo.annotations.push({
        type: "csp-blocked load",
        description: `request events: ${nonFile(b.requests).length}, requestfinished: ${nonFile(b.finished).length}`,
      });
    } finally {
      await b.context.close();
    }
  });

  test("the download still arrives when the redline's chunk takes 2 s", async ({
    page,
  }, testInfo) => {
    let delayed = 0;
    const isChunk = (url: URL) =>
      url.pathname.startsWith("/_next/static/chunks/") &&
      url.pathname.endsWith(".js");
    await page.route(isChunk, async (route) => {
      const response = await route.fetch();
      const body = await response.body();
      if (body.includes(COMPARE_REDLINE_CHUNK)) {
        delayed += 1;
        await new Promise((r) => setTimeout(r, 2_000));
      }
      await route.fulfill({ response, body });
    });
    await compared(page);
    const started = Date.now();
    const html = await downloadRedline(
      page,
      testInfo.outputPath("slow-redline.html"),
    );
    expect(delayed, "the redline's chunk was never fetched").toBe(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_500);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  test("fits a 375 px screen with no sideways scroll", async ({
    page,
    browser,
  }, testInfo) => {
    await compared(page);
    const file = testInfo.outputPath("redline.html");
    await downloadRedline(page, file);
    const opened = await openOffline(browser, file, {
      width: 375,
      height: 800,
    });
    try {
      const widths = await opened.page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        rows: document.querySelectorAll(".l").length,
      }));
      expect(widths.rows).toBeGreaterThan(0);
      expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    } finally {
      await opened.context.close();
    }
  });
});
