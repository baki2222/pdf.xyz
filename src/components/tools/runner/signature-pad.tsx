"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Eraser } from "lucide-react";
import type { ImageSignature } from "@/lib/pdf/signature";
import { ChipButton } from "./runner-kit";
import { canvasPixels, signatureFromPixels } from "./signature-bitmap";
import { cn } from "@/lib/utils";

/**
 * A lightweight, SSR-safe canvas signature pad. Strokes are dark ink drawn on a
 * transparent canvas — the light card behind it only makes them visible on
 * screen — so the exported PNG overlays cleanly onto a PDF page. After each
 * stroke ends the drawing is cropped to its ink (`signature-image.ts`), so the
 * Size control sizes the signature and not the pad, encoded, and handed to
 * `onChange`; an empty pad reports `null`.
 */

const BACKING_WIDTH = 520;
const BACKING_HEIGHT = 180;
const INK = "#0f172a";

export function SignaturePad({
  onChange,
  className,
}: {
  onChange: (signature: ImageSignature | null) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const inkedRef = useRef(false);
  // Exports are async; only the latest one may report, or a slow encode of an
  // earlier stroke could overwrite the finished drawing.
  const exportSeq = useRef(0);
  const [hasInk, setHasInk] = useState(false);

  const context = useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current;
    return canvas ? canvas.getContext("2d") : null;
  }, []);

  // Configure the stroke look once the canvas is mounted (client only).
  useEffect(() => {
    const ctx = context();
    if (!ctx) return;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [context]);

  // Map a pointer event to backing-store coordinates — the canvas renders
  // responsively, so the CSS box and the fixed backing size differ.
  const pointOf = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }, []);

  const exportInk = useCallback(() => {
    const seq = ++exportSeq.current;
    const canvas = canvasRef.current;
    const pixels = canvas && inkedRef.current ? canvasPixels(canvas) : null;
    if (!pixels) {
      onChange(null);
      return;
    }
    void signatureFromPixels(pixels, { removeBackground: false })
      .catch(() => null)
      .then((signature) => {
        if (seq === exportSeq.current) onChange(signature);
      });
  }, [onChange]);

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    if (!ctx) return;
    event.preventDefault();
    drawingRef.current = true;
    const { x, y } = pointOf(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const extendStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = context();
    if (!ctx) return;
    const { x, y } = pointOf(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!inkedRef.current) {
      inkedRef.current = true;
      setHasInk(true);
    }
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    exportInk();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawingRef.current = false;
    inkedRef.current = false;
    exportSeq.current += 1;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="border-line relative overflow-hidden rounded-[4px] border bg-white">
        <canvas
          ref={canvasRef}
          width={BACKING_WIDTH}
          height={BACKING_HEIGHT}
          aria-label="Signature drawing area"
          onPointerDown={startStroke}
          onPointerMove={extendStroke}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          className="block aspect-[26/9] w-full cursor-crosshair touch-none select-none"
        />
        <span
          className="pointer-events-none absolute inset-x-8 bottom-10 h-px bg-slate-300"
          aria-hidden
        />
        {!hasInk && (
          <span className="text-muted pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs">
            Draw your signature above
          </span>
        )}
      </div>
      <div className="flex justify-end">
        <ChipButton onClick={clear} disabled={!hasInk} title="Clear signature">
          <Eraser className="size-3.5" aria-hidden />
          Clear
        </ChipButton>
      </div>
    </div>
  );
}
