import { test, expect } from "@playwright/test";
import { attachConsoleGuard } from "./helpers";

const PAGE = "/tools/ocr-pdf";

test.describe("OCR secure-worker tool page", () => {
  test("shows an honest OCR flow and never fakes a result when disabled", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await page.goto(PAGE);

    await expect(
      page.getByRole("heading", { level: 1, name: "OCR PDF" }),
    ).toBeVisible();

    // The dedicated OCR panel (not the generic preview, not a fake uploader).
    await expect(page.getByText("Secure-worker OCR")).toBeVisible();
    await expect(
      page.getByText("OCR PDF runs on our secure server"),
    ).toBeVisible();

    // Real recognition settings are offered.
    await expect(page.getByRole("button", { name: "English" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Spanish" })).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Searchable PDF", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Text sidecar" }),
    ).toBeVisible();

    // The request summary reflects the options and updates as they change.
    await expect(page.getByText(/English → Searchable PDF/)).toBeVisible();
    // Selecting a language ADDS it: a page mixing scripts needs every model present,
    // and the measurement showed the count matters far more than the order.
    await page.getByRole("button", { name: "Spanish" }).click();
    await expect(
      page.getByText(/English, Spanish → Searchable PDF/),
    ).toBeVisible();

    // Honest capability: disabled in this environment, with a clear reason.
    await expect(page.getByText("Not enabled")).toBeVisible();
    // Since 2026-10-24 the not-enabled box leads with one sentence and keeps
    // the reason behind "Why?": hidden until asked for, then shown.
    const reason = page.getByText(
      /needs a secure worker with a native ocr engine/i,
    );
    await expect(reason).toBeHidden();
    await page.getByRole("button", { name: "Why?" }).click();
    await expect(reason).toBeVisible();

    // The pipeline. (Earlier still, these lines asserted "Isolated processing"
    // VISIBLE — a stage promising "a single-job sandbox with no network
    // egress" the daemon never had — and a malware scan nothing ran.)
    // INVERTED in WP-10. Until then the not-enabled panel drew the whole
    // pipeline, and these lines read it there ("Structural preflight",
    // "3. Processing", "5. Auto-delete"). A worker that is off has no job to
    // stage, so its reason now stands IN PLACE of the docket; the pipeline
    // a reader and a crawler get is the one the page SERVES, before any
    // status is heard — read here from the HTML, and holding neither claim:
    // not "Malware scan", not "Files are not scanned" — "Safety checks".
    const served = await (await page.request.get(PAGE)).text();
    expect(served).toContain("Safety checks");
    expect(served).not.toContain("Malware scan");
    expect(served).not.toMatch(/Isolated processing|sandbox|network egress/i);
    expect(served).toContain("Auto-delete");
    await expect(page.locator("[data-docket]")).toHaveCount(0);
    await expect(page.getByText("Malware scan")).toHaveCount(0);

    // INVERTED in WP-10 (was "no uploader is mounted while OCR is
    // unavailable"): the drop zone takes a file; what cannot happen is the
    // upload — Run is drawn, and off.
    expect(await page.locator('input[type="file"]').count()).toBe(1);
    await expect(
      page.getByRole("button", { name: "Run OCR on the worker" }),
    ).toHaveAttribute("aria-disabled", "true");

    // And no fabricated success / download.
    await expect(page.getByText(/OCR complete/i)).toHaveCount(0);
    // (WAS: no Run button at all. It is drawn since WP-10, and off — above.)
    await expect(page.getByRole("link", { name: /\.pdf$/i })).toHaveCount(0);

    // The notify button discloses what pressing it sends, then sends exactly
    // that: one beacon to /api/interest carrying the tool's slug and nothing
    // else. The acknowledgement claims only what happened — no waitlist, no
    // notification promise.
    const notify = page.getByRole("button", { name: /notify me/i });
    await expect(notify).toBeVisible();
    await expect(
      page.getByText(/the count holds only the tool's name/i),
    ).toBeVisible();
    const beacon = page.waitForRequest(
      (req) => req.url().includes("/api/interest") && req.method() === "POST",
    );
    await notify.click();
    expect((await beacon).postDataJSON()).toEqual({ slug: "ocr-pdf" });
    await expect(page.getByText(/one more ask for .+ counted/i)).toBeVisible();
    await expect(page.getByText(/waitlist/i)).toHaveCount(0);

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });

  test("the OCR upload session and job stay honest (503, never completed)", async ({
    request,
  }) => {
    // A well-formed OCR upload session is validated, then honestly refused.
    const upload = await request.post("/api/uploads", {
      data: {
        tool: "ocr-pdf",
        files: [
          { filename: "scan.pdf", contentType: "application/pdf", bytes: 2048 },
        ],
      },
    });
    expect(upload.status()).toBe(503);
    expect(upload.headers()["cache-control"]).toBe("no-store");

    // A well-formed OCR job with real options → 503, never a fabricated result.
    const job = await request.post("/api/jobs", {
      data: {
        tool: "ocr-pdf",
        inputs: ["f_1234567890"],
        options: { languages: ["eng", "spa"], outputMode: "both" },
      },
    });
    expect(job.status()).toBe(503);
    const body = await job.json();
    expect(body.error.code).toBe("worker_not_configured");
    expect(JSON.stringify(body)).not.toContain("completed");
  });
});
