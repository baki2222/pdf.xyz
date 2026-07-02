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
    // deployment still needs (object storage, job queue, processor).
    await expect(page.getByText("Production pipeline")).toBeVisible();
    await expect(page.getByText("Object storage")).toBeVisible();
    await expect(page.getByText("Job queue")).toBeVisible();
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
});
