// @vitest-environment jsdom
/**
 * HTML to PDF takes ONE file. A page whose images and stylesheet sit beside it
 * on the user's disk used to convert "successfully" into a PDF of broken-image
 * icons and unstyled text, with nothing on screen saying why. The panel now
 * reads the chosen file and says, before upload, which linked files will be
 * missing. These tests drive the panel the way a user does — pick a file —
 * and read what is rendered, not the scan's return value.
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
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
import {
  WEBPAGE_CAPTURE_CHOICES,
  WEBPAGE_CAPTURE_LABELS,
  WEBPAGE_CAPTURE_GROUP_LABEL,
} from "@/lib/jobs/webpage-capture-options";

const htmlTool = getToolBySlug("html-to-pdf")!;
const providers = getProviderReadiness("remote-configured");

/** A deployment whose pipeline can take an html-to-pdf job right now. */
const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A server backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "n/a" },
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
  // The panel reads the BYTES (`decodeTextFile`, in the file's own encoding —
  // until the integration of wave1/l01-page-leak it called Blob.text(), and
  // this held that).
  const read = new Promise<ArrayBuffer>(
    (r) =>
      (release = () => {
        const bytes = new TextEncoder().encode(html);
        r(bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer);
      }),
  );
  const file = new File([html], name, { type: "text/html" });
  Object.defineProperty(file, "arrayBuffer", { value: () => read });
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
  render(
    <InToolPage tool={htmlTool}>
      <HtmlRenderWorkerPanel tool={htmlTool} />
    </InToolPage>,
  );
  await screen.findByText("Secure server");
  // HTML to PDF's input is its own chunk (`html-source-area`), loaded with
  // the panel: waited for, not assumed present on the first render.
  const input = await waitFor(() => {
    const found =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(found).not.toBeNull();
    return found!;
  });
  fireEvent.change(input, {
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
    render(
      <InToolPage tool={htmlTool}>
        <HtmlRenderWorkerPanel tool={htmlTool} />
      </InToolPage>,
    );
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

/**
 * The address field of Webpage to PDF had no name at all: no `<label>`, no
 * `aria-label`, only a placeholder ("https://example.com") that disappears as
 * the first character is typed and that several screen readers do not
 * announce. On light paper it was also a near-black slab. It is now named by
 * a visible label, so a sighted reader and a screen reader get the same word.
 */
describe("HtmlRenderWorkerPanel — the address field is named", () => {
  const urlTool = getToolBySlug("webpage-to-pdf")!;

  async function mountUrl() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
    );
    render(
      <InToolPage tool={urlTool}>
        <HtmlRenderWorkerPanel tool={urlTool} />
      </InToolPage>,
    );
    await screen.findByText("Secure server");
  }

  it("by a visible label, not by its placeholder", async () => {
    await mountUrl();
    const field = screen.getByLabelText("Web address");
    expect(field.tagName).toBe("INPUT");
    const label = document.querySelector(`label[for="${field.id}"]`);
    expect(
      label,
      "the name must come from a <label> a reader can see",
    ).not.toBeNull();
    expect(label!.className).not.toMatch(/\bsr-only\b/);
  });

  it("as a URL field, so phones offer the URL keyboard and autofill", async () => {
    await mountUrl();
    const field = screen.getByLabelText("Web address");
    expect(field.getAttribute("type")).toBe("url");
    expect(field.getAttribute("autocomplete")).toBe("url");
  });

  it("control: the HTML upload mode has no address field to name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
    );
    render(
      <InToolPage tool={htmlTool}>
        <HtmlRenderWorkerPanel tool={htmlTool} />
      </InToolPage>,
    );
    await screen.findByText("Secure server");
    expect(screen.queryByLabelText("Web address")).toBeNull();
  });
});

/*
 * Audit #33 (2026-11-06): the field starts with "https://" and only its
 * LENGTH was checked, so pasting a full link after the prefix, or typing a
 * bare domain, sent the job and came back as the API's developer message
 * ("`options.url` must be a public http(s) URL (no localhost, private, or
 * link-local hosts).") — blaming localhost for a typo. Enter did nothing.
 */
describe("HtmlRenderWorkerPanel — the address is fixed or explained before any job", () => {
  const urlTool = getToolBySlug("webpage-to-pdf")!;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function mountUrl() {
    fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => READY });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <InToolPage tool={urlTool}>
        <HtmlRenderWorkerPanel tool={urlTool} />
      </InToolPage>,
    );
    await screen.findByText("Secure server");
    return screen.getByLabelText<HTMLInputElement>("Web address");
  }

  /** The `options.url` of every job the panel created. */
  const sentUrls = () =>
    fetchMock.mock.calls
      .filter(([url]) => url === "/api/jobs")
      .map(
        ([, init]) =>
          (
            JSON.parse(
              new TextDecoder().decode(
                (init as RequestInit).body as ArrayBuffer,
              ),
            ) as {
              options: { url: string };
            }
          ).options.url,
      );

  const renderButton = () => screen.getByRole("button", { name: "Render PDF" });

  it("a full link pasted after the prefix is sent with one scheme", async () => {
    const field = await mountUrl();
    fireEvent.change(field, {
      target: { value: "https://https://example.com/page" },
    });
    expect(field.value).toBe("https://example.com/page");
    fireEvent.click(renderButton());
    await vi.waitFor(() =>
      expect(sentUrls()).toEqual(["https://example.com/page"]),
    );
  });

  it("a bare domain is sent as https://", async () => {
    const field = await mountUrl();
    fireEvent.change(field, { target: { value: "www.example.com" } });
    fireEvent.click(renderButton());
    await vi.waitFor(() =>
      expect(sentUrls()).toEqual(["https://www.example.com"]),
    );
  });

  it("an address our server cannot open is explained in plain words, and never sent", async () => {
    const field = await mountUrl();
    fireEvent.change(field, { target: { value: "http://localhost:3000/" } });
    expect(renderButton()).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByText(/not on the public internet/);
    expect(reason.textContent).not.toMatch(/`|options\.url/);
    fireEvent.submit(field.closest("form")!);
    // Control: the same field with a public address does start a job, so
    // the silence above is the refusal, not a panel that sends nothing.
    expect(sentUrls()).toEqual([]);
    fireEvent.change(field, { target: { value: "https://example.com" } });
    expect(renderButton()).not.toHaveAttribute("aria-disabled");
  });

  it("Enter in the field starts the render, and phones show a Go key", async () => {
    const field = await mountUrl();
    expect(field.getAttribute("enterkeyhint")).toBe("go");
    fireEvent.change(field, { target: { value: "https://example.com" } });
    const form = field.closest("form");
    expect(form, "the field must sit in a form for Enter to submit").not.toBe(
      null,
    );
    fireEvent.submit(form!);
    await vi.waitFor(() => expect(sentUrls()).toEqual(["https://example.com"]));
  });
});

/*
 * Audit webpage-to-pdf#1 (2026-11-06): cookie banners and pop-ups printed
 * over the page and nothing could hide them. The Webpage to PDF panel has a
 * Capture group whose checkboxes travel in the job's options — only when
 * changed, so an untouched panel sends the request it always sent.
 */
describe("HtmlRenderWorkerPanel — Webpage to PDF capture options", () => {
  const urlTool = getToolBySlug("webpage-to-pdf")!;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function mountUrl() {
    fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => READY });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <InToolPage tool={urlTool}>
        <HtmlRenderWorkerPanel tool={urlTool} />
      </InToolPage>,
    );
    await screen.findByText("Secure server");
    const field = screen.getByLabelText<HTMLInputElement>("Web address");
    fireEvent.change(field, { target: { value: "https://example.com/" } });
  }

  const sentOptions = () =>
    fetchMock.mock.calls
      .filter(([url]) => url === "/api/jobs")
      .map(
        ([, init]) =>
          (
            JSON.parse(
              new TextDecoder().decode(
                (init as RequestInit).body as ArrayBuffer,
              ),
            ) as { options: Record<string, unknown> }
          ).options,
      );

  const run = () =>
    fireEvent.click(screen.getByRole("button", { name: "Render PDF" }));

  it("an untouched Capture group sends nothing new", async () => {
    await mountUrl();
    run();
    await vi.waitFor(() =>
      expect(sentOptions()).toEqual([{ url: "https://example.com/" }]),
    );
  });

  it("each capture checkbox is named by its label alone, and its hint is its description", async () => {
    await mountUrl();
    expect(WEBPAGE_CAPTURE_CHOICES.length).toBeGreaterThan(0);
    for (const choice of WEBPAGE_CAPTURE_CHOICES) {
      const box = screen.getByRole("checkbox", { name: choice.label });
      expect(box).toHaveAccessibleName(choice.label);
      // The hint is read as a description, after the name, not as part of it.
      expect(box).toHaveAccessibleDescription(/\S{3,}/);
    }
  });

  it(`"${WEBPAGE_CAPTURE_LABELS.hideOverlays}" is a named checkbox, off, and travels when ticked`, async () => {
    await mountUrl();
    expect(
      screen.getByRole("group", { name: WEBPAGE_CAPTURE_GROUP_LABEL }),
    ).toBeTruthy();
    const box = screen.getByRole<HTMLInputElement>("checkbox", {
      name: WEBPAGE_CAPTURE_LABELS.hideOverlays,
    });
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    run();
    await vi.waitFor(() =>
      expect(sentOptions()).toEqual([
        { hideOverlays: true, url: "https://example.com/" },
      ]),
    );
  });

  it(`"${WEBPAGE_CAPTURE_LABELS.printStyles}" starts ticked, and unticking it sends printStyles: false (audit webpage-to-pdf#3)`, async () => {
    await mountUrl();
    const box = screen.getByRole<HTMLInputElement>("checkbox", {
      name: WEBPAGE_CAPTURE_LABELS.printStyles,
    });
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    run();
    await vi.waitFor(() =>
      expect(sentOptions()).toEqual([
        { printStyles: false, url: "https://example.com/" },
      ]),
    );
  });

  it(`"${WEBPAGE_CAPTURE_LABELS.stamp}" starts unticked, and ticking it sends stamp: true (audit webpage-to-pdf#7)`, async () => {
    await mountUrl();
    const box = screen.getByRole<HTMLInputElement>("checkbox", {
      name: WEBPAGE_CAPTURE_LABELS.stamp,
    });
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    run();
    await vi.waitFor(() =>
      expect(sentOptions()).toEqual([
        { stamp: true, url: "https://example.com/" },
      ]),
    );
  });

  it("control: HTML to PDF has no Capture group", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
    );
    render(
      <InToolPage tool={htmlTool}>
        <HtmlRenderWorkerPanel tool={htmlTool} />
      </InToolPage>,
    );
    await screen.findByText("Secure server");
    expect(
      screen.queryByRole("group", { name: WEBPAGE_CAPTURE_GROUP_LABEL }),
    ).toBeNull();
    expect(screen.getByRole("group", { name: "Page layout" })).toBeTruthy();
  });
});
