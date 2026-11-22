"use client";

import { useEffect, useRef, useState } from "react";
import { announceOutcome } from "@/components/a11y/live-region";
import type { StampFontFamily } from "@/lib/pdf/stamp";
import {
  isWatermarkPoint,
  measureWatermarkImage,
  measureWatermarkText,
  watermarkPageView,
  watermarkPreviewLayout,
  type WatermarkPoint,
  type WatermarkPosition,
} from "@/lib/pdf/watermark";
import { NumberField } from "./stamp-controls";
import { usePageImageState } from "./use-page-image";

/**
 * Add Watermark's live preview (audit watermark-pdf#1, 2026-11-22): the page
 * as a reader sees it, with the mark drawn over it from the settings as they
 * are now. Where the mark goes comes from the ENGINE's own layout
 * (`watermarkPreviewLayout`: the same fit and placement code the run uses,
 * held to pdf.js's reading of the saved file by `watermark-point.test.ts`),
 * and its size from the face the run would embed (`measureWatermarkText`).
 * The SVG text is stretched to that measured width (`textLength`), so the
 * browser's own font cannot make it longer or shorter than the run draws it.
 *
 * Pressing the page puts the mark's centre there and dragging moves it; the
 * handle on the mark moves it with the arrow keys (2% of the page a step,
 * 10% with Shift). Every move is a point handed to `onPlace`; the run is
 * given that same point. The position grid stays the non-pointer route.
 */

/** Width the page image is drawn at, in CSS pixels. */
const PREVIEW_WIDTH = 320;
const STEP = 0.02;
const STEP_BIG = 0.1;

/** The face the SVG text is drawn in: the nearest a browser has to each. */
const SVG_FAMILY: Record<StampFontFamily, string> = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
};

export interface WatermarkPreviewProps {
  bytes: Uint8Array;
  pageCount: number;
  mode: "text" | "image";
  text: string;
  font: StampFontFamily;
  fontSize: number;
  /** The picked image's bytes, for an image mark. */
  image: Uint8Array | null;
  /** Image width as a percentage of the page width. */
  imageScale: number;
  /** 5–100. */
  opacity: number;
  rotation: number;
  /** The ink, as a colour-input value. */
  colorHex: string;
  position: WatermarkPosition;
  onPlace: (point: WatermarkPoint) => void;
}

const share = (v: number) => Math.min(1, Math.max(0, v));

export function WatermarkPreview(props: WatermarkPreviewProps) {
  const {
    bytes,
    pageCount,
    mode,
    text,
    font,
    fontSize,
    image,
    imageScale,
    opacity,
    rotation,
    colorHex,
    position,
    onPlace,
  } = props;
  const [page, setPage] = useState(1);
  const index = Math.min(Math.max(page, 1), Math.max(1, pageCount)) - 1;
  const picture = usePageImageState(bytes, index, PREVIEW_WIDTH);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<number | null>(null);

  // Each async fact remembers what it was measured for, so a stale answer
  // (an older text, the last page) is never drawn as the current one.
  const [view, setView] = useState<{
    of: string;
    size: { width: number; height: number };
  } | null>(null);
  const viewKey = `${index}`;
  useEffect(() => {
    let alive = true;
    watermarkPageView(bytes, index).then(
      (size) => alive && setView({ of: `${index}`, size }),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [bytes, index]);

  const [measured, setMeasured] = useState<{
    of: string;
    size: { width: number; height: number } | null;
  } | null>(null);
  const textKey = `${text}\u0000${fontSize}\u0000${font}`;
  useEffect(() => {
    if (mode !== "text") return;
    let alive = true;
    void measureWatermarkText(text, fontSize, font).then(
      (size) =>
        alive &&
        setMeasured({ of: `${text}\u0000${fontSize}\u0000${font}`, size }),
    );
    return () => {
      alive = false;
    };
  }, [mode, text, fontSize, font]);

  const [art, setArt] = useState<{
    of: Uint8Array;
    url: string;
    aspect: number;
  } | null>(null);
  useEffect(() => {
    if (!image) return;
    let alive = true;
    let url: string | null = null;
    void measureWatermarkImage(image).then((aspect) => {
      if (!alive || aspect === null) return;
      url = URL.createObjectURL(
        new Blob([image.slice()], {
          type: image[0] === 0x89 ? "image/png" : "image/jpeg",
        }),
      );
      setArt({ of: image, url, aspect });
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image]);

  const size = view?.of === viewKey ? view.size : null;
  const mark = !size
    ? null
    : mode === "text"
      ? measured?.of === textKey
        ? measured.size
        : null
      : art && art.of === image
        ? {
            width: (size.width * imageScale) / 100,
            height: ((size.width * imageScale) / 100) * art.aspect,
          }
        : null;
  const layout =
    size && mark
      ? watermarkPreviewLayout({ view: size, mark, tilt: rotation, position })
      : null;
  const tiled = position === "tile";
  const first = layout?.marks[0] ?? null;

  const pointAt = (clientX: number, clientY: number): WatermarkPoint | null => {
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: share((clientX - rect.left) / rect.width),
      y: share((clientY - rect.top) / rect.height),
    };
  };
  /** The point the mark is at now, as the preview drew it. */
  const current = (): WatermarkPoint =>
    isWatermarkPoint(position)
      ? position
      : first && size
        ? { x: first.cx / size.width, y: first.cy / size.height }
        : { x: 0.5, y: 0.5 };
  const say = (p: WatermarkPoint) =>
    announceOutcome(
      `Watermark moved to ${Math.round(p.x * 100)}% across and ${Math.round(p.y * 100)}% down the page.`,
    );

  return (
    <figure className="flex flex-col items-center gap-2">
      <div
        ref={sheetRef}
        data-testid="watermark-preview"
        // No overflow clip here: the handle below is a sibling of the clipped
        // sheet, so focusing it scrolls the PAGE (with its scroll padding for
        // the run dock), not a clipping box that cannot scroll.
        className="relative w-full"
        style={{
          aspectRatio: size ? `${size.width} / ${size.height}` : "3 / 4",
          maxWidth: PREVIEW_WIDTH,
          cursor: tiled ? undefined : "move",
          touchAction: tiled ? undefined : "none",
        }}
        onPointerDown={(event) => {
          if (tiled || (event.button !== 0 && event.pointerType === "mouse"))
            return;
          const p = pointAt(event.clientX, event.clientY);
          if (!p) return;
          event.preventDefault();
          drag.current = event.pointerId;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onPlace(p);
        }}
        onPointerMove={(event) => {
          if (drag.current !== event.pointerId) return;
          const p = pointAt(event.clientX, event.clientY);
          if (p) onPlace(p);
        }}
        onPointerUp={(event) => {
          if (drag.current !== event.pointerId) return;
          drag.current = null;
          const p = pointAt(event.clientX, event.clientY);
          if (p) {
            onPlace(p);
            say(p);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="rounded-sheet absolute inset-0 overflow-hidden bg-white shadow-md ring-1 ring-black/10">
          {picture.image && (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: URL of a local render
            <img
              src={picture.image.url}
              alt={picture.image.note ?? ""}
              draggable={false}
              className="absolute inset-0 size-full"
            />
          )}
          {size && layout && (
            <svg
              aria-hidden
              className="absolute inset-0 size-full"
              viewBox={`0 0 ${size.width} ${size.height}`}
              style={{ pointerEvents: "none" }}
            >
              {layout.marks.map((m, i) => (
                <g
                  key={i}
                  data-watermark-mark=""
                  transform={`translate(${m.cx} ${m.cy}) rotate(${-layout.tilt})`}
                  opacity={opacity / 100}
                >
                  {mode === "text" ? (
                    // Baseline at the bottom of the engine's box, from its
                    // left edge, stretched to the measured width: the run
                    // draws its text from that same corner.
                    <text
                      x={-layout.width / 2}
                      y={layout.height / 2}
                      fontSize={fontSize * layout.scale}
                      fontFamily={SVG_FAMILY[font]}
                      fontWeight="bold"
                      fill={colorHex}
                      textLength={layout.width}
                      lengthAdjust="spacingAndGlyphs"
                    >
                      {text.trim()}
                    </text>
                  ) : (
                    art && (
                      <image
                        href={art.url}
                        x={-layout.width / 2}
                        y={-layout.height / 2}
                        width={layout.width}
                        height={layout.height}
                        preserveAspectRatio="none"
                      />
                    )
                  )}
                </g>
              ))}
            </svg>
          )}
        </div>
        {size && first && !tiled && (
          <button
            type="button"
            aria-label="Move the watermark: drag it on the page, or use the arrow keys"
            className="tap focus-visible:ring-accent/50 rounded-tag absolute z-10 grid size-6 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center outline-none focus-visible:ring-2"
            style={{
              left: `${(first.cx / size.width) * 100}%`,
              top: `${(first.cy / size.height) * 100}%`,
              cursor: "move",
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? STEP_BIG : STEP;
              const by: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const move = by[event.key];
              if (!move) return;
              event.preventDefault();
              const from = current();
              const p = {
                x: share(from.x + move[0]),
                y: share(from.y + move[1]),
              };
              onPlace(p);
              say(p);
            }}
          >
            <span
              aria-hidden
              className="rounded-tag"
              style={{
                width: 12,
                height: 12,
                border: "2px solid var(--sf-accent)",
                background: "var(--sf-panel)",
              }}
            />
          </button>
        )}
      </div>
      <figcaption className="text-muted flex flex-col items-center gap-2 text-center text-xs leading-relaxed">
        <span>
          {tiled
            ? "The copies repeat across the page as shown."
            : "Drag the mark, or press the page where it should go."}{" "}
          The preview is a guide: letters are drawn in your browser&apos;s
          nearest font, and the saved file uses the real one.
          {picture.state === "failed"
            ? " The page itself could not be drawn, so the mark is shown on a blank sheet of the same size."
            : ""}
          {mode === "text" && size && measured?.of === textKey && !mark
            ? " This text cannot be drawn with the shipped fonts, so there is nothing to preview."
            : ""}
        </span>
        {pageCount > 1 && (
          <span className="w-40">
            <NumberField
              label="Preview page"
              value={index + 1}
              min={1}
              max={pageCount}
              onChange={setPage}
            />
          </span>
        )}
      </figcaption>
    </figure>
  );
}
