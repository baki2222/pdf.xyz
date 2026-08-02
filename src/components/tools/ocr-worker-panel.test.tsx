// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import { OCR_LANGUAGE_CODES, buildOcrResultMeta } from "@/lib/jobs/ocr";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
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
  scan: { active: false, detail: "not scanned" },
  ocr: {
    available: false,
    engine: null,
    languages: [],
    detail:
      "OCR needs a secure worker with a native OCR engine, which isn't enabled in this environment — nothing is uploaded and no text is produced here.",
  },
  security: {
    available: false,
    operations: ["protect", "unlock"],
    detail: "PDF password protection isn't enabled here.",
  },
  providers: getProviderReadiness("disabled"),
  daemon: resolveDaemonReadiness({}),
  ai: resolveAiReadiness({}),
};

const AVAILABLE: WorkerStatus = {
  mode: "remote-configured",
  enabled: false,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: {
    available: true,
    engine: "ocrmypdf",
    languages: [...OCR_LANGUAGE_CODES],
    detail: "OCR runs on ocrmypdf on an encrypted, auto-deleting secure worker.",
  },
  security: {
    available: false,
    operations: ["protect", "unlock"],
    detail: "PDF password protection runs on the secure worker.",
  },
  providers: getProviderReadiness("remote-configured"),
  daemon: resolveDaemonReadiness({}),
  ai: resolveAiReadiness({}),
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

    // The FIRST pick replaces the default rather than queueing behind it. Nobody
    // chose English — it is what the control loaded with — and order is priority:
    // the runner joins the array with `+` and Tesseract weights the first entry as
    // primary. Appending would have left English primary for a Spanish document,
    // which is the weighting that returns gibberish.
    screen.getByRole("button", { name: /spanish/i }).click();
    screen.getByRole("radio", { name: "Text sidecar" }).click();

    await waitFor(() =>
      expect(screen.getByText(/Spanish → Text sidecar/)).toBeInTheDocument(),
    );

    // A SECOND pick appends, so the user's own order is preserved: they asked for
    // Spanish first, English second.
    screen.getByRole("button", { name: /^english/i }).click();
    await waitFor(() =>
      expect(
        screen.getByText(/Spanish, English → Text sidecar/),
      ).toBeInTheDocument(),
    );
  });

  it("labels the primary language, because position decides the engine's weighting", async () => {
    stubFetch(DISABLED);
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByText(DISABLED.ocr.detail);

    // With one language there is no ordering to communicate.
    expect(
      screen.queryByRole("button", { name: /language 1 of/i }),
    ).not.toBeInTheDocument();

    screen.getByRole("button", { name: /bengali/i }).click();
    screen.getByRole("button", { name: /^english/i }).click();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /bengali, language 1 of 2 \(primary\)/i }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /english, language 2 of 2/i }),
    ).toBeInTheDocument();
  });

  it("warns that the wrong language yields gibberish rather than an error", async () => {
    stubFetch(DISABLED);
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByText(DISABLED.ocr.detail);
    // The single most useful sentence on the page, and it costs no new data: a user
    // who leaves the default alone otherwise gets a successful job and unusable output
    // with nothing to explain why.
    expect(screen.getByText(/plausible-looking gibberish/i)).toBeInTheDocument();
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
    // Twice, deliberately: once as the summary row, once in the closing note that
    // echoes the language back and warns the wrong one yields gibberish rather than
    // an error. That note is the only warning a user gets before trusting the output.
    expect(screen.getAllByText("English, Spanish")).toHaveLength(2);
    expect(screen.getByText(/plausible-looking gibberish/i)).toBeInTheDocument();
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
    // Row plus the closing language echo — see the note in the both-mode test above.
    expect(screen.getAllByText("French")).toHaveLength(2);
    expect(screen.getByText("1 character")).toBeInTheDocument();
  });
});
