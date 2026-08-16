"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, PenLine, ShieldAlert } from "lucide-react";
import {
  DEFAULT_SIGNATURE_WIDTH,
  MAX_SIGNATURE_WIDTH,
  MIN_SIGNATURE_WIDTH,
  signatureOutputName,
  signPdf,
  type SignatureInput,
  type SignaturePosition,
  type SignatureStyle,
} from "@/lib/pdf/signature";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  errorMessage,
  useAsyncRun,
} from "./runner-kit";
import {
  NumberField,
  PositionPicker,
  PrivacyLine,
  RangeField,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { SignaturePad } from "./signature-pad";
import type { LoadedPdf } from "./use-single-pdf";

type Source = "draw" | "type" | "upload";

export function SignRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · signed locally in your browser"
      handoffSlug="sign-pdf"
      toolName="Sign PDF"
    >
      {(pdf, reset) => <SignEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function SignEditor({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
  // Default to "type" so the tool is usable without a pointer/canvas.
  const [source, setSource] = useState<Source>("type");
  const [text, setText] = useState("");
  const [style, setStyle] = useState<SignatureStyle>("signature");
  const [drawnPng, setDrawnPng] = useState<Uint8Array | null>(null);
  const [uploadPng, setUploadPng] = useState<Uint8Array | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [position, setPosition] = useState<SignaturePosition>("bottom-right");
  const [pageIndex, setPageIndex] = useState(0);
  const [width, setWidth] = useState(DEFAULT_SIGNATURE_WIDTH);
  const [margin, setMargin] = useState(24);

  const { busy, error, result, run } = useAsyncRun<Uint8Array>();

  const drawnUrl = useObjectUrl(drawnPng);
  const uploadUrl = useObjectUrl(uploadPng);

  // The signature the active source currently describes, or null when it has no
  // usable content yet (empty text / no drawing / no upload).
  const input = useMemo<SignatureInput | null>(() => {
    if (source === "type") {
      return text.trim().length > 0 ? { kind: "typed", text, style } : null;
    }
    if (source === "draw") {
      return drawnPng ? { kind: "image", png: drawnPng } : null;
    }
    return uploadPng ? { kind: "image", png: uploadPng } : null;
  }, [source, text, style, drawnPng, uploadPng]);

  const onUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploadError(null);
    try {
      setUploadPng(await imageToPng(file));
    } catch (err) {
      setUploadPng(null);
      setUploadError(errorMessage(err));
    }
  };

  const onRun = () => {
    if (!input) return;
    return run(() =>
      signPdf(pdf.bytes, input, { pageIndex, position, width, margin }),
    );
  };

  if (result) {
    return (
      <ResultPanel
        title="PDF signed"
        summary={`Signed page ${pageIndex + 1} · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, signatureOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download signed PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="Signature">
        <SegmentedControl
          label="Signature source"
          value={source}
          onChange={setSource}
          options={[
            { value: "draw", label: "Draw" },
            { value: "type", label: "Type" },
            { value: "upload", label: "Upload" },
          ]}
        />

        {source === "type" && (
          <div className="flex flex-col gap-4">
            <TextField
              label="Your signature"
              value={text}
              onChange={setText}
              placeholder="e.g. Alex Morgan"
            />
            <div className="flex flex-col gap-2">
              <span className="text-muted text-xs font-medium">Style</span>
              <SegmentedControl
                label="Signature style"
                value={style}
                onChange={setStyle}
                options={[
                  { value: "signature", label: "Script" },
                  { value: "print", label: "Print" },
                ]}
              />
            </div>
            <TypedPreview text={text} style={style} />
          </div>
        )}

        {source === "draw" && (
          <div className="flex flex-col gap-3">
            <SignaturePad onChange={setDrawnPng} />
            {drawnUrl && <SignaturePreview url={drawnUrl} />}
          </div>
        )}

        {source === "upload" && (
          <div className="flex flex-col gap-3">
            <Dropzone
              onFiles={(files) => void onUpload(files)}
              accept="image/png,image/jpeg"
              multiple={false}
              compact
              title="Drop a signature image, or"
              hint="PNG or JPEG · converted and placed locally"
            />
            {uploadError && <ErrorNote message={uploadError} />}
            {uploadUrl && <SignaturePreview url={uploadUrl} />}
          </div>
        )}
      </RunnerSection>

      <RunnerSection title="Placement">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
          <div className="flex flex-col gap-2">
            <span className="text-muted text-xs font-medium">Position</span>
            <PositionPicker value={position} onChange={setPosition} />
          </div>
          <div className="flex flex-1 flex-col gap-5">
            <NumberField
              label="Page"
              value={pageIndex + 1}
              min={1}
              max={pdf.pageCount}
              onChange={(value) => setPageIndex(value - 1)}
            />
            <RangeField
              label="Size"
              value={width}
              min={MIN_SIGNATURE_WIDTH}
              max={MAX_SIGNATURE_WIDTH}
              onChange={setWidth}
              format={(v) => `${v} pt`}
            />
            <RangeField
              label="Margin"
              value={margin}
              min={0}
              max={96}
              onChange={setMargin}
              format={(v) => `${v} pt`}
            />
          </div>
        </div>
      </RunnerSection>

      <div className="border-warn/40 bg-warn/10 text-warn flex items-start gap-3 rounded-[4px] border px-4 py-3 text-sm">
        <ShieldAlert className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Electronic signature — this places a visual signature onto your PDF.
          It is not a digital-certificate or cryptographic signature: it uses no
          PKI and is not tamper-evident. For legally-binding, verifiable
          e-signatures use a certificate-based signing service.
        </span>
      </div>

      <PrivacyLine>
        Signing happens on your device — your PDF never leaves the browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton
          onClick={onRun}
          busy={busy}
          disabled={input === null}
          busyLabel="Signing…"
        >
          <PenLine className="size-4" aria-hidden />
          Sign PDF
        </RunButton>
      </div>
    </div>
  );
}

/** Live preview of a typed signature in the chosen face. */
function TypedPreview({
  text,
  style,
}: {
  text: string;
  style: SignatureStyle;
}) {
  const trimmed = text.trim();
  return (
    <div className="border-line flex min-h-16 items-center justify-center rounded-[4px] border bg-white px-6 py-4">
      {trimmed ? (
        <span
          className={cn(
            "text-2xl text-slate-900",
            style === "signature" ? "font-serif italic" : "font-sans",
          )}
        >
          {trimmed}
        </span>
      ) : (
        <span className="text-sm text-slate-600">
          Your signature preview appears here
        </span>
      )}
    </div>
  );
}

/** Preview a drawn or uploaded signature PNG on a light card. */
function SignaturePreview({ url }: { url: string }) {
  return (
    <div className="border-line flex items-center justify-center rounded-[4px] border bg-white p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Signature preview"
        className="max-h-32 w-auto object-contain"
      />
    </div>
  );
}

/** Object URL for PNG bytes, revoked whenever the bytes change or on unmount. */
function useObjectUrl(bytes: Uint8Array | null): string | null {
  const url = useMemo(() => {
    if (!bytes || bytes.byteLength === 0 || typeof window === "undefined") {
      return null;
    }
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return URL.createObjectURL(new Blob([copy], { type: "image/png" }));
  }, [bytes]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return url;
}

/**
 * Convert an uploaded PNG/JPEG File into PNG bytes via a canvas, entirely in the
 * browser. Guards DOM access so it never runs during SSR.
 */
async function imageToPng(file: File): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    throw new Error("Image conversion is only available in the browser.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error("That image has no visible content.");
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't read that image.");
    ctx.drawImage(image, 0, 0);
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error("Couldn't convert that image to PNG.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("That image couldn't be loaded. Use a PNG or JPEG."));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}
