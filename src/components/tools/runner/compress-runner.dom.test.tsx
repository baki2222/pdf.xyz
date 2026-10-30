// @vitest-environment jsdom
// @native-canvas
/**
 * The Compress runner, driven with real files and judged on what a person
 * reads and can press.
 *
 * Two defects (audit 2026-09-27), both invisible to every test that existed,
 * because none rendered this runner:
 *
 *  1. ANY encrypted PDF was refused as "password-protected" — including the
 *     common owner-password-only file (bank statements, e-invoices) that opens
 *     in every viewer with no prompt. The refusal returned before the secure
 *     worker panel mounted, so the one path that could still compress the file
 *     was hidden behind a false claim. The fixtures here are REALLY encrypted
 *     (`src/tests/encrypted-pdf.ts`), because the question is what a reader
 *     can open, and a stub /Encrypt dict opens in nothing.
 *
 *  2. The "lossless, no quality lost" repack re-serialises the whole file,
 *     which invalidates every digital signature in it, and nothing looked.
 *     The fixtures carry a real /ByteRange (`src/tests/signed-pdf.ts`).
 *
 * No module is mocked (see `src/tests/mock-isolation.test.ts`). The worker
 * status endpoint is the one network call; it is answered at `fetch`.
 */
import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  HandoffStore,
  MemoryHandoffBackend,
} from "@/lib/handoff";
import { takeCarriedHandoff } from "@/lib/handoff/carry";
import { continueTargetsFor } from "@/lib/intent/next-steps";
import { analyzePdf } from "@/lib/pdf/analyze";
import { getToolBySlug, tools } from "@/lib/tools";
import type { NativeCompressor } from "@/lib/workers/compression/engine";
import { createLocalDevAdapter } from "@/lib/workers/local-dev";
import type { WorkerStatus } from "@/lib/workers/status";
import { DevWorkerStore } from "@/lib/workers/store";
import { encryptPdf } from "@/tests/encrypted-pdf";
import { colourImagePdf } from "@/lib/workers/compression/colour-image-pdf";
import { makeSignedPdf } from "@/tests/signed-pdf";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { CompressRunner, UNLOCK_TOOL_HREF } from "./compress-runner";
import { ToolRunProvider } from "./tool-context";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

const withRouter = (children: ReactNode) => (
  <AppRouterContext.Provider value={router as never}>
    {children}
  </AppRouterContext.Provider>
);

/** A worker that can run deep compression, so the run button is on screen. */
const DEEP_READY = {
  mode: "local-dev",
  localDevOnly: true,
  detail: "local dev server",
  compress: { lossless: true, deep: true, engines: ["ghostscript"] },
} as unknown as WorkerStatus;

function answerWorkerStatus(status: WorkerStatus | null = DEEP_READY) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      status
        ? new Response(JSON.stringify(status), { status: 200 })
        : new Response("", { status: 503 }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A secure worker reached over `fetch`, running the REAL local-dev adapter: the
 * same file-soundness gate, processor registry, compression engine (with its
 * real page check) and artifact-manifest gate the async executor runs. The one
 * stand-in is the native binary, which `native` plays. Returns every body the
 * runner uploaded, so a test can compare them with the file it dropped.
 */
function answerWithLocalWorker(native: NativeCompressor) {
  const store = new DevWorkerStore();
  const adapter = createLocalDevAdapter({
    store,
    compressionDeps: {
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native,
    },
  });
  const uploads: Uint8Array[] = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });
  const reply = <T,>(
    out:
      | { ok: true; status: number; value: T }
      | { ok: false; error: { status: number; body: unknown } },
  ) =>
    out.ok
      ? json(out.value, out.status)
      : json(out.error.body, out.error.status);

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
        const body = init?.body ? new Uint8Array(init.body) : new Uint8Array();
        const parsed = () => JSON.parse(new TextDecoder().decode(body));
        if (url === "/api/worker/status") return json(DEEP_READY);
        if (url === "/api/uploads" && init?.method === "POST") {
          return reply(await adapter.createUploadSession(parsed()));
        }
        const upload = /^\/api\/uploads\/local\/([^/]+)$/.exec(url);
        if (upload && init?.method === "PUT") {
          uploads.push(body);
          const put = store.putBytes(upload[1]!, body);
          return put.ok ? json({}) : json({ error: put.reason }, 400);
        }
        if (url === "/api/jobs" && init?.method === "POST") {
          return reply(await adapter.createJob(parsed()));
        }
        const artifact = /^\/api\/artifacts\/local\/([^/]+)$/.exec(url);
        if (artifact) {
          const got = store.retrieveArtifact(artifact[1]!);
          return got.lifecycle === "live"
            ? new Response(got.artifact.bytes.slice().buffer as ArrayBuffer)
            : json({}, 404);
        }
        throw new Error(`unexpected request in test: ${url}`);
      },
    ),
  );
  return { uploads };
}

/** Text a person would read — several pages, no object streams (so the repack shrinks it). */
async function plainPdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([300, 300]).drawText(`Statement page ${i + 1}`, {
      x: 20,
      y: 150,
      size: 14,
      font,
    });
  }
  return doc.save({ useObjectStreams: false });
}

const asFile = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice().buffer as ArrayBuffer], name, {
    type: "application/pdf",
  });

async function drop(container: HTMLElement, files: File[]) {
  await dropSheetsLive(container);
  const input = container.querySelector('input[type="file"]');
  expect(input, "the runner offers a file picker").not.toBeNull();
  fireEvent.drop(input!.closest("label")!, { dataTransfer: { files } });
}

const WORKER_PANEL = "Deep image compression (secure server)";

describe("Compress: an encrypted PDF", { timeout: 30_000 }, () => {
  it("owner-password only: says RESTRICTED, never 'password', and keeps the worker path", async () => {
    answerWorkerStatus();
    const bytes = await encryptPdf(await plainPdf(3), {
      userPassword: "",
      ownerPassword: "owner-secret",
    });
    const { container } = render(withRouter(<CompressRunner />));
    await drop(container, [asFile(bytes, "statement.pdf")]);

    const notice = await screen.findByRole(
      "status",
      { name: /permission restrictions/i },
      { timeout: 10_000 },
    );
    expect(notice).toHaveTextContent(/opens without a password/i);
    // The claim that was false: this file has no password.
    expect(container).not.toHaveTextContent(/password-protected/i);
    expect(container).not.toHaveTextContent(/needs a password/i);
    // Unlock needs a password to submit, so it is a dead end for this file.
    expect(
      screen.queryByRole("link", { name: /unlock/i }),
      "Unlock cannot help a file with no password",
    ).toBeNull();
    // The page count came from a reader that could open it.
    expect(container).toHaveTextContent("3 pages");
    // The in-browser repack cannot rewrite it, so it is not offered…
    expect(
      screen.queryByRole("button", { name: /download optimized/i }),
    ).toBeNull();
    // …and the secure worker, which can, is mounted and runnable.
    expect(screen.getByText(WORKER_PANEL)).toBeInTheDocument();
    const run = await screen.findByRole("button", {
      name: /compress images on our server/i,
    });
    expect(run).not.toHaveAttribute("aria-disabled", "true");
    // Signatures cannot be inspected in an encrypted file; say so, don't guess.
    expect(container).toHaveTextContent(
      /can.t check an encrypted file for digital signatures/i,
    );
  });

  it("owner-password only: does not promise the worker can process it", async () => {
    // The first version said the worker "opens files the way a PDF viewer
    // does" — a capability no job had shown. Until one does on the production
    // image, the notice has to leave room for the worker saying no.
    answerWorkerStatus();
    const bytes = await encryptPdf(await plainPdf(2), {
      userPassword: "",
      ownerPassword: "owner-secret",
      objectStreams: true,
    });
    const { container } = render(withRouter(<CompressRunner />));
    await drop(container, [asFile(bytes, "statement.pdf")]);
    const notice = await screen.findByRole(
      "status",
      { name: /permission restrictions/i },
      { timeout: 10_000 },
    );
    expect(notice).toHaveTextContent(
      /may not be able to process an encrypted file/i,
    );
    expect(notice).not.toHaveTextContent(/the way a PDF viewer does/i);
  });

  it("owner-password only, object streams: RUNS the worker with the file's own bytes, and a no-shrink run hands back the original — never 'unreadable'", async () => {
    // The composed chain the button stands for: runner -> upload -> local-dev
    // worker (soundness gate, processor, engine page check, manifest gate) ->
    // job -> what the person reads. The fixture has its page tree inside an
    // encrypted object stream — a modern bank statement — which pdf-lib cannot
    // count, and the engine plays Ghostscript failing to shrink a text-only
    // file. Before the engine fix this read "The compression engine produced
    // an unreadable PDF." about the person's own file.
    let engineSaw: Uint8Array | null = null;
    const { uploads } = answerWithLocalWorker(async (input) => {
      engineSaw = input;
      return input.slice();
    });
    const bytes = await encryptPdf(await plainPdf(3), {
      userPassword: "",
      ownerPassword: "owner-secret",
      objectStreams: true,
    });
    const { container } = render(withRouter(<CompressRunner />));
    await drop(container, [asFile(bytes, "statement.pdf")]);

    const run = await screen.findByRole(
      "button",
      { name: /compress images on our server/i },
      { timeout: 10_000 },
    );
    fireEvent.click(run);

    const done = await screen.findByRole(
      "group",
      { name: /finished with no size reduction/i },
      { timeout: 10_000 },
    );
    expect(done).toHaveTextContent(/couldn.t shrink this file further/i);
    expect(container).not.toHaveTextContent(/unreadable/i);
    expect(screen.queryByRole("alert")).toBeNull();

    // What went over the wire, and what the engine was handed, is the file the
    // person dropped — byte for byte, not a re-encoding of it.
    expect(uploads).toHaveLength(1);
    expect(Buffer.from(uploads[0]!).equals(Buffer.from(bytes))).toBe(true);
    expect(engineSaw, "the engine never ran").not.toBeNull();
    expect(Buffer.from(engineSaw!).equals(Buffer.from(bytes))).toBe(true);
  });

  it("user password: says it needs a password, links to a real Unlock tool, offers no worker", async () => {
    answerWorkerStatus();
    const bytes = await encryptPdf(await plainPdf(2), {
      userPassword: "open-me",
      ownerPassword: "owner-secret",
    });
    const { container } = render(withRouter(<CompressRunner />));
    await drop(container, [asFile(bytes, "locked.pdf")]);

    const alert = await screen.findByRole("alert", {}, { timeout: 10_000 });
    expect(alert).toHaveTextContent(/needs a password to open/i);
    const link = screen.getByRole("link", { name: /unlock/i });
    expect(link.getAttribute("href")).toBe(UNLOCK_TOOL_HREF);
    const slug = UNLOCK_TOOL_HREF.replace(/^\/tools\//, "");
    expect(getToolBySlug(slug)?.name).toMatch(/unlock/i);
    // Ghostscript and qpdf cannot open it without the password either.
    expect(screen.queryByText(WORKER_PANEL)).toBeNull();
  });

  it("control: an unencrypted PDF gets the analysis and the lossless download", async () => {
    answerWorkerStatus();
    const { container } = render(withRouter(<CompressRunner />));
    await drop(container, [asFile(await plainPdf(3), "plain.pdf")]);
    await screen.findByRole(
      "button",
      { name: /download optimized pdf/i },
      {
        timeout: 10_000,
      },
    );
    expect(
      screen.queryByRole("status", { name: /permission restrictions/i }),
    ).toBeNull();
    expect(screen.getByText(WORKER_PANEL)).toBeInTheDocument();
  });
});

/*
 * INVERTED 2026-10-11. Until then `./compress-runner.test.ts` held a picked
 * file's stage to `stageHoldPx`: from the commit the file arrived in, a
 * layout effect set the stage's min-height to what was left of the screen
 * below it, capped at `STAGE_HOLD_REM`. That moved the content under the
 * runner at the pick, and a file dropped, pasted or handed over opens no
 * input window, so the move was counted (page CLS 0.0567 at 1280 x 900,
 * 0.1212 at 768 x 1024). The page holds the first screen now
 * (`data-first-screen`), and the stage only grows into it.
 */
describe(
  "Compress: the stage a picked file is analysed on",
  { timeout: 30_000 },
  () => {
    it("is never held by script — no state sets its height — and grows into the panel it is drawn in", async () => {
      // A screen with room for a hold, so one would show: jsdom lays
      // nothing out, and on a screen 0 px tall the old hold computed 0
      // and set nothing either — this test would have passed against it.
      const html = document.documentElement;
      const real = Object.getOwnPropertyDescriptor(html, "clientHeight");
      Object.defineProperty(html, "clientHeight", {
        configurable: true,
        value: 900,
      });
      try {
        answerWorkerStatus();
        const { container } = render(withRouter(<CompressRunner />));
        const heights: string[] = [];
        const states = new Set<string>();
        const read = () => {
          const stage = container.querySelector<HTMLElement>(
            "[data-compress-stage]",
          );
          if (!stage) return;
          heights.push(stage.style.minHeight);
          const text = stage.textContent ?? "";
          states.add(
            stage.querySelector('[aria-label^="Analysis complete"]')
              ? "analysis"
              : text.includes("Analyzing")
                ? "analyzing"
                : text.includes("Reading")
                  ? "reading"
                  : "other",
          );
        };
        const observer = new MutationObserver(read);
        observer.observe(container, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["style"],
        });
        await drop(container, [asFile(await plainPdf(3), "plain.pdf")]);
        await screen.findByRole(
          "button",
          { name: /download optimized pdf/i },
          { timeout: 10_000 },
        );
        read();
        observer.disconnect();
        // Health: the stage was read through the run, to the analysis.
        expect(states.has("analysis"), [...states].join(", ")).toBe(true);
        expect(heights.length).toBeGreaterThan(1);
        expect(
          heights.filter(Boolean),
          "a state of the stage set its height",
        ).toEqual([]);
        expect(
          container.querySelector("[data-compress-stage]")!.classList,
        ).toContain("grow");
      } finally {
        if (real) Object.defineProperty(html, "clientHeight", real);
        else delete (html as { clientHeight?: number }).clientHeight;
      }
    });
  },
);

describe("Compress: a digitally signed PDF", { timeout: 30_000 }, () => {
  it("warns that the signatures will break, and gates both outputs behind a confirmation", async () => {
    answerWorkerStatus();
    const { container } = render(withRouter(<CompressRunner />));
    await drop(container, [
      asFile(await makeSignedPdf({ count: 2 }), "contract.pdf"),
    ]);

    const warning = await screen.findByRole(
      "group",
      { name: /digital signatures/i },
      { timeout: 10_000 },
    );
    expect(warning).toHaveTextContent(/2 digital signatures/);
    expect(warning).toHaveTextContent(/show as invalid/i);
    // The sentence that was false for this file.
    expect(container).not.toHaveTextContent(/no quality lost/i);

    // Neither output is one click away before the person has read that.
    expect(
      screen.queryByRole("button", { name: /download optimized pdf/i }),
    ).toBeNull();
    const run = await screen.findByRole("button", {
      name: /compress images on our server/i,
    });
    expect(run).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(within(warning).getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: /download optimized pdf/i }),
    ).toBeInTheDocument();
    expect(run).not.toHaveAttribute("aria-disabled", "true");
  });

  it("control: an unsigned PDF keeps 'no quality lost' and needs no confirmation", async () => {
    answerWorkerStatus();
    const { container } = render(withRouter(<CompressRunner />));
    await drop(container, [asFile(await plainPdf(3), "plain.pdf")]);
    await screen.findByRole(
      "button",
      { name: /download optimized pdf/i },
      {
        timeout: 10_000,
      },
    );
    expect(container).toHaveTextContent(/no quality lost/i);
    expect(
      screen.queryByRole("group", { name: /digital signatures/i }),
    ).toBeNull();
    expect(
      await screen.findByRole("button", {
        name: /compress images on our server/i,
      }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});

/**
 * A result with nothing saved still ENDS (2026-10-17). Until then the
 * Download and the ending (receipt, Continue with) were both inside
 * `canDownload &&`, so an already-lean file's analysis ended at "Analyze
 * another file" — and a merge carried here from Merge PDF, never downloaded,
 * could go nowhere (batch C review; `e2e/continue-chain.spec.ts` drives that
 * path in a browser). Now: the file as it came in, said to be unchanged,
 * and the ending carrying it.
 */
describe("Compress: an already-lean PDF", { timeout: 30_000 }, () => {
  /**
   * Lean, and NOT the repack's own bytes. Written with object streams, as
   * the repack writes, but with a producer and creator SHORTER than the
   * site's: the repack writes "pdf.xyz" into both, so its file is a few
   * bytes LONGER — nothing saved, the analysis "already lean" — and differs
   * from the input.
   *
   * WAS (until 2026-10-17) the site's own producer and creator, so the
   * repack wrote this file back byte for byte, and the test could not tell
   * the input from the repack: Download saving `result.optimized`, and
   * Continue with carrying it, both stayed green (PR #180 review). With
   * this fixture each is red.
   */
  async function leanPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.load(await plainPdf(2));
    doc.setProducer("p");
    doc.setCreator("c");
    return doc.save({ useObjectStreams: true });
  }

  const URL_STATICS = ["createObjectURL", "revokeObjectURL"] as const;
  const original = URL_STATICS.map(
    (key) => [key, Object.getOwnPropertyDescriptor(URL, key)] as const,
  );
  afterEach(() => {
    vi.restoreAllMocks();
    __setHandoffStoreForTests(null);
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(URL, key, descriptor);
      else Reflect.deleteProperty(URL, key);
    }
  });

  it("offers the file as it came in, byte for byte and said to be unchanged, with the receipt and Continue with carrying THAT file", async () => {
    answerWorkerStatus(null);
    const bytes = await leanPdf();
    // Health: the repack is no smaller, and it is not the input — so a
    // download or a carry of the repack is told from one of the input.
    const { optimized } = await analyzePdf(bytes);
    expect(optimized.byteLength).toBeGreaterThanOrEqual(bytes.byteLength);
    expect(Buffer.from(optimized).equals(Buffer.from(bytes))).toBe(false);

    __setHandoffStoreForTests(
      new HandoffStore({ backend: new MemoryHandoffBackend() }),
    );
    const pushes: string[] = [];
    const tool = getToolBySlug("compress-pdf")!;
    const { container } = render(
      <AppRouterContext.Provider
        value={
          { ...router, push: (href: string) => pushes.push(href) } as never
        }
      >
        <ToolRunProvider
          tool={{ slug: tool.slug, name: tool.name, category: tool.category }}
          plan={continueTargetsFor(tool, tools)}
        >
          <CompressRunner />
        </ToolRunProvider>
      </AppRouterContext.Provider>,
    );
    await drop(container, [asFile(bytes, "lean.pdf")]);
    // Health: the analysis found nothing to remove.
    await screen.findByRole(
      "heading",
      { name: "This PDF is already lean" },
      { timeout: 10_000 },
    );
    expect(screen.getByText("No change")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /download optimized pdf/i }),
    ).toBeNull();

    const download = screen.getByRole("button", {
      name: /download unchanged pdf/i,
    });
    // The ending: the receipt, and Continue with carrying this file.
    const rows = await screen.findByRole(
      "group",
      { name: "Continue with" },
      { timeout: 10_000 },
    );
    const links = within(rows).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links)
      expect(link).toHaveTextContent("carries lean.pdf");
    expect(container.querySelector("[data-receipt]")).not.toBeNull();

    // DOWNLOAD saves the input's bytes, under its name.
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        blobs.push(blob);
        return "blob:compress-lean-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    fireEvent.click(download);
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(names).toEqual(["lean.pdf"]);
    const saved = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(
      Buffer.from(saved).equals(Buffer.from(bytes)),
      "the download is not the file as it came in",
    ).toBe(true);

    // CONTINUE WITH carries the input's bytes: claimed as the next tool would.
    await act(async () => {
      fireEvent.click(links[0]!);
    });
    await waitFor(() => expect(pushes).toHaveLength(1));
    // INVERTED 2026-10-20: the address no longer carries the token (its
    // payload fetch sent it to the server's logs); the tab does.
    expect(pushes[0]).toMatch(/^\/tools\/[a-z0-9-]+$/);
    const id = takeCarriedHandoff(pushes[0]!)!;
    const record = await claimHandoff(id);
    expect(record?.files.map((f) => f.name)).toEqual(["lean.pdf"]);
    const carried = new Uint8Array(await record!.files[0]!.blob.arrayBuffer());
    expect(
      Buffer.from(carried).equals(Buffer.from(bytes)),
      "Continue with does not carry the file as it came in",
    ).toBe(true);
  });
});

describe("Compress batch", { timeout: 30_000 }, () => {
  it("flags a signed file, keeps it out of Download all until confirmed, and names a restricted file honestly", async () => {
    answerWorkerStatus(null);
    const restricted = await encryptPdf(await plainPdf(1), {
      userPassword: "",
      ownerPassword: "owner-secret",
    });
    const { container } = render(withRouter(<CompressRunner />));
    await drop(container, [
      asFile(await plainPdf(2), "plain.pdf"),
      asFile(await makeSignedPdf(), "signed.pdf"),
      asFile(restricted, "restricted.pdf"),
    ]);
    // The scope banner no longer promises "no quality loss" unqualified.
    expect(container).not.toHaveTextContent(/no quality loss/i);

    fireEvent.click(
      await screen.findByRole("button", { name: /compress 3 pdfs/i }),
    );
    await screen.findByText(/batch complete/i, {}, { timeout: 10_000 });

    const rows = within(
      screen.getByRole("list", { name: /files in this batch/i }),
    );
    const signedRow = rows.getByText("signed.pdf").closest("li")!;
    expect(signedRow).toHaveTextContent(
      /1 digital signature will show as invalid/i,
    );
    const restrictedRow = rows.getByText("restricted.pdf").closest("li")!;
    expect(restrictedRow).toHaveTextContent(/permission restrictions/i);
    expect(restrictedRow).not.toHaveTextContent(/password-protected/i);

    // Only the unsigned file is in the zip until the person opts the signed one in.
    expect(
      screen.getByRole("button", { name: /download all \(1\)/i }),
    ).toBeInTheDocument();
    expect(
      within(signedRow).queryByRole("button", { name: /download compressed/i }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /include 1 signed file/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /download all \(2\)/i }),
      ).toBeInTheDocument(),
    );
    expect(
      within(signedRow).getByRole("button", { name: /download compressed/i }),
    ).toBeInTheDocument();
  });
});

describe(
  "Compress: Extreme and Grayscale on our secure server",
  { timeout: 30_000 },
  () => {
    // Through the REAL local-dev adapter (job-option parser, processor,
    // engine with its grayscale gate) — only the Ghostscript binary is played.
    async function runGray(engineOutput: Uint8Array) {
      const seen: { targetDpi?: number; grayscale?: boolean }[] = [];
      answerWithLocalWorker(async (_input, ctx) => {
        seen.push({
          targetDpi: ctx.options.targetDpi,
          grayscale: ctx.options.grayscale,
        });
        return engineOutput;
      });
      const input = await colourImagePdf({ components: 3, size: 24 });
      const { container } = render(withRouter(<CompressRunner />));
      await drop(container, [asFile(input, "photo.pdf")]);
      const run = await screen.findByRole(
        "button",
        { name: /compress images on our server/i },
        { timeout: 10_000 },
      );
      fireEvent.click(screen.getByRole("button", { name: "Extreme" }));
      fireEvent.click(screen.getByRole("checkbox", { name: /grayscale/i }));
      fireEvent.click(run);
      return { seen, input, container };
    }

    it("sends 72 DPI and grayscale to the engine, and a gray file that is NOT smaller still downloads", async () => {
      const gray = await colourImagePdf({ components: 1, size: 24, pad: 8192 });
      const { seen, input } = await runGray(gray);
      const card = await screen.findByText(
        /converted this file to grayscale/i,
        undefined,
        { timeout: 10_000 },
      );
      expect(gray.byteLength).toBeGreaterThan(input.byteLength);
      expect(card).toHaveTextContent(/did not get smaller/i);
      expect(seen).toEqual([{ targetDpi: 72, grayscale: true }]);
      expect(
        screen.getByRole("button", { name: /download compressed pdf/i }),
      ).toBeInTheDocument();
      // The no-gain note says the ORIGINAL came back; it must not show here.
      expect(
        screen.queryByRole("group", { name: /no size reduction/i }),
      ).toBeNull();
    });

    it("an engine that kept the colour is refused, with no download", async () => {
      const colour = await colourImagePdf({ components: 3, size: 8 });
      await runGray(colour);
      await screen.findByText(
        /did not convert this file to grayscale/i,
        undefined,
        { timeout: 10_000 },
      );
      expect(
        screen.queryByRole("button", { name: /download compressed pdf/i }),
      ).toBeNull();
    });
  },
);
