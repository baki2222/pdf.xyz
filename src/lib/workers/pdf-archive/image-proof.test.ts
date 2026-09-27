import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import {
  GhostscriptRunError,
  type GhostscriptPdfARunner,
  type PdfArchiveDeps,
} from "./engine";
import {
  PDFA_PROOF_FAIL,
  PDFA_PROOF_PASS,
  PDFA_PROOF_UNAVAILABLE,
  pdfaProofInput,
  runPdfAImageProof,
} from "./image-proof";
import { declaredPdfA, withoutOutputIntent } from "@/tests/pdfa-fixtures";

/**
 * The in-image proof's own controls. It runs with a real Ghostscript only in
 * the container workflow; here its VERDICT logic is proven able to go red, so
 * a green in CI means Ghostscript passed, not that the proof could not fail.
 */
const tagged = (tag: string) =>
  new TextEncoder().encode(`%PDF-1.7\n%${tag}\ntrailer<<>>\n%%EOF\n`);
const LOCKED = tagged("locked");
const RESTRICTED = tagged("restricted");

let DECLARED: Uint8Array;
let UNDECLARED: Uint8Array;
beforeAll(async () => {
  DECLARED = await declaredPdfA();
  UNDECLARED = await withoutOutputIntent();
});

/** A stand-in for Ghostscript + qpdf that behaves per input, like the real pair. */
function engine(opts: {
  output?: () => Uint8Array;
  lockedReason?: "password_required" | "engine_exit";
  restrictedReason?: "password_required" | null;
}): PdfArchiveDeps {
  const ghostscript: GhostscriptPdfARunner = {
    convertToPdfA: vi.fn(async (input: Uint8Array) => {
      const tag = new TextDecoder().decode(input);
      if (tag.includes("%locked"))
        throw new GhostscriptRunError(
          opts.lockedReason ?? "password_required",
          "x",
        );
      if (tag.includes("%restricted") && opts.restrictedReason)
        throw new GhostscriptRunError(opts.restrictedReason, "x");
      return { bytes: (opts.output ?? (() => DECLARED))(), notes: [] };
    }),
  };
  return { ghostscript };
}

const encrypt = vi.fn(async (_bytes: Uint8Array, user: string) =>
  user === "" ? RESTRICTED : LOCKED,
);

async function prove(deps: PdfArchiveDeps, withEncrypt = true) {
  const lines: string[] = [];
  const code = await runPdfAImageProof(deps, {
    ...(withEncrypt ? { encrypt } : {}),
    log: (l) => lines.push(l),
  });
  return { code, lines };
}

describe("worker:pdfa-proof verdict", () => {
  it("POSITIVE CONTROL: passes when every check holds", async () => {
    const { code, lines } = await prove(engine({}));
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(code).toBe(PDFA_PROOF_PASS);
    expect(lines.filter((l) => l.startsWith("PASS"))).toHaveLength(3);
  });

  it("fails when the conversion does not declare PDF/A-2b — the pre-fix output", async () => {
    const { code, lines } = await prove(engine({ output: () => UNDECLARED }));
    expect(code).toBe(PDFA_PROOF_FAIL);
    expect(lines.join("\n")).toMatch(/FAIL plain document/);
  });

  it("fails when an open-password file is not recognised as one", async () => {
    const { code } = await prove(engine({ lockedReason: "engine_exit" }));
    expect(code).toBe(PDFA_PROOF_FAIL);
  });

  it("fails when a permissions-only file is refused as password-protected", async () => {
    const { code, lines } = await prove(
      engine({ restrictedReason: "password_required" }),
    );
    expect(code).toBe(PDFA_PROOF_FAIL);
    expect(lines.join("\n")).toMatch(/FAIL permissions-only/);
  });

  it("fails, not skips, when qpdf is not wired — the image requires it", async () => {
    const { code } = await prove(engine({}), false);
    expect(code).toBe(PDFA_PROOF_FAIL);
  });

  it("reports an image without the engine as unavailable, never as a pass", async () => {
    const { code } = await prove({});
    expect(code).toBe(PDFA_PROOF_UNAVAILABLE);
  });

  it("feeds Ghostscript a document with device RGB colour — what an OutputIntent is for", async () => {
    const doc = await PDFDocument.load(await pdfaProofInput());
    const contents = doc.getPage(0).node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    // Health check: there IS page content to read.
    expect(streams.length).toBeGreaterThan(0);
    const ops = streams
      .map((stream) => {
        expect(stream).toBeInstanceOf(PDFRawStream);
        return new TextDecoder().decode(
          decodePDFRawStream(stream as PDFRawStream).decode(),
        );
      })
      .join("\n");
    // `r g b rg` sets a device-RGB fill: colour with no ICC behind it.
    expect(ops).toMatch(/[\d.]+ [\d.]+ [\d.]+ rg/);
  });
});
