import { test, expect } from "@playwright/test";
import { attachConsoleGuard } from "./helpers";

test.describe("OCR secure-worker tool page", () => {
  test("shows an honest OCR flow and never fakes a result when disabled", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await page.goto("/tools/ocr-pdf");

    await expect(
      page.getByRole("heading", { level: 1, name: "OCR PDF" }),
    ).toBeVisible();

    // The dedicated OCR panel (not the generic preview, not a fake uploader).
    await expect(page.getByText("Secure-worker OCR")).toBeVisible();
    await expect(
      page.getByText("OCR PDF runs on an encrypted secure worker"),
    ).toBeVisible();

    // Real recognition settings are offered.
    await expect(page.getByRole("button", { name: "English" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Spanish" })).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Searchable PDF", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: "Text sidecar" })).toBeVisible();

    // The request summary reflects the options and updates as they change.
    await expect(page.getByText(/English → Searchable PDF/)).toBeVisible();
    await page.getByRole("button", { name: "Spanish" }).click();
    await expect(
      page.getByText(/English, Spanish → Searchable PDF/),
    ).toBeVisible();

    // Honest capability: disabled in this environment, with a clear reason.
    await expect(page.getByText("Not enabled")).toBeVisible();
    await expect(
      page.getByText(/needs a secure worker with a native ocr engine/i),
    ).toBeVisible();

    // The full, honest pipeline is shown.
    await expect(page.getByText("Malware scan")).toBeVisible();
    await expect(page.getByText("Isolated processing")).toBeVisible();
    await expect(page.getByText("5. Auto-delete")).toBeVisible();

    // No uploader is mounted while OCR is unavailable — nothing can be submitted.
    expect(await page.locator('input[type="file"]').count()).toBe(0);

    // And no fabricated success / download.
    await expect(page.getByText(/OCR complete/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /run ocr on the worker/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: /\.pdf$/i })).toHaveCount(0);

    // The notify placeholder acknowledges on-device with no network call.
    const notify = page.getByRole("button", { name: /notify me/i });
    await expect(notify).toBeVisible();
    await notify.click();
    await expect(page.getByText(/waitlist opens/i)).toBeVisible();

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
