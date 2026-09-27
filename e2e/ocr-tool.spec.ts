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
    await expect(
      page.getByText(/needs a secure worker with a native ocr engine/i),
    ).toBeVisible();

    // The full, honest pipeline is shown.
    // No worker is configured in this environment, so no scanner is running — the
    // pipeline must show the structural preflight and must NOT claim a malware scan.
    // This line used to assert the opposite, which is how the false claim shipped.
    await expect(page.getByText("Structural preflight")).toBeVisible();
    await expect(page.getByText("Malware scan")).toHaveCount(0);
    // Inverted, not deleted: this line used to assert "Isolated processing" was
    // VISIBLE — the title of a stage that promised "a single-job sandbox with no
    // network egress", which the long-running worker daemon never had. The claim
    // shipped with this assertion standing behind it.
    await expect(
      page.getByText("3. Processing", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Isolated processing")).toHaveCount(0);
    await expect(page.getByText(/sandbox|network egress/i)).toHaveCount(0);
    await expect(page.getByText("5. Auto-delete")).toBeVisible();

    // No uploader is mounted while OCR is unavailable — nothing can be submitted.
    expect(await page.locator('input[type="file"]').count()).toBe(0);

    // And no fabricated success / download.
    await expect(page.getByText(/OCR complete/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /run ocr on the worker/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: /\.pdf$/i })).toHaveCount(0);

    // The notify button discloses what pressing it sends, then sends exactly
    // that: one beacon to /api/interest carrying the tool's slug and nothing
    // else. The acknowledgement claims only what happened — no waitlist, no
    // notification promise.
    const notify = page.getByRole("button", { name: /notify me/i });
    await expect(notify).toBeVisible();
    await expect(
      page.getByText(
        /pressing it sends us the tool's name — nothing about you/i,
      ),
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
