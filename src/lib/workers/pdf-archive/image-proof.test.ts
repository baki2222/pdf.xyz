import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
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

/** The rotation fixture is the only proof input with a /Rotate in it. */
const isRotationFixture = (input: Uint8Array) =>
  new TextDecoder("latin1").decode(input).includes("/Rotate");

type Shape = { size: [number, number]; rotate: number };
/**
 * What Ghostscript 10.00.0 wrote for `rotationProofPdf()` (612x792 /Rotate 90,
 * 792x612 twice, 612x792) through the PDF/A runner, in a throwaway container of
 * the production worker image (2026-11-06), read back with pdf-lib. Rendered
 * at 24 dpi against the input: every BAKED page matches (mean |diff| at most
 * 0.21 out of 255); TURNED's first three display portrait where the input is
 * landscape.
 */
const BAKED: Shape[] = [
  // -dAutoRotatePages=/None: the /Rotate 90 moved into the page content.
  { size: [792, 612], rotate: 0 },
  { size: [792, 612], rotate: 0 },
  { size: [792, 612], rotate: 0 },
  { size: [612, 792], rotate: 0 },
];
const TURNED: Shape[] = [
  // The argv with no flag (/PageByPage): the sideways pages turned upright.
  { size: [792, 612], rotate: 270 },
  { size: [792, 612], rotate: 90 },
  { size: [792, 612], rotate: 90 },
  { size: [612, 792], rotate: 0 },
];

/** A PDF/A-declared file with these pages: a played Ghostscript's output. */
async function declaredWith(pages: readonly Shape[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(DECLARED, { updateMetadata: false });
  doc.removePage(0);
  for (const p of pages) doc.addPage(p.size).setRotation(degrees(p.rotate));
  return doc.save({ useObjectStreams: false });
}

/** A stand-in for Ghostscript + qpdf that behaves per input, like the real pair. */
function engine(opts: {
  output?: () => Uint8Array;
  lockedReason?: "password_required" | "engine_exit";
  restrictedReason?: "password_required" | null;
  /** What it writes for the rotation fixture. Default: BAKED, as gs does with the flag. */
  rotation?: readonly Shape[] | "undeclared";
}): PdfArchiveDeps {
  const ghostscript: GhostscriptPdfARunner = {
    convertToPdfA: vi.fn(async (input: Uint8Array) => {
      if (isRotationFixture(input)) {
        const rotation = opts.rotation ?? BAKED;
        return {
          bytes:
            rotation === "undeclared"
              ? UNDECLARED
              : await declaredWith(rotation),
          notes: [],
        };
      }
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

async function prove(
  deps: PdfArchiveDeps,
  withEncrypt = true,
  /** The engine without -dAutoRotatePages. Default: one that turns, as gs did. */
  autoRotating: PdfArchiveDeps | null = engine({ rotation: TURNED }),
) {
  const lines: string[] = [];
  const code = await runPdfAImageProof(deps, {
    ...(withEncrypt ? { encrypt } : {}),
    ...(autoRotating ? { autoRotating } : {}),
    log: (l) => lines.push(l),
  });
  return { code, lines };
}

const line = (lines: string[], prefix: string) =>
  lines.some((l) => l.startsWith(prefix));

describe("worker:pdfa-proof verdict", () => {
  it("POSITIVE CONTROL: passes when every check holds", async () => {
    const { code, lines } = await prove(engine({}));
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(code).toBe(PDFA_PROOF_PASS);
    expect(lines.filter((l) => l.startsWith("PASS"))).toHaveLength(6);
    // The orientation checks ran, by name.
    for (const name of [
      "rotation fixture",
      "rotation control",
      "rotation kept",
    ])
      expect(line(lines, `PASS ${name}:`), name).toBe(true);
  });

  it("FAILS a Ghostscript that turns the fixture's sideways pages (the production argv's measured output)", async () => {
    const { code, lines } = await prove(engine({ rotation: TURNED }));
    expect(code).toBe(PDFA_PROOF_FAIL);
    expect(line(lines, "FAIL rotation kept:")).toBe(true);
    // The fixture and the control still pass: the failure is the orientation,
    // not a broken run.
    expect(line(lines, "PASS rotation fixture:")).toBe(true);
    expect(line(lines, "PASS rotation control:")).toBe(true);
  });

  it("FAILS when the conversion without -dAutoRotatePages turns nothing: 'rotation kept' could not fail", async () => {
    const { code, lines } = await prove(
      engine({}),
      true,
      engine({ rotation: BAKED }),
    );
    expect(code).toBe(PDFA_PROOF_FAIL);
    expect(line(lines, "FAIL rotation control:")).toBe(true);
    expect(line(lines, "PASS rotation kept:")).toBe(true);
  });

  it("FAILS, not skips, when no engine without -dAutoRotatePages is wired", async () => {
    const { code, lines } = await prove(engine({}), true, null);
    expect(code).toBe(PDFA_PROOF_FAIL);
    expect(line(lines, "FAIL rotation control:")).toBe(true);
  });

  it("FAILS when the rotation fixture does not convert", async () => {
    // The played gs returns no PDF/A for it, so the engine's gate refuses it.
    const { code, lines } = await prove(engine({ rotation: "undeclared" }));
    expect(code).toBe(PDFA_PROOF_FAIL);
    expect(line(lines, "FAIL rotation run: failed/not_pdfa")).toBe(true);
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
