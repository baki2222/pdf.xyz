/**
 * `pnpm worker:ocr-owner-proof` — OCR PDF on a restricted PDF with its owner
 * password (competitor-audit backlog #11), asked of the BUILT worker image's
 * own OCRmyPDF and qpdf, and judged by reading the delivered file back in
 * Node: its /P bits, its encryption, its owner password, and its text.
 *
 * WHY. The start-up proof (`./ocr-owner-capability`, the heartbeat's
 * `ocrOwnerPassword`) stands both processes in with recorders: it proves the
 * runner's order and argv, not what qpdf 11 writes for them. Whether qpdf
 * accepts the argv at all, leaves the open password EMPTY, writes AES-256,
 * and sets each restriction switch, only the real qpdf can answer. It did
 * not, the first time (2026-11-18): the runner used the named
 * `--owner-password=` / `--bits=` options, which the image's qpdf 11.3.0
 * refuses, and this proof failed 5/8 while every unit test and the
 * start-up probe passed. The argv is now the positional form.
 *
 * For each restricted input (built in the image by its own qpdf from a
 * scanned page, with a positional argv that is NOT the runner's, plus the
 * repository's qpdf-made RC4 40-bit fixture):
 *
 *   1. INSTRUMENT — the input's /P, read from its bytes, is the one asked
 *      for, it opens with no password, and the owner password is its owner
 *      password. Otherwise nothing below means anything.
 *   2. THE OWNER PASSWORD — through the registry's OCR processor (the one
 *      the daemon wires): completed, and the delivered PDF
 *        - carries /Encrypt, V5 R6 AES-256 (never weaker than the input);
 *        - opens with NO password, as a viewer's user, and qpdf itself says
 *          so (`--requires-password` exits 3: encrypted, the empty password
 *          opens it);
 *        - takes the typed password as its OWNER password;
 *        - has /P bits 3, 4, 5, 6, 9, 11 and 12 equal to the input's, read
 *          as raw bits (revision 2 through ISO 32000-1 Table 22), and bit 10
 *          set (PDF 2.0 writers set it);
 *        - decrypted with that password, reads back the scan's words
 *          (pdftotext), so OCR ran on the decrypted file.
 *   3. A WRONG PASSWORD — refused, final, with the wrong-owner refusal.
 *   4. NO PASSWORD (control) — refused with the restricted refusal by the
 *      REAL OCRmyPDF (exit 8): step 2's success is the decryption's.
 *   And a file that needs an OPEN password, sent with its owner password:
 *   the password-protected refusal, nothing processed.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is missing.
 * Output names checks, bits and verdicts only — never a password.
 */
import { openHandler } from "@/lib/pdf/security/document";
import { OCR_REFUSAL_MESSAGES } from "./ocr-engine-errors";
import { readEncryptPermissions } from "./pdf-security/permission-bits";
import type { Processor, ProcessorResult } from "./processor/types";

/** One restricted input and what it must come back as. */
export interface OwnerProofInput {
  name: string;
  bytes: Uint8Array;
  owner: string;
  /** The /P the input was built with. */
  p: number;
  /** Its revision: 2 reads bits 9-12 through bits 3-6. */
  r: number;
  /** Words of the scan's line, when it is one (else null: a typed page). */
  line: string | null;
}

export interface OcrOwnerProofDeps {
  ocr: Processor;
  inputs: OwnerProofInput[];
  /** A file that needs an open password, and its owner password. */
  openPassword: { bytes: Uint8Array; owner: string };
  /** qpdf's own exit status for `--requires-password` on these bytes. */
  requiresPasswordExit: ((pdf: Uint8Array) => Promise<number>) | null;
  /** qpdf `--decrypt` with a password. */
  decrypt: ((pdf: Uint8Array, password: string) => Promise<Uint8Array>) | null;
  pdfText: ((pdf: Uint8Array) => Promise<string>) | null;
  log?: (line: string) => void;
}

/** The bits a copy must keep: 3, 4, 5, 6, 9, 11, 12. */
const KEPT_BITS = [3, 4, 5, 6, 9, 11, 12] as const;

const on = (p: number, n: number): boolean => (p & (1 << (n - 1))) !== 0;

/**
 * What /P grants in R3+ terms, bit by bit — written out here, not through
 * the runner's `qpdfGrantFromP`, so the proof does not grade the runner with
 * the runner's own reading. Revision 2 (ISO 32000-1 Table 22): bit 9 is bit
 * 6's, bit 11 is bit 4's, bit 12 is bit 3's.
 */
export function keptBits(p: number, r: number): Record<number, boolean> {
  const bit = (n: number): boolean => {
    if (r >= 3) return on(p, n);
    if (n === 9) return on(p, 6);
    if (n === 11) return on(p, 4);
    if (n === 12) return on(p, 3);
    return on(p, n);
  };
  return Object.fromEntries(KEPT_BITS.map((n) => [n, bit(n)]));
}

function job(bytes: Uint8Array, ownerPassword?: string) {
  return {
    tool: "ocr-pdf",
    options: {
      languages: ["eng"],
      outputMode: "searchable-pdf",
      ...(ownerPassword !== undefined ? { ownerPassword } : {}),
    },
    inputs: [
      {
        fileId: "owner-proof",
        filename: "restricted.pdf",
        contentType: "application/pdf",
        bytes,
      },
    ],
  };
}

function outputPdf(result: ProcessorResult): Uint8Array | null {
  if (!result.ok) return null;
  return (
    result.artifacts.find((a) => a.contentType === "application/pdf")?.bytes ??
    null
  );
}

const words = (text: string): string[] =>
  text.toLowerCase().split(/\s+/).filter(Boolean);

export async function runOcrOwnerProof(
  deps: OcrOwnerProofDeps,
): Promise<0 | 1 | 2> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const { requiresPasswordExit, decrypt, pdfText } = deps;
  if (!deps.ocr.capability().ready || !requiresPasswordExit || !decrypt) {
    log("MISSING a ready OCR engine or qpdf: the owner proof cannot run here.");
    return 2;
  }
  let failed = 0;
  let checks = 0;
  const check = (ok: boolean, name: string, detail: string) => {
    checks += 1;
    log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
    if (!ok) failed += 1;
  };
  const refusedWith = (result: ProcessorResult, message: string) =>
    !result.ok &&
    result.error.code === "unprocessable_entity" &&
    !result.error.retryable &&
    result.error.message === message;

  // Health: a corpus that shrank proves nothing.
  check(
    deps.inputs.length >= 3 && deps.inputs.some((i) => i.r === 2),
    "corpus",
    `${deps.inputs.length} inputs, revisions ${deps.inputs.map((i) => i.r).join(", ")}`,
  );

  for (const input of deps.inputs) {
    // 1. INSTRUMENT.
    const inputP = readEncryptPermissions(input.bytes);
    const free = await openHandler(input.bytes, "").catch(() => null);
    const asOwner = await openHandler(input.bytes, input.owner).catch(
      () => null,
    );
    check(
      inputP === input.p &&
        free?.handler?.authenticatedAs === "user" &&
        asOwner?.handler?.authenticatedAs === "owner",
      `${input.name} instrument`,
      `/P ${inputP} (want ${input.p}), opens freely ${free?.handler != null}, owner ${asOwner?.handler?.authenticatedAs ?? "no"}`,
    );

    // 2. THE OWNER PASSWORD.
    const result = await deps.ocr.process(job(input.bytes, input.owner));
    const out = outputPdf(result);
    if (!out) {
      check(
        false,
        `${input.name} owner password`,
        result.ok
          ? "no PDF artifact"
          : `${result.error.code}: ${result.error.message}`,
      );
      continue;
    }
    const outP = readEncryptPermissions(out);
    const outFree = await openHandler(out, "").catch(() => null);
    const outOwner = await openHandler(out, input.owner).catch(() => null);
    check(
      outFree?.params.v === 5 &&
        outFree.params.r === 6 &&
        outFree.params.stream === "aesv3" &&
        outFree.params.string === "aesv3",
      `${input.name} encryption`,
      `V${outFree?.params.v} R${outFree?.params.r} ${outFree?.params.stream}/${outFree?.params.string} (want V5 R6 aesv3)`,
    );
    const qpdfSays = await requiresPasswordExit(out);
    check(
      outFree?.handler?.authenticatedAs === "user" && qpdfSays === 3,
      `${input.name} no open password`,
      `handler ${outFree?.handler?.authenticatedAs ?? "refused"}, qpdf --requires-password exit ${qpdfSays} (want user, 3)`,
    );
    check(
      outOwner?.handler?.authenticatedAs === "owner",
      `${input.name} owner password`,
      `the typed password opens the output as ${outOwner?.handler?.authenticatedAs ?? "nothing"}`,
    );
    const want = keptBits(input.p, input.r);
    const got = outP === null ? null : keptBits(outP, 6);
    const differing = got
      ? Object.keys(want).filter((n) => want[+n] !== got[+n])
      : ["(no /P)"];
    check(
      differing.length === 0 && outP !== null && on(outP, 10),
      `${input.name} /P bits`,
      `/P ${outP}; bits differing from the input: ${differing.join(", ") || "none"}; bit 10 ${outP !== null && on(outP, 10) ? "set" : "clear"}`,
    );
    if (input.line && pdfText) {
      const text = await pdfText(await decrypt(out, input.owner));
      const missing = words(input.line).filter((w) => !words(text).includes(w));
      check(
        missing.length === 0,
        `${input.name} text`,
        `${words(input.line).length - missing.length}/${words(input.line).length} scan words read back after decrypting`,
      );
    }

    // 3. A WRONG PASSWORD.
    const wrong = await deps.ocr.process(
      job(input.bytes, `${input.owner}-not-it`),
    );
    check(
      refusedWith(wrong, OCR_REFUSAL_MESSAGES["wrong-owner-password"]),
      `${input.name} wrong password`,
      wrong.ok
        ? "COMPLETED"
        : `${wrong.error.code}, final ${!wrong.error.retryable}`,
    );

    // 4. NO PASSWORD (control): the real OCRmyPDF refuses the encryption.
    const none = await deps.ocr.process(job(input.bytes));
    check(
      refusedWith(none, OCR_REFUSAL_MESSAGES.restricted),
      `${input.name} no password (control)`,
      none.ok
        ? "COMPLETED"
        : `${none.error.code}, final ${!none.error.retryable}`,
    );
  }

  const open = await deps.ocr.process(
    job(deps.openPassword.bytes, deps.openPassword.owner),
  );
  check(
    refusedWith(open, OCR_REFUSAL_MESSAGES.encrypted),
    "open-password file with its owner password",
    open.ok
      ? "COMPLETED"
      : `${open.error.code}, final ${!open.error.retryable}`,
  );

  log(`${checks - failed}/${checks} checks passed.`);
  return failed === 0 ? 0 : 1;
}
