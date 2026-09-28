import { PdfEngineError, UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine";
import { placeVisibleRect, visiblePageFrame } from "@/lib/pdf/page-frame";
import { INK, loadPdf, stampProducer, toRgb } from "@/lib/pdf/stamp";
import { loadPdfLib } from "@/lib/pdf/pdf-lib";
import {
  assertFormFieldTextDrawable,
  formTextsDrawnOnRegeneration,
} from "@/lib/pdf/unicode-font";
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
 * Inspect each page's VISIBLE frame — the CropBox as a viewer displays it, turned
 * by `/Rotate` — so fractional field boxes resolve against what the reader sees,
 * not against the unrotated MediaBox.
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
    const { width, height } = visiblePageFrame(page);
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
 *
 * Two things a reader sees, both pinned against pdfjs reading the saved file in
 * `native.integration.test.ts`:
 *   - The field is an OUTLINE, not a box. pdf-lib fills a text field white unless
 *     the `backgroundColor` key is PRESENT (its check is `'backgroundColor' in
 *     options`), so `undefined` is passed explicitly — omitting it painted an
 *     opaque rectangle over whatever the page had there.
 *   - The field lands where the request put it on the page AS DISPLAYED: each
 *     visible-frame box is mapped through the CropBox origin and `/Rotate` by
 *     {@link placeVisibleRect}, and turned so it reads upright.
 */
const place: PdfFieldPlacer = async (bytes, fields) => {
  const [doc, { degrees, rgb }] = await Promise.all([
    loadPdf(bytes),
    loadPdfLib(),
  ]);
  const pages = doc.getPages();
  const form = doc.getForm();
  const outline = toRgb(rgb, INK);
  for (const field of fields) {
    const page = pages[field.page - 1];
    if (!page) continue; // Unreachable after engine validation; satisfies the type checker.
    const at = placeVisibleRect(visiblePageFrame(page), field);
    const widget = form.createTextField(field.name);
    widget.addToPage(page, {
      x: at.x,
      y: at.y,
      width: at.width,
      height: at.height,
      rotate: degrees(at.rotate),
      backgroundColor: undefined,
      borderColor: outline,
      borderWidth: 1,
    });
  }
  // `getForm()` above arms `save()` to regenerate every field that is dirty or
  // has no stored appearance — the uploader's fields as well as ours — with
  // the form's WinAnsi Helvetica. A Bengali value in one of THEIR fields used
  // to escape `save()` as a raw `WinAnsi cannot encode`; it is refused in
  // words here, before anything is written.
  assertFormFieldTextDrawable(
    formTextsDrawnOnRegeneration(form.getFields(), await loadPdfLib()),
  );
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
