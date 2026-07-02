import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import { OCR_LANGUAGE_CODES, buildOcrResultMeta } from "@/lib/jobs/ocr";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { OcrWorkerPanel, OcrResultSummary } from "./ocr-worker-panel";

const ocrTool = getToolBySlug("ocr-pdf")!;

const DISABLED: WorkerStatus = {
  mode: "disabled",
  enabled: false,
  localDevOnly: false,
  detail: "No secure worker is configured in this environment.",
  compress: { lossless: false, deep: false, engines: [] },
  ocr: {
    available: false,
    engine: null,
    languages: [],
    detail:
      "OCR needs a secure worker with a native OCR engine, which isn't enabled in this environment — nothing is uploaded and no text is produced here.",
  },
  providers: getProviderReadiness("disabled"),
  daemon: resolveDaemonReadiness({}),
};

const AVAILABLE: WorkerStatus = {
  mode: "remote-configured",
  enabled: false,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  ocr: {
    available: true,
    engine: "ocrmypdf",
    languages: [...OCR_LANGUAGE_CODES],
    detail: "OCR runs on ocrmypdf on an encrypted, auto-deleting secure worker.",
  },
  providers: getProviderReadiness("remote-configured"),
  daemon: resolveDaemonReadiness({}),
};

function stubFetch(status: WorkerStatus) {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => status });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function fileInput(): HTMLInputElement | null {
  return document.querySelector('input[type="file"]');
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OcrWorkerPanel", () => {
  it("offers OCR settings and stays honest when OCR is unavailable", async () => {
    stubFetch(DISABLED);
    render(<OcrWorkerPanel tool={ocrTool} />);

    // The honest not-enabled reason renders once status resolves.
    expect(await screen.findByText(DISABLED.ocr.detail)).toBeInTheDocument();

    // OCR-specific configuration is present.
    expect(screen.getByRole("group", { name: /ocr languages/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /english/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Searchable PDF" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Text sidecar" })).toBeInTheDocument();

    // Honest availability badge + notify placeholder, and NO uploader.
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notify me/i })).toBeInTheDocument();
    expect(fileInput()).toBeNull();

    // It never fabricates a produced result / download in the disabled state.
    expect(screen.queryByText(/OCR complete/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run ocr on the worker/i })).not.toBeInTheDocument();
  });

  it("emits a privacy-safe worker_status_checked event", async () => {
    const seen: RedactedEvent[] = [];
    configureTelemetry((e) => seen.push(e));
    stubFetch(DISABLED);

    render(<OcrWorkerPanel tool={ocrTool} />);

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      name: "worker_status_checked",
      mode: "disabled",
      enabled: false,
    });
  });

  it("reflects the chosen languages and output in the request summary", async () => {
    stubFetch(DISABLED);
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByText(DISABLED.ocr.detail);

    // Default request.
    expect(screen.getByText(/English → Searchable PDF/)).toBeInTheDocument();

    // Add a second language and switch the output mode.
    screen.getByRole("button", { name: /spanish/i }).click();
    screen.getByRole("radio", { name: "Text sidecar" }).click();

    await waitFor(() =>
      expect(
        screen.getByText(/English, Spanish → Text sidecar/),
      ).toBeInTheDocument(),
    );
  });

  it("mounts the real uploader + run action only when OCR is available", async () => {
    stubFetch(AVAILABLE);
    render(<OcrWorkerPanel tool={ocrTool} />);

    // The run affordance appears, driving the real (documented) job flow.
    expect(
      await screen.findByRole("button", { name: /run ocr on the worker/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    // A genuine file input is mounted (the Dropzone) — no fake success is shown.
    expect(fileInput()).not.toBeNull();
    expect(screen.queryByText(/OCR complete/i)).not.toBeInTheDocument();
  });

  it("shows an honest fallback when the status endpoint is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<OcrWorkerPanel tool={ocrTool} />);

    expect(
      await screen.findByText(/couldn't confirm secure-worker availability/i),
    ).toBeInTheDocument();
    // Still no uploader when availability is unknown.
    expect(fileInput()).toBeNull();
  });
});

describe("OcrResultSummary — safe, structural job metadata", () => {
  it("shows only structural facts (pages, output, languages, characters), never text", () => {
    const meta = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["eng", "spa"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 3,
      textCharacters: 1_240,
    });
    const { container } = render(<OcrResultSummary meta={meta} />);

    expect(screen.getByText("Recognition summary")).toBeInTheDocument();
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Searchable PDF + text")).toBeInTheDocument();
    expect(screen.getByText("Languages")).toBeInTheDocument();
    expect(screen.getByText("English, Spanish")).toBeInTheDocument();
    expect(screen.getByText("1,240 characters")).toBeInTheDocument();

    // Structural only: the engine token and the raw language CODES are backend
    // details that never appear in the user-facing summary, and no recognized text
    // can be present because the metadata never carried any.
    expect(container.textContent).not.toContain("ocrmypdf");
    expect(container.textContent).not.toMatch(/\beng\b/);
  });

  it("omits a page count and character count that the backend could not determine", () => {
    const meta = buildOcrResultMeta({
      engine: "tesseract",
      languages: ["eng"],
      outputMode: "searchable-pdf",
      producedSearchablePdf: true,
      producedTextSidecar: false,
      pageCount: null,
      textCharacters: null,
    });
    render(<OcrResultSummary meta={meta} />);

    // No PDF page count and no sidecar → those rows are simply absent, not "0" or "—".
    expect(screen.queryByText("Pages")).not.toBeInTheDocument();
    expect(screen.queryByText(/characters/)).not.toBeInTheDocument();
    // The always-known output kind still renders.
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("Searchable PDF")).toBeInTheDocument();
  });

  it("uses singular labels for a one-page, one-language, one-character result", () => {
    const meta = buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: ["fra"],
      outputMode: "text",
      producedSearchablePdf: false,
      producedTextSidecar: true,
      pageCount: null,
      textCharacters: 1,
    });
    render(<OcrResultSummary meta={meta} />);
    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.getByText("French")).toBeInTheDocument();
    expect(screen.getByText("1 character")).toBeInTheDocument();
  });
});
