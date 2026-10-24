/**
 * `pnpm worker:options-proof` — compress-pdf's Grayscale and protect-pdf's
 * permission restrictions through the REAL Ghostscript and qpdf, inside the
 * built worker image. See `src/lib/workers/options-proof.ts` for what it
 * proves and why.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nativeCompressionDeps } from "@/lib/workers/compression/native";
import { nativePdfSecurityDeps } from "@/lib/workers/pdf-security/native";
import { runWorkerOptionsProof } from "@/lib/workers/options-proof";

/**
 * qpdf's own `--show-encryption` reading of /P. Its stdout is parsed for the
 * one `P = <int>` line and nothing else is kept or printed. The password is a
 * fixed proof-only value (`options-proof.ts`), never a user's.
 */
async function qpdfShowP(
  bytes: Uint8Array,
  ownerPassword: string,
): Promise<number | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-options-proof-"));
  try {
    const file = path.join(dir, "in.pdf");
    await writeFile(file, bytes);
    const stdout = await new Promise<string>((resolve) => {
      execFile(
        "qpdf",
        [`--password=${ownerPassword}`, "--show-encryption", file],
        { timeout: 30_000, windowsHide: true },
        (_error, out) => resolve(typeof out === "string" ? out : ""),
      );
    });
    const m = /^\s*P = (-?\d+)\s*$/m.exec(stdout);
    return m ? Number(m[1]) : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

runWorkerOptionsProof({
  compression: nativeCompressionDeps(process.env),
  pdfSecurity: nativePdfSecurityDeps(process.env),
  qpdfShowP,
})
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
