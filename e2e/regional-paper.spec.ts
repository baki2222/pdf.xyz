import { test, expect, type Page, type Route } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { attachConsoleGuard, fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import { TEXT_PAGE_SIZES } from "../src/lib/pdf/text-page-options";

/**
 * Audit backlog #5 (2026-11-16): the page-size controls start on the paper
 * of the browser's region, through the SERVED page (`next start`), in a
 * browser whose language says the region:
 *
 *  - Text to PDF, one text and a batch of two: the pressed chip, and the
 *    page box of the PDF that is downloaded;
 *  - Webpage to PDF and HTML to PDF: the Page size menu, and the `pageSize`
 *    the job request carries (the worker mocked at the wire).
 *
 * And the seam the server cannot see across: its HTML is rendered with no
 * languages to read, so it shows A4. Each page is checked for a hydration
 * mismatch report (console or page error) and for any layout shift whose
 * source is inside the tool's panel while the default resolves.
 */

// Tall enough that each panel is on screen at first paint: the browser
// reports a layout shift only where it can be seen (the CONTROL below
// failed at 720 px, the chips being below the fold).
test.use({ viewport: { width: 1280, height: 2400 } });

const CASES = [
  { locale: "en-GB", text: "a4", html: "A4" },
  { locale: "en-US", text: "letter", html: "Letter" },
] as const;

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
    // Every layout shift from the first paint, with where its sources sit.
    const w = window as unknown as { __shifts: unknown[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node | null }[];
      }[]) {
        w.__shifts.push({
          value: e.value,
          input: e.hadRecentInput,
          sources: (e.sources ?? []).map((s) => {
            const el =
              s.node instanceof Element ? s.node : s.node?.parentElement;
            return {
              tag: el?.tagName ?? "?",
              text: (el?.textContent ?? "").slice(0, 40),
              inPanel: !!el?.closest("[data-regional-probe]"),
            };
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  }, CONSENT_STORAGE_KEY);
});

/** Mark the panel (the element holding `anchor`) so shifts inside it are named. */
async function markPanel(page: Page, anchor: string) {
  await page.evaluate((text) => {
    const heading = [...document.querySelectorAll("h3, legend, label")].find(
      (el) => el.textContent?.trim().startsWith(text),
    );
    const panel = heading?.closest("form, fieldset, section, main");
    panel?.setAttribute("data-regional-probe", "");
    return !!panel;
  }, anchor);
}

async function settledShifts(page: Page) {
  await page.waitForTimeout(500);
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __shifts: {
            value: number;
            input: boolean;
            sources: { tag: string; text: string; inPanel: boolean }[];
          }[];
        }
      ).__shifts,
  );
}

const HYDRATION = /hydrat|#418|#423|#425|did not match/i;

function hydrationReports(guard: ReturnType<typeof attachConsoleGuard>) {
  return [...guard.consoleErrors, ...guard.pageErrors].filter((t) =>
    HYDRATION.test(t),
  );
}

async function pageBox(path: string) {
  const doc = await PDFDocument.load(await readFile(path));
  const { width, height } = doc.getPage(0).getSize();
  return { width, height };
}

for (const c of CASES) {
  test.describe(`${c.locale}`, () => {
    test.use({ locale: c.locale });
    const paper = TEXT_PAGE_SIZES.find((s) => s.id === c.text)!;

    test(`Text to PDF starts on ${paper.label} and the PDF is ${paper.label}`, async ({
      page,
    }) => {
      const guard = attachConsoleGuard(page);
      await page.goto("/tools/text-to-pdf");
      const box = page.getByPlaceholder("Paste or type plain text here…");
      await waitForHydration(box);
      await expect(
        page.getByRole("button", { name: paper.label, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      for (const other of TEXT_PAGE_SIZES.filter((s) => s.id !== c.text))
        await expect(
          page.getByRole("button", { name: other.label, exact: true }),
        ).toHaveAttribute("aria-pressed", "false");
      await markPanel(page, "Page size");
      const shifts = await settledShifts(page);
      expect(
        shifts.filter((s) => !s.input && s.sources.some((x) => x.inPanel)),
        "something in the panel moved while the page loaded",
      ).toEqual([]);
      expect(hydrationReports(guard)).toEqual([]);

      await box.fill("regional paper proof");
      await page.getByRole("button", { name: /create pdf/i }).click();
      await expect(
        page.getByRole("heading", { name: "PDF created" }),
      ).toBeVisible();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: /^download pdf$/i }).click();
      const file = await (await download).path();
      expect(await pageBox(file)).toEqual(paper.size);
    });

    test(`Text to PDF batch: two files, both ${paper.label}`, async ({
      page,
    }) => {
      await page.goto("/tools/text-to-pdf");
      const input = fileInput(page);
      await waitForHydration(input);
      await input.setInputFiles([
        {
          name: "one.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("first file"),
        },
        {
          name: "two.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("second file"),
        },
      ]);
      const run = page.getByRole("button", { name: "Convert 2 text files" });
      await expect(run).toBeVisible({ timeout: 15_000 });
      // The batch shows the same page setup, on the same paper.
      await expect(
        page.getByRole("button", { name: paper.label, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await run.click();
      const zipButton = page.getByRole("button", { name: /download all/i });
      await expect(zipButton).toBeVisible({ timeout: 20_000 });
      const download = page.waitForEvent("download");
      await zipButton.click();
      const zip = await JSZip.loadAsync(
        await readFile(await (await download).path()),
      );
      const pdfs = Object.keys(zip.files).filter((n) => n.endsWith(".pdf"));
      expect(pdfs.sort()).toEqual(["one-pdf.pdf", "two-pdf.pdf"]);
      for (const name of pdfs) {
        const doc = await PDFDocument.load(
          await zip.file(name)!.async("uint8array"),
        );
        expect(doc.getPage(0).getSize()).toEqual(paper.size);
      }
    });

    for (const slug of ["webpage-to-pdf", "html-to-pdf"] as const) {
      test(`${slug} starts on ${c.html} and the job asks for it`, async ({
        page,
      }) => {
        const guard = attachConsoleGuard(page);
        const jobs: Record<string, unknown>[] = [];
        await page.route("**/api/worker/status", (route) =>
          json(route, 200, READY_WORKER_STATUS),
        );
        await page.route("**/api/uploads", (route) =>
          json(route, 200, {
            sessionId: "ses_rp",
            tool: slug,
            slots: [
              {
                fileId: "f_regionalpaper01",
                filename: "in",
                url: "/__e2e/rp-upload/1",
                method: "PUT",
                headers: {},
              },
            ],
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
          }),
        );
        await page.route("**/__e2e/rp-upload/**", (route) =>
          json(route, 200, {}),
        );
        const failed = {
          jobId: "job_rp",
          tool: slug,
          capability: "secure-worker",
          status: "failed",
          progress: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
          error: {
            code: "internal_error",
            message: "Stopped by the test.",
            retryable: false,
          },
        };
        await page.route("**/api/jobs", async (route) => {
          if (route.request().method() !== "POST") return route.fallback();
          jobs.push(JSON.parse(route.request().postDataBuffer()!.toString()));
          await json(route, 200, failed);
        });
        await page.route("**/api/jobs/job_rp", (route) =>
          json(route, 200, failed),
        );

        await page.goto(`/tools/${slug}`);
        const size = page.getByLabel("Page size");
        await waitForHydration(size);
        await expect(size).toHaveValue(c.html);
        await markPanel(page, "Page layout");
        const shifts = await settledShifts(page);
        expect(
          shifts.filter((s) => !s.input && s.sources.some((x) => x.inPanel)),
          "something in the panel moved while the page loaded",
        ).toEqual([]);
        expect(hydrationReports(guard)).toEqual([]);

        if (slug === "webpage-to-pdf") {
          await page.getByLabel("Web address").fill("https://example.com/");
        } else {
          await page
            .getByRole("button", { name: "Or paste HTML code" })
            .click();
          await page.getByLabel("HTML code").fill("<p>regional</p>");
        }
        const render = page.getByRole("button", { name: "Render PDF" });
        await expect(render).not.toHaveAttribute("aria-disabled", "true", {
          timeout: 15_000,
        });
        await render.click();
        await expect.poll(() => jobs.length, { timeout: 15_000 }).toBe(1);
        expect((jobs[0]!.options as Record<string, unknown>).pageSize).toBe(
          c.html,
        );
      });
    }
  });
}

test("CONTROL: the shift recorder sees a move inside the panel", async ({
  page,
}) => {
  await page.goto("/tools/text-to-pdf");
  await waitForHydration(
    page.getByPlaceholder("Paste or type plain text here…"),
  );
  await markPanel(page, "Page size");
  await settledShifts(page);
  // Push the panel's content down by 80 px, as a late-resolving default
  // that changed a height would.
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h3")].find((el) =>
      el.textContent?.trim().startsWith("Page size"),
    )!;
    const spacer = document.createElement("div");
    spacer.style.height = "80px";
    heading.parentElement!.parentElement!.prepend(spacer);
  });
  const shifts = await settledShifts(page);
  expect(
    shifts.filter((s) => !s.input && s.sources.some((x) => x.inPanel)).length,
  ).toBeGreaterThan(0);
});
