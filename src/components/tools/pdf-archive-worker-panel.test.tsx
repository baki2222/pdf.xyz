// @vitest-environment jsdom
/**
 * What a PDF/A user sees when the worker says the file needs a password.
 *
 * Before: every Ghostscript failure — an open-password PDF included — ended in
 * "The PDF/A engine could not process this file" after three identical
 * attempts, with nothing pointing at the tool that fixes it. Now the worker
 * returns its own code, and this panel turns that code into a link. The test
 * drives the real panel: status fetch → file pick → Convert → the rendered
 * outcome. Only the job client is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { WorkerStatus } from "@/lib/workers/status";
import { PDF_ARCHIVE_PASSWORD_REQUIRED_CODE } from "@/lib/workers/pdf-archive/contract";

const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workers/pdf-archive-client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/workers/pdf-archive-client")
  >()),
  runWorkerPdfToPdfA: run,
}));

import { PdfArchiveWorkerPanel } from "./pdf-archive-worker-panel";

const tool = getToolBySlug("pdf-to-pdfa")!;

const READY = {
  mode: "remote-configured",
  enabled: false,
  localDevOnly: false,
  detail: "remote",
  compress: { lossless: false, deep: false, engines: [] },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  scan: { active: false, detail: "not scanned" },
  security: { available: false, operations: [], detail: "qpdf" },
  providers: {
    storage: { ready: true },
    queue: { ready: true },
    processor: { ready: true },
  },
  daemon: { drainable: true, detail: "ready" },
  ai: { ready: false },
  pipeline: { verdict: "off", observed: false, drainable: false, detail: "" },
} as unknown as WorkerStatus;

afterEach(() => {
  cleanup();
  run.mockReset();
  vi.unstubAllGlobals();
});

async function convertAndGetOutcome(outcome: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
  );
  run.mockResolvedValue(outcome);
  render(<PdfArchiveWorkerPanel tool={tool} />);
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File(["%PDF-1.7"], "statement.pdf", { type: "application/pdf" }),
      ],
    },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: /convert to pdf\/a/i }),
  );
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  return screen.findByRole("alert");
}

describe("PdfArchiveWorkerPanel failure outcomes", () => {
  it("links an open-password failure to Unlock PDF — a real tool page", async () => {
    const alert = await convertAndGetOutcome({
      ok: false,
      code: PDF_ARCHIVE_PASSWORD_REQUIRED_CODE,
      message: "This PDF needs a password to open.",
    });
    expect(alert).toHaveTextContent("This PDF needs a password to open.");
    const link = screen.getByRole("link", { name: "Unlock PDF" });
    const href = link.getAttribute("href")!;
    // The link's target is a page that exists, derived from the catalog.
    const slug = /^\/tools\/([^/]+)$/.exec(href)?.[1];
    expect(slug).toBeDefined();
    expect(getToolBySlug(slug!)?.name).toMatch(/unlock/i);
  });

  it("NEGATIVE CONTROL: any other failure shows the message and no unlock link", async () => {
    const alert = await convertAndGetOutcome({
      ok: false,
      code: "internal_error",
      message: "The PDF/A engine could not process this file.",
    });
    expect(alert).toHaveTextContent("could not process this file");
    expect(screen.queryByRole("link", { name: "Unlock PDF" })).toBeNull();
  });

  it("does not describe the output as certified PDF/A", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
    );
    render(<PdfArchiveWorkerPanel tool={tool} />);
    expect(await screen.findByText(/not validated/i)).toBeInTheDocument();
  });
});
