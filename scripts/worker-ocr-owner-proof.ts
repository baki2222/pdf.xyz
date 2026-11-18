/**
 * `pnpm worker:ocr-owner-proof` — OCR PDF on a restricted PDF with its owner
 * password (competitor-audit backlog #11), through the built worker image's
 * REAL OCRmyPDF and qpdf, via the registry's OCR processor wired as the
 * daemon wires it, judged by reading the delivered PDF back in Node. See
 * `src/lib/workers/ocr-owner-proof.ts` for what it proves and why.
 *
 * The inputs are made HERE by the image's own qpdf, with a positional argv
 * (`--encrypt "" <owner> <bits> …`) that is not the runner's named one, so
 * the proof's inputs and the runner's output never share a code path; plus
 * the repository's qpdf-made revision 2 fixture. The owner passwords are
 * test values.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nativeOcrDeps } from "@/lib/workers/ocr-native";
import { runOcrOwnerProof } from "@/lib/workers/ocr-owner-proof";
import { defaultQpdfExec, probeQpdf } from "@/lib/workers/pdf-security/native";
import { readEncryptPermissions } from "@/lib/workers/pdf-security/permission-bits";
import { resolveNativePdfTextExtractor } from "@/lib/workers/pdf-text/native";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { SCANNED_LINE, scannedTextPdf } from "@/tests/word-ocr-proof-fixtures";
import { readRestrictedFixture } from "@/tests/restricted-pdf-fixtures";

/** Run qpdf on one input in a temp dir; the output's bytes, or null. */
async function qpdf(
  input: Uint8Array,
  argv: (inPath: string, outPath: string) => string[],
): Promise<{ code: number; output: Uint8Array | null }> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-owner-proof-"));
  try {
    const inPath = path.join(dir, "in.pdf");
    const outPath = path.join(dir, "out.pdf");
    await writeFile(inPath, input);
    const { code } = await defaultQpdfExec("qpdf", argv(inPath, outPath), {
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    const output = await readFile(outPath)
      .then((b) => new Uint8Array(b))
      .catch(() => null);
    return { code, output };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function restrict(
  scan: Uint8Array,
  owner: string,
  bits: "256" | "128",
  switches: string[],
): Promise<Uint8Array> {
  const { output } = await qpdf(scan, (i, o) => [
    "--allow-weak-crypto",
    "--encrypt",
    "",
    owner,
    bits,
    ...(bits === "128" ? ["--use-aes=n"] : []),
    ...switches,
    "--",
    i,
    o,
  ]);
  if (!output) throw new Error(`qpdf did not write the ${bits}-bit input`);
  return output;
}

async function main(): Promise<number> {
  // OCR is opt-in at run time (`PDFXYZ_OCR`); the image ships the engines,
  // and this proof turns them on exactly as the deployed worker's env does.
  const env = { ...process.env, PDFXYZ_OCR: "on" };
  const ocr = createProcessorRegistry({ ocr: nativeOcrDeps(env) }).resolve(
    "ocr-pdf",
  );
  if (!ocr || !probeQpdf(env)) {
    console.log(
      "CANNOT CONCLUDE — no OCR processor, or no qpdf, in this image.",
    );
    return 2;
  }
  const scan = await scannedTextPdf();
  const aes = await restrict(scan, "owner-proof-aes256", "256", [
    "--print=low",
    "--extract=n",
    "--assemble=n",
    "--modify-other=n",
  ]);
  const rc4 = await restrict(scan, "owner-proof-rc4-128", "128", [
    "--print=full",
    "--extract=n",
    "--annotate=n",
    "--form=y",
  ]);
  const r2 = readRestrictedFixture("qpdf-r2-rc4-40.pdf");
  const p = (bytes: Uint8Array): number => {
    const value = readEncryptPermissions(bytes);
    if (value === null) throw new Error("an input carries no /P");
    return value;
  };
  const extract = resolveNativePdfTextExtractor(process.env);
  return runOcrOwnerProof({
    ocr,
    inputs: [
      {
        name: "AES-256 scan",
        bytes: aes,
        owner: "owner-proof-aes256",
        p: p(aes),
        r: 6,
        line: SCANNED_LINE,
      },
      {
        name: "RC4 128-bit scan",
        bytes: rc4,
        owner: "owner-proof-rc4-128",
        p: p(rc4),
        r: 3,
        line: SCANNED_LINE,
      },
      {
        name: "RC4 40-bit fixture (revision 2)",
        bytes: r2,
        owner: "owner-r2-test",
        p: p(r2),
        r: 2,
        line: null,
      },
    ],
    openPassword: {
      bytes: readRestrictedFixture("pypdf-r6-aes256-both-passwords.pdf"),
      owner: "owner-both-test",
    },
    requiresPasswordExit: async (pdf) =>
      (await qpdf(pdf, (i) => ["--requires-password", i])).code,
    decrypt: async (pdf, password) => {
      const { output } = await qpdf(pdf, (i, o) => [
        `--password=${password}`,
        "--decrypt",
        i,
        o,
      ]);
      if (!output) throw new Error("qpdf could not decrypt the output");
      return output;
    },
    pdfText: extract ? async (pdf) => (await extract(pdf)).text : null,
  });
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
