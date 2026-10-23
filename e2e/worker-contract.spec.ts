import { test, expect } from "@playwright/test";
import { attachConsoleGuard } from "./helpers";

const PAGE = "/tools/chat-with-pdf";

test.describe("secure-worker AI tool panel", () => {
  test("the chat-with-pdf page mounts its dedicated secure-worker panel, honestly not-enabled", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    // `chat-with-pdf` now has a dedicated secure-worker panel (like summarize-pdf,
    // translate-pdf, and ai-extract). With the worker disabled in this environment the
    // panel is honestly "Not enabled": it shows the pipeline + a notify placeholder and
    // never mounts an uploader or fabricates an answer. (The ready/answer path is
    // exercised by the engine/processor/client unit tests, which inject a fake provider.)
    await page.goto(PAGE);

    await expect(
      page.getByRole("heading", { level: 1, name: "Chat with PDF" }),
    ).toBeVisible();

    // The dedicated panel — not the in-browser runner, and not a fake uploader.
    await expect(
      page.getByRole("heading", {
        name: /runs on our secure server/i,
      }),
    ).toBeVisible();
    await expect(page.getByText("Not enabled")).toBeVisible();
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
    expect(served).toContain("AI processing");
    expect(served).toMatch(/third-party AI provider/i);
    // Since 2026-10-23 the spec rows sit under the panel's "Details", one
    // press away: in the HTML from the first paint, shown on the press.
    expect(served).toMatch(/wiped after processing/i);
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page.getByText(/wiped after processing/i)).toBeVisible();

    // The stated reason must be the one that is actually blocking. No AI provider
    // is declared in this build, so the panel names that — not the daemon — and a
    // user is never asked to upload a PDF for work that provably cannot happen.
    // Since 2026-10-24 the not-enabled box leads with one sentence and keeps
    // the reason behind "Why?": hidden until asked for, then shown.
    const reason = page.getByText(
      /no ai provider is declared for this deployment/i,
    );
    await expect(reason).toBeHidden();
    await page.getByRole("button", { name: "Why?" }).click();
    await expect(reason).toBeVisible();

    // INVERTED in WP-10 (was "not-enabled ⇒ no builder, so no client
    // uploader"): the builder and its drop zone are there; asking is off.
    expect(await page.locator('input[type="file"]').count()).toBe(1);
    await expect(
      page.getByRole("button", { name: "Ask the PDF" }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByText(/runs in your browser — your file never leaves/i),
    ).toHaveCount(0);

    // The notify button acknowledges the ask and sends one beacon carrying the
    // tool's slug — the disclosed, user-initiated interest signal.
    const notify = page.getByRole("button", { name: /notify me/i });
    await expect(notify).toBeVisible();
    const beacon = page.waitForRequest(
      (req) => req.url().includes("/api/interest") && req.method() === "POST",
    );
    await notify.click();
    await beacon;
    await expect(page.getByText(/one more ask for .+ counted/i)).toBeVisible();

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

    // Delete-now / cancel: valid id → 503 (no backend, nothing to delete);
    // malformed id → 400. It never fabricates a canceled or deleted job.
    const del = await request.delete("/api/jobs/job_abcdefghij");
    expect(del.status()).toBe(503);
    const delBody = await del.json();
    expect(delBody.error.code).toBe("worker_not_configured");
    expect(JSON.stringify(delBody)).not.toContain("canceled");
    const badDel = await request.delete("/api/jobs/not-an-id");
    expect(badDel.status()).toBe(400);

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
