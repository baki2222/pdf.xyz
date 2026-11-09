// @vitest-environment jsdom
// @native-canvas
/**
 * The Translate panel and a SCAN, in both states of the running worker
 * (audit translate-pdf#3).
 *
 *  - `translateOcr` advertised (the live status says an observed worker
 *    proves the chain and OCR itself): a scan is not refused. The panel says
 *    what it checked, how it works and what it costs, shows OCR's language
 *    picker, and sends the OCR request in the job options at Run — with no
 *    declared count, because the browser found no text to count. Nothing is
 *    uploaded before Run.
 *  - not advertised: today's refusal, word for word, nothing uploaded, and no
 *    picker. The worker image is published separately from the web tier, so
 *    the page may never offer what the running worker cannot do.
 *
 * And a control in the ON state: a typed PDF shows no picker and is sent
 * counted, exactly as before.
 *
 * Real PDFs, the real browser extractor (legacy pdfjs build through the
 * panel's `extractText` seam) and the real job client over a stubbed `fetch`.
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
import { TRANSLATE_NO_TEXT_MESSAGE } from "@/lib/jobs/translate-limits";
import {
  TRANSLATE_OCR_EXPLAINER,
  TRANSLATE_OCR_SCOPE,
  TRANSLATE_SCAN_CHECK,
} from "@/lib/jobs/translate-ocr";
import { extractPdfText } from "@/lib/pdf/text";
import { resetTelemetry } from "@/lib/telemetry/track";
import { imageOnlyPdf, textPdf } from "@/tests/pdf-text-fixtures";
import { stubJobNetwork, type JobNetwork } from "@/tests/stub-job-network";
import { TranslateWorkerPanel } from "./translate-worker-panel";

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;
const realExtract = (bytes: Uint8Array) => extractPdfText(bytes, legacy);

const translateTool = getToolBySlug("translate-pdf")!;
const providers = getProviderReadiness("remote-configured");

function status(translateOcr: boolean | undefined): WorkerStatus {
  return {
    mode: "remote-configured",
    enabled: true,
    localDevOnly: false,
    detail: "A server backend is configured.",
    compress: { lossless: false, deep: false, engines: [] },
    scan: { active: false, detail: "not scanned" },
    ocr: {
      available: true,
      engine: "tesseract",
      languages: ["eng", "deu"],
      detail: "OCR runs on our secure server.",
    },
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
      verdict: "off",
      observed: false,
      drainable: false,
      detail: "no server observed",
    },
    ...(translateOcr !== undefined ? { translateOcr } : {}),
  };
}

const failed = () => ({
  status: "failed" as const,
  error: {
    code: "internal_error" as const,
    message: "The job ended for a reason unrelated to text.",
    retryable: false,
  },
});

/** Render, drop `bytes` in as a PDF, and wait for the file to be chosen. */
async function choose(
  bytes: Uint8Array,
  translateOcr: boolean | undefined,
): Promise<{ network: JobNetwork; run: HTMLElement }> {
  const network = stubJobNetwork(status(translateOcr), failed);
  render(
    <TranslateWorkerPanel tool={translateTool} extractText={realExtract} />,
  );
  const run = await screen.findByRole("button", { name: /translate pdf/i });
  const input = document.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, {
    target: {
      files: [
        new File([bytes.slice()], "document.pdf", { type: "application/pdf" }),
      ],
    },
  });
  await screen.findByText("document.pdf");
  return { network, run };
}

const ocrSection = () =>
  screen.queryByRole("region", { name: /recognise the scan/i });

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
});

describe("TranslateWorkerPanel — a scan, when the running worker translates scans", () => {
  it("shows what it checked, how it works, the scope and OCR's language picker — and uploads nothing before Run", async () => {
    const { network } = await choose(await imageOnlyPdf(2), true);
    const section = await screen.findByRole(
      "region",
      { name: /recognise the scan/i },
      { timeout: 5_000 },
    );
    const text = section.textContent ?? "";
    expect(text).toContain(TRANSLATE_SCAN_CHECK);
    expect(text).toContain(TRANSLATE_OCR_EXPLAINER);
    expect(text).toContain(TRANSLATE_OCR_SCOPE);
    expect(
      within(section).getByRole("group", { name: /OCR languages/i }),
    ).toBeTruthy();
    // Right-to-left scripts are not offered, as in PDF to Word's switch.
    expect(
      within(section).queryByRole("button", { name: "Arabic" }),
    ).toBeNull();
    expect(network.uploads()).toBe(0);
    expect(network.jobBodies).toEqual([]);
  });

  it("Run sends the OCR request in the job options, with the chosen languages and NO declared count", async () => {
    const { network, run } = await choose(await imageOnlyPdf(2), true);
    const section = await screen.findByRole(
      "region",
      { name: /recognise the scan/i },
      { timeout: 5_000 },
    );
    fireEvent.click(within(section).getByRole("button", { name: "German" }));
    fireEvent.click(run);
    await waitFor(() => expect(network.jobBodies).toHaveLength(1), {
      timeout: 5_000,
    });
    const body = network.jobBodies[0] as {
      tool: string;
      options: Record<string, unknown>;
      declaredCharacters?: number;
      declaredTextPages?: number;
    };
    expect(body.tool).toBe("translate-pdf");
    expect(body.options.ocr).toBe(true);
    expect(body.options.languages).toEqual(
      expect.arrayContaining(["eng", "deu"]),
    );
    expect(body.declaredCharacters).toBeUndefined();
    expect(body.declaredTextPages).toBeUndefined();
    expect(network.uploads()).toBe(1);
  }, 20_000);

  it("control: a typed PDF shows no picker and is sent counted, with no OCR request", async () => {
    const { network, run } = await choose(await textPdf([1_200]), true);
    // Give the chosen-file extraction time to settle before asserting absence.
    await new Promise((r) => setTimeout(r, 300));
    expect(ocrSection()).toBeNull();
    fireEvent.click(run);
    await waitFor(() => expect(network.jobBodies).toHaveLength(1), {
      timeout: 5_000,
    });
    const body = network.jobBodies[0] as {
      options: Record<string, unknown>;
      declaredCharacters?: number;
    };
    expect(body.options.ocr).toBeUndefined();
    expect(body.options.languages).toBeUndefined();
    expect(body.declaredCharacters).toBeGreaterThan(1_000);
  }, 20_000);
});

describe.each([
  ["not advertised", false],
  ["absent from an older status", undefined],
] as const)(
  "TranslateWorkerPanel — a scan, when translateOcr is %s",
  (_name, translateOcr) => {
    it("keeps today's refusal sentence, offers no picker, and uploads nothing", async () => {
      const { network, run } = await choose(
        await imageOnlyPdf(2),
        translateOcr,
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(ocrSection()).toBeNull();
      fireEvent.click(run);
      const alert = await screen.findByRole("alert", {}, { timeout: 5_000 });
      expect(alert.textContent ?? "").toContain(TRANSLATE_NO_TEXT_MESSAGE);
      expect(network.uploads()).toBe(0);
      expect(network.jobBodies).toEqual([]);
    });
  },
);
