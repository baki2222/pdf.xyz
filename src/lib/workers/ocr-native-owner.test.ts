// @vitest-environment node
/**
 * The OCR runner on a restricted PDF sent with its owner password
 * (competitor-audit backlog #11). The native tools are stand-ins: OCRmyPDF
 * records the bytes it was handed, and qpdf is a fake `ownerCrypt` whose
 * decrypt returns a plain PDF and whose encrypt returns what a test chooses
 * — the qpdf-made fixture itself (restricted exactly like the upload), or a
 * copy that is not. The password checks and the read-back are the real ones,
 * over the qpdf- and pypdf-made fixtures.
 *
 * THE RULE: only a verified OWNER password reaches qpdf. Every refusal below
 * asserts that NOTHING was started — no decrypt, no OCRmyPDF.
 */
import { describe, expect, it } from "vitest";
import type { OcrOptions } from "@/lib/jobs/ocr";
import {
  RESTRICTED_FIXTURES,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { OcrEngineRefusal } from "./ocr-engine-errors";
import {
  createNativeOcrRunner,
  nativeOcrDeps,
  type NativeOcrFs,
  type OcrOwnerCrypt,
} from "./ocr-native";
import type { NativeOcrConfig } from "./ocr-native-config";
import type { QpdfOwnerOnlyInput } from "./pdf-security/native";
import type { ProcessorInputFile } from "./processor/types";

const cfg: NativeOcrConfig = {
  enabled: true,
  binaries: { ocrmypdf: "ocrmypdf", tesseract: "tesseract" },
  overridden: { ocrmypdf: false, tesseract: false },
  timeoutMs: 300_000,
  maxInputBytes: 200 * 1024 * 1024,
  maxOutputBytes: 500 * 1024 * 1024,
};

const R6 = RESTRICTED_FIXTURES.find((f) => f.file === "qpdf-r6-aes256.pdf")!;
const R6_BYTES = readRestrictedFixture(R6.file);
const PLAIN = new TextEncoder().encode(`%PDF-1.7\n${"p".repeat(64)}\n%%EOF\n`);
const OCRED = new TextEncoder().encode(`%PDF-1.7\n${"o".repeat(64)}\n%%EOF\n`);
const TEXT = new TextEncoder().encode("recognised words");

const options = (over: Partial<OcrOptions> = {}): OcrOptions => ({
  languages: ["eng"],
  outputMode: "searchable-pdf",
  redoOcr: false,
  deskew: false,
  rotatePages: false,
  ...over,
});

const input = (
  bytes: Uint8Array,
  filename = "Scan.pdf",
): ProcessorInputFile => ({
  fileId: "f_1234567890",
  filename,
  contentType: filename.endsWith(".png") ? "image/png" : "application/pdf",
  bytes,
});

interface Harness {
  run: ReturnType<typeof createNativeOcrRunner>;
  /** The bytes each OCR engine start was handed (its input file). */
  engineInputs: Uint8Array[];
  decrypts: string[];
  encrypts: QpdfOwnerOnlyInput[];
  encryptedInputs: Uint8Array[];
}

function harness(
  encryptReturns: Uint8Array = R6_BYTES,
  withCrypt = true,
): Harness {
  const files = new Map<string, Uint8Array>();
  const engineInputs: Uint8Array[] = [];
  const decrypts: string[] = [];
  const encrypts: QpdfOwnerOnlyInput[] = [];
  const encryptedInputs: Uint8Array[] = [];
  const fs: NativeOcrFs = {
    mkdtemp: async (prefix) => `${prefix}t`,
    writeFile: async (file, data) => {
      files.set(file, data);
    },
    readFile: async (file) => files.get(file) ?? new Uint8Array(0),
    rm: async () => {},
  };
  const ownerCrypt: OcrOwnerCrypt = {
    unlock: async (_bytes, opts) => {
      decrypts.push(opts.password);
      return { ok: true, output: PLAIN };
    },
    encryptOwnerOnly: async (bytes, opts) => {
      encryptedInputs.push(bytes);
      encrypts.push(opts);
      return encryptReturns;
    },
  };
  const run = createNativeOcrRunner(cfg, {
    resolveOnPath: () => true,
    fs,
    countPages: async () => 1,
    exec: async (_command, args) => {
      const inputPath = args.find((a) => /input\.(pdf|png)$/.test(a));
      engineInputs.push(files.get(inputPath ?? "") ?? new Uint8Array(0));
      const pdfOut = args.find((a) => a.endsWith("output.pdf"));
      if (pdfOut) files.set(pdfOut, OCRED);
      const txt = args.find((a) => /output\.txt$/.test(a));
      if (txt) files.set(txt, TEXT);
      return {};
    },
    ...(withCrypt ? { ownerCrypt } : {}),
  });
  return { run, engineInputs, decrypts, encrypts, encryptedInputs };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OcrEngineRefusal) return error.kind;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the owner password: verified, decrypted, OCRed, restricted again", () => {
  it("decrypts only with the verified password, hands OCRmyPDF the plain copy, and delivers qpdf's restricted copy", async () => {
    const h = harness();
    const result = await h.run({
      options: options({ ownerPassword: R6.owner }),
      inputs: [input(R6_BYTES)],
    });
    expect(h.decrypts).toEqual([R6.owner]);
    // OCRmyPDF read the DECRYPTED copy, never the upload.
    expect(h.engineInputs).toEqual([PLAIN]);
    // The searchable output went to qpdf with the author's grant.
    expect(h.encryptedInputs).toEqual([OCRED]);
    expect(h.encrypts).toEqual([
      {
        ownerPassword: R6.owner,
        grant: {
          print: "full",
          modify: false,
          copy: false,
          annotate: true,
          fillForms: true,
          accessibility: true,
          assemble: false,
        },
      },
    ]);
    expect(result.artifacts.map((a) => a.bytes)).toEqual([R6_BYTES]);
    expect(result.artifacts[0]!.filename).toBe("Scan-ocr.pdf");
  });

  it("the text file is read from the decrypted copy, beside the restricted PDF", async () => {
    const h = harness();
    const result = await h.run({
      options: options({ outputMode: "both", ownerPassword: R6.owner }),
      inputs: [input(R6_BYTES)],
    });
    expect(result.artifacts.map((a) => a.contentType)).toEqual([
      "application/pdf",
      "text/plain; charset=utf-8",
    ]);
    expect(result.artifacts[1]!.bytes).toEqual(TEXT);
  });

  it("NEVER delivers a copy that is not restricted like the upload (read-back)", async () => {
    for (const lie of [
      PLAIN,
      readRestrictedFixture("qpdf-r6-view-only.pdf"),
      readRestrictedFixture("qpdf-r3-rc4-128.pdf"),
    ]) {
      const h = harness(lie);
      await expect(
        h.run({
          options: options({ ownerPassword: R6.owner }),
          inputs: [input(R6_BYTES)],
        }),
      ).rejects.toThrow("OCR could not restore the PDF's restrictions.");
    }
  });
});

describe("everything else decrypts NOTHING", () => {
  it("a wrong password: refused before qpdf or OCRmyPDF start", async () => {
    const h = harness();
    expect(
      await refusal(
        h.run({
          options: options({ ownerPassword: "not-the-owner" }),
          inputs: [input(R6_BYTES)],
        }),
      ),
    ).toBe("wrong-owner-password");
    expect(h.decrypts.length + h.engineInputs.length).toBe(0);
  });

  it("a file whose owner password is empty: no typed password lifts it", async () => {
    const h = harness();
    expect(
      await refusal(
        h.run({
          options: options({ ownerPassword: "anything" }),
          inputs: [
            input(readRestrictedFixture("pypdf-r6-aes256-empty-owner.pdf")),
          ],
        }),
      ),
    ).toBe("wrong-owner-password");
    expect(h.decrypts.length + h.engineInputs.length).toBe(0);
  });

  it("a file that needs an open password: today's password-protected refusal, even with its owner password", async () => {
    const h = harness();
    expect(
      await refusal(
        h.run({
          options: options({ ownerPassword: "owner-both-test" }),
          inputs: [
            input(readRestrictedFixture("pypdf-r6-aes256-both-passwords.pdf")),
          ],
        }),
      ),
    ).toBe("encrypted");
    expect(h.decrypts.length + h.engineInputs.length).toBe(0);
  });

  it("no qpdf on this worker: refused as restricted, nothing decrypted or run", async () => {
    const h = harness(R6_BYTES, false);
    expect(
      await refusal(
        h.run({
          options: options({ ownerPassword: R6.owner }),
          inputs: [input(R6_BYTES)],
        }),
      ),
    ).toBe("restricted");
    expect(h.engineInputs.length).toBe(0);
  });

  it("qpdf itself says wrong password: refused, nothing run", async () => {
    const h = harness();
    const run = createNativeOcrRunner(cfg, {
      resolveOnPath: () => true,
      exec: async () => {
        throw new Error("must not start");
      },
      ownerCrypt: {
        unlock: async () => ({ ok: false, reason: "wrong-password" }),
        encryptOwnerOnly: async () => R6_BYTES,
      },
    });
    expect(
      await refusal(
        run({
          options: options({ ownerPassword: R6.owner }),
          inputs: [input(R6_BYTES)],
        }),
      ),
    ).toBe("wrong-owner-password");
    expect(h.decrypts.length).toBe(0);
  });

  it("an image input: the field is ignored, no qpdf call", async () => {
    const h = harness();
    // A tiny PNG signature is enough to route to Tesseract; the image path
    // may refuse the bytes, but qpdf must never be asked.
    await h
      .run({
        options: options({ ownerPassword: R6.owner }),
        inputs: [input(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "a.png")],
      })
      .catch(() => {});
    expect(h.decrypts.length + h.encrypts.length).toBe(0);
  });

  it("no owner password: the upload goes to OCRmyPDF as it is (today's path)", async () => {
    const h = harness();
    await h.run({ options: options(), inputs: [input(R6_BYTES)] });
    expect(h.engineInputs).toEqual([R6_BYTES]);
    expect(h.decrypts.length + h.encrypts.length).toBe(0);
  });
});

describe("nativeOcrDeps wires qpdf only when the host has it", () => {
  const env = { PDFXYZ_OCR: "on" };
  it("qpdf absent: the runner gets no ownerCrypt (a restricted job is refused)", async () => {
    const deps = nativeOcrDeps(env, {
      resolveOnPath: (bin) => bin !== "qpdf",
      qpdf: { resolveOnPath: () => false, fileExists: () => false },
      readExistingText: async () => ({ pages: [] }),
      fs: {
        mkdtemp: async (p) => `${p}x`,
        writeFile: async () => {},
        readFile: async () => new Uint8Array(0),
        rm: async () => {},
      },
      exec: async () => {
        throw new Error("must not start");
      },
    });
    await expect(
      deps.runner!({
        options: options({ ownerPassword: R6.owner }),
        inputs: [input(R6_BYTES)],
      }),
    ).rejects.toBeInstanceOf(OcrEngineRefusal);
  });

  it("qpdf present: the same job reaches qpdf (POSITIVE CONTROL for the case above)", async () => {
    const seen: string[][] = [];
    const deps = nativeOcrDeps(env, {
      resolveOnPath: () => true,
      qpdf: {
        resolveOnPath: () => true,
        exec: async (_c, args) => {
          seen.push([...args]);
          return { code: 2, timedOut: false };
        },
        fs: {
          mkdtemp: async (p) => `${p}q`,
          writeFile: async () => {},
          readFile: async () => new Uint8Array(0),
          rm: async () => {},
        },
      },
      readExistingText: async () => ({ pages: [] }),
    });
    await deps.runner!({
      options: options({ ownerPassword: R6.owner }),
      inputs: [input(R6_BYTES)],
    }).catch(() => {});
    expect(seen.length).toBeGreaterThan(0);
    // Every call through the at-file: the password on no command line.
    for (const args of seen) {
      expect(args).toHaveLength(1);
      expect(args[0]!.startsWith("@")).toBe(true);
      expect(args.join(" ")).not.toContain(R6.owner);
    }
  });
});
