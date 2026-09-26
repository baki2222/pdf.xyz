// @vitest-environment jsdom
/**
 * HTML to PDF takes ONE file. A page whose images and stylesheet sit beside it
 * on the user's disk used to convert "successfully" into a PDF of broken-image
 * icons and unstyled text, with nothing on screen saying why. The panel now
 * reads the chosen file and says, before upload, which linked files will be
 * missing. These tests drive the panel the way a user does — pick a file —
 * and read what is rendered, not the scan's return value.
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
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { HtmlRenderWorkerPanel } from "./html-render-worker-panel";

const htmlTool = getToolBySlug("html-to-pdf")!;
const providers = getProviderReadiness("remote-configured");

/** A deployment whose pipeline can take an html-to-pdf job right now. */
const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "n/a" },
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function pick(html: string, name = "report.html") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
  );
  render(<HtmlRenderWorkerPanel tool={htmlTool} />);
  await screen.findByText("Secure worker");
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, {
    target: { files: [new File([html], name, { type: "text/html" })] },
  });
  await screen.findByText(name);
}

const MISSING = /not part of this upload and will be missing from the PDF/;

describe("HtmlRenderWorkerPanel — linked files the upload does not carry", () => {
  it("names the missing files and counts them when the page links siblings", async () => {
    await pick(`<!doctype html><html><head>
      <link rel="stylesheet" href="style.css"></head>
      <body><img src="images/logo.png"><img src="https://cdn.example/ok.png"></body></html>`);
    const note = await screen.findByText(MISSING);
    expect(note.textContent).toContain("2 linked files (e.g. style.css)");
  });

  // The positive control's twin: a self-contained page must not be warned
  // about, or the note is noise users learn to ignore.
  it("says nothing for a self-contained page", async () => {
    await pick(`<!doctype html><html><head><style>h1{color:red}</style></head>
      <body><h1>Invoice</h1><img src="data:image/png;base64,AAAA"></body></html>`);
    // Let the async read settle before asserting absence.
    await waitFor(() =>
      expect(screen.getByText("report.html")).toBeInTheDocument(),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  it("states the one-file limit before any file is chosen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
    );
    render(<HtmlRenderWorkerPanel tool={htmlTool} />);
    expect(
      await screen.findByText(/Only the file itself is uploaded/),
    ).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("drops the note when the file is removed", async () => {
    await pick(`<img src="logo.png">`);
    await screen.findByText(MISSING);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText(MISSING)).toBeNull();
  });
});
