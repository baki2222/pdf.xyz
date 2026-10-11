// @vitest-environment jsdom
// @native-canvas
/**
 * Summarize PDF checks the document BEFORE anything is uploaded or charged.
 *
 * The route reserves a third of the day's AI allowance when the job is
 * CREATED, so the worker's own "no selectable text" answer comes too late to
 * give it back. A scanned PDF — among the commonest inputs to a summarizer —
 * was uploaded (up to 100 MB), charged, and then refused; two scans and one
 * real document used up the day. A locked PDF got "could not be read for text
 * extraction", with no word about the password. The Translate panel had
 * documented and fixed this trap; Summarize never had.
 *
 * Driven through the real panel and the real browser job client over a
 * recording network. The extractor is swapped through
 * `summarizePreflightDeps` (and put back) because pdfjs cannot run under the
 * test DOM (it needs `DOMMatrix`), and `vi.mock` would leave the text module
 * cached with the stub for later files; what it returns — or throws, by
 * pdfjs's own exception names — is the input under test. The positive control
 * is a text PDF that MUST reach `/api/jobs`, so a stub that blocked everything
 * could not pass.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";

import { summarizePreflightDeps } from "@/lib/workers/summarize-client";
import { SummarizeWorkerPanel } from "./summarize-worker-panel";

/** What the stubbed extractor does in the current test. */
const extraction = {
  run: (async () => {
    throw new Error("unset");
  }) as () => Promise<ExtractedPdfText>,
};
const realExtract = summarizePreflightDeps.extract;

const tool = getToolBySlug("summarize-pdf")!;
const providers = getProviderReadiness("remote-configured");
const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: true, detail: "scanned" },
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
  ai: resolveAiReadiness({
    PDFXYZ_AI_PROVIDER: "openai",
    PDFXYZ_AI_MODEL: "gpt-5.6-luna",
  }),
  pipeline: {
    verdict: "live",
    observed: true,
    drainable: true,
    detail: "worker observed",
  },
};

function textOf(text: string): ExtractedPdfText {
  return {
    pageCount: 1,
    pages: [{ pageNumber: 1, text, characterCount: text.length }],
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

function pdfjsError(name: string): Error {
  const error = new Error(`${name} from pdfjs`);
  error.name = name;
  return error;
}

/** Record every request; answer the job lifecycle with a failed job. */
function network() {
  const urls: string[] = [];
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url === "/api/worker/status") return json(READY);
      if (url === "/api/uploads")
        return json({
          slots: [
            { fileId: "f1", url: "/upload/f1", method: "PUT", headers: {} },
          ],
        });
      if (url === "/upload/f1") return json({});
      if (url === "/api/jobs")
        return json({
          jobId: "job_sum1",
          status: "failed",
          error: { code: "x", message: "stubbed worker", retryable: false },
        });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return urls;
}

async function summarize() {
  summarizePreflightDeps.extract = () => extraction.run();
  render(<SummarizeWorkerPanel tool={tool} />);
  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    if (!found) throw new Error("no input");
    return found;
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));
  return screen.findByRole("alert");
}

afterEach(() => {
  summarizePreflightDeps.extract = realExtract;
  resetTelemetry();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const SPENT = ["/api/uploads", "/api/jobs"];

describe("Summarize panel — a PDF that cannot be summarized is refused before it costs anything", () => {
  it("a scan (no selectable text) is refused locally, with a way to OCR it", async () => {
    const urls = network();
    extraction.run = async () => textOf("");
    expect(await summarize()).toHaveTextContent(/no selectable text/i);
    expect(screen.getByRole("link", { name: "Open OCR PDF" })).toHaveAttribute(
      "href",
      "/tools/ocr-pdf",
    );
    expect(urls.filter((u) => SPENT.includes(u))).toEqual([]);
  });

  it("text that is only whitespace counts as none", async () => {
    const urls = network();
    extraction.run = async () => textOf("   \n  ");
    expect(await summarize()).toHaveTextContent(/no selectable text/i);
    expect(urls.filter((u) => SPENT.includes(u))).toEqual([]);
  });

  it("a password-protected PDF is named, with a way to unlock it", async () => {
    const urls = network();
    extraction.run = async () => {
      throw pdfjsError("PasswordException");
    };
    expect(await summarize()).toHaveTextContent(/password-protected/i);
    expect(
      screen.getByRole("link", { name: "Open Unlock PDF" }),
    ).toHaveAttribute("href", "/tools/unlock-pdf");
    expect(urls.filter((u) => SPENT.includes(u))).toEqual([]);
  });

  it("a file that is not a readable PDF is refused — without claiming a password", async () => {
    for (const name of ["InvalidPDFException", "UnknownErrorException"]) {
      const urls = network();
      extraction.run = async () => {
        throw pdfjsError(name);
      };
      const alert = await summarize();
      expect(alert).not.toHaveTextContent(/password-protected/i);
      expect(
        screen.getByRole("link", { name: "Open Repair PDF" }),
      ).toHaveAttribute("href", "/tools/repair-pdf");
      expect(urls.filter((u) => SPENT.includes(u))).toEqual([]);
      document.body.innerHTML = "";
      vi.unstubAllGlobals();
    }
  });

  it("POSITIVE CONTROL: a PDF with text goes to the worker", async () => {
    const urls = network();
    extraction.run = async () => textOf("A contract with several clauses.");
    expect(await summarize()).toHaveTextContent(/stubbed worker/);
    expect(urls).toContain("/api/uploads");
    expect(urls).toContain("/api/jobs");
  });
});
