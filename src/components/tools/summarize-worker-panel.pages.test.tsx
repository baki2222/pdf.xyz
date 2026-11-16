// @vitest-environment jsdom
// @native-canvas
/**
 * Summarize PDF's "Part to summarize" (competitor audit summarize-pdf#5),
 * driven through the REAL panel and the real browser job client over a
 * recording network.
 *
 * What is pinned, each against the wire (the `POST /api/jobs` body):
 *  - without `summarizePages` on the status nothing new renders, no outline
 *    is read, and no `pages` key is sent — today's behaviour, byte for byte;
 *  - with it, typed pages and a bookmarked section each post canonical
 *    spans, and `declaredCharacters` is the CHOSEN pages' text (on a
 *    document whose pages differ in length, so whole ≠ selected);
 *  - a page past the end is refused before upload, with no upload;
 *  - ONE parse per Run, for whole, pages and section alike;
 *  - the result names the pages from the worker's record, or — when this
 *    run sent pages and the result does not confirm exactly those — shows
 *    the rollback warning INSTEAD;
 *  - a file swap resets the choice and drops a late outline result;
 *  - the worker's two page refusals, rendered by the panel, never say that
 *    nothing was charged (the route reserved the allowance first).
 *
 * The extractor is swapped through `summarizeRunDeps` (pdfjs cannot run in
 * the test DOM; `vi.mock` would leak across files under `isolate: false`).
 * The outline is read by the REAL `summary-sections` module from a real
 * pdf-lib PDF, so the section path is the shipped one.
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { selectExtraction } from "@/lib/pdf/page-selection";
import type { WorkerStatus } from "@/lib/workers/status";
import type { AiWindowMeta } from "@/lib/jobs/ai-results";
import type { Job } from "@/lib/jobs/types";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";
import { NO_TEXT_IN_CHOSEN_PAGES_MESSAGE } from "@/lib/jobs/chosen-pages-no-text";
import {
  SUMMARIZE_PAGES_NOT_RUNNING_MESSAGE,
  SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE,
  pagesOutOfRangeMessage,
} from "@/lib/jobs/summarize-pages";
import { summarizeRunDeps } from "@/lib/workers/summarize-client";
import { StandardFonts } from "pdf-lib";
import { addOutline, blankPages, fitDest } from "@/tests/bookmark-fixtures";
import {
  SelectionNotice,
  SummarizeWorkerPanel,
} from "./summarize-worker-panel";

/** Non-ASCII built from code points (house rule). */
const EN = String.fromCharCode(0x2013);
const ELL = String.fromCharCode(0x2026);

const tool = getToolBySlug("summarize-pdf")!;
const providers = getProviderReadiness("remote-configured");
const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A server backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: true, detail: "scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
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
const OFFERED: WorkerStatus = { ...READY, summarizePages: true };

/** Four pages of DIFFERENT lengths, so a selection's count ≠ the whole's. */
const PAGE_TEXT = [
  "Alpha opens the report.",
  "Beta has a much longer second page with many more words on it.",
  "Gamma.",
  "Delta closes the report with a medium sentence.",
];
function fourPages(): ExtractedPdfText {
  const pages = PAGE_TEXT.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const text = PAGE_TEXT.join("\n\n");
  return {
    pageCount: 4,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}
const selected = (spans: [number, number][]) =>
  selectExtraction(fourPages(), spans).characterCount;

let parses = 0;
const realRead = summarizeRunDeps.read;
function stubRead(extracted: () => ExtractedPdfText = fourPages) {
  parses = 0;
  summarizeRunDeps.read = async () => {
    parses += 1;
    return { extracted: extracted(), select: selectExtraction };
  };
}

/** A real 4-page PDF whose outline has sections on pages 1 and 3. */
async function outlinedPdf(): Promise<Uint8Array> {
  const doc = await blankPages(4);
  // Text on every page, so the job client's own no-text check (a real
  // pdfjs read in `runSecurityJob`) lets the run through.
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .getPages()
    .forEach((page, i) =>
      page.drawText(PAGE_TEXT[i]!, { x: 20, y: 100, size: 10, font }),
    );
  addOutline(doc, [
    { title: "Opening", dest: fitDest(doc, 0) },
    { title: "Findings", dest: fitDest(doc, 2) },
  ]);
  return doc.save();
}

/** A File that counts how often its bytes are read (outline + Run). */
class CountingFile extends File {
  reads = 0;
  override arrayBuffer(): Promise<ArrayBuffer> {
    this.reads += 1;
    return super.arrayBuffer();
  }
}

interface Net {
  urls: string[];
  bodies: Record<string, unknown>[];
}

/** Record every request; answer the job with `job` (completed or failed). */
function network(status: WorkerStatus, job: Partial<Job>): Net {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url === "/api/worker/status") return json(status);
      if (url === "/api/uploads")
        return json({
          slots: [
            { fileId: "f1", url: "/upload/f1", method: "PUT", headers: {} },
          ],
        });
      if (url === "/upload/f1") return json({});
      if (url === "/api/jobs") {
        // The client sends the body as an ArrayBuffer of UTF-8 JSON.
        const raw = init?.body;
        const text =
          typeof raw === "string"
            ? raw
            : new TextDecoder().decode(raw as ArrayBuffer);
        bodies.push(JSON.parse(text) as Record<string, unknown>);
        return json({ jobId: "job_pages1", ...job });
      }
      if (url === "/dl/summary.zip") return json({});
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return { urls, bodies };
}

const FAILED: Partial<Job> = {
  status: "failed",
  error: { code: "x", message: "stubbed server", retryable: false },
};

function completed(truncation?: Partial<AiWindowMeta>): Partial<Job> {
  return {
    status: "completed",
    progress: 100,
    artifacts: [
      {
        artifactId: "a1",
        filename: "doc-summary.zip",
        contentType: "application/zip",
        bytes: 10,
        url: "/dl/summary.zip",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    ],
    ...(truncation
      ? {
          results: {
            ai: {
              truncation: {
                truncated: false,
                charactersSent: 100,
                charactersTotal: 100,
                totalPages: 4,
                lastCompletePage: 4,
                cutMidPage: false,
                ...truncation,
              } as AiWindowMeta,
            },
          },
        }
      : {}),
  } as Partial<Job>;
}

async function mount(bytes: Uint8Array = new Uint8Array([0x25, 0x50])) {
  render(
    <InToolPage tool={tool}>
      <SummarizeWorkerPanel tool={tool} />
    </InToolPage>,
  );
  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    if (!found) throw new Error("no input");
    return found;
  });
  const file = new CountingFile([bytes as BlobPart], "doc.pdf", {
    type: "application/pdf",
  });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

/** Wait until the status answered (Run is enabled). */
async function ready() {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /summarize pdf/i }),
    ).not.toBeDisabled(),
  );
}

/** The one job body this Run posted; fails naming the alert if none. */
async function posted(net: Net): Promise<Record<string, unknown>> {
  await waitFor(() => {
    if (net.bodies.length > 0) return;
    const alert = screen.queryByRole("alert");
    throw new Error(`no job posted; alert: ${alert?.textContent ?? "none"}`);
  });
  expect(net.bodies).toHaveLength(1);
  return net.bodies[0]!;
}

function press() {
  fireEvent.click(screen.getByRole("button", { name: /summarize pdf/i }));
}

function choose(value: string) {
  fireEvent.change(screen.getByLabelText("Part to summarize"), {
    target: { value },
  });
}

afterEach(() => {
  summarizeRunDeps.read = realRead;
  resetTelemetry();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Summarize panel: the page choice exists only on the worker's proof", () => {
  it("status without summarizePages: no control, no outline read, no pages key", async () => {
    stubRead();
    const net = network(READY, FAILED);
    const file = await mount(await outlinedPdf());
    await ready();
    expect(screen.queryByLabelText("Part to summarize")).toBeNull();
    press();
    const body = await posted(net);
    const options = body.options as Record<string, unknown>;
    expect(Object.keys(options)).not.toContain("pages");
    // The whole document's count, exactly as before.
    expect(body.declaredCharacters).toBe(fourPages().characterCount);
    // The bytes were read once, by Run: the outline was never loaded.
    expect(file.reads).toBe(1);
    expect(parses).toBe(1);
  });
});

describe("Summarize panel: chosen pages reach the wire", () => {
  it("typed pages post canonical spans and the CHOSEN pages' count", async () => {
    stubRead();
    const net = network(OFFERED, FAILED);
    await mount();
    await ready();
    choose("pages");
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "2-3" },
    });
    press();
    const body = await posted(net);
    expect(body.options).toMatchObject({ pages: [[2, 3]] });
    // Health: the selection really is smaller than the whole document.
    expect(selected([[2, 3]])).toBeLessThan(fourPages().characterCount);
    expect(body.declaredCharacters).toBe(selected([[2, 3]]));
    expect(parses).toBe(1);
  });

  it("every page typed is sent as the whole document: no pages key, the whole count", async () => {
    stubRead();
    const net = network(OFFERED, FAILED);
    await mount();
    await ready();
    choose("pages");
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "1-4" },
    });
    press();
    const body = await posted(net);
    expect(Object.keys(body.options as object)).not.toContain("pages");
    expect(body.declaredCharacters).toBe(fourPages().characterCount);
  });

  it("a bookmarked section posts its span, read from the real outline", async () => {
    stubRead();
    const net = network(OFFERED, FAILED);
    await mount(await outlinedPdf());
    await ready();
    const option = await screen.findByRole("option", {
      name: `Findings (pages 3${EN}4)`,
    });
    expect(
      screen.getByRole("option", { name: `Opening (pages 1${EN}2)` }),
    ).toBeInTheDocument();
    choose((option as HTMLOptionElement).value);
    press();
    const body = await posted(net);
    expect(body.options).toMatchObject({ pages: [[3, 4]] });
    expect(body.declaredCharacters).toBe(selected([[3, 4]]));
    expect(parses).toBe(1);
  });

  it("a page past the end is refused before upload", async () => {
    stubRead();
    const net = network(OFFERED, FAILED);
    await mount();
    await ready();
    choose("pages");
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "9" },
    });
    press();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/This PDF has 4 pages/);
    expect(alert).toHaveTextContent(/Nothing was uploaded\.$/);
    expect(net.urls).not.toContain("/api/uploads");
    expect(net.urls).not.toContain("/api/jobs");
    expect(parses).toBe(1);
  });

  it("chosen pages with no text are refused before upload, in the worker's words", async () => {
    stubRead(() => {
      const doc = fourPages();
      const pages = doc.pages.map((p) =>
        p.pageNumber === 3 ? { ...p, text: "", characterCount: 0 } : p,
      );
      return { ...doc, pages };
    });
    const net = network(OFFERED, FAILED);
    await mount();
    await ready();
    choose("pages");
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "3" },
    });
    press();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `${NO_TEXT_IN_CHOSEN_PAGES_MESSAGE["summarize-pdf"]} Nothing was uploaded.`,
    );
    expect(net.urls).not.toContain("/api/uploads");
  });

  it("over 20 separate ranges is refused before upload", async () => {
    stubRead(() => {
      const pages = Array.from({ length: 50 }, (_, i) => ({
        pageNumber: i + 1,
        text: `page ${i + 1}`,
        characterCount: `page ${i + 1}`.length,
      }));
      const text = pages.map((p) => p.text).join("\n\n");
      return {
        pageCount: 50,
        pages,
        text,
        characterCount: text.length,
        hasText: true,
      };
    });
    const net = network(OFFERED, FAILED);
    await mount();
    await ready();
    choose("pages");
    const odd = Array.from({ length: 21 }, (_, i) => `${2 * i + 1}`).join(",");
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: odd },
    });
    press();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose at most 20 separate page ranges. Nothing was uploaded.",
    );
    expect(net.urls).not.toContain("/api/uploads");
  });
});

describe("Summarize panel: the result names the pages, or warns", () => {
  async function runPages(job: Partial<Job>) {
    stubRead();
    network(OFFERED, job);
    await mount();
    await ready();
    choose("pages");
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "3-4" },
    });
    press();
    await screen.findByText(/summary package is ready/i);
  }

  it("a result that echoes the chosen pages shows the selection sentence, and no warning", async () => {
    await runPages(completed({ pagesSent: [[3, 4]] }));
    expect(
      screen.getByText(
        `This summary covers pages 3${EN}4 of 4, the pages you chose.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE)).toBeNull();
  });

  it("pages sent and NO pagesSent in the result: the rollback warning", async () => {
    await runPages(completed({}));
    expect(
      screen.getByText(SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE),
    ).toBeInTheDocument();
  });

  it("an echo naming OTHER pages warns, and is never shown as a sentence", async () => {
    await runPages(completed({ pagesSent: [[1, 1]] }));
    expect(
      screen.getByText(SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE),
    ).toBeInTheDocument();
    expect(screen.queryByText(/This summary covers/)).toBeNull();
  });

  it("a whole-document run with no pagesSent shows neither", async () => {
    stubRead();
    network(OFFERED, completed({}));
    await mount();
    await ready();
    press();
    await screen.findByText(/summary package is ready/i);
    expect(screen.queryByText(SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE)).toBeNull();
    expect(screen.queryByText(/This summary covers/)).toBeNull();
  });

  it("a resumed job (nothing known to have been sent) gets no warning", () => {
    render(<SelectionNotice job={completed({}) as Job} sent={null} />);
    expect(screen.queryByText(SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE)).toBeNull();
    // ...and the same record after sending pages DOES warn (the control).
    render(<SelectionNotice job={completed({}) as Job} sent={[[3, 4]]} />);
    expect(
      screen.getByText(SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE),
    ).toBeInTheDocument();
  });
});

/**
 * How long the swap test waits for the first file's late outline. The
 * POSITIVE CONTROL below shows an unswapped held file's outline DOES arrive
 * inside this window, so the swap test's absence is not a race it won by
 * looking too early.
 */
const LATE_WINDOW_MS = 600;

describe("Summarize panel: a file swap starts over", () => {
  it("POSITIVE CONTROL: a held outline read, not swapped, arrives inside the window", async () => {
    stubRead();
    network(OFFERED, FAILED);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class SlowFile extends File {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        await gate;
        return super.arrayBuffer();
      }
    }
    render(
      <InToolPage tool={tool}>
        <SummarizeWorkerPanel tool={tool} />
      </InToolPage>,
    );
    const input = await waitFor(() => {
      const found = document.querySelector('input[type="file"]');
      if (!found) throw new Error("no input");
      return found;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new SlowFile([(await outlinedPdf()) as BlobPart], "first.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    await ready();
    expect(screen.queryByRole("option", { name: /Findings/ })).toBeNull();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, LATE_WINDOW_MS));
    });
    expect(
      screen.getByRole("option", { name: `Findings (pages 3${EN}4)` }),
    ).toBeInTheDocument();
  });

  it("resets the choice to the whole document and drops a late outline result", async () => {
    stubRead();
    network(OFFERED, FAILED);
    // The first file's outline read is held until after the swap.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class SlowFile extends File {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        await gate;
        return super.arrayBuffer();
      }
    }
    render(
      <InToolPage tool={tool}>
        <SummarizeWorkerPanel tool={tool} />
      </InToolPage>,
    );
    const input = await waitFor(() => {
      const found = document.querySelector('input[type="file"]');
      if (!found) throw new Error("no input");
      return found;
    });
    const outlined = await outlinedPdf();
    fireEvent.change(input, {
      target: {
        files: [
          new SlowFile([outlined as BlobPart], "first.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    await ready();
    choose("pages");
    expect(screen.getByLabelText("Pages")).toBeInTheDocument();
    // Swap to a PDF with no outline (through the Remove + add path).
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const again = await waitFor(() => {
      const found = document.querySelector('input[type="file"]');
      if (!found) throw new Error("no input");
      return found;
    });
    fireEvent.change(again, {
      target: {
        files: [
          new File(
            [(await (await blankPages(4)).save()) as BlobPart],
            "second.pdf",
            { type: "application/pdf" },
          ),
        ],
      },
    });
    // The choice is back on the whole document.
    expect(
      (screen.getByLabelText("Part to summarize") as HTMLSelectElement).value,
    ).toBe("whole");
    expect(screen.queryByLabelText("Pages")).toBeNull();
    // Now the first file's outline arrives: it must not appear.
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, LATE_WINDOW_MS));
    });
    expect(screen.queryByRole("option", { name: /Findings/ })).toBeNull();
    expect(
      within(screen.getByLabelText("Part to summarize"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Whole document", `Pages${ELL}`]);
  });
});

describe("Summarize panel: the worker's page refusals never claim nothing was charged", () => {
  const CHARGE_CLAIM =
    /nothing (was )?charged|not (been )?charged|did not count|free of charge/i;

  it("POSITIVE CONTROL: the route's admission message does match (the regex is not blind)", () => {
    expect(SUMMARIZE_PAGES_NOT_RUNNING_MESSAGE).toMatch(CHARGE_CLAIM);
  });

  it.each([
    [
      "pages_out_of_range",
      "unprocessable_entity",
      pagesOutOfRangeMessage(5, [6, 6]),
    ],
    [
      "no text in the chosen pages",
      "no_text",
      NO_TEXT_IN_CHOSEN_PAGES_MESSAGE["summarize-pdf"],
    ],
  ])("%s, rendered by the panel", async (_name, code, message) => {
    stubRead();
    network(OFFERED, {
      status: "failed",
      error: { code, message, retryable: false },
    });
    await mount();
    await ready();
    choose("pages");
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "3" },
    });
    press();
    const alert = await screen.findByRole("alert");
    // Health: the panel rendered the worker's own sentence.
    expect(alert).toHaveTextContent(message);
    expect(document.body.textContent ?? "").not.toMatch(CHARGE_CLAIM);
  });
});
