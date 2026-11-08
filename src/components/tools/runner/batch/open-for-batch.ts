import { readFileBytes } from "@/lib/pdf/browser";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import {
  classifyPdfAccess,
  LOCKED_PDF_COPY,
  type PdfAccess,
} from "@/lib/pdf/encryption";
import { PdfEngineError } from "@/lib/pdf/engine";
import { validatePdfFile } from "@/lib/pdf/files";

/** One batch file, read and ready for its tool. */
export interface OpenedPdf {
  file: File;
  bytes: Uint8Array;
  /**
   * Digital signatures the file carries. Every tool of the settings batch
   * saves a rewrite, so each of them stops verifying in the output, and the
   * batch holds such an output back until the person opts it in.
   */
  signatures: number;
}

/**
 * Read one batch file the way the single-file panel reads it: the same file
 * check (a PDF, not empty, under the size limit), the bytes, and the
 * signatures it carries. Nothing here opens the document; the tool's own
 * engine does, and a refusal of an encrypted file is explained by
 * {@link explainLocked}.
 */
export async function openForBatch(file: File): Promise<OpenedPdf> {
  const check = validatePdfFile(file);
  if (!check.ok) {
    throw new PdfEngineError(check.reason ?? "That file can't be used here.");
  }
  const bytes = await readFileBytes(file);
  return { file, bytes, signatures: countDigitalSignatures(bytes) };
}

/**
 * A row's refusal of a locked file, in the single-file path's own words
 * (`LOCKED_PDF_COPY`). A restricted file gets the tool's `restrictedNote`
 * after it, when the tool has one more thing to say (Rotate PDF opens a
 * restricted file on its own when its author allows page changes).
 */
export function lockedRefusal(
  kind: Exclude<PdfAccess["kind"], "unencrypted">,
  restrictedNote?: string,
): PdfEngineError {
  return new PdfEngineError(
    kind === "restricted" && restrictedNote
      ? `${LOCKED_PDF_COPY.restricted} ${restrictedNote}`
      : LOCKED_PDF_COPY[kind],
    { kind: "encrypted" },
  );
}

/**
 * Refuse an encrypted file BEFORE a tool's engine sees it, for the tools
 * whose engine is pdf.js (Grayscale PDF, PDF to JPG and PNG): pdf.js draws a
 * file whose author restricted it without asking, which would lift the
 * author's restrictions in a batch. A file a reader opens unencrypted passes;
 * every other fails its row in the single-file path's words.
 */
export async function refuseEncrypted(
  bytes: Uint8Array,
  restrictedNote?: string,
): Promise<void> {
  const access = await classifyPdfAccess(bytes);
  if (access.kind !== "unencrypted")
    throw lockedRefusal(access.kind, restrictedNote);
}

/**
 * Run a tool's engine on a batch file, and tell an encrypted file's refusal
 * apart by what a reader can open — the classification, and the words, of
 * the single-file path. The engine refuses every encrypted file (pdf-lib
 * opens none without `ignoreEncryption`, which no batch passes), so a
 * restricted file fails its own row: nothing here lifts an author's
 * restrictions, and nothing opens a file that needs a password.
 */
export async function explainLocked<T>(
  bytes: Uint8Array,
  work: () => Promise<T>,
  restrictedNote?: string,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof PdfEngineError && err.kind === "encrypted") {
      const access = await classifyPdfAccess(bytes);
      if (access.kind !== "unencrypted") {
        throw lockedRefusal(access.kind, restrictedNote);
      }
    }
    throw err;
  }
}
