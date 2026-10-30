import { expect, test, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { handoffCapabilityFor } from "../src/lib/handoff/capability";
import {
  fileInput,
  makeFormPdfBytes,
  makePdfBytes,
  makeScanPdfBytes,
  waitForHydration,
} from "./helpers";

/**
 * THE PREFLIGHT HINT, IN A REAL BROWSER (redesign WP-11, E.9).
 *
 *  1. A scan opened in PDF to Text says, in its file header, that it has no
 *     selectable text and OCR PDF makes it searchable — and the hint's
 *     button opens OCR PDF. The spec's target is that OCR PDF opens with the
 *     file STAGED (WP-10's stage mode); a worker tool takes no hand-off
 *     until then, so the leg that asserts the staged file is chosen by the
 *     capability the launch itself goes by. Either way: nothing is uploaded
 *     before Run — no request with a body, and none but a GET to `/api/`,
 *     during the whole flow.
 *  2. A form opened in Sign PDF says it has fillable fields, and its button
 *     CARRIES the file to Fill Forms, which opens with it and says where it
 *     came from.
 *  3. Control: a text PDF in PDF to Text gets no hint.
 *  4. The hint arrives with the editor: no painted frame shows the file
 *     header without it (sampled every frame — this holds at any width),
 *     and so it moves nothing: the sum of
 *     layout shifts outside an input window, from a DROP (which opens no
 *     input window) until the editor is still, is held to the bound
 *     `editor-arrival.spec.ts` uses — with that spec's instrument check,
 *     a shift of our own, so a sum of nothing cannot pass for a pass.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * Every request that could carry a file: anything but a GET to the site's
 * API (the worker panel's status check is a GET with no body), or any
 * request with a body at all.
 */
function uploads(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    const api = url.pathname.startsWith("/api/");
    if (
      (api && req.method() !== "GET") ||
      (req.postDataBuffer()?.length ?? 0) > 0
    )
      seen.push(`${req.method()} ${url.pathname}`);
  });
  return seen;
}

async function open(page: Page, slug: string, name: string, bytes: Uint8Array) {
  await page.goto(`/tools/${slug}`);
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(
    page.locator("[data-file-header]").getByText(name, { exact: true }),
  ).toBeVisible();
}

test("a scan in PDF to Text shows the OCR hint, and its button opens OCR PDF", async ({
  page,
}) => {
  const sent = uploads(page);
  await open(page, "pdf-to-text", "scan.pdf", await makeScanPdfBytes(1));
  const hint = page.locator("[data-file-header] [role=note]");
  await expect(hint).toContainText(
    "No selectable text on page 1 — OCR PDF makes it searchable first",
  );
  const stages = handoffCapabilityFor("ocr-pdf").supported;
  const button = hint.getByRole("button", {
    name: stages ? "Open OCR PDF with this file" : "Open OCR PDF",
    exact: true,
  });
  if (!stages) {
    await expect(hint).toContainText("uploads to our secure server only when");
    test.info().annotations.push({
      type: "pending",
      description:
        "OCR PDF takes no hand-off yet (WP-10 stage mode): the staged-file leg is not exercised",
    });
  }
  await button.click();
  await expect(page).toHaveURL(/\/tools\/ocr-pdf$/);
  if (stages) await expect(page.getByText("scan.pdf").first()).toBeVisible();
  expect(sent, sent.join("\n")).toEqual([]);
});

test("a form in Sign PDF shows the Fill Forms hint, and its button carries the file there", async ({
  page,
}) => {
  const sent = uploads(page);
  await open(page, "sign-pdf", "annex.pdf", await makeFormPdfBytes("annex"));
  const hint = page.locator("[data-file-header] [role=note]");
  await expect(hint).toContainText(
    "This PDF has 2 fillable fields — Fill Forms keeps them fillable",
  );
  await hint
    .getByRole("button", {
      name: "Open Fill Forms with this file",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/tools\/fill-forms$/);
  await expect(
    page.getByText("Loaded annex.pdf from Sign PDF to fill in its fields."),
  ).toBeVisible();
  await expect(
    page.locator("[data-file-header]").getByText("annex.pdf", { exact: true }),
  ).toBeVisible();
  expect(sent, sent.join("\n")).toEqual([]);
});

test("control: a text PDF in PDF to Text gets no hint", async ({ page }) => {
  await open(page, "pdf-to-text", "words.pdf", await makePdfBytes("words", 2));
  // The editor is open, and settled past the probe: still no note.
  await page.waitForTimeout(500);
  await expect(page.locator("[data-file-header] [role=note]")).toHaveCount(0);
});

/** A tenth of Google's 0.1 — `editor-arrival.spec.ts`'s bound. */
const MAX_CLS = 0.01;

for (const { slug, name, make } of [
  { slug: "pdf-to-text", name: "scan.pdf", make: () => makeScanPdfBytes(3) },
  { slug: "edit-pdf", name: "annex.pdf", make: () => makeFormPdfBytes("a") },
] as const)
  for (const width of [390, 1280])
    test(`the hint arrives with the editor: ${slug} at ${width} px moves nothing after a drop`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/tools/${slug}`);
      await waitForHydration(fileInput(page));
      await page
        .locator("html[data-drop-layer]")
        .waitFor({ state: "attached", timeout: 5000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        const w = window as unknown as { __cls: number; __own: number };
        w.__cls = 0;
        w.__own = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as {
            value: number;
            hadRecentInput: boolean;
            sources?: { node?: Node | null }[];
          }[]) {
            if (e.hadRecentInput) continue;
            const own = e.sources?.some(
              (s) => (s.node as Element | null)?.id === "instrument-check",
            );
            if (own) w.__own += e.value;
            else w.__cls += e.value;
          }
        }).observe({ type: "layout-shift", buffered: false });
      });
      // Instrument check: a shift of our own is seen.
      await page.evaluate(async () => {
        const box = document.createElement("div");
        box.id = "instrument-check";
        box.textContent = "instrument check";
        box.style.cssText =
          "position:fixed;left:0;top:0;width:40vw;height:20vh;z-index:9999;background:Canvas";
        document.body.append(box);
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        await frame();
        await frame();
        box.style.top = "25vh";
        await frame();
        await frame();
        box.remove();
      });
      // Every painted frame from here: was the header drawn WITHOUT its hint?
      // A CLS sum scales with the screen, so a late hint can pass it on a
      // wide one (1280 px stayed green with the hint 400 ms late); a frame
      // that shows the header bare cannot.
      await page.evaluate(() => {
        const w = window as unknown as { __frames: number; __bare: number };
        w.__frames = 0;
        w.__bare = 0;
        const tick = () => {
          const header = document.querySelector("[data-file-header]");
          if (header) {
            w.__frames += 1;
            if (!header.querySelector("[role=note]")) w.__bare += 1;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const data = b64(await make());
      const dt = await page.evaluateHandle(
        ({ name, data }) => {
          const bin = atob(data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const dt = new DataTransfer();
          dt.items.add(new File([bytes], name, { type: "application/pdf" }));
          return dt;
        },
        { name, data },
      );
      const heading = page.locator("main h1").first();
      await heading.dispatchEvent("dragenter", { dataTransfer: dt });
      await heading.dispatchEvent("dragover", { dataTransfer: dt });
      await heading.dispatchEvent("drop", { dataTransfer: dt });
      // Health: the editor opened with THIS file, and the hint is in it.
      await expect(
        page.locator("[data-file-header] [role=note]"),
      ).toBeVisible();
      await page.waitForTimeout(1500);
      const { cls, own, frames, bare } = await page.evaluate(() => {
        const w = window as unknown as {
          __cls: number;
          __own: number;
          __frames: number;
          __bare: number;
        };
        return {
          cls: w.__cls,
          own: w.__own,
          frames: w.__frames,
          bare: w.__bare,
        };
      });
      expect(own, "the instrument saw no shift of its own").toBeGreaterThan(0);
      // Health: the sampler saw the header in many frames.
      expect(frames, "the frame sampler saw no header").toBeGreaterThan(10);
      expect(bare, "frames that drew the header without its hint").toBe(0);
      expect(cls).toBeLessThanOrEqual(MAX_CLS);
    });
