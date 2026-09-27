// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import {
  OCR_LANGUAGES,
  OCR_LANGUAGE_CODES,
  OCR_MAX_INPUT_FILES,
  buildOcrResultMeta,
  describeOcrLanguage,
} from "@/lib/jobs/ocr";
import { JOB_LIMITS } from "@/lib/jobs/types";
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
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
  },
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
    detail:
      "OCR runs on ocrmypdf on an encrypted, auto-deleting secure worker.",
  },
  security: {
    available: false,
    operations: ["protect", "unlock"],
    detail: "PDF password protection runs on the secure worker.",
  },
  providers: getProviderReadiness("remote-configured"),
  daemon: resolveDaemonReadiness({}),
  ai: resolveAiReadiness({}),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
  },
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
    expect(
      screen.getByRole("group", { name: /ocr languages/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /english/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Searchable PDF" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Text sidecar" }),
    ).toBeInTheDocument();

    // Honest availability badge + notify placeholder, and NO uploader.
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /notify me/i }),
    ).toBeInTheDocument();
    expect(fileInput()).toBeNull();

    // It never fabricates a produced result / download in the disabled state.
    expect(screen.queryByText(/OCR complete/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /run ocr on the worker/i }),
    ).not.toBeInTheDocument();
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

    // Selecting a language ADDS it, keeping the English default. Measured on the real
    // document that prompted this: `eng` alone scored 49.4 mean confidence and returned
    // gibberish, `eng+ben` scored 81.3 and read correctly, and `ben` alone scored 66.8
    // while mangling the English words. A page mixing scripts needs both models, so
    // dropping the default on first pick made the one-click path measurably worse.
    screen.getByRole("button", { name: /spanish/i }).click();
    screen.getByRole("radio", { name: "Text sidecar" }).click();

    await waitFor(() =>
      expect(
        screen.getByText(/English, Spanish → Text sidecar/),
      ).toBeInTheDocument(),
    );
  });

  it("warns that the wrong language yields gibberish rather than an error", async () => {
    stubFetch(DISABLED);
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByText(DISABLED.ocr.detail);
    // The single most useful sentence on the page, and it costs no new data: a user
    // who leaves the default alone otherwise gets a successful job and unusable output
    // with nothing to explain why.
    expect(
      screen.getByText(/plausible-looking gibberish/i),
    ).toBeInTheDocument();
    // And the instruction the measurement actually supports.
    expect(
      screen.getByText(/select every language printed on the page/i),
    ).toBeInTheDocument();
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

/** AVAILABLE, but the worker reports only these recognition packs. */
function availableWith(languages: string[]): WorkerStatus {
  return {
    ...AVAILABLE,
    ocr: {
      ...AVAILABLE.ocr,
      languages: languages as (typeof OCR_LANGUAGE_CODES)[number][],
    },
  };
}

/** Every language chip, by its label, from the catalogue the panel renders. */
function chip(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

function summary(): string {
  return screen.getByText(/This request:/).parentElement!.textContent ?? "";
}

describe("OcrWorkerPanel — the page says what one job takes", () => {
  it("states the per-job file count the runner enforces, not the platform's", async () => {
    stubFetch(AVAILABLE);
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByRole("button", { name: /run ocr on the worker/i });
    // Read the row a user reads, and derive its number from the constant the
    // runner and processor refuse on — a row that merely HAS a constant behind
    // it is what shipped "up to 20 files" for a one-file tool.
    const row = screen.getByText("Limits").parentElement!.textContent ?? "";
    const match = /(\d+) files? per job/.exec(row);
    expect(match, row).not.toBeNull();
    expect(Number(match![1])).toBe(OCR_MAX_INPUT_FILES);
    expect(row).not.toContain(`up to ${JOB_LIMITS.maxInputFiles} files`);
  });

  it("says so when a drop brings more than one file, and keeps the first", async () => {
    stubFetch(AVAILABLE);
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByRole("button", { name: /run ocr on the worker/i });
    const files = ["first.pdf", "second.pdf", "third.pdf"].map(
      (name) => new File(["%PDF-1.7"], name, { type: "application/pdf" }),
    );
    // A drop bypasses `multiple={false}`; only the dropzone sees all three.
    fireEvent.drop(fileInput()!.closest("label")!, {
      dataTransfer: { files },
    });
    expect(await screen.findByText("first.pdf")).toBeInTheDocument();
    expect(screen.queryByText("second.pdf")).not.toBeInTheDocument();
    expect(
      screen.getByText(/only the first file was added/i),
    ).toBeInTheDocument();
  });

  it("shows no such note for a single file (positive control)", async () => {
    stubFetch(AVAILABLE);
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByRole("button", { name: /run ocr on the worker/i });
    fireEvent.drop(fileInput()!.closest("label")!, {
      dataTransfer: {
        files: [
          new File(["%PDF-1.7"], "only.pdf", { type: "application/pdf" }),
        ],
      },
    });
    expect(await screen.findByText("only.pdf")).toBeInTheDocument();
    expect(
      screen.queryByText(/only the first file was added/i),
    ).not.toBeInTheDocument();
  });
});

describe("OcrWorkerPanel — the language menu reads the worker's own report", () => {
  it("marks a language the worker has no pack for as unavailable, and will not select it", async () => {
    stubFetch(availableWith(["eng", "spa"]));
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByRole("button", { name: /run ocr on the worker/i });

    const bengali = chip(describeOcrLanguage("ben"));
    expect(bengali).toHaveAttribute("aria-disabled", "true");
    expect(bengali).toHaveAttribute(
      "title",
      expect.stringMatching(/not installed/i),
    );
    fireEvent.click(bengali);
    expect(summary()).not.toContain(describeOcrLanguage("ben"));

    // An installed one is offered and selectable.
    const spanish = chip(describeOcrLanguage("spa"));
    expect(spanish).not.toHaveAttribute("aria-disabled");
    fireEvent.click(spanish);
    await waitFor(() => expect(summary()).toContain("English, Spanish"));
  });

  it("disables no language when the worker reports every pack (the mirror)", async () => {
    stubFetch(AVAILABLE);
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByRole("button", { name: /run ocr on the worker/i });
    for (const language of OCR_LANGUAGES) {
      expect(chip(language.label)).not.toHaveAttribute("aria-disabled");
    }
  });

  it("drops a default the worker cannot run, falling back to one it can", async () => {
    stubFetch(availableWith(["spa", "fra"]));
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByRole("button", { name: /run ocr on the worker/i });
    await waitFor(() => expect(summary()).toMatch(/Spanish → /));
    expect(summary()).not.toContain("English");
  });
});

describe("OcrWorkerPanel — a page that already has text", () => {
  it("offers only the non-destructive opt-in, off by default, and says so in the request", async () => {
    stubFetch(DISABLED);
    render(<OcrWorkerPanel tool={ocrTool} />);
    await screen.findByText(DISABLED.ocr.detail);
    // The old switch described its OFF state as "re-recognize"; off actually
    // aborted the job. It is gone.
    expect(
      screen.queryByText(/skip pages that already have text/i),
    ).not.toBeInTheDocument();
    const redo = screen.getByRole("checkbox", { name: /redo existing ocr/i });
    expect(redo).not.toBeChecked();
    expect(summary()).not.toMatch(/redo/i);
    fireEvent.click(redo);
    await waitFor(() => expect(summary()).toMatch(/redo existing OCR/i));
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
    expect(
      screen.getByText(/plausible-looking gibberish/i),
    ).toBeInTheDocument();
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
