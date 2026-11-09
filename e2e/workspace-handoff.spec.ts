import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";
import { BATCH_LIMITS, overCountReason } from "../src/lib/batch/limits";
import { READY_WORKER_STATUS } from "../src/tests/ready-worker-status";
import {
  attachConsoleGuard,
  uploadFiles,
  writeTempPdf,
  writeTempScanPdf,
} from "./helpers";

/**
 * The Phase 9 promise: files staged in `/workspace` can be handed off to a live
 * in-browser tool without ever uploading them. The hand-off rides through the
 * browser's own IndexedDB (single-use, short-TTL, token stripped from the URL),
 * so these tests prove the real end-to-end flow — stage → launch → pre-loaded
 * runner → run → download — under the production build and CSP.
 */

test("hands a batch off from the workspace to Compress and runs it in-browser", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await uploadFiles(page, [
    await writeTempPdf("one.pdf", 3),
    await writeTempPdf("two.pdf", 2),
  ]);

  const batch = page.getByRole("region", {
    name: /use one tool on several files/i,
  });
  await batch.getByLabel(/choose a tool/i).selectOption("compress-pdf");
  await batch.getByRole("button", { name: /add all chosen files/i }).click();

  // Two files + a batch-ready tool → real hand-off into the batch runner.
  await batch
    .getByRole("button", { name: /open compress pdf with 2 files/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);

  // Files arrived, pre-loaded, still local.
  await expect(page.getByText(/loaded .* from your workspace/i)).toBeVisible();
  await expect(page.getByText("one.pdf")).toBeVisible();
  await expect(page.getByText("two.pdf")).toBeVisible();

  // Run the deterministic, on-device lossless batch and get downloadable output.
  await page.getByRole("button", { name: /compress 2 pdfs/i }).click();
  await expect(
    page.getByRole("button", { name: /download all/i }),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("hands a single PDF off from the workspace to Rotate and runs it", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await uploadFiles(page, await writeTempPdf("turn.pdf", 2));

  const batch = page.getByRole("region", {
    name: /use one tool on several files/i,
  });
  await batch.getByLabel(/choose a tool/i).selectOption("rotate-pdf");
  await batch.getByRole("button", { name: /add all chosen files/i }).click();

  // WAS "opens your first file" until 2026-11-08 (batch plan P1): Rotate
  // takes every file now, and with one queued says it runs on that file.
  await expect(batch.getByText(/runs on this file right here/i)).toBeVisible();
  await batch.getByRole("button", { name: /open rotate pdf/i }).click();
  await expect(page).toHaveURL(/\/tools\/rotate-pdf$/);

  // The staged PDF is pre-loaded into the real runner.
  await expect(page.getByText(/loaded .* from your workspace/i)).toBeVisible();
  await expect(page.getByText("turn.pdf")).toBeVisible();

  // Rotate all pages and export.
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await page.getByRole("button", { name: /apply rotation/i }).click();
  await expect(
    page.getByRole("heading", { name: /pdf rotated/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /download rotated pdf/i }),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("shows an honest expired state for a stale hand-off token", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  // A well-formed but unknown token: nothing to claim → expired, not a crash.
  await page.goto("/tools/merge-pdf?handoff=h_deadbeefdeadbeef00");

  await expect(
    page.getByText(/hand-off expired or was already used/i),
  ).toBeVisible();
  // Falls back to the normal picker, and the dead token is stripped from the URL.
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("strips only the hand-off token from the URL, keeping other params", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  // The token must be removed reliably even alongside unrelated query params.
  await page.goto("/tools/merge-pdf?ref=email&handoff=h_deadbeefdeadbeef01");

  await expect(
    page.getByText(/hand-off expired or was already used/i),
  ).toBeVisible();
  // `handoff` is gone; `ref` is preserved — no full token-bearing URL lingers.
  await expect(page).toHaveURL(/\/tools\/merge-pdf\?ref=email$/);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("clear session wipes staged files, remembered activity, and hand-offs", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await uploadFiles(page, await writeTempPdf("keep.pdf", 2));

  // Launch a hand-off so the workspace records a persisted activity entry.
  const batch = page.getByRole("region", {
    name: /use one tool on several files/i,
  });
  await batch.getByLabel(/choose a tool/i).selectOption("compress-pdf");
  await batch.getByRole("button", { name: /add all chosen files/i }).click();
  await batch.getByRole("button", { name: /open compress pdf/i }).click();
  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);

  // Returning to the workspace, the launch shows as remembered activity…
  await page.goto("/workspace");
  await expect(page.getByText(/queued .* compress pdf/i)).toBeVisible();

  // …and "Clear session" wipes it (and any pending hand-off bytes), on-device.
  await page.getByRole("button", { name: /clear session/i }).click();
  await expect(
    page.getByText(/tools you open from here show up/i),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

/**
 * Hand-off v2, end to end: files dropped on the HOME page arrive saying they
 * came from there — the badge used to say "from your workspace" for every
 * arrival — and "Open in workspace" carries them into the workspace, which
 * claims a hand-off addressed to it.
 */
test("files added on the home page arrive in Merge PDF saying where they came from", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/");
  await uploadFiles(page, [
    await writeTempPdf("first.pdf", 1),
    await writeTempPdf("second.pdf", 2),
  ]);

  // WAS a button named /merge pdf/; the desk's offers are links named for
  // what they carry (WP-05).
  await page
    .getByRole("link", { name: /^open merge pdf with 2 files$/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  await expect(page.getByText("first.pdf")).toBeVisible();
  await expect(page.getByText("second.pdf")).toBeVisible();
  // WAS /loaded the 2 files you added/ — see the subset tests below.
  await expect(page.getByText(/loaded 2 files you added/i)).toBeVisible();
  // Control: the old wording, false for these files, is gone.
  await expect(page.getByText(/from your workspace/i)).toHaveCount(0);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("Open in workspace carries the home page's files into the workspace", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/");
  await uploadFiles(page, [
    await writeTempPdf("one.pdf", 1),
    await writeTempPdf("two.pdf", 3),
  ]);

  await page.getByRole("button", { name: /open in workspace/i }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  const staged = page.getByRole("list", { name: /staged files/i });
  await expect(staged.getByText("one.pdf")).toBeVisible();
  await expect(staged.getByText("two.pdf")).toBeVisible();
  // Measured in this tab once they land: two.pdf has three pages.
  await expect(staged.getByText(/3 pages/)).toBeVisible();
  // WAS /loaded the 2 files you added/ — see the subset tests below.
  await expect(page.getByText(/loaded 2 files you added/i)).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

/**
 * FOUND IN REVIEW (2026-10-09): the drop badge said "Loaded the file you
 * added." — a definite description, true only when every file added
 * arrived. The gate trims what a tool cannot take: three PDFs sent to Sign
 * PDF (one file) arrive as ONE, and the page claimed it was "the file you
 * added" with nothing said of the other two. The badge now counts what
 * loaded, which is true of any subset.
 */
test("three PDFs added on the home page and sent to a one-file tool: the badge counts what loaded", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/");
  await uploadFiles(page, [
    await writeTempPdf("one.pdf", 1),
    await writeTempPdf("two.pdf", 1),
    await writeTempPdf("three.pdf", 1),
  ]);

  // Under More since 2026-11-08: Add Page Numbers takes all three PDFs now
  // and ranks above Sign PDF, a one-file tool.
  const sign = page.getByRole("link", { name: /^open sign pdf with /i });
  if (!(await sign.isVisible()))
    await page.getByRole("button", { name: /^More/ }).first().click();
  await sign.click();
  await expect(page).toHaveURL(/\/tools\/sign-pdf$/);

  // Health: the badge is there and is the drop's — a missing badge would
  // pass the negative below.
  const badge = page.getByRole("status").filter({ hasText: /you added/i });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/loaded 1 file you added/i);
  await expect(badge).not.toContainText(/the file you added/i);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("the same holds for a tool that takes several: two of three files reach Merge PDF", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const dir = mkdtempSync(join(tmpdir(), "pdfxyz-e2e-"));
  const docx = join(dir, "notes.docx");
  writeFileSync(docx, Buffer.from("PK\u0003\u0004 not merged", "latin1"));
  await page.goto("/");
  await uploadFiles(page, [
    await writeTempPdf("first.pdf", 1),
    await writeTempPdf("second.pdf", 1),
    docx,
  ]);

  await page
    .getByRole("link", { name: /^open merge pdf with 2 files$/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  await expect(page.getByText("first.pdf")).toBeVisible();
  await expect(page.getByText("second.pdf")).toBeVisible();

  const badge = page.getByRole("status").filter({ hasText: /you added/i });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/loaded 2 files you added/i);
  await expect(badge).not.toContainText(/the 2 files you added/i);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

/**
 * FOUND IN THE WP-04 GATE (2026-10-10): the home page scrolled sideways at
 * 390px with `quarterly-report-final-version-2026.pdf` added to its drop
 * zone — scrollWidth 429 against 390, the hero's headline, copy and trust
 * line all running off the right edge. The same defect /workspace had fixed
 * the day before (workspace.spec.ts, "at 390px"), in the other host of a
 * staged file's name: the drop zone's row is `truncate`, and nowrap text
 * still counts toward min-content, so every `min-width: auto` ancestor up to
 * the hero's one implicit grid column widened to fit it. Every home fixture
 * before this one had a short name.
 *
 * Two names: an ordinary hyphenated one (the measured case), and a scan with
 * no break opportunity beside another PDF, so a suggestion's reason that
 * names the file is on screen too. At 390 and at 360, without mobile
 * emulation (a phone browser zooms a too-wide page out, hiding the overflow
 * from the scrollWidth check).
 */
const HOME_LONG_NAMES = [
  "quarterly-report-final-version-2026.pdf",
  "Scanned_Contract_ACME_Corporation_2026_10_09.pdf",
];

for (const width of [360, 390]) {
  test.describe(`home at ${width}px with long file names`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("the drop zone keeps its names inside its panel, and the page never scrolls sideways", async ({
      page,
    }) => {
      const guard = attachConsoleGuard(page);
      const [long, scan] = HOME_LONG_NAMES as [string, string];
      await page.goto("/");
      await uploadFiles(page, [
        await writeTempPdf(long, 1),
        await writeTempScanPdf(scan, 1),
      ]);
      // The ticket's suggestions have arrived, so the desk is at its final
      // width: the rows and Open in workspace are both there. (WAS the drop
      // zone's "Continue with your files" list; the desk replaced it, WP-05.)
      const ticket = page.getByRole("region", {
        name: "What you can do with these files",
      });
      await expect(
        ticket.getByRole("button", { name: /open in workspace/i }),
      ).toBeVisible();
      await expect(
        ticket.locator('[data-slot="suggestions"] ol > li').first(),
      ).toBeVisible();

      const m = await page.evaluate((names) => {
        const root = document.documentElement;
        const zone = document
          .querySelector('input[type="file"]')
          ?.closest(".crop-marks");
        const zoneBox = zone?.getBoundingClientRect();
        // A staged name's row: the ticket lists each file as a <dt>.
        const spans = names.map((n) =>
          [...document.querySelectorAll("dt, span")].find(
            (s) => s.textContent === n,
          ),
        );
        // Where an element can be SEEN: its box, cut by every ancestor up to
        // the panel that clips what overflows it. Refined 2026-10-10 (WP-05):
        // the ticket's lines are cut short (`truncate`), and the words past
        // the cut — still boxes, never painted — read as "running out" to the
        // bare box check, which was written when every cut-short line was a
        // single span. A line whose clip FAILED is still caught: its words
        // are then painted past the panel and this reports them.
        const visibleRight = (el: Element) => {
          let right = el.getBoundingClientRect().right;
          for (
            let up = el.parentElement;
            up && up !== zone;
            up = up.parentElement
          ) {
            const overflow = getComputedStyle(up).overflowX;
            if (overflow !== "visible")
              right = Math.min(right, up.getBoundingClientRect().right);
          }
          return right;
        };
        const escaped = zone
          ? [...zone.querySelectorAll("*")]
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return (
                  r.width > 0 &&
                  getComputedStyle(el).visibility !== "hidden" &&
                  visibleRight(el) > zoneBox!.right + 0.5
                );
              })
              .map(
                (el) =>
                  `<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 60)}"`,
              )
          : null;
        return {
          innerWidth: window.innerWidth,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          zoneRight: zoneBox?.right ?? null,
          found: spans.map((s) => !!s),
          cut: spans.map((s) => (s ? s.scrollWidth > s.clientWidth : null)),
          escaped,
          // Positive control for the clip-aware check: the scan's facts line
          // (long enough to be cut short) with its clip removed must be
          // reported as running out of the panel.
          control: (() => {
            const facts = spans[1]?.nextElementSibling as HTMLElement | null;
            if (!facts || !zone) return null;
            const was = facts.style.overflow;
            facts.style.overflow = "visible";
            const out = [...facts.querySelectorAll("*")].some(
              (el) => visibleRight(el) > zoneBox!.right + 0.5,
            );
            facts.style.overflow = was;
            return out;
          })(),
        };
      }, HOME_LONG_NAMES);
      expect(
        m.control,
        "the clip-aware check cannot see a line that escapes",
      ).toBe(true);

      // Health: the width asked for is the width that painted, and the
      // probe found the panel and both names' rows.
      expect(m.innerWidth).toBe(width);
      expect(m.zoneRight, "no drop panel found").not.toBeNull();
      expect(m.found, "a staged name's row was not found").toEqual([
        true,
        true,
      ]);

      expect(
        m.scrollWidth,
        `the page is ${m.scrollWidth}px wide in a ${m.clientWidth}px viewport`,
      ).toBeLessThanOrEqual(m.clientWidth);
      expect(m.zoneRight!).toBeLessThanOrEqual(m.clientWidth);
      expect(m.escaped, "these run out of the drop panel").toEqual([]);
      // The names are cut short in their rows, not laid out in full.
      expect(m.cut).toEqual([true, true]);

      expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual(
        [],
      );
      expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
    });
  });
}

/**
 * Batch plan P6: the workspace hands a set of files to a WORKER tool with a
 * batch. The files open in the tool's batch list, still in this browser,
 * and NOTHING reaches our server before Run on the tool's page — counted at
 * the wire, every request to the upload and job APIs and to the storage PUT.
 * The worker is mocked (`page.route`, as `worker-batch.spec.ts` does), so
 * pressing Run is the positive control: the same counter must then see the
 * uploads, or a zero before Run would prove nothing.
 */
const WORKER_WIRE = /\/api\/uploads|\/api\/jobs|\/__e2e\/p6-upload\//;

async function mockRepairWorker(page: Page) {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (WORKER_WIRE.test(request.url()))
      sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  let reservations = 0;
  let jobs = 0;
  const job = (id: string, status: string) => {
    const now = new Date().toISOString();
    return {
      jobId: id,
      tool: "repair-pdf",
      capability: "secure-worker",
      status,
      progress: status === "completed" ? 100 : 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
      ...(status === "completed"
        ? {
            artifacts: [
              {
                artifactId: `art_${id}`,
                filename: `${id}-repaired.pdf`,
                contentType: "application/pdf",
                bytes: 15,
                url: `/__e2e/p6-art/${id}`,
                expiresAt: now,
              },
            ],
          }
        : {}),
    };
  };
  await page.route("**/api/worker/status", (route) =>
    json(route, READY_WORKER_STATUS),
  );
  await page.route("**/api/uploads", async (route) => {
    reservations += 1;
    await json(route, {
      sessionId: `ses_p6_${reservations}`,
      tool: "repair-pdf",
      slots: [
        {
          fileId: `file_p6_${reservations}`,
          filename: "in",
          url: `/__e2e/p6-upload/${reservations}`,
          method: "PUT",
          headers: {},
        },
      ],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      retention: { inputTtlMinutes: 0, outputTtlMinutes: 60 },
    });
  });
  await page.route("**/__e2e/p6-upload/**", (route) => json(route, {}));
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    jobs += 1;
    await json(route, job(`job_p6_${jobs}`, "queued"));
  });
  await page.route("**/api/jobs/job_p6_*", (route) =>
    json(route, job(route.request().url().split("/").pop()!, "completed")),
  );
  await page.route("**/__e2e/p6-art/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/pdf" },
      body: Buffer.from("%PDF-1.7\n%%EOF\n"),
    }),
  );
  return sent;
}

async function queueInWorkspace(page: Page, slug: string, names: string[]) {
  await page.goto("/workspace");
  await uploadFiles(
    page,
    await Promise.all(names.map((name) => writeTempPdf(name, 1))),
  );
  const batch = page.getByRole("region", {
    name: /use one tool on several files/i,
  });
  await batch.getByLabel(/choose a tool/i).selectOption(slug);
  await batch.getByRole("button", { name: /add all chosen files/i }).click();
  return batch;
}

test("hands three PDFs from the workspace to Repair PDF's batch, and nothing is sent before Run", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const sent = await mockRepairWorker(page);
  const names = ["jan.pdf", "feb.pdf", "mar.pdf"];
  const batch = await queueInWorkspace(page, "repair-pdf", names);

  // The launch area says where the files go, and never the client words.
  const status = batch.getByRole("status");
  await expect(status).toContainText("Ready — 3 files, for our secure server");
  await expect(status).toContainText(
    "each one is uploaded only when you press the button under that list",
  );
  await expect(status).not.toContainText(/nothing is uploaded/i);
  await expect(status).not.toContainText(/in your browser/i);

  await batch
    .getByRole("button", { name: /open repair pdf with 3 files/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/repair-pdf$/);

  // The batch list, one row per file, and the Run button names all three.
  const list = page.getByRole("list", { name: "Files in this batch" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  for (const name of names)
    await expect(list.getByText(name, { exact: true })).toBeVisible();
  const run = page.getByRole("button", { name: "Repair 3 PDFs" });
  await expect(run).toBeVisible();
  await expect(run).not.toHaveAttribute("aria-disabled", "true");
  await expect(
    page.getByText(
      /nothing is uploaded until you press the button under the list/,
    ),
  ).toBeVisible();

  await page.waitForTimeout(800);
  expect(sent, "a file went to our server before Run").toEqual([]);

  // Positive control: Run sends them, one reservation and one job per file.
  await run.click();
  await expect(
    page.getByRole("heading", { name: "Batch complete. 3 done, 0 failed." }),
  ).toBeVisible({ timeout: 30_000 });
  expect(sent.filter((r) => r === "POST /api/uploads")).toHaveLength(3);
  expect(sent.filter((r) => r === "POST /api/jobs")).toHaveLength(3);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("a set past one worker batch: the first files open, the rest are listed with the reason, nothing sent", async ({
  page,
}) => {
  const sent = await mockRepairWorker(page);
  const cap = BATCH_LIMITS.workerMaxFiles;
  const names = Array.from({ length: cap + 2 }, (_, i) => `part-${i + 1}.pdf`);
  const batch = await queueInWorkspace(page, "repair-pdf", names);

  await expect(batch.getByRole("status")).toContainText(
    `One batch takes up to ${cap} files: the first ${cap} of these open in its list on the tool’s page, and the other 2 are listed there with the reason.`,
  );
  await batch
    .getByRole("button", { name: `Open Repair PDF with ${cap + 2} files` })
    .click();
  await expect(page).toHaveURL(/\/tools\/repair-pdf$/);

  const list = page.getByRole("list", { name: "Files in this batch" });
  await expect(list.getByRole("listitem")).toHaveCount(cap);
  // The two past the cap are named, with the reason — never dropped.
  const extras = names.slice(cap);
  for (const name of extras)
    await expect(list.getByText(name, { exact: true })).toHaveCount(0);
  const note = page.getByRole("alert").filter({ hasText: /2 files not added/ });
  for (const name of extras) await expect(note).toContainText(name);
  await expect(note).toContainText(overCountReason(cap));
  await expect(
    page.getByRole("button", { name: `Repair ${cap} PDFs` }),
  ).toBeVisible();

  await page.waitForTimeout(800);
  expect(sent, "a file went to our server before Run").toEqual([]);
});
