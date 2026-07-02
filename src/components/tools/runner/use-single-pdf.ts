"use client";

import { useCallback, useState } from "react";
import { getPageRotations } from "@/lib/pdf/engine";
import { readFileBytes } from "@/lib/pdf/browser";
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
 * Loads a single PDF into memory and reads its page count and per-page
 * rotations up front, so runners can render an accurate page board immediately.
 */
export function useSinglePdf() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const bytes = await readFileBytes(file);
      const rotations = await getPageRotations(bytes);
      setPdf({ file, bytes, pageCount: rotations.length, rotations });
    } catch (err) {
      setError(errorMessage(err));
      setPdf(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setPdf(null);
    setError(null);
  }, []);

  return { pdf, loading, error, open, clear };
}
