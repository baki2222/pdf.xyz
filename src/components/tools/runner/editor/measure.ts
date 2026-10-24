"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPreviewFace } from "@/lib/pdf/unicode-font";
import type { StandardFace } from "@/lib/pdf/font-packs";
import {
  NOTE_PADDING,
  type NoteObject,
  type TextBoxObject,
} from "@/lib/pdf/editor/model";
import {
  CSS_FONT_STACK,
  createStandardMeasure,
  layoutText,
  needsUnicodeFace,
  standardFontKey,
  type Measure,
  type TextLayout,
} from "@/lib/pdf/editor/text";

/**
 * How the overlay measures and draws text so it matches the export.
 *
 * Standard fonts: pdf-lib's AFM metrics (the numbers the export measures
 * with) and a metric-compatible CSS face. Other scripts: the Noto face the
 * export will embed, fetched from our own origin (`loadPreviewFace`, the same
 * cached bytes) and registered as a `FontFace`, measured with a canvas in
 * that face. Until a face has arrived its text is measured in the fallback
 * stack, and `version` bumps when it lands so boxes re-lay out.
 */

export interface TextKit {
  /** Lines and height for a text box or note, as the export will lay it out. */
  layout(obj: TextBoxObject | NoteObject, text?: string): TextLayout;
  /** CSS font-family for an object's words. */
  family(obj: TextBoxObject | NoteObject, text?: string): string;
  /** Whether bold/italic apply (standard faces only). */
  styled(obj: TextBoxObject | NoteObject, text?: string): boolean;
  /** Ask for the face `text` needs; resolves when it can be drawn. */
  request(text: string): void;
  /** Text height for `objectBounds`. */
  height(obj: TextBoxObject | NoteObject): number;
  version: number;
}

const FACE_PREFIX = "pdfxyz-editor-";

export function useTextKit(): TextKit | null {
  const [standard, setStandard] = useState<
    ((face: StandardFace) => Measure) | null
  >(null);
  const [version, setVersion] = useState(0);
  // text → pack id (null = no face can draw it, or not needed)
  const packOf = useRef(new Map<string, string | null>());
  const pending = useRef(new Set<string>());
  const faces = useRef(new Set<string>());
  const canvas = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    let alive = true;
    void createStandardMeasure().then((m) => {
      if (alive) setStandard(() => m);
    });
    return () => {
      alive = false;
    };
  }, []);

  const request = useCallback((text: string) => {
    if (!needsUnicodeFace(text) || packOf.current.has(text)) return;
    if (pending.current.has(text)) return;
    pending.current.add(text);
    void loadPreviewFace(text)
      .then(async (face) => {
        if (!face) {
          packOf.current.set(text, null);
          return;
        }
        const family = FACE_PREFIX + face.pack.id;
        if (!faces.current.has(family) && typeof FontFace !== "undefined") {
          const copy = new Uint8Array(face.bytes);
          const ff = new FontFace(family, copy.buffer);
          await ff.load();
          document.fonts.add(ff);
          faces.current.add(family);
        }
        packOf.current.set(text, face.pack.id);
      })
      .catch(() => {
        packOf.current.set(text, null);
      })
      .finally(() => {
        pending.current.delete(text);
        setVersion((v) => v + 1);
      });
  }, []);

  return useMemo(() => {
    if (!standard) return null;

    const unicodeFamily = (text: string): string | null => {
      const pack = packOf.current.get(text);
      return pack ? FACE_PREFIX + pack : null;
    };

    const measureCanvas = (family: string): Measure => {
      canvas.current ??=
        typeof document !== "undefined"
          ? document.createElement("canvas").getContext("2d")
          : null;
      const ctx = canvas.current;
      return (s, size) => {
        if (!ctx) return s.length * size * 0.5;
        ctx.font = `${size}px ${family}`;
        return ctx.measureText(s).width;
      };
    };

    const measureFor = (
      obj: TextBoxObject | NoteObject,
      text: string,
    ): Measure => {
      if (!needsUnicodeFace(text)) {
        return standard(standardFontKey(obj.font, obj.bold, obj.italic));
      }
      const family = unicodeFamily(text);
      return measureCanvas(family ? `"${family}"` : CSS_FONT_STACK.helvetica);
    };

    const layout = (obj: TextBoxObject | NoteObject, text = obj.text) =>
      layoutText(
        text,
        obj.kind === "note" ? obj.width - NOTE_PADDING * 2 : obj.width,
        obj,
        measureFor(obj, text),
      );

    return {
      version,
      request,
      layout,
      height: (obj) => layout(obj).height,
      styled: (obj, text = obj.text) => !needsUnicodeFace(text),
      family: (obj, text = obj.text) => {
        if (!needsUnicodeFace(text)) return CSS_FONT_STACK[obj.font];
        const family = unicodeFamily(text);
        return family ? `"${family}", sans-serif` : CSS_FONT_STACK.helvetica;
      },
    };
  }, [standard, version, request]);
}
