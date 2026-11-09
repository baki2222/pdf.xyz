// @vitest-environment jsdom
// @native-canvas
/**
 * The worker batches (batch plan P3), through each page's OWN panel: the
 * module the tool page mounts (`ownPanelModules`, read from the page's
 * dispatch), two real Files on its file input, the batch's Run, and the
 * network the real job client meets (`stubJobNetwork`).
 *
 * The SET is the registration (`WORKER_BATCH_TOOLS`), and each slug's panel
 * is found from the page, never typed — so a registered tool whose panel
 * never forks to the batch fails here (CLAUDE.md: verify the composed
 * chain; loading a module is not running it). HTML to PDF is the negative
 * control: it shares EPUB to PDF's panel and stays one file at a time.
 *
 * For every registered tool, two files make:
 *   - the batch view, not the single-file panel;
 *   - exactly two jobs, each of today's exact shape (this tool, ONE input);
 *   - one telemetry outcome per file, reported by the batch's adapter; the
 *     job client's own reporting is off for a batch's attempts;
 *   - nothing written to `useWorkerJob`'s sessionStorage resume key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { resetUnsavedForTests, unsavedLabels } from "@/lib/intent/unsaved";
import { WORKER_JOB_STORAGE_PREFIX } from "@/lib/workers/job-resume-key";
import { WORKER_BATCH_TOOLS, type WorkerBatchSlug } from "@/lib/batch/tools";
import { BATCH_LIMITS, overCountReason } from "@/lib/batch/limits";
import {
  WORKER_BATCH_PAUSED,
  workerBatchJobsSentence,
} from "@/lib/batch/worker-copy";
import { RATE_LIMITS } from "@/lib/jobs/types";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { enterToolPage } from "@/lib/telemetry/tool-outcome";
import { stubJobNetwork } from "@/tests/stub-job-network";
import { signedPdf } from "@/tests/signed-pdf";
import { USER_PASSWORD_PDF_BASE64 } from "@/tests/fixtures-encrypted";
import { PDFDocument } from "pdf-lib";
import { ownPanelModules } from "@/tests/tool-panel-modules";
import { BATCH_VIEW_LOADED } from "./batch-view";
import { signedSkipReason } from "./worker-batch-runner";

const READY = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "remote",
  compress: { lossless: false, deep: false, engines: [] },
  // Available, with one pack: OCR PDF's batch (batch plan P5) waits on the
  // panel's own check, as every other tool's does.
  ocr: {
    available: true,
    engine: "tesseract",
    languages: ["eng"],
    detail: "on",
  },
  scan: { active: false, detail: "not scanned" },
  security: { available: true, operations: [], detail: "qpdf" },
  providers: {
    storage: { ready: true },
    queue: { ready: true },
    processor: { ready: true },
  },
  daemon: { drainable: true, detail: "ready" },
  ai: { ready: false },
  pipeline: { verdict: "off", observed: false, drainable: false, detail: "" },
} as unknown as WorkerStatus;

const EXTENSION: Record<string, { ext: string; type: string }> = {
  PDF: { ext: "pdf", type: "application/pdf" },
  DOCX: {
    ext: "docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  XLSX: {
    ext: "xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  PPTX: {
    ext: "pptx",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  EPUB: { ext: "epub", type: "application/epub+zip" },
  HTML: { ext: "html", type: "text/html" },
};

/** A file this tool takes, by its first catalogue format. */
function fileFor(tool: Tool, name: string, bytes?: Uint8Array): File {
  const format = tool.accept.find((f) => f in EXTENSION);
  if (!format) throw new Error(`${tool.slug}: no fixture for ${tool.accept}`);
  const { ext, type } = EXTENSION[format]!;
  return new File(
    [(bytes ?? new TextEncoder().encode("%PDF-1.7\n%%EOF\n")) as BlobPart],
    `${name}.${ext}`,
    { type },
  );
}

const { bySlug } = ownPanelModules();

async function panelFor(slug: string): Promise<ComponentType<{ tool: Tool }>> {
  const panel = bySlug.get(slug);
  if (!panel || panel.dispatch !== "worker")
    throw new Error(`${slug}: its page mounts no worker panel`);
  const mod = (await import(/* @vite-ignore */ panel.file)) as Record<
    string,
    ComponentType<{ tool: Tool }>
  >;
  const Panel = mod[panel.name];
  if (!Panel) throw new Error(`${panel.file} exports no ${panel.name}`);
  return Panel;
}

let events: RedactedEvent[] = [];
let leave: () => void = () => {};
let storageWrites: string[] = [];
const originalSetItem = Storage.prototype.setItem;
beforeEach(() => {
  events = [];
  storageWrites = [];
  configureTelemetry((e) => events.push(e));
  Storage.prototype.setItem = function (key: string, value: string) {
    storageWrites.push(key);
    return originalSetItem.call(this, key, value);
  };
});
afterEach(() => {
  cleanup();
  leave();
  resetTelemetry();
  resetAnnouncer();
  resetUnsavedForTests();
  Storage.prototype.setItem = originalSetItem;
  try {
    sessionStorage.clear();
  } catch {
    // jsdom always has it; nothing to clear otherwise.
  }
  vi.unstubAllGlobals();
});

const outcomes = () =>
  events
    .map((e) => e.name)
    .filter((n) => n === "tool_completed" || n === "tool_failed");

/** Every job completes with an artifact of its own. */
function network() {
  let n = 0;
  return stubJobNetwork(READY, () => {
    n += 1;
    return {
      status: "completed",
      artifact: {
        artifact: {
          artifactId: `art_${n}`,
          filename: `out-${n}.pdf`,
          contentType: "application/pdf",
          bytes: 8,
          url: `/__art/${n}`,
          expiresAt: new Date(0).toISOString(),
        },
        bytes: new TextEncoder().encode("%PDF-out"),
      },
    };
  });
}

/**
 * A network whose n-th reservation (1-based) is refused for one second by
 * the hourly upload limit, and whose PUTs can be held.
 */
function limitedNetwork(
  script: { refuseReservation?: number; holdPut?: Promise<void> } = {},
) {
  let reservations = 0;
  let jobs = 0;
  let puts = 0;
  const json = (value: unknown, status = 200, headers = {}) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/api/worker/status")) return json(READY);
      if (url === "/api/uploads") {
        reservations += 1;
        if (reservations === script.refuseReservation)
          return json(
            { error: { code: "rate_limited", message: "Too many." } },
            429,
            { "Retry-After": "1" },
          );
        return json({
          slots: [
            {
              fileId: `f${reservations}`,
              url: "/__put",
              method: "PUT",
              headers: {},
            },
          ],
        });
      }
      if (url === "/__put") {
        puts += 1;
        if (script.holdPut) await script.holdPut;
        return json({});
      }
      if (url === "/api/jobs" && method === "POST") {
        jobs += 1;
        return json({
          jobId: `job_${jobs}`,
          status: "completed",
          artifacts: [
            {
              artifactId: `a${jobs}`,
              filename: `out-${jobs}.pdf`,
              contentType: "application/pdf",
              bytes: 8,
              url: `/__art/${jobs}`,
              expiresAt: new Date(0).toISOString(),
            },
          ],
        });
      }
      if (url.startsWith("/__art/")) return new Response("%PDF-out");
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
  return {
    reservations: () => reservations,
    jobs: () => jobs,
    puts: () => puts,
  };
}

async function dropTwo(slug: string, files?: File[]) {
  const tool = getToolBySlug(slug)!;
  leave = enterToolPage({ toolSlug: slug, capability: "secure-worker" });
  const Panel = await panelFor(slug);
  const view = render(<Panel tool={tool} />);
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(input, {
    target: {
      files: files ?? [fileFor(tool, "first"), fileFor(tool, "second")],
    },
  });
  return { tool, view };
}

const SLUGS = Object.keys(WORKER_BATCH_TOOLS) as WorkerBatchSlug[];

/**
 * Batch plan P4: Protect's and Unlock's Run waits for a password, typed
 * once for every file (`security-batch.dom.test.tsx` holds the rest).
 */
async function twoFilesFor(slug: WorkerBatchSlug): Promise<File[] | undefined> {
  // Each is looked at in the browser first (`classifyPdfAccess`): Unlock
  // sends only a locked PDF, Protect only one that is not encrypted.
  const tool = getToolBySlug(slug)!;
  if (slug === "unlock-pdf") {
    const locked = Buffer.from(USER_PASSWORD_PDF_BASE64, "base64");
    return [fileFor(tool, "first", locked), fileFor(tool, "second", locked)];
  }
  if (slug === "protect-pdf") {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const plain = await doc.save();
    return [fileFor(tool, "first", plain), fileFor(tool, "second", plain)];
  }
  return undefined;
}

function typeTheSecrets(slug: WorkerBatchSlug) {
  const set = (label: string, value: string) => {
    const input = [
      ...document.querySelectorAll<HTMLInputElement>("input"),
    ].find((el) => el.labels?.[0]?.textContent === label);
    if (!input) throw new Error(`${slug}: no field labelled ${label}`);
    fireEvent.change(input, { target: { value } });
  };
  if (slug === "unlock-pdf") set("Current password", "batch-pw");
  if (slug === "protect-pdf") {
    set("New password", "batch-pw");
    set("Confirm password", "batch-pw");
  }
}

describe("every registered worker batch, through its page's own panel", () => {
  it("health: the registration holds P3's ten tools, P4's two and P5's OCR PDF, and each page mounts a worker panel", () => {
    expect(SLUGS.length).toBe(13);
    for (const slug of SLUGS)
      expect(bySlug.get(slug)?.dispatch, slug).toBe("worker");
  });

  for (const slug of SLUGS) {
    it(`${slug}: two files open the batch, and Run sends two of today's single jobs`, async () => {
      const net = network();
      const { tool, view } = await dropTwo(slug, await twoFilesFor(slug));
      await waitFor(() =>
        expect(
          view.container.querySelector(`[data-chunk="${BATCH_VIEW_LOADED}"]`),
        ).not.toBeNull(),
      );
      const { verb, noun } = WORKER_BATCH_TOOLS[slug];
      // The sentence before Run, from the constants.
      expect(view.container.textContent).toContain(workerBatchJobsSentence(2));
      expect(view.container.textContent).toContain(
        `${RATE_LIMITS.jobsPerHourPerClient} server jobs an hour`,
      );
      const run = await screen.findByRole("button", {
        name: `${verb} 2 ${noun[1]}`,
      });
      typeTheSecrets(slug);
      // Run waits for the panel's own check.
      await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
      fireEvent.click(run);
      await screen.findByText("Batch complete. 2 done, 0 failed.", undefined, {
        timeout: 5000,
      });
      expect(net.jobBodies).toHaveLength(2);
      for (const body of net.jobBodies) {
        expect(body.tool).toBe(tool.slug);
        expect(body.inputs).toHaveLength(1);
      }
      expect(net.uploads()).toBe(2);
      expect(outcomes()).toEqual(["tool_completed", "tool_completed"]);
      expect(storageWrites.filter((k) => /job/i.test(k))).toEqual([]);
    });
  }

  // Batch plan P5 made the runner choose its cap per slug (OCR PDF takes
  // 5); this pins the intake at every registered page against the limit it
  // is SUPPOSED to have, named independently of `batchMaxFilesFor`: a
  // runner capping every worker batch at OCR's 5 (or OCR's at 10) fails.
  for (const slug of SLUGS) {
    const cap =
      slug === "ocr-pdf"
        ? BATCH_LIMITS.ocrMaxFiles
        : BATCH_LIMITS.workerMaxFiles;
    it(`${slug}: ${cap + 1} files take ${cap}, and the one past the cap is listed with the count's sentence`, async () => {
      network();
      const tool = getToolBySlug(slug)!;
      const files = Array.from({ length: cap + 1 }, (_, i) =>
        fileFor(tool, `in-${i + 1}`),
      );
      const { view } = await dropTwo(slug, files);
      const { verb, noun } = WORKER_BATCH_TOOLS[slug];
      expect(
        await screen.findByRole(
          "button",
          { name: `${verb} ${cap} ${noun[1]}` },
          { timeout: 10_000 },
        ),
      ).toBeInTheDocument();
      const text = view.container.textContent ?? "";
      expect(text).toContain(overCountReason(cap));
      expect(text).toContain(files[cap]!.name);
      expect(text).toContain(files[cap - 1]!.name);
    });
  }

  it("Optimize for Web leaves a signed PDF out, unsent, and runs the other", async () => {
    const net = network();
    const tool = getToolBySlug("optimize-web")!;
    const signed = await signedPdf({ signatures: 2 });
    const { view } = await dropTwo("optimize-web", [
      fileFor(tool, "signed", signed),
      fileFor(tool, "plain"),
    ]);
    const run = await screen.findByRole("button", { name: "Optimize 2 PDFs" });
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await screen.findByText("Batch complete. 1 done, 0 failed, 1 skipped.");
    expect(view.container.textContent).toContain(
      signedSkipReason(2, "Optimizing"),
    );
    expect(net.uploads()).toBe(1);
    expect(net.jobBodies).toHaveLength(1);
  });

  it("a rate limit pauses: the banner says so, Continue now waits for the limit, the file is never failed, and the batch carries on by itself", async () => {
    const net = limitedNetwork({ refuseReservation: 2 });
    const { view } = await dropTwo("repair-pdf");
    const run = await screen.findByRole("button", { name: "Repair 2 PDFs" });
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await screen.findByText(WORKER_BATCH_PAUSED);
    const banner = view.container.querySelector("[data-batch-paused]")!;
    expect(banner.textContent).toMatch(/Continuing in about 1 second/);
    // One file is done, so the banner says it can be downloaded.
    expect(banner.textContent).toContain(
      "The finished files can be downloaded from their rows now.",
    );
    const now = screen.getByRole("button", { name: "Continue now" });
    expect(now).toHaveAttribute("aria-disabled", "true");
    // The batch's own Cancel went away with the pause, and focus with it:
    // focus is on Continue now, which the pause sentences describe. Awaited:
    // the focus moves in an effect after the pause renders, and CI under load
    // read activeElement before it ran (PR #304, 2026-11-09; 3/3 green here).
    await waitFor(() => expect(document.activeElement).toBe(now));
    const described = (now.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toContain(WORKER_BATCH_PAUSED);
    expect(described).toMatch(/Continuing in about 1 second/);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/failed/);
    // While paused, leaving the page asks first.
    expect(unsavedLabels().some((l) => l.startsWith("your batch"))).toBe(true);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await screen.findByText("Batch complete. 2 done, 0 failed.", undefined, {
      timeout: 5000,
    });
    // The paused file was asked for again: three reservations, two jobs.
    expect(net.reservations()).toBe(3);
    expect(net.jobs()).toBe(2);
    // One outcome per FILE: the refused attempt is not a run of the tool.
    expect(outcomes()).toEqual(["tool_completed", "tool_completed"]);
    // Control: once the batch has ended, nothing holds the page. Awaited:
    // the hold is released by an effect after "Batch complete" renders, and
    // CI under load read the label before it ran (PR #304, 2026-11-09).
    await waitFor(() => expect(unsavedLabels()).toEqual([]));
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("paused on the FIRST file: no sentence about finished files, and with focus elsewhere the pause is spoken, not focused", async () => {
    limitedNetwork({ refuseReservation: 1 });
    render(
      <>
        <LiveRegion />
        <input aria-label="Elsewhere on the page" />
      </>,
    );
    const { view } = await dropTwo("repair-pdf");
    const run = await screen.findByRole("button", { name: "Repair 2 PDFs" });
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    // Focus is somewhere real, outside the batch, when the pause begins.
    const elsewhere = screen.getByRole("textbox", {
      name: "Elsewhere on the page",
    });
    elsewhere.focus();
    fireEvent.click(run);
    const banner = await waitFor(() => {
      const el = view.container.querySelector("[data-batch-paused]");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(banner.textContent).not.toMatch(/finished files/);
    const region = document.querySelector('p[aria-live="polite"]')!;
    await waitFor(() => expect(region.textContent).toBe(WORKER_BATCH_PAUSED));
    // ...and left there.
    expect(document.activeElement).toBe(elsewhere);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(view.container.querySelector("[data-batch-paused]")).toBeNull(),
    );
  });

  it("while the batch runs, leaving the page asks first", async () => {
    let release: () => void = () => {};
    const net = limitedNetwork({
      holdPut: new Promise<void>((r) => (release = r)),
    });
    await dropTwo("repair-pdf");
    // Control: before Run, nothing holds the page.
    expect(unsavedLabels()).toEqual([]);
    const run = await screen.findByRole("button", { name: "Repair 2 PDFs" });
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await waitFor(() => expect(net.puts()).toBe(1));
    expect(unsavedLabels().some((l) => l.startsWith("your batch"))).toBe(true);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    release();
    await screen.findByText("Batch complete. 2 done, 0 failed.", undefined, {
      timeout: 5000,
    });
    // Awaited, as above: the hold is released by an effect after the end.
    await waitFor(() => expect(unsavedLabels()).toEqual([]));
  });

  // One tool per panel module: the set is the registration, grouped by the
  // panel each page mounts, never typed.
  const perPanel = [
    ...new Map(SLUGS.map((slug) => [bySlug.get(slug)!.file, slug])).values(),
  ];
  it("health: the seven worker panels, one tool each", () => {
    expect(perPanel).toHaveLength(7);
  });
  for (const slug of perPanel) {
    it(`${slug}: a job resumed after a reload is running, so two files dropped then never start a batch beside it`, async () => {
      let reservations = 0;
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { "content-type": "application/json" },
        });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? "GET";
          if (url.includes("/api/worker/status")) return json(READY);
          if (url === "/api/uploads") {
            reservations += 1;
            return json(
              { error: { code: "internal_error", message: "x" } },
              500,
            );
          }
          if (url === "/api/jobs/job_saved1" && method === "GET") {
            return json({ jobId: "job_saved1", status: "processing" });
          }
          if (url === "/api/jobs/job_saved1" && method === "DELETE")
            return json({ jobId: "job_saved1", status: "canceled" });
          throw new Error(`unexpected ${method} ${url}`);
        }),
      );
      sessionStorage.setItem(
        WORKER_JOB_STORAGE_PREFIX + slug,
        JSON.stringify({
          jobId: "job_saved1",
          expiresAt: Date.now() + 600_000,
        }),
      );
      const tool = getToolBySlug(slug)!;
      leave = enterToolPage({ toolSlug: slug, capability: "secure-worker" });
      const Panel = await panelFor(slug);
      const view = render(<Panel tool={tool} />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Keep waiting" }),
      );
      // The resumed job runs: its Cancel is the panel's busy status.
      await screen.findByRole("button", { name: "Cancel" });
      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(input).not.toBeNull();
      fireEvent.change(input, {
        target: { files: [fileFor(tool, "first"), fileFor(tool, "second")] },
      });
      await act(() => new Promise((r) => setTimeout(r, 300)));
      expect(
        view.container.querySelector(`[data-chunk="${BATCH_VIEW_LOADED}"]`),
      ).toBeNull();
      expect(reservations).toBe(0);
      // Still the resumed job's status, in view.
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });
  }

  it("control: HTML to PDF, on the same panel as EPUB to PDF, stays one file", async () => {
    stubJobNetwork(READY);
    const tool = getToolBySlug("html-to-pdf")!;
    const { view } = await dropTwo("html-to-pdf", [
      fileFor(tool, "a"),
      fileFor(tool, "b"),
    ]);
    await screen.findByText("a.html");
    expect(
      view.container.querySelector(`[data-chunk="${BATCH_VIEW_LOADED}"]`),
    ).toBeNull();
  });
});
