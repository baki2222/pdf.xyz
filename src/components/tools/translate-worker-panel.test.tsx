// @vitest-environment jsdom
/**
 * What the Translate panel SHOWS when a run fails before the job exists.
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
 * on the real legacy pdf.js build, passed through the panel's one seam, because
 * the modern build needs `DOMMatrix` and jsdom has none. The network is the
 * global `fetch`, which the real job client calls.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import { canRunTranslate } from "@/lib/workers/translate-client";
import { PDF_NEEDS_PASSWORD_MESSAGE } from "@/lib/pdf/encryption";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine";
import { extractPdfText } from "@/lib/pdf/text";
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
