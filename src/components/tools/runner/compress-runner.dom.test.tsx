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
import type { WorkerStatus } from "@/lib/workers/status";
import { encryptPdf } from "@/tests/encrypted-pdf";
import { makeSignedPdf } from "@/tests/signed-pdf";
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

function drop(container: HTMLElement, files: File[]) {
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
    drop(container, [asFile(bytes, "statement.pdf")]);

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

  it("user password: says it needs a password, links to a real Unlock tool, offers no worker", async () => {
    answerWorkerStatus();
    const bytes = await encryptPdf(await plainPdf(2), {
      userPassword: "open-me",
      ownerPassword: "owner-secret",
    });
    const { container } = render(withRouter(<CompressRunner />));
    drop(container, [asFile(bytes, "locked.pdf")]);

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
    drop(container, [asFile(await plainPdf(3), "plain.pdf")]);
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
    drop(container, [
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
    drop(container, [asFile(await plainPdf(3), "plain.pdf")]);
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
    drop(container, [
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
