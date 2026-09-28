"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, PenLine, ShieldAlert } from "lucide-react";
import {
  DEFAULT_SIGNATURE_WIDTH,
  MAX_SIGNATURE_WIDTH,
  MIN_SIGNATURE_WIDTH,
  signatureOutputName,
  signPdf,
  type ImageSignature,
  type SignatureInput,
  type SignaturePosition,
  type SignatureStyle,
} from "@/lib/pdf/signature";
import {
  SIGNATURE_SOURCE_LABEL,
  SIGNATURE_SOURCES,
  SIGNATURE_STYLE_LABEL,
  SIGNATURE_STYLES,
  type SignatureSource,
} from "@/lib/pdf/offered-kinds";
import { downloadBytes } from "@/lib/pdf/browser";
import { isOpaque, type RgbaImage } from "@/lib/pdf/signature-image";
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
import { decodeImageFile, signatureFromPixels } from "./signature-bitmap";
import type { LoadedPdf } from "./use-single-pdf";

type Source = SignatureSource;

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
  const [drawn, setDrawn] = useState<ImageSignature | null>(null);
  // The decoded upload is kept so "Remove paper background" can be toggled
  // without asking for the file again.
  const [uploadPixels, setUploadPixels] = useState<RgbaImage | null>(null);
  // Whether the upload is a photo/scan (no transparency) — read ONCE per file:
  // it is a pass over every pixel, and this component re-renders per keystroke.
  const [uploadIsPhoto, setUploadIsPhoto] = useState(false);
  // Preparing is async; only the latest request may land, or a slow encode of
  // an earlier file or toggle state could overwrite the current one.
  const prepareSeq = useRef(0);
  const [removeBackground, setRemoveBackground] = useState(true);
  // Read by an upload when its decode finishes, so a toggle made while the
  // file was still decoding is honoured rather than the value at drop time.
  const removeBackgroundRef = useRef(removeBackground);
  const [uploaded, setUploaded] = useState<ImageSignature | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [position, setPosition] = useState<SignaturePosition>("bottom-right");
  const [pageIndex, setPageIndex] = useState(0);
  const [width, setWidth] = useState(DEFAULT_SIGNATURE_WIDTH);
  const [margin, setMargin] = useState(24);

  const { busy, error, result, run } = useAsyncRun<Uint8Array>();

  const drawnUrl = useObjectUrl(drawn);
  const uploadUrl = useObjectUrl(uploaded);

  // The signature the active source currently describes, or null when it has no
  // usable content yet (empty text / no drawing / no upload).
  const input = useMemo<SignatureInput | null>(() => {
    if (source === "type") {
      return text.trim().length > 0 ? { kind: "typed", text, style } : null;
    }
    if (source === "draw") return drawn;
    return uploaded;
  }, [source, text, style, drawn, uploaded]);

  const prepareUpload = async (
    seq: number,
    pixels: RgbaImage,
    removeBg: boolean,
  ) => {
    let signature: ImageSignature | null = null;
    let problem: string | null = null;
    try {
      signature = await signatureFromPixels(pixels, {
        removeBackground: removeBg,
      });
      if (!signature) {
        problem =
          "We couldn't find a signature in that image. Use a photo or scan of dark ink on light paper, or a PNG with a transparent background.";
      }
    } catch (err) {
      problem = errorMessage(err);
    }
    if (seq !== prepareSeq.current) return;
    setUploaded(problem ? null : signature);
    setUploadError(problem);
  };

  const onUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const seq = ++prepareSeq.current;
    setUploadError(null);
    // The previous file stops being the signature the moment a new one is
    // dropped: Run must not place it while this one decodes, and a toggle in
    // the meantime must not re-prepare it (which would supersede this upload).
    setUploaded(null);
    setUploadPixels(null);
    try {
      const pixels = await decodeImageFile(file);
      if (seq !== prepareSeq.current) return;
      setUploadPixels(pixels);
      setUploadIsPhoto(isOpaque(pixels));
      await prepareUpload(seq, pixels, removeBackgroundRef.current);
    } catch (err) {
      if (seq !== prepareSeq.current) return;
      setUploadPixels(null);
      setUploadIsPhoto(false);
      setUploaded(null);
      setUploadError(errorMessage(err));
    }
  };

  const onRemoveBackground = (value: boolean) => {
    removeBackgroundRef.current = value;
    setRemoveBackground(value);
    if (uploadPixels) {
      void prepareUpload(++prepareSeq.current, uploadPixels, value);
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
          options={SIGNATURE_SOURCES.map((value) => ({
            value,
            label: SIGNATURE_SOURCE_LABEL[value],
          }))}
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
                options={SIGNATURE_STYLES.map((value) => ({
                  value,
                  label: SIGNATURE_STYLE_LABEL[value],
                }))}
              />
            </div>
            <TypedPreview text={text} style={style} />
          </div>
        )}

        {/* Kept mounted while another source is shown, so switching away
            and back keeps the drawing — and its Clear button — in step with
            the signature that would be placed. No `flex` while hidden, so
            hiding does not rest on preflight's [hidden] rule beating it. */}
        <div
          className={source === "draw" ? "flex flex-col gap-3" : undefined}
          hidden={source !== "draw"}
        >
          <SignaturePad onChange={setDrawn} />
          {drawnUrl && <SignaturePreview url={drawnUrl} />}
        </div>

        {source === "upload" && (
          <div className="flex flex-col gap-3">
            <Dropzone
              onFiles={(files) => void onUpload(files)}
              accept="image/png,image/jpeg"
              multiple={false}
              compact
              title="Drop a signature image, or"
              hint="PNG or JPEG · cropped to the ink and placed locally"
            />
            {uploadIsPhoto && (
              <label className="text-muted inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={removeBackground}
                  onChange={(event) => onRemoveBackground(event.target.checked)}
                  className="accent-accent size-4"
                />
                Remove paper background
              </label>
            )}
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

/** Preview a drawn or uploaded signature on a light card. */
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

/** Object URL for a signature image, revoked when it changes or on unmount. */
function useObjectUrl(image: ImageSignature | null): string | null {
  const url = useMemo(() => {
    if (
      !image ||
      image.bytes.byteLength === 0 ||
      typeof window === "undefined"
    ) {
      return null;
    }
    const copy = new ArrayBuffer(image.bytes.byteLength);
    new Uint8Array(copy).set(image.bytes);
    const type = image.format === "jpg" ? "image/jpeg" : "image/png";
    return URL.createObjectURL(new Blob([copy], { type }));
  }, [image]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return url;
}
