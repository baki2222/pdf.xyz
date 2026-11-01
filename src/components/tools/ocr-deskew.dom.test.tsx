// @vitest-environment jsdom
/**
 * OCR PDF's "Straighten crooked pages", pressed as a person presses it: the
 * panel, the REAL browser client, and the job the REAL processor registry
 * runs from the options the client sent — through the REAL native runner, so
 * the assertion is on the argv OCRmyPDF (or Tesseract) would be started
 * with. Played: the network hops, the subprocess (its argv recorded, its
 * output a minimal PDF) and the temp-file operations.
 *
 * The composed chain is the point (house rule: verify the chain, not the
 * unit): `nativeOcrArgs` emitting `--deskew` is tested on its own in
 * `ocr-native.test.ts`, and that says nothing about whether ticking the box
 * gets the flag to the engine.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { Job } from "@/lib/jobs/types";
import {
  OCR_DESKEW_WITH_REDO_MESSAGE,
  OCR_LANGUAGE_CODES,
} from "@/lib/jobs/ocr";
import { sanitizeJobResults } from "@/lib/jobs/results";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";
import { createProcessorRegistry } from "@/lib/workers/processor";
import {
  createNativeOcrRunner,
  type NativeOcrFs,
} from "@/lib/workers/ocr-native";
import type { NativeOcrConfig } from "@/lib/workers/ocr-native-config";
import { readyFileInput } from "@/tests/worker-ready";
import { OcrWorkerPanel } from "./ocr-worker-panel";

const ocrTool = getToolBySlug("ocr-pdf")!;
const providers = getProviderReadiness("remote-configured");

const STATUS: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A server backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: {
    available: true,
    engine: "ocrmypdf",
    languages: [...OCR_LANGUAGE_CODES],
    detail: "OCR ready on ocrmypdf.",
  },
  security: {
    available: false,
    operations: ["protect", "unlock"],
    detail: "not here",
  },
  providers: {
    ...providers,
    storage: { ...providers.storage, ready: true },
    queue: { ...providers.queue, ready: true },
  },
  daemon: { ...resolveDaemonReadiness({}), drainable: true },
  ai: resolveAiReadiness({}),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no server observed",
  },
};

const CONFIG: NativeOcrConfig = {
  enabled: true,
  binaries: { ocrmypdf: "ocrmypdf", tesseract: "tesseract" },
  overridden: { ocrmypdf: false, tesseract: false },
  timeoutMs: 60_000,
  maxInputBytes: 10 * 1024 * 1024,
  maxOutputBytes: 10 * 1024 * 1024,
};

/** Minimal bytes that satisfy the runner's structural PDF check. */
const OUT_PDF = new TextEncoder().encode(
  `%PDF-1.7\n${"x".repeat(64)}\n%%EOF\n`,
);

const memFs: NativeOcrFs = {
  mkdtemp: async (prefix) => `${prefix}job1`,
  writeFile: async () => {},
  readFile: async () => OUT_PDF,
  rm: async () => {},
};

/** The worker: the real registry, the real native runner, a recorded exec. */
function worker() {
  const argv: { command: string; args: readonly string[] }[] = [];
  const runner = createNativeOcrRunner(CONFIG, {
    resolveOnPath: () => true,
    fs: memFs,
    countPages: async () => 1,
    exec: async (command, args) => {
      argv.push({ command, args });
    },
  });
  const registry = createProcessorRegistry({
    ocr: {
      runner,
      engines: { ocrmypdf: true, tesseract: true },
      installedLanguages: [...OCR_LANGUAGE_CODES],
    },
  });
  return { processor: registry.resolve("ocr-pdf")!, argv };
}

function stubNetwork(contentType: string) {
  const { processor, argv } = worker();
  const sent: Record<string, unknown>[] = [];
  const failures: string[] = [];
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: ArrayBuffer }) => {
      if (url === "/api/worker/status") return json(STATUS);
      if (url === "/api/uploads")
        return json({
          sessionId: "s1",
          tool: "ocr-pdf",
          slots: [
            {
              fileId: "f1",
              filename: "scan",
              url: "/upload/f1",
              method: "PUT",
              headers: {},
            },
          ],
        });
      if (url === "/upload/f1") return json({});
      if (url === "/api/jobs") {
        const body = JSON.parse(
          new TextDecoder().decode(init!.body as ArrayBuffer),
        );
        sent.push(body.options);
        const result = await processor.process({
          tool: "ocr-pdf",
          options: body.options,
          inputs: [
            {
              fileId: "f1",
              filename: "scan",
              contentType,
              bytes: new Uint8Array([1, 2, 3]),
            },
          ],
        });
        const base = {
          jobId: "job_1",
          tool: "ocr-pdf",
          capability: "worker",
          progress: 100,
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        };
        if (!result.ok) {
          failures.push(result.error.message);
          return json({ ...base, status: "failed", error: result.error });
        }
        return json({
          ...base,
          status: "completed",
          artifacts: result.artifacts.map((a, i) => ({
            artifactId: `a${i}`,
            filename: a.filename,
            contentType: a.contentType,
            bytes: a.bytes.byteLength,
            url: `/download/a${i}`,
            expiresAt: "2026-11-01T01:00:00.000Z",
          })),
          results: sanitizeJobResults(result.results),
        } as unknown as Job);
      }
      if (url.startsWith("/download/"))
        return { ...json({}), arrayBuffer: async () => OUT_PDF.slice().buffer };
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return { sent, argv, failures };
}

async function addFile(name: string, type: string) {
  render(<OcrWorkerPanel tool={ocrTool} />);
  const input = await vi.waitFor(() => {
    const found = readyFileInput();
    if (!found) throw new Error("no file input yet");
    return found;
  });
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array([1, 2, 3])], name, { type })] },
  });
  await screen.findByText(name);
}

const deskewBox = () =>
  screen.getByRole("checkbox", { name: /straighten crooked pages/i });
const redoBox = () =>
  screen.getByRole("checkbox", { name: /redo existing ocr/i });
const run = () =>
  fireEvent.click(screen.getByRole("button", { name: /recognize text/i }));

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("OCR PDF: Straighten crooked pages, panel → job → processor → argv", () => {
  it("control: off by default, and OCRmyPDF is started without --deskew", async () => {
    const net = stubNetwork("application/pdf");
    await addFile("scan.pdf", "application/pdf");
    expect(deskewBox()).not.toBeChecked();
    run();
    await screen.findByText(/OCR complete/);
    expect(net.sent).toEqual([expect.objectContaining({ deskew: false })]);
    expect(net.argv).toHaveLength(1);
    expect(net.argv[0]!.command).toBe("ocrmypdf");
    expect(net.argv[0]!.args).not.toContain("--deskew");
  });

  it("ticked: the job carries deskew and OCRmyPDF is started with --deskew beside --skip-text", async () => {
    const net = stubNetwork("application/pdf");
    await addFile("scan.pdf", "application/pdf");
    fireEvent.click(deskewBox());
    expect(deskewBox()).toBeChecked();
    expect(
      screen.getByText(/straighten crooked pages$/, { selector: "p" }),
    ).toBeInTheDocument();
    run();
    await screen.findByText(/OCR complete/);
    expect(net.sent).toEqual([
      expect.objectContaining({ deskew: true, redoOcr: false }),
    ]);
    expect(net.argv).toHaveLength(1);
    const args = net.argv[0]!.args;
    expect(args).toContain("--deskew");
    expect(args).toContain("--skip-text");
    expect(args).not.toContain("--redo-ocr");
  });

  it("the panel never lets both be on: each box turns the other off", async () => {
    stubNetwork("application/pdf");
    await addFile("scan.pdf", "application/pdf");
    // Positive control: both start enabled.
    expect(deskewBox()).not.toHaveAttribute("aria-disabled");
    expect(redoBox()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(deskewBox());
    expect(redoBox()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(deskewBox());
    expect(redoBox()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(redoBox());
    expect(deskewBox()).toHaveAttribute("aria-disabled", "true");
    expect(deskewBox()).not.toBeChecked();
    // Guarded, not merely marked: a press on the blocked box changes nothing.
    fireEvent.click(deskewBox());
    expect(deskewBox()).not.toBeChecked();
    expect(redoBox()).toBeChecked();
  });

  it("an image is read by Tesseract as it is: the box is off for it and no deskew travels", async () => {
    const net = stubNetwork("image/png");
    await addFile("photo.png", "image/png");
    expect(deskewBox()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(deskewBox());
    expect(deskewBox()).not.toBeChecked();
    expect(
      screen.getByText(/off for this file: a jpg or png is read as it is/i),
    ).toBeInTheDocument();
    run();
    await screen.findByText(/OCR complete/);
    expect(net.sent).toEqual([expect.objectContaining({ deskew: false })]);
    expect(net.argv[0]!.command).toBe("tesseract");
    expect(net.argv[0]!.args.some((a) => /deskew/i.test(a))).toBe(false);
  });

  it("a forged job asking for both is refused, final, before any engine starts", async () => {
    const { processor, argv } = worker();
    const result = await processor.process({
      tool: "ocr-pdf",
      options: { languages: ["eng"], redoOcr: true, deskew: true },
      inputs: [
        {
          fileId: "f1",
          filename: "scan.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(false);
      expect(result.error.message).toBe(OCR_DESKEW_WITH_REDO_MESSAGE);
    }
    expect(argv).toEqual([]);
    // Positive control: the same processor does start the engine for one alone.
    const alone = await processor.process({
      tool: "ocr-pdf",
      options: { languages: ["eng"], deskew: true },
      inputs: [
        {
          fileId: "f1",
          filename: "scan.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    expect(alone.ok).toBe(true);
    await waitFor(() => expect(argv).toHaveLength(1));
    expect(argv[0]!.args).toContain("--deskew");
  });
});
