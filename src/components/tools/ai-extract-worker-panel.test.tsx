// @vitest-environment jsdom
/**
 * AI Data Extraction refuses two fields with the same name IN THE PANEL, before
 * a byte is uploaded or a character of the allowance is reserved.
 *
 * THE DEFECT (2026-09-28): the panel filtered out blank names and nothing else,
 * so "Total" and "total" went to the worker, whose contract refuses a
 * case-insensitive duplicate. The file uploaded, a third of the day was
 * reserved, the job failed on the worker, and the panel showed the contract's
 * developer text: "`schema[1].name` duplicates an earlier field name."
 *
 * Read at the point of consumption: the attributes and text a user and a
 * screen reader get, and whether the driver was ever called.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { parseExtractOptions } from "@/lib/jobs/ai-extract";
import { resetTelemetry } from "@/lib/telemetry/track";

const runWorkerAiExtract = vi.hoisted(() => vi.fn());

vi.mock("@/lib/workers/ai-extract-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workers/ai-extract-client")>()),
  runWorkerAiExtract,
}));

const { AiExtractWorkerPanel } = await import("./ai-extract-worker-panel");

const tool = getToolBySlug("ai-extract")!;
const providers = getProviderReadiness("remote-configured");

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

afterEach(() => {
  resetTelemetry();
  runWorkerAiExtract.mockReset();
  vi.unstubAllGlobals();
});

async function openBuilder() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
  );
  render(<AiExtractWorkerPanel tool={tool} />);
  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    expect(found).not.toBeNull();
    return found!;
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([1, 2, 3])], "invoice.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
}

const nameInput = (n: number) =>
  screen.getByRole("textbox", { name: `Field ${n} name` });
const extractButton = () =>
  screen.getByRole("button", { name: /extract data/i });

async function nameTwoFields(first: string, second: string) {
  fireEvent.change(nameInput(1), { target: { value: first } });
  fireEvent.click(screen.getByRole("button", { name: /add field/i }));
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Field 2 name" }),
    {
      target: { value: second },
    },
  );
}

describe("AiExtractWorkerPanel — duplicate field names", () => {
  it("marks the later duplicate, says why in words, and never runs the job", async () => {
    await openBuilder();
    await nameTwoFields("Total", " total");

    const second = nameInput(2);
    expect(second).toHaveAttribute("aria-invalid", "true");
    expect(nameInput(1)).not.toHaveAttribute("aria-invalid");
    // The problem is announced through the input, not only drawn beside it.
    const problem = document.getElementById(
      second.getAttribute("aria-describedby")!,
    );
    expect(problem).toHaveTextContent(
      "Field 2 has the same name as field 1. Give each field a different name.",
    );

    expect(extractButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(extractButton());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      runWorkerAiExtract,
      "a schema the worker refuses was sent — the upload and the reservation happen first",
    ).not.toHaveBeenCalled();
  });

  it("agrees with the worker's contract: what the panel flags, the parser refuses", async () => {
    // The panel's rule and the parser's rule are one function; this pins that
    // the panel is not stricter or looser than what the worker would say.
    const verdict = parseExtractOptions({
      mode: "schema",
      schema: [{ name: "Total" }, { name: " total" }],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok)
      expect(verdict.error.body.error.message).toBe(
        "Field 2 has the same name as field 1. Give each field a different name.",
      );
  });

  it("POSITIVE CONTROL: distinct names run, with the schema and a declaration key", async () => {
    runWorkerAiExtract.mockResolvedValue({ ok: false, message: "stop" });
    await openBuilder();
    await nameTwoFields("Total", "Vendor");

    expect(nameInput(2)).not.toHaveAttribute("aria-invalid");
    await waitFor(() =>
      expect(extractButton()).not.toHaveAttribute("aria-disabled"),
    );
    fireEvent.click(extractButton());
    await waitFor(() => expect(runWorkerAiExtract).toHaveBeenCalledTimes(1));
    const input = runWorkerAiExtract.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(input.schema).toEqual([
      { name: "Total", type: "string" },
      { name: "Vendor", type: "string" },
    ]);
    // The key is always written — here without a count, since pdfjs cannot
    // open three bytes — so a panel cannot drop it by omission.
    expect(
      Object.prototype.hasOwnProperty.call(input, "declaredCharacters"),
    ).toBe(true);
  });
});
