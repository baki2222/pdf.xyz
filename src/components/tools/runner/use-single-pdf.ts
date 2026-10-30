"use client";

import { useCallback, useState } from "react";
import { PdfEngineError, getPageRotations } from "@/lib/pdf/engine";
import { classifyPdfAccess, type PdfAccess } from "@/lib/pdf/encryption";
import { readFileBytes } from "@/lib/pdf/browser";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { readPagesWithPdfjs } from "@/lib/pdf/pdfjs";
import { validatePdfFile } from "@/lib/pdf/files";
import { causeOf, type RemedyInput } from "@/lib/pdf/remedies";
import type { HintReason } from "@/lib/intent/hint-tools";
import { readPreflight } from "@/components/intent/preflight-hint-chunk";
import type { PdfProbe } from "@/lib/pdf/probe-result";
import type { Rotation } from "@/lib/pdf/types";
import type { ProtectedPdf } from "@/lib/pdf/security/protected-pdf";
import { errorMessage } from "./runner-kit";

export interface LoadedPdf {
  file: File;
  bytes: Uint8Array;
  pageCount: number;
  /** Each page's current rotation, in document order. */
  rotations: Rotation[];
  /**
   * Digital (certificate) signatures the file already carries. Any PDF a tool
   * saves from it is a full rewrite, so they stop verifying — the runner says
   * so before Run.
   */
  digitalSignatures: number;
  /**
   * What the preflight probe read, for a tool with a hint (E.9): null when
   * it could not run, absent for a tool that has no hint to give.
   */
  probe?: PdfProbe | null;
  /**
   * Set for an encrypted PDF that opens without a password, opened by a
   * tool that asked to (`openProtected`): `bytes` is then its DECRYPTED
   * copy, and this holds the author's grant, the original file and the key
   * to save the changes the grant allows (`@/lib/pdf/security/protected-pdf`).
   */
  protection?: ProtectedPdf;
}

/**
 * An encrypted PDF the in-browser engine refused, with what a READER makes of
 * it. Only produced for a caller that opts in with `classifyLocked`.
 */
export interface LockedPdf {
  file: File;
  bytes: Uint8Array;
  access: Exclude<PdfAccess, { kind: "unencrypted" }>;
}

/**
 * Why a file could not be opened: the sentence, what the refusal says about
 * its cause (an encrypted or unreadable file, a size over the limit — the
 * error's remedy reads it, `ErrorNote`), and the file it was about.
 */
export interface SinglePdfError extends RemedyInput {
  readonly message: string;
  readonly file: File;
}

export interface UseSinglePdfOptions {
  /**
   * When pdf-lib refuses an encrypted file, ask pdf.js whether it opens
   * without a password, and report it as `locked` instead of an error.
   *
   * Opt-in because every other single-file tool rewrites the document in the
   * browser and has nothing to offer either kind of encrypted file; a tool
   * with a path that does not need pdf-lib (Compress's secure worker) opts in.
   */
  classifyLocked?: boolean;
  /** Which library reads the page board — see {@link PdfReader}. */
  reader?: PdfReader;
  /**
   * Probe the file as it opens, for the hint this tool can give (E.9) —
   * beside the page board, so the hint arrives in the same update as the
   * editor and never moves it afterwards.
   */
  preflight?: HintReason | null;
  /**
   * Anything the editor reads synchronously as it first draws — fetched
   * beside the page board, and awaited before the editor appears. A
   * failure is the editor's to absorb; the file still opens.
   */
  prepare?: () => Promise<void>;
  /**
   * Open an encrypted PDF that needs no password to open, the way a viewer
   * does — decrypted in the browser, with its author's restrictions on
   * {@link LoadedPdf.protection} for the tool to honour — instead of
   * refusing it. Only for a tool that honours them: Edit PDF, Annotate PDF
   * and Fill Forms save a filled form, and the editor's comments, back under
   * the author's encryption.
   */
  openProtected?: boolean;
}

/**
 * Which library reads the page board — and therefore which files get past it.
 *
 *  - `"pdf-lib"` (default): the library every WRITING tool saves through. It
 *    refuses any encrypted file, so those tools refuse at upload rather than
 *    after the user has configured a job they cannot run.
 *  - `"pdfjs"`: for tools whose whole pipeline is pdfjs (to image, to text, to
 *    Markdown). pdfjs opens owner-only ("permissions") encrypted files — bank
 *    statements, e-invoices, government forms — which pdf-lib refused with a
 *    false "password-protected". Only a file that really needs a password to
 *    open is refused, and it is told so.
 *
 * `single-pdf-reader.test.ts` derives which runners must pass which.
 */
export type PdfReader = "pdf-lib" | "pdfjs";

/** Page count and rotations of `bytes`, read by `reader`. */
export async function readPageBoard(
  bytes: Uint8Array,
  reader: PdfReader,
): Promise<{ pageCount: number; rotations: Rotation[] }> {
  if (reader === "pdfjs") return readPagesWithPdfjs(bytes);
  const rotations = await getPageRotations(bytes);
  return { pageCount: rotations.length, rotations };
}

/**
 * Loads a single PDF into memory and reads its page count and per-page
 * rotations up front, so runners can render an accurate page board immediately.
 */
export function useSinglePdf({
  classifyLocked = false,
  reader = "pdf-lib",
  preflight = null,
  prepare,
  openProtected = false,
}: UseSinglePdfOptions = {}) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [locked, setLocked] = useState<LockedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SinglePdfError | null>(null);

  const open = useCallback(
    async (file: File) => {
      const check = validatePdfFile(file);
      setLocked(null);
      if (!check.ok) {
        // A file check names no cause a remedy fixes: not a PDF, empty, or
        // over the limit its sentence states.
        setError({
          message: check.reason ?? "That file can't be used here.",
          file,
        });
        setPdf(null);
        return;
      }
      setLoading(true);
      setError(null);
      let bytes: Uint8Array | null = null;
      try {
        bytes = await readFileBytes(file);
        const [{ pageCount, rotations }, probe] = await Promise.all([
          readPageBoard(bytes, reader),
          preflight ? readPreflight(bytes, preflight) : undefined,
          prepare?.().catch(() => {}),
        ]);
        setPdf({
          file,
          bytes,
          pageCount,
          rotations,
          digitalSignatures: countDigitalSignatures(bytes),
          ...(probe !== undefined ? { probe } : {}),
        });
      } catch (err) {
        setPdf(null);
        // A restricted file, for a tool that honours its author's grant:
        // opened decrypted (`./open-protected`, its own chunk), or refused
        // below as before.
        const opened =
          openProtected &&
          bytes &&
          err instanceof PdfEngineError &&
          err.kind === "encrypted"
            ? await import("./open-protected")
                .then((m) => m.openProtectedCopy(file, bytes!, reader, prepare))
                .catch(() => null)
            : null;
        if (opened) {
          setPdf(opened);
          return;
        }
        const access =
          classifyLocked &&
          bytes &&
          err instanceof PdfEngineError &&
          err.kind === "encrypted"
            ? await classifyPdfAccess(bytes)
            : null;
        // "unencrypted" here would contradict pdf-lib's refusal; report the
        // refusal rather than trust either side of a disagreement.
        if (bytes && access && access.kind !== "unencrypted") {
          setLocked({ file, bytes, access });
        } else {
          setError({ message: errorMessage(err), file, ...causeOf(err) });
        }
      } finally {
        setLoading(false);
      }
    },
    [classifyLocked, reader, preflight, prepare, openProtected],
  );

  const clear = useCallback(() => {
    setPdf(null);
    setLocked(null);
    setError(null);
  }, []);

  return { pdf, locked, loading, error, open, clear };
}
