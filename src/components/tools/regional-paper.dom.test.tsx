// @vitest-environment jsdom
/**
 * The two server-rendered page-size panels start on the browser region's
 * paper (audit backlog #5, 2026-11-16), as a person receives them: Text to
 * PDF's chips and HTML / Webpage to PDF's Page size menu, read off the
 * rendered DOM, and the options the run actually sends.
 *
 * And the hydration seam. The server cannot read navigator.languages, so its
 * HTML shows the world paper (A4); a Letter browser must hydrate that HTML
 * with NO mismatch warning and then show Letter. That is checked by
 * rendering to a string on a "server" and hydrating it here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { getToolBySlug } from "@/lib/tools";
import { InToolPage } from "@/tests/in-tool-page";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { TEXT_PAGE_SIZES } from "@/lib/pdf/text-page-options";
import { HTML_PAGE_SIZES } from "@/lib/jobs/html-render-options";

import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { inflateSync } from "node:zlib";
import { TextToPdfRunner } from "./runner/text-to-pdf-runner";
import { HtmlRenderWorkerPanel } from "./html-render-worker-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  downloads.length = 0;
});

/*
 * What a person downloads, read back: no `vi.mock` of the engine (a mock
 * binds every module evaluated under it, and under `isolate: false` that
 * reaches other files — src/tests/mock-isolation.test.ts), so the PDF the
 * Download button hands the browser is captured at `URL.createObjectURL`.
 */
const downloads: Blob[] = [];
Object.assign(URL, {
  createObjectURL: (blob: Blob) => {
    downloads.push(blob);
    return "blob:captured";
  },
  revokeObjectURL: () => {},
});

/** The page box, orientation and body text size of a downloaded PDF. */
async function pageOf(blob: Blob) {
  const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  const page = doc.getPage(0);
  const { width, height } = page.getSize();
  const contents = page.node.Contents()!;
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((r) => doc.context.lookup(r))
      : [contents];
  const source = streams
    .map((st) => {
      const raw = st as PDFRawStream;
      return Buffer.from(
        raw.dict.get(PDFName.of("Filter"))
          ? inflateSync(raw.contents)
          : raw.contents,
      ).toString("latin1");
    })
    .join("\n");
  // Title, then the "n / N" footer, then the body: the third Tf is the body.
  const sizes = [...source.matchAll(/ ([\d.]+) Tf/g)].map((m) => Number(m[1]));
  return { width, height, fontSize: sizes[2] };
}

const sizeOf = (id: string) => TEXT_PAGE_SIZES.find((s) => s.id === id)!.size;

function speaks(...languages: string[]) {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(window.navigator, "language", "get").mockReturnValue(
    languages[0] ?? "",
  );
}

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};
const withRouter = (node: ReactNode) => (
  <AppRouterContext.Provider value={router as never}>
    {node}
  </AppRouterContext.Provider>
);

const label = (id: string) => TEXT_PAGE_SIZES.find((s) => s.id === id)!.label;
const pressedSize = () =>
  TEXT_PAGE_SIZES.map((s) => s.label).filter(
    (l) =>
      screen.getByRole("button", { name: l }).getAttribute("aria-pressed") ===
      "true",
  );

describe("Text to PDF starts on the regional paper", () => {
  it.each([
    [["en-GB"], "a4"],
    [["bn-BD", "en-US"], "a4"],
    [["en-US"], "letter"],
    [["fr-CA"], "letter"],
    [[], "a4"],
  ])(
    "%j -> %s, and the downloaded PDF is that paper",
    async (languages, paper) => {
      speaks(...languages);
      render(withRouter(<TextToPdfRunner />));
      expect(pressedSize()).toEqual([label(paper)]);
      fireEvent.change(screen.getByPlaceholderText(/Paste or type/), {
        target: { value: "hello" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Create PDF/ }));
      await screen.findByText("PDF created");
      fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
      expect(downloads).toHaveLength(1);
      expect(await pageOf(downloads[0]!)).toEqual({
        ...sizeOf(paper),
        fontSize: 11,
      });
    },
  );

  it("a pressed size, orientation and text size are what is downloaded", async () => {
    speaks("en-GB");
    render(withRouter(<TextToPdfRunner />));
    fireEvent.click(screen.getByRole("button", { name: label("legal") }));
    fireEvent.click(screen.getByRole("button", { name: "Landscape" }));
    fireEvent.click(screen.getByRole("button", { name: "14 pt" }));
    expect(pressedSize()).toEqual([label("legal")]);
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create PDF/ }));
    await screen.findByText("PDF created");
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    const legal = sizeOf("legal");
    expect(await pageOf(downloads[0]!)).toEqual({
      width: legal.height,
      height: legal.width,
      fontSize: 14,
    });
  });
});

describe("Text to PDF's batch gets the same page", () => {
  it("two files: the chips show in the batch, and every file is the pressed page", async () => {
    speaks("en-US");
    const { container } = render(withRouter(<TextToPdfRunner />));
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["first"], "one.txt", { type: "text/plain" }),
          new File(["second"], "two.txt", { type: "text/plain" }),
        ],
      },
    });
    const run = await screen.findByRole(
      "button",
      { name: "Convert 2 text files" },
      { timeout: 10_000 },
    );
    expect(pressedSize()).toEqual([label("letter")]);
    fireEvent.click(screen.getByRole("button", { name: "Landscape" }));
    fireEvent.click(screen.getByRole("button", { name: "9 pt" }));
    fireEvent.click(run);
    const letter = sizeOf("letter");
    for (const name of ["one-pdf.pdf", "two-pdf.pdf"]) {
      const button = await screen.findByRole(
        "button",
        { name: `Download ${name}` },
        { timeout: 15_000 },
      );
      fireEvent.click(button);
    }
    expect(downloads).toHaveLength(2);
    for (const blob of downloads)
      expect(await pageOf(blob)).toEqual({
        width: letter.height,
        height: letter.width,
        fontSize: 9,
      });
  }, 30_000);
});

/**
 * Server HTML (world paper), then hydration in a Letter browser: no
 * mismatch report, and the chip moves to Letter. React reports a mismatch
 * through console.error and onRecoverableError; both are watched.
 */
async function hydrateAs(node: ReactNode, languages: string[]) {
  // The server's render: no languages to read (jsdom's own are en-US).
  speaks();
  const html = renderToString(node);
  speaks(...languages);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const errors: string[] = [];
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation((...args) => errors.push(args.map(String).join(" ")));
  const recoverable: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, node, {
      onRecoverableError: (e) => recoverable.push(e),
    });
  });
  consoleError.mockRestore();
  return {
    html,
    container,
    errors,
    recoverable,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("hydration: the server's A4 becomes Letter with no mismatch", () => {
  it("Text to PDF", async () => {
    const node = withRouter(<TextToPdfRunner />);
    const h = await hydrateAs(node, ["en-US"]);
    try {
      // The server pressed A4: it cannot know the browser.
      const server = document.createElement("div");
      server.innerHTML = h.html;
      const serverPressed = within(server)
        .getAllByRole("button", { pressed: true })
        .map((b) => b.textContent);
      expect(serverPressed).toContain(label("a4"));
      expect(h.recoverable).toEqual([]);
      expect(h.errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual(
        [],
      );
      const pressed = within(h.container)
        .getAllByRole("button", { pressed: true })
        .map((b) => b.textContent);
      expect(pressed).toContain(label("letter"));
      expect(pressed).not.toContain(label("a4"));
    } finally {
      h.unmount();
    }
  });

  it("CONTROL: a lazy useState read of navigator WOULD mismatch", async () => {
    // The detector must be able to see a mismatch, or its silence above
    // proves nothing: a component that reads navigator during render.
    function Naive() {
      const paper =
        typeof navigator !== "undefined" && navigator.languages?.[0] === "en-US"
          ? "letter"
          : "a4";
      return <p>{paper}</p>;
    }
    const h = await hydrateAs(<Naive />, ["en-US"]);
    try {
      expect(
        h.recoverable.length +
          h.errors.filter((e) => /hydrat|did not match/i.test(e)).length,
      ).toBeGreaterThan(0);
    } finally {
      h.unmount();
    }
  });
});

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

describe("Webpage to PDF starts on the regional paper", () => {
  const tool = getToolBySlug("webpage-to-pdf")!;
  let fetchMock: ReturnType<typeof vi.fn>;
  async function mount() {
    fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => READY });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <InToolPage tool={tool}>
        <HtmlRenderWorkerPanel tool={tool} />
      </InToolPage>,
    );
    await screen.findByText("Secure server");
    fireEvent.change(screen.getByLabelText("Web address"), {
      target: { value: "https://example.com/" },
    });
  }
  const pageSize = () =>
    screen.getByLabelText<HTMLSelectElement>("Page size").value;
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

  it.each([
    [["en-GB"], "A4"],
    [["de-DE"], "A4"],
    [["en-US"], "Letter"],
    [["es-MX"], "Letter"],
  ])("%j -> %s, and it is sent", async (languages, size) => {
    speaks(...languages);
    await mount();
    expect(pageSize()).toBe(size);
    run();
    await vi.waitFor(() =>
      expect(sentOptions()).toEqual([
        { pageSize: size, url: "https://example.com/" },
      ]),
    );
  });

  it("changing another field keeps the regional paper; “As the page sets it” sends no size", async () => {
    speaks("en-GB");
    await mount();
    fireEvent.change(screen.getByLabelText("Orientation"), {
      target: { value: "landscape" },
    });
    expect(pageSize()).toBe("A4");
    const auto = HTML_PAGE_SIZES.find((s) => s.inches === null)!;
    fireEvent.change(screen.getByLabelText("Page size"), {
      target: { value: auto.id },
    });
    expect(pageSize()).toBe(auto.id);
    run();
    await vi.waitFor(() =>
      expect(sentOptions()).toEqual([
        { orientation: "landscape", url: "https://example.com/" },
      ]),
    );
  });
});
