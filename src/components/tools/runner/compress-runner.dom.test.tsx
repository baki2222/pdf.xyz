// @vitest-environment jsdom
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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { getToolBySlug } from "@/lib/tools";
import type { NativeCompressor } from "@/lib/workers/compression/engine";
import { createLocalDevAdapter } from "@/lib/workers/local-dev";
import type { WorkerStatus } from "@/lib/workers/status";
import { DevWorkerStore } from "@/lib/workers/store";
import { encryptPdf } from "@/tests/encrypted-pdf";
import { makeSignedPdf } from "@/tests/signed-pdf";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { CompressRunner, UNLOCK_TOOL_HREF } from "./compress-runner";

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
  detail: "local dev worker",
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

const WORKER_PANEL = "Deep image compression (secure worker)";

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
      name: /compress images on the worker/i,
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
      { name: /compress images on the worker/i },
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
      name: /compress images on the worker/i,
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
        name: /compress images on the worker/i,
      }),
    ).not.toHaveAttribute("aria-disabled", "true");
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
