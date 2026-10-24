/**
 * The in-image options proof must be able to FAIL on each defect it exists
 * for. It runs for real only in the worker image (container.yml); here the
 * two binaries are played, correctly first, then wrongly one way at a time —
 * a proof that passes the wrong engines proves nothing in the image either.
 */
import { describe, expect, it } from "vitest";
import {
  PDF_PERMISSION_BITS,
  PDF_PERMISSION_KEYS,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import { colourImagePdf } from "@/lib/workers/compression/colour-image-pdf";
import type { NativeCompressor } from "./compression/engine";
import type { QpdfRunner } from "./pdf-security/engine";
import { readEncryptPermissions } from "./pdf-security/permission-bits";
import { runWorkerOptionsProof, type OptionsProofDeps } from "./options-proof";

const enc = (s: string) => new TextEncoder().encode(s);

function pFor(perms: PdfPermissions): number {
  let p = -4;
  for (const key of PDF_PERMISSION_KEYS)
    if (!perms[key])
      for (const bit of PDF_PERMISSION_BITS[key]) p &= ~(1 << (bit - 1));
  return p;
}

const encryptedWithP = (p: number) =>
  enc(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n9 0 obj\n<< /Filter /Standard /V 5 /R 6 /P ${p} >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n${"0".repeat(64)}\n%%EOF\n`,
  );

/** Ghostscript, played: gray when asked, smaller colour otherwise. */
const ghostscript: NativeCompressor = async (_input, ctx) =>
  ctx.options.grayscale
    ? colourImagePdf({ components: 1, size: 96, pages: 2 })
    : colourImagePdf({ components: 3, size: 48, pages: 2 });

function qpdf(writeP: (perms: PdfPermissions) => number): QpdfRunner {
  const outputs = new Set<Uint8Array>();
  return {
    isEncrypted: async (b) => outputs.has(b),
    requiresPassword: async (b) =>
      outputs.has(b) ? "needs-password" : "not-encrypted",
    protect: async (_b, opts) => {
      const out = encryptedWithP(writeP(opts.permissions!));
      outputs.add(out);
      return out;
    },
    unlock: async () => ({ ok: false, reason: "wrong-password" }),
  };
}

function deps(over: Partial<OptionsProofDeps> = {}): OptionsProofDeps {
  return {
    compression: {
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native: ghostscript,
    },
    pdfSecurity: { qpdf: qpdf(pFor) },
    qpdfShowP: async (bytes) => readEncryptPermissions(bytes),
    log: () => {},
    ...over,
  };
}

describe("runWorkerOptionsProof", () => {
  it("passes engines that do what they are asked", async () => {
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(deps({ log: (l) => lines.push(l) })),
    ).toBe(0);
    // Health: every check ran, not just the first.
    expect(
      lines.filter((l) => l.startsWith("PASS")).length,
    ).toBeGreaterThanOrEqual(12);
  });

  it("FAILS a Ghostscript that ignores grayscale", async () => {
    const ignoring: NativeCompressor = async () =>
      colourImagePdf({ components: 3, size: 48, pages: 2 });
    expect(
      await runWorkerOptionsProof(
        deps({
          compression: {
            tools: { ghostscript: true, qpdf: false, mutool: false },
            native: ignoring,
          },
        }),
      ),
    ).toBe(1);
  });

  it("FAILS a qpdf that writes an all-allowed /P whatever it was asked", async () => {
    expect(
      await runWorkerOptionsProof(
        deps({ pdfSecurity: { qpdf: qpdf(() => -4) } }),
      ),
    ).toBe(1);
  });

  it("FAILS when qpdf's own reading of /P disagrees with ours", async () => {
    expect(
      await runWorkerOptionsProof(deps({ qpdfShowP: async () => -1 })),
    ).toBe(1);
  });

  it("says MISSING (2), not FAIL, in an image without Ghostscript or qpdf", async () => {
    expect(
      await runWorkerOptionsProof(
        deps({
          compression: {
            tools: { ghostscript: false, qpdf: true, mutool: true },
          },
        }),
      ),
    ).toBe(2);
    expect(await runWorkerOptionsProof(deps({ pdfSecurity: {} }))).toBe(2);
  });
});
