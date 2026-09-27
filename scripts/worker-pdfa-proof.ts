/**
 * `pnpm worker:pdfa-proof` — convert a generated document to PDF/A with the
 * REAL Ghostscript, ICC profile and output gate, inside the built worker image.
 * See `src/lib/workers/pdf-archive/image-proof.ts` for what it proves and why.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = the engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { nativePdfArchiveDeps } from "@/lib/workers/pdf-archive/native";
import {
  pdfaProofInput,
  runPdfAImageProof,
} from "@/lib/workers/pdf-archive/image-proof";
import { qpdfWroteOutput } from "@/lib/workers/qpdf-exit";

/**
 * The proof input plus a line of standard-font text. pdf-lib does NOT embed
 * the standard 14 fonts, and PDF/A requires every font embedded — so this is
 * the ordinary case where Ghostscript has to do real work to make the file
 * conform, not just stamp a declaration on it.
 */
async function proofInputWithText(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await pdfaProofInput(), {
    updateMetadata: false,
  });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .getPage(0)
    .drawText("pdf.xyz PDF/A image proof", { x: 40, y: 220, size: 16, font });
  return doc.save();
}

/** Encrypt with qpdf. Fixed proof-only passwords; never a user's. */
async function qpdfEncrypt(
  bytes: Uint8Array,
  user: string,
  owner: string,
): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-pdfa-proof-"));
  try {
    const input = path.join(dir, "in.pdf");
    const output = path.join(dir, "out.pdf");
    await writeFile(input, bytes);
    // Resolve with qpdf's exit status instead of rejecting on any non-zero
    // one: 3 means "warnings, output written" and the encrypted file is there
    // (`qpdf-exit.ts`). A spawn failure or a timeout resolves as a failure.
    const result = await new Promise<{ code: number; timedOut: boolean }>(
      (resolve) => {
        execFile(
          "qpdf",
          ["--encrypt", user, owner, "256", "--", input, output],
          { timeout: 30_000, windowsHide: true },
          (error: (Error & { code?: unknown; killed?: boolean }) | null) =>
            resolve({
              code:
                error === null
                  ? 0
                  : typeof error.code === "number"
                    ? error.code
                    : -1,
              timedOut: error?.killed === true,
            }),
        );
      },
    );
    if (!qpdfWroteOutput(result)) throw new Error("qpdf encryption failed");
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

proofInputWithText()
  .then((input) =>
    runPdfAImageProof(nativePdfArchiveDeps(process.env), {
      encrypt: qpdfEncrypt,
      input,
    }),
  )
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
