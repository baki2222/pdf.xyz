// @vitest-environment jsdom
/**
 * The Translate panel, rendered: what it SHOWS when a run fails before the
 * job exists, and how long it waits for a job it did create.
 *
 * Two branches wrote this file separately (merged 2026-09-28); both halves
 * are kept whole below.
 *
 * PART 1 — A LOCAL PARSE FAILURE IS NOT A LOST CONNECTION.
 *
 * The panel parses the PDF locally inside the same `try` as the network job,
 * and its one catch used to call every throw "Lost the connection before the
 * job finished. Check your network and try again." A password-protected bank
 * statement, a damaged file, or a .docx dropped by mistake never touches the
 * network, yet each was sent to check it.
 *
 * `text-load-errors.test.ts` proves the units: the real `extractPdfText`
 * throws the typed error, and `translateFailureMessage` maps it. Neither can
 * see the line that decides what the reader gets, the panel's own catch. With
 * that catch reverted to the fixed sentence, every unit test stayed green. So
 * this file renders the panel and reads the alert a user would read.
 *
 * Nothing here is `vi.mock`ed. The panel is evaluated with its real imports,
 * so it cannot be cached bound to a stub for another file
 * (`src/tests/mock-isolation.test.ts`). The parse is the REAL `extractPdfText`
 * on the real legacy pdf.js build, passed through the panel's `extractText` prop, because
 * the modern build needs `DOMMatrix` and jsdom has none. The network is the
 * global `fetch`, which the real job client calls.
 *
 * PART 2 — THE WAIT FOLLOWS THE PLAN.
 *
 * The worker translates one chunk per provider call, one after another, and
 * the browser waited a flat two minutes — shorter than a single call's own
 * default timeout. A document of several chunks was abandoned mid-job while
 * the worker finished it and charged the allowance for it.
 *
 * The chunk count is derived here from the SAME planner and the same ceiling
 * the panel uses, never typed, and the wait is COUNTED on the wire: status
 * reads against a job that never finishes, until the panel offers Keep waiting.
 * No `vi.mock` — a mocked module stays cached for later files (mock-isolation).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import {
  canRunTranslate,
  translateTextDeps,
} from "@/lib/workers/translate-client";
import { PDF_NEEDS_PASSWORD_MESSAGE } from "@/lib/pdf/encryption";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine";
import {
  extractPdfText,
  pageTextChunks,
  type ExtractedPdfText,
} from "@/lib/pdf/text";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { planTranslateChunks } from "@/lib/workers/translate/chunking";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import {
  AI_JOB_POLL,
  pollWaitMs,
  translateJobPoll,
} from "@/lib/jobs/client-wait";
import { resetTelemetry } from "@/lib/telemetry/track";
import { userPasswordEncryptedPdf } from "@/tests/encrypted-pdf-fixture";
import { READY_WORKER_STATUS as READY } from "@/tests/ready-worker-status";
import { TranslateWorkerPanel } from "./translate-worker-panel";

const translateTool = getToolBySlug("translate-pdf")!;

/** The copy the old catch gave EVERY failure. */
const LOST_CONNECTION = /Lost the connection/;

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

/** The real extractor, on the build that runs under Node. */
const realExtract = (bytes: Uint8Array) => extractPdfText(bytes, legacy);

/**
 * `/api/worker/status` answers READY. Every other request, which is the job
 * itself, is rejected the way a dropped connection rejects a `fetch`.
 */
function stubNetwork() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/worker/status")) {
      return { ok: true, json: async () => READY } as Response;
    }
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Requests the job client made: everything except the status check. */
const jobRequests = (fetchMock: ReturnType<typeof stubNetwork>) =>
  fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => !url.includes("/api/worker/status"));

async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.drawText("Hello world", {
    x: 20,
    y: 100,
    size: 18,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  return doc.save();
}

const pdfFile = (bytes: Uint8Array, name = "statement.pdf") =>
  new File([bytes.slice()], name, { type: "application/pdf" });

async function renderReadyPanel() {
  const fetchMock = stubNetwork();
  render(
    <TranslateWorkerPanel tool={translateTool} extractText={realExtract} />,
  );
  // The builder only exists once the stubbed status says the worker is ready.
  const run = await screen.findByRole("button", { name: /translate pdf/i });
  return { fetchMock, run };
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  return input!;
}

/**
 * The run button blocks with `aria-disabled`, not `disabled` (so it stays
 * focusable), which means `toBeDisabled()` is ALWAYS false for it: a wait on
 * that passes before anything is staged.
 */
const blocked = (run: HTMLElement) =>
  run.getAttribute("aria-disabled") === "true";

/** Stage `file` through the picker, press run, and return the alert shown. */
async function runWith(file: File, run: HTMLElement): Promise<HTMLElement> {
  expect(blocked(run)).toBe(true);
  fireEvent.change(fileInput(), { target: { files: [file] } });
  await waitFor(() => expect(blocked(run)).toBe(false));
  fireEvent.click(run);
  return screen.findByRole("alert");
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("health checks: the stubbed deployment really shows the builder", () => {
  it("READY is a status the panel accepts, and the tool exists", () => {
    expect(translateTool.slug).toBe("translate-pdf");
    expect(canRunTranslate(READY)).toBe(true);
  });
});

describe("TranslateWorkerPanel: a local parse failure is not a lost connection", () => {
  it("a password-protected PDF shows the password copy and the Unlock way out", async () => {
    const { fetchMock, run } = await renderReadyPanel();
    const alert = await runWith(pdfFile(userPasswordEncryptedPdf()), run);

    expect(alert).toHaveTextContent(PDF_NEEDS_PASSWORD_MESSAGE);
    expect(alert).not.toHaveTextContent(LOST_CONNECTION);
    // ErrorNote turns the tool name into the way there.
    expect(
      screen.getByRole("link", { name: /open unlock pdf/i }),
    ).toBeInTheDocument();
    // It failed before anything was spent: no upload was ever attempted.
    expect(jobRequests(fetchMock)).toEqual([]);
  });

  it("a damaged PDF shows 'couldn't be read', not network advice", async () => {
    const { fetchMock, run } = await renderReadyPanel();
    const truncated = (await textPdf()).slice(0, 40);
    const alert = await runWith(pdfFile(truncated, "damaged.pdf"), run);

    expect(alert).toHaveTextContent(UNREADABLE_PDF_MESSAGE);
    expect(alert).not.toHaveTextContent(LOST_CONNECTION);
    expect(jobRequests(fetchMock)).toEqual([]);
  });

  it("control: a real PDF whose upload is dropped DOES get the network copy", async () => {
    const { fetchMock, run } = await renderReadyPanel();
    const alert = await runWith(pdfFile(await textPdf(), "letter.pdf"), run);

    // The parse succeeded and the job client really went to the network:
    // this is the one failure the connection sentence is true of.
    expect(jobRequests(fetchMock).length).toBeGreaterThan(0);
    expect(alert).toHaveTextContent(LOST_CONNECTION);
  });
});

describe("TranslateWorkerPanel: a dropped non-PDF is refused at the drop", () => {
  it("dropping a .docx says it isn't a PDF and stages nothing", async () => {
    const { fetchMock, run } = await renderReadyPanel();
    const docx = new File([new Uint8Array([0x50, 0x4b, 3, 4])], "letter.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const zone = fileInput().closest("label");
    expect(zone).not.toBeNull();
    fireEvent.drop(zone!, { dataTransfer: { files: [docx] } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`"letter.docx" isn't a PDF`);
    expect(alert).not.toHaveTextContent(LOST_CONNECTION);
    // Nothing was staged, so there is nothing to run.
    expect(screen.queryByText("letter.docx")).not.toBeInTheDocument();
    expect(blocked(run)).toBe(true);
    expect(jobRequests(fetchMock)).toEqual([]);
  });

  it("control: dropping a PDF stages it with no refusal", async () => {
    const { run } = await renderReadyPanel();
    const zone = fileInput().closest("label");
    fireEvent.drop(zone!, {
      dataTransfer: { files: [pdfFile(await textPdf(), "report.pdf")] },
    });

    expect(await screen.findByText("report.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(blocked(run)).toBe(false);
  });
});

// --- PART 2: the wait follows the plan ------------------------------------

const providers = getProviderReadiness("remote-configured");
/** A deployment ready to translate, for the wait tests. */
const READY_FOR_WAIT: WorkerStatus = {
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

/** `pages` pages, each just under a third of the per-call ceiling. */
function documentOf(pages: number): ExtractedPdfText {
  const text = "word ".repeat(Math.floor(TRANSLATE_MAX_INPUT_CHARS / 3 / 5));
  const list = Array.from({ length: pages }, (_, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  return {
    pageCount: pages,
    pages: list,
    text: list.map((p) => p.text).join("\n\n"),
    characterCount: list.reduce((n, p) => n + p.characterCount, 0),
    hasText: true,
  };
}

const savedExtract = translateTextDeps.extract;
const JOB = "job_translate1";

afterEach(() => {
  translateTextDeps.extract = savedExtract;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/**
 * Translate `doc` against a job that never finishes, and count the status
 * reads the browser makes before it stops waiting — the wait as it reaches the
 * wire, not as the panel's source spells it.
 */
async function pollsBeforeGivingUp(doc: ExtractedPdfText) {
  translateTextDeps.extract = async () => doc;
  let polls = 0;
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/worker/status") return json(READY_FOR_WAIT);
      if (url === "/api/uploads")
        return json({
          slots: [
            { fileId: "f1", url: "/upload/f1", method: "PUT", headers: {} },
          ],
        });
      if (url === "/upload/f1") return json({});
      if (url === "/api/jobs")
        return json({
          jobId: JOB,
          tool: "translate-pdf",
          status: "processing",
        });
      if (url === `/api/jobs/${JOB}`) {
        polls += 1;
        return json({
          jobId: JOB,
          tool: "translate-pdf",
          status: "processing",
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  render(<TranslateWorkerPanel tool={translateTool} />);
  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    if (!found) throw new Error("no input");
    return found;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "long.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /translate pdf/i }));
  for (
    let i = 0;
    i < 200 && !screen.queryByRole("button", { name: /keep waiting/i });
    i += 1
  )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
  expect(screen.getByRole("button", { name: /keep waiting/i })).toBeTruthy();
  return { polls };
}

describe("Translate panel — the wait follows the plan", () => {
  it("a many-chunk document gets the wait its chunk count needs", async () => {
    const doc = documentOf(12);
    const chunks = planTranslateChunks(
      pageTextChunks(doc.pages),
      TRANSLATE_MAX_INPUT_CHARS,
    ).chunks.length;
    // Health: the fixture really is several provider calls.
    expect(chunks).toBeGreaterThanOrEqual(3);
    const expected = translateJobPoll(chunks);
    expect(pollWaitMs(expected)).toBeGreaterThan(pollWaitMs(AI_JOB_POLL));
    const { polls } = await pollsBeforeGivingUp(doc);
    expect(polls).toBe(expected.maxAttempts);
  });

  it("POSITIVE CONTROL: a one-chunk document gets the ordinary AI wait", async () => {
    const { polls } = await pollsBeforeGivingUp(documentOf(1));
    expect(polls).toBe(AI_JOB_POLL.maxAttempts);
  });
});
