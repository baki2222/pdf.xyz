import { PdfEngineError, UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine";
import { loadPdf, stampProducer } from "@/lib/pdf/stamp";
import type {
  PdfFieldPlacer,
  PdfInspector,
  SignatureRequestDeps,
} from "./engine";

/**
 * Production signature-request preparation deps: pdf-lib page inspection + real
 * fillable-field placement, plus size limits. No external e-signature provider is
 * wired, so a `deliver: true` request fails honestly (see the engine's delivery
 * gate) while the prepared-package path stays fully functional.
 *
 * Node-free at import time (pdf-lib is pure JS), so it is safe to import from the
 * worker entry point without pulling in a Node built-in.
 */

/**
 * Inspect the PDF's page geometry so fractional field boxes can be resolved to points.
 *
 * A trailer with no catalog LOADS and then throws a bare TypeError on the page
 * walk; that is damage in the bytes, so it is reported as the loader reports
 * damage (a {@link PdfEngineError}), not as a transient crash.
 */
const inspect: PdfInspector = async (bytes) => {
  const doc = await loadPdf(bytes);
  let pages;
  try {
    pages = doc.getPages();
  } catch {
    throw new PdfEngineError(UNREADABLE_PDF_MESSAGE);
  }
  const pageSizes = pages.map((page) => {
    const { width, height } = page.getSize();
    return { width, height };
  });
  return { pageCount: pageSizes.length, pageSizes };
};

/**
 * Add each requested field to the PDF as a real, named AcroForm text field —
 * pdf-lib renders text fields reliably in every viewer, and they are what a signer
 * fills to enter a typed signature, initials, or date. We deliberately do NOT
 * fabricate a cryptographic digital-signature widget (pdf-lib cannot render a
 * usable one), keeping the preparation honest. The source pages and any existing
 * fields are preserved untouched.
 */
const place: PdfFieldPlacer = async (bytes, fields) => {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const form = doc.getForm();
  for (const field of fields) {
    const page = pages[field.page - 1];
    if (!page) continue; // Unreachable after engine validation; satisfies the type checker.
    const widget = form.createTextField(field.name);
    widget.addToPage(page, {
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
    });
  }
  stampProducer(doc);
  return await doc.save();
};

export function signatureRequestDeps(): SignatureRequestDeps {
  return {
    inspect,
    place,
    limits: {
      maxInputBytes: 100 * 1024 * 1024,
      maxOutputBytes: 100 * 1024 * 1024,
    },
  };
}
