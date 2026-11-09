import type { PDFDocument } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Annotation flags and the XFA reading that Flatten PDF (`./flatten`) and
 * Remove Annotations (`./remove-annotations`) share — one definition, so
 * the two cannot disagree about which annotation a reader shows or which
 * form is dynamic.
 *
 * Overlay PDF (`./overlay`) does NOT import this module, and must not:
 * its engine is in overlay-pdf's and n-up-pdf's first load, and webpack
 * keeps a module's exports per module, not per page. When it imported the
 * two flags from here (2026-11-10), the XFA reader below shipped on both
 * pages, +293 B gzip each. Overlay keeps its own two flags, pinned to these
 * by `annot-flags.test.ts`; `own-panel-first-load.test.ts` holds the XFA
 * reader to the pages whose first load carries an engine that uses it.
 */

/** Annotation flags (ISO 32000, 12.5.3): Hidden is bit 2, NoView bit 6. */
export const ANNOT_HIDDEN = 1 << 1;
export const ANNOT_NO_VIEW = 1 << 5;

export interface XfaState {
  xfa: boolean;
  needsRendering: boolean;
}

/**
 * Read the XFA state from the RAW catalog. This must run before
 * `doc.getForm()`, which deletes the XFA entry as a side effect — asking the
 * form API would always answer "no XFA".
 */
export function readXfa(doc: PDFDocument, lib: PdfLibModule): XfaState {
  const { PDFBool, PDFDict, PDFName } = lib;
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  const xfa = acroForm instanceof PDFDict && acroForm.has(PDFName.of("XFA"));
  const flag = doc.catalog.lookup(PDFName.of("NeedsRendering"));
  return { xfa, needsRendering: flag instanceof PDFBool && flag.asBoolean() };
}

/**
 * A dynamic XFA form: the pages are a placeholder and the real form lives
 * only in the XFA, which no browser engine renders.
 */
export function isDynamicXfa(state: XfaState, fields: number): boolean {
  return state.xfa && (state.needsRendering || fields === 0);
}
