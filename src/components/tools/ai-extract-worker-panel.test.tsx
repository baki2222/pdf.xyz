// @vitest-environment jsdom
// @native-canvas
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
 * screen reader get, and what reached the network.
 *
 * NO MODULE MOCK (integration of wave1/l01-page-leak). This file first
 * `vi.mock`ed `ai-extract-client`; on the branch it merged into, three other
 * test files import this same panel, and under `isolate: false` the panel stayed
 * cached bound to the stub for them (`src/tests/mock-isolation.test.ts`). The
 * REAL client now runs over a stubbed global `fetch`
 * (`@/tests/stub-job-network`), and each spy-shaped assertion is restated on
 * the wire: "the driver was not called" is no upload and no `POST /api/jobs`;
 * what the driver received is the job body the route would parse.
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
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText } from "@/lib/pdf/text";
import { stubJobNetwork, type JobNetwork } from "@/tests/stub-job-network";
import { AiExtractWorkerPanel } from "./ai-extract-worker-panel";

const tool = getToolBySlug("ai-extract")!;
const providers = getProviderReadiness("remote-configured");

const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A server backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: {
    available: true,
    engine: "tesseract",
    languages: ["eng"],
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
};

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
});

/** The panel over the stubbed network, with `bytes` dropped in as a PDF. */
async function openBuilder(
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
): Promise<JobNetwork> {
  const network = stubJobNetwork(READY);
  render(<AiExtractWorkerPanel tool={tool} />);
  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    expect(found).not.toBeNull();
    return found!;
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File([bytes.slice()], "invoice.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  return network;
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
    const network = await openBuilder();
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
      [network.uploads(), network.jobBodies.length],
      "a schema our server refuses was sent — the upload and the reservation happen first",
    ).toEqual([0, 0]);
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
    const network = await openBuilder();
    await nameTwoFields("Total", "Vendor");

    expect(nameInput(2)).not.toHaveAttribute("aria-invalid");
    await waitFor(() =>
      expect(extractButton()).not.toHaveAttribute("aria-disabled"),
    );
    fireEvent.click(extractButton());
    await waitFor(() => expect(network.jobBodies).toHaveLength(1));
    const body = network.jobBodies[0]!;
    expect(body.tool).toBe("ai-extract");
    expect((body.options as Record<string, unknown>).schema).toEqual([
      { name: "Total", type: "string" },
      { name: "Vendor", type: "string" },
    ]);
    // pdfjs cannot open three bytes, so there is no count — and the job says
    // so by declaring NOTHING, never a zero or a guess (the route then prices
    // it as a whole run). That the panel cannot drop the key by omission is the
    // client's type: `declaredCharacters` is required, `number | null`.
    expect(body).not.toHaveProperty("declaredCharacters");
  });
});

describe("AiExtractWorkerPanel — what the job declares", () => {
  it("sends the extracted character count with its job, not nothing", async () => {
    // Review of 2026-09-28: the POSITIVE CONTROL above checks that the key is
    // PRESENT, and a present key holding `undefined` passed it — an
    // undeclared ai-extract job reserves a third of the day. A REAL pdf-lib
    // PDF, counted by the real extractor, dropped into the panel; the job body
    // on the wire must carry that count. (The wire → route half is
    // `ai-read-declaration.chain.test.ts`.)
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    for (let l = 0; l < 8; l += 1) {
      page.drawText(`Invoice 2026-0412, line ${l + 1}: total 1200.`, {
        x: 20,
        y: 760 - l * 18,
        size: 10,
        font,
      });
    }
    const bytes = await doc.save();
    const counted = (await extractPdfText(bytes)).characterCount;
    // Health: a real count, so equality below means THIS document's count.
    expect(counted).toBeGreaterThan(100);

    const network = await openBuilder(bytes);
    fireEvent.change(nameInput(1), { target: { value: "Total" } });
    await waitFor(() =>
      expect(extractButton()).not.toHaveAttribute("aria-disabled"),
    );
    fireEvent.click(extractButton());

    await waitFor(() => expect(network.jobBodies).toHaveLength(1));
    expect(network.jobBodies[0]!.tool).toBe("ai-extract");
    expect(network.jobBodies[0]!.declaredCharacters).toBe(counted);
  });
});
