// @vitest-environment jsdom
/**
 * Repair PDF and Optimize for Web, as a user reads them: what the panel says
 * after a run, and where it sends them next.
 *
 * Every job record here is built by the REAL chain — the native qpdf runner
 * (only `exec` and `fs` stubbed, answering as execFile / fs.promises do), the
 * engine, the processor and the executor over the local-dev store — and the
 * panel reads it through the REAL browser client over a stubbed network. A
 * half passing its own test proves nothing about the path, so this runs both.
 *
 * Two defects, both fixed 2026-09-27:
 *  - A PDF qpdf refused (a user password, or damage too deep to rebuild) was a
 *    retryable `internal_error`: three identical qpdf runs, then "could not
 *    process this file" with no reason and no next step.
 *  - A run where qpdf found NOTHING to repair (exit 0) still said "Your
 *    repaired PDF is ready." — to the eye and to a screen reader. The code kept
 *    "clean" and "recovered" apart right up to the one sentence a user reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";
import { DevWorkerStore } from "@/lib/workers/store";
import { createLocalDevQueue } from "@/lib/workers/queue/local-dev";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { createLocalDevExecutorStorage } from "@/lib/workers/executor/local-dev-storage";
import { createWorkerExecutor } from "@/lib/workers/executor/executor";
import {
  nativePdfStructureDeps,
  type QpdfStructureExec,
  type QpdfStructureExecResult,
} from "@/lib/workers/pdf-structure/native";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { PdfStructureWorkerPanel } from "./pdf-structure-worker-panel";

const providers = getProviderReadiness("remote-configured");

const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  security: {
    available: true,
    operations: ["protect", "unlock"],
    detail: "qpdf runs on the worker.",
  },
  providers: {
    ...providers,
    storage: { ...providers.storage, ready: true },
    queue: { ...providers.queue, ready: true },
  },
  daemon: { ...resolveDaemonReadiness({}), drainable: true },
  ai: resolveAiReadiness({}),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
  },
};

const INPUT = new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(40)}\n%%EOF\n`);
const OUTPUT = new TextEncoder().encode(`%PDF-1.7\n${"1".repeat(64)}\n%%EOF\n`);

type Slug = "repair-pdf" | "optimize-web";

/**
 * Run one job through the real worker chain with qpdf answering `main` to the
 * rewrite and `probe` to `--requires-password`; return the stored job record —
 * what GET /api/jobs/:id serves — and the artifact bytes.
 */
async function jobFrom(
  slug: Slug,
  main: QpdfStructureExecResult,
  probe: QpdfStructureExecResult = { code: 2, timedOut: false },
): Promise<{ job: Job; artifact?: Uint8Array; qpdfCalls: string[][] }> {
  let clock = 100_000;
  const store = new DevWorkerStore(() => clock);
  const queue = createLocalDevQueue({ store, now: () => clock });
  // Every argument list qpdf was actually given, in order: what a test may
  // conclude about the file depends on what qpdf was asked, not on a stub.
  const qpdfCalls: string[][] = [];
  const exec: QpdfStructureExec = async (_c, args) => {
    qpdfCalls.push([...args]);
    return args[0] === "--requires-password" ? probe : main;
  };
  const executor = createWorkerExecutor({
    queue,
    storage: createLocalDevExecutorStorage({ store, now: () => clock }),
    registry: createProcessorRegistry({
      pdfStructure: nativePdfStructureDeps(
        {},
        {
          resolveOnPath: () => true,
          exec,
          fs: {
            mkdtemp: async (p) => `${p}dir`,
            writeFile: async () => {},
            readFile: async () => OUTPUT,
            rm: async () => {},
          },
        },
      ),
    }),
    leaseMs: 1_000,
    maxAttempts: 1,
  });
  const slot = store.reserveSlot({
    sessionId: "sess_test00000",
    filename: "statement.pdf",
    contentType: "application/pdf",
    declaredBytes: INPUT.byteLength,
  });
  store.putBytes(slot.fileId, INPUT);
  await queue.submit({
    job: {
      jobId: "job_panel00000",
      tool: slug,
      capability: "secure-worker",
      status: "queued",
      progress: 0,
      createdAt: new Date(clock).toISOString(),
      updatedAt: new Date(clock).toISOString(),
      expiresAt: new Date(clock + 60 * 60_000).toISOString(),
      retention: DEFAULT_RETENTION,
    },
    inputs: [slot.fileId],
    options: {},
  });
  await executor.runOnce();
  clock += 1;
  const job = store.getJob("job_panel00000")!;
  const art = job.artifacts?.[0];
  return {
    job,
    qpdfCalls,
    ...(art ? { artifact: store.getArtifact(art.artifactId)!.bytes } : {}),
  };
}

function stubNetwork(slug: Slug, job: Job, artifact?: Uint8Array) {
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () =>
      artifact ? artifact.slice().buffer : new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/worker/status") return json(READY);
      if (url === "/api/uploads")
        return json({
          sessionId: "s1",
          tool: slug,
          slots: [
            {
              fileId: "f1",
              filename: "statement.pdf",
              url: "/upload/f1",
              method: "PUT",
              headers: {},
            },
          ],
        });
      if (url === "/upload/f1") return json({});
      if (url === "/api/jobs") return json(job);
      if (artifact && url === job.artifacts?.[0]?.url) return json({});
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

async function runOnePdf(slug: Slug) {
  render(
    <>
      <PdfStructureWorkerPanel tool={getToolBySlug(slug)!} />
      <LiveRegion />
    </>,
  );
  const input = await vi.waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    if (!found) throw new Error("no file input yet");
    return found;
  });
  fireEvent.change(input, {
    target: {
      files: [new File([INPUT], "statement.pdf", { type: "application/pdf" })],
    },
  });
  // Focused first, as a keyboard or pointer user leaves it: the result card
  // then speaks through the live region instead of taking focus.
  const run = screen.getByRole("button", { name: /on the worker/i });
  run.focus();
  fireEvent.click(run);
}

/**
 * What a screen reader hears, from BOTH channels the result card speaks on:
 * the live region it writes to, and its own accessible name (read when it
 * takes focus instead). They must agree, or one of them is the stale claim.
 */
async function announced(): Promise<string> {
  const spoken = await vi.waitFor(() => {
    const text =
      document.querySelector('[aria-live="polite"]')?.textContent ?? "";
    if (!text) throw new Error("nothing announced yet");
    return text;
  });
  expect(screen.getByRole("group")).toHaveAccessibleName(spoken);
  return spoken;
}

/** Every rendered link to `href` — by attribute, whatever its label says. */
function hrefsTo(href: string): string[] {
  return Array.from(document.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h === href);
}

afterEach(() => {
  resetTelemetry();
  resetAnnouncer();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const LOCKED = { code: 2, timedOut: false } as const;
const PROBE_LOCKED = { code: 0, timedOut: false } as const;

describe("a document qpdf refuses — named once, with the tool that fixes it", () => {
  for (const slug of ["repair-pdf", "optimize-web"] as const) {
    it(`${slug}: a password-protected PDF is sent to Unlock PDF`, async () => {
      const { job } = await jobFrom(slug, LOCKED, PROBE_LOCKED);
      stubNetwork(slug, job);
      await runOnePdf(slug);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /password-protected/,
      );
      expect(
        screen.getByRole("link", { name: "Open Unlock PDF" }),
      ).toHaveAttribute("href", "/tools/unlock-pdf");
      // POSITIVE CONTROL for the clean run's absence check: the same scan
      // sees an Unlock link where one belongs.
      expect(hrefsTo("/tools/unlock-pdf")).toEqual(["/tools/unlock-pdf"]);
    });

    it(`${slug}: POSITIVE CONTROL — a run that did not finish links nothing`, async () => {
      const { job } = await jobFrom(slug, { code: -1, timedOut: true });
      expect(job.error?.retryable).toBe(true);
      stubNetwork(slug, job);
      await runOnePdf(slug);
      await screen.findByRole("alert");
      expect(screen.queryByRole("link", { name: /^Open / })).toBeNull();
    });
  }

  it("optimize-web: a PDF qpdf cannot open is sent to Repair PDF", async () => {
    const { job } = await jobFrom("optimize-web", LOCKED);
    stubNetwork("optimize-web", job);
    await runOnePdf("optimize-web");
    await screen.findByRole("alert");
    expect(
      screen.getByRole("link", { name: "Open Repair PDF" }),
    ).toHaveAttribute("href", "/tools/repair-pdf");
  });

  it("repair-pdf: a file it could not rebuild is NOT sent back to Repair PDF", async () => {
    const { job } = await jobFrom("repair-pdf", LOCKED);
    stubNetwork("repair-pdf", job);
    await runOnePdf("repair-pdf");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be rebuilt/,
    );
    expect(screen.queryByRole("link", { name: "Open Repair PDF" })).toBeNull();
  });
});

describe("repair-pdf success — says what qpdf reported, not more", () => {
  it("a file qpdf rebuilt reads as repaired, and is announced as repaired", async () => {
    const { job, artifact } = await jobFrom("repair-pdf", {
      code: 3,
      timedOut: false,
      stderr: "qpdf: file is damaged\nqpdf: reconstructing xref table\n",
    });
    expect(job.results?.repair?.recoveredWithWarnings).toBe(true);
    stubNetwork("repair-pdf", job, artifact);
    await runOnePdf("repair-pdf");

    expect(
      await screen.findByText("Your repaired PDF is ready."),
    ).toBeInTheDocument();
    expect(await announced()).toBe("Your repaired PDF is ready.");
  });

  it("a clean run does not claim a repair — on screen or to a screen reader", async () => {
    const { job, artifact } = await jobFrom("repair-pdf", {
      code: 0,
      timedOut: false,
    });
    expect(job.results?.repair?.recoveredWithWarnings).toBe(false);
    stubNetwork("repair-pdf", job, artifact);
    await runOnePdf("repair-pdf");

    const group = await screen.findByRole("group");
    expect(group).toHaveTextContent(/found no structural damage/);
    expect(group).not.toHaveTextContent(/repaired PDF is ready/);
    expect(await announced()).toMatch(/found no structural damage/);
    expect(await announced()).not.toMatch(/repaired/);
  });

  /**
   * INVERTED 2026-09-27. This used to assert the clean run linked Unlock PDF
   * ("If it still won't open, it may be password-protected — try Unlock PDF"),
   * and so pinned a false claim in place of the one it had just removed.
   *
   * The clean line renders only when qpdf exited 0, and the worker gives qpdf
   * no password. So on this branch qpdf has just opened the file WITHOUT one:
   * it cannot need a user password, and an owner-password-only file opens in
   * viewers anyway. `requiresPasswordArgs` rejects `--is-encrypted` for this
   * exact reason; the clean screen routed there regardless.
   *
   * The premise is read from what qpdf was actually asked, not assumed: if the
   * worker ever passes a password, the first assertion fails and the advice
   * has to be re-derived rather than silently becoming true or false.
   */
  it("a clean run does not send the user to Unlock PDF — qpdf just opened it without a password", async () => {
    const { job, artifact, qpdfCalls } = await jobFrom("repair-pdf", {
      code: 0,
      timedOut: false,
    });
    // Health check: the rewrite ran, exactly once, and nothing else did.
    expect(qpdfCalls).toHaveLength(1);
    expect(qpdfCalls[0]!.length).toBeGreaterThan(0);
    // The premise: no password (or any password-bearing flag) reached qpdf.
    expect(qpdfCalls[0]!.filter((a) => /password/i.test(a))).toEqual([]);
    expect(job.results?.repair?.recoveredWithWarnings).toBe(false);

    stubNetwork("repair-pdf", job, artifact);
    await runOnePdf("repair-pdf");
    const group = await screen.findByRole("group");
    // The group rendered its outcome (so an absence below is not a blank card).
    expect(group).toHaveTextContent(/found no structural damage/);

    expect(hrefsTo("/tools/unlock-pdf")).toEqual([]);
    expect(document.body).not.toHaveTextContent(/password/i);
    // What still holds after a clean open: the damage may be in page content.
    expect(group).toHaveTextContent(/page content/);
  });

  it("a worker that did not report (no repair block) claims neither", async () => {
    const { job, artifact } = await jobFrom("repair-pdf", {
      code: 0,
      timedOut: false,
    });
    // An older worker image: the web tier auto-deploys, the worker does not.
    const older: Job = { ...job };
    delete older.results;
    stubNetwork("repair-pdf", older, artifact);
    await runOnePdf("repair-pdf");

    const group = await screen.findByRole("group");
    expect(group).toHaveTextContent("Your PDF is ready.");
    // Not /repaired/: the download is still named `-repaired.pdf`, which is
    // the tool's name for its output, not a claim about this run.
    expect(group).not.toHaveTextContent(/repaired PDF|no structural damage/);
    expect(await announced()).toBe("Your PDF is ready.");
  });

  it("POSITIVE CONTROL: optimize-web keeps its own sentence", async () => {
    const { job, artifact } = await jobFrom("optimize-web", {
      code: 0,
      timedOut: false,
    });
    stubNetwork("optimize-web", job, artifact);
    await runOnePdf("optimize-web");
    expect(await announced()).toBe("Your web-optimized PDF is ready.");
  });
});
