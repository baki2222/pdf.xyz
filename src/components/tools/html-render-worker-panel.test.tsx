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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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

/**
 * A chosen file whose contents arrive only when the test says so, so the
 * moment the scan runs is the test's, not the scheduler's.
 */
function heldFile(html: string, name = "report.html") {
  let release!: () => void;
  const read = new Promise<string>((r) => (release = () => r(html)));
  const file = new File([html], name, { type: "text/html" });
  Object.defineProperty(file, "text", { value: () => read });
  return {
    file,
    /** Let the panel read the file, and let everything that follows settle. */
    release: () =>
      act(async () => {
        release();
        await read;
      }),
  };
}

async function pick(html: string | File, name = "report.html") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
  );
  render(<HtmlRenderWorkerPanel tool={htmlTool} />);
  await screen.findByText("Secure worker");
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, {
    target: {
      files: [
        typeof html === "string"
          ? new File([html], name, { type: "text/html" })
          : html,
      ],
    },
  });
  await screen.findByText(typeof html === "string" ? name : html.name);
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
  // about, or the note is noise users learn to ignore. History: this used to
  // assert absence after a fixed 50 ms sleep, which passes just as well when
  // the scan has not run yet. The file is now held until the test releases
  // it, and the same release shows a note at once for a page that needs one
  // (the control that the release really does let the scan finish).
  it("says nothing for a self-contained page, once the scan has run", async () => {
    const control = heldFile(`<img src="logo.png">`);
    await pick(control.file);
    expect(screen.queryByText(MISSING)).toBeNull();
    await control.release();
    expect(screen.queryByText(MISSING)).not.toBeNull();
    cleanup();

    const clean =
      heldFile(`<!doctype html><html><head><style>h1{color:red}</style></head>
      <body><h1>Invoice</h1><img src="data:image/png;base64,AAAA"></body></html>`);
    await pick(clean.file);
    await clean.release();
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  // A live region announces CHANGES to itself. One inserted together with its
  // text is, for several screen readers, never announced. So the region is
  // there, empty, from the moment a file is chosen, and the note arrives in it.
  it("announces the note in a live region that was waiting for it", async () => {
    const held = heldFile(`<img src="logo.png">`);
    await pick(held.file);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    await held.release();
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toMatch(MISSING);
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
