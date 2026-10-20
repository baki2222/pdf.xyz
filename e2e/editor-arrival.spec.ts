import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { recordedShifts, startFrames, stopFrames, type Shift } from "./frames";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * THE EDITOR AS A FILE ARRIVES (2026-10-20). A file dropped on the page or
 * pasted into it opens no input window, so whatever the editor moves while
 * it opens — a page preview drawn at a size its placeholder did not hold, a
 * toolbar arriving late above it — is counted CLS, on a page the reader is
 * already looking at.
 *
 * Measured by two reviews on 2026-10-17, and REPORTED by the batch C matrix
 * (`continue-chain.spec.ts`'s "inside the editor as it opened" annotation)
 * without being bounded: Edit, Annotate and Redact PDF 0.13–0.16 at 360 and
 * 390 px, Merge PDF 0.012–0.045. Here it is bounded: the SUM of every
 * layout shift outside an input's window, from the drop (or paste) until
 * the editor has been still for {@link QUIET_MS}, is at most a tenth of
 * Google's "good" line — whatever moved.
 *
 * The file goes in through the page's own drop and paste paths
 * (`drop-anywhere.spec.ts`'s synthetic `DataTransfer`: a real browser
 * object, dispatched on the tool's heading or the body), never through the
 * file input — a pick through the system dialog is forgiven by its input
 * window and would measure nothing.
 *
 * Health, per row: the instrument saw a shift of its own making at this
 * size (a sum of nothing is the strongest possible pass), and the editor
 * opened with THIS file in it. The editors are derived from nothing — they
 * are the ones the reviews named; every other runner's arrival is reported
 * by `continue-chain.spec.ts`.
 */

const EDITORS = [
  { slug: "edit-pdf", pages: 1 },
  { slug: "annotate-pdf", pages: 1 },
  { slug: "redact-pdf", pages: 2 },
  { slug: "merge-pdf", pages: 3 },
] as const;

/** Two phones the reviews measured, and one desktop. */
const SCREENS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
] as const;

const ARRIVALS = ["drop", "paste"] as const;
type Arrival = (typeof ARRIVALS)[number];

/** A tenth of Google's 0.1. */
const MAX_CLS = 0.01;
/** The editor is settled once nothing has shifted for this long. */
const QUIET_MS = 1500;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

/** US Letter, portrait, with a line of text on each page. */
async function letterPdf(label: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++)
    doc
      .addPage([612, 792])
      .drawText(`${label} — page ${i + 1}`, { x: 72, y: 700, size: 18, font });
  return Buffer.from(await doc.save()).toString("base64");
}

/** The same shift the page-CLS specs make: proof the observer is live here. */
async function shiftOfOurOwn(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const box = document.createElement("div");
        box.textContent = "instrument check";
        box.style.cssText =
          "position:fixed;left:0;top:0;width:40vw;height:20vh;z-index:9999;background:Canvas;color:CanvasText";
        document.body.append(box);
        const at = performance.now();
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        void frame()
          .then(frame)
          .then(() => {
            box.style.top = "25vh";
          })
          .then(frame)
          .then(frame)
          .then(() => {
            box.remove();
            resolve(at);
          });
      }),
  );
}

/** A file delivered the way a drop or a paste delivers one: no input window. */
async function deliver(page: Page, how: Arrival, name: string, b64: string) {
  const dt = await page.evaluateHandle(
    ({ name, b64 }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: "application/pdf" }));
      return dt;
    },
    { name, b64 },
  );
  if (how === "drop") {
    const heading = page.locator("main h1").first();
    await heading.dispatchEvent("dragenter", { dataTransfer: dt });
    await heading.dispatchEvent("dragover", { dataTransfer: dt });
    await heading.dispatchEvent("drop", { dataTransfer: dt });
  } else {
    await page.evaluate((clipboardData) => {
      document.body.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, dt);
  }
}

/** Resolves once no shift has been recorded for {@link QUIET_MS}. */
async function settled(page: Page) {
  await page.waitForFunction(
    (quiet) => {
      const w = window as unknown as {
        __shifts: { t: number }[];
        __quietFrom?: number;
      };
      const last = w.__shifts.at(-1)?.t ?? 0;
      return performance.now() - Math.max(last, w.__quietFrom ?? 0) >= quiet;
    },
    QUIET_MS,
    { polling: 100, timeout: 20_000 },
  );
}

async function arrive(
  page: Page,
  slug: string,
  pages: number,
  screen: (typeof SCREENS)[number],
  how: Arrival,
) {
  await page.setViewportSize(screen);
  await page.goto(`/tools/${slug}`);
  await waitForHydration(fileInput(page));
  await page
    .locator("html[data-drop-layer]")
    .waitFor({ state: "attached", timeout: 5000 });
  await page.evaluate(() => document.fonts.ready);
  await startFrames(page, { tops: {}, present: {} });
  const ownAt = await shiftOfOurOwn(page);
  const name = `arrival-${slug}.pdf`;
  const b64 = await letterPdf(name, pages);
  const arrivedAt = await page.evaluate(() => {
    (window as unknown as { __quietFrom: number }).__quietFrom =
      performance.now();
    return performance.now();
  });
  await deliver(page, how, name, b64);
  await expect(
    page.locator("main").getByText(name, { exact: true }).first(),
    "the editor did not open with the file",
  ).toBeVisible({ timeout: 15_000 });
  await settled(page);
  const shifts = await recordedShifts(page);
  await stopFrames(page);
  const counted = shifts.filter((s) => !s.input && s.t >= arrivedAt);
  return {
    own: shifts.filter((s) => s.t >= ownAt && s.t < arrivedAt),
    counted,
    cls: counted.reduce((sum, s) => sum + s.value, 0),
    listed: (list: readonly Shift[]) =>
      list
        .map(
          (s) =>
            `${s.value.toFixed(4)} @${Math.round(s.t - arrivedAt)}ms [${s.sources.join(" | ")}]`,
        )
        .join("\n") || "none",
  };
}

test.describe("the editor as a file arrives", () => {
  for (const { slug, pages } of EDITORS)
    for (const screen of SCREENS)
      for (const how of ARRIVALS)
        test(`${slug} at ${screen.width} x ${screen.height}, by ${how}: CLS ≤ ${MAX_CLS} until the editor is still`, async ({
          page,
        }, testInfo) => {
          test.setTimeout(60_000);
          const m = await arrive(page, slug, pages, screen, how);
          testInfo.annotations.push({
            type: "cls",
            description: m.cls.toFixed(4),
          });
          expect(
            m.own.length,
            "the instrument saw no shift of its own making",
          ).toBeGreaterThan(0);
          expect(
            m.cls,
            `${slug} at ${screen.width} x ${screen.height}, by ${how}: CLS ${m.cls.toFixed(4)} over ${m.counted.length} shift(s):\n${m.listed(m.counted)}`,
          ).toBeLessThanOrEqual(MAX_CLS);
        });
});
