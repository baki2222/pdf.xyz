"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { ImageSignature } from "@/lib/pdf/signature";
import { isOpaque, type RgbaImage } from "@/lib/pdf/signature-image";
import {
  SIGNATURE_SOURCES,
  SIGNATURE_SOURCE_LABEL,
  SIGNATURE_STYLES,
  SIGNATURE_STYLE_LABEL,
  type SignatureStyle,
} from "@/lib/pdf/offered-kinds";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dropzone } from "../runner-kit";
import { SignaturePad } from "../signature-pad";
import { decodeImageFile, signatureFromPixels } from "../signature-bitmap";
import type { Pending } from "./editor-state";
import {
  readSavedSignatures,
  saveSignature,
  bytesOfDataUrl,
  forgetSignature,
  type SavedSignature,
} from "@/lib/pdf/editor/saved-signatures";

/**
 * Make a signature to place: draw it, type it, or pick a picture of one —
 * the same three sources Sign PDF has always offered (`SIGNATURE_SOURCES`),
 * through the same pad and the same bitmap preparation
 * (`signature-bitmap.ts`, `signature-image.ts`):
 *
 *  - drawn: the pad's ink, cropped to it;
 *  - typed: placed as TEXT in the Script (Times Italic) or Print
 *    (Helvetica) face — the faces Sign PDF's copy names — not a picture;
 *  - uploaded: cropped to the ink, its paper keyed out unless "Remove paper
 *    background" is unticked (shown only for a file with no transparency).
 *
 * "Save for next time" is opt-in and keeps the signature in this browser's
 * storage only (`./saved-signatures`); nothing is ever sent anywhere.
 */

/** The browser's own approximation of each style, for the preview only. */
const PREVIEW_FONT: Record<SignatureStyle, string> = {
  signature: '"Times New Roman", Times, serif',
  print: "Helvetica, Arial, sans-serif",
};

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

async function pendingOf(sig: ImageSignature): Promise<Pending> {
  const size = await sizeOf(sig);
  return { kind: "signature", format: sig.format, bytes: sig.bytes, ...size };
}

function SavedThumb({ saved }: { saved: SavedSignature }) {
  if (saved.kind === "typed") {
    return (
      <span
        className="text-fg truncate text-lg"
        style={{
          fontFamily: PREVIEW_FONT[saved.style],
          fontStyle: saved.style === "signature" ? "italic" : "normal",
        }}
      >
        {saved.text}
      </span>
    );
  }
  return (
    // A data URL held in this browser: a thumbnail, not a page image.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={saved.dataUrl} alt="" className="h-8 max-w-full object-contain" />
  );
}

export function SignaturePanel({
  onReady,
  onClose,
}: {
  onReady: (pending: Pending) => void;
  onClose: () => void;
}) {
  // Opens on Type, as Sign PDF always has, so signing works without a
  // pointer.
  const [source, setSource] =
    useState<(typeof SIGNATURE_SOURCES)[number]>("type");
  const [drawn, setDrawn] = useState<ImageSignature | null>(null);
  const [name, setName] = useState("");
  const [style, setStyle] = useState<SignatureStyle>("signature");
  const [uploadPixels, setUploadPixels] = useState<RgbaImage | null>(null);
  const [uploadIsPhoto, setUploadIsPhoto] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [uploaded, setUploaded] = useState<ImageSignature | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<SavedSignature[]>(() =>
    readSavedSignatures(),
  );
  const prepareSeq = useRef(0);
  const uploadedUrl = useMemo(
    () =>
      uploaded
        ? URL.createObjectURL(
            new Blob([new Uint8Array(uploaded.bytes).buffer], {
              type: uploaded.format === "png" ? "image/png" : "image/jpeg",
            }),
          )
        : null,
    [uploaded],
  );
  useEffect(
    () => () => {
      if (uploadedUrl) URL.revokeObjectURL(uploadedUrl);
    },
    [uploadedUrl],
  );

  // Re-prepare the upload when the paper toggle moves; only the latest lands.
  useEffect(() => {
    if (!uploadPixels) return;
    const seq = ++prepareSeq.current;
    void signatureFromPixels(uploadPixels, { removeBackground })
      .catch(() => null)
      .then((sig) => {
        if (seq !== prepareSeq.current) return;
        setUploaded(sig);
        setError(
          sig
            ? null
            : "We couldn't find a signature in that image. Use a photo or scan of dark ink on light paper, or a PNG with a transparent background.",
        );
      });
  }, [uploadPixels, removeBackground]);

  const onUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    // The previous file stops being the signature the moment a new one is
    // dropped: it must not be used while this one decodes, and a paper toggle
    // in the meantime must not re-prepare it (sign-runner.test.tsx).
    prepareSeq.current += 1;
    setUploaded(null);
    setUploadPixels(null);
    try {
      const pixels = await decodeImageFile(file);
      setUploadIsPhoto(isOpaque(pixels));
      setUploadPixels(pixels);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That image can't be used.",
      );
    }
  };

  const use = async () => {
    setError(null);
    if (source === "type") {
      const text = name.trim();
      if (!text) return setError("Type your name first.");
      if (remember) setSaved(saveSignature({ kind: "typed", text, style }));
      onReady({ kind: "typed", text, style });
      return;
    }
    const sig = source === "draw" ? drawn : uploaded;
    if (!sig) {
      return setError(
        source === "draw"
          ? "Draw your signature first."
          : "Choose a picture of your signature first.",
      );
    }
    if (remember) setSaved(await saveSignature({ kind: "image", sig }));
    onReady(await pendingOf(sig));
  };

  const reuse = async (s: SavedSignature) => {
    if (s.kind === "typed") {
      onReady({ kind: "typed", text: s.text, style: s.style });
      return;
    }
    const bytes = bytesOfDataUrl(s.dataUrl);
    if (!bytes) {
      setSaved(forgetSignature(s.id));
      return setError(
        "That saved signature could not be read; it was removed.",
      );
    }
    onReady(await pendingOf({ kind: "image", format: s.format, bytes }));
  };

  return (
    <div
      role="region"
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
                "rounded-ctl h-11 border px-3 py-1 text-xs font-medium",
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
          className="text-muted hover:text-fg rounded-ctl grid h-11 w-11 place-items-center"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {saved.length > 0 && (
        <section
          aria-label="Saved signatures"
          className="flex flex-col gap-1.5"
        >
          <h4 className="text-faint kicker">Saved on this device</h4>
          <ul className="flex flex-wrap gap-2">
            {saved.map((s) => (
              <li
                key={s.id}
                className="border-line bg-canvas rounded-ctl flex items-center gap-1 border pl-2"
              >
                <button
                  type="button"
                  onClick={() => void reuse(s)}
                  aria-label={`Use saved signature${s.kind === "typed" ? ` “${s.text}”` : ""}`}
                  className="flex max-w-40 items-center overflow-hidden py-1"
                >
                  <SavedThumb saved={s} />
                </button>
                <button
                  type="button"
                  onClick={() => setSaved(forgetSignature(s.id))}
                  aria-label="Delete saved signature"
                  className="text-muted hover:text-err rounded-ctl p-1.5"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The pad stays mounted while another source is shown, so what is
          drawn on it (and its Clear) survives a switch — the defect Sign
          PDF's form had until its audit (sign-runner.test.tsx). The hidden
          wrapper carries no display class to compete with `hidden`. */}
      <div hidden={source !== "draw"}>
        <SignaturePad onChange={setDrawn} />
      </div>
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
            className="border-line bg-canvas text-fg rounded-ctl h-11 border px-3 py-2 text-sm"
          />
          <div role="radiogroup" aria-label="Style" className="flex gap-1">
            {SIGNATURE_STYLES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={style === s}
                onClick={() => setStyle(s)}
                className={cn(
                  "rounded-ctl h-11 border px-3 py-1 text-xs font-medium",
                  style === s
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-line text-muted hover:text-fg",
                )}
              >
                {SIGNATURE_STYLE_LABEL[s]}
              </button>
            ))}
          </div>
          {name.trim() && (
            <p
              aria-hidden
              className="text-fg truncate text-3xl"
              style={{
                fontFamily: PREVIEW_FONT[style],
                fontStyle: style === "signature" ? "italic" : "normal",
              }}
            >
              {name}
            </p>
          )}
        </div>
      )}
      {source === "upload" && (
        <div className="flex flex-col gap-2">
          <Dropzone
            onFiles={(files) => void onUpload(files)}
            accept="image/png,image/jpeg"
            multiple={false}
            compact
            title="Drop a signature image, or"
            hint="PNG or JPEG · cropped to the ink and placed locally"
          />
          {uploadedUrl && (
            // A blob URL of the prepared picture, held in this tab.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={uploadedUrl}
              alt="Signature preview"
              className="border-line rounded-ctl h-16 w-fit max-w-full border object-contain p-1"
            />
          )}
          {uploadIsPhoto && (
            <label className="text-muted tap-row flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={removeBackground}
                onChange={(e) => setRemoveBackground(e.target.checked)}
              />
              Remove paper background
            </label>
          )}
        </div>
      )}

      <label className="text-muted tap-row flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        Save for next time
      </label>
      <p className="text-muted -mt-2 text-[11px] leading-snug">
        Saved signatures stay in this browser on this device. They are never
        uploaded, and you can delete them here.
      </p>

      {error && (
        <p role="alert" className="text-err text-xs">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void use()}
          className={buttonVariants({ variant: "primary", size: "md" })}
        >
          Use signature
        </button>
      </div>
    </div>
  );
}
