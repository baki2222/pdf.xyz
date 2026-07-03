import { test, expect } from "@playwright/test";
import { attachConsoleGuard } from "./helpers";

test.describe("system status page", () => {
  test("summarizes local tools vs the secure worker, read live", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    const res = await page.goto("/status");
    expect(res?.status()).toBe(200);

    // Page shell.
    await expect(
      page.getByRole("heading", { level: 1, name: /system status/i }),
    ).toBeVisible();

    // Both capability summaries render.
    await expect(
      page.getByRole("heading", { name: /in-browser tools/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /secure worker/i }),
    ).toBeVisible();

    // The in-browser card is always available and never uploads. Exact match:
    // the OCR capability row honestly says OCR is "unavailable" nearby.
    await expect(page.getByText("Available", { exact: true })).toBeVisible();

    // The worker half is read live from /api/worker/status. In the production
    // build the e2e suite runs, the worker is honestly disabled — so the fetch
    // must resolve out of the "Checking…" state into the disabled detail. This
    // also proves the client fetch (and its worker_status_checked event) worked.
    await expect(
      page.getByText(/no secure worker is configured/i),
    ).toBeVisible();

    // The production pipeline is broken out provider-by-provider, each honestly
    // not configured in this build — so the page names exactly what a real
    // deployment still needs (object storage, job queue, processor). These labels
    // also appear in the operations dashboard's subsystem grid below, so scope to
    // the first (the capability summary's) occurrence.
    await expect(page.getByText("Production pipeline")).toBeVisible();
    await expect(
      page.getByText("Object storage", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Job queue", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Not configured", { exact: true }).first(),
    ).toBeVisible();

    // Static "what runs where" explainer is present and honest.
    await expect(
      page.getByRole("heading", { name: /what runs where/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/files never leave your device/i).first(),
    ).toBeVisible();

    // A reachable /status page should be indexable (not noindex).
    const robots = await page
      .locator('meta[name="robots"]')
      .first()
      .getAttribute("content");
    expect(robots ?? "").not.toContain("noindex");

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });

  test("surfaces the worker operations snapshot honestly in no-config mode", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    const res = await page.goto("/status");
    expect(res?.status()).toBe(200);

    // The operator dashboard section renders.
    await expect(
      page.getByRole("heading", { name: /worker operations/i }),
    ).toBeVisible();

    // Read live from /api/worker/operations. In the production build the e2e suite
    // runs, no worker is configured, so the snapshot resolves out of the "Reading…"
    // state into the honest blocked verdict + single recommended action. This also
    // proves the client fetch (and its worker_operations_checked event) worked.
    await expect(
      page.getByText("Configure the queue and storage"),
    ).toBeVisible();
    await expect(page.getByText("Blocked", { exact: true }).first()).toBeVisible();

    // The load-bearing honesty caveat: the web vantage can never observe a running
    // worker, and that must NOT read as "the worker is down". The page says so
    // explicitly and points operators at the daemon logs / process supervisor.
    await expect(
      page.getByText(/can.?t see a running worker/i),
    ).toBeVisible();
    await expect(
      page.getByText(/cannot observe a separate worker process/i),
    ).toBeVisible();
    await expect(page.getByText(/process supervisor/i)).toBeVisible();

    // The bounded subsystem grid and honest engine proofs render.
    await expect(page.getByText("Drainability")).toBeVisible();
    await expect(page.getByText("Deployment guardrails")).toBeVisible();
    await expect(
      page.getByText("Unknown from here").first(),
    ).toBeVisible();

    // Honesty: the operations region is content-free — even scoped to that section,
    // no endpoint, object key, or secret string appears (there is none to leak).
    const opsText =
      (await page
        .locator('section[aria-labelledby="worker-operations-heading"]')
        .textContent()) ?? "";
    for (const forbidden of ["s3://", "://", "redis", "SECRET", "AKIA"]) {
      expect(opsText).not.toContain(forbidden);
    }

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });
});
