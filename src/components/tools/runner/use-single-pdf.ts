"use client";

import { useCallback, useState } from "react";
import { getPageRotations } from "@/lib/pdf/engine";
import { readFileBytes } from "@/lib/pdf/browser";
import { readPagesWithPdfjs } from "@/lib/pdf/pdfjs";
import { validatePdfFile } from "@/lib/pdf/files";
import type { Rotation } from "@/lib/pdf/types";
import { errorMessage } from "./runner-kit";

export interface LoadedPdf {
  file: File;
  bytes: Uint8Array;
  pageCount: number;
  /** Each page's current rotation, in document order. */
  rotations: Rotation[];
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
  reader = "pdf-lib",
}: { reader?: PdfReader } = {}) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (file: File) => {
      const check = validatePdfFile(file);
      if (!check.ok) {
        setError(check.reason ?? "That file can't be used here.");
        setPdf(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const bytes = await readFileBytes(file);
        const { pageCount, rotations } = await readPageBoard(bytes, reader);
        setPdf({ file, bytes, pageCount, rotations });
      } catch (err) {
        setError(errorMessage(err));
        setPdf(null);
      } finally {
        setLoading(false);
      }
    },
    [reader],
  );

  const clear = useCallback(() => {
    setPdf(null);
    setError(null);
  }, []);

  return { pdf, loading, error, open, clear };
}
