// @vitest-environment jsdom
/**
 * The Translate panel, read the way a user reads it: a real PDF dropped in,
 * the real browser extractor run over it, and the alert that comes back.
 *
 * THE DEFECT. A scanned PDF — no selectable text — was refused with
 *
 *   "This document has 0 characters of text, and Translate PDF can handle
 *    about 10,258 in one run … Split it into smaller files and translate them
 *    one at a time."
 *
 * because the panel read "no chunks" as "too long", and a scan has no chunks.
 * Splitting cannot help a scan; OCR can, and nothing said so. The panel's own
 * intro promises that a scanned PDF "fails honestly". It had no test at all,
 * so nothing ever dropped a scan on it.
 *
 * Only the network is stubbed (`@/tests/stub-job-network`): the REAL job
 * client runs over a stubbed global `fetch`, so the test also proves the
 * property the pre-upload check exists for — a document the worker would
 * refuse is refused BEFORE it is uploaded and charged a daily AI run.
 *
 * MOVED AND REWRITTEN at the merge of L09 with L06, history kept here. This
 * suite lived at translate-worker-panel.test.tsx and `vi.mock`ed
 * `runWorkerTranslate` and `pdfjs-dist`; L06's suite at that path renders the
 * same panel with its real imports. Under `isolate: false` the mocked file
 * left the panel cached bound to the stub for L06's file and two others
 * (src/tests/mock-isolation.test.ts). Every assertion is kept: "runWorkerTranslate
 * was not called" is now "no upload and no job request was made", its
 * recorded request is now the parsed `POST /api/jobs` body, and the legacy
 * pdfjs build reaches the panel through its `extractText` seam instead of a
 * module mock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import {
  TRANSLATE_MAX_INPUT_CHARS,
  TRANSLATE_NO_TEXT_MESSAGE,
} from "@/lib/jobs/translate-limits";
import { runTranslate } from "@/lib/workers/translate/engine";
import { extractPdfText } from "@/lib/pdf/text";
import { resetTelemetry } from "@/lib/telemetry/track";
import { imageOnlyPdf, textPdf } from "@/tests/pdf-text-fixtures";
import { stubJobNetwork, type JobNetwork } from "@/tests/stub-job-network";
import { TranslateWorkerPanel } from "./translate-worker-panel";

// The browser build of pdfjs cannot run here; the legacy build is the same
// text layer, shipped by the same package for this environment. It reaches
// the panel through its `extractText` seam — never a module mock.
const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;
const realExtract = (bytes: Uint8Array) => extractPdfText(bytes, legacy);

const translateTool = getToolBySlug("translate-pdf")!;
const ocrTool = getToolBySlug("ocr-pdf")!;

const providers = getProviderReadiness("remote-configured");

/** A deployment where the whole pipeline AND an AI provider are ready. */
const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: {
    available: true,
    engine: "tesseract",
    languages: ["eng"],
    detail: "OCR runs on the worker.",
  },
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
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
  },
};

/**
 * Render the ready panel, drop `bytes` in as a PDF, and press Translate. The
 * worker's job, if one is created, ends as `workerSays` decides.
 */
async function translate(
  bytes: Uint8Array,
  workerSays: Parameters<typeof stubJobNetwork>[1] = () => ({
    status: "failed",
    error: {
      code: "internal_error",
      message: "The job ended for a reason unrelated to text.",
      retryable: false,
    },
  }),
): Promise<JobNetwork> {
  const network = stubJobNetwork(READY, workerSays);
  render(
    <TranslateWorkerPanel tool={translateTool} extractText={realExtract} />,
  );
  const run = await screen.findByRole("button", { name: /translate pdf/i });
  const input = document.querySelector('input[type="file"]');
  expect(input, "the builder's file input").not.toBeNull();
  fireEvent.change(input!, {
    target: {
      files: [
        new File([bytes.slice()], "document.pdf", { type: "application/pdf" }),
      ],
    },
  });
  await screen.findByText("document.pdf");
  fireEvent.click(run);
  return network;
}

/** Nothing left the browser: no upload, no job, no allowance charged. */
function nothingSent(network: JobNetwork) {
  expect(network.uploads(), "the file was uploaded").toBe(0);
  expect(network.jobBodies, "a job was created").toEqual([]);
}

/** The alert the run ended in. */
async function alertText() {
  const alert = await screen.findByRole("alert", {}, { timeout: 5_000 });
  return { alert, text: alert.textContent ?? "" };
}

function ocrLinkIn(alert: HTMLElement) {
  return within(alert).queryByRole("link", {
    name: new RegExp(ocrTool.name, "i"),
  });
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
});

describe("TranslateWorkerPanel — a scanned PDF", () => {
  it("is sent to OCR, not told it has 0 characters and should be split", async () => {
    const network = await translate(await imageOnlyPdf(2));
    const { alert, text } = await alertText();

    expect(text).toContain(TRANSLATE_NO_TEXT_MESSAGE);
    // The inverted defect, as the user read it.
    expect(text).not.toMatch(/\b0 characters\b/);
    expect(text).not.toMatch(/Split it into smaller files/);

    // The next step is IN the alert, announced with it, and goes somewhere real.
    const link = ocrLinkIn(alert);
    expect(link, "a link to OCR PDF inside the alert").not.toBeNull();
    expect(link!.getAttribute("href")).toBe(`/tools/${ocrTool.slug}`);

    // Refused before upload: nothing was sent, nothing was charged.
    nothingSent(network);
  });

  it("offers OCR when the WORKER refuses for no text, too", async () => {
    // The two extractors can disagree, so the worker's refusal must carry the
    // same next step. Its message comes from the real engine, not this file.
    const worker = await runTranslate(
      new Uint8Array([1]),
      { targetLanguage: "fr", sourceLanguage: "auto" },
      {
        extract: async () => ({
          pageCount: 1,
          pages: [{ pageNumber: 1, text: "", characterCount: 0 }],
          text: "",
          characterCount: 0,
          hasText: false,
        }),
        provider: {
          id: "openai",
          model: "m",
          complete: () => {
            throw new Error("unreachable");
          },
        },
      },
    );
    expect(worker.ok).toBe(false);
    if (worker.ok) return;
    const refusal = worker.message;

    const network = await translate(await textPdf([600]), () => ({
      status: "failed",
      error: {
        code: "unprocessable_entity",
        message: refusal,
        retryable: false,
      },
    }));
    const { alert } = await alertText();
    expect(network.jobBodies).toHaveLength(1);
    expect(ocrLinkIn(alert)).not.toBeNull();
  });
});

describe("TranslateWorkerPanel — a page too long for one pass", () => {
  it("names the page, and does not suggest splitting the file", async () => {
    const network = await translate(
      await textPdf([TRANSLATE_MAX_INPUT_CHARS + 2_000]),
    );
    const { alert, text } = await alertText();

    expect(text).toMatch(/Page 1 alone holds [\d,]+ characters/);
    expect(text).toContain(TRANSLATE_MAX_INPUT_CHARS.toLocaleString("en-US"));
    expect(text).not.toMatch(/Split it into smaller files/);
    // OCR is not the answer to a page with too much text.
    expect(ocrLinkIn(alert)).toBeNull();
    nothingSent(network);
  });
});

describe("TranslateWorkerPanel — what may be submitted still is (positive control)", () => {
  it("submits a page under the ceiling, declaring what it extracted", async () => {
    const network = await translate(await textPdf([1_200]));

    await waitFor(() => expect(network.jobBodies).toHaveLength(1));
    const request = network.jobBodies[0] as {
      declaredCharacters: number;
      declaredTextPages: number;
    };
    expect(request.declaredTextPages).toBe(1);
    expect(request.declaredCharacters).toBeGreaterThan(1_000);

    // And an unrelated failure does not grow an OCR link.
    const { alert } = await alertText();
    expect(ocrLinkIn(alert)).toBeNull();
  });
});
