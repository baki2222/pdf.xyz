import { test, expect } from "@playwright/test";
import { attachConsoleGuard } from "./helpers";

test.describe("secure-worker tool preview", () => {
  test("a secure-worker tool page shows the honest future-flow preview", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    await page.goto("/tools/ocr-pdf");

    await expect(
      page.getByRole("heading", { level: 1, name: "OCR PDF" }),
    ).toBeVisible();

    // The preview — not the in-browser runner, and not a fake uploader.
    await expect(page.getByText("Not yet enabled")).toBeVisible();
    await expect(page.getByText(/secure worker/i).first()).toBeVisible();
    await expect(page.getByText("Malware scan")).toBeVisible();
    await expect(page.getByText("Isolated processing")).toBeVisible();
    await expect(page.getByText("5. Auto-delete")).toBeVisible();
    await expect(page.getByText(/wiped after processing/i)).toBeVisible();

    // A secure-worker preview never mounts a client runner or uploader.
    expect(await page.locator('input[type="file"]').count()).toBe(0);
    await expect(
      page.getByText(/runs in your browser — your file never leaves/i),
    ).toHaveCount(0);

    // The notify placeholder acknowledges on-device with no network call.
    const notify = page.getByRole("button", { name: /notify me/i });
    await expect(notify).toBeVisible();
    await notify.click();
    await expect(page.getByText(/waitlist opens/i)).toBeVisible();

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });
});

test.describe("job API contract stubs", () => {
  test("validate requests and honestly report the backend is not configured", async ({
    request,
  }) => {
    // Well-formed job → 503, honest not-configured, never cached.
    const job = await request.post("/api/jobs", {
      data: { tool: "ocr-pdf", inputs: ["f_1234567890"] },
    });
    expect(job.status()).toBe(503);
    expect(job.headers()["cache-control"]).toBe("no-store");
    const jobBody = await job.json();
    expect(jobBody.error.code).toBe("worker_not_configured");
    // Never fakes a completed job.
    expect(JSON.stringify(jobBody)).not.toContain("completed");

    // Unknown tool → 404.
    const badTool = await request.post("/api/jobs", {
      data: { tool: "definitely-not-real", inputs: ["f_1234567890"] },
    });
    expect(badTool.status()).toBe(404);

    // In-browser tool has no server job → 422.
    const clientTool = await request.post("/api/jobs", {
      data: { tool: "merge-pdf", inputs: ["f_1234567890"] },
    });
    expect(clientTool.status()).toBe(422);

    // Malformed JSON → 400.
    const badJson = await request.post("/api/jobs", {
      headers: { "content-type": "application/json" },
      data: "{ not json",
    });
    expect(badJson.status()).toBe(400);

    // Status: valid id → 503; malformed id → 400.
    const status = await request.get("/api/jobs/job_abcdefghij");
    expect(status.status()).toBe(503);
    const badId = await request.get("/api/jobs/not-an-id");
    expect(badId.status()).toBe(400);

    // Upload session: well-formed → 503.
    const upload = await request.post("/api/uploads", {
      data: {
        tool: "ocr-pdf",
        files: [
          { filename: "scan.pdf", contentType: "application/pdf", bytes: 1024 },
        ],
      },
    });
    expect(upload.status()).toBe(503);

    // Local transport endpoints are inert unless local-dev mode is on.
    const localUpload = await request.put("/api/uploads/local/f_abcdefghij", {
      data: "x",
    });
    expect(localUpload.status()).toBe(503);
    const localArtifact = await request.get(
      "/api/artifacts/local/art_abcdefghij",
    );
    expect(localArtifact.status()).toBe(503);
  });

  test("worker status honestly reports disabled with no capability", async ({
    request,
  }) => {
    const res = await request.get("/api/worker/status");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = await res.json();
    expect(body.mode).toBe("disabled");
    expect(body.enabled).toBe(false);
    expect(body.compress).toEqual({
      lossless: false,
      deep: false,
      engines: [],
    });
  });
});
