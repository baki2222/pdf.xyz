"use client";

import { useState } from "react";
import { ImagePlus, X } from "lucide-react";
import type { ImageSignature } from "@/lib/pdf/signature";
import {
  SIGNATURE_SOURCES,
  SIGNATURE_SOURCE_LABEL,
} from "@/lib/pdf/offered-kinds";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SignaturePad } from "../signature-pad";
import { decodeImageFile, signatureFromPixels } from "../signature-bitmap";
import type { PendingImage } from "./editor-state";

/**
 * Make a signature to place: draw it, type it, or pick a picture of one —
 * the same three sources Sign PDF offers (`SIGNATURE_SOURCES`), through the
 * same pad and the same bitmap preparation (`signature-bitmap.ts`). The
 * result is a picture; it never leaves the browser.
 */

const TYPE_FONT = `"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive`;

async function typedSignature(name: string): Promise<ImageSignature | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0f172a";
  ctx.font = `italic 96px ${TYPE_FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText(name, 24, 110, 852);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return signatureFromPixels(
    { data: data.data, width: data.width, height: data.height },
    { removeBackground: false },
  );
}

function sizeOf(
  sig: ImageSignature,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(sig.bytes).buffer], {
        type: sig.format === "png" ? "image/png" : "image/jpeg",
      }),
    );
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 3, height: img.naturalHeight || 1 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 3, height: 1 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function SignaturePanel({
  onReady,
  onClose,
}: {
  onReady: (pending: PendingImage) => void;
  onClose: () => void;
}) {
  const [source, setSource] =
    useState<(typeof SIGNATURE_SOURCES)[number]>("draw");
  const [drawn, setDrawn] = useState<ImageSignature | null>(null);
  const [name, setName] = useState("");
  const [uploaded, setUploaded] = useState<ImageSignature | null>(null);
  const [error, setError] = useState<string | null>(null);

  const use = async () => {
    setError(null);
    const sig =
      source === "draw"
        ? drawn
        : source === "type"
          ? name.trim()
            ? await typedSignature(name.trim())
            : null
          : uploaded;
    if (!sig) {
      setError(
        source === "draw"
          ? "Draw your signature first."
          : source === "type"
            ? "Type your name first."
            : "Choose a picture of your signature first.",
      );
      return;
    }
    const size = await sizeOf(sig);
    onReady({
      kind: "signature",
      format: sig.format,
      bytes: sig.bytes,
      ...size,
    });
  };

  return (
    <div
      role="dialog"
      aria-label="Create a signature"
      className="border-line bg-panel rounded-panel flex flex-col gap-3 border p-4 shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Signature source"
          className="flex gap-1"
        >
          {SIGNATURE_SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={source === s}
              onClick={() => setSource(s)}
              className={cn(
                "rounded-ctl border px-3 py-1 text-xs font-medium",
                source === s
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line text-muted hover:text-fg",
              )}
            >
              {SIGNATURE_SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close signature panel"
          className="text-muted hover:text-fg rounded-ctl p-1"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {source === "draw" && <SignaturePad onChange={setDrawn} />}
      {source === "type" && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="editor-sign-name"
            className="text-muted text-xs font-medium"
          >
            Your name
          </label>
          <input
            id="editor-sign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-line bg-canvas text-fg rounded-ctl border px-3 py-2 text-sm"
          />
          {name.trim() && (
            <p
              aria-hidden
              className="text-fg truncate text-3xl"
              style={{ fontFamily: TYPE_FONT, fontStyle: "italic" }}
            >
              {name}
            </p>
          )}
        </div>
      )}
      {source === "upload" && (
        <label className="border-line-strong text-muted rounded-ctl flex cursor-pointer items-center gap-2 border border-dashed px-3.5 py-2.5 text-xs font-medium">
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setError(null);
              try {
                const pixels = await decodeImageFile(file);
                const sig = await signatureFromPixels(pixels, {
                  removeBackground: true,
                });
                if (!sig) setError("That picture has no visible ink.");
                setUploaded(sig);
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "That image can't be used.",
                );
              }
            }}
          />
          <ImagePlus className="text-accent size-4" aria-hidden />
          {uploaded
            ? "Picture ready — choose another"
            : "Choose a PNG or JPG of your signature"}
        </label>
      )}

      {error && (
        <p role="alert" className="text-err text-xs">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void use()}
          className={buttonVariants({ variant: "primary", size: "sm" })}
        >
          Use signature
        </button>
      </div>
    </div>
  );
}
