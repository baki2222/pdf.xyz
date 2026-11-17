// @vitest-environment jsdom
// @native-canvas
/**
 * OCR PDF's Owner password field for a restricted PDF (competitor-audit
 * backlog #11), pressed as a person presses it: the panel, the REAL browser
 * client, and the job the REAL processor registry runs from the options the
 * client sent — through the REAL native OCR runner and its REAL owner-
 * password check, over a qpdf-made restricted fixture. Played: the network
 * hops, the OCRmyPDF process (it records the bytes it was handed) and qpdf
 * (decrypt returns a plain PDF; encrypt returns the fixture itself, which IS
 * restricted exactly like the upload).
 *
 * The composed chain is the point: the field, the request, the sealed-option
 * key, the worker's check, and the decrypted bytes reaching the engine.
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { Job } from "@/lib/jobs/types";
import { OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { OWNER_PASSWORD_LABEL } from "@/lib/pdf/owner-password-copy";
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
import { OCR_REFUSAL_MESSAGES } from "@/lib/workers/ocr-engine-errors";
import type { NativeOcrConfig } from "@/lib/workers/ocr-native-config";
import { readRestrictedFixture } from "@/tests/restricted-pdf-fixtures";
import { readyFileInput } from "@/tests/worker-ready";
import { OCR_OWNER_HINT } from "./ocr-owner-password";
import { OcrWorkerPanel } from "./ocr-worker-panel";

const ocrTool = getToolBySlug("ocr-pdf")!;
const providers = getProviderReadiness("remote-configured");
const RESTRICTED = readRestrictedFixture("qpdf-r6-aes256.pdf");
const OWNER = "owner-r6-test";
const PLAIN = readRestrictedFixture("base.pdf");
const OUT_PDF = new TextEncoder().encode(
  `%PDF-1.7\n${"x".repeat(64)}\n%%EOF\n`,
);

const status = (ocrOwnerPassword: boolean): WorkerStatus => ({
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
  ocrOwnerPassword,
});

const CONFIG: NativeOcrConfig = {
  enabled: true,
  binaries: { ocrmypdf: "ocrmypdf", tesseract: "tesseract" },
  overridden: { ocrmypdf: false, tesseract: false },
  timeoutMs: 60_000,
  maxInputBytes: 10 * 1024 * 1024,
  maxOutputBytes: 10 * 1024 * 1024,
};

function stubNetwork(capability: boolean, upload: Uint8Array) {
  const files = new Map<string, Uint8Array>();
  const engineInputs: Uint8Array[] = [];
  const decrypts: string[] = [];
  const fs: NativeOcrFs = {
    mkdtemp: async (prefix) => `${prefix}job1`,
    writeFile: async (file, data) => {
      files.set(file, data);
    },
    readFile: async (file) => files.get(file) ?? OUT_PDF,
    rm: async () => {},
  };
  const runner = createNativeOcrRunner(CONFIG, {
    resolveOnPath: () => true,
    fs,
    countPages: async () => 1,
    exec: async (_command, args) => {
      const input = args.find((a) => /input\.pdf$/.test(a));
      engineInputs.push(files.get(input ?? "") ?? new Uint8Array(0));
      const out = args.find((a) => a.endsWith("output.pdf"));
      if (out) files.set(out, OUT_PDF);
      // OCRmyPDF refuses any encrypted input (exit 8).
      if (
        input &&
        new TextDecoder("latin1").decode(files.get(input)).includes("/Encrypt")
      )
        throw Object.assign(new Error("Command failed"), {
          code: 8,
          killed: false,
          signal: null,
          stderr: "",
        });
    },
    ownerCrypt: {
      unlock: async (_bytes, opts) => {
        decrypts.push(opts.password);
        return { ok: true, output: PLAIN };
      },
      encryptOwnerOnly: async () => RESTRICTED,
    },
  });
  const processor = createProcessorRegistry({
    ocr: {
      runner,
      engines: { ocrmypdf: true, tesseract: true },
      installedLanguages: [...OCR_LANGUAGE_CODES],
    },
  }).resolve("ocr-pdf")!;
  const sent: Record<string, unknown>[] = [];
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: ArrayBuffer }) => {
      if (url === "/api/worker/status") return json(status(capability));
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
              filename: "scan.pdf",
              contentType: "application/pdf",
              bytes: upload,
            },
          ],
        });
        const base = {
          jobId: "job_1",
          tool: "ocr-pdf",
          capability: "worker",
          progress: 100,
          createdAt: "2026-11-17T00:00:00.000Z",
          updatedAt: "2026-11-17T00:00:00.000Z",
        };
        if (!result.ok)
          return json({ ...base, status: "failed", error: result.error });
        return json({
          ...base,
          status: "completed",
          artifacts: result.artifacts.map((a, i) => ({
            artifactId: `a${i}`,
            filename: a.filename,
            contentType: a.contentType,
            bytes: a.bytes.byteLength,
            url: `/download/a${i}`,
            expiresAt: "2026-11-17T01:00:00.000Z",
          })),
          results: sanitizeJobResults(result.results),
        } as unknown as Job);
      }
      if (url.startsWith("/download/"))
        return {
          ...json({}),
          arrayBuffer: async () => RESTRICTED.slice().buffer,
        };
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return { sent, engineInputs, decrypts };
}

async function addFile(bytes: Uint8Array, name = "scan.pdf") {
  render(
    <InToolPage tool={ocrTool}>
      <OcrWorkerPanel tool={ocrTool} />
    </InToolPage>,
  );
  const input = await vi.waitFor(() => {
    const found = readyFileInput();
    if (!found) throw new Error("no file input yet");
    return found;
  });
  fireEvent.change(input, {
    target: {
      files: [new File([bytes.slice()], name, { type: "application/pdf" })],
    },
  });
  await screen.findByText(name);
}

const runButton = () => screen.getByRole("button", { name: /recognize text/i });
const field = () => screen.queryByLabelText(OWNER_PASSWORD_LABEL);

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("OCR PDF's Owner password field: panel → job → worker", () => {
  it("restricted file, worker proves it: the field appears, Run waits for it, and the job carries the password the worker decrypts with", async () => {
    const net = stubNetwork(true, RESTRICTED);
    await addFile(RESTRICTED);
    const input = await screen.findByLabelText(
      OWNER_PASSWORD_LABEL,
      {},
      { timeout: 10_000 },
    );
    expect(screen.getByText(OCR_OWNER_HINT)).toBeInTheDocument();
    await waitFor(() =>
      expect(runButton()).toHaveAttribute("aria-disabled", "true"),
    );
    fireEvent.change(input, { target: { value: OWNER } });
    await waitFor(() =>
      expect(runButton()).not.toHaveAttribute("aria-disabled"),
    );
    fireEvent.click(runButton());
    await screen.findByText(/OCR complete/, {}, { timeout: 10_000 });
    expect(net.sent).toEqual([
      expect.objectContaining({ ownerPassword: OWNER }),
    ]);
    expect(net.decrypts).toEqual([OWNER]);
    // The engine read the decrypted copy, never the restricted upload.
    expect(net.engineInputs).toEqual([PLAIN]);
  });

  it("a wrong password: the worker's refusal is shown, nothing decrypted", async () => {
    const net = stubNetwork(true, RESTRICTED);
    await addFile(RESTRICTED);
    const input = await screen.findByLabelText(
      OWNER_PASSWORD_LABEL,
      {},
      { timeout: 10_000 },
    );
    fireEvent.change(input, { target: { value: "not-the-owner" } });
    await waitFor(() =>
      expect(runButton()).not.toHaveAttribute("aria-disabled"),
    );
    fireEvent.click(runButton());
    expect(
      await screen.findByText(
        OCR_REFUSAL_MESSAGES["wrong-owner-password"],
        { exact: false },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(net.decrypts).toEqual([]);
    expect(net.engineInputs).toEqual([]);
  });

  it("restricted file, worker does NOT prove it: no field, no key, and today's refusal", async () => {
    const net = stubNetwork(false, RESTRICTED);
    await addFile(RESTRICTED);
    await waitFor(() =>
      expect(runButton()).not.toHaveAttribute("aria-disabled"),
    );
    expect(field()).toBeNull();
    fireEvent.click(runButton());
    expect(
      await screen.findByText(
        OCR_REFUSAL_MESSAGES.restricted,
        { exact: false },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(net.sent).toHaveLength(1);
    expect("ownerPassword" in net.sent[0]!).toBe(false);
    expect(net.decrypts).toEqual([]);
  });

  it("an unrestricted PDF, worker proves it: no field, no key", async () => {
    const net = stubNetwork(true, PLAIN);
    await addFile(PLAIN);
    await waitFor(() =>
      expect(runButton()).not.toHaveAttribute("aria-disabled"),
    );
    // Give the lazy field and its probe time to decide.
    await new Promise((r) => setTimeout(r, 500));
    expect(field()).toBeNull();
    fireEvent.click(runButton());
    await screen.findByText(/OCR complete/, {}, { timeout: 10_000 });
    expect("ownerPassword" in net.sent[0]!).toBe(false);
  });
});
