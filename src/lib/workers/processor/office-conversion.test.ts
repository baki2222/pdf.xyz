import { describe, expect, it, vi } from "vitest";
import {
  createOfficeConversionProcessor,
  officePdfOutputName,
} from "./office-conversion";
import { createNativeLibreOfficePdfRunner } from "../office-conversion/native";
import type { NativeOfficeConversionConfig } from "../office-conversion/native-config";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const DOCX = new TextEncoder().encode("docx");

describe("office-conversion processor", () => {
  it("owns Word/Excel/PowerPoint to PDF and reports readiness", () => {
    const processor = createOfficeConversionProcessor({
      libreoffice: { convertToPdf: vi.fn(async () => PDF) },
    });
    expect(processor.tools).toEqual([
      "word-to-pdf",
      "excel-to-pdf",
      "powerpoint-to-pdf",
    ]);
    expect(processor.supports("word-to-pdf")).toBe(true);
    expect(processor.supports("excel-to-pdf")).toBe(true);
    expect(processor.supports("powerpoint-to-pdf")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "office-conversion",
      ready: true,
    });
  });

  it("fails honestly without LibreOffice", async () => {
    const result = await createOfficeConversionProcessor({}).process({
      tool: "word-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "report.docx",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes: DOCX,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("converts one Office input into a PDF artifact", async () => {
    const convertToPdf = vi.fn(async () => PDF);
    const result = await createOfficeConversionProcessor({
      libreoffice: { convertToPdf },
    }).process({
      tool: "word-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "quarterly.report.docx",
          contentType: "application/octet-stream",
          bytes: DOCX,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(convertToPdf).toHaveBeenCalledWith(DOCX, "quarterly.report.docx");
    if (result.ok) {
      expect(result.artifacts[0]).toMatchObject({
        filename: "quarterly.report.pdf",
        contentType: "application/pdf",
      });
      expect(result.meta).toMatchObject({
        engine: "libreoffice",
        tool: "word-to-pdf",
      });
    }
  });

  it("rejects multiple files and wrong extensions", async () => {
    const processor = createOfficeConversionProcessor({
      libreoffice: { convertToPdf: vi.fn(async () => PDF) },
    });
    const none = await processor.process({
      tool: "word-to-pdf",
      options: {},
      inputs: [],
    });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.code).toBe("unprocessable_entity");
    const wrong = await processor.process({
      tool: "excel-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "report.docx",
          contentType: "application/octet-stream",
          bytes: DOCX,
        },
      ],
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(officePdfOutputName("report.final.docx")).toBe("report.final.pdf");
  });
});

/**
 * The composed chain the executor sees: the REAL native runner (its exec and
 * fs seams stubbed the way `execFile` and `fs/promises` answer), the engine,
 * then this processor's retry decision.
 *
 * Every LibreOffice failure used to leave the runner as one untyped `Error`,
 * the engine collapsed it to `failed`, and this processor marked `failed`
 * retryable. So a password-protected or corrupt deck — the same bytes, the
 * same answer, every time — was converted three times with backoff, and a
 * deck that hit the 120 s timeout was retried into ~370 s of worker time, three
 * times the browser's wait. The user waited through all of it and read "could
 * not convert", with no word about the password.
 */
describe("office-conversion processor — failures that repeat are final", () => {
  const CONFIG: NativeOfficeConversionConfig = {
    enabled: true,
    candidates: ["soffice"],
    overridden: false,
    timeoutMs: 120_000,
    maxInputBytes: 10_000,
    maxOutputBytes: 1_000,
    tmpDir: "/tmp",
  };
  const PPTX_TYPE =
    "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  function fs(
    readFile: () => Promise<Uint8Array> = async () => PDF,
    mkdtemp: () => Promise<string> = async () => "/tmp/pdfxyz-office-1",
  ) {
    return {
      mkdtemp: vi.fn(mkdtemp),
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(readFile),
      rm: vi.fn(async () => {}),
    };
  }

  async function convert(
    seams: {
      exec?: () => Promise<{ code: number; timedOut: boolean }>;
      fs?: ReturnType<typeof fs>;
    },
    filename = "deck.pptx",
    bytes: Uint8Array = DOCX,
  ) {
    const exec = vi.fn(
      seams.exec ?? (async () => ({ code: 0, timedOut: false })),
    );
    const libreoffice = createNativeLibreOfficePdfRunner(CONFIG, {
      exec,
      fs: seams.fs ?? fs(),
      resolveOnPath: () => true,
    });
    const result = await createOfficeConversionProcessor({
      libreoffice,
      limits: { maxInputBytes: CONFIG.maxInputBytes },
    }).process({
      tool: "powerpoint-to-pdf",
      options: {},
      inputs: [{ fileId: "f", filename, contentType: PPTX_TYPE, bytes }],
    });
    return { result, exec };
  }

  function errorOf(result: Awaited<ReturnType<typeof convert>>["result"]) {
    if (result.ok) throw new Error("expected a failure");
    return result.error;
  }

  const enoent = () =>
    Promise.reject(
      Object.assign(new Error("no such file"), { code: "ENOENT" }),
    );

  it("a non-zero exit is final, and says what to try", async () => {
    const error = errorOf(
      (await convert({ exec: async () => ({ code: 1, timedOut: false }) }))
        .result,
    );
    expect(error).toMatchObject({
      code: "unprocessable_entity",
      retryable: false,
    });
    expect(error.message).toMatch(/password/i);
    expect(error.message).toMatch(/\.pptx/);
  });

  it("exit 0 with no output file (LibreOffice's answer to an unloadable file) is final", async () => {
    expect(errorOf((await convert({ fs: fs(enoent) })).result)).toMatchObject({
      code: "unprocessable_entity",
      retryable: false,
    });
  });

  it("output that is not a PDF is final", async () => {
    expect(
      errorOf(
        (
          await convert({
            fs: fs(async () => new TextEncoder().encode("nope")),
          })
        ).result,
      ),
    ).toMatchObject({ code: "unprocessable_entity", retryable: false });
  });

  it("a timeout is final — the same deck times out again on the same worker", async () => {
    const error = errorOf(
      (await convert({ exec: async () => ({ code: -1, timedOut: true }) }))
        .result,
    );
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/too long/i);
  });

  it("output over the worker's ceiling is final: payload_too_large", async () => {
    expect(
      errorOf(
        (
          await convert({
            fs: fs(async () => {
              const big = new Uint8Array(CONFIG.maxOutputBytes + 1);
              big.set(PDF);
              return big;
            }),
          })
        ).result,
      ),
    ).toMatchObject({ code: "payload_too_large", retryable: false });
  });

  it("POSITIVE CONTROL: an IO failure and a signal kill stay retryable", async () => {
    const io = errorOf(
      (
        await convert({
          fs: fs(undefined, () =>
            Promise.reject(Object.assign(new Error("io"), { code: "EIO" })),
          ),
        })
      ).result,
    );
    expect(io).toMatchObject({ code: "internal_error", retryable: true });
    const killed = errorOf(
      (await convert({ exec: async () => ({ code: -1, timedOut: false }) }))
        .result,
    );
    expect(killed).toMatchObject({ code: "internal_error", retryable: true });
  });

  it("an encrypted .pptx is named password-protected before LibreOffice runs", async () => {
    const { result, exec } = await convert({}, "deck.pptx", encryptedOoxml());
    const error = errorOf(result);
    expect(error).toMatchObject({ retryable: false });
    expect(error.message).toMatch(/password-protected/);
    expect(error.message).toMatch(/PowerPoint/);
    expect(exec).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL: a legacy .ppt is a compound file too, and still converts", async () => {
    const { result, exec } = await convert(
      {},
      "deck.ppt",
      compoundFile("PowerPoint Document"),
    );
    expect(result.ok).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("never hands a user a repository path", async () => {
    const result = await createOfficeConversionProcessor({}).process({
      tool: "powerpoint-to-pdf",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "deck.pptx",
          contentType: PPTX_TYPE,
          bytes: DOCX,
        },
      ],
    });
    expect(errorOf(result).message).not.toMatch(/docs\/|\.md\b/);
  });
});

/** The OLE compound-file signature, then a directory entry name in UTF-16LE. */
function compoundFile(streamName: string): Uint8Array {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const name = [...streamName].flatMap((c) => [c.charCodeAt(0), 0]);
  const bytes = new Uint8Array(1024);
  bytes.set(magic, 0);
  bytes.set(name, 512);
  return bytes;
}

/** What Office writes for a password-protected .docx/.xlsx/.pptx. */
function encryptedOoxml(): Uint8Array {
  const info = compoundFile("EncryptionInfo");
  const pkg = compoundFile("EncryptedPackage");
  const out = new Uint8Array(1024);
  out.set(info.subarray(0, 600));
  out.set(pkg.subarray(512, 600), 640);
  return out;
}
