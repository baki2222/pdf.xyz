/**
 * The preflight hint's component, fetched WITH the probe that decides it and
 * held here once it has arrived — so a `FileHeader` draws the hint in the
 * same update as the editor, synchronously, and a tool page whose files are
 * never probed never downloads it.
 *
 * Not `React.lazy`: a lazy component suspends at its first render even when
 * its module is already in memory, and the hint would then be drawn a commit
 * after the editor — a layout shift on a drop, which opens no input window
 * (`e2e/preflight-hint.spec.ts` measures exactly that arrival).
 */
import type { HintReason } from "@/lib/intent/hint-tools";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import type { PdfProbe } from "@/lib/pdf/probe-result";

type HintModule = typeof import("./preflight-hint");

let loaded: HintModule | null = null;

/** Fetch the hint's module; resolves once it can be drawn. */
export async function loadPreflightHint(): Promise<void> {
  loaded ??= await import("./preflight-hint");
}

/** The hint component, or null until {@link loadPreflightHint} has resolved. */
export function loadedPreflightHint(): HintModule["PreflightHint"] | null {
  return loaded?.PreflightHint ?? null;
}

/** Test seam: forget the module, as a fresh page would not have it. */
export function resetPreflightHintForTests(): void {
  loaded = null;
}

/** The probe a hint needs, loaded with the first file; null if it fails. */
export async function readPreflight(
  bytes: Uint8Array,
  need: HintReason,
): Promise<PdfProbe | null> {
  try {
    // The hint's component arrives with the probe, so it can be drawn in
    // the editor's first update (this module).
    const [{ probePdf }] = await Promise.all([
      import("@/lib/pdf/probe"),
      loadPreflightHint(),
    ]);
    // A form-field hint needs no page scan: the field count is the fact.
    return await probePdf(bytes, {
      maxBytes: MAX_PDF_BYTES,
      ...(need === "form-fields" ? { samplePages: 0 } : {}),
    });
  } catch {
    return null;
  }
}
