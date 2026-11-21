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
import { observeFor } from "@/tests/time-bound";

/**
 * The timeout every wait in this file passes (CI-flake lane 3): its panels'
 * lazy chunks load cold per file in the native-canvas project, where waits have
 * outrun the 1 s default on CI (sign-runner's took 1855 ms in run 44931945692).
 *
 * CI: the wait-headroom blocks of the 5 instrumented runs (44917160721,
 * 44924793701, 44931945692, 44938151052, 44941026100) list no wait in this file
 * above 500 ms, half the 1 s default most of them ran under. Its slowest test
 * took 1829 ms (run 44331878323, a passing run, "restricted file, worker proves
 * it"; 108 CI runs, passing and failing, to 11-21), most of it outside any
 * wait, so the test alone does not hold its waits to 2x. 3 s is 6x the waits
 * seen (five samples; re-harvest before tightening), and stays below every
 * test's own timeout, so a wait that times out fails with its DOM dump.
 */
const WAIT_MS = 3_000;

/** OCR PDF's ready badge (`readyLabel` in ocr-worker-panel.tsx): shown once the status says OCR is on. */
const OCR_READY_BADGE = "Available";

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

async function addFile(
  bytes: Uint8Array | File,
  name = bytes instanceof File ? bytes.name : "scan.pdf",
) {
  render(
    <InToolPage tool={ocrTool}>
      <OcrWorkerPanel tool={ocrTool} />
    </InToolPage>,
  );
  const input = await vi.waitFor(
    () => {
      const found = readyFileInput();
      if (!found) throw new Error("no file input yet");
      return found;
    },
    { timeout: WAIT_MS },
  );
  // The live worker's answer is in before the file is chosen, so the panel
  // knows it may offer the field (a test of Run's gap is blind otherwise).
  // WAS: the status request seen, then a 50 ms sleep for its answer to land.
  // The shell's badge reads the same status the field does: once it says
  // "Available", the answer is in the panel's state, on any runner.
  await screen.findByText(
    OCR_READY_BADGE,
    { selector: "span" },
    { timeout: WAIT_MS },
  );
  fireEvent.change(input, {
    target: {
      files: [
        bytes instanceof File
          ? bytes
          : new File([bytes.slice()], name, { type: "application/pdf" }),
      ],
    },
  });
  await screen.findByText(name, {}, { timeout: WAIT_MS });
}

/**
 * A file whose bytes are held back until `release()`: the Owner password
 * field's probe cannot answer before then, which stretches the gap between
 * choosing a file and the probe's answer that a person can click into.
 */
function heldFile(bytes: Uint8Array, name = "scan.pdf") {
  let release!: () => void;
  let asked = 0;
  const gate = new Promise<void>((r) => (release = r));
  const file = new File([bytes.slice()], name, { type: "application/pdf" });
  const read = file.arrayBuffer.bind(file);
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => {
      asked += 1;
      await gate;
      return read();
    },
  });
  /**
   * The probe has asked for the bytes: the lazy field has mounted and its
   * probe is under way, held at the gate. From here until `release()`, the
   * gap between choosing a file and the probe's answer is OPEN — the moment
   * the review finding below was about, reached by an event, not a sleep.
   */
  const probing = () =>
    vi.waitFor(
      () => expect(asked, "the probe asked for the bytes").toBeGreaterThan(0),
      {
        timeout: WAIT_MS,
      },
    );
  return { file, release, probing };
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
    await waitFor(
      () => expect(runButton()).toHaveAttribute("aria-disabled", "true"),
      { timeout: WAIT_MS },
    );
    fireEvent.change(input, { target: { value: OWNER } });
    await waitFor(
      () => expect(runButton()).not.toHaveAttribute("aria-disabled"),
      { timeout: WAIT_MS },
    );
    fireEvent.click(runButton());
    await screen.findByText(/OCR complete/, {}, { timeout: 10_000 });
    expect(net.sent).toEqual([
      expect.objectContaining({ ownerPassword: OWNER }),
    ]);
    expect(net.decrypts).toEqual([OWNER]);
    // The engine read the decrypted copy, never the restricted upload.
    expect(net.engineInputs).toEqual([PLAIN]);
  }, 20_000);

  it("a wrong password: the worker's refusal is shown, nothing decrypted", async () => {
    const net = stubNetwork(true, RESTRICTED);
    await addFile(RESTRICTED);
    const input = await screen.findByLabelText(
      OWNER_PASSWORD_LABEL,
      {},
      { timeout: 10_000 },
    );
    fireEvent.change(input, { target: { value: "not-the-owner" } });
    await waitFor(
      () => expect(runButton()).not.toHaveAttribute("aria-disabled"),
      { timeout: WAIT_MS },
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
  }, 20_000);

  it("restricted file, worker does NOT prove it: no field, no key, and today's refusal", async () => {
    const net = stubNetwork(false, RESTRICTED);
    await addFile(RESTRICTED);
    await waitFor(
      () => expect(runButton()).not.toHaveAttribute("aria-disabled"),
      { timeout: WAIT_MS },
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
  }, 20_000);

  // Review finding (2026-11-18): Run was live for about 0.7 s after a
  // restricted PDF was chosen, before the field's probe had answered, and a
  // click in that gap posted the job with no owner password.
  it("Run waits for the field's probe: a click before it answers posts no job", async () => {
    const net = stubNetwork(true, RESTRICTED);
    const held = heldFile(RESTRICTED);
    await addFile(held.file);
    // WAS a 300 ms sleep: the gap is open once the probe is held at the gate.
    await held.probing();
    expect(field()).toBeNull();
    expect(runButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(runButton());
    // A declared absence window: a job a click had started would reserve
    // its upload (POST /api/uploads, no bytes needed) and post within a few
    // stubbed round trips; the bytes stay held, so nothing else moves.
    await observeFor(
      "ocr-owner-click-in-gap-posts-nothing",
      300,
      "a click on Run while the owner-password probe is held posts no job",
    );
    expect(net.sent).toEqual([]);
    held.release();
    await screen.findByLabelText(OWNER_PASSWORD_LABEL, {}, { timeout: 10_000 });
    expect(runButton()).toHaveAttribute("aria-disabled", "true");
    expect(net.sent).toEqual([]);
  }, 20_000);

  it("POSITIVE CONTROL: the same held probe, on an unrestricted PDF, frees Run once it answers", async () => {
    const net = stubNetwork(true, PLAIN);
    const held = heldFile(PLAIN);
    await addFile(held.file);
    await held.probing();
    expect(runButton()).toHaveAttribute("aria-disabled", "true");
    held.release();
    await waitFor(
      () => expect(runButton()).not.toHaveAttribute("aria-disabled"),
      { timeout: WAIT_MS },
    );
    expect(field()).toBeNull();
    fireEvent.click(runButton());
    await screen.findByText(/OCR complete/, {}, { timeout: 10_000 });
    expect(net.sent).toHaveLength(1);
    expect("ownerPassword" in net.sent[0]!).toBe(false);
  }, 20_000);

  it("an unrestricted PDF, worker proves it: no field, no key", async () => {
    const net = stubNetwork(true, PLAIN);
    await addFile(PLAIN);
    await waitFor(
      () => expect(runButton()).not.toHaveAttribute("aria-disabled"),
      { timeout: WAIT_MS },
    );
    // Run is free, so the probe has answered "not restricted"; a field shown
    // for it anyway would be a lazy chunk away. A declared window, as main
    // had: the slowest test here took 1829 ms on CI (run 44331878323), this
    // one 883 ms (run 44321190257).
    await observeFor(
      "ocr-owner-unrestricted-no-field",
      500,
      "an unrestricted PDF, once probed, shows no Owner password field",
    );
    expect(field()).toBeNull();
    fireEvent.click(runButton());
    await screen.findByText(/OCR complete/, {}, { timeout: 10_000 });
    expect("ownerPassword" in net.sent[0]!).toBe(false);
  }, 20_000);
});
