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
import { RECONSTRUCTION_CLAIM } from "@/tests/reconstruction-claim";
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
import { formatBytes } from "@/lib/utils";
import { isLinearized } from "@/lib/pdf/linearization";
import { linearizedPdf } from "@/tests/linearized-pdf-fixture";
import { signedPdf } from "@/tests/signed-pdf";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { PdfStructureWorkerPanel } from "./pdf-structure-worker-panel";
import { OptimizeOutcome } from "./optimize-outcome";
import { readyFileInput } from "@/tests/worker-ready";

const providers = getProviderReadiness("remote-configured");

const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A server backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  security: {
    available: true,
    operations: ["protect", "unlock"],
    detail: "qpdf runs on our secure server.",
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
    detail: "no server observed",
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
  files: { input?: Uint8Array; output?: Uint8Array } = {},
): Promise<{ job: Job; artifact?: Uint8Array; qpdfCalls: string[][] }> {
  const input = files.input ?? INPUT;
  // What qpdf writes to the output path: a linearized file for `--linearize`
  // (the worker delivers nothing else since 2026-09-27), a plain one otherwise.
  const output =
    files.output ?? (slug === "optimize-web" ? linearizedPdf() : OUTPUT);
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
            readFile: async () => output,
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
    declaredBytes: input.byteLength,
  });
  store.putBytes(slot.fileId, input);
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

async function runOnePdf(slug: Slug, chosen: Uint8Array = INPUT) {
  render(
    <>
      <PdfStructureWorkerPanel tool={getToolBySlug(slug)!} />
      <LiveRegion />
    </>,
  );
  const input = await vi.waitFor(() => {
    const found = readyFileInput();
    if (!found) throw new Error("no file input yet");
    return found;
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File([chosen.slice()], "statement.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  // Focused first, as a keyboard or pointer user leaves it: the result card
  // then speaks through the live region instead of taking focus.
  const run = screen.getByRole("button", { name: /on our secure server/i });
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

    // INVERTED 2026-11-06 (audit #36): this control used a TIMEOUT as "a run
    // that did not finish", retryable. A timeout is final now and says the file
    // took too long (below); a spawn failure is the run a retry can change.
    it(`${slug}: a timeout is final and says the file took too long`, async () => {
      const { job } = await jobFrom(slug, { code: -1, timedOut: true });
      expect(job.error?.retryable).toBe(false);
      stubNetwork(slug, job);
      await runOnePdf(slug);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /took too long/,
      );
    });

    it(`${slug}: POSITIVE CONTROL — a run that did not finish links nothing`, async () => {
      const { job } = await jobFrom(slug, { code: -1, timedOut: false });
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

  /**
   * The notice's body, as rendered. Until 2026-11-06 it read "what follows is
   * what had to be reconstructed": the lines are qpdf's own diagnostics, not
   * an inventory of the rebuild (audit #41). Held to the claim's SHAPE, shared
   * with the tool page and the guide.
   */
  it("the rebuilt notice calls its lines qpdf's report, not what was reconstructed", async () => {
    const { job, artifact } = await jobFrom("repair-pdf", {
      code: 3,
      timedOut: false,
      stderr: "qpdf: file is damaged\nqpdf: reconstructing xref table\n",
    });
    stubNetwork("repair-pdf", job, artifact);
    await runOnePdf("repair-pdf");

    const notice = (await screen.findByText(/has been rebuilt/)).closest(
      '[role="status"]',
    )!;
    // Health check: this is the notice, and it holds qpdf's lines.
    expect(notice).toHaveTextContent(/file is damaged/);
    expect(notice).toHaveTextContent(/what qpdf reported/);
    expect(notice.textContent).not.toMatch(RECONSTRUCTION_CLAIM);
  });

  /**
   * qpdf exit 3 is "warnings issued, output produced": the file WAS rebuilt.
   * Until 2026-11-06 the engine derived recoveredWithWarnings from whether any
   * line survived sanitizing, so an exit 3 whose stderr was empty (or wholly
   * withheld) reached this panel as a clean run, and the panel said "qpdf
   * found no structural damage" about a file qpdf had just rebuilt.
   */
  it("an exit 3 with nothing to show still reads as rebuilt, never as clean", async () => {
    const { job, artifact } = await jobFrom("repair-pdf", {
      code: 3,
      timedOut: false,
      stderr: "",
    });
    expect(job.results?.repair?.recoveredWithWarnings).toBe(true);
    expect(job.results?.repair?.warnings).toEqual([]);
    stubNetwork("repair-pdf", job, artifact);
    await runOnePdf("repair-pdf");

    const group = await screen.findByRole("group");
    expect(group).toHaveTextContent(/has been rebuilt/);
    expect(group).toHaveTextContent(/could not be shown safely/);
    expect(group).not.toHaveTextContent(/found no structural damage/);
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

/**
 * Optimize for Web, after a run: the one property it promises, measured from
 * the bytes the user downloads — not from the fact that a job succeeded. The
 * worker image deploys by hand and can be older than this page, so the panel
 * checks the file itself before it says "linearized".
 */
describe("optimize-web success — the property, read from the downloaded bytes", () => {
  it("a linearized file says so, with its size before and after", async () => {
    const { job, artifact } = await jobFrom("optimize-web", {
      code: 0,
      timedOut: false,
    });
    // HEALTH: the real chain delivered the linearized bytes qpdf wrote.
    expect(isLinearized(artifact!)).toBe(true);
    stubNetwork("optimize-web", job, artifact);
    await runOnePdf("optimize-web");

    const group = await screen.findByRole("group");
    expect(group).toHaveTextContent(/Linearized for fast web view/);
    expect(group).toHaveTextContent(
      `${formatBytes(INPUT.byteLength)} → ${formatBytes(artifact!.byteLength)}`,
    );
    expect(await announced()).toBe("Your web-optimized PDF is ready.");
  });

  it("a file that is NOT linearized is not called web-optimized — an older worker can deliver one", async () => {
    const { job, artifact } = await jobFrom("optimize-web", {
      code: 0,
      timedOut: false,
    });
    expect(artifact).toBeDefined();
    // The job an older image completed: same record, unlinearized bytes.
    const plain = OUTPUT;
    expect(isLinearized(plain)).toBe(false);
    stubNetwork("optimize-web", job, plain);
    await runOnePdf("optimize-web");

    const group = await screen.findByRole("group");
    // The group rendered (so the absence below is not a blank card).
    expect(group).toHaveTextContent(
      `${formatBytes(INPUT.byteLength)} → ${formatBytes(plain.byteLength)}`,
    );
    expect(group).not.toHaveTextContent(/Linearized for fast web view/);
    expect(group).not.toHaveTextContent(/web-optimized PDF is ready/);
    expect(group).toHaveTextContent(/not linearized/);
    expect(await announced()).toMatch(/not linearized/);
  });

  it("a file that grew points at Compress PDF; one that shrank does not", async () => {
    const compress = `/tools/${getToolBySlug("compress-pdf")!.slug}`;
    const { job, artifact } = await jobFrom("optimize-web", {
      code: 0,
      timedOut: false,
    });
    // HEALTH: this fixture pair is the "grew" case.
    expect(artifact!.byteLength).toBeGreaterThan(INPUT.byteLength);
    stubNetwork("optimize-web", job, artifact);
    await runOnePdf("optimize-web");
    await screen.findByRole("group");
    expect(hrefsTo(compress)).toEqual([compress]);

    document.body.innerHTML = "";
    resetAnnouncer();
    // CONTROL: the same result from a larger upload shrank, and links nothing.
    const bigger = new TextEncoder().encode(
      `%PDF-1.7\n${"0".repeat(artifact!.byteLength * 2)}\n%%EOF\n`,
    );
    stubNetwork("optimize-web", job, artifact);
    await runOnePdf("optimize-web", bigger);
    await screen.findByRole("group");
    expect(hrefsTo(compress)).toEqual([]);
  });

  it("what qpdf reconstructed while linearizing is shown — not as a repair", async () => {
    const { job, artifact } = await jobFrom("optimize-web", {
      code: 3,
      timedOut: false,
      stderr: "qpdf: file is damaged\nqpdf: reconstructing xref table\n",
    });
    expect(job.results?.repair?.recoveredWithWarnings).toBe(true);
    stubNetwork("optimize-web", job, artifact);
    await runOnePdf("optimize-web");

    const group = await screen.findByRole("group");
    expect(group).toHaveTextContent("reconstructing xref table");
    expect(group).toHaveTextContent(/worked around/);
    // Optimize for Web did not promise a repair and must not report one.
    expect(group).not.toHaveTextContent(/repair succeeded|has been rebuilt/);
  });

  it("a truncated PDF is refused and sent to Repair PDF — through the real chain", async () => {
    const truncated = new TextEncoder().encode(
      `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${"0".repeat(64)}`,
    );
    const { job, qpdfCalls } = await jobFrom(
      "optimize-web",
      { code: 0, timedOut: false },
      undefined,
      { input: truncated },
    );
    expect(qpdfCalls).toEqual([]);
    expect(job.error?.retryable).toBe(false);
    stubNetwork("optimize-web", job);
    await runOnePdf("optimize-web", truncated);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Repair PDF/);
    expect(
      screen.getByRole("link", { name: "Open Repair PDF" }),
    ).toHaveAttribute("href", "/tools/repair-pdf");
  });
});

describe("OptimizeOutcome without a known input size (a job resumed after a reload)", () => {
  it("shows the output size alone — no '0 B', and no 'the file grew'", () => {
    const output = linearizedPdf();
    render(<OptimizeOutcome job={undefined} output={output} />);
    expect(document.body).toHaveTextContent(
      `Linearized for fast web view · ${formatBytes(output.byteLength)}`,
    );
    expect(document.body).not.toHaveTextContent(/0 B|→|grew/);
    expect(hrefsTo("/tools/compress-pdf")).toEqual([]);
  });

  it("POSITIVE CONTROL: the same output with a smaller known input says it grew", () => {
    const output = linearizedPdf();
    render(<OptimizeOutcome job={undefined} inputBytes={10} output={output} />);
    expect(document.body).toHaveTextContent(/grew/);
    expect(hrefsTo("/tools/compress-pdf")).toEqual(["/tools/compress-pdf"]);
  });
});

/*
 * Audits optimize-web#2 and #3 (2026-11-06): the panel uploaded and rewrote
 * whatever it was given. A digitally signed PDF came back with every
 * signature broken, said only in the FAQ; a PDF that was already linearized
 * was uploaded for nothing. Both are read from the picked file's bytes, in
 * the browser, before anything leaves the device.
 */
describe("optimize-web: what the picked file already is, before any upload", () => {
  async function pick(slug: Slug, bytes: Uint8Array) {
    const { job } = await jobFrom(slug, { code: 0, timedOut: false });
    stubNetwork(slug, job);
    render(<PdfStructureWorkerPanel tool={getToolBySlug(slug)!} />);
    const input = await vi.waitFor(() => {
      const found = readyFileInput();
      if (!found) throw new Error("no file input yet");
      return found;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([bytes.slice()], "contract.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    return screen.getByRole("button", { name: /on our secure server/i });
  }
  const uploadsRequested = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url) === "/api/uploads").length;

  it("a signed PDF names its signatures and holds Run until the reader confirms", async () => {
    const signed = await signedPdf({ signatures: 2 });
    expect(countDigitalSignatures(signed)).toBe(2);
    const run = await pick("optimize-web", signed);
    const warning = await screen.findByRole("group", {
      name: "This PDF has 2 digital signatures",
    });
    expect(warning).toHaveTextContent(
      "Linearizing rewrites the whole file, so the byte ranges they cover no longer match: they will show as invalid, even though every page looks the same.",
    );
    expect(run).toHaveAttribute("aria-disabled", "true");
    // What says why Run is off is the warning itself.
    expect(run).toHaveAttribute("aria-describedby", warning.id);
    fireEvent.click(run);
    expect(uploadsRequested()).toBe(0);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Optimize anyway — I understand the digital signatures will show as invalid",
      }),
    );
    expect(run).not.toHaveAttribute("aria-disabled");
    fireEvent.click(run);
    await vi.waitFor(() => expect(uploadsRequested()).toBe(1));
  });

  it("a press that lands before the pick-time read finishes still cannot send a signed file", async () => {
    const signed = await signedPdf({ signatures: 2 });
    // Hold the FIRST read of the file (the pick-time read) open; every later
    // read, including the one start() makes, goes through as normal.
    const real = Blob.prototype.arrayBuffer;
    let release: () => void = () => {};
    const reads = vi
      .spyOn(Blob.prototype, "arrayBuffer")
      .mockImplementationOnce(function (this: Blob) {
        const later = real.call(this);
        return new Promise<ArrayBuffer>((resolve) => {
          release = () => void later.then(resolve);
        });
      });
    const run = await pick("optimize-web", signed);
    // Health check: the read is still pending, so Run has nothing to hold it.
    expect(reads).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-web-input="read"]')).toBeNull();
    expect(run).not.toHaveAttribute("aria-disabled");
    fireEvent.click(run);
    // start() read the bytes itself, found the signatures, and stopped.
    const warning = await screen.findByRole("group", {
      name: "This PDF has 2 digital signatures",
    });
    expect(reads.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(run).toHaveAttribute("aria-describedby", warning.id);
    release();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-web-input="read"]')).not.toBeNull(),
    );
    expect(uploadsRequested()).toBe(0);
  });

  it("a tick given for one signed file does not unlock the next signed file", async () => {
    const first = await signedPdf({ signatures: 2 });
    const second = await signedPdf({ signatures: 1 });
    const run = await pick("optimize-web", first);
    const tick = await screen.findByRole("checkbox", {
      name: "Optimize anyway — I understand the digital signatures will show as invalid",
    });
    fireEvent.click(tick);
    // Positive control: the tick does unlock Run for the file it was given on.
    expect(run).not.toHaveAttribute("aria-disabled");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const input = await vi.waitFor(() => {
      const found = readyFileInput();
      if (!found) throw new Error("no file input yet");
      return found;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([second.slice()], "other.pdf", { type: "application/pdf" }),
        ],
      },
    });
    await screen.findByRole("group", {
      name: "This PDF has 1 digital signature",
    });
    const again = screen.getByRole("checkbox", {
      name: "Optimize anyway — I understand the digital signature will show as invalid",
    });
    expect(again).not.toBeChecked();
    const nextRun = screen.getByRole("button", {
      name: /on our secure server/i,
    });
    expect(nextRun).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(nextRun);
    expect(uploadsRequested()).toBe(0);
  });

  it("control: an unsigned PDF shows no signature warning and runs at once", async () => {
    const run = await pick("optimize-web", INPUT);
    expect(run).not.toHaveAttribute("aria-disabled");
    fireEvent.click(run);
    await vi.waitFor(() => expect(uploadsRequested()).toBe(1));
    expect(
      screen.queryByRole("group", { name: /digital signature/ }),
    ).toBeNull();
  });

  it("an already-linearized PDF is told so, and running it again stays optional", async () => {
    const already = linearizedPdf();
    expect(isLinearized(already)).toBe(true);
    const run = await pick("optimize-web", already);
    expect(
      await screen.findByText(
        "This PDF is already linearized for fast web view, so it does not need this step. Running it again is optional and uploads the file to our secure server.",
      ),
    ).toBeInTheDocument();
    expect(run).not.toHaveAttribute("aria-disabled");
    const { default: content } =
      await import("@/lib/tools/content/optimize-web");
    expect(
      content.faqs.find((f) => /already linearized/.test(f.q))?.a,
    ).toContain(
      "Before anything is uploaded, the panel reads the file, and if it already passes the same linearization test the result is held to, it says the PDF is already linearized for fast web view and does not need this step. The button stays on",
    );
    // Positive control for the mark the next test waits on.
    expect(document.querySelector('[data-web-input="read"]')).not.toBeNull();
  });

  it("control: a PDF that is not linearized gets no such note", async () => {
    await pick("optimize-web", INPUT);
    // The absence means something only once the file has been read: the
    // panel marks that, and the linearized case above reads the same mark.
    await vi.waitFor(() =>
      expect(document.querySelector('[data-web-input="read"]')).not.toBeNull(),
    );
    expect(screen.queryByText(/already linearized/)).toBeNull();
  });
});

describe("optimize-web: the page describes the signature gate the panel runs", () => {
  it("quotes the start of the checkbox the panel renders for a signed file", async () => {
    const { job } = await jobFrom("optimize-web", { code: 0, timedOut: false });
    stubNetwork("optimize-web", job);
    render(<PdfStructureWorkerPanel tool={getToolBySlug("optimize-web")!} />);
    const input = await vi.waitFor(() => {
      const found = readyFileInput();
      if (!found) throw new Error("no file input yet");
      return found;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([(await signedPdf({ signatures: 1 })).slice()], "a.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    const label =
      (await screen.findByRole("checkbox")).closest("label")?.textContent ?? "";
    const quoted = label.split(" — ")[0]!;
    expect(quoted.length).toBeGreaterThan(3);
    const { default: content } =
      await import("@/lib/tools/content/optimize-web");
    const answer =
      content.faqs.find((f) => /digitally signed/.test(f.q))?.a ?? "";
    expect(answer).toContain(
      `Before anything is uploaded, the panel reads the file for signatures: if it finds any, it says how many, and the button stays off until you tick the box that begins “${quoted}”.`,
    );
  });
});
