// @vitest-environment jsdom
/**
 * HTML to PDF's two new inputs, driven through the panel the way a user
 * drives them (competitor audit #26):
 *
 *   - THE PASTE BOX: labelled, described, bounded by the page's own HTML
 *     ceiling in UTF-8 bytes (byte-order mark included), counted when near
 *     it, marked invalid past it with the error tied to the box — and what
 *     is pasted goes up as a file, `pasted.html`, by the same request a
 *     chosen file makes.
 *   - THE ZIP: offered ONLY when the live status says the running worker
 *     prints one (`htmlZip`). Without it a .zip is refused at the pick, as
 *     before; with it the page lists the archive's pages, asks for one when
 *     several are equal candidates, names what the archive is missing, and
 *     uploads the ZIP declared as one, with the chosen page as `entry`.
 */
import JSZip from "jszip";
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
import { toolRunInfoFor } from "@/lib/tools/tool-run-info";
import { formatBytes } from "@/lib/utils";
import { HtmlRenderWorkerPanel } from "./html-render-worker-panel";
import { COUNT_FROM } from "./html-paste-box";
import { getToolContent } from "@/lib/tools/content";
import { HTML_ZIP_PAGE_CHOICE_SENTENCES } from "@/lib/workers/html-render/zip-config";

const tool = getToolBySlug("html-to-pdf")!;
const CEILING = toolRunInfoFor(tool).pick!.ceilingBytes!;
const providers = getProviderReadiness("remote-configured");

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

interface Sent {
  url: string;
  body: Record<string, unknown> | null;
}

/** Render the panel against `status`; record every request; refuse the upload. */
async function mount(status: WorkerStatus) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body =
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : init?.body instanceof ArrayBuffer
            ? JSON.parse(new TextDecoder().decode(init.body))
            : null;
      sent.push({ url: String(url), body });
      if (String(url).includes("/api/worker/status"))
        return { ok: true, status: 200, json: async () => status };
      // The upload is answered with a refusal: the test reads what was
      // DECLARED, and the run stops there.
      return {
        ok: false,
        status: 503,
        json: async () => ({
          error: { code: "service_unavailable", message: "stop here" },
        }),
      };
    }),
  );
  render(
    <InToolPage tool={tool}>
      <HtmlRenderWorkerPanel tool={tool} />
    </InToolPage>,
  );
  await screen.findByText("Secure server");
  const input = await waitFor(() => {
    const found =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(found).not.toBeNull();
    return found!;
  });
  return { sent, input };
}

const renderButton = () => screen.getByRole("button", { name: "Render PDF" });
const isDisabled = (el: HTMLElement) =>
  el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";

async function zipFile(files: Record<string, string>, name = "site.zip") {
  const zip = new JSZip();
  for (const [path, body] of Object.entries(files)) zip.file(path, body);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new File([bytes as BlobPart], name, { type: "application/zip" });
}

describe("ZIP is offered only when the running worker prints one", () => {
  it("an OLD worker (no htmlZip): the picker takes HTML only, and a .zip is refused at the pick", async () => {
    const { input, sent } = await mount(READY);
    expect(input.accept).not.toMatch(/zip/);
    fireEvent.change(input, {
      target: { files: [await zipFile({ "index.html": "<p>x</p>" })] },
    });
    expect(
      await screen.findByText(/isn't a file HTML to PDF takes/),
    ).toBeTruthy();
    expect(screen.queryByText("site.zip")).toBeNull();
    expect(sent.some((s) => s.url === "/api/uploads")).toBe(false);
  });

  it("a NEW worker: the picker takes a ZIP, and says so", async () => {
    const { input } = await mount({ ...READY, htmlZip: true });
    expect(input.accept).toMatch(/\.zip/);
    expect(
      screen.getByText("HTML, or a ZIP of a page and its files"),
    ).toBeTruthy();
  });
});

describe("a ZIP of a page", () => {
  it("prints index.html on its own, names what the archive lacks, and uploads it declared as a ZIP with its page", async () => {
    const { input, sent } = await mount({ ...READY, htmlZip: true });
    fireEvent.change(input, {
      target: {
        files: [
          await zipFile({
            "site/index.html":
              '<link rel="stylesheet" href="css/a.css"><img src="img/here.png"><img src="img/gone.png">',
            "site/css/a.css": "body{background:url(../img/also-gone.png)}",
            "site/img/here.png": "png",
          }),
        ],
      },
    });
    await screen.findByText("site.zip");
    const note = await screen.findByText(
      /not in this ZIP/,
      {},
      { timeout: 5000 },
    );
    expect(note.textContent).toContain("2 linked files (e.g. img/gone.png)");
    await waitFor(() => expect(isDisabled(renderButton())).toBe(false));
    await act(async () => {
      fireEvent.click(renderButton());
    });
    const upload = await waitFor(() => {
      const found = sent.find((s) => s.url === "/api/uploads");
      expect(found).toBeTruthy();
      return found!;
    });
    expect(upload.body).toMatchObject({
      tool: "html-to-pdf",
      files: [{ filename: "site.zip", contentType: "application/zip" }],
    });
  });

  it("asks which page when several are equal candidates, and holds Run until one is chosen", async () => {
    const { input } = await mount({ ...READY, htmlZip: true });
    fireEvent.change(input, {
      target: {
        files: [await zipFile({ "a.html": "<p>a</p>", "b.html": "<p>b</p>" })],
      },
    });
    const picker = await screen.findByLabelText<HTMLSelectElement>(
      "Page to print",
      {},
      { timeout: 5000 },
    );
    expect(picker.value).toBe("");
    expect(Array.from(picker.options).map((o) => o.value)).toEqual([
      "",
      "a.html",
      "b.html",
    ]);
    expect(isDisabled(renderButton())).toBe(true);
    // Found, not got: the words arrive through the panel's state after the
    // picker renders, a chain a loaded runner can stretch (it failed once
    // beside a build, 2026-11-14).
    expect(
      await screen.findByText(
        "Choose which page of the ZIP to print.",
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    fireEvent.change(picker, { target: { value: "b.html" } });
    await waitFor(() => expect(isDisabled(renderButton())).toBe(false));
  });

  it("does what the copy says: several pages, one decided, list shown with it selected and Run free", async () => {
    // The copy (one definition, read by the FAQ and the guide).
    expect(HTML_ZIP_PAGE_CHOICE_SENTENCES).toContain(
      "list shows them all with that page already selected",
    );
    expect(
      getToolContent("html-to-pdf")!
        .faqs.map((f) => f.a)
        .join(" "),
    ).toContain(HTML_ZIP_PAGE_CHOICE_SENTENCES);
    const { input } = await mount({ ...READY, htmlZip: true });
    fireEvent.change(input, {
      target: {
        files: [
          await zipFile({ "index.html": "<p>i</p>", "about.html": "<p>a</p>" }),
        ],
      },
    });
    const picker = await screen.findByLabelText<HTMLSelectElement>(
      "Page to print",
      {},
      { timeout: 5000 },
    );
    expect(picker.value).toBe("index.html");
    await waitFor(() => expect(isDisabled(renderButton())).toBe(false));
  });

  it("names a picture missing from a stylesheet the linked one @imports", async () => {
    const { input } = await mount({ ...READY, htmlZip: true });
    fireEvent.change(input, {
      target: {
        files: [
          await zipFile({
            "index.html": '<link rel="stylesheet" href="css/a.css"><p>i</p>',
            "css/a.css": "@import url(b.css); p{color:red}",
            "css/b.css": ".x{background:url(../img/missing.png)}",
          }),
        ],
      },
    });
    const note = await screen.findByText(
      /not in this ZIP/,
      {},
      { timeout: 5000 },
    );
    expect(note.textContent).toContain("1 linked file (../img/missing.png)");
  });

  it("refuses an archive with no page before anything is uploaded, in the worker's words", async () => {
    const { input, sent } = await mount({ ...READY, htmlZip: true });
    fireEvent.change(input, {
      target: { files: [await zipFile({ "a.css": "a{}" })] },
    });
    expect(
      await screen.findByText(
        /holds no \.html or \.htm file/,
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(isDisabled(renderButton())).toBe(true);
    expect(sent.some((s) => s.url === "/api/uploads")).toBe(false);
  });
});

describe("the paste box", () => {
  async function openPaste(status: WorkerStatus = READY) {
    const mounted = await mount(status);
    fireEvent.click(screen.getByRole("button", { name: "Or paste HTML code" }));
    const box = await screen.findByLabelText<HTMLTextAreaElement>("HTML code");
    return { ...mounted, box };
  }

  it("is a labelled, described text box, opened by a real button that says it is open", async () => {
    const { box } = await openPaste();
    const toggle = screen.getByRole("button", {
      name: "Choose a file instead",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.className).toMatch(/\btap-y\b/);
    const hint = document.getElementById(
      box.getAttribute("aria-describedby")!.split(" ")[0]!,
    );
    expect(hint?.textContent).toMatch(
      /uploaded to our server as a file named pasted\.html/,
    );
    expect(hint?.textContent).toMatch(/deleted when the job finishes/);
    expect(hint?.textContent).toContain(formatBytes(CEILING));
  });

  it("uploads what was pasted as pasted.html, its size the BOM plus its UTF-8", async () => {
    const { box, sent } = await openPaste();
    const html = "<p>বাংলা \u{1F600}</p>";
    fireEvent.change(box, { target: { value: html } });
    await waitFor(() => expect(isDisabled(renderButton())).toBe(false));
    await act(async () => {
      fireEvent.click(renderButton());
    });
    const upload = await waitFor(() => {
      const found = sent.find((s) => s.url === "/api/uploads");
      expect(found).toBeTruthy();
      return found!;
    });
    expect(upload.body).toMatchObject({
      tool: "html-to-pdf",
      files: [
        {
          filename: "pasted.html",
          contentType: "text/html",
          bytes: 3 + new TextEncoder().encode(html).byteLength,
        },
      ],
    });
  });

  it("counts near the ceiling, and past it is invalid, says why, and holds Run", async () => {
    const { box } = await openPaste();
    // Each Bengali letter is three bytes: under the count, then near, then over.
    const letters = (bytes: number) => "ক".repeat(Math.floor(bytes / 3));
    fireEvent.change(box, { target: { value: letters(CEILING * 0.5) } });
    expect(
      screen.queryByText(new RegExp(`of ${formatBytes(CEILING)}`)),
    ).toBeNull();

    fireEvent.change(box, {
      target: { value: letters(CEILING * (COUNT_FROM + 0.05)) },
    });
    expect(
      screen.getByText(new RegExp(`of ${formatBytes(CEILING)}$`)),
    ).toBeTruthy();
    expect(box.getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(box, { target: { value: letters(CEILING) + "ক" } });
    expect(box.getAttribute("aria-invalid")).toBe("true");
    const error = screen.getByRole("alert");
    expect(error.textContent).toMatch(
      /over the .* HTML to PDF takes in one run/,
    );
    expect(box.getAttribute("aria-describedby")!.split(" ")).toContain(
      error.id,
    );
    expect(isDisabled(renderButton())).toBe(true);
  }, 30_000);

  it("keeps keyboard focus: opening moves it into the box, closing leaves it on the same button (WCAG 2.4.3)", async () => {
    await mount(READY);
    const open = screen.getByRole("button", { name: "Or paste HTML code" });
    open.focus();
    // Health: focus really is on the button before it is pressed.
    expect(document.activeElement).toBe(open);
    fireEvent.click(open);
    const box = await screen.findByLabelText<HTMLTextAreaElement>("HTML code");
    await waitFor(() => expect(document.activeElement).toBe(box));
    const close = screen.getByRole("button", { name: "Choose a file instead" });
    // The same element, relabelled: never unmounted and mounted again.
    expect(close).toBe(open);
    close.focus();
    fireEvent.click(close);
    await screen.findByRole("button", { name: "Or paste HTML code" });
    expect(document.activeElement).toBe(close);
    expect(close.isConnected).toBe(true);
  });

  it("closing the box drops what it handed on", async () => {
    const { box } = await openPaste();
    fireEvent.change(box, { target: { value: "<p>x</p>" } });
    await waitFor(() => expect(isDisabled(renderButton())).toBe(false));
    fireEvent.click(
      screen.getByRole("button", { name: "Choose a file instead" }),
    );
    await waitFor(() => expect(isDisabled(renderButton())).toBe(true));
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });
});
