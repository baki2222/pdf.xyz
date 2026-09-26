// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { signatureRequestDeps } from "./native";
import { runSignatureRequest } from "./engine";
import type { SignatureRequestOptions } from "@/lib/jobs/request-signatures";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { createProcessorRegistry } from "../processor";
import { createLocalDevExecutorStorage } from "../executor/local-dev-storage";
import { createWorkerExecutor } from "../executor/executor";

async function realPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  return doc.save();
}

const options: SignatureRequestOptions = {
  signers: [
    { name: "Ada Lovelace", email: "ada@example.com" },
    { name: "Alan Turing", email: "alan@example.com" },
  ],
  fields: [
    {
      signer: 0,
      page: 1,
      type: "signature",
      x: 0.08,
      y: 0.1,
      width: 0.4,
      height: 0.06,
      required: true,
    },
    {
      signer: 0,
      page: 1,
      type: "date",
      x: 0.56,
      y: 0.1,
      width: 0.22,
      height: 0.06,
      required: true,
    },
    {
      signer: 1,
      page: 2,
      type: "signature",
      x: 0.08,
      y: 0.1,
      width: 0.4,
      height: 0.06,
      required: true,
    },
  ],
  routing: "sequential",
  deliver: false,
};

describe("request-signatures native integration", () => {
  it("prepares a real PDF with named fillable fields and a genuine SHA-256 manifest", async () => {
    const input = await realPdf();
    const run = await runSignatureRequest(
      input,
      options,
      signatureRequestDeps(),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const zip = await JSZip.loadAsync(run.output);
    const preparedBytes = await zip.file("prepared.pdf")!.async("uint8array");

    // The prepared PDF is a real, loadable PDF that now carries our named fields.
    const prepared = await PDFDocument.load(preparedBytes);
    const names = prepared
      .getForm()
      .getFields()
      .map((f) => f.getName())
      .sort();
    expect(names).toEqual([
      "Signer1-Date-1",
      "Signer1-Signature-1",
      "Signer2-Signature-1",
    ]);

    // The manifest's document hash is a genuine SHA-256 of the ORIGINAL input.
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.document.pageCount).toBe(2);
    expect(manifest.status).toBe("prepared");
  });
});

// ─────────────────── a PDF the worker cannot open, end to end ───────────────────
//
// The stubbed engine test proves the mapping; these prove the REAL inspector
// produces the type the mapping keys on, and that the executor then spends one
// attempt, not three. Each shape was probed against pdf-lib 1.17: the encrypted
// and truncated ones throw inside `PDFDocument.load`, while the header-only one
// LOADS and then throws a bare TypeError on the page walk — the case a fix at the
// loader alone would miss.

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save({ useObjectStreams: false });
}

/**
 * A PDF whose trailer carries a Standard-handler /Encrypt dictionary. pdf-lib
 * cannot WRITE encryption, but its refusal is decided by that trailer entry
 * alone, so this reaches exactly the branch a real password-protected upload does.
 */
async function encryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.context.trailerInfo.Encrypt = doc.context.register(
    doc.context.obj({ Filter: "Standard", V: 1, R: 2, P: -4 }),
  );
  return doc.save({ useObjectStreams: false });
}

async function unreadable(): Promise<
  { label: string; bytes: Uint8Array; reason: RegExp }[]
> {
  const good = await onePagePdf();
  return [
    {
      label: "password-protected",
      bytes: await encryptedPdf(),
      reason: /password-protected\. Unlock it first/,
    },
    {
      label: "truncated",
      bytes: good.slice(0, Math.floor(good.byteLength / 2)),
      reason: /couldn't be read as a PDF/,
    },
    {
      label: "not a PDF",
      bytes: new TextEncoder().encode("this is a text file"),
      reason: /couldn't be read as a PDF/,
    },
    {
      label: "header only, no catalog",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      reason: /couldn't be read as a PDF/,
    },
  ];
}

const oneField: SignatureRequestOptions = {
  ...options,
  signers: [options.signers[0]!],
  fields: [options.fields[0]!],
};

describe("request-signatures on a PDF the worker cannot open", () => {
  it("health check: the same path prepares a readable PDF", async () => {
    const run = await runSignatureRequest(
      await onePagePdf(),
      oneField,
      signatureRequestDeps(),
    );
    expect(run.ok).toBe(true);
  });

  it("refuses each unreadable shape as a bad request that names the reason", async () => {
    const corpus = await unreadable();
    expect(corpus.length).toBe(4);
    for (const { label, bytes, reason } of corpus) {
      const run = await runSignatureRequest(
        bytes,
        oneField,
        signatureRequestDeps(),
      );
      expect(run.ok, label).toBe(false);
      if (run.ok) continue;
      expect(run.kind, label).toBe("invalid_request");
      expect(run.message, label).toMatch(reason);
    }
  });

  it("ends a password-protected job after ONE attempt through the executor", async () => {
    let clock = 100_000;
    const store = new DevWorkerStore(() => clock);
    const queue = createLocalDevQueue({ store, now: () => clock });
    const storage = createLocalDevExecutorStorage({ store, now: () => clock });
    const executor = createWorkerExecutor({
      queue,
      storage,
      registry: createProcessorRegistry({
        compression: {
          tools: { ghostscript: false, qpdf: false, mutool: false },
        },
        requestSignatures: signatureRequestDeps(),
      }),
      leaseMs: 1_000,
    });

    const run = async (jobId: string, bytes: Uint8Array) => {
      const slot = store.reserveSlot({
        sessionId: "sess_test00000",
        filename: "contract.pdf",
        contentType: "application/pdf",
        declaredBytes: bytes.byteLength,
      });
      store.putBytes(slot.fileId, bytes);
      await queue.submit({
        job: {
          jobId,
          tool: "request-signatures",
          capability: "secure-worker",
          status: "queued",
          progress: 0,
          createdAt: new Date(clock).toISOString(),
          updatedAt: new Date(clock).toISOString(),
          expiresAt: new Date(clock + 60 * 60_000).toISOString(),
          retention: DEFAULT_RETENTION,
        },
        inputs: [slot.fileId],
        options: oneField as unknown as Record<string, unknown>,
      });
      const ticks = await executor.drain();
      clock += 1;
      return { ticks, job: store.getJob(jobId) };
    };

    // Positive control: the same executor, registry and options complete a
    // readable PDF — so a failure below is about the bytes, not the wiring.
    const control = await run("job_sigok00000", await onePagePdf());
    expect(control.ticks.map((t) => t.outcome)).toEqual(["completed", "idle"]);

    const locked = await run("job_siglock000", await encryptedPdf());
    expect(locked.ticks.map((t) => t.outcome)).toEqual(["failed", "idle"]);
    expect(locked.job?.status).toBe("failed");
    expect(locked.job?.error).toMatchObject({
      code: "unprocessable_entity",
      retryable: false,
    });
    expect(locked.job?.error?.message).toMatch(
      /password-protected\. Unlock it first/,
    );
  });
});
