"use client";

import { HANDWRITING_FACES } from "@/lib/pdf/handwriting";
import {
  HANDWRITING_STYLES,
  type HandwritingStyle,
} from "@/lib/pdf/offered-kinds";
import { cssLineHeightShowing } from "@/lib/pdf/handwriting-metrics";
import { loadFaceBytes } from "@/lib/pdf/unicode-font";
import { createFaceMeasure, type Measure } from "@/lib/pdf/editor/text";

/**
 * The handwriting faces on screen: the signature panel's previews and the
 * overlay's typed signatures, drawn with the very bytes the export embeds.
 *
 * Nothing here runs on page load. The panel asks for the picked style's face
 * when its Type tab is shown and for the rest once a name is typed or the
 * Style options are reached; the overlay when a box in a handwriting style
 * is on a page;
 * both go through `loadFaceBytes`, the export's own byte cache, so a face
 * previewed and then exported is fetched once — from `fontPackUrl`, our own
 * origin, which the CSP's `connect-src 'self'` and `font-src 'self'` allow.
 *
 * Two loads, deliberately separate. A preview needs only a `FontFace` (the
 * browser draws it). Placing a signature needs WIDTHS, and those come from
 * the face embedded through pdf-lib exactly as the export embeds it
 * (`createFaceMeasure`), so a name breaks onto a second line on screen
 * exactly when it would in the file — a canvas measure would apply kerning
 * the PDF does not. The measure pulls in the font engine, so only placing
 * asks for it.
 */

/**
 * The line height, in ems, of every preview of a typed signature in the
 * panel — the Style options, the large preview, a saved one. Those boxes
 * are a fixed size (a face arriving late moves nothing) and clip, so the
 * line must hold the tallest face's ink under any line-box metric a browser
 * picks: DERIVED from each face's reach (`cssLineHeightShowing`), rounded up
 * to 0.05. Homemade Apple, the tallest, needs 2.15; at a fixed 1.4 its
 * descenders and its J were sliced flat (review of sign-pdf#1).
 */
export const PREVIEW_LINE_EMS =
  Math.ceil(
    Math.max(...HANDWRITING_STYLES.map(cssLineHeightShowing)) * 20 - 1e-9,
  ) / 20;

/** The CSS family a handwriting face is registered under. */
export function handwritingFamily(style: HandwritingStyle): string {
  return `pdfxyz-hand-${style}`;
}

const families = new Map<HandwritingStyle, Promise<void>>();

/**
 * Register a handwriting face as a `FontFace`; resolves once the browser can
 * draw with it. A failed load is forgotten so the next ask retries.
 */
export function loadHandwritingFamily(style: HandwritingStyle): Promise<void> {
  // No FontFace (server render, a test DOM): nothing to register, and
  // nothing cached, so a later ask where it exists still registers it.
  if (typeof FontFace === "undefined" || typeof document === "undefined")
    return Promise.resolve();
  let pending = families.get(style);
  if (!pending) {
    pending = (async () => {
      const bytes = await loadFaceBytes(HANDWRITING_FACES[style]);
      const face = new FontFace(
        handwritingFamily(style),
        new Uint8Array(bytes).buffer,
      );
      await face.load();
      document.fonts.add(face);
    })().catch((error: unknown) => {
      families.delete(style);
      throw error;
    });
    families.set(style, pending);
  }
  return pending;
}

const measures = new Map<HandwritingStyle, Measure>();
const measuring = new Map<HandwritingStyle, Promise<Measure>>();

/** The face's widths if they have arrived, for a synchronous layout. */
export function handwritingMeasureNow(style: HandwritingStyle): Measure | null {
  return measures.get(style) ?? null;
}

/**
 * Load the face's widths (and register it for drawing). The signature panel
 * awaits this before handing a typed signature to the editor, so the box it
 * places is exactly as wide as the name will be in the file.
 */
export function loadHandwritingMeasure(
  style: HandwritingStyle,
): Promise<Measure> {
  let pending = measuring.get(style);
  if (!pending) {
    pending = Promise.all([
      createFaceMeasure(HANDWRITING_FACES[style]),
      loadHandwritingFamily(style),
    ])
      .then(([measure]) => {
        measures.set(style, measure);
        return measure;
      })
      .catch((error: unknown) => {
        measuring.delete(style);
        throw error;
      });
    measuring.set(style, pending);
  }
  return pending;
}
